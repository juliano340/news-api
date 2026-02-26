const Fastify = require('fastify');
const fastifyCors = require('@fastify/cors');
const config = require('./config');
const db = require('./lib/db');
const postsRoutes = require('./routes/posts');
const viewsRoutes = require('./routes/views');
const statsRoutes = require('./routes/stats');
const { runOnce } = require('./scheduler');

const buildServer = () => {
  const app = Fastify({ logger: true });

  app.register(fastifyCors, {
    origin: config.corsOrigin,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  });

  db.init();

  app.register(postsRoutes);
  app.register(viewsRoutes);
  app.register(statsRoutes);

  app.get('/health', async () => ({ status: 'ok', now: new Date().toISOString() }));

  app.post('/api/collector/run', async (_request, reply) => {
    try {
      const result = await runOnce();
      return { ok: true, result };
    } catch (error) {
      app.log.error(error);
      return reply.code(500).send({ ok: false, error: 'collector_run_failed' });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(500).send({ error: 'internal_error' });
  });

  return app;
};

const startServer = async () => {
  const app = buildServer();
  await app.listen({ port: config.port, host: config.host });
  return app;
};

module.exports = {
  buildServer,
  startServer
};
