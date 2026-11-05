// Application entry: owns the state, runs the frame loop and glues together
// maths (src/math), scene (src/scene), rendering (src/render) and UI (src/ui).

import {
  identity, multiply, multiplyAll, translate, scale, rotateAxis, rotateY, fromBasis,
  normalMatrix, invert, lookAt, format as fmt, transformPoint,
} from './math/mat4.js';
import { normalize, cross, length as len3 } from './math/vec3.js';
import { deCasteljau, paramAtFraction } from './math/curves.js';
import { buildScene, PAINTING, paintingLocal } from './scene/scene.js';
import { OrbitCamera, FixedCamera } from './scene/camera.js';
import { CurveModel } from './scene/curve.js';
import { Renderer } from './render/renderer.js';
import { Batch } from './render/immediate.js';
import * as G from './render/geometry.js';
import * as O from './render/overlays.js';
import { buildPanel } from './ui/panel.js';
import { attachInput } from './ui/input.js';

const DEG = Math.PI / 180;

const defaultState = () => ({
  view: 'main',                 // 'main' | 'inspection' | 'split'
  paused: false,
  animSpeed: 1,
  time: 0,
  debug: { axes: false, links: false, grid: true, frustum: true, polygon: true, casteljau: true },
  partA: { order: 'TRS', t: [-1.7, 2.3, 2.0], axis: 'y', angleDeg: 35, s: [0.5, 0.5, 0.5], uniform: true, ghost: true },
  curveUI: { animate: true, speed: 0.12, s: 0.45, fraction: 0.45 },
  bonus: { revolution: true, freehand: false },
});

const state = defaultState();
const camera = new OrbitCamera();
const inspectCam = new FixedCamera([13.5, 12, 14.5], [0, 1.0, 0.0], 58, 0.1, 200);
const curve = new CurveModel();
const scene = buildScene();

const canvas = document.getElementById('gpu');
const hud = document.getElementById('hud');
const labels = document.getElementById('labels');
let renderer = null;
let activePoint = -1;
let mainDegenerate = false;
let melonVersion = -1;

const app = {
  state, camera, curve,
  actions: {
    setView(v) { state.view = v; panel.S.view.set(v); },
    resetCamera() { camera.reset(); panel.sync(); },
    topView() { camera.pitch = Math.PI / 2; },
    resetCurve() { curve.reset(); state.curveUI = defaultState().curveUI; panel.sync(); },
    removeSegment() { curve.removeLastSegment(); },
    clearFit() { curve.fit = null; },
    resetAll() {
      const fresh = defaultState();
      for (const k of Object.keys(fresh)) state[k] = fresh[k];
      camera.reset(); curve.reset();
      panel.sync();
    },
    exportJSON() {
      const json = JSON.stringify(curve.toJSON(), null, 2);
      panel.R.json.hidden = false;
      panel.R.json.textContent = json;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'curve.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    async importJSON(file) {
      try { curve.fromJSON(JSON.parse(await file.text())); panel.sync(); }
      catch (err) { alert('Could not read curve JSON: ' + err.message); }
    },
  },
};

const panel = buildPanel(document.getElementById('panel'), app);

/* ------------------------------------------------------------ viewports */

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

/** Viewports in device pixels. In split view the main camera gets the left half. */
function viewports() {
  const W = canvas.width, H = canvas.height;
  if (state.view === 'split') {
    const gap = Math.round(2 * dpr()), half = Math.floor((W - gap) / 2);
    return [{ kind: 'main', rect: [0, 0, half, H] }, { kind: 'inspection', rect: [half + gap, 0, W - half - gap, H] }];
  }
  return [{ kind: state.view, rect: [0, 0, W, H] }];
}
const mainAspect = () => {
  const v = viewports().find((x) => x.kind === 'main');
  return v ? v.rect[2] / v.rect[3] : canvas.width / canvas.height;
};
const toCss = ([x, y, w, h]) => { const k = dpr(); return { x: x / k, y: y / k, w: w / k, h: h / k }; };

/* ------------------------------------------------------------ per-frame updates */

function partAMatrices() {
  const A = state.partA;
  const T = translate(...A.t), R = rotateAxis(A.axis, A.angleDeg * DEG), S = scale(...A.s);
  return { T, R, S, TRS: multiplyAll(T, R, S), SRT: multiplyAll(S, R, T) };
}

function updateFollower(dt) {
  const cu = state.curveUI;
  if (cu.animate && !state.paused) {
    cu.fraction = (cu.fraction + dt * cu.speed) % 1;
    cu.s = paramAtFraction(curve.table, cu.fraction); // constant speed along the arc
  }
  const { point, tangent } = curve.evaluate(cu.s);
  // tangent from (u, v) space to the painting's physical units, then an orthonormal frame:
  // x along the tangent, z out of the painting, y = z × x
  let x = normalize([tangent[0] * PAINTING.width, tangent[1] * PAINTING.height, 0]);
  if (len3(x) < 1e-6) x = [1, 0, 0];
  const z = [0, 0, 1], y = cross(z, x);
  scene.follower.local = multiply(fromBasis(x, y, z, paintingLocal(point[0], point[1], 0.16)), scale(0.45, 0.45, 0.45));
}

function updateMelon() {
  scene.melon.visible = state.bonus.revolution;
  if (!state.bonus.revolution || melonVersion === curve.version) return;
  melonVersion = curve.version;
  const profile = curve.revolutionProfile(80);
  renderer.uploadMesh('revolution', G.revolve(profile, 56));
  const xs = profile.map((p) => p[0]), rmax = Math.max(...profile.map((p) => p[1]));
  const k = 0.95 / Math.max(1e-3, Math.max(...xs) - Math.min(...xs));
  scene.melon.local = multiplyAll(translate(0, rmax * k + 0.015, 0), rotateY(0.45), scale(k, k, k));
}

/* ------------------------------------------------------------ overlays */

const C = {
  curve: O.rgba('#ffd54a'), polygon: O.rgba('#ffffff', 0.75), knot: O.rgba('#e2572b'), handle: O.rgba('#ffffff'),
  border: O.rgba('#111111'), active: O.rgba('#7cfc00'), fit: O.rgba('#e056fd'), trace: O.rgba('#e056fd', 0.8),
  cast: [O.rgba('#6fb3e0'), O.rgba('#7cc478'), O.rgba('#f07a4a')], grid: O.rgba('#8a857c', 0.35),
  ghost: O.rgba('#9be39b'), link: O.rgba('#dddddd', 0.7), frustum: O.rgba('#ff7a45'), eye: O.rgba('#ffd54a'),
};
const tris = new Batch(), lines = new Batch(), inspectLines = new Batch();
const toPhys = ([u, v]) => [(u - 0.5) * PAINTING.width, (v - 0.5) * PAINTING.height];

function buildOverlays(mainVP, ghostM) {
  tris.clear(); lines.clear(); inspectLines.clear();
  const M = scene.painting.world;

  // --- curve, control polygon, points (Part D)
  O.ribbon(tris, M, curve.sample(260).map(toPhys), 0.026, C.curve, 0.012);
  const ctrl = curve.mode === 'bezier' ? curve.points : curve.knots();
  if (state.debug.polygon) O.dashedRibbon(tris, M, ctrl.flatMap((p, i) => (i ? O.segment2(toPhys(ctrl[i - 1]), toPhys(p)).slice(1) : [toPhys(p)])), 0.009, C.polygon, 0.014, 0.06);

  if (state.debug.casteljau && curve.mode === 'bezier') {
    const { t, control } = curve.segmentAt(state.curveUI.s);
    const levels = deCasteljau(control, t);
    for (let L = 1; L < levels.length; L++) {
      const pts = levels[L].map(toPhys);
      if (pts.length > 1) O.ribbon(tris, M, pts, 0.011, C.cast[L - 1], 0.016 + L * 0.001);
      for (const p of pts) O.disc(tris, M, p, L === 3 ? 0.045 : 0.028, C.cast[L - 1], 0.02 + L * 0.001);
    }
  }

  curve.editableIndices().forEach((i) => {
    const p = toPhys(curve.points[i]), knot = i % 3 === 0 || curve.mode !== 'bezier', hot = i === activePoint;
    if (knot) { O.disc(tris, M, p, 0.062, C.border, 0.024); O.disc(tris, M, p, 0.048, hot ? C.active : C.knot, 0.026); }
    else { O.square(tris, M, p, 0.042, C.border, 0.024); O.square(tris, M, p, 0.03, hot ? C.active : C.handle, 0.026); }
  });

  // --- freehand stroke and least-squares fit (bonus)
  if (curve.trace.length > 1) O.ribbon(tris, M, curve.trace.map(toPhys), 0.012, C.trace, 0.03);
  if (curve.fit) {
    const [p0, p1, p2, p3] = curve.fit.points.map(toPhys), pts = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120, u = 1 - t;
      pts.push([0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]));
    }
    O.ribbon(tris, M, pts, 0.02, C.fit, 0.03);
    O.dashedRibbon(tris, M, [...O.segment2(p0, p1), ...O.segment2(p1, p2).slice(1), ...O.segment2(p2, p3).slice(1)], 0.007, C.fit, 0.031, 0.05);
    for (const p of [p0, p1, p2, p3]) O.square(tris, M, p, 0.03, C.fit, 0.032);
  }

  // --- debug: grid, node axes and parent links (Part B / E)
  if (state.debug.grid) for (let i = -8; i <= 8; i++) {
    lines.line([i, 0.002, -8], [i, 0.002, 8], C.grid);
    lines.line([-8, 0.002, i], [8, 0.002, i], C.grid);
  }
  if (state.debug.axes) {
    O.axes(lines, identity(), 0.8);
    scene.root.traverse((n) => { if (n !== scene.root && n.showAxes && n.visible) O.axes(lines, n.world, 0.3); });
  }
  if (state.debug.links) scene.root.traverse((n) => {
    if (n.parent && n.showAxes) lines.line(transformPoint(n.parent.world, [0, 0, 0]), transformPoint(n.world, [0, 0, 0]), C.link);
  });

  // --- Part A: wireframe of the other composition order
  if (state.partA.ghost) O.wireBox(lines, ghostM, C.ghost);

  // --- inspection view only: the main camera's frustum (Part C)
  if (state.debug.frustum) {
    const inv = invert(mainVP);
    if (inv) O.frustum(inspectLines, inv, camera.eye, C.frustum, camera.projection === 'perspective');
    inspectLines.line(camera.eye, camera.target, C.eye);
    const t = camera.target;
    for (const d of [[0.15, 0, 0], [0, 0.15, 0], [0, 0, 0.15]]) inspectLines.line([t[0] - d[0], t[1] - d[1], t[2] - d[2]], [t[0] + d[0], t[1] + d[1], t[2] + d[2]], C.eye);
  }
}

/* ------------------------------------------------------------ readouts */

const perf = { frames: [], cpu: 0, last: performance.now(), lastUi: 0, stats: { vertices: 0, drawCalls: 0 } };
const v3 = (v, d = 2) => `(${v.map((x) => x.toFixed(d)).join(', ')})`;

function treeText() {
  const lines = [];
  const walk = (n, prefix, last) => {
    const meshKids = n.children.filter((c) => !c.showAxes).length;
    const label = `${n.name}${n.update ? '  ⟳ animated' : ''}${meshKids ? `  (+${meshKids} mesh part${meshKids > 1 ? 's' : ''})` : ''}`;
    lines.push(prefix + (n.parent ? (last ? '└─ ' : '├─ ') : '') + label);
    const kids = n.children.filter((c) => c.showAxes);
    kids.forEach((c, i) => walk(c, prefix + (n.parent ? (last ? '   ' : '│  ') : ''), i === kids.length - 1));
  };
  walk(scene.root, '', true);
  return lines.join('\n');
}

function refreshReadouts(mainV, mainP) {
  const R = panel.R;
  // Part A
  const m = partAMatrices(), active = state.partA.order;
  R.matrices.innerHTML = ['TRS', 'SRT'].map((k) => `
    <div class="mat ${k === active ? 'active' : ''}">
      <div class="cap">${k === 'TRS' ? 'T · R · S' : 'S · R · T'}${k === active ? ' (active)' : ''}</div>
      <pre>${fmt(m[k], 2, 6)}</pre>
    </div>`).join('');

  // Part B
  R.tree.textContent = treeText();
  const fig = scene.fig, path = fig.path().slice(1);
  const manual = multiplyAll(...path.map((n) => n.local));
  let diff = 0;
  for (let i = 0; i < 16; i++) diff = Math.max(diff, Math.abs(manual[i] - fig.world[i]));
  R.leaf.textContent =
    `world(fig) = M_world · ${path.map((n) => 'M_' + n.name.replace(/\s+/g, '_')).join(' · ')}\n           (M_world = I)\n` +
    `${fmt(fig.world, 3, 8)}\n` +
    `fig origin in world: ${v3(transformPoint(fig.world, [0, 0, 0]), 3)}\n` +
    `|product of locals − traversal| = ${diff.toExponential(1)}\n` +
    `t = ${state.time.toFixed(2)} s`;

  // Part C
  const eye = camera.eye, d = camera.distance;
  const zTarget = camera.projection === 'perspective'
    ? (camera.far / (camera.far - camera.near)) * (1 - camera.near / d)
    : (d - camera.near) / (camera.far - camera.near);
  R.camera.textContent =
    `projection : ${camera.projection}\n` +
    `eye        : ${v3(eye)}\ntarget     : ${v3(camera.target)}\nup         : ${v3(camera.up, 0)}\n` +
    `yaw/pitch  : ${(camera.yaw / DEG).toFixed(1)}° / ${(camera.pitch / DEG).toFixed(1)}°   distance ${d.toFixed(2)}\n` +
    `fov y      : ${camera.fovDeg.toFixed(0)}°\nnear / far : ${camera.near.toFixed(2)} / ${camera.far.toFixed(1)}   (far/near = ${(camera.far / camera.near).toFixed(0)})\n` +
    (camera.projection === 'orthographic' ? `ortho h    : ${camera.orthoHeight.toFixed(2)} (matches perspective at the target)\n` : '') +
    `depth(target) in NDC: ${zTarget.toFixed(4)}\n` +
    `lookAt     : ${mainDegenerate ? 'up ∥ view direction → fallback axis used' : 'regular (u = up × w ≠ 0)'}\n\n` +
    `V = lookAt(eye, target, up)\n${fmt(mainV, 3, 8)}\n\nP (${camera.projection})\n${fmt(mainP, 3, 8)}`;

  // Part D
  const cu = state.curveUI, ev = curve.evaluate(cu.s);
  const seg = curve.mode === 'bezier' ? curve.segmentAt(cu.s) : null;
  panel.S.s.set(cu.s);
  R.curve.textContent =
    `type        : ${curve.mode}\nsegments    : ${curve.segments()}   control points: ${curve.mode === 'bezier' ? curve.points.length : curve.knots().length}\n` +
    `s           : ${cu.s.toFixed(3)}${seg ? `   → segment ${seg.seg}, t = ${seg.t.toFixed(3)}` : ''}\n` +
    `C(s)  (u,v) : ${v3(ev.point, 3)}\nC'(s) (u,v) : ${v3(ev.tangent, 3)}\n` +
    `C¹ error at joints : ${curve.c1Error().toExponential(1)}\n` +
    `curve length       : ${curve.table.total.toFixed(3)} world units`;

  // bonus
  R.fit.textContent = curve.fit
    ? `least-squares fit of ${curve.fit.samples} samples\nRMS error: ${curve.fit.rms.toFixed(4)} world units\n` +
      curve.fit.points.map((p, i) => `P${i} = ${v3(p, 3)}`).join('\n')
    : 'no fit yet — enable freehand and drag over the painting';

  // HUD
  const f = perf.frames, avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
  const worst = Math.max(0, ...f);
  hud.innerHTML =
    `<b>${avg.toFixed(2)} ms</b> frame (${(1000 / Math.max(avg, 1e-3)).toFixed(0)} fps) · worst ${worst.toFixed(1)} ms<br>` +
    `CPU ${perf.cpu.toFixed(2)} ms · GPU ${renderer.gpuMs != null ? renderer.gpuMs.toFixed(2) + ' ms' : 'n/a'}<br>` +
    `<b>${perf.stats.vertices.toLocaleString()}</b> vertices / frame · ${perf.stats.drawCalls} draw calls<br>` +
    `<span class="gpu">${renderer.adapterName} · ${canvas.width}×${canvas.height}</span>`;
}

/* ------------------------------------------------------------ frame loop */

function frame(now) {
  const dt = Math.min(0.1, (now - perf.last) / 1000);
  perf.frames.push(now - perf.last);
  if (perf.frames.length > 60) perf.frames.shift();
  perf.last = now;
  const t0 = performance.now();

  if (!state.paused) state.time += dt * state.animSpeed;
  scene.root.animate(state.time);

  const A = partAMatrices();
  scene.partA.local = state.partA.order === 'TRS' ? A.TRS : A.SRT;
  const ghostM = state.partA.order === 'TRS' ? A.SRT : A.TRS;
  updateFollower(dt);
  updateMelon();
  scene.root.updateWorld(identity());

  const mainV = camera.view();
  mainDegenerate = lookAt.lastDegenerate;
  const mainP = camera.projectionMatrix(mainAspect());
  const mainVP = multiply(mainP, mainV);
  buildOverlays(mainVP, multiply(scene.partA.parent.world, ghostM));

  const objects = [];
  scene.root.traverse((n) => {
    if (!n.mesh || !n.visible) return;
    let hidden = false;
    for (let p = n.parent; p; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    objects.push({ mesh: n.mesh, model: n.world, normalMat: normalMatrix(n.world), color: O.linear3(n.color), lit: n.lit, painting: n.mesh === 'painting' });
  });

  const views = viewports().map((v) => {
    const aspect = v.rect[2] / v.rect[3];
    return v.kind === 'main'
      ? { rect: v.rect, viewProj: mainVP, eye: camera.eye, inspection: false }
      : { rect: v.rect, viewProj: inspectCam.viewProj(aspect), eye: inspectCam.eye, inspection: true };
  });

  perf.stats = renderer.render({ views, objects, tris, lines, inspectLines, clearColor: [0.09, 0.09, 0.1] });
  perf.cpu = performance.now() - t0;

  if (now - perf.lastUi > 150) {
    perf.lastUi = now;
    refreshReadouts(mainV, mainP);
    placeLabels();
  }
  requestAnimationFrame(frame);
}

function placeLabels() {
  labels.innerHTML = viewports().map((v) => {
    const r = toCss(v.rect);
    const text = v.kind === 'main' ? `Main camera · ${camera.projection}` : 'Inspection camera (fixed) — orange: main camera frustum';
    return `<div class="vlabel" style="left:${r.x + r.w - 8}px;top:${r.y + 8}px">${text}</div>`;
  }).join('');
}

/* ------------------------------------------------------------ boot */

function resize() {
  const r = canvas.getBoundingClientRect();
  renderer.resize(r.width * dpr(), r.height * dpr());
}

function keys(e) {
  if (e.target.closest('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if (k === '1') app.actions.setView('main');
  else if (k === '2') app.actions.setView('inspection');
  else if (k === '3') app.actions.setView('split');
  else if (k === 'p') { camera.projection = camera.projection === 'perspective' ? 'orthographic' : 'perspective'; panel.sync(); }
  else if (k === 'o') { state.partA.order = state.partA.order === 'TRS' ? 'SRT' : 'TRS'; panel.sync(); }
  else if (k === 'x') { state.debug.axes = !state.debug.axes; state.debug.links = state.debug.axes; panel.sync(); }
  else if (k === 'g') { state.debug.grid = !state.debug.grid; panel.sync(); }
  else if (k === 'f') { state.debug.frustum = !state.debug.frustum; panel.sync(); }
  else if (k === 'r') app.actions.resetAll();
  else if (k === ' ') { e.preventDefault(); state.paused = !state.paused; panel.sync(); }
  else return;
  if (e.target.tagName === 'BUTTON') e.target.blur();
}

async function main() {
  try {
    renderer = await Renderer.create(canvas);
  } catch (err) {
    document.getElementById('error').hidden = false;
    document.getElementById('error-msg').textContent = err.message;
    console.error(err);
    return;
  }
  renderer.uploadMesh('cube', G.cube());
  renderer.uploadMesh('sphere', G.sphere());
  renderer.uploadMesh('cylinder', G.cylinder());
  renderer.uploadMesh('quad', G.quad());
  renderer.uploadMesh('painting', G.quad());
  renderer.uploadMesh('arrow', G.arrow());
  await renderer.loadTexture(import.meta.env.BASE_URL + 'kavunlu-naturmort.jpg');

  new ResizeObserver(resize).observe(canvas);
  resize();
  window.addEventListener('keydown', keys);
  attachInput(canvas, {
    camera, curve, state,
    mainViewProj: () => multiply(camera.projectionMatrix(mainAspect()), camera.view()),
    paintingWorld: () => scene.painting.world,
    viewAt([x, y]) {
      for (const v of viewports()) {
        const r = toCss(v.rect);
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return { kind: v.kind, rect: r };
      }
      return null;
    },
    mainRect: () => { const v = viewports().find((x) => x.kind === 'main'); return v ? toCss(v.rect) : null; },
    setActivePoint: (i) => { activePoint = i; },
  });
  requestAnimationFrame((t) => { perf.last = t; requestAnimationFrame(frame); });
}

main();
