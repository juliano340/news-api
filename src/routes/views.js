const { incrementView, getViewsBySlug } = require('../lib/db');

async function viewsRoutes(fastify) {
  fastify.get('/api/views/:slug', async (request) => {
    const slug = String(request.params.slug || '');
    const views = getViewsBySlug(slug);
    return { slug, views };
  });

  fastify.post('/api/views/:slug', async (request) => {
    const slug = String(request.params.slug || '');
    const views = incrementView(slug);
    return { slug, views };
  });
}

module.exports = viewsRoutes;
