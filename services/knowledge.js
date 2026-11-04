'use strict';

/**
 * Base de conocimiento del asistente.
 *  - Los fragmentos viven siempre en SQLite (knowledge_chunks).
 *  - Si hay QDRANT_URL, los vectores se indexan y consultan en Qdrant.
 *  - Embeddings: si hay EMBEDDINGS_API_KEY se usa un endpoint compatible con OpenAI
 *    (EMBEDDINGS_API_URL + EMBEDDINGS_MODEL); si no, un vectorizador local por hashing,
 *    suficiente para recuperar texto por palabras clave.
 */
const { fetchJson, normalizeText } = require('./http');
const { chunkText } = require('./documents');

const LOCAL_DIM = 384;
const STOPWORDS = new Set(('de la el los las un una unos unas y o u e en a al del por para con sin sobre que se su sus es son fue ser lo le les me mi tu te nos como mas muy ya si no pero este esta estos estas ese esa eso hay ha han he').split(' '));

/* ----------------------------- Embeddings ----------------------------- */
function remoteConfig() {
  const key = process.env.EMBEDDINGS_API_KEY;
  if (!key) return null;
  return {
    key,
    url: (process.env.EMBEDDINGS_API_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small',
  };
}

function hashToken(token) {
  let h = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function stemWords(text) {
  return (normalizeText(text).match(/[a-z0-9]+/g) || [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w));
}

function localEmbed(text) {
  const words = stemWords(text);
  const vec = new Float32Array(LOCAL_DIM);
  const add = (token, weight) => {
    const h = hashToken(token);
    vec[h % LOCAL_DIM] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  words.forEach((w, i) => {
    add(w, 1);
    if (words[i + 1]) add(`${w}_${words[i + 1]}`, 0.5);
  });
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, (v) => v / norm);
}

async function embed(texts) {
  const remote = remoteConfig();
  if (remote) {
    try {
      const data = await fetchJson(`${remote.url}/embeddings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${remote.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: remote.model, input: texts }),
      }, 30000);
      const vectors = (data.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length === texts.length && vectors[0]) return { vectors, provider: 'remote', dim: vectors[0].length };
    } catch (error) {
      console.warn('[Conocimiento] Embeddings remotos fallaron, se usan locales:', error.message);
    }
  }
  return { vectors: texts.map(localEmbed), provider: 'local', dim: LOCAL_DIM };
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

/* ------------------------------- Qdrant -------------------------------- */
function qdrantConfig() {
  const url = process.env.QDRANT_URL;
  if (!url) return null;
  return { url: url.replace(/\/$/, ''), key: process.env.QDRANT_API_KEY || '', base: process.env.QDRANT_COLLECTION || 'prism_conocimiento' };
}

function qdrant(cfg, path, method, body) {
  return fetchJson(`${cfg.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cfg.key ? { 'api-key': cfg.key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }, 20000);
}

const ensured = new Set();
async function ensureCollection(cfg, provider, dim) {
  const name = `${cfg.base}_${provider}_${dim}`;
  if (!ensured.has(name)) {
    try {
      await qdrant(cfg, `/collections/${name}`, 'PUT', { vectors: { size: dim, distance: 'Cosine' } });
    } catch (error) {
      if (!/already exists|409/i.test(error.message)) throw error;
    }
    ensured.add(name);
  }
  return name;
}

/* ----------------------------- API pública ----------------------------- */
function isQdrantConfigured() {
  return Boolean(qdrantConfig());
}

function embeddingsMode() {
  return remoteConfig() ? 'remote' : 'local';
}

async function addDocument(db, { title, filename, text, userId }) {
  const chunks = chunkText(text);
  if (!chunks.length) throw Object.assign(new Error('El documento no tiene texto suficiente para indexar.'), { status: 422 });
  const { vectors, provider, dim } = await embed(chunks);
  const createdAt = new Date().toISOString();

  const insert = db.transaction(() => {
    const doc = db.prepare(`
      INSERT INTO knowledge_docs (title, filename, chunk_count, engine, uploaded_by, created_at)
      VALUES (?, ?, ?, 'sqlite', ?, ?)
    `).run(title, filename, chunks.length, userId, createdAt);
    const docId = Number(doc.lastInsertRowid);
    const ids = chunks.map((chunk, idx) => Number(db.prepare(`
      INSERT INTO knowledge_chunks (doc_id, idx, text, vec, provider, dim) VALUES (?, ?, ?, ?, ?, ?)
    `).run(docId, idx, chunk, JSON.stringify(vectors[idx]), provider, dim).lastInsertRowid));
    return { docId, ids };
  });
  const { docId, ids } = insert();

  let engine = 'sqlite';
  let warning = null;
  const cfg = qdrantConfig();
  if (cfg) {
    try {
      const collection = await ensureCollection(cfg, provider, dim);
      await qdrant(cfg, `/collections/${collection}/points?wait=true`, 'PUT', {
        points: ids.map((id, idx) => ({ id, vector: vectors[idx], payload: { doc_id: docId, title, idx, text: chunks[idx] } })),
      });
      engine = 'qdrant';
    } catch (error) {
      warning = `Se guardó en SQLite, pero Qdrant falló: ${error.message}`;
      console.warn('[Conocimiento]', warning);
    }
  }
  db.prepare('UPDATE knowledge_docs SET engine = ? WHERE id = ?').run(engine, docId);
  return { id: docId, title, chunks: chunks.length, engine, embeddings: provider, warning };
}

async function deleteDocument(db, docId) {
  const doc = db.prepare('SELECT * FROM knowledge_docs WHERE id = ?').get(docId);
  if (!doc) return false;
  const cfg = qdrantConfig();
  if (cfg && doc.engine === 'qdrant') {
    const sample = db.prepare('SELECT provider, dim FROM knowledge_chunks WHERE doc_id = ? LIMIT 1').get(docId);
    if (sample) {
      try {
        await qdrant(cfg, `/collections/${cfg.base}_${sample.provider}_${sample.dim}/points/delete?wait=true`, 'POST', {
          filter: { must: [{ key: 'doc_id', match: { value: docId } }] },
        });
      } catch (error) {
        console.warn('[Conocimiento] No se pudo borrar de Qdrant:', error.message);
      }
    }
  }
  db.prepare('DELETE FROM knowledge_docs WHERE id = ?').run(docId); // chunks: ON DELETE CASCADE
  return true;
}

/** Sube a Qdrant los documentos que solo están en SQLite (p. ej. los creados antes de conectar Qdrant). */
async function syncToQdrant(db) {
  const cfg = qdrantConfig();
  if (!cfg) return { synced: 0 };
  const docs = db.prepare("SELECT id, title FROM knowledge_docs WHERE engine != 'qdrant'").all();
  let synced = 0;
  for (const doc of docs) {
    const rows = db.prepare('SELECT id, idx, text, vec, provider, dim FROM knowledge_chunks WHERE doc_id = ?').all(doc.id);
    if (!rows.length) continue;
    try {
      const collection = await ensureCollection(cfg, rows[0].provider, rows[0].dim);
      await qdrant(cfg, `/collections/${collection}/points?wait=true`, 'PUT', {
        points: rows.map((r) => ({ id: r.id, vector: JSON.parse(r.vec), payload: { doc_id: doc.id, title: doc.title, idx: r.idx, text: r.text } })),
      });
      db.prepare("UPDATE knowledge_docs SET engine = 'qdrant' WHERE id = ?").run(doc.id);
      synced += 1;
    } catch (error) {
      console.warn('[Conocimiento] No se pudo sincronizar con Qdrant:', error.message);
      break;
    }
  }
  return { synced };
}

function listDocuments(db) {
  return db.prepare(`
    SELECT d.id, d.title, d.filename, d.chunk_count AS chunks, d.engine, d.created_at AS createdAt, u.name AS uploadedBy
    FROM knowledge_docs d LEFT JOIN users u ON u.id = d.uploaded_by
    ORDER BY d.created_at DESC
  `).all();
}

function searchLocal(db, queryVector, provider, dim, limit, queryText = '') {
  const rows = db.prepare(`
    SELECT c.id, c.text, c.vec, d.title FROM knowledge_chunks c
    JOIN knowledge_docs d ON d.id = c.doc_id WHERE c.provider = ? AND c.dim = ?
  `).all(provider, dim);
  // Con embeddings locales (hashing) se refuerza el coseno con la coincidencia de palabras.
  const queryWords = provider === 'local' && queryText ? [...new Set(stemWords(queryText))] : [];
  const lexical = (text) => {
    if (!queryWords.length) return 0;
    const words = new Set(stemWords(text));
    return queryWords.filter((w) => words.has(w)).length / queryWords.length;
  };
  return rows
    .map((row) => ({ title: row.title, text: row.text, score: cosine(queryVector, JSON.parse(row.vec)) + 0.5 * lexical(row.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Busca fragmentos relevantes. Devuelve [{ title, text, score }]. */
async function search(db, query, limit = 4) {
  const q = String(query || '').trim();
  if (!q) return [];
  const { vectors, provider, dim } = await embed([q]);
  const cfg = qdrantConfig();
  if (cfg) {
    try {
      const collection = await ensureCollection(cfg, provider, dim);
      const data = await qdrant(cfg, `/collections/${collection}/points/search`, 'POST', {
        vector: vectors[0], limit, with_payload: true,
      });
      const hits = (data.result || []).map((hit) => ({ title: hit.payload.title, text: hit.payload.text, score: hit.score }));
      if (hits.length) return hits;
      // Qdrant sin resultados (p. ej. aún sin sincronizar): se usa SQLite.
    } catch (error) {
      console.warn('[Conocimiento] Qdrant falló, se usa SQLite:', error.message);
    }
  }
  return searchLocal(db, vectors[0], provider, dim, limit, q).filter((hit) => hit.score > 0.05);
}

module.exports = { syncToQdrant, addDocument, deleteDocument, listDocuments, search, isQdrantConfigured, embeddingsMode, localEmbed };
