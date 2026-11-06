'use strict';
// Prueba rápida de los modelos de ML (sin dependencias): npm run test:ml
const assert = require('node:assert');
const ml = require('../services/ml');

const cases = [
  ['Me encanta la plataforma, excelente trabajo', 'positivo'],
  ['Es un desastre, no funciona nada y estoy molesto', 'negativo'],
  ['Quisiera saber a qué hora empieza la actividad', 'neutral'],
];
for (const [text, expected] of cases) {
  const result = ml.analyzeSentiment(text);
  assert.strictEqual(result.label, expected, `"${text}" -> ${result.label}`);
  console.log(`✔ sentimiento: ${expected.padEnd(8)} (${Math.round(result.probability * 100)}%)  ${text}`);
}

const catCases = [
  ['Quién se apunta para una pichanga de fútbol en la cancha del campus', 'Comunidad'],
  ['Alguien tiene los ejercicios resueltos de Cálculo y Álgebra para el examen', 'Académico'],
  ['A qué hora cierran la biblioteca de la universidad hoy viernes', 'General'],
];
for (const [text, expected] of catCases) {
  const pred = ml.predictPostAssistant(text);
  assert.strictEqual(pred.category.label, expected, `"${text}" -> ${pred.category.label}`);
  console.log(`✔ categoría:   ${expected.padEnd(9)} (${Math.round(pred.category.probability * 100)}%)  ${text}`);
}

const interactions = [];
for (let u = 1; u <= 12; u += 1) (u % 2 ? [1, 2, 3] : [4, 5, 6]).forEach((a) => interactions.push({ u, a }));
const activities = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, ownerId: 99, category: id <= 3 || id === 7 ? 'Deporte' : 'Estudio', joined: 2, total: 6, eventDate: null }));
const ranked = ml.recommendActivities({ userId: 1, interactions: interactions.filter((i) => !(i.u === 1 && i.a === 3)), activities });
assert.strictEqual(ranked[0].activityId, 3);
console.log('✔ recomendación: la actividad que comparte el grupo de intereses queda primera');
