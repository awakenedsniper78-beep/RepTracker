/* RepTracker lessons — exercise library + lesson picking/building. Pure logic, no DOM.
 * Exposes `RepLessons`. Level: 1 beginner, 2 intermediate, 3 advanced.
 */
(function (global) {
  'use strict';

  const AREAS = [
    ['shoulders', 'Shoulders'], ['chest', 'Chest'], ['arms', 'Arms'], ['core', 'Core'],
    ['back', 'Back'], ['glutes', 'Glutes'], ['legs', 'Legs'],
  ];
  const AREA_LABEL = Object.fromEntries(AREAS);
  const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

  // steps: how to do it · tip: most common mistake · quiz: [question, right, wrong, wrong]
  const LIBRARY = [
    { id: 'incline-pushup', name: 'Incline push-ups', areas: ['chest', 'arms', 'shoulders'], level: 1, unit: 'reps', base: 10,
      steps: ['Put your hands shoulder-width apart on a sturdy bench, table or counter.', 'Walk your feet back until your body is one straight line.', 'Lower your chest to the edge, then press back up.'],
      tip: 'Keep your hips in line — don\'t let them sag or pike up.',
      quiz: ['What should your body look like during the rep?', 'One straight line, head to heels', 'Hips piked up high', 'Lower back sagging down'] },
    { id: 'squat', name: 'Bodyweight squats', areas: ['legs', 'glutes'], level: 1, unit: 'reps', base: 12,
      steps: ['Stand with feet about shoulder-width apart, toes slightly out.', 'Push your hips back and bend your knees like sitting into a chair.', 'Go until thighs are about parallel, then drive up through your heels.'],
      tip: 'Keep your heels down and knees tracking over your toes.',
      quiz: ['Where should your weight be as you stand up?', 'Through your whole foot, heels down', 'On your tiptoes', 'Leaning on your knees'] },
    { id: 'glute-bridge', name: 'Glute bridges', areas: ['glutes', 'legs', 'core'], level: 1, unit: 'reps', base: 12,
      steps: ['Lie on your back, knees bent, feet flat near your hips.', 'Squeeze your glutes and lift your hips until knees, hips and shoulders line up.', 'Pause a second at the top, then lower slowly.'],
      tip: 'Lift with your glutes, not by arching your lower back.',
      quiz: ['What should do the lifting?', 'Squeezing your glutes', 'Arching your lower back', 'Pushing with your hands'] },
    { id: 'wall-sit', name: 'Wall sit', areas: ['legs', 'glutes'], level: 1, unit: 'sec', base: 30,
      steps: ['Stand with your back flat against a wall.', 'Slide down until your knees are bent about 90°.', 'Hold there, breathing steadily, back against the wall.'],
      tip: 'Knees stay above your ankles, not past your toes.',
      quiz: ['How bent should your knees be?', 'About 90°, like sitting in a chair', 'Barely bent', 'All the way down to the floor'] },
    { id: 'calf-raise', name: 'Calf raises', areas: ['legs'], level: 1, unit: 'reps', base: 15,
      steps: ['Stand tall, feet hip-width, holding a wall for balance if needed.', 'Rise up onto the balls of your feet as high as you can.', 'Lower slowly until your heels touch down.'],
      tip: 'Go slow on the way down — bouncing takes the work away.',
      quiz: ['What makes calf raises harder (in a good way)?', 'Lowering slowly and controlled', 'Bouncing quickly', 'Keeping heels on the floor'] },
    { id: 'plank', name: 'Plank', areas: ['core', 'shoulders'], level: 1, unit: 'sec', base: 30,
      steps: ['Forearms on the floor, elbows under your shoulders.', 'Step your feet back so your body is a straight line.', 'Squeeze your glutes and brace your stomach. Breathe.'],
      tip: 'Don\'t hold your breath — slow, steady breaths.',
      quiz: ['Where should your elbows be?', 'Right under your shoulders', 'Out in front of your head', 'Tucked by your hips'] },
    { id: 'dead-bug', name: 'Dead bugs', areas: ['core'], level: 1, unit: 'reps', base: 8, note: 'per side',
      steps: ['Lie on your back, arms up, knees bent over your hips.', 'Press your lower back into the floor.', 'Slowly lower the opposite arm and leg, return, switch sides.'],
      tip: 'Your lower back stays glued to the floor the whole time.',
      quiz: ['What\'s the key thing to keep still?', 'Lower back pressed into the floor', 'Your head off the ground', 'Both legs straight'] },
    { id: 'bird-dog', name: 'Bird dogs', areas: ['core', 'back'], level: 1, unit: 'reps', base: 8, note: 'per side',
      steps: ['Start on hands and knees, hands under shoulders.', 'Reach one arm forward and the opposite leg back.', 'Hold a second without tilting your hips, return, switch.'],
      tip: 'Imagine a glass of water on your lower back — don\'t spill it.',
      quiz: ['Which arm and leg move together?', 'Opposite arm and leg', 'Same-side arm and leg', 'Both arms, then both legs'] },
    { id: 'superman', name: 'Supermans', areas: ['back', 'glutes'], level: 1, unit: 'reps', base: 10,
      steps: ['Lie face down, arms stretched out in front.', 'Lift your arms, chest and legs a few inches off the floor.', 'Hold two seconds, then lower with control.'],
      tip: 'Keep your neck neutral — look at the floor, not forward.',
      quiz: ['Where should you look?', 'Down at the floor', 'Straight ahead', 'Up at the ceiling'] },
    { id: 'wall-slide', name: 'Wall slides', areas: ['shoulders', 'back'], level: 1, unit: 'reps', base: 10,
      steps: ['Stand with your back, head and arms against a wall, elbows bent like a goalpost.', 'Slide your arms up the wall as high as you can.', 'Slide back down, squeezing your shoulder blades together.'],
      tip: 'Keep your lower back and wrists touching the wall.',
      quiz: ['What do you squeeze on the way down?', 'Shoulder blades together', 'Your fists', 'Your stomach only'] },

    { id: 'diamond-pushup', name: 'Diamond push-ups', areas: ['arms', 'chest'], level: 2, unit: 'reps', base: 8,
      steps: ['Make a diamond with your thumbs and index fingers under your chest.', 'Body in a straight plank line.', 'Lower your chest to your hands, elbows close to your sides, then press up.'],
      tip: 'Elbows go back along your ribs, not flared out.',
      quiz: ['Where do your elbows go?', 'Back, close to your sides', 'Flared straight out', 'Locked the whole time'] },
    { id: 'chair-dip', name: 'Chair dips', areas: ['arms', 'shoulders', 'chest'], level: 2, unit: 'reps', base: 10,
      steps: ['Sit on the edge of a sturdy chair, hands gripping the edge by your hips.', 'Slide off so your arms hold you up, knees bent.', 'Bend your elbows to about 90°, then press back up.'],
      tip: 'Keep your back close to the chair and shoulders down, away from your ears.',
      quiz: ['How far should you go down?', 'Elbows to about 90°', 'Until you sit on the floor', 'Just an inch'] },
    { id: 'pike-pushup', name: 'Pike push-ups', areas: ['shoulders', 'arms'], level: 2, unit: 'reps', base: 6,
      steps: ['Start in a push-up, then walk your feet in so your hips point up (upside-down V).', 'Bend your elbows to lower the top of your head toward the floor.', 'Press back up to the V.'],
      tip: 'Your head goes slightly in front of your hands, making a triangle.',
      quiz: ['What shape is your body?', 'An upside-down V', 'A straight plank', 'Flat on the floor'] },
    { id: 'decline-pushup', name: 'Decline push-ups', areas: ['chest', 'shoulders', 'arms'], level: 2, unit: 'reps', base: 8,
      steps: ['Feet up on a step or chair, hands on the floor shoulder-width.', 'Keep a straight line from head to heels.', 'Lower your chest to the floor and press up.'],
      tip: 'Higher feet = harder. Start low.',
      quiz: ['How do you make it easier?', 'Put your feet on something lower', 'Put your hands closer together', 'Go faster'] },
    { id: 'reverse-lunge', name: 'Reverse lunges', areas: ['legs', 'glutes'], level: 2, unit: 'reps', base: 8, note: 'per leg',
      steps: ['Stand tall, feet hip-width.', 'Step one foot back and lower until both knees are about 90°.', 'Push through the front heel to stand, then switch legs.'],
      tip: 'Keep your chest up and front knee over the ankle.',
      quiz: ['Which foot pushes you back up?', 'The front foot, through the heel', 'The back foot\'s toes', 'Both equally, jumping'] },
    { id: 'single-leg-bridge', name: 'Single-leg bridges', areas: ['glutes', 'legs', 'core'], level: 2, unit: 'reps', base: 8, note: 'per leg',
      steps: ['Lie on your back, one foot flat, the other leg straight in the air.', 'Drive through the planted heel to lift your hips.', 'Keep hips level, lower slowly, then switch.'],
      tip: 'Don\'t let the hip of the lifted leg drop.',
      quiz: ['What should stay level?', 'Your hips', 'Your feet', 'Your arms'] },
    { id: 'side-plank', name: 'Side plank', areas: ['core', 'shoulders'], level: 2, unit: 'sec', base: 25, note: 'per side',
      steps: ['Lie on your side, elbow under your shoulder, feet stacked.', 'Lift your hips so your body is a straight line.', 'Hold, then switch sides.'],
      tip: 'Push the floor away — don\'t sink into your shoulder.',
      quiz: ['Where does your elbow go?', 'Directly under your shoulder', 'Way out in front', 'Behind your back'] },
    { id: 'hollow-hold', name: 'Hollow hold', areas: ['core'], level: 2, unit: 'sec', base: 20,
      steps: ['Lie on your back, press your lower back into the floor.', 'Lift your shoulders and legs, arms reaching past your head.', 'Hold a shallow banana shape.'],
      tip: 'If your back lifts off the floor, bend your knees or bring arms forward.',
      quiz: ['What\'s the easier version?', 'Bend your knees and bring arms forward', 'Lift your legs higher', 'Arch your back'] },
    { id: 'mountain-climber', name: 'Mountain climbers', areas: ['core', 'shoulders', 'legs'], level: 2, unit: 'sec', base: 30,
      steps: ['Start in a high plank, hands under shoulders.', 'Drive one knee toward your chest, then switch fast.', 'Keep your hips low and steady.'],
      tip: 'Your hips shouldn\'t bounce up and down.',
      quiz: ['What stays low and steady?', 'Your hips', 'Your head', 'Your hands, lifting each rep'] },
    { id: 'door-row', name: 'Doorframe rows', areas: ['back', 'arms'], level: 2, unit: 'reps', base: 10,
      steps: ['Stand in a doorway and grip both sides of the frame at chest height.', 'Walk your feet in and lean back with straight arms.', 'Pull your chest to the frame by squeezing your shoulder blades.'],
      tip: 'Feet closer to the door = harder. Keep your body straight.',
      quiz: ['What starts each pull?', 'Squeezing your shoulder blades', 'Bending your knees', 'Shrugging to your ears'] },

    { id: 'archer-pushup', name: 'Archer push-ups', areas: ['chest', 'arms', 'shoulders'], level: 3, unit: 'reps', base: 5, note: 'per side',
      steps: ['Set your hands very wide, fingers pointing out.', 'Lower toward one hand while the other arm stays straight.', 'Press back up to the middle and switch sides.'],
      tip: 'The straight arm helps a little — the bent arm does the work.',
      quiz: ['Which arm does most of the work?', 'The bent arm', 'The straight arm', 'Both equally'] },
    { id: 'split-squat', name: 'Bulgarian split squats', areas: ['legs', 'glutes'], level: 3, unit: 'reps', base: 8, note: 'per leg',
      steps: ['Stand a stride in front of a chair, top of one foot resting on it behind you.', 'Lower straight down until your front thigh is about parallel.', 'Drive through your front heel to rise. Switch legs after the set.'],
      tip: 'Most of your weight stays on the front leg.',
      quiz: ['Where is most of your weight?', 'On the front leg', 'On the back foot', 'On the chair'] },
    { id: 'assisted-pistol', name: 'Assisted pistol squats', areas: ['legs', 'glutes', 'core'], level: 3, unit: 'reps', base: 4, note: 'per leg',
      steps: ['Hold a doorframe or pole, stand on one leg, other leg forward.', 'Squat down as low as you can control on one leg.', 'Stand back up, using your hands only as much as you need.'],
      tip: 'Keep the working heel flat on the floor.',
      quiz: ['What are your hands for?', 'Balance and a little help', 'Pulling yourself all the way up', 'Nothing — keep them behind you'] },
    { id: 'chin-up', name: 'Chin-ups', areas: ['back', 'arms'], level: 3, unit: 'reps', base: 4,
      steps: ['Hang from a bar, palms facing you, shoulder-width.', 'Pull your chest toward the bar until your chin clears it.', 'Lower all the way down with control.'],
      tip: 'No bar? Do slow doorframe rows instead. No kicking or swinging.',
      quiz: ['Which way do your palms face?', 'Toward you', 'Away from you', 'Toward each other only'] },
    { id: 'burpee', name: 'Burpees', areas: ['legs', 'chest', 'core', 'shoulders'], level: 3, unit: 'reps', base: 8,
      steps: ['From standing, squat and put your hands on the floor.', 'Jump your feet back to a plank and do a push-up.', 'Jump your feet in and leap up with arms overhead.'],
      tip: 'Land softly and keep your plank straight.',
      quiz: ['What do you do in the plank position?', 'A push-up', 'Nothing, just rest', 'A sit-up'] },
    { id: 'v-up', name: 'V-ups', areas: ['core'], level: 3, unit: 'reps', base: 8,
      steps: ['Lie flat, arms overhead, legs straight.', 'Lift your legs and upper body at the same time to touch your toes.', 'Lower slowly back down without flopping.'],
      tip: 'Lower slowly — the way down is half the work.',
      quiz: ['What moves at the same time?', 'Legs and upper body together', 'Only your legs', 'Only your arms'] },
  ];

  // Guess which areas a user's own exercise trains, from its name.
  const KEYWORDS = [
    [/push|press/, ['chest', 'arms', 'shoulders']], [/pull|chin|row/, ['back', 'arms']], [/dip/, ['arms', 'chest']],
    [/squat|lunge|step|jump/, ['legs', 'glutes']], [/bridge|hip/, ['glutes']], [/calf/, ['legs']],
    [/plank|sit|crunch|ab|core|hollow|leg ?raise/, ['core']], [/curl/, ['arms']], [/burpee/, ['legs', 'chest', 'core']],
  ];
  const norm = (s) => String(s).toLowerCase().replace(/\(sec\)/, '').replace(/[^a-z]/g, '');

  function areasOf(name) {
    const byName = LIBRARY.find((e) => norm(e.name) === norm(name));
    if (byName) return byName.areas;
    const n = String(name).toLowerCase();
    return [...new Set(KEYWORDS.filter(([re]) => re.test(n)).flatMap(([, a]) => a))];
  }

  /** Map area -> reps logged for it (entries since `since`). */
  function areasTrained(exercises, entries, since = '') {
    const nameOf = new Map(exercises.map((e) => [e.id, e.name]));
    const trained = new Map();
    entries.forEach((en) => {
      if (en.date < since || !nameOf.has(en.exerciseId)) return;
      areasOf(nameOf.get(en.exerciseId)).forEach((a) => trained.set(a, (trained.get(a) || 0) + en.reps));
    });
    return trained;
  }

  /** 1–3 from average reps on active days since `since`, nudged by lesson feedback. */
  function userLevel(entries, since, adjust = 0) {
    const totals = new Map();
    entries.forEach((e) => { if (e.date >= since && e.reps > 0) totals.set(e.date, (totals.get(e.date) || 0) + e.reps); });
    const days = totals.size;
    const avg = days ? [...totals.values()].reduce((a, b) => a + b, 0) / days : 0;
    const base = days < 3 ? 1 : avg >= 80 ? 3 : avg >= 30 ? 2 : 1;
    return Math.min(3, Math.max(1, base + adjust));
  }

  /** Reps (or seconds) per set: the exercise's base, scaled by how far above its level the user is. */
  function target(ex, level) {
    const n = ex.base * (1 + 0.3 * (level - ex.level));
    return ex.unit === 'sec' ? Math.max(10, Math.round(n / 5) * 5) : Math.max(3, Math.round(n));
  }

  /**
   * Next lesson: an exercise in the chosen areas, at or below the user's level,
   * not already in their list. Prefers new ones, their level, and areas they don't train yet.
   */
  function pickLesson({ areas, level, done = [], skip = new Set(), owned = [], trained = new Map() }) {
    const ownedSet = new Set(owned.map(norm));
    const pool = LIBRARY.filter((e) => e.level <= level && !skip.has(e.id) && !ownedSet.has(norm(e.name))
      && e.areas.some((a) => areas.includes(a)));
    const doneIds = done.map((d) => d.id);
    const fresh = pool.filter((e) => !doneIds.includes(e.id));
    const list = fresh.length ? fresh : pool;
    const score = (e) => e.level * 10
      + e.areas.filter((a) => areas.includes(a) && !trained.get(a)).length * 4
      - doneIds.lastIndexOf(e.id); // repeats: least recently done first
    return list.reduce((best, e) => (!best || score(e) > score(best) ? e : best), null);
  }

  function why(ex, trained, level) {
    const gap = ex.areas.find((a) => !trained.get(a));
    if (gap) return `You haven't logged anything for your ${AREA_LABEL[gap].toLowerCase()} lately — this fills the gap.`;
    return `Picked for your level (${LEVELS[level - 1].toLowerCase()}) from what you've been logging.`;
  }

  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  function quizStep(q, right, wrongs, rand) {
    const options = shuffle([right, ...wrongs], rand);
    return { type: 'quiz', q, options, answer: options.indexOf(right) };
  }

  /** ~5 minutes: intro, how-to, 2 quizzes, 3 sets with rests, finish. */
  function buildLesson(ex, level, rand = Math.random) {
    const reps = target(ex, level);
    const rest = [60, 50, 40][level - 1];
    const others = AREAS.map(([a]) => a).filter((a) => !ex.areas.includes(a));
    const areaQ = quizStep(`What does ${ex.name.toLowerCase()} mainly work?`, AREA_LABEL[ex.areas[0]],
      shuffle(others, rand).slice(0, 2).map((a) => AREA_LABEL[a]), rand);
    const set = (n) => ({ type: 'set', n, of: 3, target: reps });
    return [
      { type: 'intro' },
      { type: 'learn' },
      quizStep(ex.quiz[0], ex.quiz[1], ex.quiz.slice(2), rand),
      set(1), { type: 'rest', sec: rest, next: 2 },
      set(2), { type: 'rest', sec: rest, next: 3 },
      areaQ,
      set(3),
      { type: 'finish' },
    ];
  }

  global.RepLessons = { AREAS, AREA_LABEL, LEVELS, LIBRARY, areasOf, areasTrained, userLevel, target, pickLesson, why, buildLesson };
})(typeof self !== 'undefined' ? self : globalThis);
