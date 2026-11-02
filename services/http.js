'use strict';

/**
 * Pequeño helper para llamar APIs externas con timeout y errores legibles.
 * Usa el fetch nativo de Node >= 18 (sin dependencias adicionales).
 */
async function fetchJson(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: options.signal || controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
    }
    if (!response.ok) {
      const detail = (data && (data.message || data.error || data.status?.error || data.raw)) || response.statusText;
      const error = new Error(`HTTP ${response.status} en ${new URL(url).host}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 400));
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`Tiempo de espera agotado llamando a ${new URL(url).host}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Quita acentos y pasa a minúsculas para comparar texto en español. */
function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

module.exports = { fetchJson, sleep, normalizeText };
