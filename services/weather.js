'use strict';

const dns = require('node:dns');
if (dns.setDefaultResultOrder) {
  try { dns.setDefaultResultOrder('ipv4first'); } catch {}
}

/**
 * Clima del Campus Arequipa (Open-Meteo, sin API key) con caché de 10 minutos.
 * Lo usan la ruta /api/weather (widget) y el asistente (herramienta clima_actual).
 */
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=-16.399&longitude=-71.5375'
  + '&daily=temperature_2m_max,temperature_2m_min,uv_index_max,uv_index_clear_sky_max,moon_phase'
  + '&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,rain'
  + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m'
  + '&timezone=auto';
const TTL = 10 * 60 * 1000;

let cached = null;
let cachedAt = 0;
let lastOk = null; // true / false según el último intento

function getWeatherCondition(code, isNight = false) {
  const c = Number(code);
  switch (c) {
    case 0:
      return { condition: 'Cielo despejado', icon: isNight ? '🌙' : '☀️' };
    case 1:
      return { condition: 'Mayormente despejado', icon: isNight ? '🌤️' : '🌤️' };
    case 2:
      return { condition: 'Parcialmente nublado', icon: '⛅' };
    case 3:
      return { condition: 'Intervalos nubosos', icon: '☁️' };
    case 45:
    case 48:
      return { condition: 'Neblina', icon: '🌫️' };
    case 51:
    case 53:
    case 55:
      return { condition: 'Llovizna leve', icon: '🌦️' };
    case 61:
    case 63:
    case 65:
      return { condition: 'Lluvia', icon: '🌧️' };
    case 71:
    case 73:
    case 75:
      return { condition: 'Nevada ligera', icon: '🌨️' };
    case 80:
    case 81:
    case 82:
      return { condition: 'Chubascos', icon: '🌧️' };
    case 95:
    case 96:
    case 99:
      return { condition: 'Tormenta eléctrica', icon: '⛈️' };
    default:
      return { condition: isNight ? 'Noche despejada' : 'Intervalos nubosos', icon: isNight ? '🌙' : '⛅' };
  }
}

function fallback() {
  const hours = new Date().getHours();
  const isNight = hours >= 18 || hours < 6;
  const cond = getWeatherCondition(3, isNight);

  // Estimación horaria realista para Arequipa cuando Open-Meteo sufra rate-limit temporal (429)
  let estTemp = 17.6;
  let estApparent = 16.0;
  let estHum = 54;
  if (hours >= 11 && hours < 16) {
    estTemp = 21.4;
    estApparent = 19.2;
    estHum = 42;
  } else if (hours >= 19 || hours < 7) {
    estTemp = 13.5;
    estApparent = 12.0;
    estHum = 65;
  }

  return {
    location: 'Arequipa, Perú (Campus USMP)',
    elevation: 2342,
    current: {
      temp: estTemp,
      apparentTemp: estApparent,
      humidity: estHum,
      unit: '°C',
      weatherCode: 3,
      condition: cond.condition,
      icon: cond.icon,
      pressure: 1015.6,
      windSpeed: 9.5,
      windUnit: 'km/h',
      windDirection: 295,
      windGusts: 32,
    },
    daily: { minTemp: 12.4, maxTemp: 22.3, uvIndex: 10.75, moonPhase: 0.91 },
    rain: { probabilityNext6h: 30, mmNext6h: 0 },
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

/** Devuelve { data, cache: 'HIT' | 'MISS' | 'STALE' | 'FALLBACK' }. Si forceFresh = true, omite la caché. */
async function getWeather({ forceFresh = false } = {}) {
  const nowMs = Date.now();
  if (!forceFresh && cached && nowMs - cachedAt < TTL) return { data: cached, cache: 'HIT' };
  try {
    const response = await fetch(URL, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'PRISM-USMP-CampusApp/1.0 (https://github.com/jeanalvarez4004/prisma-pruebas)',
        'Accept': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
    const d = await response.json();
    const hours = new Date().getHours();
    const isNight = hours >= 18 || hours < 6;
    const wCode = d.current?.weather_code !== undefined ? d.current.weather_code : 3;
    const cond = getWeatherCondition(wCode, isNight);

    cached = {
      location: 'Arequipa, Perú (Campus USMP)',
      elevation: d.elevation || 2342,
      current: {
        time: d.current ? d.current.time : new Date().toISOString(),
        temp: d.current ? Math.round(d.current.temperature_2m * 10) / 10 : 19.4,
        apparentTemp: d.current?.apparent_temperature !== undefined ? Math.round(d.current.apparent_temperature * 10) / 10 : 17.4,
        humidity: d.current?.relative_humidity_2m !== undefined ? Math.round(d.current.relative_humidity_2m) : 48,
        unit: d.current_units ? d.current_units.temperature_2m : '°C',
        weatherCode: wCode,
        condition: cond.condition,
        icon: cond.icon,
        pressure: d.current ? (d.current.surface_pressure || d.current.pressure_msl || 1015.6) : 1015.6,
        windSpeed: d.current ? Math.round(d.current.wind_speed_10m * 10) / 10 : 10.3,
        windUnit: d.current_units ? d.current_units.wind_speed_10m : 'km/h',
        windDirection: d.current ? d.current.wind_direction_10m : 295,
        windGusts: d.current ? d.current.wind_gusts_10m : null,
      },
      daily: {
        minTemp: d.daily ? d.daily.temperature_2m_min[0] : 12.4,
        maxTemp: d.daily ? d.daily.temperature_2m_max[0] : 22.3,
        uvIndex: d.daily ? (d.daily.uv_index_max?.[0] ?? d.daily.uv_index_clear_sky_max?.[0] ?? 10.75) : 10.75,
        moonPhase: d.daily ? d.daily.moon_phase[0] : 0.91,
      },
      rain: nextHours(d.hourly, d.current && d.current.time),
      updatedAt: new Date().toISOString(),
    };
    cachedAt = nowMs;
    lastOk = true;
    return { data: cached, cache: 'MISS' };
  } catch (error) {
    console.error('[Weather] Falló fetch Open-Meteo:', error && (error.stack || error.message));
    lastOk = false;
    if (cached) return { data: cached, cache: 'STALE' };
    const fb = fallback();
    fb.serverError = error ? (error.message || String(error)) : 'unknown';
    return { data: fb, cache: 'FALLBACK' };
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

module.exports = { getWeather, advise, status, getWeatherCondition };
