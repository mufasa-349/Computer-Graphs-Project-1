// Helpers that turn curves, points and debug shapes into immediate-mode
// triangles/lines (see immediate.js). Colours given in sRGB hex are converted
// to linear here, because all shading happens in linear space.

import { transformPoint, transformDir } from '../math/mat4.js';
import { normalize, add, scale } from '../math/vec3.js';

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function rgba(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return [toLinear(((n >> 16) & 255) / 255), toLinear(((n >> 8) & 255) / 255), toLinear((n & 255) / 255), a];
}
export const linear3 = (rgb) => rgb.map(toLinear);

/**
 * A flat ribbon along a polyline that lies in a plane (the painting): each point
 * is pushed sideways by ±width/2 along the in-plane normal. M maps plane-local
 * coordinates to world space. Thick, anti-aliased-looking lines without relying
 * on line width support (WebGPU lines are always 1 px).
 */
export function ribbon(batch, M, pts, width, color, z = 0) {
  if (pts.length < 2) return;
  const side = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    return [-ty * width * 0.5, tx * width * 0.5];
  });
  const L = (i) => transformPoint(M, [pts[i][0] + side[i][0], pts[i][1] + side[i][1], z]);
  const R = (i) => transformPoint(M, [pts[i][0] - side[i][0], pts[i][1] - side[i][1], z]);
  let l0 = L(0), r0 = R(0);
  for (let i = 1; i < pts.length; i++) {
    const l1 = L(i), r1 = R(i);
    batch.tri(l0, r0, l1, color);
    batch.tri(r0, r1, l1, color);
    l0 = l1; r0 = r1;
  }
}

/** Dashed variant: draws every other stretch of the polyline. */
export function dashedRibbon(batch, M, pts, width, color, z, dash = 0.08) {
  let acc = 0, on = true, run = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    acc += d;
    run.push(pts[i]);
    if (acc >= dash) {
      if (on) ribbon(batch, M, run, width, color, z);
      on = !on; acc = 0; run = [pts[i]];
    }
  }
  if (on && run.length > 1) ribbon(batch, M, run, width, color, z);
}

/** Straight segment a→b in the plane, subdivided so dashes work. */
export function segment2(a, b, n = 24) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return out;
}

export function disc(batch, M, c, r, color, z = 0, n = 24) {
  const centre = transformPoint(M, [c[0], c[1], z]);
  let prev = transformPoint(M, [c[0] + r, c[1], z]);
  for (let i = 1; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = transformPoint(M, [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z]);
    batch.tri(centre, prev, p, color);
    prev = p;
  }
}

export function square(batch, M, c, h, color, z = 0) {
  const p = (dx, dy) => transformPoint(M, [c[0] + dx * h, c[1] + dy * h, z]);
  batch.tri(p(-1, -1), p(1, -1), p(1, 1), color);
  batch.tri(p(-1, -1), p(1, 1), p(-1, 1), color);
}

/** Local axes of a node: x red, y green, z blue (fixed length, ignores scale). */
export function axes(batch, M, len = 0.3) {
  const o = transformPoint(M, [0, 0, 0]);
  const cols = [rgba('#e74c3c'), rgba('#2ecc71'), rgba('#3498db')];
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach((d, i) => {
    batch.line(o, add(o, scale(normalize(transformDir(M, d)), len)), cols[i]);
  });
}

const BOX_EDGES = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
/** Wireframe of the unit cube transformed by M. */
export function wireBox(batch, M, color) {
  const v = [];
  for (let i = 0; i < 8; i++) v.push(transformPoint(M, [(i & 1) - 0.5, ((i >> 1) & 1) - 0.5, ((i >> 2) & 1) - 0.5]));
  for (const [a, b] of BOX_EDGES) batch.line(v[a], v[b], color);
}

/**
 * The frustum of a camera, recovered by unprojecting the corners of WebGPU's
 * clip volume (x, y ∈ [−1,1], z ∈ [0,1]) with the inverse view-projection.
 */
export function frustum(batch, invViewProj, eye, color, perspective) {
  const c = [];
  for (const z of [0, 1]) for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) c.push(transformPoint(invViewProj, [x, y, z]));
  for (let k = 0; k < 4; k++) {
    batch.line(c[k], c[(k + 1) % 4], color);           // near rectangle
    batch.line(c[4 + k], c[4 + ((k + 1) % 4)], color); // far rectangle
    batch.line(c[k], c[4 + k], color);                 // side edges
    if (perspective) batch.line(eye, c[k], color);     // apex → near plane
  }
  // a small "up" triangle above the near plane, so the camera's roll is visible
  const up = add(scale(add(c[2], c[3]), 0.5), scale(normalize([c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]]), 0.1));
  batch.line(c[2], up, color); batch.line(up, c[3], color);
  return c;
}
