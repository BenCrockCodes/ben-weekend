/**
 * tools/generateLevels.js — authoring tool that writes /levels/*.json.
 *
 * Run with:  node tools/generateLevels.js
 *
 * Levels are described with small pattern helpers on a 4-block beat grid
 * (speed = bpm / 15 blocks/sec, so one beat = exactly 4 blocks). All jump
 * math below assumes the physics constants in js/config.js:
 *   gravity 94, jump 20.8  → jump arc ≈ 4.43 blocks long, 2.3 high (at 1x)
 *   pad 27.5               → pad arc ≈ 5.85 blocks long, 4.0 high
 * Keep those numbers in mind when editing layouts — every pattern here has
 * been checked against them for fairness.
 */
const fs = require('fs');
const path = require('path');

/** Small builder DSL — each call appends one JSON record. */
function builder() {
  const objects = [];
  return {
    objects,
    spike: (x, y = 0, n = 1, flip = 1) =>
      objects.push(n > 1 || flip < 0 ? { t: 'spike', x, y, n, flip } : { t: 'spike', x, y }),
    block: (x, y, w = 1, h = 1) => objects.push({ t: 'block', x, y, w, h }),
    platform: (x, y, w = 3) => objects.push({ t: 'platform', x, y, w }),
    pad: (x, y = 0) => objects.push({ t: 'pad', x, y }),
    ring: (x, y) => objects.push({ t: 'ring', x, y }),
    saw: (x, y, r = 1) => objects.push({ t: 'saw', x, y, r }),
    gravity: (x, y, value) => objects.push({ t: 'portal', kind: 'gravity', value, x, y }),
    speedP: (x, value) => objects.push({ t: 'portal', kind: 'speed', value, x, y: 0 }),
    modeP: (x, value, y = 0) => objects.push({ t: 'portal', kind: 'mode', value, x, y }),
    coin: (x, y) => objects.push({ t: 'coin', x, y }),
  };
}

/* ================================================================
 * LEVEL 1 — "NEON RUNNER" (Easy, 150 bpm, speed 10)
 * Teaching level: single/double spikes, first blocks, one pad ride,
 * one assisted ring, one triple near the end.
 * ================================================================ */
function level1() {
  const b = builder();

  // opening rhythm: singles, then a double
  b.spike(40); b.spike(52); b.spike(64, 0, 2); b.spike(76);

  // first block hop, with coin 1 floating over it
  b.block(88, 0, 2, 1);
  b.coin(89, 2.8);
  b.spike(100, 0, 2);

  // little staircase (h1 → h2), then back to rhythm
  b.block(112, 0, 2, 1); b.block(116, 0, 2, 2);
  b.spike(126);
  b.spike(140, 0, 2);

  // pad ride onto a sky platform over a spike pit
  b.pad(158);
  b.platform(161, 3, 8);
  b.spike(162, 0, 6);          // under the platform — scary but safe up top
  b.spike(178);

  b.spike(190); b.spike(198);

  // run along a low ledge, hop off over a spike
  b.block(210, 0, 4, 1);
  b.spike(216);

  // first triple (long flat approach)
  b.spike(230, 0, 3);

  // ring rescue over a triple — teaches orbs gently
  b.spike(246, 0, 3);
  b.ring(247, 1.7);

  // pad over a small wall, coin 2 at the top of the arc
  b.pad(267);
  b.block(271, 0, 1, 2);
  b.coin(271, 3.9);

  b.spike(290, 0, 2);
  b.spike(302);

  // second staircase + spike
  b.block(312, 0, 2, 1); b.block(316, 0, 2, 2);
  b.spike(326);

  b.spike(336, 0, 3);

  // coin 3 rewards a "pointless" jump on open ground
  b.coin(352, 2.6);
  b.spike(358);

  // closing rhythm
  b.spike(368, 0, 2); b.spike(380); b.spike(392);

  return {
    id: 'level1',
    name: 'NEON RUNNER',
    difficulty: 'Easy',
    bpm: 150,
    speed: 10,
    length: 420,
    track: 'runner',
    theme: {
      bg1: [0.02, 0.004, 0.055], bg2: [0.09, 0.03, 0.22],
      accent: [0.0, 0.94, 1.0], accent2: [1.0, 0.18, 0.65],
      ground: [0.05, 0.02, 0.13], block: [0.13, 0.07, 0.3],
    },
    objects: b.objects,
  };
}

/* ================================================================
 * LEVEL 2 — "VOLTAGE" (Normal, 156 bpm, speed 10.4)
 * Adds saws, platform hops over hazards, an elevated block run and
 * chained ring fields.
 * ================================================================ */
function level2() {
  const b = builder();

  b.spike(36); b.spike(46, 0, 2); b.spike(56); b.spike(64);

  // first saw
  b.saw(77, 1);

  b.block(90, 0, 2, 1); b.spike(94);
  b.spike(104, 0, 3);

  // platform hops across a long spike pit (coin 1 above the arc)
  b.spike(116, 0, 12);
  b.platform(115, 1.5, 3); b.platform(120, 1.5, 3); b.platform(125, 1.5, 3);
  b.coin(120, 3.9);

  b.saw(145, 1);

  // pad onto a platform, saw waiting after the drop
  b.pad(158);
  b.platform(162, 2, 6);
  b.spike(163, 0, 4);
  b.saw(173, 1);

  b.spike(190, 0, 3);

  // ring field #1
  b.spike(204, 0, 4);
  b.ring(205, 1.7);

  b.spike(220, 0, 2); b.spike(230); b.spike(238, 0, 2);

  // elevated block run with a spike on top (coin 2 over that spike)
  b.block(254, 0, 3, 1);
  b.block(259, 0, 12, 2);
  b.spike(263, 2);
  b.coin(264, 4.2);
  b.saw(275, 1);

  b.saw(292, 1);
  b.spike(302, 0, 3);
  b.spike(316, 0, 2); b.spike(324, 0, 2);

  // platform hops over a row of saws
  b.saw(339, 0.9); b.saw(344, 0.9); b.saw(349, 0.9);
  b.platform(336, 1.5, 3); b.platform(341, 1.5, 3); b.platform(346, 1.5, 3);

  // chained ring fields
  b.spike(365, 0, 4); b.ring(366, 1.7);
  b.spike(378, 0, 4); b.ring(379, 1.7);

  // pad over a tall wall, coin 3 at the top of the arc
  b.pad(395);
  b.block(398, 0, 1, 3);
  b.coin(398, 4.5);

  // finale rhythm
  b.spike(415); b.spike(423, 0, 2); b.spike(433, 0, 3);
  b.saw(445, 1);
  b.spike(455, 0, 2); b.spike(463);

  return {
    id: 'level2',
    name: 'VOLTAGE',
    difficulty: 'Normal',
    bpm: 156,
    speed: 10.4,
    length: 500,
    track: 'voltage',
    theme: {
      bg1: [0.0, 0.03, 0.03], bg2: [0.01, 0.10, 0.09],
      accent: [0.3, 1.0, 0.5], accent2: [1.0, 0.55, 0.15],
      ground: [0.02, 0.07, 0.05], block: [0.05, 0.16, 0.10],
    },
    objects: b.objects,
  };
}

/* ================================================================
 * LEVEL 3 — "GRAVITY STORM" (Hard, 160 bpm, speed 10.67)
 * Everything: gravity flips along ceilings, speed portals (fast AND
 * slow), pad+ring combos, tight rhythm sections.
 * ================================================================ */
function level3() {
  const b = builder();

  b.spike(32); b.spike(40, 0, 2); b.spike(48, 0, 3);
  b.saw(60, 1);

  // fast zone (jump arc stretches to ~6 blocks — spacing widened to match)
  b.speedP(72, 'fast');
  b.spike(80); b.spike(91); b.spike(102, 0, 2); b.spike(113);
  b.speedP(126, 'normal');

  // ---- gravity section #1: ride the ceiling ----
  b.block(134, 7, 44, 1);                 // the ceiling itself
  b.gravity(137, 0, -1);
  b.spike(146, 7, 1, -1);
  b.spike(154, 7, 2, -1);
  b.spike(162, 7, 1, -1);
  b.coin(165, 3.9);                        // dip off the ceiling to grab it
  b.spike(170, 7, 1, -1);
  b.gravity(176, 3.5, 1);

  b.spike(190, 0, 3);
  b.saw(200, 1);

  // platform hops over a huge spike pit
  b.spike(208, 0, 12);
  b.platform(207, 1.5, 3); b.platform(212, 1.5, 3); b.platform(217, 1.5, 3);

  b.spike(232, 0, 2);

  // ring field
  b.spike(240, 0, 4); b.ring(241, 1.7);

  // pad + mid-air ring combo over a long spike field (coin 2 up high)
  b.pad(258);
  b.spike(261, 0, 6);
  b.ring(262, 3.2);
  b.coin(265, 5.5);

  // fast zone #2
  b.speedP(285, 'fast');
  b.spike(292); b.spike(303, 0, 2); b.spike(315); b.spike(326, 0, 3);
  b.saw(340, 1); b.spike(350);

  // slow zone — cramped little jumps
  b.speedP(360, 'slow');
  b.spike(366); b.spike(373, 0, 2); b.spike(381); b.spike(388, 0, 2); b.spike(395);
  b.speedP(402, 'normal');

  // ---- gravity section #2: longer, meaner ceiling ----
  b.block(408, 7, 50, 1);
  b.gravity(411, 0, -1);
  b.spike(420, 7, 1, -1);
  b.spike(428, 7, 2, -1);
  b.spike(438, 7, 1, -1);
  b.coin(443, 3.9);                        // another dip grab
  b.spike(448, 7, 1, -1);
  b.gravity(458, 3.5, 1);

  b.spike(470, 0, 3);
  b.saw(482, 1);
  b.spike(490, 0, 2);

  b.spike(500, 0, 4); b.ring(501, 1.7);

  b.pad(515);
  b.block(518, 0, 1, 3);

  // brutal finale rhythm
  b.spike(535, 0, 3); b.spike(547, 0, 2); b.spike(557);
  b.spike(568, 0, 2); b.spike(578);

  return {
    id: 'level3',
    name: 'GRAVITY STORM',
    difficulty: 'Hard',
    bpm: 160,
    speed: 10.667,
    length: 600,
    track: 'storm',
    theme: {
      bg1: [0.05, 0.0, 0.03], bg2: [0.16, 0.02, 0.10],
      accent: [1.0, 0.25, 0.35], accent2: [0.75, 0.35, 1.0],
      ground: [0.10, 0.02, 0.06], block: [0.22, 0.05, 0.12],
    },
    objects: b.objects,
  };
}

/* ================================================================
 * LEVEL 4 — "SKY DRIVE" (Normal, 144 bpm, speed 9.6)
 * The first hybrid: cube intro → ship corridor → cube outro.
 * Ship arithmetic: ACC 45, MAX_V 13 → climbing 3 blocks takes ~0.37 s
 * (≈3.5 blocks of travel), so 14-block obstacle spacing is comfortable.
 * ================================================================ */
function level4() {
  const b = builder();

  // -------- cube intro: friendly rhythm
  b.spike(36); b.spike(48, 0, 2);
  b.block(60, 0, 2, 1);
  b.coin(61, 2.7);                         // coin 1: hop over the block, jump late
  b.spike(72); b.spike(86, 0, 2); b.spike(100);
  b.block(112, 0, 2, 1); b.block(116, 0, 2, 2);
  b.spike(126);

  // -------- ship section: corridor between the ground and a ceiling at y8
  b.modeP(138, 'ship');
  b.block(136, 8, 140, 1);                 // the ceiling (136..276)
  b.block(152, 0, 2, 3);                   // floor bump    → fly 3..8
  b.block(166, 5, 2, 3);                   // ceiling bump  → fly 0..5
  b.block(180, 0, 2, 3);
  b.block(194, 5, 2, 3);
  b.saw(208, 4, 1);                        // mid-air saw — go over or under
  b.coin(208, 0.7);                        // coin 2: dive under the saw
  b.block(222, 0, 2, 3);
  b.block(236, 5, 2, 3);
  b.block(250, 0, 2, 3);
  b.modeP(266, 'cube');

  // -------- cube outro
  b.spike(288); b.spike(300, 0, 2); b.spike(314);
  b.coin(320, 2.6);                        // coin 3: a "pointless" jump
  b.spike(328, 0, 2); b.spike(342); b.spike(354, 0, 2);

  return {
    id: 'level4',
    name: 'SKY DRIVE',
    difficulty: 'Normal',
    stars: 2,
    song: { name: 'Voltage (Flight Mix)', artist: 'NEOVOLT OST' },
    bpm: 144,
    speed: 9.6,
    length: 400,
    track: 'voltage',
    theme: {
      bg1: [0.0, 0.02, 0.07], bg2: [0.02, 0.09, 0.2],
      accent: [0.25, 0.75, 1.0], accent2: [1.0, 0.75, 0.15],
      ground: [0.02, 0.05, 0.12], block: [0.07, 0.13, 0.28],
    },
    objects: b.objects,
  };
}

/* ================================================================
 * LEVEL 5 — "AFTERBURN" (Hard, 160 bpm, speed 10.67)
 * Advanced hybrid: two ship corridors (the second much tighter), a fast
 * cube section between them, and a brutal rhythm finale.
 * ================================================================ */
function level5() {
  const b = builder();

  // -------- cube: sharp opening
  b.spike(36); b.spike(46, 0, 2); b.spike(58, 0, 3);
  b.saw(72, 1);
  b.pad(84); b.block(88, 0, 1, 2);
  b.coin(87, 4.2);                         // coin 1: top of the pad arc
  b.spike(100, 0, 2); b.spike(112);

  // -------- ship corridor #1: 4-block swings
  b.modeP(124, 'ship');
  b.block(122, 8, 158, 1);                 // ceiling 122..280
  b.block(136, 0, 2, 4);                   // fly 4..8
  b.block(150, 4, 2, 4);                   // fly 0..4
  b.block(164, 0, 2, 4);
  b.block(178, 4, 2, 4);
  b.saw(190, 4, 0.9);                      // thread past the saw
  b.block(202, 0, 2, 4);
  b.block(216, 4, 2, 4);
  b.block(230, 3, 3, 2);                   // floating slab: pick high or low lane
  b.coin(231, 6);                          // coin 2: take the HIGH lane
  b.saw(244, 2, 0.8); b.saw(244, 6, 0.8);  // twin saws: thread the middle
  b.block(258, 0, 2, 4);
  b.block(270, 4, 2, 4);
  b.modeP(284, 'cube');

  // -------- fast cube interlude
  b.speedP(296, 'fast');
  b.spike(304); b.spike(315, 0, 2); b.spike(327); b.spike(339, 0, 3);
  b.saw(352, 1);
  b.speedP(364, 'normal');

  // -------- ship corridor #2: tighter weave
  b.modeP(376, 'ship');
  b.block(374, 8, 110, 1);                 // ceiling 374..484
  b.block(388, 4, 2, 4);
  b.block(400, 0, 2, 4);
  b.block(412, 4, 2, 4);
  b.block(424, 0, 2, 4);
  b.saw(436, 4, 1);
  b.coin(436, 1.2);                        // coin 3: dive under the saw
  b.block(448, 3, 2, 2);                   // floating block mid-corridor
  b.block(462, 4, 2, 4);
  b.block(474, 0, 2, 4);
  b.modeP(488, 'cube');

  // -------- finale
  b.spike(500, 0, 2); b.spike(512, 0, 3);
  b.saw(526, 1);
  b.spike(538, 0, 2); b.spike(548);

  return {
    id: 'level5',
    name: 'AFTERBURN',
    difficulty: 'Hard',
    stars: 4,
    song: { name: 'Gravity Storm (Afterburn Cut)', artist: 'NEOVOLT OST' },
    bpm: 160,
    speed: 10.667,
    length: 560,
    track: 'storm',
    theme: {
      bg1: [0.06, 0.01, 0.0], bg2: [0.18, 0.06, 0.01],
      accent: [1.0, 0.55, 0.1], accent2: [1.0, 0.2, 0.3],
      ground: [0.1, 0.04, 0.01], block: [0.24, 0.1, 0.04],
    },
    objects: b.objects,
  };
}

/* ================================================================
 * Output: one internal ES module — the game never fetches level files.
 * ================================================================ */

const defs = [level1(), level2(), level3(), level4(), level5()];

// song/star metadata for the three original levels
defs[0].stars = 1; defs[0].song = { name: 'Neon Runner', artist: 'NEOVOLT OST' };
defs[1].stars = 2; defs[1].song = { name: 'Voltage', artist: 'NEOVOLT OST' };
defs[2].stars = 3; defs[2].song = { name: 'Gravity Storm', artist: 'NEOVOLT OST' };

const header =
`/**
 * levelData.js — GENERATED by tools/generateLevels.js — do not edit by hand.
 *
 * The built-in "main levels", stored as an internal module (no runtime
 * fetches). Each entry is a full level definition: metadata, song info,
 * theme colours and the object list, consumed by LevelRuntime.
 */
export const MAIN_LEVELS = `;

const out = path.join(__dirname, '..', 'js', 'levelData.js');
fs.writeFileSync(out, header + JSON.stringify(defs, null, 1) + ';\n');
console.log(`wrote ${out}: ${defs.map((d) => `${d.name} (${d.objects.length} objs, len ${d.length})`).join(', ')}`);
