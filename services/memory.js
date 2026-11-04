'use strict';

/**
 * Memoria y aprendizaje del asistente.
 *  - Perfil por estudiante derivado de sus actividades, publicaciones y preguntas (sin LLM).
 *  - Cada respuesta se guarda en el servidor con un id; el estudiante la valora 👍/👎 por id
 *    (no puede inventar el texto de la respuesta).
 *  - Las respuestas con 👍 quedan pendientes: solo el administrador decide si pasan a ser
 *    conocimiento del asistente ("Aprendido"). Así nadie puede inyectar información falsa.
 */
const { normalizeText } = require('./http');

const STOP = new Set(('de la el los las un una unos unas y o u e en a al del por para con sin sobre que se su sus es son fue ser lo le les me mi tu te nos como mas muy ya si no pero este esta estos estas ese esa eso hay ha han he cual cuales donde cuando quien hola gracias favor puedo puedes quiero quisiera saber').split(' '));

function keywords(text) {
  return (normalizeText(text).match(/[a-z0-9]+/g) || [])
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w));
}

function topWords(questions, limit, minCount = 1) {
  const counts = new Map();
  for (const q of questions) for (const w of new Set(keywords(q))) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= minCount).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([texto, n]) => ({ texto, n }));
}

function summary(db, user) {
  const actividades = db.prepare(`
    SELECT a.category AS categoria, COUNT(*) AS n
    FROM activity_members m JOIN activities a ON a.id = m.activity_id
    WHERE m.user_id = ? GROUP BY a.category ORDER BY n DESC LIMIT 3
  `).all(user.id);
  const publicaciones = db.prepare('SELECT category AS categoria, COUNT(*) AS n FROM posts WHERE user_id = ? GROUP BY category ORDER BY n DESC LIMIT 3').all(user.id);
  const creadas = db.prepare('SELECT COUNT(*) AS n FROM activities WHERE owner_id = ?').get(user.id).n;
  const preguntas = db.prepare('SELECT question FROM assistant_logs WHERE user_id = ? ORDER BY id DESC LIMIT 60').all(user.id).map((r) => r.question);
  return {
    carrera: user.career || null,
    actividades,
    publicaciones,
    creadas,
    temas: topWords(preguntas, 5, 2),
    recientes: preguntas.slice(0, 5).reverse().map((q) => q.slice(0, 120)),
    preguntas: preguntas.length,
  };
}

/** Texto que se añade al prompt del asistente para personalizar la respuesta. */
function contextFor(db, user) {
  const s = summary(db, user);
  const lines = [`Nombre: ${String(user.name).split(/\s+/)[0]}`];
  if (s.carrera && s.carrera !== 'Sin especificar') lines.push(`Carrera: ${s.carrera}`);
  if (s.actividades.length) lines.push(`Actividades en las que participa por categoría: ${s.actividades.map((a) => `${a.categoria} (${a.n})`).join(', ')}`);
  if (s.creadas) lines.push(`Ha creado ${s.creadas} actividad(es)`);
  if (s.publicaciones.length) lines.push(`Suele publicar en: ${s.publicaciones.map((a) => a.categoria).join(', ')}`);
  if (s.temas.length) lines.push(`Temas que consulta con frecuencia: ${s.temas.map((t) => t.texto).join(', ')}`);
  if (s.recientes.length) lines.push(`Preguntas recientes: ${s.recientes.join(' | ')}`);
  return lines.join('\n');
}

function logExchange(db, { userId, question, answer }) {
  const result = db.prepare('INSERT INTO assistant_logs (user_id, question, answer, rating, approved, created_at) VALUES (?, ?, ?, 0, 0, ?)')
    .run(userId, String(question).slice(0, 500), String(answer).slice(0, 4000), new Date().toISOString());
  return Number(result.lastInsertRowid);
}

function rate(db, { id, userId, rating }) {
  const value = rating === 1 ? 1 : rating === -1 ? -1 : 0;
  return db.prepare('UPDATE assistant_logs SET rating = ? WHERE id = ? AND user_id = ?').run(value, id, userId).changes > 0;
}

function forget(db, userId) {
  db.prepare('DELETE FROM assistant_logs WHERE user_id = ?').run(userId);
}

function report(db) {
  const counts = db.prepare('SELECT rating, COUNT(*) AS n FROM assistant_logs GROUP BY rating').all();
  const resumen = { total: 0, positivas: 0, negativas: 0, sinValorar: 0 };
  for (const c of counts) {
    resumen.total += c.n;
    if (c.rating === 1) resumen.positivas += c.n;
    else if (c.rating === -1) resumen.negativas += c.n;
    else resumen.sinValorar += c.n;
  }
  const list = (where) => db.prepare(`
    SELECT l.id, l.question, l.answer, l.created_at AS createdAt, u.name AS author
    FROM assistant_logs l LEFT JOIN users u ON u.id = l.user_id
    WHERE ${where} ORDER BY l.id DESC LIMIT 20
  `).all();
  const recientes = db.prepare('SELECT question FROM assistant_logs ORDER BY id DESC LIMIT 300').all().map((r) => r.question);
  return {
    resumen,
    pendientes: list('l.rating = 1 AND l.approved = 0'),
    negativas: list('l.rating = -1'),
    frecuentes: topWords(recientes, 10),
  };
}

module.exports = { summary, contextFor, logExchange, rate, forget, report, keywords };
