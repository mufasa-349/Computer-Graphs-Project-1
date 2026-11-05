// The control panel: one section per project part. Controls write straight into
// the shared app state; readouts are refreshed a few times per second by main.js.

import { section, row, slider, toggle, segmented, button, select, readout, hint, el } from './dom.js';
import { MODES } from '../scene/curve.js';
import { PAINTING } from '../scene/scene.js';

export function buildPanel(root, app) {
  const { state, camera, curve, actions } = app;
  const S = {}; // setters, used by sync() after a reset
  const R = {}; // readout elements

  const head = el('header', { class: 'panel-head' }, root);
  el('h1', { text: 'CS405 · Project 1' }, head);
  el('p', { class: 'sub', html: `<b>${PAINTING.artist}</b> — <i>${PAINTING.title}</i><br>Sakıp Sabancı Museum collection` }, head);

  /* ---------------- E · view, reset, debug ---------------- */
  const e = section(root, 'View & debug', 'Part E');
  S.view = segmented(row(e), [['main', 'Main camera', 'key 1'], ['inspection', 'Inspection', 'key 2'], ['split', 'Split', 'key 3']], state.view, (v) => actions.setView(v));
  const r1 = row(e);
  button(r1, 'Reset scene', () => actions.resetAll(), 'key R');
  S.paused = toggle(r1, 'Pause animation', state.paused, (v) => { state.paused = v; }, 'Space');
  const dbg = row(e, 'row wrap');
  S.axes = toggle(dbg, 'Node axes', state.debug.axes, (v) => { state.debug.axes = v; }, 'key X');
  S.links = toggle(dbg, 'Parent links', state.debug.links, (v) => { state.debug.links = v; });
  S.grid = toggle(dbg, 'Floor grid', state.debug.grid, (v) => { state.debug.grid = v; }, 'key G');
  S.frustum = toggle(dbg, 'Frustum', state.debug.frustum, (v) => { state.debug.frustum = v; }, 'key F');
  hint(e, 'Keys: <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> views · <kbd>P</kbd> projection · <kbd>O</kbd> TRS/SRT · <kbd>X</kbd> axes · <kbd>Space</kbd> pause · <kbd>R</kbd> reset');

  /* ---------------- A · transformations ---------------- */
  const a = section(root, 'Transformations', 'Part A · 20');
  const A = state.partA;
  S.order = segmented(row(a), [['TRS', 'M = T · R · S'], ['SRT', 'M = S · R · T']], A.order, (v) => { A.order = v; });
  S.tx = slider(a, 'translate x', { min: -3, max: 3, step: 0.01, value: A.t[0] }, (v) => { A.t[0] = v; });
  S.ty = slider(a, 'translate y', { min: -1, max: 4, step: 0.01, value: A.t[1] }, (v) => { A.t[1] = v; });
  S.tz = slider(a, 'translate z', { min: -1, max: 4, step: 0.01, value: A.t[2] }, (v) => { A.t[2] = v; });
  const axisRow = row(a);
  el('span', { class: 'lbl', text: 'rotation axis' }, axisRow);
  S.axis = segmented(axisRow, [['x', 'x'], ['y', 'y'], ['z', 'z']], A.axis, (v) => { A.axis = v; });
  S.angle = slider(a, 'angle', { min: -180, max: 180, step: 1, value: A.angleDeg, digits: 0, unit: '°' }, (v) => { A.angleDeg = v; });
  const setScale = (i) => (v) => {
    if (A.uniform) { A.s = [v, v, v]; S.sx.set(v); S.sy.set(v); S.sz.set(v); } else A.s[i] = v;
  };
  S.sx = slider(a, 'scale x', { min: 0.1, max: 2.5, step: 0.01, value: A.s[0] }, setScale(0));
  S.sy = slider(a, 'scale y', { min: 0.1, max: 2.5, step: 0.01, value: A.s[1] }, setScale(1));
  S.sz = slider(a, 'scale z', { min: 0.1, max: 2.5, step: 0.01, value: A.s[2] }, setScale(2));
  const ar = row(a);
  S.uniform = toggle(ar, 'Uniform scale', A.uniform, (v) => { A.uniform = v; if (v) setScale(0)(A.s[0]); });
  S.ghost = toggle(ar, 'Ghost of other order', A.ghost, (v) => { A.ghost = v; });
  R.matrices = el('div', { class: 'matpair' }, a);
  hint(a, 'Solid box = active order; wireframe = the other order with the <i>same</i> T, R and S. The rest of the code uses <b>T·R·S</b> (scale, then rotate, then translate).');

  /* ---------------- B · scene graph ---------------- */
  const b = section(root, 'Scene graph', 'Part B · 15', false);
  S.speed = slider(b, 'animation speed', { min: 0, max: 3, step: 0.05, value: state.animSpeed }, (v) => { state.animSpeed = v; });
  R.tree = readout(b, 'small');
  R.leaf = readout(b, 'small');

  /* ---------------- C · camera ---------------- */
  const c = section(root, 'Camera & projection', 'Part C · 20');
  S.projection = segmented(row(c), [['perspective', 'Perspective'], ['orthographic', 'Orthographic']], camera.projection, (v) => { camera.projection = v; });
  S.fov = slider(c, 'fov y', { min: 10, max: 120, step: 1, value: camera.fovDeg, digits: 0, unit: '°' }, (v) => { camera.fovDeg = v; });
  S.near = slider(c, 'near', { min: 0.01, max: 3, step: 0.01, value: camera.near }, (v) => { camera.near = Math.min(v, camera.far - 0.01); });
  S.far = slider(c, 'far', { min: 2, max: 100, step: 0.5, value: camera.far, digits: 1 }, (v) => { camera.far = Math.max(v, camera.near + 0.01); });
  const cr = row(c);
  button(cr, 'Reset camera', () => actions.resetCamera());
  button(cr, 'Look straight down', () => actions.topView(), 'pitch = 90°: up is parallel to the view direction');
  hint(c, 'Drag = orbit · right-drag or Shift-drag = pan · wheel = zoom. Works in either view.');
  R.camera = readout(c, 'small');

  /* ---------------- D · curves ---------------- */
  const d = section(root, 'Curves over the painting', 'Part D · 25');
  S.mode = select(d, 'curve', Object.entries(MODES), curve.mode, (v) => { curve.mode = v; curve.changed(); });
  S.s = slider(d, 'parameter s', { min: 0, max: 1, step: 0.001, value: state.curveUI.s, digits: 3 }, (v) => {
    state.curveUI.s = v; state.curveUI.fraction = v; state.curveUI.animate = false; S.animate.set(false);
  });
  const dr = row(d, 'row wrap');
  S.animate = toggle(dr, 'Animate follower', state.curveUI.animate, (v) => { state.curveUI.animate = v; });
  S.polygon = toggle(dr, 'Control polygon', state.debug.polygon, (v) => { state.debug.polygon = v; });
  S.casteljau = toggle(dr, 'de Casteljau', state.debug.casteljau, (v) => { state.debug.casteljau = v; });
  S.cspeed = slider(d, 'follower speed', { min: 0.02, max: 0.6, step: 0.01, value: state.curveUI.speed }, (v) => { state.curveUI.speed = v; });
  const dr2 = row(d, 'row wrap');
  button(dr2, 'Remove last segment', () => actions.removeSegment());
  button(dr2, 'Reset curve', () => actions.resetCurve());
  button(dr2, 'Export JSON', () => actions.exportJSON());
  const file = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' }, dr2);
  file.addEventListener('change', () => { if (file.files[0]) actions.importJSON(file.files[0]); file.value = ''; });
  button(dr2, 'Import JSON', () => file.click());
  hint(d, 'Drag the round knots or square handles <i>on the painting</i> (main view). <b>Double-click</b> the painting to append a segment. In Bézier mode the opposite handle mirrors the one you drag, keeping C¹.');
  R.curve = readout(d, 'small');
  R.json = readout(d, 'small json');
  R.json.hidden = true;

  /* ---------------- bonus ---------------- */
  const x = section(root, 'Bonus', '+10', false);
  S.revolution = toggle(x, 'Swept melon (surface of revolution)', state.bonus.revolution, (v) => { state.bonus.revolution = v; });
  hint(x, 'The traced outline is revolved around the horizontal line through its lower end point and placed on the plate. Edit the curve and the mesh is rebuilt.');
  const xr = row(x, 'row wrap');
  S.freehand = toggle(xr, 'Freehand trace → least-squares fit', state.bonus.freehand, (v) => { state.bonus.freehand = v; });
  button(xr, 'Clear fit', () => actions.clearFit());
  hint(x, 'With freehand on, drag across the painting to sketch a stroke; on release one cubic Bézier is fitted to it by least squares (magenta).');
  R.fit = readout(x, 'small');

  function sync() {
    S.view.set(state.view); S.paused.set(state.paused);
    S.axes.set(state.debug.axes); S.links.set(state.debug.links); S.grid.set(state.debug.grid); S.frustum.set(state.debug.frustum);
    S.order.set(A.order); S.tx.set(A.t[0]); S.ty.set(A.t[1]); S.tz.set(A.t[2]); S.axis.set(A.axis); S.angle.set(A.angleDeg);
    S.sx.set(A.s[0]); S.sy.set(A.s[1]); S.sz.set(A.s[2]); S.uniform.set(A.uniform); S.ghost.set(A.ghost);
    S.speed.set(state.animSpeed);
    S.projection.set(camera.projection); S.fov.set(camera.fovDeg); S.near.set(camera.near); S.far.set(camera.far);
    S.mode.set(curve.mode); S.s.set(state.curveUI.s); S.animate.set(state.curveUI.animate); S.cspeed.set(state.curveUI.speed);
    S.polygon.set(state.debug.polygon); S.casteljau.set(state.debug.casteljau);
    S.revolution.set(state.bonus.revolution); S.freehand.set(state.bonus.freehand);
  }

  return { S, R, sync };
}
