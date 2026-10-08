/**
 * Bakes the mudra library into explicit 21-point landmark coordinates.
 *
 *   node scripts/build-mudra-poses.mjs
 *
 * Why bake at all: a mudra is a shape, and a shape is easier to get right, to
 * inspect and to diff as coordinates than as a handful of parameters feeding a
 * solver. The generated file is the source of truth the hero renders from.
 *
 * Why generate rather than hand-write: the coordinates have to sit in the
 * *model's* geometry, not an idealised hand. handRig aims the model's bones
 * along the directions these points imply and then reads the glowing overlay
 * back out of the posed skeleton, so anchors and bone lengths taken from
 * anywhere else would put the dots off the mesh. Everything below is measured
 * out of hand.glb; only the joint angles are authored.
 *
 * Angle conventions, both in degrees:
 *   abduct  rotates the digit within the palm plane, positive toward +X (the
 *           pinky side). For the thumb, which starts on the far side, positive
 *           is therefore adduction: drawing it in across the palm.
 *   flex    bends each joint in turn toward +Z, the way the palm faces, so a
 *           fully flexed finger closes onto the palm rather than through it.
 *   lift    (thumb only) tilts the whole digit off the palm toward +Z.
 *
 * Angles are held to the ranges the joints actually have — MCP to about 90,
 * PIP to about 100, DIP to about 60 — so nothing here hyperextends.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GLB = resolve(HERE, "../public/models/hand.glb");
const OUT = resolve(HERE, "../src/lib/constants/mudraPoses.json");

// ---------------------------------------------------------------- glb reading

const buf = readFileSync(GLB);
let off = 12;
let json = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + len)));
  off += 8 + len + ((4 - (len % 4)) % 4);
}

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

let bin = null;
{
  let scan = 12;
  while (scan < buf.length) {
    const l = buf.readUInt32LE(scan);
    const t = buf.readUInt32LE(scan + 4);
    if (t === 0x004e4942) bin = buf.subarray(scan + 8, scan + 8 + l);
    scan += 8 + l + ((4 - (l % 4)) % 4);
  }
}

function accessor(i) {
  const a = json.accessors[i];
  const bv = json.bufferViews[a.bufferView];
  const C = CT[a.componentType];
  const n = NUM[a.type];
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride;
  const out = [];
  if (!stride || stride === n * C.BYTES_PER_ELEMENT) {
    const flat = new C(bin.buffer, bin.byteOffset + base, a.count * n);
    for (let k = 0; k < a.count; k++) out.push(Array.from(flat.subarray(k * n, k * n + n)));
  } else {
    for (let k = 0; k < a.count; k++) out.push(Array.from(new C(bin.buffer, bin.byteOffset + base + k * stride, n)));
  }
  return out;
}

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const trs = (t = [0, 0, 0], q = [0, 0, 0, 1], s = [1, 1, 1]) => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
          (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
          (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
          t[0], t[1], t[2], 1];
};
const world = new Array(json.nodes.length).fill(null);
const walk = (i, p) => {
  const n = json.nodes[i];
  world[i] = mul(p, n.matrix ?? trs(n.translation, n.rotation, n.scale));
  for (const c of n.children ?? []) walk(c, world[i]);
};
const kids = new Set();
json.nodes.forEach((n) => (n.children ?? []).forEach((c) => kids.add(c)));
json.nodes.forEach((_, i) => { if (!kids.has(i)) walk(i, trs()); });

// handRig orients the model with rotation.x = -PI/2: (x, y, z) -> (x, z, -y).
const orient = ([x, y, z]) => [x, z, -y];
const bone = (name) => {
  const i = json.nodes.findIndex((n) => n.name === name);
  if (i < 0) throw new Error(`missing bone ${name}`);
  return orient([world[i][12], world[i][13], world[i][14]]);
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dist = (a, b) => len(sub(a, b));

// ------------------------------------------------- measured model proportions

// Bone chains, base to tip, exactly as handRig walks them.
const CHAINS = {
  thumb: ["L_Hand_Thumb_1_019", "L_Hand_Thumb_2_020", "L_Hand_Thumb_3_021"],
  index: ["L_Hand_Index_1_03", "joint5_04", "joint6_05", "joint7_06"],
  middle: ["L_Hand_Middle_1_07", "joint9_08", "joint10_09", "joint11_010"],
  ring: ["L_Hand_Ring_1_011", "joint13_012", "joint14_013", "joint15_014"],
  pinky: ["L_Hand_Pinky_1_015", "joint17_016", "joint18_017", "joint19_018"],
};

const rawWrist = bone("L_Hand_00");
const rawMidTip = bone("joint11_010");

// Normalise so the wrist sits at the origin and the middle finger reaches 1.
// Everything downstream is in units of that reach, which keeps the numbers
// readable and makes the file independent of the model's export scale.
const REACH = dist(rawWrist, rawMidTip);
const norm = (p) => sub(p, rawWrist).map((c) => c / REACH);

const anchors = {
  wrist: norm(rawWrist),
  thumb: norm(bone(CHAINS.thumb[0])),
  index: norm(bone(CHAINS.index[0])),
  middle: norm(bone(CHAINS.middle[0])),
  ring: norm(bone(CHAINS.ring[0])),
  pinky: norm(bone(CHAINS.pinky[0])),
};

// Segment lengths straight off the model, so baked joints land on the mesh.
const segments = {};
for (const [digit, names] of Object.entries(CHAINS)) {
  const pts = names.map((n) => norm(bone(n)));
  segments[digit] = pts.slice(1).map((p, i) => dist(p, pts[i]));
}

/**
 * The thumb is rigged from its carpal joint, not its knuckle.
 *
 * The model has no carpal bone — it hangs the thumb straight off the palm — so
 * the obvious reading is that the knuckle is fixed and only the joints past it
 * can move. That reading is what a thumb cannot live with: held that way it
 * spans 0.282 from a base at x -0.21 and can never pass x 0.077, which puts
 * the curled fingers out of its reach in Kartarimukha and Mayura and makes
 * those gestures look impossible to form.
 *
 * A real thumb closes that distance by rotating at the carpal joint, swinging
 * the whole metacarpal forward and across the palm — opposition, the motion
 * that makes a hand a hand. So the chain starts one joint earlier: landmark 1
 * is a real anchor, the metacarpal is a real segment, and the knuckle rides on
 * the end of it. Reach from the carpal joint is 0.266 + 0.282, so the thumb
 * gets to x 0.46 and the contacts close.
 *
 * handRig repositions the model's thumb base bone to follow landmark 2, since
 * the bone no longer sits where the rest pose left it.
 */
const meshVerts = (() => {
  const prim = json.meshes.flatMap((m) => m.primitives).find((p) => p.attributes.JOINTS_0 !== undefined);
  return accessor(prim.attributes.POSITION).map((p) => norm(orient(p)));
})();

/**
 * Landmark 1 sits on the thenar eminence — the thick pad of muscle at the base
 * of the thumb — not down by the wrist. Sliding it along the wrist-to-knuckle
 * line puts it in the hollow of the palm, which is both wrong and looks it.
 *
 * So it is measured: take the mesh through the band of palm on the thumb side,
 * and put the joint under the surface of the mound, at the depth the flesh
 * gives it rather than on the skin.
 */
const thenar = (() => {
  const band = meshVerts.filter(
    (p) => p[0] > -0.26 && p[0] < 0.02 && p[1] > 0.14 && p[1] < 0.42,
  );
  if (!band.length) throw new Error("no thenar vertices found");
  const front = band.filter((p) => p[2] > 0);
  const mean = (pts, i) => pts.reduce((a, p) => a + p[i], 0) / pts.length;
  const surface = mean(front, 2);
  const back = mean(band.filter((p) => p[2] < 0), 2);
  return [mean(front, 0), mean(front, 1), (surface + back) / 2];
})();

anchors.thumbCmc = thenar;
segments.thumb = [dist(anchors.thumbCmc, anchors.thumb), ...segments.thumb];

// ------------------------------------------------------------ pose authoring

const rad = (d) => (d * Math.PI) / 180;

/** A finger held straight still carries a little residual flex. */
const STRAIGHT = [5, 5, 5];
/** Folded down onto the palm, at the top of each joint's real range. */
const FOLDED = [85, 100, 55];
/** Curled but not closed, as in the lotus. */
const CUPPED = [22, 26, 16];

/**
 * Walks one digit out from its anchor.
 *
 * `abduct` sets the direction within the palm plane and stays fixed for the
 * whole digit, which is how a real finger works: the knuckle swings sideways,
 * the joints past it only bend. `flex` then accumulates down the chain.
 */
function solveDigit(anchor, segs, abduct, flex, lift = 0, roll = 0) {
  const a = rad(abduct);
  const l = rad(lift);
  // In-plane direction, then tilted off the palm by `lift`.
  const u = [Math.sin(a) * Math.cos(l), Math.cos(a) * Math.cos(l), Math.sin(l)];

  // The plane the joints hinge in. A finger's starts straight out of the palm,
  // so flexing closes it onto the palm. The thumb's is rotated most of the way
  // round from that, which is the whole reason a thumb folds *across* the palm
  // instead of forward off it — bending a thumb the way a finger bends is the
  // one motion a real hand cannot make.
  let n = [0, 0, 1];
  const along = n[0] * u[0] + n[1] * u[1] + n[2] * u[2];
  n = [n[0] - along * u[0], n[1] - along * u[1], n[2] - along * u[2]];
  const nLen = Math.hypot(n[0], n[1], n[2]) || 1;
  n = n.map((c) => c / nLen);
  const side = [
    u[1] * n[2] - u[2] * n[1],
    u[2] * n[0] - u[0] * n[2],
    u[0] * n[1] - u[1] * n[0],
  ];
  const cr = Math.cos(rad(roll));
  const sr = Math.sin(rad(roll));
  n = [n[0] * cr + side[0] * sr, n[1] * cr + side[1] * sr, n[2] * cr + side[2] * sr];

  let theta = 0;
  let p = [...anchor];
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    theta += rad(flex[i] ?? flex[flex.length - 1]);
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const d = [u[0] * c + n[0] * s, u[1] * c + n[1] * s, u[2] * c + n[2] * s];
    p = [p[0] + d[0] * segs[i], p[1] + d[1] * segs[i], p[2] + d[2] * segs[i]];
    out.push(p);
  }
  return out;
}

/**
 * Finds thumb angles that carry the tip to `target`.
 *
 * Several mudras are *defined* by where the thumb arrives — on the base of the
 * index, on the ring fingertip, capping the curled fingers — and the angles
 * that get it there are a consequence, not a choice. Writing the destination
 * and solving for the angles keeps the intent legible and means re-rigging the
 * thumb does not mean hand-tuning eight poses again.
 *
 * `penalty` shapes *how* it arrives, since many angle sets reach the same point
 * and most look wrong; `minTipZ` keeps the tip from arriving through the hand.
 */
function solveThumbTo(target, opts = {}) {
  const { minTipZ = -Infinity, penalty = () => 0 } = opts;
  let best = null;

  const consider = (abduct, lift, roll, flex) => {
    const pts = solveDigit(anchors.thumbCmc, segments.thumb, abduct, flex, lift, roll);
    if (pts[2][2] < minTipZ) return;
    // No joint may take a shortcut through the hand on its way there.
    if (pts.some(insidePalm)) return;
    const cost = dist(pts[2], target) + penalty(pts);
    if (!best || cost < best.cost) best = { cost, abduct, lift, roll, flex: [...flex], pts };
  };

  const sweep = (r, step) => {
    for (let ab = r.ab[0]; ab <= r.ab[1]; ab += step)
      for (let li = r.li[0]; li <= r.li[1]; li += step)
        for (let ro = r.ro[0]; ro <= r.ro[1]; ro += step * 2)
          for (let f0 = r.f0[0]; f0 <= r.f0[1]; f0 += step)
            for (let f1 = r.f1[0]; f1 <= r.f1[1]; f1 += step)
              for (let f2 = r.f2[0]; f2 <= r.f2[1]; f2 += step) consider(ab, li, ro, [f0, f1, f2]);
  };

  // Joint limits first, then a fine pass around whatever the coarse one liked.
  sweep({ ab: [-80, 110], li: [-25, 50], ro: [0, 180], f0: [0, 55], f1: [0, 80], f2: [0, 70] }, 15);
  const around = (v, lo, hi) => [Math.max(lo, v - 15), Math.min(hi, v + 15)];
  sweep(
    {
      ab: around(best.abduct, -80, 110),
      li: around(best.lift, -25, 50),
      ro: around(best.roll, 0, 180),
      f0: around(best.flex[0], 0, 55),
      f1: around(best.flex[1], 0, 80),
      f2: around(best.flex[2], 0, 70),
    },
    5,
  );

  return { abduct: best.abduct, lift: best.lift, roll: best.roll, flex: best.flex };
}

/**
 * Depth of the palm's front skin around the index knuckle, measured off the
 * mesh. The bone there lies at z -0.035, some 0.08 further back, which is the
 * trap: a thumb rested on the bone's coordinates disappears into the hand.
 */
const PALM_SKIN = 0.047;

/**
 * Half the thickness of a finger, in the same units.
 *
 * Every landmark in this file is a bone, not a surface — that is the whole
 * reason PALM_SKIN exists. It bites twice as hard when one digit rests on
 * another: the finger has flesh in front of its bone and the thumb has flesh
 * behind its own, so two digits in contact hold their *bones* about two of
 * these apart. Aim a thumb at the bone it is meant to lie on and it arrives
 * buried to the knuckle in the finger.
 *
 * Taken from the palm: its front skin stands 0.082 proud of the index knuckle
 * bone. A finger is appreciably thinner than a palm, so a little over half.
 */
const DIGIT_FLESH = 0.045;

/**
 * Is this point buried in the hand? Anything over the palm's footprint and
 * behind its front skin is inside the flesh. Constraining only the fingertip is
 * not enough: a thumb can arrive in exactly the right place having taken its
 * knuckle straight through the palm to get there.
 */
const insidePalm = (p) =>
  p[0] > -0.22 && p[0] < 0.3 && p[1] > 0.05 && p[1] < 0.58 && p[2] < PALM_SKIN - 0.01;

/**
 * Keeps the thumb on the outside of a closed fist.
 *
 * `insidePalm` models the flat hand only — it has no idea that four folded
 * fingers are filling the space in front of the palm. Reaching a target that
 * sits on the surface of those fingers, the solver is otherwise free to take
 * the thumb straight through them to get there, which costs it nothing and
 * looks exactly as wrong as it sounds.
 */
const outsideFist = (L) => (pts) => {
  const front = Math.max(L[6][2], L[10][2], L[14][2], L[18][2]) + 2 * DIGIT_FLESH;
  let cost = 0;
  for (const p of pts) {
    const overTheFingers = p[1] > 0.38 && p[1] < 0.63 && p[0] > -0.17 && p[0] < 0.31;
    // Every joint, not just the tip. The interphalangeal joint is the one that
    // actually offends: a thumb can land its tip cleanly on the fingers having
    // taken its middle knuckle straight through the index to get there.
    if (overTheFingers && p[2] < front) cost += (front - p[2]) * 6;
  }
  return cost;
};

/** Keeps the thumb's proximal phalanx on the fingers' own axis. */
const proximalUpright = (pts) => {
  const seg = sub(pts[1], pts[0]);
  const up = seg[1] / (len(seg) || 1);
  return Math.max(0, 0.94 - up) * 1.5;
};

/**
 * The eight mudras of the hero cycle, read off the reference photographs in
 * public/images/mudras and expressed as joint angles.
 *
 * The recurring shape is worth naming: in Pataka, Tripataka, Ardhapataka,
 * Ardhachandra and Mayura the extended fingers are pressed together with no
 * daylight, so they carry small converging abductions rather than zero. Only
 * Kartarimukha's V and Alapadma's fan are meant to open.
 */
const MUDRAS = [
  {
    slug: "pataka",
    name: "Pataka",
    meaning: "The Flag",
    note: "Fingers straight and pressed together, thumb folded against the palm.",
    // Up the edge of the palm on the fingers' own axis, then square across at
    // the last joint to come to rest at the base of the index, where Pataka's
    // thumb sits in the photograph. Two things keep it honest. The roll puts
    // the hinge in the thumb's own plane, so the 90 degrees carries the tip
    // across the palm rather than straight out of it, which no thumb can do.
    // And the target is the palm's *skin*, not the index knuckle's coordinates:
    // a bone sits mid-flesh, roughly 0.08 behind the surface here, so resting
    // the thumb on the bone would bury it inside the hand.
    // Comes to rest on the base of the index, on the skin rather than at the
    // knuckle bone, which lies buried some 0.08 behind it.
    thumbTo: (L) => [L[5][0], L[5][1], PALM_SKIN + 0.05],
    thumbOpts: () => ({ minTipZ: PALM_SKIN, penalty: proximalUpright }),
    index: { abduct: 4, flex: STRAIGHT },
    middle: { abduct: 1, flex: [3, 3, 3] },
    ring: { abduct: -3, flex: STRAIGHT },
    pinky: { abduct: -7, flex: [8, 8, 8] },
  },
  {
    slug: "tripataka",
    name: "Tripataka",
    meaning: "Three Parts of a Flag",
    note: "Pataka, with the ring finger folded down.",
    // Comes to rest on the base of the index, on the skin rather than at the
    // knuckle bone, which lies buried some 0.08 behind it.
    thumbTo: (L) => [L[5][0], L[5][1], PALM_SKIN + 0.05],
    thumbOpts: () => ({ minTipZ: PALM_SKIN, penalty: proximalUpright }),
    index: { abduct: 4, flex: STRAIGHT },
    middle: { abduct: 1, flex: [3, 3, 3] },
    // One hinge, not a curl. The knuckle stays straight and in line with the
    // other fingers, the middle joint turns a square corner, and everything
    // past it runs straight again. Rolling all three joints up like a fist is
    // the wrong shape: Tripataka folds the ring finger, it does not close it.
    ring: { abduct: -3, flex: [2, 90, 2] },
    pinky: { abduct: -5, flex: [8, 8, 8] },
  },
  {
    slug: "ardhapataka",
    name: "Ardhapataka",
    meaning: "Half Flag",
    note: "Index and middle extended together, the rest closed.",
    // Comes to rest on the base of the index, on the skin rather than at the
    // knuckle bone, which lies buried some 0.08 behind it.
    thumbTo: (L) => [L[5][0], L[5][1], PALM_SKIN + 0.05],
    thumbOpts: () => ({ minTipZ: PALM_SKIN, penalty: proximalUpright }),
    index: { abduct: 4, flex: STRAIGHT },
    middle: { abduct: 1, flex: [3, 3, 3] },
    // Both fold the same way the ring does in Tripataka: straight to the middle
    // joint, a square corner there, straight again past it.
    ring: { abduct: -3, flex: [2, 90, 2] },
    pinky: { abduct: -7, flex: [2, 90, 2] },
  },
  {
    slug: "kartarimukha",
    name: "Kartarimukha",
    meaning: "Arrow Shaft, or Scissors",
    note: "The same two fingers, the middle one tipped forward off the palm.",
    // Caps the two curled tips, sitting on top of both. Reachable only because
    // the thumb now swings from its carpal joint: held at the knuckle it fell
    // short of the ring by 0.04 and the pinky by 0.14.
    thumbTo: (L) => [
      (L[16][0] + L[20][0]) / 2,
      (L[16][1] + L[20][1]) / 2,
      (L[16][2] + L[20][2]) / 2 + 0.055,
    ],
    thumbOpts: (L) => ({ minTipZ: Math.max(L[16][2], L[20][2]) }),
    // Both run straight and parallel, like Pataka's. What separates them is
    // depth, not splay: the middle tips forward at the knuckle, a few degrees,
    // so the pair opens out of the plane of the palm rather than across it.
    index: { abduct: 4, flex: [4, 4, 4] },
    middle: { abduct: 1, flex: [5, 3, 3] },
    // Curled over, not crushed flat: each tip comes to rest in front of its own
    // knuckle with air under it, which is where the thumb would cap them.
    ring: { abduct: -12, flex: [60, 110, 60] },
    pinky: { abduct: 6, flex: [60, 110, 70] },
  },
  {
    slug: "mayura",
    name: "Mayura",
    meaning: "The Peacock",
    note: "Thumb and ring fingertip meet; the others stay extended.",
    // The contact is the gesture, so the thumb is solved to wherever the ring
    // finishes rather than guessed at. It reaches because the thumb now turns
    // on a carpal joint; pinned at its knuckle it could not get near.
    thumbTo: (L) => L[16],
    thumbOpts: () => ({ minTipZ: PALM_SKIN }),
    index: { abduct: 4, flex: STRAIGHT },
    middle: { abduct: 1, flex: [3, 3, 3] },
    // Not a curl. The knuckle tips the whole finger forward into depth, the
    // middle joint then turns its square corner, and the last two run straight
    // out to the tip the thumb comes to meet.
    ring: { abduct: 10, flex: [35, 90, 2] },
    pinky: { abduct: -6, flex: [8, 8, 8] },
  },
  {
    slug: "ardhachandra",
    name: "Ardhachandra",
    meaning: "The Half Moon",
    note: "Fingers closed, thumb stretched away into a crescent.",
    // Swung right out to the side, which is what opens the crescent.
    thumb: { abduct: -60, lift: 4, roll: 0, flex: [8, 6, 4] },
    index: { abduct: 4, flex: STRAIGHT },
    middle: { abduct: 1, flex: [3, 3, 3] },
    ring: { abduct: -3, flex: STRAIGHT },
    pinky: { abduct: -7, flex: [8, 8, 8] },
  },
  {
    slug: "alapadma",
    name: "Alapadma",
    meaning: "The Blooming Lotus",
    note: "The fingers opening in depth, each turned further than the last.",
    // The lotus opens through depth, not across the palm, and it opens as a
    // sweep: the index tips slightly back off the palm, the middle comes
    // forward, and the ring and pinky turn further still. Each finger stays
    // straight and only its knuckle turns, so they keep their own lanes;
    // splaying them sideways instead gives a starfish, not a flower.
    //
    // The knuckle angles are the shape. They are checked below rather than
    // trusted, because it is the progression that reads as blooming, and a
    // finger a few degrees out of step breaks the sweep.
    thumb: { abduct: 12, lift: 10, roll: 0, flex: [4, 3, 2] },
    index: { abduct: 2, flex: [-10, 2, 2] },
    middle: { abduct: 1, flex: [40, 2, 2] },
    ring: { abduct: -1, flex: [90, 2, 2] },
    pinky: { abduct: -2, flex: [120, 2, 2] },
  },
  {
    slug: "mushti",
    name: "Mushti",
    meaning: "The Closed Fist",
    note: "The four fingers folded into the palm, the thumb laid across them.",
    // The thumb is the whole pose, and it is defined by what it lands on rather
    // than by an angle: it lies across the *outside* of the folded fingers,
    // over the middle finger's middle phalanx, a thumb's thickness proud of it.
    // Solving for the destination is what makes this a useful check of the rig
    // — the thumb has to finish resting on four other landmarks, so if the
    // chain's proportions are wrong the contact is visibly wrong too.
    thumbTo: (L) => [
      (L[7][0] + L[11][0]) / 2,
      (L[6][1] + L[7][1]) / 2,
      Math.max(L[6][2], L[7][2], L[10][2], L[11][2]) + 2 * DIGIT_FLESH,
    ],
    thumbOpts: (L) => ({
      minTipZ: Math.max(L[6][2], L[10][2]) + 2 * DIGIT_FLESH,
      penalty: outsideFist(L),
    }),
    index: { abduct: 2, flex: [88, 100, 58] },
    middle: { abduct: 0, flex: [88, 100, 58] },
    ring: { abduct: -2, flex: [88, 100, 58] },
    pinky: { abduct: -4, flex: [88, 100, 58] },
  },
];

// -------------------------------------------------------------------- baking

function bake(m) {
  const out = new Array(21);
  out[0] = anchors.wrist;

  // Fingers first: a thumb that is defined by what it touches needs to know
  // where they finished before it can be solved.
  for (const [digit, at] of [["index", 5], ["middle", 9], ["ring", 13], ["pinky", 17]]) {
    out[at] = anchors[digit];
    const pts = solveDigit(anchors[digit], segments[digit], m[digit].abduct, m[digit].flex);
    for (let i = 0; i < 3; i++) out[at + 1 + i] = pts[i];
  }

  // From the carpal joint out: landmark 1 anchors it, then metacarpal, proximal
  // and distal carry the knuckle, the interphalangeal joint and the tip.
  const angles = m.thumbTo ? solveThumbTo(m.thumbTo(out), m.thumbOpts?.(out) ?? {}) : m.thumb;
  m.solvedThumb = angles;
  const thumb = solveDigit(anchors.thumbCmc, segments.thumb, angles.abduct, angles.flex, angles.lift, angles.roll);
  out[1] = anchors.thumbCmc;
  out[2] = thumb[0];
  out[3] = thumb[1];
  out[4] = thumb[2];

  return out.map((p) => p.map((c) => Math.round(c * 10000) / 10000));
}

// ----------------------------------------------------------------- validation

/** The classifier's own straightness measure, so poses are checked by its rules. */
const extension = (L, [a, b, c, d]) => {
  const chain = dist(L[a], L[b]) + dist(L[b], L[c]) + dist(L[c], L[d]);
  return Math.min(1, dist(L[a], L[d]) / chain);
};
const FINGER_IDX = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

/** What each mudra must satisfy, mirroring src/lib/mediapipe/classification.ts. */
const EXPECT = {
  // `thumbNear` is the folded thumb coming to rest on the base of the index,
  // and `thumbUpright` keeps its first segment on the fingers' own axis so it
  // folds at the last joint rather than swinging out diagonally.
  pataka: { ext: ["index", "middle", "ring", "pinky"], together: true, thumbNear: 5, thumbUpright: true },
  // The ring folds on one hinge rather than curling, so it is checked by the
  // angle it actually turns. The classifier's blunt isBent() cannot express
  // this shape — see the warning it raises below.
  tripataka: {
    ext: ["index", "middle", "pinky"],
    hinges: [{ at: 14, degrees: 90, straight: [15] }],
    thumbNear: 5,
    thumbUpright: true,
  },
  ardhapataka: {
    ext: ["index", "middle"],
    hinges: [
      { at: 14, degrees: 90, straight: [15] },
      { at: 18, degrees: 90, straight: [19] },
    ],
    thumbNear: 5,
    thumbUpright: true,
  },
  kartarimukha: {
    ext: ["index", "middle"],
    bent: ["ring", "pinky"],
    curledInFront: ["ring", "pinky"],
    thumbCaps: [16, 20],
    // Forward, out of the plane of the palm — not splayed sideways.
    leansForward: { knuckle: 9, minForward: 0.03, maxSideways: 0.04 },
    // Index and middle now sit as they do in Ardhapataka, so the two shapes
    // differ only in depth and in how the spare fingers fold. Watched, because
    // the classifier reads neither.
    resembles: "ardhapataka",
  },
  mayura: {
    ext: ["index", "middle", "pinky"],
    touch: [4, 16],
    hinges: [{ at: 14, degrees: 90, straight: [15] }],
    // The knuckle carries the whole finger forward before the hinge turns.
    tiltForward: { from: 13, to: 14, min: 0.06 },
  },
  ardhachandra: { ext: ["index", "middle", "ring", "pinky"], together: true },
  // A sweep of knuckle angles, and no sideways splay to speak of.
  alapadma: {
    mcpBends: { 5: -10, 9: 40, 13: 90, 17: 120 },
    straightPast: [5, 9, 13, 17],
    maxSideways: 0.09,
  },
  // A closed fist with the thumb lying across the front of it.
  mushti: {
    bent: ["index", "middle", "ring", "pinky"],
    // Lying *across* the fingers is a span, not a point: the tip finishes
    // somewhere over the folded index and middle phalanges, and in front of
    // all of them. Pinning it to one landmark measured the wrong thing.
    thumbAcrossFist: { over: [6, 7, 10, 11], margin: 0.04 },
  },
};

const problems = [];
const warnings = [];
const report = [];

/** Angle between two directions, in degrees. */
const angleBetween = (a, b) => {
  const c = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((len(a) * len(b)) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};

/** Interior angle the chain turns at landmark `b`, in degrees. */
const bendAt = (L, b) => {
  const v1 = sub(L[b], L[b - 1]);
  const v2 = sub(L[b + 1], L[b]);
  const c = (v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]) / ((len(v1) * len(v2)) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
};

for (const m of MUDRAS) {
  const L = bake(m);
  const e = Object.fromEntries(Object.entries(FINGER_IDX).map(([k, v]) => [k, extension(L, v)]));
  const want = EXPECT[m.slug] ?? {};
  const notes = [];

  for (const f of want.ext ?? []) if (e[f] <= 0.85) problems.push(`${m.slug}: ${f} should read extended, scores ${e[f].toFixed(2)} (needs > 0.85)`);
  for (const f of want.bent ?? []) if (e[f] >= 0.65) problems.push(`${m.slug}: ${f} should read bent, scores ${e[f].toFixed(2)} (needs < 0.65)`);

  // Fingers touch when their tips sit no further apart than their knuckles.
  const gap = (a, b) => Math.abs(L[a][0] - L[b][0]);
  const knuckle = (a, b) => Math.abs(anchors[a][0] - anchors[b][0]);
  if (want.together) {
    for (const [a, b, ka, kb] of [[8, 12, "index", "middle"], [12, 16, "middle", "ring"], [16, 20, "ring", "pinky"]]) {
      const slack = gap(a, b) - knuckle(ka, kb);
      if (slack > 0.02) problems.push(`${m.slug}: ${ka}-${kb} tips splay ${slack.toFixed(3)} wider than the knuckles`);
    }
    notes.push(`tip gaps ${[[8, 12], [12, 16], [16, 20]].map(([a, b]) => gap(a, b).toFixed(2)).join("/")}`);
  }
  if (want.spreadV) {
    const v = dist(L[8], L[12]);
    if (v < 0.3) problems.push(`${m.slug}: V is only ${v.toFixed(2)} across, too narrow to read as scissors`);
    notes.push(`V ${v.toFixed(2)}`);
  }
  if (want.resembles) {
    const other = MUDRAS.find((x) => x.slug === want.resembles);
    if (other?.landmarks) {
      const apart = [8, 12].reduce((a, i) => a + dist(L[i], other.landmarks[i]), 0) / 2;
      notes.push(`vs ${want.resembles} ${apart.toFixed(3)}`);
      if (apart < 0.06) {
        warnings.push(
          `${m.slug}: its index and middle now sit ${apart.toFixed(3)} from ${want.resembles}'s, so the two mudras ` +
            `differ almost only in depth. classifyMudra separates them on distIdxMid alone and will confuse them.`,
        );
      }
    }
  }
  if (want.touch) {
    const d = dist(L[want.touch[0]], L[want.touch[1]]);
    if (d > 0.1) problems.push(`${m.slug}: tips ${want.touch.join(" and ")} must meet, they sit ${d.toFixed(3)} apart`);
    notes.push(`contact ${d.toFixed(3)}`);
  }
  for (const { at, degrees, straight } of want.hinges ?? []) {
    const turned = bendAt(L, at);
    if (Math.abs(turned - degrees) > 12) {
      problems.push(`${m.slug}: landmark ${at} should turn about ${degrees} degrees, it turns ${turned.toFixed(0)}`);
    }
    for (const s of straight) {
      const t = bendAt(L, s);
      if (t > 15) problems.push(`${m.slug}: landmark ${s} should stay straight, it turns ${t.toFixed(0)} degrees`);
    }
    // The shipped classifier reads a finger only as a straightness ratio, so a
    // single square hinge with straight segments either side scores too high
    // for it to call the finger bent. The pose is right; the threshold cannot
    // describe it. Flagged rather than silently bent further to suit the test.
    const digit = Object.entries(FINGER_IDX).find(([, v]) => v.includes(at));
    if (digit) {
      const s = extension(L, digit[1]);
      if (s >= 0.65) {
        warnings.push(
          `${m.slug}: ${digit[0]} hinges ${turned.toFixed(0)} degrees but scores ${s.toFixed(2)} on the ` +
            `classifier's straightness ratio, so isBent() (< 0.65) will not recognise it. ` +
            `classifyMudra will miss a correctly formed ${m.name}.`,
        );
      }
    }
    notes.push(`hinge@${at} ${turned.toFixed(0)}deg`);
  }
  if (want.thumbNear !== undefined) {
    // Across the palm only. Depth is checked separately, because matching the
    // landmark in all three axes would mean matching a bone that lies buried.
    const t = L[want.thumbNear];
    const across = Math.hypot(L[4][0] - t[0], L[4][1] - t[1]);
    if (across > 0.06) problems.push(`${m.slug}: thumb tip should come to rest over landmark ${want.thumbNear}, it sits ${across.toFixed(3)} off across the palm`);
    // Nothing may finish inside the hand.
    for (const [j, what] of [[3, "knuckle"], [4, "tip"]]) {
      if (L[j][2] < PALM_SKIN) problems.push(`${m.slug}: the thumb ${what} sinks into the palm (z ${L[j][2].toFixed(3)}, skin sits at ${PALM_SKIN})`);
    }
    notes.push(`thumb→${want.thumbNear} ${across.toFixed(3)} across, z ${L[4][2].toFixed(3)}`);
  }
  if (want.thumbUpright) {
    const seg = sub(L[3], L[2]);
    const up = seg[1] / (len(seg) || 1);
    if (up < 0.9) problems.push(`${m.slug}: the thumb's first segment leans off the fingers' axis (up ${up.toFixed(2)}, needs > 0.9)`);
    notes.push(`thumb upright ${up.toFixed(2)}`);
  }
  if (want.tiltForward) {
    const { from, to, min } = want.tiltForward;
    const forward = L[to][2] - L[from][2];
    if (forward < min) {
      problems.push(`${m.slug}: landmark ${from} should tip forward into depth, it carries only ${forward.toFixed(3)}`);
    }
    notes.push(`tilt ${forward.toFixed(3)}`);
  }
  if (want.leansForward) {
    const { knuckle, minForward, maxSideways } = want.leansForward;
    const tip = L[knuckle + 3];
    const forward = tip[2] - L[knuckle][2];
    const sideways = Math.abs(tip[0] - L[knuckle][0]);
    if (forward < minForward) problems.push(`${m.slug}: landmark ${knuckle} should lean forward, its tip is only ${forward.toFixed(3)} proud of the knuckle`);
    if (sideways > maxSideways) problems.push(`${m.slug}: landmark ${knuckle} is leaning sideways ${sideways.toFixed(3)}, it should lean forward instead`);
    notes.push(`forward ${forward.toFixed(2)}, sideways ${sideways.toFixed(2)}`);
  }
  for (const digit of want.curledInFront ?? []) {
    const knuckle = { ring: 13, pinky: 17 }[digit];
    const clear = L[knuckle + 3][2] - L[knuckle][2];
    if (clear < 0.04) {
      problems.push(`${m.slug}: the ${digit} should curl so its tip rests in front of its own knuckle, it clears only ${clear.toFixed(3)}`);
    }
    notes.push(`${digit} clears ${clear.toFixed(3)}`);
  }
  if (want.thumbCaps) {
    for (const t of want.thumbCaps) {
      if (L[4][2] < L[t][2]) problems.push(`${m.slug}: the thumb should cap landmark ${t}, it sits behind it`);
    }
    const reach = Math.min(...want.thumbCaps.map((t) => dist(L[4], L[t])));
    if (reach > 0.08) {
      const span = segments.thumb.reduce((a, b) => a + b, 0);
      warnings.push(
        `${m.slug}: the thumb should touch landmarks ${want.thumbCaps.join(" and ")}, but stops ${reach.toFixed(3)} short. ` +
          `It spans ${span.toFixed(3)} from a base at x ${anchors.thumb[0].toFixed(3)}, so it cannot pass x ` +
          `${(anchors.thumb[0] + span).toFixed(3)}, while the curled tips cannot come nearer than x 0.116. ` +
          `A real hand closes this by rotating the thumb at the carpal joint; this model has no carpal bone, so no ` +
          `choice of angles reaches. Needs a rigged thumb base, not a different pose.`,
      );
    }
    notes.push(`thumb reach ${reach.toFixed(3)}`);
  }
  if (want.thumbAcrossFist) {
    // Resting across something has two halves, and checking only one is how you
    // ship a thumb buried in the fingers it is supposed to be lying on. It has
    // to finish over their footprint, *and* stay in front of every one of them.
    const { over, margin } = want.thumbAcrossFist;
    const tip = L[4];
    const xs = over.map((i) => L[i][0]);
    const ys = over.map((i) => L[i][1]);
    const front = Math.max(...over.map((i) => L[i][2]));
    const within = (v, vs) => v >= Math.min(...vs) - margin && v <= Math.max(...vs) + margin;
    if (!within(tip[0], xs) || !within(tip[1], ys)) {
      problems.push(`${m.slug}: the thumb tip should finish over the folded fingers, it sits outside their span at x ${tip[0].toFixed(3)}, y ${tip[1].toFixed(3)}`);
    }
    // Every thumb joint that passes over the fist, not only the tip, and against
    // the fingers' *surface* rather than their bones.
    let worst = Infinity;
    for (const [j, what] of [[2, "metacarpal"], [3, "knuckle"], [4, "tip"]]) {
      const p = L[j];
      if (!within(p[0], xs) || !within(p[1], ys)) continue;
      const clear = p[2] - front;
      worst = Math.min(worst, clear);
      if (clear < 2 * DIGIT_FLESH) {
        problems.push(
          `${m.slug}: the thumb ${what} sits ${clear.toFixed(3)} in front of the fingers' bones, inside their flesh — ` +
            `two digits in contact need about ${(2 * DIGIT_FLESH).toFixed(3)} between bone centres`,
        );
      }
    }
    notes.push(`thumb clears the fist by ${(worst === Infinity ? 0 : worst).toFixed(3)}`);
  }
  if (want.thumbUp) {
    const { minRise, maxLean, clearsFist } = want.thumbUp;
    const rise = L[4][1] - L[1][1];
    const lean = Math.abs(L[4][2] - L[1][2]);
    const overFist = L[4][1] - Math.max(L[8][1], L[12][1], L[16][1], L[20][1]);
    if (rise < minRise) problems.push(`${m.slug}: the thumb should stand up, it rises only ${rise.toFixed(3)}`);
    if (lean > maxLean) problems.push(`${m.slug}: the thumb leans ${lean.toFixed(3)} out of vertical, it should point up rather than away`);
    if (overFist < clearsFist) problems.push(`${m.slug}: the thumb only clears the fist by ${overFist.toFixed(3)}`);
    notes.push(`thumb rises ${rise.toFixed(2)}, leans ${lean.toFixed(2)}, clears ${overFist.toFixed(2)}`);
  }
  if (want.thumbSquare) {
    // The corner between the thumb and the fingers it stands off. Measured on
    // the proximal phalanx rather than on the whole finger, because past the
    // first knuckle a fist curls back on itself and points nowhere useful.
    const { toKnuckle, degrees, tolerance } = want.thumbSquare;
    const corner = angleBetween(sub(L[4], L[1]), sub(L[toKnuckle + 1], L[toKnuckle]));
    if (Math.abs(corner - degrees) > tolerance) {
      problems.push(`${m.slug}: the thumb should stand ${degrees} degrees off the fingers, it stands ${corner.toFixed(1)}`);
    }
    notes.push(`thumb ${corner.toFixed(0)}deg off fingers`);
  }
  if (want.mcpBends) {
    // How far the knuckle has turned out of the palm's plane: the proximal
    // segment's angle from straight, positive forward, negative bent back.
    const turnedAt = (knuckle) => {
      const d = sub(L[knuckle + 1], L[knuckle]);
      return (Math.atan2(d[2], d[1]) * 180) / Math.PI;
    };
    const got = [];
    for (const [knuckle, want_] of Object.entries(want.mcpBends)) {
      const turned = turnedAt(Number(knuckle));
      got.push(turned.toFixed(0));
      if (Math.abs(turned - want_) > 6) {
        problems.push(`${m.slug}: knuckle ${knuckle} should turn ${want_} degrees, it turns ${turned.toFixed(0)}`);
      }
      // Real knuckles stop around 90 forward and 20 back.
      if (turned > 95 || turned < -20) {
        warnings.push(
          `${m.slug}: knuckle ${knuckle} is asked for ${want_} degrees, past the roughly -20 to 90 a real ` +
            `knuckle travels. Kept because it is the shape asked for, but it is not a bend a hand can make.`,
        );
      }
    }
    notes.push(`knuckles ${got.join("/")}`);
  }
  for (const knuckle of want.straightPast ?? []) {
    for (const j of [knuckle + 2, knuckle + 3]) {
      const t = bendAt(L, j - 1);
      if (t > 12) problems.push(`${m.slug}: landmark ${j - 1} should stay straight, it turns ${t.toFixed(0)} degrees`);
    }
  }
  if (want.maxSideways !== undefined && want.mcpBends) {
    const widest = Math.max(
      ...Object.keys(want.mcpBends).map((k) => Math.abs(L[Number(k) + 3][0] - L[Number(k)][0])),
    );
    if (widest > want.maxSideways) {
      problems.push(`${m.slug}: a fingertip strays ${widest.toFixed(3)} sideways from its knuckle; this fan opens through depth`);
    }
    notes.push(`sideways ${widest.toFixed(2)}`);
  }

  m.landmarks = L;
  report.push(
    `${m.slug.padEnd(14)} ext ${["thumb", "index", "middle", "ring", "pinky"].map((f) => e[f].toFixed(2)).join(" ")}` +
      (notes.length ? `   ${notes.join("  ")}` : ""),
  );
}

console.log("               thumb idx  mid  ring pky");
report.forEach((r) => console.log(r));

if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s) about the shipped classifier, not about these poses:`);
  warnings.forEach((w) => console.warn(`  - ${w}`));
}

if (problems.length) {
  console.error(`\n${problems.length} pose problem(s):`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exitCode = 1;
} else {
  console.log("\nall poses satisfy the classifier's rules for their own mudra");
}

// -------------------------------------------------------------------- output

const payload = {
  $comment: "GENERATED by scripts/build-mudra-poses.mjs from public/models/hand.glb. Do not edit by hand.",
  space: {
    note: "Right-handed, palm facing +Z. Wrist at the origin; one unit is the wrist-to-middle-fingertip reach.",
    order: "MediaPipe 21-landmark order: 0 wrist, 1-4 thumb, 5-8 index, 9-12 middle, 13-16 ring, 17-20 pinky.",
    joints:
      "Degrees. `abduct` swings the digit within the palm plane toward +X, `lift` (thumb only) tilts it off the palm, " +
      "and `flex` bends each joint in turn toward +Z. These are what a morph interpolates: blending angles bends the " +
      "joints through their real arc, where blending the landmarks below would slide fingertips along straight lines.",
    landmarks: "Derived from `joints`. Carried here so a consumer can read a pose without re-solving it.",
  },
  hand: {
    reach: Math.round(REACH * 10000) / 10000,
    anchors: Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, v.map((c) => Math.round(c * 10000) / 10000)])),
    segments: Object.fromEntries(Object.entries(segments).map(([k, v]) => [k, v.map((c) => Math.round(c * 10000) / 10000)])),
  },
  mudras: MUDRAS.map((m) => ({
    slug: m.slug,
    name: m.name,
    meaning: m.meaning,
    note: m.note,
    joints: {
      thumb: {
        abduct: m.solvedThumb.abduct,
        lift: m.solvedThumb.lift ?? 0,
        roll: m.solvedThumb.roll ?? 0,
        flex: m.solvedThumb.flex,
      },
      // Fingers carry lift and roll too, always zero, so every digit has the
      // same shape and a morph can blend them without special cases.
      index: { abduct: m.index.abduct, lift: 0, roll: 0, flex: m.index.flex },
      middle: { abduct: m.middle.abduct, lift: 0, roll: 0, flex: m.middle.flex },
      ring: { abduct: m.ring.abduct, lift: 0, roll: 0, flex: m.ring.flex },
      pinky: { abduct: m.pinky.abduct, lift: 0, roll: 0, flex: m.pinky.flex },
    },
    landmarks: m.landmarks,
  })),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(`\nwrote ${OUT}`);
