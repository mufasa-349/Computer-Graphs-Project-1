// CPU-side mesh generators. Every mesh is interleaved
//   [px, py, pz, nx, ny, nz, u, v]  (8 floats per vertex)
// with a Uint32 index list. Shapes are unit-sized and centred at the origin,
// so their placement comes entirely from model matrices.

import { transformPoint, transformDir, normalMatrix, multiply, rotateZ, translate, scale } from '../math/mat4.js';
import { normalize } from '../math/vec3.js';

export const FLOATS_PER_VERTEX = 8;

function builder() {
  const v = [], idx = [];
  return {
    vertex(p, n, uv = [0, 0]) { v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]); return v.length / 8 - 1; },
    tri(a, b, c) { idx.push(a, b, c); },
    done() { return { vertices: new Float32Array(v), indices: new Uint32Array(idx) }; },
  };
}

export function cube() {
  const b = builder();
  // each face: normal, u axis, v axis
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, w] of faces) {
    const corner = (su, sv) => [0, 1, 2].map((k) => 0.5 * n[k] + 0.5 * su * u[k] + 0.5 * sv * w[k]);
    const i0 = b.vertex(corner(-1, -1), n, [0, 1]);
    const i1 = b.vertex(corner(1, -1), n, [1, 1]);
    const i2 = b.vertex(corner(1, 1), n, [1, 0]);
    const i3 = b.vertex(corner(-1, 1), n, [0, 0]);
    b.tri(i0, i1, i2); b.tri(i0, i2, i3);
  }
  return b.done();
}

export function sphere(rings = 24, sectors = 36) {
  const b = builder();
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= sectors; s++) {
      const th = (s / sectors) * Math.PI * 2;
      const n = [Math.sin(phi) * Math.cos(th), Math.cos(phi), -Math.sin(phi) * Math.sin(th)];
      b.vertex(n.map((x) => x * 0.5), n, [s / sectors, r / rings]);
    }
  }
  for (let r = 0; r < rings; r++) for (let s = 0; s < sectors; s++) {
    const a = r * (sectors + 1) + s, c = a + sectors + 1;
    b.tri(a, c, a + 1); b.tri(a + 1, c, c + 1);
  }
  return b.done();
}

/** Cylinder of radius 0.5 and height 1 along y (centred), with caps. */
export function cylinder(sectors = 32, topRadius = 0.5) {
  const b = builder();
  const slope = 0.5 - topRadius; // for cone-like sides
  for (let s = 0; s <= sectors; s++) {
    const th = (s / sectors) * Math.PI * 2, c = Math.cos(th), si = -Math.sin(th);
    const n = normalize([c, slope, si]);
    b.vertex([0.5 * c, -0.5, 0.5 * si], n, [s / sectors, 1]);
    b.vertex([topRadius * c, 0.5, topRadius * si], n, [s / sectors, 0]);
  }
  for (let s = 0; s < sectors; s++) { const a = 2 * s; b.tri(a, a + 2, a + 1); b.tri(a + 1, a + 2, a + 3); }
  for (const [y, r, ny] of [[-0.5, 0.5, -1], [0.5, topRadius, 1]]) {
    if (r <= 0) continue;
    const centre = b.vertex([0, y, 0], [0, ny, 0], [0.5, 0.5]);
    const first = centre + 1;
    for (let s = 0; s <= sectors; s++) {
      const th = (s / sectors) * Math.PI * 2;
      b.vertex([r * Math.cos(th), y, -r * Math.sin(th)], [0, ny, 0], [0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th)]);
    }
    for (let s = 0; s < sectors; s++) ny > 0 ? b.tri(centre, first + s, first + s + 1) : b.tri(centre, first + s + 1, first + s);
  }
  return b.done();
}

export const cone = (sectors = 32) => cylinder(sectors, 0);

/** Unit quad in the XY plane facing +z. uv (0,0) is the image's top-left corner. */
export function quad() {
  const b = builder(), n = [0, 0, 1];
  b.vertex([-0.5, -0.5, 0], n, [0, 1]);
  b.vertex([0.5, -0.5, 0], n, [1, 1]);
  b.vertex([0.5, 0.5, 0], n, [1, 0]);
  b.vertex([-0.5, 0.5, 0], n, [0, 0]);
  b.tri(0, 1, 2); b.tri(0, 2, 3);
  return b.done();
}

/** Bake several meshes into one, each with its own transform. */
export function merge(parts) {
  const verts = [], idx = [];
  let base = 0;
  for (const { mesh, matrix } of parts) {
    const N = normalMatrix(matrix);
    for (let i = 0; i < mesh.vertices.length; i += 8) {
      const p = transformPoint(matrix, [mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]]);
      const n = normalize(transformDir(N, [mesh.vertices[i + 3], mesh.vertices[i + 4], mesh.vertices[i + 5]]));
      verts.push(...p, ...n, mesh.vertices[i + 6], mesh.vertices[i + 7]);
    }
    for (const k of mesh.indices) idx.push(k + base);
    base += mesh.vertices.length / 8;
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) };
}

/** An arrow pointing along +x (length 1, starting at the origin). */
export function arrow() {
  const toX = rotateZ(-Math.PI / 2); // +y → +x
  return merge([
    { mesh: cylinder(20), matrix: multiply(toX, multiply(translate(0, 0.32, 0), scale(0.12, 0.64, 0.12))) },
    { mesh: cone(24), matrix: multiply(toX, multiply(translate(0, 0.82, 0), scale(0.34, 0.36, 0.34))) },
  ]);
}

/**
 * Surface of revolution (bonus): sweep a profile curve around the x axis.
 * profile: [[x, r], ...] with r ≥ 0 the distance from the axis. Normals come from
 * the profile tangent (dx, dr): in the (x, r) plane the outward normal is (−dr, dx).
 */
export function revolve(profile, sectors = 48) {
  const b = builder(), m = profile.length;
  for (let i = 0; i < m; i++) {
    const a = profile[Math.max(0, i - 1)], c = profile[Math.min(m - 1, i + 1)];
    let dx = c[0] - a[0], dr = c[1] - a[1];
    const l = Math.hypot(dx, dr) || 1; dx /= l; dr /= l;
    const [x, r] = profile[i];
    for (let s = 0; s <= sectors; s++) {
      const th = (s / sectors) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      b.vertex([x, r * cs, r * sn], [-dr, dx * cs, dx * sn], [i / (m - 1), s / sectors]);
    }
  }
  for (let i = 0; i < m - 1; i++) for (let s = 0; s < sectors; s++) {
    const a = i * (sectors + 1) + s, c = a + sectors + 1;
    b.tri(a, a + 1, c); b.tri(a + 1, c + 1, c);
  }
  // flat caps where the profile does not close on the axis (the melon's cut face)
  for (const [i, nx] of [[0, -1], [m - 1, 1]]) {
    const [x, r] = profile[i];
    if (r < 1e-4) continue;
    const centre = b.vertex([x, 0, 0], [nx, 0, 0], [0.5, 0.5]);
    for (let s = 0; s <= sectors; s++) {
      const th = (s / sectors) * Math.PI * 2;
      b.vertex([x, r * Math.cos(th), r * Math.sin(th)], [nx, 0, 0], [0.5 + 0.5 * Math.cos(th), 0.5 + 0.5 * Math.sin(th)]);
    }
    for (let s = 0; s < sectors; s++) b.tri(centre, centre + 1 + s, centre + 2 + s);
  }
  return b.done();
}
