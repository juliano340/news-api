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

module.exports = {
  db,
  init,
  insertOrUpdatePost,
  getPostBySlug,
  listPosts,
  listAllPosts,
  incrementView,
  getViewsBySlug,
  getAllViewsMap
};
