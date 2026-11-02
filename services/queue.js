'use strict';

/**
 * Cola de mensajes para registrar inscripciones en segundo plano.
 *  - Con CLOUDAMQP_URL (amqps://usuario:clave@host/vhost): usa CloudAMQP (RabbitMQ)
 *    a través de su API HTTP de administración, sin dependencias nativas.
 *  - Sin configuración: cola en memoria dentro del mismo proceso.
 * El consumidor corre en el mismo proceso que el servidor web (igual que el
 * BackgroundService del proyecto de referencia).
 */
const { fetchJson, sleep } = require('./http');

const QUEUE = process.env.QUEUE_NAME || 'prism.inscripciones';
const POLL_MS = Number(process.env.QUEUE_POLL_MS) || 1500;
const MAX_ATTEMPTS = 3;

const memory = [];
let handler = null;
let running = false;
let started = false;
let declared = false;
let lastError = null;

function amqpConfig() {
  const raw = process.env.CLOUDAMQP_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const vhost = decodeURIComponent(url.pathname.replace(/^\//, '')) || '/';
    return {
      api: `https://${url.hostname}/api`,
      vhost: encodeURIComponent(vhost),
      auth: `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`,
    };
  } catch {
    console.warn('[Cola] CLOUDAMQP_URL no es una URL válida; se usa la cola en memoria.');
    return null;
  }
}

function mode() {
  return amqpConfig() ? 'cloudamqp' : 'memory';
}

function call(cfg, path, method, body) {
  return fetchJson(`${cfg.api}${path}`, {
    method,
    headers: { Authorization: cfg.auth, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function declare(cfg) {
  if (declared) return;
  await call(cfg, `/queues/${cfg.vhost}/${encodeURIComponent(QUEUE)}`, 'PUT', { durable: true, auto_delete: false });
  declared = true;
}

async function publishRemote(cfg, message) {
  await declare(cfg);
  const result = await call(cfg, `/exchanges/${cfg.vhost}/amq.default/publish`, 'POST', {
    properties: { delivery_mode: 2, content_type: 'application/json' },
    routing_key: QUEUE,
    payload: JSON.stringify(message),
    payload_encoding: 'string',
  });
  if (!result || result.routed === false) throw new Error('CloudAMQP no enrutó el mensaje a la cola.');
}

/** Publica un mensaje. Devuelve el transporte realmente usado. */
async function publish(message) {
  const cfg = amqpConfig();
  if (cfg) {
    try {
      await publishRemote(cfg, message);
      lastError = null;
      return 'cloudamqp';
    } catch (error) {
      lastError = error.message;
      console.warn('[Cola] CloudAMQP no disponible, se usa memoria:', error.message);
    }
  }
  memory.push(message);
  scheduleMemory();
  return 'memory';
}

async function runHandler(message) {
  const attempts = (message.attempts || 0) + 1;
  try {
    await handler({ ...message, attempts });
  } catch (error) {
    console.error(`[Cola] Error procesando mensaje (intento ${attempts}):`, error.message);
    if (attempts < MAX_ATTEMPTS) {
      // Reencola igual que el consumidor de referencia ante errores de procesamiento.
      await publish({ ...message, attempts });
    }
  }
}

function scheduleMemory() {
  if (!handler || running) return;
  running = true;
  setImmediate(async () => {
    try {
      while (memory.length) await runHandler(memory.shift());
    } finally {
      running = false;
    }
  });
}

async function pollRemote() {
  const cfg = amqpConfig();
  while (started) {
    let idle = true;
    if (cfg && handler) {
      try {
        await declare(cfg);
        const messages = await call(cfg, `/queues/${cfg.vhost}/${encodeURIComponent(QUEUE)}/get`, 'POST', {
          count: 1, ackmode: 'ack_requeue_false', encoding: 'auto',
        });
        if (Array.isArray(messages) && messages.length) {
          idle = false;
          let payload = null;
          try { payload = JSON.parse(messages[0].payload); } catch { /* mensaje inválido: se descarta */ }
          if (payload) await runHandler(payload);
        }
        lastError = null;
      } catch (error) {
        lastError = error.message;
        console.warn('[Cola] Error consultando CloudAMQP:', error.message);
      }
    }
    if (idle) await sleep(POLL_MS);
  }
}

/** Inicia el consumidor. `fn` recibe cada mensaje y puede lanzar para reencolar. */
function startConsumer(fn) {
  handler = fn;
  if (started) return;
  started = true;
  if (amqpConfig()) pollRemote();
  scheduleMemory();
}

function stopConsumer() {
  started = false;
}

function status() {
  return { mode: mode(), queue: QUEUE, pendingInMemory: memory.length, lastError };
}

module.exports = { publish, startConsumer, stopConsumer, status, mode };
