const { startServer } = require('./src/server');
const { startScheduler, runOnce } = require('./src/scheduler');

async function main() {
  await startServer();
  startScheduler();

  if (process.env.RUN_COLLECTION_ON_BOOT === 'true') {
    await runOnce();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('bootstrap_error', error);
  process.exit(1);
});
