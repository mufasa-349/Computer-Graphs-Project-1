// Immediate-mode geometry rebuilt every frame (curves, debug axes, frustum…).
// Vertices are [x, y, z, r, g, b, a] in world space with linear colours.

export const FLOATS = 7;

export class Batch {
  constructor(capacity = 4096) {
    this.data = new Float32Array(capacity * FLOATS);
    this.count = 0;
  }
  clear() { this.count = 0; }
  _grow() {
    const d = new Float32Array(this.data.length * 2);
    d.set(this.data);
    this.data = d;
  }
  vertex(p, c) {
    if ((this.count + 1) * FLOATS > this.data.length) this._grow();
    const o = this.count * FLOATS, d = this.data;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2];
    d[o + 3] = c[0]; d[o + 4] = c[1]; d[o + 5] = c[2]; d[o + 6] = c[3] ?? 1;
    this.count++;
  }
  line(a, b, c, c2 = c) { this.vertex(a, c); this.vertex(b, c2); }
  tri(a, b, c, col) { this.vertex(a, col); this.vertex(b, col); this.vertex(c, col); }
  view() { return this.data.subarray(0, this.count * FLOATS); }
}
