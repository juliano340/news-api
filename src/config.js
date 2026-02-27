require('dotenv').config();

const toBool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
};

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = {
  port: toNumber(process.env.PORT, 3001),
  host: process.env.HOST || '0.0.0.0',
  dbPath: process.env.DB_PATH || './data/news.db',
  runScheduler: toBool(process.env.RUN_SCHEDULER, true),
  schedulerCron: process.env.SCHEDULER_CRON || '0 * * * *',
  maxPostsPerSource: toNumber(process.env.MAX_POSTS_PER_SOURCE, 10),
  requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 30000),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  pendingRetryDelayMinutes: toNumber(process.env.PENDING_RETRY_DELAY_MINUTES, 30),
  pendingRetryBatch: toNumber(process.env.PENDING_RETRY_BATCH, 30),
  useAI: toBool(process.env.USE_AI, false),
  openRouterKey: process.env.OPENROUTER_KEY || '',
  openRouterModel: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  openRouterMaxTokens: toNumber(process.env.OPENROUTER_MAX_TOKENS, 700),
  buildHookUrl: process.env.BUILD_HOOK_URL || '',
  buildHookToken: process.env.BUILD_HOOK_TOKEN || '',
  editorialMinScore: toNumber(process.env.EDITORIAL_MIN_SCORE, 70),
  sources: {
    G1: { enabled: true, url: 'https://g1.globo.com/rss/g1/tecnologia/' },
    TECNOBLOG: { enabled: true, url: 'https://tecnoblog.net/feed/' },
    CANALTECH: { enabled: true, url: 'https://canaltech.com.br/rss/' },
    TECMUNDO: { enabled: true, url: 'https://rss.tecmundo.com.br/feed' },
    UOL: { enabled: true, url: 'https://rss.uol.com.br/feed/tecnologia.xml' }
  }
};
