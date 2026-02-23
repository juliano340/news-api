const cron = require('node-cron');
const config = require('./config');
const { runCollection } = require('./services/collector');

let running = false;

const runOnce = async () => {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;

  try {
    const result = await runCollection();
    return result;
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
