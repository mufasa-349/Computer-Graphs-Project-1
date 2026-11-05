import { describe, it, expect } from 'vitest';
import * as M from '../src/math/mat4.js';

const close = (a, b, eps = 1e-5) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
};
const I = M.identity();

describe('mat4 basics', () => {
  it('identity is neutral for multiply', () => {
    const A = M.multiplyAll(M.translate(1, 2, 3), M.rotateY(0.7), M.scale(2, 3, 4));
    close(M.multiply(A, I), A);
    close(M.multiply(I, A), A);
  });

  it('is column-major: translation lives in m[12..14]', () => {
    const T = M.translate(4, 5, 6);
    expect([T[12], T[13], T[14]]).toEqual([4, 5, 6]);
    close(M.transformPoint(T, [1, 1, 1]), [5, 6, 7]);
  });

  it('multiply matches a hand-computed product', () => {
    const A = M.fromRows(1, 2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    const B = M.fromRows(1, 0, 0, 0, 3, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
    close(M.multiply(A, B), M.fromRows(7, 2, 0, 0, 3, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1));
  });

  it('multiplication is associative but not commutative', () => {
    const T = M.translate(1, 0, 0), R = M.rotateZ(Math.PI / 2), S = M.scale(2, 2, 2);
    close(M.multiply(M.multiply(T, R), S), M.multiply(T, M.multiply(R, S)));
    const trs = M.multiplyAll(T, R, S), srt = M.multiplyAll(S, R, T);
    close(M.transformPoint(trs, [0, 0, 0]), [1, 0, 0]);
    close(M.transformPoint(srt, [0, 0, 0]), [0, 2, 0]); // translation got rotated and scaled
  });

  it('rotations turn the axes the right-handed way', () => {
    close(M.transformPoint(M.rotateZ(Math.PI / 2), [1, 0, 0]), [0, 1, 0]);
    close(M.transformPoint(M.rotateX(Math.PI / 2), [0, 1, 0]), [0, 0, 1]);
    close(M.transformPoint(M.rotateY(Math.PI / 2), [0, 0, 1]), [1, 0, 0]);
  });

  it('transpose swaps rows and columns, twice is identity', () => {
    const A = M.fromRows(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
    expect(M.transpose(A)[1]).toBe(2);
    close(M.transpose(M.transpose(A)), A);
  });

  it('rigid inverse undoes a rotation + translation', () => {
    const A = M.multiplyAll(M.translate(3, -2, 5), M.rotateY(0.4), M.rotateX(-1.1));
    close(M.multiply(M.invertRigid(A), A), I);
    close(M.multiply(A, M.invertRigid(A)), I);
    close(M.invertRigid(A), M.invert(A));
  });

  it('general inverse works on a scaled matrix', () => {
    const A = M.multiplyAll(M.translate(1, 2, 3), M.rotateZ(0.3), M.scale(2, 0.5, 4));
    close(M.multiply(M.invert(A), A), I);
  });

  it('normal matrix is the inverse-transpose', () => {
    const A = M.multiplyAll(M.rotateY(0.5), M.scale(3, 1, 0.5));
    const N = M.normalMatrix(A), ref = M.transpose(M.invert(A));
    for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) expect(Math.abs(N[i] - ref[i])).toBeLessThan(1e-5);
  });
});

describe('camera matrices', () => {
  it('lookAt maps eye to the origin and target onto −z', () => {
    const eye = [3, 4, 5], target = [0, 1, 0];
    const V = M.lookAt(eye, target, [0, 1, 0]);
    close(M.transformPoint(V, eye), [0, 0, 0]);
    const t = M.transformPoint(V, target);
    expect(Math.abs(t[0])).toBeLessThan(1e-5);
    expect(Math.abs(t[1])).toBeLessThan(1e-5);
    expect(t[2]).toBeCloseTo(-Math.hypot(3, 3, 5), 4);
  });

  it('lookAt is a rigid transform (orthonormal rows)', () => {
    const V = M.lookAt([2, 7, -3], [1, 0, 1], [0, 1, 0]);
    close(M.multiply(M.invertRigid(V), V), I);
  });

  it('lookAt survives up parallel to the view direction', () => {
    const V = M.lookAt([0, 5, 0], [0, 0, 0], [0, 1, 0]);
    expect(M.lookAt.lastDegenerate).toBe(true);
    for (const v of V) expect(Number.isFinite(v)).toBe(true);
    close(M.transformPoint(V, [0, 0, 0]), [0, 0, -5]);
  });

  it('perspective maps near → 0 and far → 1 (WebGPU)', () => {
    const P = M.perspective(Math.PI / 3, 1.5, 0.5, 20);
    const ndc = (z) => { const c = M.transformVec4(P, [0, 0, z, 1]); return c[2] / c[3]; };
    expect(ndc(-0.5)).toBeCloseTo(0, 6);
    expect(ndc(-20)).toBeCloseTo(1, 6);
    expect(ndc(-5)).toBeGreaterThan(0);
    expect(ndc(-5)).toBeLessThan(1);
    // top edge of the frustum at distance d maps to y = 1
    const d = 4, y = d * Math.tan(Math.PI / 6);
    const c = M.transformVec4(P, [0, y, -d, 1]);
    expect(c[1] / c[3]).toBeCloseTo(1, 5);
  });

  it('orthographic maps the box to x,y ∈ [−1,1], z ∈ [0,1]', () => {
    const O = M.orthographic(-2, 4, -1, 3, 1, 11);
    close(M.transformPoint(O, [-2, -1, -1]), [-1, -1, 0]);
    close(M.transformPoint(O, [4, 3, -11]), [1, 1, 1]);
  });
});
