'use strict';

/**
 * Dos capacidades de ML independientes (equivalentes a ML.NET en el proyecto de referencia):
 *  1. Análisis de sentimiento de mensajes de contacto: Naive Bayes multinomial entrenado
 *     con ml/sentimiento.csv (positivo / negativo / neutral).
 *  2. Recomendación de actividades: factorización de matrices (SGD con muestreo negativo)
 *     sobre las inscripciones usuario-actividad, combinada con afinidad por categoría y
 *     popularidad para usuarios nuevos (cold start).
 */
const fs = require('node:fs');
const path = require('node:path');
const { normalizeText } = require('./http');

/* ------------------------------------------------------------------ */
/* 1. Sentimiento                                                      */
/* ------------------------------------------------------------------ */
const NEGATIONS = new Set(['no', 'nunca', 'jamas', 'ni', 'tampoco', 'sin']);

function tokenize(text) {
  const words = normalizeText(text).match(/[a-zn0-9]+/g) || [];
  const tokens = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.length < 2 && !NEGATIONS.has(word)) continue;
    tokens.push(word);
    if (NEGATIONS.has(word) && words[i + 1]) tokens.push(`${word}_${words[i + 1]}`);
  }
  return tokens;
}

class SentimentModel {
  constructor() {
    this.labels = [];
    this.docCounts = {};
    this.wordCounts = {};
    this.totals = {};
    this.vocabulary = new Set();
    this.docs = 0;
    this.trained = false;
  }

  train(rows) {
    for (const { label, text } of rows) {
      if (!this.docCounts[label]) {
        this.labels.push(label);
        this.docCounts[label] = 0;
        this.wordCounts[label] = new Map();
        this.totals[label] = 0;
      }
      this.docCounts[label] += 1;
      this.docs += 1;
      for (const token of tokenize(text)) {
        this.vocabulary.add(token);
        this.wordCounts[label].set(token, (this.wordCounts[label].get(token) || 0) + 1);
        this.totals[label] += 1;
      }
    }
    this.trained = this.docs > 0;
    return this;
  }

  predict(text) {
    if (!this.trained) return { label: 'neutral', probability: 0, scores: {} };
    const tokens = tokenize(text);
    const V = this.vocabulary.size;
    const logs = {};
    for (const label of this.labels) {
      let score = Math.log(this.docCounts[label] / this.docs);
      for (const token of tokens) {
        const count = this.wordCounts[label].get(token) || 0;
        score += Math.log((count + 1) / (this.totals[label] + V));
      }
      logs[label] = score;
    }
    const max = Math.max(...Object.values(logs));
    let sum = 0;
    const exps = {};
    for (const label of this.labels) {
      exps[label] = Math.exp(logs[label] - max);
      sum += exps[label];
    }
    const scores = {};
    let best = this.labels[0];
    for (const label of this.labels) {
      scores[label] = exps[label] / sum;
      if (scores[label] > scores[best]) best = label;
    }
    return { label: best, probability: Number(scores[best].toFixed(4)), scores };
  }
}

let sentimentModel = null;

function loadSentimentModel(csvPath = path.join(__dirname, '..', 'ml', 'sentimiento.csv')) {
  const rows = fs.readFileSync(csvPath, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const index = line.indexOf(',');
      return index > 0 ? { label: line.slice(0, index).trim(), text: line.slice(index + 1).trim() } : null;
    })
    .filter((row) => row && row.text);
  return new SentimentModel().train(rows);
}

/** Devuelve null si el modelo no se pudo cargar (el mensaje se guarda sin clasificación). */
function analyzeSentiment(text) {
  try {
    if (!sentimentModel) sentimentModel = loadSentimentModel();
    return sentimentModel.predict(text);
  } catch (error) {
    console.warn('[ML] No se pudo clasificar el sentimiento:', error.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* 2. Clasificación de Categorías de Publicaciones (Campus USMP)       */
/* ------------------------------------------------------------------ */
let categoryModel = null;

function loadCategoryModel(csvPath = path.join(__dirname, '..', 'ml', 'categorias_posts.csv')) {
  const rows = fs.readFileSync(csvPath, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const index = line.indexOf(',');
      return index > 0 ? { label: line.slice(0, index).trim(), text: line.slice(index + 1).trim() } : null;
    })
    .filter((row) => row && row.text);
  return new SentimentModel().train(rows);
}

function classifyCategory(text) {
  try {
    if (!categoryModel) categoryModel = loadCategoryModel();
    return categoryModel.predict(text);
  } catch (error) {
    console.warn('[ML] No se pudo clasificar la categoría:', error.message);
    return null;
  }
}

/**
 * Asistente predictivo en tiempo real al redactar posts:
 * Devuelve categoría recomendada, tono emocional y alerta de convivencia/toxicidad.
 */
function predictPostAssistant(text) {
  if (!text || !text.trim()) {
    return {
      category: { label: 'General', probability: 0.5 },
      sentiment: { label: 'neutral', probability: 0.5, tone: 'Neutro' },
      isToxic: false,
      warning: null,
    };
  }

  const category = classifyCategory(text) || { label: 'General', probability: 0.5 };
  const sentiment = analyzeSentiment(text) || { label: 'neutral', probability: 0.5 };

  // Diccionario de términos hostiles / toxicidad para moderación preventiva
  const toxicTerms = ['idiota', 'estupido', 'estúpido', 'incompetente', 'porqueria', 'mierda', 'basura', 'asco', 'maldito', 'fraude', 'ratero', 'ladron'];
  const lower = text.toLowerCase();
  const hasToxicTerm = toxicTerms.some((t) => lower.includes(t));
  const isToxic = hasToxicTerm || (sentiment.label === 'negativo' && sentiment.probability >= 0.88);

  let tone = 'Neutro / Informativo';
  if (isToxic) tone = 'Alerta: Tono hostil / queja severa';
  else if (sentiment.label === 'positivo') tone = 'Positivo / Entusiasta';
  else if (sentiment.label === 'negativo') tone = 'Crítico / Disconforme';

  return {
    category: {
      label: category.label,
      probability: category.probability,
      scores: category.scores,
    },
    sentiment: {
      label: sentiment.label,
      probability: sentiment.probability,
      tone,
    },
    isToxic,
    warning: isToxic ? 'Se detectó un tono potencialmente hostil. Te sugerimos mantener un lenguaje constructivo en el campus.' : null,
  };
}

/* ------------------------------------------------------------------ */
/* 2. Recomendaciones                                                  */
/* ------------------------------------------------------------------ */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

/**
 * Entrena factores latentes con SGD. interactions: [{ u, a }] (positivos implícitos).
 * Devuelve { score(u, a) } o null si no hay datos suficientes.
 */
function trainFactorization(interactions, { factors = 8, epochs = 80, lr = 0.05, reg = 0.01, seed = 42 } = {}) {
  if (interactions.length < 2) return null;
  const rand = mulberry32(seed);
  const users = [...new Set(interactions.map((i) => i.u))];
  const items = [...new Set(interactions.map((i) => i.a))];
  if (items.length < 2) return null;
  const init = () => Array.from({ length: factors }, () => (rand() - 0.5) * 0.2);
  const P = new Map(users.map((u) => [u, init()]));
  const Q = new Map(items.map((a) => [a, init()]));
  const positives = new Set(interactions.map((i) => `${i.u}:${i.a}`));

  const step = (u, a, label) => {
    const p = P.get(u);
    const q = Q.get(a);
    let dot = 0;
    for (let f = 0; f < factors; f += 1) dot += p[f] * q[f];
    const err = label - sigmoid(dot);
    for (let f = 0; f < factors; f += 1) {
      const pf = p[f];
      p[f] += lr * (err * q[f] - reg * pf);
      q[f] += lr * (err * pf - reg * q[f]);
    }
  };

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    for (const { u, a } of interactions) {
      step(u, a, 1);
      for (let n = 0; n < 2; n += 1) {
        const negative = items[Math.floor(rand() * items.length)];
        if (!positives.has(`${u}:${negative}`)) step(u, negative, 0);
      }
    }
  }

  return {
    knowsUser: (u) => P.has(u),
    score(u, a) {
      const p = P.get(u);
      const q = Q.get(a);
      if (!p || !q) return null;
      let dot = 0;
      for (let f = 0; f < factors; f += 1) dot += p[f] * q[f];
      return sigmoid(dot);
    },
  };
}

let cachedModel = { signature: '', model: null };

function interactionSignature(interactions) {
  let hash = interactions.length;
  for (const { u, a } of interactions) hash = (Math.imul(hash, 31) + u * 7919 + a) >>> 0;
  return `${interactions.length}:${hash}`;
}

/**
 * @param {object} input
 *  - userId
 *  - interactions: [{ u, a }] todas las inscripciones
 *  - activities: [{ id, ownerId, category, joined, total, eventDate }]
 * Devuelve [{ activityId, score, reason }] ordenado.
 */
function recommendActivities({ userId, interactions, activities, limit = 5, today = new Date().toISOString().slice(0, 10) }) {
  const mine = new Set(interactions.filter((i) => i.u === userId).map((i) => i.a));
  const byId = new Map(activities.map((a) => [a.id, a]));
  const categoryCount = {};
  for (const id of mine) {
    const activity = byId.get(id);
    if (activity) categoryCount[activity.category] = (categoryCount[activity.category] || 0) + 1;
  }
  const history = mine.size;

  const signature = interactionSignature(interactions);
  if (cachedModel.signature !== signature) {
    cachedModel = { signature, model: trainFactorization(interactions) };
  }
  const model = cachedModel.model;

  const candidates = activities.filter((a) => (
    !mine.has(a.id) && a.ownerId !== userId && a.joined < a.total && (!a.eventDate || a.eventDate >= today)
  ));
  if (!candidates.length) return [];

  const raw = candidates.map((a) => (model && model.knowsUser(userId) ? model.score(userId, a.id) : null));
  const known = raw.filter((v) => v !== null);
  const min = known.length ? Math.min(...known) : 0;
  const max = known.length ? Math.max(...known) : 0;

  const ranked = candidates.map((a, index) => {
    const mf = raw[index] === null || max === min ? 0 : (raw[index] - min) / (max - min);
    const affinity = history ? (categoryCount[a.category] || 0) / history : 0;
    const popularity = a.total > 0 ? a.joined / a.total : 0;
    const score = history
      ? 0.5 * mf + 0.3 * affinity + 0.2 * popularity
      : 0.8 * popularity + 0.2 * (a.joined > 1 ? 1 : 0);
    let reason = 'Popular en el campus';
    if (history && affinity >= 0.34) reason = `Porque te sumaste antes a actividades de ${a.category}`;
    else if (history && mf >= 0.6) reason = 'Estudiantes con intereses parecidos a los tuyos se sumaron';
    return { activityId: a.id, score: Number(score.toFixed(4)), reason };
  });
  ranked.sort((x, y) => y.score - x.score);
  return ranked.slice(0, limit);
}

module.exports = {
  tokenize, SentimentModel, loadSentimentModel, analyzeSentiment,
  loadCategoryModel, classifyCategory, predictPostAssistant,
  trainFactorization, recommendActivities,
};
