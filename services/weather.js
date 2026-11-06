'use strict';

/**
 * Clima del Campus Arequipa (Open-Meteo, sin API key) con caché de 10 minutos.
 * Lo usan la ruta /api/weather (widget) y el asistente (herramienta clima_actual).
 */
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=-16.399&longitude=-71.5375'
  + '&daily=temperature_2m_max,temperature_2m_min,uv_index_clear_sky_max,moon_phase'
  + '&hourly=temperature_2m,precipitation_probability,rain'
  + '&current=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
  + '&timezone=auto';
const TTL = 10 * 60 * 1000;

let cached = null;
let cachedAt = 0;
let lastOk = null; // true / false según el último intento

function fallback() {
  return {
    location: 'Arequipa, Perú (Campus USMP)',
    elevation: 2342,
    current: { temp: 15.0, unit: '°C', pressure: 1016.1, windSpeed: 2.8, windUnit: 'km/h', windDirection: 105 },
    daily: { minTemp: 14.3, maxTemp: 24.5, uvIndex: 10.8, moonPhase: 0.88 },
    rain: { probabilityNext6h: 0, mmNext6h: 0 },
    updatedAt: new Date().toISOString(),
    fallback: true,
  };
}

function nextHours(hourly, currentTime, count = 6) {
  const times = (hourly && hourly.time) || [];
  let start = times.findIndex((t) => t >= String(currentTime || '').slice(0, 13));
  if (start < 0) start = 0;
  const slice = (key) => ((hourly && hourly[key]) || []).slice(start, start + count).filter((v) => typeof v === 'number');
  const probs = slice('precipitation_probability');
  const rain = slice('rain');
  return {
    probabilityNext6h: probs.length ? Math.max(...probs) : 0,
    mmNext6h: Number(rain.reduce((a, b) => a + b, 0).toFixed(1)),
  };
}

/** Devuelve { data, cache: 'HIT' | 'MISS' | 'STALE' | 'FALLBACK' }. */
async function getWeather() {
  const nowMs = Date.now();
  if (cached && nowMs - cachedAt < TTL) return { data: cached, cache: 'HIT' };
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
    const d = await response.json();
    cached = {
      location: 'Arequipa, Perú (Campus USMP)',
      elevation: d.elevation || 2342,
      current: {
        time: d.current ? d.current.time : new Date().toISOString(),
        temp: d.current ? Math.round(d.current.temperature_2m * 10) / 10 : 15,
        unit: d.current_units ? d.current_units.temperature_2m : '°C',
        pressure: d.current ? d.current.pressure_msl : 1016,
        windSpeed: d.current ? d.current.wind_speed_10m : 3,
        windUnit: d.current_units ? d.current_units.wind_speed_10m : 'km/h',
        windDirection: d.current ? d.current.wind_direction_10m : 100,
        windGusts: d.current ? d.current.wind_gusts_10m : null,
      },
      daily: {
        minTemp: d.daily ? d.daily.temperature_2m_min[0] : 14,
        maxTemp: d.daily ? d.daily.temperature_2m_max[0] : 24,
        uvIndex: d.daily ? d.daily.uv_index_clear_sky_max[0] : 10.8,
        moonPhase: d.daily ? d.daily.moon_phase[0] : 0.88,
      },
      rain: nextHours(d.hourly, d.current && d.current.time),
      updatedAt: new Date().toISOString(),
    };
    cachedAt = nowMs;
    lastOk = true;
    return { data: cached, cache: 'MISS' };
  } catch (error) {
    lastOk = false;
    if (cached) return { data: cached, cache: 'STALE' };
    return { data: fallback(), cache: 'FALLBACK' };
  }
}

/** Reglas simples para recomendar qué hacer según el clima de hoy. */
function advise(weather) {
  const temp = weather.current.temp;
  const wind = weather.current.windSpeed || 0;
  const uv = weather.daily.uvIndex || 0;
  const rainProb = (weather.rain && weather.rain.probabilityNext6h) || 0;
  const rainMm = (weather.rain && weather.rain.mmNext6h) || 0;
  const tips = [];
  let categorias;
  let tipo;

  if (rainProb >= 50 || rainMm >= 0.5) {
    tipo = 'lluvia';
    categorias = ['Estudio', 'Juego', 'Ayuda'];
    tips.push('Hay probabilidad de lluvia: conviene una actividad bajo techo.');
  } else if (wind >= 30) {
    tipo = 'viento';
    categorias = ['Estudio', 'Juego', 'Ayuda'];
    tips.push('Hay viento fuerte: mejor evitar deportes al aire libre.');
  } else if (temp <= 12) {
    tipo = 'frio';
    categorias = ['Estudio', 'Juego', 'Otro'];
    tips.push('Hace frío: abrígate o elige una actividad en un ambiente cerrado.');
  } else {
    tipo = temp >= 24 ? 'calor' : 'agradable';
    categorias = ['Deporte', 'Juego', 'Otro'];
    tips.push(temp >= 24 ? 'Hace calor: lleva agua y prefiere las primeras horas o la tarde.' : 'El clima está agradable para actividades al aire libre.');
  }
  if (uv >= 8) tips.push(`El índice UV es ${uv} (muy alto en Arequipa): usa bloqueador y evita el sol directo entre las 11:00 y las 15:00.`);
  return { tipo, categoriasSugeridas: categorias, consejos: tips };
}

function status() {
  return { ok: lastOk, cachedAt: cachedAt || null };
}

module.exports = { getWeather, advise, status };
