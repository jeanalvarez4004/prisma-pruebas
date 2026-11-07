'use strict';
/**
 * services/moderation.js
 * Moderación de texto para PRISM.
 *
 * Capa 1: lista local (rápida, gratis, funciona sin internet ni API key).
 * Capa 2: OpenAI Moderation API (omni-moderation-latest, gratuita, multilingüe).
 *
 * Si OPENAI_API_KEY no existe o la API falla, se usa solo la capa 1
 * (mismo criterio de failover que Redis, Algolia, etc.).
 *
 * Requiere Node 18+ (fetch nativo).
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const TIMEOUT_MS = 4000;

// Umbrales por categoría (0 a 1). Más bajo = más estricto.
const THRESHOLDS = {
  sexual: 0.5,
  'sexual/minors': 0.01,
  hate: 0.5,
  'hate/threatening': 0.3,
  harassment: 0.6,
  'harassment/threatening': 0.3,
  violence: 0.7,
  'violence/graphic': 0.4,
  'self-harm': 0.5,
  'self-harm/intent': 0.3,
  'self-harm/instruction': 0.3,
  illicit: 0.7,
  'illicit/violent': 0.4,
};

// Lista local mínima en español. AMPLÍALA según lo que veas en tu campus.
const BLOCKLIST = [
  'puta', 'puto', 'putas', 'putos', 'mierda', 'cojudo', 'cojuda', 'huevon', 'huevona',
  'conchatumadre', 'ctm', 'csm', 'verga', 'porno', 'porn', 'follar', 'pichula', 'pajero',
  'pendejo', 'pendeja', 'marica', 'maricon', 'zorra', 'malparido', 'hijueputa',
  'gilipollas', 'imbecil', 'idiota', 'estupido', 'estupida', 'retrasado', 'retrasada',
  'te voy a matar', 'voy a matarte', 'suicidate', 'nudes',
  // Jerga peruana
  'gampi', 'conchasumadre', 'conchasumare', 'conchatumare', 'ctmr', 'csmr', 'chucha', 'chuchatumare',
  'webon', 'webona', 'huevonazo', 'cojudazo', 'cojudaza', 'rosquete', 'cabro', 'cabrazo',
  'pichulin', 'mongol', 'mongolo', 'tarado', 'tarada', 'baboso', 'babosa', 'lacra', 'perra',
  'malnacido', 'malnacida', 'carajo', 'jodete', 'chupapinga', 'pinga', 'cachero', 'cachera',
  'fuck', 'shit', 'bitch', 'dick', 'pussy', 'nigger', 'faggot',
  // Palabras como "sexo", "violación", "desnudo" se dejan fuera a propósito:
  // pueden ser legítimas (salud, derechos). Las evalúa OpenAI por contexto.
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')            // quita tildes
    .replace(/[013457@$]/g, (c) => LEET[c] || c)   // leetspeak
    .replace(/(.)\1{2,}/g, '$1$1')               // "puuuuta" -> "puuta"
    .replace(/[^a-z0-9\s]/g, ' ')                // símbolos -> espacio
    .replace(/\s+/g, ' ')
    .trim();
}

// Para detectar "p u t a" o "p.u.t.a"
function collapsed(text) {
  return normalize(text).replace(/\s/g, '');
}

// Une letras sueltas consecutivas: "p u t a" -> "puta" (mínimo 3 letras seguidas)
function joinSpelled(norm) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 3) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const tok of norm.split(' ')) {
    if (tok.length === 1) run.push(tok);
    else { flush(); out.push(tok); }
  }
  flush();
  return out.join(' ');
}

function localCheck(text) {
  const base = normalize(text);
  const norm = ` ${base} ${joinSpelled(base)} `;
  const flat = collapsed(text);
  for (const word of BLOCKLIST) {
    const w = normalize(word);
    if (!w) continue;
    // Palabra completa (evita falsos positivos tipo "computadora")
    // También plural ("gampis", "cojudos", "maricones")
    if (norm.includes(` ${w} `) || norm.includes(` ${w}s `) || norm.includes(` ${w}es `)) return word;
    // Palabras largas escritas separadas por espacios/puntos
    if (w.length >= 5 && flat.includes(w.replace(/\s/g, ''))) return word;
  }
  return null;
}

async function openaiCheck(text) {
  if (!OPENAI_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data.results && data.results[0];
    if (!result) return null;

    for (const [cat, score] of Object.entries(result.category_scores || {})) {
      const limit = THRESHOLDS[cat];
      if (limit !== undefined && score >= limit) return cat;
    }
    return result.flagged ? 'flagged' : null;
  } catch (err) {
    console.warn('[Moderation Failover] OpenAI no disponible:', err.message);
    return undefined; // undefined = la API falló (distinto de null = limpio)
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} text
 * @returns {Promise<{ok: boolean, reason?: string, source?: string}>}
 */
async function moderateText(text) {
  const value = String(text || '').trim();
  if (!value) return { ok: true };

  const local = localCheck(value);
  if (local) return { ok: false, reason: 'lenguaje inapropiado', source: 'local' };

  const remote = await openaiCheck(value);
  if (remote) return { ok: false, reason: remote, source: 'openai' };

  return { ok: true, source: remote === undefined || !OPENAI_KEY ? 'local-only' : 'openai' };
}

/**
 * Middleware Express. Revisa los campos de texto indicados en req.body.
 * Uso: app.post('/api/posts', requireAuth, moderateBody(['content']), handler)
 */
function moderateBody(fields) {
  return async (req, res, next) => {
    try {
      for (const f of fields) {
        const value = req.body && req.body[f];
        if (typeof value !== 'string' || !value.trim()) continue;
        const verdict = await moderateText(value);
        if (!verdict.ok) {
          return res.status(422).json({
            error: 'Tu texto contiene contenido que no está permitido en PRISM. Edítalo e inténtalo de nuevo.',
            code: 'contenido_no_permitido',
            field: f,
          });
        }
      }
      return next();
    } catch (err) {
      console.error('[Moderation] error inesperado:', err);
      return next(); // no bloquear a los usuarios por un fallo interno
    }
  };
}

// Palabras sueltas de la lista, ya normalizadas, para tapar contenido antiguo.
const SINGLE_WORDS = new Set(BLOCKLIST.map(normalize).filter((w) => w && !w.includes(' ')));

function isBadToken(token) {
  const w = normalize(token).replace(/\s/g, '');
  if (!w) return false;
  if (SINGLE_WORDS.has(w)) return true;
  if (w.endsWith('es') && SINGLE_WORDS.has(w.slice(0, -2))) return true;
  if (w.endsWith('s') && SINGLE_WORDS.has(w.slice(0, -1))) return true;
  return false;
}

/**
 * Tapa groserías en texto ya guardado (publicado antes de existir el filtro).
 * "comer gampi" -> "comer g****". No cambia la base de datos, solo lo que se muestra.
 */
function maskText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(/[^\s.,;:!?¡¿()"'«»]+/g, (token) =>
    isBadToken(token) ? token[0] + '*'.repeat(Math.max(token.length - 1, 3)) : token
  );
}

module.exports = { moderateText, moderateBody, localCheck, normalize, maskText };