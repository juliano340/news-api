const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const config = require('../config');

const dbFile = path.resolve(process.cwd(), config.dbPath);
const dbDir = path.dirname(dbFile);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(dbFile);
db.pragma('journal_mode = WAL');

const init = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      original_url TEXT NOT NULL UNIQUE,
      image_url TEXT,
      summary_text TEXT,
      content TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      topic TEXT NOT NULL DEFAULT 'geral',
      domain TEXT NOT NULL DEFAULT 'geral',
      post_type TEXT NOT NULL DEFAULT 'standard',
      published_at TEXT NOT NULL,
      repository_added_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_views (
      slug TEXT PRIMARY KEY,
      views INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at);
    CREATE INDEX IF NOT EXISTS idx_posts_repository_added_at ON posts(repository_added_at);
    CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source);

    CREATE TABLE IF NOT EXISTS pending_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      original_url TEXT NOT NULL UNIQUE,
      image_url TEXT,
      raw_text TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      topic TEXT NOT NULL DEFAULT 'geral',
      domain TEXT NOT NULL DEFAULT 'geral',
      post_type TEXT NOT NULL DEFAULT 'standard',
      published_at TEXT NOT NULL,
      repository_added_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_retry_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_next_retry_at ON pending_posts(next_retry_at);
    CREATE INDEX IF NOT EXISTS idx_pending_source ON pending_posts(source);
  `);
};

init();

const nowIso = () => new Date().toISOString();

const selectSlugByOriginalUrlStmt = db.prepare('SELECT slug FROM posts WHERE original_url = ?');

const upsertPostStmt = db.prepare(`
  INSERT INTO posts (
    slug, title, source, original_url, image_url, summary_text, content,
    tags_json, topic, domain, post_type, published_at, repository_added_at,
    created_at, updated_at
  ) VALUES (
    @slug, @title, @source, @original_url, @image_url, @summary_text, @content,
    @tags_json, @topic, @domain, @post_type, @published_at, @repository_added_at,
    @created_at, @updated_at
  )
  ON CONFLICT(slug) DO UPDATE SET
    title = excluded.title,
    source = excluded.source,
    original_url = excluded.original_url,
    image_url = excluded.image_url,
    summary_text = excluded.summary_text,
    content = excluded.content,
    tags_json = excluded.tags_json,
    topic = excluded.topic,
    domain = excluded.domain,
    post_type = excluded.post_type,
    published_at = excluded.published_at,
    updated_at = excluded.updated_at
`);

const mapPostRow = (row) => ({
  ...row,
  tags: JSON.parse(row.tags_json || '[]')
});

const insertOrUpdatePost = (post) => {
  const now = nowIso();
  const existing = selectSlugByOriginalUrlStmt.get(post.original_url);
  const stableSlug = existing?.slug || post.slug;

  upsertPostStmt.run({
    slug: stableSlug,
    title: post.title,
    source: post.source,
    original_url: post.original_url,
    image_url: post.image_url || '',
    summary_text: post.summary_text || '',
    content: post.content,
    tags_json: JSON.stringify(post.tags || []),
    topic: post.topic || 'geral',
    domain: post.domain || 'geral',
    post_type: post.post_type || 'standard',
    published_at: post.published_at,
    repository_added_at: post.repository_added_at || now,
    created_at: now,
    updated_at: now
  });
};

const getPostBySlug = (slug) => {
  const row = db.prepare('SELECT * FROM posts WHERE slug = ?').get(slug);
  return row ? mapPostRow(row) : null;
};

const listPosts = ({ limit = 20, offset = 0, tag, topic }) => {
  const clauses = [];
  const params = [];

  if (topic) {
    clauses.push('topic = ?');
    params.push(topic);
  }

  if (tag) {
    clauses.push('tags_json LIKE ?');
    params.push(`%"${tag}"%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM posts ${where} ORDER BY published_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  return rows.map(mapPostRow);
};

const listAllPosts = () => {
  const rows = db.prepare('SELECT * FROM posts ORDER BY published_at DESC').all();
  return rows.map(mapPostRow);
};

const incrementView = (slug) => {
  const now = nowIso();
  db.prepare(`
    INSERT INTO post_views (slug, views, updated_at)
    VALUES (?, 1, ?)
    ON CONFLICT(slug) DO UPDATE SET
      views = post_views.views + 1,
      updated_at = excluded.updated_at
  `).run(slug, now);

  return db.prepare('SELECT views FROM post_views WHERE slug = ?').get(slug)?.views || 0;
};

const getViewsBySlug = (slug) => db.prepare('SELECT views FROM post_views WHERE slug = ?').get(slug)?.views || 0;

const getAllViewsMap = () => {
  const rows = db.prepare('SELECT slug, views FROM post_views').all();
  const map = new Map();
  for (const row of rows) map.set(row.slug, row.views || 0);
  return map;
};

const queuePendingPostStmt = db.prepare(`
  INSERT INTO pending_posts (
    slug, title, source, original_url, image_url, raw_text, tags_json,
    topic, domain, post_type, published_at, repository_added_at,
    attempts, last_error, next_retry_at, created_at, updated_at
  ) VALUES (
    @slug, @title, @source, @original_url, @image_url, @raw_text, @tags_json,
    @topic, @domain, @post_type, @published_at, @repository_added_at,
    1, @last_error, @next_retry_at, @created_at, @updated_at
  )
  ON CONFLICT(original_url) DO UPDATE SET
    slug = excluded.slug,
    title = excluded.title,
    source = excluded.source,
    image_url = excluded.image_url,
    raw_text = excluded.raw_text,
    tags_json = excluded.tags_json,
    topic = excluded.topic,
    domain = excluded.domain,
    post_type = excluded.post_type,
    published_at = excluded.published_at,
    repository_added_at = excluded.repository_added_at,
    attempts = pending_posts.attempts + 1,
    last_error = excluded.last_error,
    next_retry_at = excluded.next_retry_at,
    updated_at = excluded.updated_at
`);

const listPendingPostsStmt = db.prepare(`
  SELECT *
  FROM pending_posts
  WHERE next_retry_at <= ?
  ORDER BY next_retry_at ASC, id ASC
  LIMIT ?
`);

const removePendingPostStmt = db.prepare('DELETE FROM pending_posts WHERE original_url = ?');
const countPendingPostsStmt = db.prepare('SELECT COUNT(*) AS total FROM pending_posts');

const queuePendingPost = (pendingPost) => {
  const now = nowIso();
  const delayMinutes = Number.isFinite(Number(pendingPost.retryDelayMinutes))
    ? Math.max(1, Number(pendingPost.retryDelayMinutes))
    : 30;
  const nextRetryAt = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();

  queuePendingPostStmt.run({
    slug: pendingPost.slug,
    title: pendingPost.title,
    source: pendingPost.source,
    original_url: pendingPost.original_url,
    image_url: pendingPost.image_url || '',
    raw_text: pendingPost.raw_text || '',
    tags_json: JSON.stringify(pendingPost.tags || []),
    topic: pendingPost.topic || 'geral',
    domain: pendingPost.domain || 'geral',
    post_type: pendingPost.post_type || 'standard',
    published_at: pendingPost.published_at,
    repository_added_at: pendingPost.repository_added_at || now,
    last_error: pendingPost.last_error || 'ai_generation_failed',
    next_retry_at: nextRetryAt,
    created_at: now,
    updated_at: now
  });
};

const listPendingPostsForRetry = (limit = 30) => {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 30));
  return listPendingPostsStmt.all(nowIso(), safeLimit).map((row) => ({
    ...row,
    tags: JSON.parse(row.tags_json || '[]')
  }));
};

const removePendingPostByOriginalUrl = (originalUrl) => {
  removePendingPostStmt.run(originalUrl);
};

const countPendingPosts = () => countPendingPostsStmt.get()?.total || 0;

module.exports = {
  db,
  init,
  insertOrUpdatePost,
  getPostBySlug,
  listPosts,
  listAllPosts,
  incrementView,
  getViewsBySlug,
  getAllViewsMap,
  queuePendingPost,
  listPendingPostsForRetry,
  removePendingPostByOriginalUrl,
  countPendingPosts
};
