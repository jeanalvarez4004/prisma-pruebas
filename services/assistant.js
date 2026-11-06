'use strict';

/**
 * Asistente "PRISM Bot".
 * Con GROQ_API_KEY: modelo de Groq (API compatible con OpenAI) con llamadas a herramientas
 *   - buscar_conocimiento -> documentos indexados (Qdrant o SQLite)
 *   - consultar_actividades -> actividades y cupos en SQLite
 *   - tipo_cambio -> Frankfurter
 * y respuesta progresiva (streaming). Sin la clave: responde solo con lo recuperado de los
 * documentos y las actividades, sin generar texto con un LLM.
 */
const knowledge = require('./knowledge');
const weather = require('./weather');
const { fetchJson, normalizeText, sleep } = require('./http');

const GROQ_URL = (process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const MAX_ROUNDS = 4;

const fs = require('node:fs');
const path = require('node:path');

/** Guía de funciones de PRISM: se incluye en el prompt y se indexa como documento. */
const GUIDE_FILE = path.join(__dirname, '..', 'docs-ejemplo', 'guia-prism.md');
function appGuide() {
  try { return fs.readFileSync(GUIDE_FILE, 'utf8'); } catch { return ''; }
}

const BASE_PROMPT = `Eres PRISM Bot, el asistente de PRISM, la comunidad de estudiantes de la USMP Filial Sur (Arequipa).
Responde siempre en español, de forma breve, cálida, organizada y clara.
- Usa formato Markdown limpio: negritas para destacar nombres o datos clave, y tablas Markdown elegantes cuando listes datos comparativos o actividades.
- Para preguntas sobre cómo usar PRISM o qué puede hacer la página, responde con la guía de PRISM incluida abajo.
- Para preguntas sobre reglamentos, trámites, servicios o información de la universidad usa la herramienta buscar_conocimiento y responde SOLO con lo que devuelva. Si no hay información, dilo con claridad y no inventes.
- Para preguntas sobre actividades, cupos o planes del campus usa consultar_actividades.
- Para conversiones de moneda usa tipo_cambio.
- Si preguntan por el clima, qué ponerse, o si les conviene una actividad (sobre todo al aire libre), o piden recomendaciones para hoy, usa clima_actual y recomienda según el clima real: explica brevemente el clima (temperatura, lluvia, UV, viento) y sugiere las actividades que devuelva la herramienta. No inventes datos del clima.
- No tienes herramientas para inscribir ni crear nada: indica al estudiante que pulse "Unirme" en la ficha o que lo haga desde Inicio.
- Usa el contexto del estudiante para personalizar (por ejemplo sugerir actividades de sus intereses), sin repetirlo literalmente ni inventar datos sobre él.`;

function buildSystemPrompt(userContext) {
  const guide = appGuide();
  return [BASE_PROMPT, guide ? `\n\n=== GUÍA DE PRISM ===\n${guide}` : '', userContext ? `\n\n=== CONTEXTO DEL ESTUDIANTE ===\n${userContext}` : ''].join('');
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_conocimiento',
      description: 'Busca en los documentos oficiales cargados por la administración (reglamentos, guías, FAQ).',
      parameters: { type: 'object', properties: { consulta: { type: 'string', description: 'Pregunta o términos a buscar' } }, required: ['consulta'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_actividades',
      description: 'Lista actividades del campus con categoría, lugar, fecha y cupos restantes. Puede filtrar por texto o categoría.',
      parameters: {
        type: 'object',
        properties: {
          texto: { type: 'string', description: 'Texto a buscar en título o descripción (opcional)' },
          categoria: { type: 'string', enum: ['Deporte', 'Juego', 'Estudio', 'Transporte', 'Ayuda', 'Otro'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clima_actual',
      description: 'Clima actual del Campus Arequipa (temperatura, lluvia próximas horas, UV, viento) con consejos y actividades del campus recomendadas según ese clima.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tipo_cambio',
      description: 'Convierte un monto entre monedas usando el tipo de cambio actual (Frankfurter).',
      parameters: {
        type: 'object',
        properties: {
          monto: { type: 'number' },
          origen: { type: 'string', description: 'Código ISO, p. ej. USD' },
          destino: { type: 'string', description: 'Código ISO, p. ej. EUR' },
        },
        required: ['monto', 'origen', 'destino'],
      },
    },
  },
];

function groqKey() {
  return process.env.GROQ_API_KEY || '';
}

function isConfigured() {
  return Boolean(groqKey());
}

function model() {
  return process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
}

/* --------------------------- Herramientas --------------------------- */
function queryActivities(db, { texto, categoria } = {}, limit = 6) {
  const rows = db.prepare(`
    SELECT a.id, a.title, a.description, a.category, a.location, a.event_date, a.people_needed,
           (SELECT COUNT(*) FROM activity_members m WHERE m.activity_id = a.id) AS joined
    FROM activities a ORDER BY a.created_at DESC LIMIT 200
  `).all();
  const terms = normalizeText(texto).split(/\s+/).filter((t) => t.length > 2);
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .filter((a) => (!categoria || a.category === categoria))
    .filter((a) => !a.event_date || a.event_date >= today)
    .filter((a) => {
      if (!terms.length) return true;
      const hay = normalizeText(`${a.title} ${a.description} ${a.category} ${a.location}`);
      return terms.some((t) => hay.includes(t));
    })
    .slice(0, limit)
    .map((a) => ({
      id: a.id, title: a.title, category: a.category, location: a.location, eventDate: a.event_date,
      remaining: Math.max(1 + a.people_needed - a.joined, 0),
    }));
}

async function exchangeRate({ monto, origen, destino }) {
  const from = String(origen || '').toUpperCase().slice(0, 3);
  const to = String(destino || '').toUpperCase().slice(0, 3);
  const amount = Number(monto);
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || !Number.isFinite(amount)) return { error: 'Monedas o monto no válidos.' };
  try {
    const data = await fetchJson(`https://api.frankfurter.dev/v1/latest?amount=${amount}&from=${from}&to=${to}`, {}, 8000);
    return { monto: amount, origen: from, destino: to, resultado: data.rates?.[to], fecha: data.date };
  } catch (error) {
    return { error: `No se pudo obtener el tipo de cambio (${error.message}). Frankfurter solo cubre las monedas del BCE.` };
  }
}

async function runTool(name, args, ctx) {
  if (name === 'buscar_conocimiento') {
    const hits = await knowledge.search(ctx.db, args.consulta, 4);
    for (const hit of hits) {
      if (!ctx.sources.some((s) => s.title === hit.title)) ctx.sources.push({ title: hit.title, score: Number(hit.score.toFixed(2)) });
    }
    return hits.length
      ? { fragmentos: hits.map((h) => ({ documento: h.title, texto: h.text })) }
      : { fragmentos: [], nota: 'No hay documentos relevantes cargados.' };
  }
  if (name === 'consultar_actividades') {
    const activities = queryActivities(ctx.db, args);
    for (const a of activities) if (!ctx.cards.some((c) => c.id === a.id)) ctx.cards.push(a);
    return { actividades: activities };
  }
  if (name === 'clima_actual') {
    const { data } = await weather.getWeather();
    const advice = weather.advise(data);
    const seen = new Set();
    const sugeridas = [];
    for (const categoria of advice.categoriasSugeridas) {
      for (const a of queryActivities(ctx.db, { categoria }, 3)) {
        if (!seen.has(a.id) && sugeridas.length < 4) { seen.add(a.id); sugeridas.push(a); }
      }
    }
    for (const a of sugeridas) if (!ctx.cards.some((c) => c.id === a.id)) ctx.cards.push(a);
    return {
      lugar: data.location,
      temperatura_c: data.current.temp,
      minima_c: data.daily.minTemp,
      maxima_c: data.daily.maxTemp,
      indice_uv: data.daily.uvIndex,
      viento_kmh: data.current.windSpeed,
      probabilidad_lluvia_6h: data.rain ? data.rain.probabilityNext6h : 0,
      lluvia_mm_6h: data.rain ? data.rain.mmNext6h : 0,
      condicion: advice.tipo,
      consejos: advice.consejos,
      categorias_recomendadas: advice.categoriasSugeridas,
      actividades_recomendadas: sugeridas,
      datos_de_respaldo: Boolean(data.fallback),
    };
  }
  if (name === 'tipo_cambio') return exchangeRate(args);
  return { error: `Herramienta desconocida: ${name}` };
}

/* ------------------------------ Groq SSE ----------------------------- */
async function* readGroqStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload); } catch { /* línea parcial o keep-alive */ }
    }
  }
}

async function streamGroqRound(messages, send, signal) {
  const response = await fetch(`${GROQ_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model(), messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.3, stream: true }),
    signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Groq respondió ${response.status}: ${detail.slice(0, 200)}`);
  }
  let content = '';
  const calls = [];
  for await (const chunk of readGroqStream(response)) {
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      send({ type: 'delta', text: delta.content });
    }
    for (const tc of delta.tool_calls || []) {
      const slot = calls[tc.index] || (calls[tc.index] = { id: '', name: '', arguments: '' });
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.arguments += tc.function.arguments;
    }
  }
  return { content, calls: calls.filter(Boolean) };
}

async function answerWithGroq(ctx, history, send, signal) {
  const messages = [{ role: 'system', content: buildSystemPrompt(ctx.userContext) }, ...history];
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { content, calls } = await streamGroqRound(messages, send, signal);
    if (!calls.length) return;
    messages.push({
      role: 'assistant',
      content: content || null,
      tool_calls: calls.map((c, i) => ({ id: c.id || `call_${round}_${i}`, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } })),
    });
    for (let i = 0; i < calls.length; i += 1) {
      let args = {};
      try { args = JSON.parse(calls[i].arguments || '{}'); } catch { /* argumentos vacíos */ }
      let result;
      try { result = await runTool(calls[i].name, args, ctx); } catch (error) { result = { error: error.message }; }
      messages.push({ role: 'tool', tool_call_id: calls[i].id || `call_${round}_${i}`, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  send({ type: 'delta', text: '\n\nNo pude completar la consulta. Intenta reformular tu pregunta.' });
}

/* ----------------------- Modo sin LLM (recuperación) ----------------------- */
async function answerWithoutLlm(ctx, question, send) {
  const [hits] = await Promise.all([knowledge.search(ctx.db, question, 3)]);
  const activities = queryActivities(ctx.db, { texto: question });
  const parts = [];
  const good = hits.filter((h) => h.score >= 0.12);
  if (good.length) {
    parts.push('Esto es lo que encontré en los documentos del campus:\n');
    for (const hit of good.slice(0, 2)) {
      parts.push(`• ${hit.text.replace(/\s+/g, ' ').slice(0, 420)}${hit.text.length > 420 ? '…' : ''}\n`);
      if (!ctx.sources.some((s) => s.title === hit.title)) ctx.sources.push({ title: hit.title, score: Number(hit.score.toFixed(2)) });
    }
  }
  if (activities.length) {
    parts.push(`${parts.length ? '\n' : ''}Estas actividades podrían interesarte:`);
    for (const a of activities) if (!ctx.cards.some((c) => c.id === a.id)) ctx.cards.push(a);
  }
  if (!parts.length) parts.push('No encontré información sobre eso en los documentos ni en las actividades actuales. Prueba con otras palabras o consulta a la administración.');
  parts.push('\n\n(Modo básico: configura GROQ_API_KEY para respuestas redactadas por IA.)');
  const text = parts.join('\n');
  for (let i = 0; i < text.length; i += 24) {
    send({ type: 'delta', text: text.slice(i, i + 24) });
    await sleep(12);
  }
}

/**
 * @param {{db, messages: {role, content}[], send: (event) => void, signal?: AbortSignal}} options
 * Eventos: delta, sources, cards, done, error.
 */
async function respond({ db, messages, send, signal, userContext = '' }) {
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  const last = [...history].reverse().find((m) => m.role === 'user');
  if (!last) {
    send({ type: 'error', message: 'Escribe una pregunta.' });
    return;
  }
  const ctx = { db, sources: [], cards: [], userContext };
  try {
    if (isConfigured()) {
      let streamed = false;
      const track = (event) => { if (event.type === 'delta') streamed = true; send(event); };
      try {
        await answerWithGroq(ctx, history, track, signal);
      } catch (error) {
        if (signal?.aborted || streamed) throw error;
        // Groq no disponible (clave, modelo o permisos): se responde con los documentos y actividades.
        console.error('[Asistente] Groq falló, se usa el modo básico:', error.message);
        await answerWithoutLlm(ctx, last.content, send);
      }
    } else await answerWithoutLlm(ctx, last.content, send);
    if (ctx.sources.length) send({ type: 'sources', sources: ctx.sources });
    if (ctx.cards.length) send({ type: 'cards', activities: ctx.cards });
    send({ type: 'done' });
  } catch (error) {
    if (signal?.aborted) return;
    console.error('[Asistente]', error.message);
    send({ type: 'error', message: 'El asistente no pudo responder en este momento. Inténtalo de nuevo.' });
  }
}

module.exports = { respond, isConfigured, queryActivities, TOOLS, appGuide };
