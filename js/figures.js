/* Animated side-view form figures for lessons. Exposes `RepFigures.svg(id)`.
 * Each pose pair is [start, end] joint positions; the figure loops start → end → start.
 * Joints: n neck, h hip, e/w elbow/wrist, k/f knee/foot, t toe, plus e2/w2/k2/f2 for the other side.
 * Missing joints in the end pose keep their start position. Ground is y = 110.
 */
(function (global) {
  'use strict';

  const stand = { n: [100, 30], h: [100, 60], k: [100, 84], f: [100, 108], e: [101, 46], w: [102, 60] };
  const pushUp = [
    { n: [130, 78], h: [85, 91], k: [62, 98], f: [40, 105], e: [131, 92], w: [132, 106] },
    { n: [132, 96], h: [86, 100], k: [63, 103], f: [40, 106], e: [119, 90], w: [132, 106] },
  ];
  const plank = { n: [130, 86], h: [85, 94], k: [62, 99], f: [40, 104], e: [130, 106], w: [150, 106] };
  const bridge = [
    { n: [50, 104], h: [90, 104], k: [115, 84], f: [128, 107], e: [62, 106], w: [80, 106] },
    { n: [50, 104], h: [94, 84], k: [118, 80], f: [128, 107] },
  ];
  const floor = '<line class="fig-ground" x1="8" y1="110" x2="192" y2="110"/>';
  const box = (x, y, w, h) => `<rect class="fig-prop" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>`;

  const POSES = {
    'incline-pushup': { props: box(130, 80, 44, 30), pose: [
      { n: [128, 60], h: [84, 83], k: [62, 95], f: [40, 107], e: [136, 70], w: [140, 80] },
      { n: [134, 72], h: [87, 89], k: [63, 98], f: [40, 107], e: [123, 66], w: [140, 80] }] },
    'diamond-pushup': { pose: pushUp },
    'archer-pushup': { pose: pushUp },
    'decline-pushup': { props: box(20, 80, 36, 30), pose: [
      { n: [138, 74], h: [89, 76], k: [64, 77], f: [42, 78], e: [140, 90], w: [140, 106] },
      { n: [142, 94], h: [91, 86], k: [65, 82], f: [42, 78], e: [128, 90], w: [140, 106] }] },
    'pike-pushup': { pose: [
      { n: [118, 80], h: [90, 58], k: [70, 84], f: [52, 107], e: [124, 94], w: [128, 106] },
      { n: [124, 94], h: [92, 60], k: [71, 85], f: [52, 107], e: [112, 94], w: [128, 106] }] },
    squat: { pose: [
      { ...stand, e: [114, 42], w: [128, 42] },
      { n: [108, 56], h: [90, 84], k: [116, 86], f: [100, 108], e: [122, 58], w: [136, 56] }] },
    'wall-sit': { props: box(60, 10, 6, 100), pose: [
      { n: [72, 50], h: [72, 82], k: [102, 82], f: [102, 108], e: [82, 64], w: [96, 76] }] },
    'calf-raise': { pose: [
      { ...stand, f: [100, 106], t: [112, 108] },
      { n: [100, 22], h: [100, 52], k: [101, 76], f: [103, 99], e: [101, 38], w: [102, 52], t: [112, 108] }] },
    'glute-bridge': { pose: bridge },
    'single-leg-bridge': { pose: [
      { ...bridge[0], k2: [114, 86], f2: [140, 74] },
      { ...bridge[1], k2: [118, 78], f2: [144, 66] }] },
    plank: { pose: [plank] },
    'side-plank': { pose: [{ ...plank, e2: [132, 66], w2: [134, 46] }] },
    'mountain-climber': { pose: [
      { ...pushUp[0], k2: [62, 98], f2: [40, 105] },
      { ...pushUp[0], k: [108, 92], f: [94, 105], k2: [62, 98], f2: [40, 105] }] },
    'dead-bug': { pose: [
      { n: [50, 104], h: [90, 104], k: [90, 80], f: [112, 80], e: [50, 88], w: [50, 72], k2: [90, 80], f2: [112, 80], e2: [50, 88], w2: [50, 72] },
      { k: [112, 98], f: [136, 104], e: [38, 98], w: [24, 104] }] },
    'bird-dog': { pose: [
      { n: [120, 70], h: [80, 70], e: [120, 86], w: [120, 104], k: [80, 104], f: [56, 104], e2: [120, 86], w2: [120, 104], k2: [80, 104], f2: [56, 104] },
      { e2: [136, 68], w2: [152, 66], k2: [62, 70], f2: [40, 70] }] },
    superman: { pose: [
      { n: [120, 104], h: [80, 104], k: [58, 104], f: [36, 104], e: [136, 104], w: [152, 104] },
      { n: [120, 95], k: [58, 100], f: [36, 93], e: [136, 93], w: [152, 86] }] },
    'hollow-hold': { pose: [
      { n: [66, 94], h: [100, 104], k: [124, 100], f: [148, 92], e: [50, 88], w: [34, 82] }] },
    'v-up': { pose: [
      { n: [60, 104], h: [100, 104], k: [124, 104], f: [148, 104], e: [44, 104], w: [28, 104] },
      { n: [82, 74], k: [116, 84], f: [130, 62], e: [100, 66], w: [122, 60] }] },
    'wall-slide': { props: box(84, 6, 6, 104), pose: [
      { ...stand, n: [96, 30], h: [96, 60], k: [96, 84], f: [98, 108], e: [96, 44], w: [106, 32] },
      { e: [98, 16], w: [100, 2] }] },
    'chair-dip': { props: box(34, 70, 36, 40), pose: [
      { n: [76, 40], h: [80, 72], k: [112, 74], f: [114, 108], e: [72, 56], w: [68, 70] },
      { n: [78, 60], h: [82, 92], k: [112, 84], f: [114, 108], e: [64, 58], w: [68, 70] }] },
    'reverse-lunge': { pose: [
      { ...stand, k2: [100, 84], f2: [100, 108] },
      { n: [98, 46], h: [96, 76], k: [118, 80], f: [118, 108], e: [99, 62], w: [100, 76], k2: [82, 104], f2: [60, 106] }] },
    'split-squat': { props: box(20, 80, 34, 30), pose: [
      { n: [100, 28], h: [100, 58], k: [104, 82], f: [104, 108], e: [101, 44], w: [102, 58], k2: [78, 72], f2: [46, 80] },
      { n: [98, 46], h: [96, 76], k: [120, 84], f: [118, 108], e: [99, 62], w: [100, 76], k2: [76, 100], f2: [46, 80] }] },
    'assisted-pistol': { props: box(150, 8, 5, 102), pose: [
      { ...stand, e: [122, 44], w: [150, 46], k2: [112, 82], f2: [126, 98] },
      { n: [104, 68], h: [90, 98], k: [118, 90], f: [100, 108], e: [126, 70], w: [150, 72], k2: [122, 96], f2: [146, 96] }] },
    'chin-up': { props: '<line class="fig-bar" x1="60" y1="8" x2="140" y2="8"/>', pose: [
      { w: [100, 8], e: [100, 22], n: [100, 38], h: [100, 68], k: [106, 88], f: [98, 104] },
      { e: [114, 22], n: [100, 14], h: [100, 44], k: [106, 64], f: [98, 80] }] },
    burpee: { pose: [
      { ...stand, e: [104, 16], w: [106, 2] },
      pushUp[0]] },
    'door-row': { props: box(150, 8, 6, 102), pose: [
      { n: [86, 40], h: [106, 74], k: [116, 91], f: [126, 108], e: [118, 40], w: [150, 40] },
      { n: [114, 40], h: [120, 74], k: [123, 91], f: [126, 108], e: [124, 56], w: [150, 42] }] },
  };

  const SEGMENTS = [['n', 'h', 'torso'], ['n', 'e'], ['e', 'w'], ['h', 'k'], ['k', 'f'], ['f', 't'], ['n', 'e2'], ['e2', 'w2'], ['h', 'k2'], ['k2', 'f2']];
  const ANIM = 'dur="2.6s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"';
  const r1 = (n) => Math.round(n * 10) / 10;

  function head(p) {
    const dx = p.n[0] - p.h[0];
    const dy = p.n[1] - p.h[1];
    const len = Math.hypot(dx, dy) || 1;
    return [r1(p.n[0] + (dx / len) * 13), r1(p.n[1] + (dy / len) * 13)];
  }

  const anim = (attr, a, b) => (a === b ? '' : `<animate attributeName="${attr}" values="${a};${b};${a}" ${ANIM}/>`);

  /** SVG markup for an exercise's looping form figure, or '' if there isn't one. */
  function svg(id, label = '') {
    const def = POSES[id];
    if (!def) return '';
    const A = def.pose[0];
    // Holds get a gentle "breathing" bob instead of a movement.
    const B = { ...A, ...(def.pose[1] || { n: [A.n[0], A.n[1] - 2] }) };
    const lines = SEGMENTS.filter(([a, b]) => A[a] && A[b]).map(([a, b, cls]) => {
      const [p, q, pb, qb] = [A[a], A[b], B[a], B[b]];
      return `<line class="fig-${cls || 'limb'}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}">`
        + anim('x1', p[0], pb[0]) + anim('y1', p[1], pb[1]) + anim('x2', q[0], qb[0]) + anim('y2', q[1], qb[1]) + '</line>';
    });
    const [ha, hb] = [head(A), head(B)];
    const circle = `<circle class="fig-head" cx="${ha[0]}" cy="${ha[1]}" r="9">${anim('cx', ha[0], hb[0])}${anim('cy', ha[1], hb[1])}</circle>`;
    const esc = String(label).replace(/[&<>"]/g, '');
    return `<svg class="fig" viewBox="0 0 200 116" role="img" aria-label="${esc}">${floor}${def.props || ''}${lines.join('')}${circle}</svg>`;
  }

  global.RepFigures = { POSES, svg };
})(typeof self !== 'undefined' ? self : globalThis);
