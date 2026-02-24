#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const fg = require('fast-glob');
const matter = require('gray-matter');
const { db, init, insertOrUpdatePost } = require('../src/lib/db');

function parseArgs(argv) {
  const args = {
    dryRun: false,
    source: process.env.LEGACY_POSTS_DIR || '',
    reportDir: process.env.MIGRATION_REPORT_DIR || 'logs'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') args.dryRun = true;
    if (token === '--source') args.source = argv[i + 1] || args.source;
    if (token === '--report-dir') args.reportDir = argv[i + 1] || args.reportDir;
  }

  return args;
}

function toIso(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function stripMarkdown(input) {
  return String(input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, ' ')
    .replace(/\[[^\]]+\]\([^\)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSlug(fileName, frontmatterSlug) {
  if (frontmatterSlug && String(frontmatterSlug).trim()) return String(frontmatterSlug).trim();
  const bare = fileName.replace(/\.md$/i, '');
  return bare.replace(/^\d{4}-\d{2}-\d{2}-/, '');
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function createSummary(frontmatter, markdownBody) {
  const candidates = [
    frontmatter.meta_description,
    frontmatter.schema_description,
    frontmatter.excerpt,
    frontmatter.summary,
    markdownBody
  ];

  for (const candidate of candidates) {
    const plain = stripMarkdown(candidate);
    if (!plain) continue;
    return plain.slice(0, 260);
  }

  return '';
}

function mapLegacyPost(filePath, content) {
  const parsed = matter(content);
  const fm = parsed.data || {};
  const body = String(parsed.content || '').trim();
  const fileName = path.basename(filePath);

  const slug = inferSlug(fileName, fm.slug);
  const title = String(fm.title || '').trim();
  const source = String(fm.source || '').trim();
  const originalUrl = String(fm.original_url || fm.primary_source || '').trim();

  if (!slug || !title || !source || !originalUrl || !body) {
    return { valid: false, reason: 'missing_required_fields', slug, title, source, originalUrl };
  }

  const publishedAt = toIso(
    fm.published_at || fm.date || fm.schema_date_published,
    toIso(fs.statSync(filePath).mtime.toISOString())
  );

  const repositoryAddedAt = toIso(fm.modified_at || fm.schema_date_modified || publishedAt, publishedAt);

  return {
    valid: true,
    data: {
      slug,
      title,
      source,
      original_url: originalUrl,
      image_url: String(fm.image_url || fm.image || '').trim(),
      summary_text: createSummary(fm, body),
      content: body,
      tags: normalizeTags(fm.tags),
      topic: String(fm.topic || '').trim() || 'geral',
      domain: String(fm.domain || '').trim() || 'geral',
      post_type: String(fm.post_type || '').trim() || 'standard',
      published_at: publishedAt,
      repository_added_at: repositoryAddedAt
    }
  };
}

function ensureReportDir(reportDir) {
  const resolved = path.resolve(process.cwd(), reportDir);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeReport(reportDir, payload) {
  const dir = ensureReportDir(reportDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(dir, `migration-report-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

function createBackup() {
  const dbPath = db.name;
  const backupPath = `${dbPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

async function main() {
  init();
  const args = parseArgs(process.argv.slice(2));

  if (!args.source) {
    throw new Error('Missing source directory. Use --source <path> or set LEGACY_POSTS_DIR');
  }

  const sourceDir = path.resolve(args.source);
  const normalizedSourceDir = sourceDir.split(path.sep).join('/');
  const pattern = `${normalizedSourceDir}/*.md`;
  const files = await fg(pattern, { dot: false, onlyFiles: true, unique: true, absolute: true });

  if (files.length === 0) {
    throw new Error(`No markdown files found at ${sourceDir}`);
  }

  const report = {
    startedAt: new Date().toISOString(),
    sourceDir,
    dryRun: args.dryRun,
    totals: {
      files: files.length,
      valid: 0,
      insertedOrUpdated: 0,
      skipped: 0,
      errors: 0
    },
    skipped: [],
    errors: []
  };

  let backupPath = null;
  if (!args.dryRun) {
    backupPath = createBackup();
  }

  const selectByOriginal = db.prepare('SELECT id FROM posts WHERE original_url = ?');

  const tx = db.transaction((mappedItems) => {
    for (const mapped of mappedItems) {
      const exists = selectByOriginal.get(mapped.original_url);
      insertOrUpdatePost(mapped);
      report.totals.insertedOrUpdated += 1;
      if (!exists) {
        // insert path
      }
    }
  });

  const mappedBatch = [];

  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const mapped = mapLegacyPost(filePath, content);

      if (!mapped.valid) {
        report.totals.skipped += 1;
        report.skipped.push({ filePath, reason: mapped.reason, details: mapped });
        continue;
      }

      report.totals.valid += 1;
      mappedBatch.push(mapped.data);
    } catch (error) {
      report.totals.errors += 1;
      report.errors.push({ filePath, error: error.message });
    }
  }

  if (!args.dryRun) {
    tx(mappedBatch);
  }

  report.finishedAt = new Date().toISOString();
  report.backupPath = backupPath;
  report.sample = mappedBatch.slice(0, 5).map((item) => ({
    slug: item.slug,
    source: item.source,
    published_at: item.published_at
  }));

  const reportPath = writeReport(args.reportDir, report);

  console.log(JSON.stringify({
    ok: true,
    dryRun: args.dryRun,
    sourceDir,
    files: report.totals.files,
    valid: report.totals.valid,
    insertedOrUpdated: args.dryRun ? 0 : report.totals.insertedOrUpdated,
    skipped: report.totals.skipped,
    errors: report.totals.errors,
    backupPath,
    reportPath
  }, null, 2));
}

main().catch((error) => {
  console.error('[migrate-from-github] failed:', error.message);
  process.exit(1);
});
