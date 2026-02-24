const zlib = require('node:zlib');
const axios = require('axios');
const Parser = require('rss-parser');
const slugify = require('slugify');
const config = require('../config');
const { insertOrUpdatePost } = require('../lib/db');
const { generateEditorialContent } = require('../lib/ai');
const quality = require('../lib/quality');

const parser = new Parser({ timeout: config.requestTimeoutMs });

const toIso = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
};

const deriveTopic = (title = '', content = '') => {
  const text = `${title} ${content}`.toLowerCase();
  if (/llm|openai|gemini|claude|ia|inteligencia artificial/.test(text)) return 'llms';
  if (/agente|agent|autonom/.test(text)) return 'agentes';
  if (/framework|sdk|langchain|llamaindex/.test(text)) return 'frameworks';
  if (/seguranca|vazamento|privacidade|malware/.test(text)) return 'seguranca-ia';
  return 'geral';
};

const deriveDomain = (title = '', content = '') => {
  const text = `${title} ${content}`.toLowerCase();
  if (/jogo|games|playstation|xbox|nintendo/.test(text)) return 'games';
  if (/filme|serie|ator|atriz|cinema|entretenimento/.test(text)) return 'entretenimento';
  if (/mercado|negocio|empresa|acoes|investimento/.test(text)) return 'negocios';
  if (/gpu|cpu|chip|hardware|nvidia|intel|amd/.test(text)) return 'hardware';
  if (/ia|llm|openai|gemini|claude|agente/.test(text)) return 'ia-dev';
  return 'geral';
};

const extractTags = (title = '', content = '', source = '') => {
  const text = `${title} ${content}`.toLowerCase();
  const tags = new Set();

  const map = {
    tecnologia: ['tecnologia', 'software', 'app', 'digital'],
    ia: ['ia', 'inteligencia artificial', 'llm', 'openai', 'gemini', 'claude'],
    seguranca: ['seguranca', 'vazamento', 'privacidade', 'malware'],
    games: ['game', 'jogo', 'playstation', 'xbox', 'nintendo'],
    mercado: ['mercado', 'empresa', 'negocio', 'investimento']
  };

  Object.entries(map).forEach(([tag, words]) => {
    if (words.some((word) => text.includes(word))) tags.add(tag);
  });

  if (source) tags.add(source.toLowerCase().replace(/\s+/g, '-'));
  return Array.from(tags).slice(0, 6);
};


const toValidUrl = (value) => {
  const url = String(value || '').replace(/&amp;/g, '&').trim();
  return /^https?:\/\//i.test(url) ? url : '';
};

const extractFirstImageFromHtml = (html = '') => {
  const match = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  if (match?.[1]) return toValidUrl(match[1]);

  const plainUrl = String(html).match(/https?:\/\/[^\s"')>]+\.(?:png|jpe?g|webp|avif)(?:\?[^\s"')>]*)?/i);
  if (plainUrl?.[0]) return toValidUrl(plainUrl[0]);

  return '';
};



const fetchOgImageFromUrl = async (url) => {
  const target = toValidUrl(url);
  if (!target) return '';

  try {
    const response = await axios.get(target, {
      timeout: Math.min(config.requestTimeoutMs, 12000),
      headers: {
        'User-Agent': 'news-api-worker/1.0',
        Accept: 'text/html,application/xhtml+xml'
      }
    });

    const html = String(response.data || '');
    const patterns = [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["'][^>]*>/i
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        const found = toValidUrl(match[1]);
        if (found) return found;
      }
    }

    return extractFirstImageFromHtml(html);
  } catch {
    return '';
  }
};

const extractImageUrl = (item, rawText = '') => {
  const candidates = [];

  candidates.push(item?.enclosure?.url);
  candidates.push(item?.enclosure?.link);
  candidates.push(item?.image?.url);
  candidates.push(item?.thumbnail);

  const itunesImage = item?.['itunes:image'];
  if (itunesImage) {
    candidates.push(itunesImage.href);
    candidates.push(itunesImage.url);
    candidates.push(itunesImage?.$?.href);
  }

  const mediaThumb = item?.['media:thumbnail'];
  if (Array.isArray(mediaThumb)) {
    mediaThumb.forEach((entry) => {
      candidates.push(entry?.url);
      candidates.push(entry?.$?.url);
    });
  } else if (mediaThumb) {
    candidates.push(mediaThumb.url);
    candidates.push(mediaThumb?.$?.url);
  }

  const mediaContent = item?.['media:content'];
  if (Array.isArray(mediaContent)) {
    mediaContent.forEach((entry) => {
      candidates.push(entry?.url);
      candidates.push(entry?.$?.url);
    });
  } else if (mediaContent) {
    candidates.push(mediaContent.url);
    candidates.push(mediaContent?.$?.url);
  }

  for (const candidate of candidates) {
    const valid = toValidUrl(candidate);
    if (valid) return valid;
  }

  return extractFirstImageFromHtml(rawText);
};

const decodeFeedBody = (buffer, encodingHeader = '') => {
  const isGzipHeader = String(encodingHeader).toLowerCase().includes('gzip');
  const isGzipMagic = buffer?.[0] === 0x1f && buffer?.[1] === 0x8b;

  if (isGzipHeader || isGzipMagic) {
    return zlib.gunzipSync(buffer).toString('utf8');
  }

  return buffer.toString('utf8');
};

const parseFeed = async (url) => {
  try {
    return await parser.parseURL(url);
  } catch (_urlError) {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: config.requestTimeoutMs,
      headers: {
        'User-Agent': 'news-api-worker/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        'Accept-Encoding': 'gzip,deflate'
      }
    });

    const xml = decodeFeedBody(Buffer.from(response.data), response.headers['content-encoding']);
    return parser.parseString(xml);
  }
};

const normalizePost = async (item, sourceName) => {
  const title = String(item.title || '').trim();
  const originalUrl = String(item.link || item.guid || '').trim();
  if (!title || !originalUrl) return null;

  const rawText = String(item['content:encoded'] || item.contentSnippet || item.content || item.summary || '').trim();
  const publishedAt = toIso(item.isoDate || item.pubDate);
  const slugBase = slugify(title, { lower: true, strict: true });
  const slug = slugBase || slugify(originalUrl, { lower: true, strict: true });

  let imageUrl = extractImageUrl(item, rawText);
  if (!imageUrl) {
    imageUrl = await fetchOgImageFromUrl(originalUrl);
  }

  const aiResult = await generateEditorialContent({
    title,
    source: sourceName,
    sourceUrl: originalUrl,
    rawText
  });

  const post = {
    slug,
    title,
    source: sourceName,
    original_url: originalUrl,
    image_url: imageUrl,
    summary_text: rawText.slice(0, 260),
    content: aiResult.content,
    tags: extractTags(title, rawText, sourceName),
    topic: deriveTopic(title, rawText),
    domain: deriveDomain(title, rawText),
    post_type: 'standard',
    published_at: publishedAt,
    repository_added_at: new Date().toISOString(),
    ai_mode: aiResult.mode
  };

  const qualityReport = quality.evaluate(post);
  if (qualityReport.status === 'BLOCK') return null;

  return post;
};

const collectFromSource = async (sourceName, sourceConfig) => {
  const feed = await parseFeed(sourceConfig.url);
  const items = Array.isArray(feed.items) ? feed.items : [];
  const limited = items.slice(0, config.maxPostsPerSource);

  let inserted = 0;
  for (const item of limited) {
    const normalized = await normalizePost(item, sourceName);
    if (!normalized) continue;
    insertOrUpdatePost(normalized);
    inserted += 1;
  }

  return {
    source: sourceName,
    totalFetched: limited.length,
    totalInserted: inserted
  };
};

const runCollection = async () => {
  const enabledSources = Object.entries(config.sources).filter(([, cfg]) => cfg.enabled);
  const results = [];

  for (const [sourceName, sourceCfg] of enabledSources) {
    try {
      const result = await collectFromSource(sourceName, sourceCfg);
      results.push({ ...result, status: 'ok' });
    } catch (error) {
      results.push({
        source: sourceName,
        totalFetched: 0,
        totalInserted: 0,
        status: 'error',
        error: error.message
      });
    }
  }

  return {
    ranAt: new Date().toISOString(),
    sources: results,
    totalInserted: results.reduce((acc, row) => acc + row.totalInserted, 0)
  };
};

module.exports = {
  runCollection
};
