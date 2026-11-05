// Curve state for Part D: control points in normalised painting coordinates
// (u, v) ∈ [0,1]², u to the right, v up. Three curve families share the points:
//   • piecewise cubic Bézier (C¹ enforced) — uses all points: knots + handles
//   • Catmull–Rom — interpolates the knots
//   • uniform cubic B-spline — approximates the knots
import * as C from '../math/curves.js';
import { PAINTING } from './scene.js';

// Default trace: the upper outline of the melon, in image pixels (720 × 502), 3 segments.
const DEFAULT_TRACE_PX = [
  [208, 112], [262, 82], [335, 62],
  [420, 58], [505, 54], [585, 95],
  [615, 135], [645, 175], [645, 225],
  [632, 250],
];
const [IW, IH] = PAINTING.pixels;
export const pxToUV = ([x, y]) => [x / IW, 1 - y / IH];

export const MODES = { bezier: 'Piecewise Bézier (C¹)', catmull: 'Catmull–Rom (through the knots)', bspline: 'Uniform cubic B-spline' };

export class CurveModel {
  constructor() { this.reset(); }

  reset() {
    this.points = C.enforceC1(DEFAULT_TRACE_PX.map(pxToUV));
    this.mode = 'bezier';
    this.t = 0.45;              // parameter for the de Casteljau construction
    this.fit = null;            // least-squares fit result (bonus)
    this.trace = [];            // freehand samples being drawn
    this.version = 0;           // bumps whenever the geometry changes
    this._table = null;
  }

  changed() { this.version++; this._table = null; }

  knots() { return this.points.filter((_, i) => C.isKnot(i)); }
  knotIndices() { return this.points.map((_, i) => i).filter(C.isKnot); }
  /** Indices the user can grab in the current mode. */
  editableIndices() { return this.mode === 'bezier' ? this.points.map((_, i) => i) : this.knotIndices(); }
  segments() { return this.mode === 'bezier' ? C.segmentCount(this.points) : this.mode === 'catmull' ? this.knots().length - 1 : this.knots().length + 1; }

  /** Point and tangent at global parameter s ∈ [0,1] of the active curve. */
  evaluate(s) {
    if (this.mode === 'bezier') return C.piecewiseBezier(this.points, s);
    if (this.mode === 'catmull') return C.catmullRom(this.knots(), s);
    return C.bspline(this.knots(), s);
  }

  sample(n = 200) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push(this.evaluate(i / n).point);
    return out;
  }

  /** Arc-length table in physical units, so the follower moves at constant speed. */
  get table() {
    if (!this._table) {
      const phys = (p) => [p[0] * PAINTING.width, p[1] * PAINTING.height];
      this._table = C.arcLengthTable((s) => phys(this.evaluate(s).point), 400);
    }
    return this._table;
  }

  /** Bézier segment that contains global parameter s, with its local t (for de Casteljau). */
  segmentAt(s) {
    const { seg, t } = C.locate(C.segmentCount(this.points), s);
    return { seg, t, control: this.points.slice(seg * 3, seg * 3 + 4) };
  }

  move(i, uv) {
    const p = this.points;
    if (C.isKnot(i)) {
      // a knot carries its two handles along, so the tangents keep their shape
      const d = [uv[0] - p[i][0], uv[1] - p[i][1]];
      for (const j of [i - 1, i + 1]) if (j >= 0 && j < p.length) p[j] = [p[j][0] + d[0], p[j][1] + d[1]];
    }
    p[i] = uv.slice();
    C.enforceC1(p, i);
    this.changed();
  }

  addKnot(uv) {
    C.appendSegment(this.points, uv);
    C.enforceC1(this.points);
    this.changed();
  }

  removeLastSegment() {
    if (C.segmentCount(this.points) <= 1) return false;
    this.points.length -= 3;
    this.changed();
    return true;
  }

  c1Error() { return C.c1Error(this.points); }

  /** Least-squares cubic Bézier through the current freehand trace (bonus). */
  fitTrace() {
    if (this.trace.length < 2) { this.fit = null; return null; }
    // fit in physical units so u and v are weighted equally on the canvas
    const W = PAINTING.width, H = PAINTING.height;
    const res = C.fitCubicBezier(this.trace.map(([u, v]) => [u * W, v * H]));
    this.fit = { points: res.points.map(([x, y]) => [x / W, y / H]), rms: res.rms, samples: this.trace.length };
    return this.fit;
  }

  toJSON() {
    const r4 = (x) => Math.round(x * 1e4) / 1e4;
    return {
      painting: PAINTING.title,
      artist: PAINTING.artist,
      coordinates: 'normalised painting coordinates: u ∈ [0,1] left→right, v ∈ [0,1] bottom→top',
      type: this.mode,
      piecewiseBezier: {
        segments: C.segmentCount(this.points),
        continuity: 'C1 (H_after = 2K − H_before at every interior knot)',
        layout: 'K0 H H K1 H H K2 … (knots every third point)',
        points: this.points.map(([u, v]) => ({ u: r4(u), v: r4(v) })),
      },
      knots: this.knots().map(([u, v]) => ({ u: r4(u), v: r4(v) })),
      leastSquaresFit: this.fit && { points: this.fit.points.map(([u, v]) => ({ u: r4(u), v: r4(v) })), rmsError: r4(this.fit.rms) },
      exportedAt: new Date().toISOString(),
    };
  }

  fromJSON(obj) {
    const pts = obj?.piecewiseBezier?.points;
    if (!Array.isArray(pts) || pts.length < 4 || (pts.length - 1) % 3 !== 0) throw new Error('JSON needs piecewiseBezier.points with 3n+1 entries');
    this.points = C.enforceC1(pts.map((p) => [Number(p.u), Number(p.v)]));
    if (MODES[obj.type]) this.mode = obj.type;
    this.changed();
  }

  /**
   * Profile for the surface of revolution (bonus): the traced outline in physical
   * units, revolved about the horizontal line through its lower end point.
   */
  revolutionProfile(n = 64) {
    const pts = this.sample(n).map(([u, v]) => [u * PAINTING.width, v * PAINTING.height]);
    const axisY = Math.min(pts[0][1], pts[pts.length - 1][1]);
    const xs = pts.map((p) => p[0]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    return pts.map(([x, y]) => [x - cx, Math.max(0, y - axisY)]);
  }
}
