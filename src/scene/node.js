// Scene-graph node: a local transform, a parent, children, and a world matrix
// computed by traversal:  world(node) = world(parent) · local(node).

import { identity, multiply } from '../math/mat4.js';

export class Node {
  constructor(name, { local = identity(), mesh = null, color = [1, 1, 1], lit = true, visible = true } = {}) {
    this.name = name;
    this.local = local;
    this.world = identity();
    this.parent = null;
    this.children = [];
    this.mesh = mesh;          // key into the renderer's mesh table, or null for pure transform nodes
    this.color = color;        // sRGB 0..1
    this.lit = lit;
    this.visible = visible;
    this.update = null;        // optional (node, time) => void, used for animated nodes
    this.showAxes = true;      // drawn in debug mode
  }

  add(...children) {
    for (const c of children) {
      if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1);
      c.parent = this;
      this.children.push(c);
    }
    return this;
  }

  /** Run animation callbacks for this subtree. */
  animate(time) {
    if (this.update) this.update(this, time);
    for (const c of this.children) c.animate(time);
  }

  /** Depth-first traversal that recomputes every world matrix from the root down. */
  updateWorld(parentWorld = identity()) {
    this.world = multiply(parentWorld, this.local);
    for (const c of this.children) c.updateWorld(this.world);
  }

  traverse(fn, depth = 0) {
    fn(this, depth);
    for (const c of this.children) c.traverse(fn, depth + 1);
  }

  find(name) {
    let hit = null;
    this.traverse((n) => { if (!hit && n.name === name) hit = n; });
    return hit;
  }

  /** Path from the root down to this node (root first). */
  path() {
    const p = [];
    for (let n = this; n; n = n.parent) p.unshift(n);
    return p;
  }

  depth() {
    return this.path().length - 1;
  }
}
