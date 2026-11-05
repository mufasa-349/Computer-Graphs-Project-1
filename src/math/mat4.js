// 4×4 matrix library, written from scratch (no gl-matrix).
//
// Storage convention: COLUMN-MAJOR Float32Array(16), the layout WGSL's mat4x4f
// expects in a uniform buffer. Element (row r, column c) lives at m[c * 4 + r],
// so the translation of an affine matrix sits in m[12], m[13], m[14].
//
// Vectors are column vectors and matrices multiply on the left: p' = M · p.
// A composed matrix A · B therefore applies B first, then A.

import { cross, dot, normalize, length } from './vec3.js';

export function identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** Builds a matrix from 16 numbers written row by row (handy for tests and reading). */
export function fromRows(...r) {
  const m = new Float32Array(16);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) m[col * 4 + row] = r[row * 4 + col];
  return m;
}

/** out = a · b  (b is applied first). */
export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** multiplyAll(A, B, C) = A · B · C */
export function multiplyAll(...ms) {
  return ms.reduce((acc, m) => multiply(acc, m), identity());
}

export function translate(tx, ty, tz) {
  const m = identity();
  m[12] = tx; m[13] = ty; m[14] = tz;
  return m;
}

export function scale(sx, sy, sz = sx) {
  const m = identity();
  m[0] = sx; m[5] = sy; m[10] = sz;
  return m;
}

// Right-handed rotations by `a` radians (counter-clockwise when the axis points at you).
export function rotateX(a) {
  const c = Math.cos(a), s = Math.sin(a), m = identity();
  m[5] = c; m[6] = s;     // column 1 = (0, c, s)
  m[9] = -s; m[10] = c;   // column 2 = (0, -s, c)
  return m;
}

export function rotateY(a) {
  const c = Math.cos(a), s = Math.sin(a), m = identity();
  m[0] = c; m[2] = -s;    // column 0 = (c, 0, -s)
  m[8] = s; m[10] = c;    // column 2 = (s, 0, c)
  return m;
}

export function rotateZ(a) {
  const c = Math.cos(a), s = Math.sin(a), m = identity();
  m[0] = c; m[1] = s;     // column 0 = (c, s, 0)
  m[4] = -s; m[5] = c;    // column 1 = (-s, c, 0)
  return m;
}

export function rotateAxis(axis, a) {
  return axis === 'x' ? rotateX(a) : axis === 'y' ? rotateY(a) : rotateZ(a);
}

/** Matrix whose columns are the given basis vectors plus a translation. */
export function fromBasis(x, y, z, t = [0, 0, 0]) {
  return new Float32Array([x[0], x[1], x[2], 0, y[0], y[1], y[2], 0, z[0], z[1], z[2], 0, t[0], t[1], t[2], 1]);
}

export function transpose(m) {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = m[c * 4 + r];
  return o;
}

/**
 * Inverse of a rigid transform M = [R t; 0 1] (rotation + translation only).
 * Because R is orthonormal, R⁻¹ = Rᵀ, so M⁻¹ = [Rᵀ  −Rᵀt; 0 1]. No division needed.
 */
export function invertRigid(m) {
  const o = identity();
  // upper 3×3 = Rᵀ
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
  const tx = m[12], ty = m[13], tz = m[14];
  o[12] = -(o[0] * tx + o[4] * ty + o[8] * tz);
  o[13] = -(o[1] * tx + o[5] * ty + o[9] * tz);
  o[14] = -(o[2] * tx + o[6] * ty + o[10] * tz);
  return o;
}

/** General 4×4 inverse (cofactor expansion). Used to unproject mouse rays and frustum corners. */
export function invert(m) {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return null;
  const d = 1 / det;
  return new Float32Array([
    (a11 * b11 - a12 * b10 + a13 * b09) * d,
    (a02 * b10 - a01 * b11 - a03 * b09) * d,
    (a31 * b05 - a32 * b04 + a33 * b03) * d,
    (a22 * b04 - a21 * b05 - a23 * b03) * d,
    (a12 * b08 - a10 * b11 - a13 * b07) * d,
    (a00 * b11 - a02 * b08 + a03 * b07) * d,
    (a32 * b02 - a30 * b05 - a33 * b01) * d,
    (a20 * b05 - a22 * b02 + a23 * b01) * d,
    (a10 * b10 - a11 * b08 + a13 * b06) * d,
    (a01 * b08 - a00 * b10 - a03 * b06) * d,
    (a30 * b04 - a31 * b02 + a33 * b00) * d,
    (a21 * b02 - a20 * b04 - a23 * b00) * d,
    (a11 * b07 - a10 * b09 - a12 * b06) * d,
    (a00 * b09 - a01 * b07 + a02 * b06) * d,
    (a31 * b01 - a30 * b03 - a32 * b00) * d,
    (a20 * b03 - a21 * b01 + a22 * b00) * d,
  ]);
}

/**
 * Normal matrix: inverse-transpose of the upper 3×3, returned padded as a mat4.
 * Needed because non-uniform scale would otherwise tilt normals.
 * (M⁻¹)ᵀ = cofactor(M) / det(M), so we only need the cofactor matrix.
 */
export function normalMatrix(m) {
  // rows of the upper 3×3
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  const cof = [
    [e * i - f * h, -(d * i - f * g), d * h - e * g],
    [-(b * i - c * h), a * i - c * g, -(a * h - b * g)],
    [b * f - c * e, -(a * f - c * d), a * e - b * d],
  ];
  const det = a * cof[0][0] + b * cof[0][1] + c * cof[0][2];
  const o = identity();
  if (Math.abs(det) < 1e-12) return o;
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) o[col * 4 + r] = cof[r][col] / det;
  return o;
}

export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

/** Full homogeneous product M · (x, y, z, w). */
export function transformVec4(m, v) {
  const [x, y, z, w] = v;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

export function transformDir(m, v) {
  return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
}

export const getTranslation = (m) => [m[12], m[13], m[14]];

/**
 * View matrix from eye, target and up, built with two cross products.
 *   w = normalize(eye − target)      camera looks down −w (right-handed, −z forward)
 *   u = normalize(up × w)            camera right
 *   v = w × u                        camera up (already unit length)
 * V = [u v w]ᵀ · T(−eye). If `up` is (nearly) parallel to the view direction,
 * up × w ≈ 0 and the basis is undefined; we then substitute the world axis that is
 * least aligned with w, so the camera never collapses or produces NaNs.
 * Returns the matrix; `lookAt.lastDegenerate` reports whether the fallback was used.
 */
export function lookAt(eye, target, up) {
  let w = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
  if (length(w) < 1e-9) w = [0, 0, 1];
  w = normalize(w);
  let ux = cross(up, w);
  lookAt.lastDegenerate = false;
  if (length(ux) < 1e-6) {
    lookAt.lastDegenerate = true;
    // First world axis that is clearly not parallel to w. Trying −z first means that
    // looking straight down, "up" on screen points into the scene (towards the painting).
    const alt = [[0, 0, -1], [1, 0, 0], [0, 1, 0]].find((a) => Math.abs(dot(a, w)) < 0.9);
    ux = cross(alt, w);
  }
  const u = normalize(ux);
  const v = cross(w, u);
  return new Float32Array([
    u[0], v[0], w[0], 0,
    u[1], v[1], w[1], 0,
    u[2], v[2], w[2], 0,
    -dot(u, eye), -dot(v, eye), -dot(w, eye), 1,
  ]);
}
lookAt.lastDegenerate = false;

/**
 * Perspective projection for WebGPU: view-space z = −near → depth 0, z = −far → depth 1.
 * (OpenGL maps to [−1, 1]; WebGPU clip space uses z ∈ [0, w].)
 *   x' = f/aspect · x,  y' = f · y,  z' = far/(near−far) · z + near·far/(near−far),  w' = −z
 */
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far * nf;
  m[11] = -1;
  m[14] = near * far * nf;
  return m;
}

/**
 * Orthographic projection for WebGPU with the same near/far behaviour:
 * z = −near → 0, z = −far → 1, and x, y in [left, right] × [bottom, top] → [−1, 1].
 */
export function orthographic(left, right, bottom, top, near, far) {
  const m = identity();
  m[0] = 2 / (right - left);
  m[5] = 2 / (top - bottom);
  m[10] = 1 / (near - far);
  m[12] = -(right + left) / (right - left);
  m[13] = -(top + bottom) / (top - bottom);
  m[14] = near / (near - far);
  return m;
}

/** Pretty-print a matrix row by row (for the on-screen readouts). */
export function format(m, digits = 2, width = 7) {
  let s = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let v = m[c * 4 + r];
      if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0;
      s += v.toFixed(digits).padStart(width);
    }
    if (r < 3) s += '\n';
  }
  return s;
}
