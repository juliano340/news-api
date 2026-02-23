const { listAllPosts, getAllViewsMap } = require('../lib/db');

const toDateKey = (iso) => {
  const date = new Date(iso);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toHourKey = (iso) => {
  const date = new Date(iso);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:00`;
};

const getPresetHours = (preset) => {
  if (preset === '4h') return 4;
  if (preset === '24h') return 24;
  if (preset === '72h') return 72;
  if (preset === '7d') return 7 * 24;
  return 24;
};

async function statsRoutes(fastify) {
  fastify.get('/api/stats/dashboard', async (request) => {
    const limit = Math.max(1, Math.min(50, Number(request.query.limit) || 20));
    const posts = listAllPosts();
    const viewsBySlug = getAllViewsMap();

    const totalViews = posts.reduce((acc, post) => acc + (viewsBySlug.get(post.slug) || 0), 0);
    const totalTags = new Set(posts.flatMap((post) => post.tags || [])).size;
    const postsWithoutViews = posts.filter((post) => (viewsBySlug.get(post.slug) || 0) === 0).length;
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const postsLast7Days = posts.filter((post) => new Date(post.published_at).getTime() >= sevenDaysAgo).length;

    const topPosts = posts
      .map((post) => ({
        slug: post.slug,
        title: post.title,
        source: post.source,
        date: post.published_at,
        tags: post.tags || [],
        views: viewsBySlug.get(post.slug) || 0
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, limit);

    const tagsMap = new Map();
    const sourcesMap = new Map();

    posts.forEach((post) => {
      const views = viewsBySlug.get(post.slug) || 0;

      (post.tags || []).forEach((tag) => {
        const curr = tagsMap.get(tag) || { postCount: 0, totalViews: 0 };
        curr.postCount += 1;
        curr.totalViews += views;
        tagsMap.set(tag, curr);
      });

      const source = post.source || 'Unknown';
      const currSource = sourcesMap.get(source) || { postCount: 0, totalViews: 0 };
      currSource.postCount += 1;
      currSource.totalViews += views;
      sourcesMap.set(source, currSource);
    });

    const tags = [...tagsMap.entries()]
      .map(([tag, value]) => ({ tag, ...value }))
      .sort((a, b) => b.postCount - a.postCount)
      .slice(0, 20);

    const sources = [...sourcesMap.entries()]
      .map(([source, value]) => ({ source, ...value }))
      .sort((a, b) => b.totalViews - a.totalViews)
      .slice(0, 20);

    return {
      kpis: {
        totalPosts: posts.length,
        totalViews,
        averageViewsPerPost: posts.length ? Math.round(totalViews / posts.length) : 0,
        totalTags,
        postsLast7Days,
        postsWithoutViews
      },
      topPosts,
      tags,
      sources,
      dailyPosts: [],
      viewsStorage: 'memory',
      generatedAt: new Date().toISOString()
    };
  });

  fastify.get('/api/stats/posts-by-day', async (request) => {
    const preset = String(request.query.preset || '7d');
    const posts = listAllPosts();

    let start;
    let end;

    if (preset === 'custom' && request.query.start && request.query.end) {
      start = new Date(`${request.query.start}T00:00:00.000Z`);
      end = new Date(`${request.query.end}T23:59:59.999Z`);
    } else {
      const days = preset === '1d' ? 1 : preset === '30d' ? 30 : 7;
      end = new Date();
      start = new Date(end.getTime() - ((days * 24 * 60 * 60 * 1000) - 1));
    }

    const buckets = new Map();
    const cursor = new Date(start);
    while (cursor <= end) {
      buckets.set(toDateKey(cursor.toISOString()), 0);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    posts.forEach((post) => {
      const publishedAt = new Date(post.published_at);
      if (publishedAt < start || publishedAt > end) return;
      const key = toDateKey(publishedAt.toISOString());
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    });

    const result = [...buckets.entries()].map(([date, count]) => ({ date, count }));
    const total = result.reduce((acc, item) => acc + item.count, 0);

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      total,
      buckets: result
    };
  });

  fastify.get('/api/stats/posts-by-hour', async (request) => {
    const preset = String(request.query.preset || '24h');
    const timeline = String(request.query.timeline || 'published');
    const posts = listAllPosts();

    const hours = getPresetHours(preset);
    const end = new Date();
    const start = new Date(end.getTime() - ((hours * 60 * 60 * 1000) - 1));
    const bucketHours = preset === '7d' ? 3 : 1;

    const buckets = new Map();
    const cursor = new Date(start);
    cursor.setUTCMinutes(0, 0, 0);

    while (cursor <= end) {
      buckets.set(toHourKey(cursor.toISOString()), 0);
      cursor.setUTCHours(cursor.getUTCHours() + bucketHours);
    }

    posts.forEach((post) => {
      const sourceTime = timeline === 'repository' ? post.repository_added_at : post.published_at;
      const date = new Date(sourceTime);
      if (date < start || date > end) return;

      date.setUTCMinutes(0, 0, 0);
      if (bucketHours > 1) {
        const hour = date.getUTCHours();
        const adjusted = hour - (hour % bucketHours);
        date.setUTCHours(adjusted);
      }

      const key = toHourKey(date.toISOString());
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    });

    const result = [...buckets.entries()].map(([hour, count]) => ({ hour, count }));
    const total = result.reduce((acc, item) => acc + item.count, 0);
    const activeBuckets = result.filter((row) => row.count > 0).length;

    return {
      start: start.toISOString(),
      end: end.toISOString(),
      total,
      bucketHours,
      activeBuckets,
      emptyBuckets: Math.max(0, result.length - activeBuckets),
      buckets: result
    };
  });

  fastify.get('/api/stats/posts-by-hour-posts', async (request) => {
    const hour = String(request.query.hour || '');
    const timeline = String(request.query.timeline || 'repository');
    const bucketHours = Number(request.query.bucketHours || 1);
    if (!hour) return { total: 0, posts: [] };

    const posts = listAllPosts();
    const start = new Date(`${hour}:00.000Z`);
    const end = new Date(start.getTime() + bucketHours * 60 * 60 * 1000);

    const filtered = posts
      .filter((post) => {
        const sourceTime = timeline === 'repository' ? post.repository_added_at : post.published_at;
        const date = new Date(sourceTime);
        return date >= start && date < end;
      })
      .map((post) => ({
        slug: post.slug,
        title: post.title,
        source: post.source,
        publishedAt: post.published_at,
        matchedAt: timeline === 'repository' ? post.repository_added_at : post.published_at
      }))
      .sort((a, b) => new Date(b.matchedAt) - new Date(a.matchedAt));

    return {
      timeline,
      hour,
      startHour: start.toISOString(),
      endHour: end.toISOString(),
      bucketHours,
      total: filtered.length,
      posts: filtered
    };
  });
}

module.exports = statsRoutes;
