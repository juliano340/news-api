const cron = require('node-cron');
const config = require('./config');
const { runCollection } = require('./services/collector');

let running = false;

const triggerBuildHook = async () => {
  if (!config.buildHookUrl) {
    return { skipped: true, reason: 'build_hook_not_configured' };
  }

  try {
    const headers = {};
    if (config.buildHookToken) {
      headers.Authorization = `Bearer ${config.buildHookToken}`;
    }

    const response = await fetch(config.buildHookUrl, {
      method: 'POST',
      headers
    });

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: 'build_hook_failed'
      };
    }

    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      reason: 'build_hook_request_error',
      error: error instanceof Error ? error.message : 'unknown_error'
    };
  }
};

const runOnce = async () => {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;

  try {
    const result = await runCollection();
    if (result.totalInserted > 0) {
      const build = await triggerBuildHook();
      return { ...result, build };
    }
    return { ...result, build: { skipped: true, reason: 'no_new_posts' } };
  } finally {
    running = false;
  }
};

const startScheduler = () => {
  if (!config.runScheduler) return null;

  const task = cron.schedule(config.schedulerCron, async () => {
    try {
      await runOnce();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('scheduler_run_error', error);
    }
  });

  return task;
};

module.exports = {
  runOnce,
  startScheduler
};
