import { describe, it, expect } from 'vitest';
import { Node } from '../src/scene/node.js';
import { buildScene } from '../src/scene/scene.js';
import * as M from '../src/math/mat4.js';

describe('scene graph', () => {
  it('world = parent world · local, down three levels', () => {
    const a = new Node('a', { local: M.translate(1, 0, 0) });
    const b = new Node('b', { local: M.rotateZ(Math.PI / 2) });
    const c = new Node('c', { local: M.translate(0, 2, 0) });
    a.add(b); b.add(c);
    a.updateWorld();
    // c's origin: translate (0,2,0), rotate 90° about z → (−2,0,0), translate → (−1,0,0)
    const p = M.transformPoint(c.world, [0, 0, 0]);
    expect(p[0]).toBeCloseTo(-1, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(c.depth()).toBe(2);
  });

  it('the project scene has ≥ 3 levels, ≥ 5 nodes and animated nodes', () => {
    const s = buildScene();
    let count = 0, maxDepth = 0, animated = 0;
    s.root.traverse((n, d) => { count++; maxDepth = Math.max(maxDepth, d); if (n.update) animated++; });
    expect(count).toBeGreaterThanOrEqual(5);
    expect(maxDepth).toBeGreaterThanOrEqual(3);
    expect(animated).toBeGreaterThanOrEqual(1);
  });

  it('traversal matches the explicit product of locals for the leaf', () => {
    const s = buildScene();
    s.root.animate(1.7);
    s.root.updateWorld();
    const manual = M.multiplyAll(...s.fig.path().map((n) => n.local));
    for (let i = 0; i < 16; i++) expect(Math.abs(manual[i] - s.fig.world[i])).toBeLessThan(1e-6);
  });
});
