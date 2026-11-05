// Cameras. The orbit camera stores spherical coordinates around a target and
// turns them into eye/target/up for lookAt; the projection is perspective or
// orthographic, switchable at run time.

import { lookAt, perspective, orthographic, multiply } from '../math/mat4.js';
import { add, scale, sub, cross, normalize } from '../math/vec3.js';

const DEG = Math.PI / 180;

export const ORBIT_DEFAULTS = {
  target: [0, 1.75, 0.9],
  yaw: 18 * DEG,
  pitch: 12 * DEG,
  distance: 7.2,
  fovDeg: 50,
  near: 0.1,
  far: 15,
  projection: 'perspective',
};

export class OrbitCamera {
  constructor() { this.reset(); }

  reset() {
    Object.assign(this, structuredClone(ORBIT_DEFAULTS));
    this.up = [0, 1, 0];
  }

  get eye() {
    const cp = Math.cos(this.pitch);
    return add(this.target, scale([cp * Math.sin(this.yaw), Math.sin(this.pitch), cp * Math.cos(this.yaw)], this.distance));
  }

  /** Mouse drag in pixels → yaw/pitch. Pitch may reach exactly ±90°, where up ∥ view direction. */
  orbit(dx, dy) {
    this.yaw -= dx * 0.008;
    this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch + dy * 0.008));
  }

  /** Move the target in the camera's own right/up plane. */
  pan(dx, dy) {
    const w = normalize(sub(this.eye, this.target));
    let u = cross(this.up, w);
    if (Math.hypot(...u) < 1e-6) u = [1, 0, 0];
    u = normalize(u);
    const v = cross(w, u);
    const k = this.distance * 0.0016;
    this.target = add(this.target, add(scale(u, -dx * k), scale(v, dy * k)));
  }

  zoom(factor) {
    this.distance = Math.max(0.6, Math.min(25, this.distance * factor));
  }

  view() {
    return lookAt(this.eye, this.target, this.up);
  }

  /** Height of the orthographic view volume: matches what perspective shows at the target distance. */
  get orthoHeight() {
    return 2 * this.distance * Math.tan((this.fovDeg * DEG) / 2);
  }

  projectionMatrix(aspect) {
    if (this.projection === 'perspective') return perspective(this.fovDeg * DEG, aspect, this.near, this.far);
    const h = this.orthoHeight / 2, w = h * aspect;
    return orthographic(-w, w, -h, h, this.near, this.far);
  }

  viewProj(aspect) {
    return multiply(this.projectionMatrix(aspect), this.view());
  }
}

/** The fixed "inspection" camera that looks at the scene (and the main camera's frustum) from outside. */
export class FixedCamera {
  constructor(eye, target, fovDeg = 50, near = 0.1, far = 200) {
    Object.assign(this, { eye, target, fovDeg, near, far, up: [0, 1, 0] });
  }
  view() { return lookAt(this.eye, this.target, this.up); }
  projectionMatrix(aspect) { return perspective(this.fovDeg * DEG, aspect, this.near, this.far); }
  viewProj(aspect) { return multiply(this.projectionMatrix(aspect), this.view()); }
}
