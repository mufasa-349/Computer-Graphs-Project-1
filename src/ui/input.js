// Mouse interaction. Picking works in the painting's plane: a pixel is turned
// into a ray by unprojecting NDC (x, y, 0) and (x, y, 1) with (P·V)⁻¹, the ray is
// moved into the painting's local frame with the rigid inverse of its world
// matrix, and intersected with z = 0.

import { invert, invertRigid, transformPoint, transformVec4 } from '../math/mat4.js';
import { PAINTING, paintingLocal } from '../scene/scene.js';

const PICK_RADIUS = 13; // CSS px

export function attachInput(canvas, ctx) {
  const { camera, curve, state } = ctx;
  let mode = null, last = null, dragIndex = -1;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const ndcIn = ([x, y], rect) => [((x - rect.x) / rect.w) * 2 - 1, 1 - ((y - rect.y) / rect.h) * 2];

  /** Ray through a pixel of the main view, intersected with the painting → (u, v) or null. */
  function rayToUV(px, rect) {
    const inv = invert(ctx.mainViewProj());
    if (!inv) return null;
    const [x, y] = ndcIn(px, rect);
    const toLocal = invertRigid(ctx.paintingWorld());
    const a = transformPoint(toLocal, transformPoint(inv, [x, y, 0]));
    const b = transformPoint(toLocal, transformPoint(inv, [x, y, 1]));
    const dz = b[2] - a[2];
    if (Math.abs(dz) < 1e-9) return null;
    const t = -a[2] / dz;
    if (t < 0) return null;
    const lx = a[0] + t * (b[0] - a[0]), ly = a[1] + t * (b[1] - a[1]);
    return [lx / PAINTING.width + 0.5, ly / PAINTING.height + 0.5];
  }

  /** Screen position (CSS px) of a painting-space point in the main view. */
  function uvToScreen(uv, rect) {
    const w = transformPoint(ctx.paintingWorld(), paintingLocal(uv[0], uv[1], 0.02));
    const c = transformVec4(ctx.mainViewProj(), [w[0], w[1], w[2], 1]);
    if (c[3] <= 1e-6) return null;
    return [rect.x + (c[0] / c[3] * 0.5 + 0.5) * rect.w, rect.y + (0.5 - c[1] / c[3] * 0.5) * rect.h];
  }

  function nearestPoint(px, rect) {
    let best = -1, bestD = PICK_RADIUS * PICK_RADIUS;
    for (const i of curve.editableIndices()) {
      const s = uvToScreen(curve.points[i], rect);
      if (!s) continue;
      const d = (s[0] - px[0]) ** 2 + (s[1] - px[1]) ** 2;
      // prefer knots slightly when a handle sits on top of one
      if (d < bestD || (d === bestD && i % 3 === 0)) { bestD = d; best = i; }
    }
    return best;
  }

  const inside = (uv) => uv && uv[0] >= 0 && uv[0] <= 1 && uv[1] >= 0 && uv[1] <= 1;

  canvas.addEventListener('pointerdown', (e) => {
    const px = local(e), view = ctx.viewAt(px);
    if (!view) return;
    canvas.setPointerCapture(e.pointerId);
    last = px;
    const wantsPan = e.button === 2 || e.button === 1 || e.shiftKey;
    if (e.button === 0 && !e.shiftKey && view.kind === 'main') {
      if (state.bonus.freehand) {
        const uv = rayToUV(px, view.rect);
        if (inside(uv)) { mode = 'trace'; curve.trace = [uv]; return; }
      } else {
        dragIndex = nearestPoint(px, view.rect);
        if (dragIndex >= 0) { mode = 'drag'; ctx.setActivePoint(dragIndex); canvas.style.cursor = 'grabbing'; return; }
      }
    }
    mode = wantsPan ? 'pan' : 'orbit';
    canvas.style.cursor = 'move';
  });

  canvas.addEventListener('pointermove', (e) => {
    const px = local(e);
    if (!mode) {
      // hover feedback
      const view = ctx.viewAt(px);
      if (view?.kind === 'main' && !state.bonus.freehand) {
        const i = nearestPoint(px, view.rect);
        ctx.setActivePoint(i);
        canvas.style.cursor = i >= 0 ? 'grab' : state.bonus.freehand ? 'crosshair' : 'default';
      } else {
        ctx.setActivePoint(-1);
        canvas.style.cursor = state.bonus.freehand && view?.kind === 'main' ? 'crosshair' : 'default';
      }
      return;
    }
    const dx = px[0] - last[0], dy = px[1] - last[1];
    last = px;
    if (mode === 'orbit') camera.orbit(dx, dy);
    else if (mode === 'pan') camera.pan(dx, dy);
    else if (mode === 'drag' || mode === 'trace') {
      const rect = ctx.mainRect();
      if (!rect) return;
      const uv = rayToUV(px, rect);
      if (!uv) return;
      const clamped = [Math.min(1, Math.max(0, uv[0])), Math.min(1, Math.max(0, uv[1]))];
      if (mode === 'drag') curve.move(dragIndex, clamped);
      else {
        const p = curve.trace[curve.trace.length - 1];
        if (Math.hypot(clamped[0] - p[0], clamped[1] - p[1]) > 0.003) curve.trace.push(clamped);
      }
    }
  });

  const end = (e) => {
    if (mode === 'trace') {
      curve.fitTrace();
      curve.trace = [];
    }
    if (mode) canvas.releasePointerCapture?.(e.pointerId);
    mode = null; dragIndex = -1;
    canvas.style.cursor = 'default';
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('dblclick', (e) => {
    const px = local(e), view = ctx.viewAt(px);
    if (view?.kind !== 'main' || state.bonus.freehand) return;
    const uv = rayToUV(px, view.rect);
    if (inside(uv) && nearestPoint(px, view.rect) < 0) curve.addKnot(uv);
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
