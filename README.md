# CS405 Project 1 — Transformations, Projection & Curves from Paintings

A single WebGPU application built around **Şeker Ahmed Paşa — *Kavunlu Natürmort* (Still Life with Melon)**
from the Sakıp Sabancı Museum collection. The painting hangs in the scene as a textured quad, a table with
objects stands in front of it, an orbit camera moves around them, and curves are traced over the melon.

Everything is written from scratch in JavaScript + WGSL: no Three.js, Babylon, gl-matrix or other maths/scene
libraries. The only dependencies are the dev tools Vite (dev server) and Vitest (unit tests).

## Running

```bash
npm install
npm run dev        # open the printed URL (default http://localhost:5173)
npm test           # 31 unit tests for the maths, curves and scene graph
npm run build      # optional production build into dist/
```

Requires a browser with WebGPU: current Chrome / Edge, Safari 26+, or Firefox 141+.
The interactive specification from the course is kept, untouched, in [`spec/`](spec/index.html).

## What is where

```
src/
  math/     vec3.js, mat4.js (column-major 4×4 library, lookAt, perspective, orthographic),
            curves.js (Bézier, de Casteljau, C¹ piecewise, Catmull–Rom, B-spline, arc length, LSQ fit)
  scene/    node.js (scene-graph node), scene.js (the scene), camera.js (orbit + fixed camera),
            curve.js (curve state, JSON import/export, revolution profile)
  render/   renderer.js (device, pipelines, uniform buffers, draw loop), shaders.js (WGSL),
            geometry.js (cube, sphere, cylinder, arrow, surface of revolution), immediate.js, overlays.js
  ui/       panel.js (control panel), input.js (mouse picking/orbit), dom.js, style.css
  main.js   state + frame loop that glues the modules together
tests/      Vitest unit tests
public/     the painting (kavunlu-naturmort.jpg, 720 × 502)
curve.json  exported curve (normalised painting coordinates)
report.pdf  the report (source: report/report.html, screenshots in report/screenshots/)
```

Conventions: matrices are **column-major** `Float32Array(16)` (the layout WGSL `mat4x4f` expects, uploaded
directly to uniform buffers), vectors are column vectors, and `A · B` applies `B` first. Objects use
`M = T · R · S`. The camera is right-handed and looks down −z; projections map depth to **z ∈ [0, 1]**
(WebGPU), not OpenGL's [−1, 1].

## Controls

### Mouse (in the 3D view)

| Action | Effect |
|---|---|
| Left-drag on empty space | Orbit the main camera (works in the main and inspection views) |
| Right-drag, middle-drag or Shift + drag | Pan the camera target |
| Mouse wheel | Zoom (orbit distance) |
| Drag a round knot / square handle on the painting | Move a control point (main view) |
| Double-click on the painting | Append a new curve segment ending there |
| Drag on the painting with *Freehand* on | Sketch a stroke; on release a cubic Bézier is fitted to it |

### Keyboard

`1` main view · `2` inspection view · `3` split view · `P` perspective/orthographic · `O` T·R·S / S·R·T ·
`X` node axes + parent links · `G` floor grid · `F` frustum · `Space` pause animation · `R` reset everything

### Panel

**View & debug (Part E)**
- *Main camera / Inspection / Split*: show the orbit camera, the fixed inspection camera, or both side by side.
- *Reset scene*: restores camera, curve, Part A values and every toggle.
- *Pause animation*: freezes the scene-graph animation and the curve follower.
- *Node axes*, *Parent links*, *Floor grid*, *Frustum*: debug drawings. Axes are red = x, green = y, blue = z.
- The HUD (top left) shows the average and worst frame time, fps, CPU time per frame, GPU time of the render pass
  (when the browser supports timestamp queries), vertices submitted per frame, draw calls, and the GPU adapter.

**Transformations (Part A)**
- *M = T·R·S / M = S·R·T*: the composition order of the green box.
- *translate x/y/z*, *rotation axis* + *angle*, *scale x/y/z* (*Uniform scale* links them).
- *Ghost of other order*: wireframe of the same T, R and S in the other order.
- Both matrices are printed side by side; the active one is outlined.

**Scene graph (Part B)**
- *animation speed* of the turntable → arm → elbow → hand → fig chain.
- The tree of transform nodes, and the world matrix of the leaf `fig` together with the explicit product of
  the local matrices along its path (their difference is printed as a check).

**Camera & projection (Part C)**
- *Perspective / Orthographic*, *fov y*, *near*, *far*.
- *Reset camera*, *Look straight down* (pitch = 90°, where `up` is parallel to the view direction: the readout
  shows that lookAt's fallback was used).
- Readout: eye, target, up, yaw/pitch, distance, fov, near/far, the target's NDC depth, and the V and P matrices.

**Curves over the painting (Part D)**
- *curve*: piecewise cubic Bézier with C¹ joints, Catmull–Rom through the knots, or a uniform cubic B-spline.
- *parameter s*: position along the curve, which also drives the de Casteljau construction.
- *Animate follower*: the blue arrow moves along the curve at constant speed (arc-length table), aligned with
  the tangent. *follower speed* sets how fast.
- *Control polygon*, *de Casteljau*: toggle those drawings.
- *Remove last segment*, *Reset curve*, *Export JSON* (downloads `curve.json` and prints it), *Import JSON*.

**Bonus**
- *Swept melon*: the traced outline revolved into a mesh on the plate (surface of revolution). It updates live
  as you edit the curve.
- *Freehand trace → least-squares fit*: draw a stroke, get the best-fitting cubic Bézier (magenta) and its RMS
  error. *Clear fit* removes it.

## Curve JSON format

```json
{
  "painting": "Kavunlu Natürmort (Still Life with Melon)",
  "type": "bezier",
  "piecewiseBezier": { "segments": 3, "points": [{ "u": 0.2889, "v": 0.7769 }, …] },
  "knots": [ … ],
  "leastSquaresFit": null
}
```

`u` runs left → right and `v` bottom → top, both in [0, 1] over the painting. Points are laid out
`K0 H H K1 H H K2 …`, with a knot every third point. *Import JSON* accepts the same format.
