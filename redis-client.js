'use strict';

/**
 * PRISM - Módulo de Integración con Redis (Upstash REST API / Cache Distribuido)
 * Proporciona:
 * - Cache Aside Pattern (GET con fallback a BD)
 * - Invalidación de llaves (DEL / Pattern flush)
 * - Métricas de rendimiento (Hits, Misses, Ratio, Latencia)
 * - Soporte para Temp Data (Flash Messages con TTL)
 * - Tolerancia a fallos: Si Redis no está disponible, la app continúa funcionando con SQLite.
 */

const https = require('node:https');

class RedisClient {
  constructor() {
    this.url = process.env.UPSTASH_REDIS_REST_URL || '';
    this.token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
    this.enabled = Boolean(this.url && this.token);
    this.hits = 0;
    this.misses = 0;
    this.lastLatencyMs = 0;
    this.inMemoryFallback = new Map(); // Respaldo local si Redis no estuviera configurado
  }

  isConfigured() {
    if (!this.enabled && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      this.url = process.env.UPSTASH_REDIS_REST_URL;
      this.token = process.env.UPSTASH_REDIS_REST_TOKEN;
      this.enabled = true;
    }
    return this.enabled;
  }

  /**
   * Ejecuta un comando en Upstash Redis mediante su API REST HTTP
   * @param {Array<string|number>} commandArgs Ejemplo: ['GET', 'prism:feed']
   * @returns {Promise<any>}
   */
  async execute(commandArgs) {
    if (!this.isConfigured()) {
      return this._fallbackExecute(commandArgs);
    }

    const startTime = Date.now();
    try {
      const parsedUrl = new URL(this.url);
      const payload = JSON.stringify(commandArgs);

      const response = await fetch(parsedUrl.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: payload,
        signal: AbortSignal.timeout(4000), // Timeout de 4s para no bloquear
      });

      this.lastLatencyMs = Date.now() - startTime;

      if (!response.ok) {
        console.warn(`[Redis Warn] HTTP ${response.status} de Upstash: ${await response.text().catch(() => '')}`);
        return null;
      }

      const json = await response.json();
      if (json.error) {
        console.warn(`[Redis Error] ${json.error}`);
        return null;
      }

      return json.result;
    } catch (err) {
      this.lastLatencyMs = Date.now() - startTime;
      console.warn(`[Redis Failover] Falló llamada a Upstash: ${err.message}. Usando SQLite directo.`);
      return null;
    }
  }

  /**
   * Obtiene un valor parseado como JSON o string
   */
  async get(key) {
    const raw = await this.execute(['GET', key]);
    if (raw !== null && raw !== undefined) {
      this.hits++;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    this.misses++;
    return null;
  }

  /**
   * Guarda un valor con tiempo de expiración (TTL en segundos)
   */
  async set(key, value, ttlSeconds = 60) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const args = ttlSeconds > 0
      ? ['SET', key, serialized, 'EX', ttlSeconds]
      : ['SET', key, serialized];
    return await this.execute(args);
  }

  /**
   * Elimina una o más llaves del caché
   */
  async del(...keys) {
    if (!keys.length) return 0;
    return await this.execute(['DEL', ...keys]);
  }

  /**
   * Verifica conectividad mediante PING
   */
  async ping() {
    const t0 = Date.now();
    const result = await this.execute(['PING']);
    const latency = Date.now() - t0;
    return {
      ok: result === 'PONG',
      provider: this.enabled ? 'Upstash Redis Cloud' : 'In-Memory Fallback',
      latencyMs: latency,
    };
  }

  /**
   * Guarda Temp Data (Flash message) con TTL corto (ej. 30 segundos)
   */
  async setTempData(sessionId, data, ttlSeconds = 30) {
    return await this.set(`prism:temp:${sessionId}`, data, ttlSeconds);
  }

  /**
   * Obtiene y destruye el Temp Data (uso único - Flash Data)
   */
  async getTempData(sessionId) {
    const key = `prism:temp:${sessionId}`;
    const data = await this.get(key);
    if (data) {
      await this.del(key); // Se destruye tras ser leído (comportamiento Flash)
    }
    return data;
  }

  /**
   * Retorna estadísticas del caché para diagnóstico del docente
   */
  getStats() {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? ((this.hits / total) * 100).toFixed(1) + '%' : '0.0%';
    return {
      connected: this.enabled,
      provider: this.enabled ? 'Upstash Redis Cloud (REST)' : 'Local Memory Fallback',
      hits: this.hits,
      misses: this.misses,
      totalRequests: total,
      hitRate,
      lastLatencyMs: this.lastLatencyMs,
    };
  }

  /**
   * Fallback en memoria si no hay variables de Upstash
   */
  _fallbackExecute(args) {
    const cmd = String(args[0]).toUpperCase();
    if (cmd === 'PING') return 'PONG';
    if (cmd === 'GET') {
      const entry = this.inMemoryFallback.get(args[1]);
      if (entry && entry.expiresAt > Date.now()) {
        this.hits++;
        return entry.val;
      }
      this.misses++;
      return null;
    }
    if (cmd === 'SET') {
      const ttl = args[3] === 'EX' ? Number(args[4]) * 1000 : 60000;
      this.inMemoryFallback.set(args[1], { val: args[2], expiresAt: Date.now() + ttl });
      return 'OK';
    }
    if (cmd === 'DEL') {
      for (let i = 1; i < args.length; i++) this.inMemoryFallback.delete(args[i]);
      return 1;
    }
    return null;
  }
}

module.exports = new RedisClient();
