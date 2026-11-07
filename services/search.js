'use strict';
const { maskText } = require('./moderation');

/**
 * Búsqueda de publicaciones y actividades.
 *  - Con ALGOLIA_APP_ID + ALGOLIA_ADMIN_KEY: usa el índice de Algolia (API REST).
 *  - Sin configuración: filtra directamente en SQLite (equivalente al "filtra el catálogo"
 *    del proyecto de referencia).
 * La sincronización completa del índice la dispara un Admin (syncAll).
 */
const { fetchJson, normalizeText } = require('./http');

function config() {
  return {
    appId: process.env.ALGOLIA_APP_ID || '',
    key: process.env.ALGOLIA_ADMIN_KEY || process.env.ALGOLIA_API_KEY || '',
    index: process.env.ALGOLIA_INDEX || 'prism_contenido',
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.appId && c.key);
}

function algolia(path, method, body) {
  const c = config();
  return fetchJson(`https://${c.appId}.algolia.net/1/indexes/${encodeURIComponent(c.index)}${path}`, {
    method,
    headers: {
      'X-Algolia-Application-Id': c.appId,
      'X-Algolia-API-Key': c.key,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function snippet(text, max = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function postRecord(row) {
  return {
    objectID: `post-${row.id}`,
    type: 'post',
    id: row.id,
    title: snippet(row.body, 80) || 'Publicación con foto',
    body: row.body,
    category: row.category,
    author: row.name,
    career: row.career,
    createdAt: row.created_at,
  };
}

function activityRecord(row) {
  return {
    objectID: `activity-${row.id}`,
    type: 'activity',
    id: row.id,
    title: row.title,
    body: row.description || '',
    category: row.category,
    location: row.location,
    eventDate: row.event_date,
    author: row.name,
    career: row.career,
    createdAt: row.created_at,
  };
}

function loadPosts(db, id) {
  const sql = `SELECT p.id, p.body, p.category, p.created_at, u.name, u.career
               FROM posts p JOIN users u ON u.id = p.user_id`;
  return id ? db.prepare(`${sql} WHERE p.id = ?`).all(id) : db.prepare(sql).all();
}

function loadActivities(db, id) {
  const sql = `SELECT a.id, a.title, a.description, a.category, a.location, a.event_date, a.created_at, u.name, u.career
               FROM activities a JOIN users u ON u.id = a.owner_id`;
  return id ? db.prepare(`${sql} WHERE a.id = ?`).all(id) : db.prepare(sql).all();
}

function toResult(hit) {
  return {
    type: hit.type,
    id: hit.id,
    title: maskText(hit.title),
    snippet: maskText(snippet(hit.body)),
    category: hit.category,
    author: hit.author,
    career: hit.career,
    location: maskText(hit.location) || null,
    eventDate: hit.eventDate || null,
    createdAt: hit.createdAt,
  };
}

/** Búsqueda local en SQLite: cada término debe aparecer (sin acentos ni mayúsculas). */
function searchLocal(db, query, type, limit) {
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  const records = [];
  if (type !== 'activity') records.push(...loadPosts(db).map(postRecord));
  if (type !== 'post') records.push(...loadActivities(db).map(activityRecord));

  const scored = [];
  for (const record of records) {
    const title = normalizeText(record.title);
    const haystack = normalizeText(`${record.title} ${record.body} ${record.category} ${record.author} ${record.location || ''}`);
    if (!terms.every((term) => haystack.includes(term))) continue;
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 2 : 1), 0);
    scored.push({ record, score });
  }
  scored.sort((a, b) => b.score - a.score || String(b.record.createdAt).localeCompare(String(a.record.createdAt)));
  return scored.slice(0, limit).map((item) => toResult(item.record));
}

async function search(db, query, { type = 'all', limit = 20 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { engine: isConfigured() ? 'algolia' : 'sqlite', query: q, results: [] };

  if (isConfigured()) {
    try {
      const body = { query: q, hitsPerPage: limit };
      if (type === 'post' || type === 'activity') body.filters = `type:${type}`;
      const data = await algolia('/query', 'POST', body);
      return { engine: 'algolia', query: q, results: (data.hits || []).map(toResult) };
    } catch (error) {
      console.warn('[Búsqueda] Algolia falló, se usa SQLite:', error.message);
      return { engine: 'sqlite', query: q, results: searchLocal(db, q, type, limit), warning: 'Algolia no respondió; resultados desde SQLite.' };
    }
  }
  return { engine: 'sqlite', query: q, results: searchLocal(db, q, type, limit) };
}

/** Sincronización completa (solo Admin): reemplaza todo el índice. */
async function syncAll(db) {
  const posts = loadPosts(db).map(postRecord);
  const activities = loadActivities(db).map(activityRecord);
  const records = [...posts, ...activities];
  if (!isConfigured()) {
    return { engine: 'sqlite', synced: 0, posts: posts.length, activities: activities.length, message: 'Algolia no está configurado: la búsqueda usa SQLite directamente.' };
  }
  await algolia('/settings', 'PUT', {
    searchableAttributes: ['title', 'body', 'category', 'author', 'location'],
    attributesForFaceting: ['filterOnly(type)'],
    customRanking: ['desc(createdAt)'],
  });
  await algolia('/clear', 'POST', {});
  for (let i = 0; i < records.length; i += 500) {
    const requests = records.slice(i, i + 500).map((body) => ({ action: 'updateObject', body }));
    await algolia('/batch', 'POST', { requests });
  }
  return { engine: 'algolia', synced: records.length, posts: posts.length, activities: activities.length };
}

/** Actualización incremental best-effort (no bloquea ni rompe la petición original). */
function indexRecord(db, type, id) {
  if (!isConfigured()) return;
  const rows = type === 'post' ? loadPosts(db, id) : loadActivities(db, id);
  if (!rows.length) return;
  const body = type === 'post' ? postRecord(rows[0]) : activityRecord(rows[0]);
  algolia('/batch', 'POST', { requests: [{ action: 'updateObject', body }] })
    .catch((error) => console.warn('[Búsqueda] No se pudo indexar:', error.message));
}

function removeRecord(type, id) {
  if (!isConfigured()) return;
  algolia(`/${encodeURIComponent(`${type}-${id}`)}`, 'DELETE')
    .catch((error) => console.warn('[Búsqueda] No se pudo quitar del índice:', error.message));
}

module.exports = { isConfigured, search, searchLocal, syncAll, indexRecord, removeRecord };
