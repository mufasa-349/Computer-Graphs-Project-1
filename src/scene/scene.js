// Builds the scene graph for "Kavunlu Natürmort" (Şeker Ahmed Paşa).
// The painting hangs on the wall at z = 0; a table stands in front of it (z > 0)
// carrying a plate, a melon swept from the traced curve (bonus), and an
// animated turntable whose two-joint arm carries a fig.
//
// World units are metres-ish; y is up, +z points out of the painting towards the viewer.

import { Node } from './node.js';
import { translate, scale, rotateX, rotateY, rotateZ, multiplyAll, identity } from '../math/mat4.js';

export const PAINTING = {
  title: 'Kavunlu Natürmort (Still Life with Melon)',
  artist: 'Şeker Ahmed Paşa',
  pixels: [720, 502],
  width: 4.0,
};
PAINTING.height = PAINTING.width * (PAINTING.pixels[1] / PAINTING.pixels[0]);
PAINTING.centreY = 1.15 + PAINTING.height / 2;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
export const COLORS = {
  floor: hex('#3a3632'), wood: hex('#6b4a2f'), frame: hex('#4a3420'), plate: hex('#d9d2c3'),
  turntable: hex('#2e5e7e'), arm: hex('#b4441c'), forearm: hex('#d98b2b'), joint: hex('#222222'),
  fig: hex('#5b2a4e'), melon: hex('#c9a227'), partA: hex('#3c7a3a'), follower: hex('#2ec4ff'),
};

const mesh = (name, meshKey, local, color, extra = {}) => new Node(name, { mesh: meshKey, local, color, ...extra });

export function buildScene() {
  const P = PAINTING;
  const root = new Node('world');

  /* ---- wall with the painting ---------------------------------------- */
  const painting = new Node('painting', { local: translate(0, P.centreY, 0) });
  const canvas = mesh('canvas', 'painting', scale(P.width, P.height, 1), [1, 1, 1], { lit: false });
  canvas.showAxes = false;
  const fw = 0.12, fd = 0.08; // frame bar width / depth
  const bar = (name, x, y, sx, sy) => {
    const n = mesh(name, 'cube', multiplyAll(translate(x, y, 0.01), scale(sx, sy, fd)), COLORS.frame);
    n.showAxes = false;
    return n;
  };
  painting.add(
    canvas,
    bar('frame top', 0, P.height / 2 + fw / 2, P.width + 2 * fw, fw),
    bar('frame bottom', 0, -P.height / 2 - fw / 2, P.width + 2 * fw, fw),
    bar('frame left', -P.width / 2 - fw / 2, 0, fw, P.height),
    bar('frame right', P.width / 2 + fw / 2, 0, fw, P.height),
  );
  // Object animated along the traced curve; its local matrix is set every frame.
  const follower = mesh('curve follower', 'arrow', identity(), COLORS.follower);
  painting.add(follower);

  const floor = mesh('floor', 'quad', multiplyAll(rotateX(-Math.PI / 2), scale(16, 16, 1)), COLORS.floor);
  floor.showAxes = false;

  /* ---- table ---------------------------------------------------------- */
  const tableTopY = 0.84;
  const table = new Node('table', { local: translate(0, 0, 1.35) });
  const top = mesh('table top', 'cube', multiplyAll(translate(0, tableTopY, 0), scale(3.6, 0.08, 1.6)), COLORS.wood);
  top.showAxes = false;
  table.add(top);
  for (const [x, z] of [[-1.65, -0.65], [1.65, -0.65], [-1.65, 0.65], [1.65, 0.65]]) {
    const leg = mesh('leg', 'cube', multiplyAll(translate(x, tableTopY / 2, z), scale(0.09, tableTopY, 0.09)), COLORS.wood);
    leg.showAxes = false;
    table.add(leg);
  }

  // plate + melon made by revolving the traced outline (bonus: surface of revolution)
  const plate = new Node('plate', { local: translate(-0.95, tableTopY + 0.04, 0.1) });
  const plateMesh = mesh('plate mesh', 'cylinder', scale(1.05, 0.03, 1.05), COLORS.plate);
  plateMesh.showAxes = false;
  const melon = mesh('swept melon', 'revolution', identity(), COLORS.melon);
  plate.add(plateMesh, melon);

  /* ---- animated turntable arm (the hierarchy in motion) --------------- */
  const turntable = new Node('turntable', { local: translate(0.95, tableTopY + 0.04, 0) });
  turntable.update = (n, t) => { n.local = multiplyAll(translate(0.95, tableTopY + 0.04, 0), rotateY(0.6 * t)); };
  const disc = mesh('turntable disc', 'cylinder', multiplyAll(translate(0, 0.025, 0), scale(0.8, 0.05, 0.8)), COLORS.turntable);
  disc.showAxes = false;

  const arm = new Node('arm', { local: translate(0, 0.05, 0) });
  arm.update = (n, t) => { n.local = multiplyAll(translate(0, 0.05, 0), rotateZ(0.45 * Math.sin(1.3 * t))); };
  const armMesh = mesh('arm mesh', 'cylinder', multiplyAll(translate(0, 0.3, 0), scale(0.07, 0.6, 0.07)), COLORS.arm);
  armMesh.showAxes = false;

  const elbow = new Node('elbow', { local: translate(0, 0.6, 0) });
  elbow.update = (n, t) => { n.local = multiplyAll(translate(0, 0.6, 0), rotateZ(0.9 * Math.sin(2.1 * t + 1))); };
  const joint = mesh('elbow joint', 'sphere', scale(0.13, 0.13, 0.13), COLORS.joint);
  joint.showAxes = false;
  const forearm = mesh('forearm mesh', 'cylinder', multiplyAll(translate(0, 0.22, 0), scale(0.055, 0.44, 0.055)), COLORS.forearm);
  forearm.showAxes = false;

  const hand = new Node('hand', { local: translate(0, 0.44, 0) });
  const fig = mesh('fig', 'sphere', multiplyAll(translate(0, 0.07, 0), scale(0.17, 0.2, 0.17)), COLORS.fig);

  hand.add(fig);
  elbow.add(joint, forearm, hand);
  arm.add(armMesh, elbow);
  turntable.add(disc, arm);
  table.add(plate, turntable);

  /* ---- Part A: the object driven from the UI -------------------------- */
  const partA = mesh('Part A box', 'cube', identity(), COLORS.partA);

  root.add(painting, floor, table, partA);
  return { root, painting, follower, melon, partA, fig, turntable, arm, elbow, hand, table };
}

/** Painting coordinates (u, v) ∈ [0,1]², v up, → the painting node's local frame. */
export function paintingLocal(u, v, z = 0) {
  return [(u - 0.5) * PAINTING.width, (v - 0.5) * PAINTING.height, z];
}
