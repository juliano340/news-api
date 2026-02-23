const { listPosts, getPostBySlug } = require('../lib/db');

async function postsRoutes(fastify) {
  fastify.get('/api/posts', async (request) => {
    const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 20));
    const page = Math.max(1, Number(request.query.page) || 1);
    const offset = (page - 1) * limit;
    const tag = request.query.tag ? String(request.query.tag) : undefined;
    const topic = request.query.topic ? String(request.query.topic) : undefined;

    const posts = listPosts({ limit, offset, tag, topic });
    return {
      page,
      limit,
      total: posts.length,
      posts
    };
  });

  fastify.get('/api/posts/:slug', async (request, reply) => {
    const slug = String(request.params.slug || '');
    const post = getPostBySlug(slug);
    if (!post) {
      return reply.code(404).send({ error: 'post_not_found' });
    }
    return post;
  });
}

module.exports = postsRoutes;
