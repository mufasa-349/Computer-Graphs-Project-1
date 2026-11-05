import { describe, it, expect } from 'vitest';
import * as C from '../src/math/curves.js';

const near = (a, b, eps = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));
const P = [[0, 0], [1, 2], [3, 3], [4, 0]];

describe('cubic Bézier', () => {
  it('starts at P0 and ends at P3', () => {
    near(C.bezier(...P, 0), P[0]);
    near(C.bezier(...P, 1), P[3]);
  });

  it('basis is a partition of unity', () => {
    for (const t of [0, 0.2, 0.5, 0.9, 1]) expect(C.bernstein(t).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
  });

  it('end tangents are 3(P1 − P0) and 3(P3 − P2)', () => {
    near(C.bezierTangent(...P, 0), [3, 6]);
    near(C.bezierTangent(...P, 1), [3, -9]);
  });

  it('de Casteljau gives the same point as the Bernstein form', () => {
    for (const t of [0.1, 0.37, 0.8]) {
      const levels = C.deCasteljau(P, t);
      expect(levels.map((l) => l.length)).toEqual([4, 3, 2, 1]);
      near(levels[3][0], C.bezier(...P, t), 1e-12);
    }
  });
});

describe('piecewise Bézier', () => {
  const pts = () => [[0, 0], [1, 1], [2, 1], [3, 0], [3.5, -1], [5, -1], [6, 0], [7, 2], [8, 2], [9, 0]];

  it('enforceC1 mirrors handles across each interior knot', () => {
    const p = C.enforceC1(pts());
    near(p[4], [4, -1]);          // 2·K(3,0) − H(2,1)
    expect(C.c1Error(p)).toBeLessThan(1e-12);
  });

  it('dragging the after-handle moves the before-handle', () => {
    const p = C.enforceC1(pts());
    p[4] = [5, 0.5];
    C.enforceC1(p, 4);
    near(p[2], [1, -0.5]);
    expect(C.c1Error(p)).toBeLessThan(1e-12);
  });

  it('global parameter covers every segment, continuous at joints', () => {
    const p = C.enforceC1(pts());
    expect(C.segmentCount(p)).toBe(3);
    near(C.piecewiseBezier(p, 0).point, p[0]);
    near(C.piecewiseBezier(p, 1).point, p[9]);
    near(C.piecewiseBezier(p, 1 / 3).point, p[3], 1e-9);
  });

  it('appendSegment keeps C¹', () => {
    const p = C.enforceC1(pts());
    C.appendSegment(p, [11, 1]);
    expect(C.segmentCount(p)).toBe(4);
    expect(C.c1Error(p)).toBeLessThan(1e-12);
  });
});

describe('Catmull–Rom and B-spline', () => {
  const K = [[0, 0], [1, 2], [3, 3], [4, 0], [6, 1]];

  it('Catmull–Rom passes through every control point', () => {
    K.forEach((k, i) => near(C.catmullRom(K, i / (K.length - 1)).point, k, 1e-9));
  });

  it('Catmull–Rom tangent at an interior point is (P[i+1] − P[i−1]) / 2', () => {
    near(C.catmullRom(K, 0.25).tangent, [1.5, 1.5], 1e-9);
  });

  it('B-spline basis sums to one and the clamped curve hits the end points', () => {
    for (const t of [0, 0.3, 0.7, 1]) expect(C.bsplineBasis(t).reduce((a, b) => a + b)).toBeCloseTo(1, 12);
    near(C.bspline(K, 0).point, K[0], 1e-9);
    near(C.bspline(K, 1).point, K[4], 1e-9);
  });
});

describe('arc length and fitting', () => {
  it('arc length of a straight Bézier is the chord', () => {
    const line = [[0, 0], [1, 0], [2, 0], [3, 0]];
    const tab = C.arcLengthTable((s) => C.bezier(...line, s), 200);
    expect(tab.total).toBeCloseTo(3, 6);
    expect(C.paramAtFraction(tab, 0.5)).toBeCloseTo(0.5, 3);
  });

  it('least squares recovers a Bézier from its own samples', () => {
    const samples = [];
    for (let i = 0; i <= 40; i++) samples.push(C.bezier(...P, i / 40));
    const fit = C.fitCubicBezier(samples);
    // curve spans ~4 units; alternating point/parameter refinement converges linearly
    expect(fit.rms).toBeLessThan(5e-3);
    near(fit.points[1], P[1], 0.25);
    near(fit.points[2], P[2], 0.25);
    // end points are interpolated exactly
    near(fit.points[0], P[0]);
    near(fit.points[3], P[3]);
  });

  it('fitting beats the straight-line initial guess on noisy data', () => {
    const samples = [];
    for (let i = 0; i <= 60; i++) {
      const p = C.bezier(...P, i / 60);
      samples.push([p[0] + 0.02 * Math.sin(i * 7.1), p[1] + 0.02 * Math.cos(i * 3.3)]);
    }
    expect(C.fitCubicBezier(samples).rms).toBeLessThan(C.fitCubicBezier(samples, 0).rms);
  });
});
