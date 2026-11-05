// Curve maths: cubic Bézier, de Casteljau, piecewise C¹ Bézier, Catmull–Rom,
// uniform cubic B-spline, least-squares Bézier fitting and arc-length tables.
// Points are arrays of any dimension (we use 2D [u, v] painting coordinates).

const lerpN = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const addN = (a, b) => a.map((x, i) => x + b[i]);
const subN = (a, b) => a.map((x, i) => x - b[i]);
const scaleN = (a, s) => a.map((x) => x * s);
const combo = (pts, w) => pts[0].map((_, i) => pts.reduce((s, p, k) => s + p[i] * w[k], 0));

/* ---------------------------------------------------------------- Bézier */

/** Cubic Bernstein basis: B0 = (1−t)³, B1 = 3(1−t)²t, B2 = 3(1−t)t², B3 = t³. */
export function bernstein(t) {
  const u = 1 - t;
  return [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
}

/** Derivatives of the Bernstein basis with respect to t. */
export function bernsteinDeriv(t) {
  const u = 1 - t;
  return [-3 * u * u, 3 * u * u - 6 * u * t, 6 * u * t - 3 * t * t, 3 * t * t];
}

export const bezier = (p0, p1, p2, p3, t) => combo([p0, p1, p2, p3], bernstein(t));
export const bezierTangent = (p0, p1, p2, p3, t) => combo([p0, p1, p2, p3], bernsteinDeriv(t));

/**
 * de Casteljau: repeatedly interpolate neighbours by t.
 * Returns every level: [[P0..P3], [3 pts], [2 pts], [B(t)]].
 */
export function deCasteljau(points, t) {
  const levels = [points.map((p) => p.slice())];
  let cur = levels[0];
  while (cur.length > 1) {
    const next = [];
    for (let i = 0; i + 1 < cur.length; i++) next.push(lerpN(cur[i], cur[i + 1], t));
    levels.push(next);
    cur = next;
  }
  return levels;
}

/* ------------------------------------------------- piecewise cubic Bézier */
// Layout: [K0, H, H, K1, H, H, K2, ...] — knots at indices 0, 3, 6, …, two handles between.

export const segmentCount = (pts) => Math.floor((pts.length - 1) / 3);
export const isKnot = (i) => i % 3 === 0;

/** Map a global parameter s ∈ [0, 1] to (segment index, local t). */
export function locate(nSeg, s) {
  const x = Math.min(Math.max(s, 0), 1) * nSeg;
  const i = Math.min(nSeg - 1, Math.floor(x));
  return { seg: i, t: x - i };
}

export function piecewiseBezier(pts, s) {
  const { seg, t } = locate(segmentCount(pts), s);
  const k = seg * 3;
  const P = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3]];
  return { point: bezier(...P, t), tangent: bezierTangent(...P, t), seg, t, control: P };
}

/**
 * Enforce C¹ continuity at every interior knot K:  B'_left(1) = B'_right(0)
 *   3(K − H_before) = 3(H_after − K)   ⇔   H_after = 2K − H_before.
 * `moved` is the index the user just dragged; the handle on the *other* side follows it.
 */
export function enforceC1(pts, moved = -1) {
  for (let k = 3; k < pts.length - 1; k += 3) {
    const K = pts[k];
    if (moved === k + 1) pts[k - 1] = subN(scaleN(K, 2), pts[k + 1]);
    else pts[k + 1] = subN(scaleN(K, 2), pts[k - 1]);
  }
  return pts;
}

/** Max |left tangent − right tangent| over all interior knots (0 for a C¹ curve). */
export function c1Error(pts) {
  let err = 0;
  for (let k = 3; k < pts.length - 1; k += 3) {
    const left = bezierTangent(pts[k - 3], pts[k - 2], pts[k - 1], pts[k], 1);
    const right = bezierTangent(pts[k], pts[k + 1], pts[k + 2], pts[k + 3], 0);
    err = Math.max(err, Math.hypot(...subN(left, right)));
  }
  return err;
}

/** Append a segment ending at `p`; the first new handle mirrors the previous one (keeps C¹). */
export function appendSegment(pts, p) {
  const n = pts.length, K = pts[n - 1];
  const h1 = n >= 4 ? subN(scaleN(K, 2), pts[n - 2]) : lerpN(K, p, 1 / 3);
  const h2 = lerpN(h1, p, 0.5);
  pts.push(h1, h2, p.slice());
  return pts;
}

/* ------------------------------------------------------------ Catmull–Rom */
// Uniform Catmull–Rom through the points; end points are duplicated so the
// curve starts at the first point and ends at the last. Tangent at P_i is (P_{i+1} − P_{i−1}) / 2.

function crSegment(P, i) {
  const at = (j) => P[Math.min(P.length - 1, Math.max(0, j))];
  return [at(i - 1), at(i), at(i + 1), at(i + 2)];
}

export function catmullRomBasis(t) {
  const t2 = t * t, t3 = t2 * t;
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2];
}
export function catmullRomBasisDeriv(t) {
  const t2 = t * t;
  return [(-3 * t2 + 4 * t - 1) / 2, (9 * t2 - 10 * t) / 2, (-9 * t2 + 8 * t + 1) / 2, (3 * t2 - 2 * t) / 2];
}

export function catmullRom(P, s) {
  const { seg, t } = locate(P.length - 1, s);
  const Q = crSegment(P, seg);
  return { point: combo(Q, catmullRomBasis(t)), tangent: combo(Q, catmullRomBasisDeriv(t)), seg, t };
}

/* ------------------------------------------------------ uniform B-spline */
// Uniform cubic B-spline basis. The end points are repeated three times so the
// (otherwise approximating) curve is clamped to the first and last control point.

export function bsplineBasis(t) {
  const t2 = t * t, t3 = t2 * t, u = 1 - t;
  return [(u * u * u) / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6];
}
export function bsplineBasisDeriv(t) {
  const t2 = t * t, u = 1 - t;
  return [(-u * u) / 2, (3 * t2 - 4 * t) / 2, (-3 * t2 + 2 * t + 1) / 2, t2 / 2];
}

export function bspline(P, s) {
  const Q = [P[0], P[0], ...P, P[P.length - 1], P[P.length - 1]];
  const { seg, t } = locate(Q.length - 3, s);
  const C = [Q[seg], Q[seg + 1], Q[seg + 2], Q[seg + 3]];
  return { point: combo(C, bsplineBasis(t)), tangent: combo(C, bsplineBasisDeriv(t)), seg, t };
}

/* ---------------------------------------------------------- arc length */

/** Table of cumulative chord lengths so objects can move at constant speed. */
export function arcLengthTable(evalFn, n = 256) {
  const s = new Float64Array(n + 1), len = new Float64Array(n + 1);
  let prev = evalFn(0);
  for (let i = 1; i <= n; i++) {
    s[i] = i / n;
    const p = evalFn(s[i]);
    len[i] = len[i - 1] + Math.hypot(...subN(p, prev));
    prev = p;
  }
  return { s, len, total: len[n] };
}

/** Curve parameter at fraction `f` ∈ [0, 1] of the total length (binary search + lerp). */
export function paramAtFraction(table, f) {
  const target = Math.min(Math.max(f, 0), 1) * table.total;
  let lo = 0, hi = table.len.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (table.len[mid] < target) lo = mid; else hi = mid;
  }
  const span = table.len[hi] - table.len[lo] || 1;
  return table.s[lo] + ((target - table.len[lo]) / span) * (table.s[hi] - table.s[lo]);
}

/* ------------------------------------------------ least-squares fitting */

/**
 * Fit one cubic Bézier to sampled points d_0..d_m (bonus).
 * P0 = d_0 and P3 = d_m are fixed; P1, P2 minimise Σ |B(t_i) − d_i|².
 * Setting the gradient to zero gives the 2×2 normal equations
 *   [Σb1²   Σb1b2] [P1]   [Σ b1 r_i]
 *   [Σb1b2  Σb2² ] [P2] = [Σ b2 r_i],    r_i = d_i − b0(t_i)P0 − b3(t_i)P3
 * solved per coordinate. t_i start as chord-length parameters and are refined
 * with a few Newton steps (closest point on the current curve).
 */
export function fitCubicBezier(samples, iterations = 16) {
  const m = samples.length;
  if (m < 2) return null;
  const P0 = samples[0], P3 = samples[m - 1];
  if (m < 4) return { points: [P0, lerpN(P0, P3, 1 / 3), lerpN(P0, P3, 2 / 3), P3], rms: 0 };

  // chord-length parameterisation
  let t = [0];
  for (let i = 1; i < m; i++) t.push(t[i - 1] + Math.hypot(...subN(samples[i], samples[i - 1])));
  const total = t[m - 1] || 1;
  t = t.map((x) => x / total);

  let P1 = lerpN(P0, P3, 1 / 3), P2 = lerpN(P0, P3, 2 / 3);
  for (let it = 0; it <= iterations; it++) {
    let a11 = 0, a12 = 0, a22 = 0;
    let x1 = P0.map(() => 0), x2 = P0.map(() => 0);
    for (let i = 0; i < m; i++) {
      const [b0, b1, b2, b3] = bernstein(t[i]);
      a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2;
      const r = subN(samples[i], addN(scaleN(P0, b0), scaleN(P3, b3)));
      x1 = addN(x1, scaleN(r, b1));
      x2 = addN(x2, scaleN(r, b2));
    }
    const det = a11 * a22 - a12 * a12;
    if (Math.abs(det) > 1e-12) {
      P1 = x1.map((v, k) => (a22 * v - a12 * x2[k]) / det);
      P2 = x1.map((v, k) => (a11 * x2[k] - a12 * v) / det);
    }
    if (it === iterations) break;
    // Newton reparameterisation: t ← t − f/f',  f = (B(t) − d)·B'(t)
    t = t.map((ti, i) => {
      if (i === 0 || i === m - 1) return ti;
      const B = bezier(P0, P1, P2, P3, ti), d1 = bezierTangent(P0, P1, P2, P3, ti);
      const u = 1 - ti;
      const d2 = combo([subN(P2, scaleN(P1, 2)).map((v, k) => v + P0[k]), subN(P3, scaleN(P2, 2)).map((v, k) => v + P1[k])], [6 * u, 6 * ti]);
      const diff = subN(B, samples[i]);
      const num = diff.reduce((s, v, k) => s + v * d1[k], 0);
      const den = d1.reduce((s, v) => s + v * v, 0) + diff.reduce((s, v, k) => s + v * d2[k], 0);
      const nt = Math.abs(den) > 1e-12 ? ti - num / den : ti;
      return Math.min(1, Math.max(0, nt));
    });
  }
  let err = 0;
  for (let i = 0; i < m; i++) err += Math.hypot(...subN(bezier(P0, P1, P2, P3, t[i]), samples[i])) ** 2;
  return { points: [P0.slice(), P1, P2, P3.slice()], rms: Math.sqrt(err / m) };
}
