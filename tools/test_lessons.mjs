// Run: node tools/test_lessons.mjs
import assert from 'node:assert/strict';
import '../js/lessons.js';

const L = globalThis.RepLessons;
const all = L.AREAS.map(([a]) => a);

// Level adapts to logged volume and feedback.
const days = (n, reps) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, exerciseId: 'pushups', reps }));
assert.equal(L.userLevel([], '2026-09-01'), 1);
assert.equal(L.userLevel(days(10, 50), '2026-09-01'), 2);
assert.equal(L.userLevel(days(10, 100), '2026-09-01'), 3);
assert.equal(L.userLevel(days(10, 100), '2026-09-01', 2), 3);
assert.equal(L.userLevel(days(10, 50), '2026-09-01', -1), 1);

// Push-ups count as chest training; legs untrained.
const trained = L.areasTrained([{ id: 'pushups', name: 'Push-ups' }], days(5, 20));
assert.equal(trained.get('chest'), 100);
assert.equal(trained.get('legs'), undefined);

// Picks only within chosen areas and level, prefers untrained areas, skips owned and done.
const legs = L.pickLesson({ areas: ['legs'], level: 1, trained });
assert.ok(legs.areas.includes('legs') && legs.level === 1);
const pick = L.pickLesson({ areas: all, level: 2, trained, owned: ['Push-ups'] });
assert.equal(pick.level, 2);
assert.ok(pick.areas.some((a) => !trained.get(a)));
const next = L.pickLesson({ areas: all, level: 2, trained, done: [{ id: pick.id }] });
assert.notEqual(next.id, pick.id);
assert.equal(L.pickLesson({ areas: ['back'], level: 1, owned: L.LIBRARY.map((e) => e.name) }), null);

// Every library entry builds a valid ~5 minute lesson.
for (const ex of L.LIBRARY) {
  assert.ok(ex.steps.length === 3 && ex.quiz.length === 4 && ex.areas.every((a) => L.AREA_LABEL[a]), ex.id);
  const steps = L.buildLesson(ex, 3);
  const quizzes = steps.filter((s) => s.type === 'quiz');
  assert.equal(quizzes.length, 2);
  quizzes.forEach((q) => assert.ok(q.options[q.answer] && new Set(q.options).size === 3, ex.id));
  assert.equal(steps.filter((s) => s.type === 'set').length, 3);
}
assert.equal(L.target(L.LIBRARY.find((e) => e.id === 'squat'), 1), 12);
assert.ok(L.target(L.LIBRARY.find((e) => e.id === 'squat'), 3) > 12);
console.log('lessons ok');

// Every exercise has an animated form figure.
await import('../js/figures.js');
for (const ex of L.LIBRARY) {
  const svg = globalThis.RepFigures.svg(ex.id, ex.name);
  assert.ok(svg.startsWith('<svg') && svg.includes('fig-head') && !svg.includes('undefined') && !svg.includes('NaN'), ex.id);
}
console.log('figures ok');
