/* CS405 Project 1 explorer — small self-contained helpers + four demos */
(function(){
/* ---------- helpers ---------- */
const el = (tag, attrs = {}, parent) => { const e = document.createElement(tag);
  for (const k in attrs) { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else e.setAttribute(k, attrs[k]); }
  if (parent) parent.appendChild(e); return e; };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function canvas(parent, w, h){
  const cv = el('canvas', {}, parent), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { cv, g, w, h, dpr };
}
function pointer(cv, w, h, hs){
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * w / r.width, y: (e.clientY - r.top) * h / r.height }; };
  let down = false;
  cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); hs.down && hs.down(pos(e)); });
  cv.addEventListener('pointermove', e => hs.move && hs.move(pos(e), down));
  cv.addEventListener('pointerup', e => { down = false; hs.up && hs.up(pos(e)); });
}
function controls(parent){
  const bar = el('div', { class: 'ctl' }, parent);
  return { bar,
    slider(label, min, max, step, value, on){ const l = el('label', {}, bar); l.append(label + ' ');
      const i = el('input', { type: 'range', min, max, step, value }, l), v = el('span', { class: 'val' }, l); v.textContent = (+value).toFixed(step < 1 ? 2 : 0);
      i.addEventListener('input', () => { v.textContent = (+i.value).toFixed(step < 1 ? 2 : 0); on(parseFloat(i.value)); });
      return { set(x){ i.value = x; v.textContent = (+x).toFixed(step < 1 ? 2 : 0); } }; },
    toggle(label, value, on){ const b = el('button', { text: label }, bar); b.classList.toggle('on', value);
      b.addEventListener('click', () => { value = !value; b.classList.toggle('on', value); on(value); });
      return { set(x){ value = x; b.classList.toggle('on', value); } }; },
    button(label, on){ const b = el('button', { text: label }, bar); b.addEventListener('click', on); return b; } };
}
/* 4×4 matrices, column-major (same layout you will upload to WebGPU) */
const Mat = {
  id: () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1],
  mul(a, b){ const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
    return o; },
  mulAll(...ms){ return ms.reduce((a, b) => Mat.mul(a, b)); },
  translate: (x, y, z) => [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1],
  scale: (x, y, z) => [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1],
  rotY(a){ const c = Math.cos(a), s = Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; },
  rotZ(a){ const c = Math.cos(a), s = Math.sin(a); return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; },
  rotX(a){ const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; },
  apply(m, p){ const [x, y, z] = p, w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return { x: m[0]*x + m[4]*y + m[8]*z + m[12], y: m[1]*x + m[5]*y + m[9]*z + m[13], z: m[2]*x + m[6]*y + m[10]*z + m[14], w }; },
  lookAt(eye, target, up){
    const f = V.norm(V.sub(target, eye));            // forward
    const w = V.scale(f, -1);                        // camera looks down −z
    const u = V.norm(V.cross(up, w)), v = V.cross(w, u);
    return [u[0], v[0], w[0], 0, u[1], v[1], w[1], 0, u[2], v[2], w[2], 0,
            -V.dot(u, eye), -V.dot(v, eye), -V.dot(w, eye), 1];
  },
  perspective(fovy, aspect, n, f){ const t = 1 / Math.tan(fovy / 2);
    return [t / aspect,0,0,0, 0,t,0,0, 0,0, f / (n - f), -1, 0,0, n * f / (n - f), 0]; },   // WebGPU: z ∈ [0,1]
  ortho(h, aspect, n, f){ const t = h / 2, r = t * aspect;
    return [1 / r,0,0,0, 0,1 / t,0,0, 0,0, 1 / (n - f),0, 0,0, n / (n - f), 1]; },
  fmt(m){ let s = '';
    for (let r = 0; r < 4; r++) { for (let c = 0; c < 4; c++) { const v = m[c * 4 + r]; s += (Math.abs(v) < 5e-3 ? 0 : v).toFixed(2).padStart(7); } s += '\n'; }
    return s; },
};
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm(a){ const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
// minimal 3D line renderer: give it a view-projection matrix, it clips crudely and draws
function Renderer(C){
  const { g, w, h } = C;
  let VP = Mat.id();
  const toScreen = p => { const c = Mat.apply(VP, p); if (c.w <= 0.001) return null;
    return { x: (c.x / c.w * 0.5 + 0.5) * w, y: (0.5 - c.y / c.w * 0.5) * h, z: c.z / c.w }; };
  return {
    set VP(m){ VP = m; }, toScreen,
    clear(bg){ g.fillStyle = bg || css('--panel'); g.fillRect(0, 0, w, h); },
    line(a, b, col, lw = 1.5, dash){ const A = toScreen(a), B = toScreen(b); if (!A || !B) return;
      g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); g.setLineDash([]); },
    poly(pts, fill, stroke, alpha = 1){ const s = pts.map(toScreen); if (s.some(p => !p)) return;
      g.globalAlpha = alpha; g.beginPath(); s.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1.2; g.stroke(); } g.globalAlpha = 1; },
    dot(p, col, r = 5){ const s = toScreen(p); if (!s) return; g.fillStyle = col; g.beginPath(); g.arc(s.x, s.y, r, 0, 7); g.fill(); },
    text(p, t, col, dx = 6, dy = -6){ const s = toScreen(p); if (!s) return; g.fillStyle = col; g.font = '600 12px system-ui,sans-serif'; g.fillText(t, s.x + dx, s.y + dy); },
    grid(col, n = 6){ for (let i = -n; i <= n; i++) { this.line([i, 0, -n], [i, 0, n], col, 1); this.line([-n, 0, i], [n, 0, i], col, 1); } },
    axes(){ this.line([0,0,0], [1.4,0,0], '#c0392b', 2.5); this.line([0,0,0], [0,1.4,0], '#27ae60', 2.5); this.line([0,0,0], [0,0,1.4], '#2e86c1', 2.5);
      this.text([1.5,0,0], 'x', '#c0392b'); this.text([0,1.5,0], 'y', '#27ae60'); this.text([0,0,1.5], 'z', '#2e86c1'); },
  };
}
const CUBE = { v: [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,.5,-.5],[-.5,.5,-.5],[-.5,-.5,.5],[.5,-.5,.5],[.5,.5,.5],[-.5,.5,.5]],
  f: [[0,1,2,3],[5,4,7,6],[4,0,3,7],[1,5,6,2],[3,2,6,7],[4,5,1,0]],
  c: ['#b4441c','#d98b2b','#1f5f8b','#3c7a3a','#8a4fa0','#777'] };
function drawCube(R, M, alpha = 1){
  const p = CUBE.v.map(v => { const q = Mat.apply(M, v); return [q.x, q.y, q.z]; });
  const faces = CUBE.f.map((f, i) => { const pts = f.map(k => p[k]);
    const s = pts.map(R.toScreen); const depth = s.every(Boolean) ? s.reduce((a, b) => a + b.z, 0) / 4 : 9;
    return { pts, col: CUBE.c[i], depth }; }).sort((a, b) => b.depth - a.depth);
  faces.forEach(f => R.poly(f.pts, f.col, 'rgba(0,0,0,.45)', alpha));
}
const orbit = (st, cv, W, H, draw) => pointer(cv, W, H, {
  down(p){ this.l = p; }, up(){ this.l = null; },
  move(p, d){ if (d && this.l) { st.yaw -= (p.x - this.l.x) * 0.01; st.pitch = Math.max(-1.3, Math.min(1.35, st.pitch + (p.y - this.l.y) * 0.008)); this.l = p; draw(); } } });
const camPos = st => [st.dist * Math.cos(st.pitch) * Math.sin(st.yaw), st.dist * Math.sin(st.pitch) + (st.h || 0), st.dist * Math.cos(st.pitch) * Math.cos(st.yaw)];

/* ==================================================================
   1. Composition order: T·R·S vs S·R·T
   ================================================================== */
(function(){
  const host = document.getElementById('d-order'); if (!host) return;
  const W = 420, H = 330;
  const row = el('div', { class: 'row' }, host);
  const mk = t => { const d = el('div', {}, row); el('div', { class: 'cap', html: t }, d); const c = canvas(d, W, H); const m = el('pre', { class: 'mat' }, d); return { ...c, m }; };
  const A = mk('M = T · R · S <span class="muted">(scale first — the usual choice)</span>');
  const B = mk('M = S · R · T <span class="muted">(scale last — scales the translation too)</span>');
  const st = { yaw: 0.7, pitch: 0.4, dist: 7, tx: 1.5, ry: 0.6, s: 1.4 };
  const c = controls(host);
  c.slider('translate x', -3, 3, 0.1, st.tx, v => { st.tx = v; draw(); });
  c.slider('rotate y', -3.14, 3.14, 0.02, st.ry, v => { st.ry = v; draw(); });
  c.slider('scale', 0.3, 2.5, 0.05, st.s, v => { st.s = v; draw(); });
  el('p', { class: 'hint', text: 'Drag either view to orbit. Matrix multiplication is not commutative: the same three operations in a different order put the object somewhere else.' }, host);
  const RA = Renderer(A), RB = Renderer(B);
  function draw(){
    const eye = camPos(st), V_ = Mat.lookAt(eye, [0, 0.4, 0], [0, 1, 0]), P = Mat.perspective(0.9, W / H, 0.1, 50);
    const VP = Mat.mul(P, V_);
    const T = Mat.translate(st.tx, 0.5, 0), Rm = Mat.rotY(st.ry), S = Mat.scale(st.s, st.s, st.s);
    [[A, RA, Mat.mulAll(T, Rm, S)], [B, RB, Mat.mulAll(S, Rm, T)]].forEach(([P_, R, M]) => {
      R.VP = VP; R.clear(); R.grid(css('--line')); R.axes();
      drawCube(R, Mat.translate(0, 0.5, 0), 0.25);                 // ghost of the untransformed cube
      drawCube(R, M);
      const o = Mat.apply(M, [0, 0, 0]); R.dot([o.x, o.y, o.z], '#111', 4);
      P_.m.textContent = Mat.fmt(M);
    });
  }
  orbit(st, A.cv, W, H, draw); orbit(st, B.cv, W, H, draw);
  draw();
})();

/* ==================================================================
   2. lookAt camera, perspective vs orthographic
   ================================================================== */
(function(){
  const host = document.getElementById('d-camera'); if (!host) return;
  const W = 420, H = 330;
  const row = el('div', { class: 'row' }, host);
  const mk = t => { const d = el('div', {}, row); el('div', { class: 'cap', html: t }, d); return { ...canvas(d, W, H), d }; };
  const A = mk('World view <span class="muted">— your camera drawn as a frustum</span>');
  const B = mk('What that camera sees');
  const info = el('pre', { class: 'mat wide' }, host);
  const st = { yaw: 0.9, pitch: 0.5, dist: 12, h: 1, cyaw: 0.4, cpitch: 0.25, cdist: 5.5, fov: 55, near: 1, far: 8, persp: true, ty: 0.6 };
  const c = controls(host);
  c.slider('camera azimuth', -3.14, 3.14, 0.02, st.cyaw, v => { st.cyaw = v; draw(); });
  c.slider('camera height', -0.3, 1.4, 0.02, st.cpitch, v => { st.cpitch = v; draw(); });
  c.slider('distance', 2, 10, 0.1, st.cdist, v => { st.cdist = v; draw(); });
  c.slider('fov (°)', 15, 100, 1, st.fov, v => { st.fov = v; draw(); });
  c.slider('near', 0.2, 4, 0.1, st.near, v => { st.near = v; draw(); });
  c.slider('far', 3, 14, 0.5, st.far, v => { st.far = v; draw(); });
  c.toggle('perspective / orthographic', true, v => { st.persp = v; draw(); });
  el('p', { class: 'hint', text: 'Drag the left view to orbit around the scene. Everything the camera can see lies inside the truncated pyramid (the view frustum) between the near and far planes.' }, host);
  const RA = Renderer(A), RB = Renderer(B);
  const boxes = [[[-2, 0.5, -1], 1, '#b4441c'], [[0.6, 0.8, 0.4], 1.6, '#1f5f8b'], [[2.2, 0.4, -1.6], 0.8, '#3c7a3a']];
  function camEye(){ return [st.cdist * Math.cos(st.cpitch) * Math.sin(st.cyaw), 0.6 + st.cdist * Math.sin(st.cpitch), st.cdist * Math.cos(st.cpitch) * Math.cos(st.cyaw)]; }
  function scene(R){
    R.grid(css('--line'));
    R.poly([[-3.2, 0, -2.4], [3.2, 0, -2.4], [3.2, 0, 2.4], [-3.2, 0, 2.4]], 'rgba(150,150,150,.25)', null);
    boxes.forEach(([p, s, col]) => { const M = Mat.mul(Mat.translate(...p), Mat.scale(s, s, s));
      const saved = CUBE.c.slice(); CUBE.c.fill(col); drawCube(R, M); CUBE.c.splice(0, 6, ...saved); });
    R.axes();
  }
  function draw(){
    const eye = camEye(), target = [0, st.ty, 0], up = [0, 1, 0];
    const Vc = Mat.lookAt(eye, target, up);
    const aspect = W / H;
    const Pc = st.persp ? Mat.perspective(st.fov * Math.PI / 180, aspect, st.near, st.far) : Mat.ortho(4, aspect, st.near, st.far);
    // world view
    const eo = camPos(st);
    RA.VP = Mat.mul(Mat.perspective(0.8, aspect, 0.1, 60), Mat.lookAt(eo, [0, 0.8, 0], up));
    RA.clear(); scene(RA);
    // frustum: corners in camera space → world
    const f = V.norm(V.sub(target, eye)), r = V.norm(V.cross(f, up)), u = V.cross(r, f);
    const corner = (d, sx, sy) => { const hh = st.persp ? Math.tan(st.fov * Math.PI / 360) * d : 2, hw = hh * aspect;
      return V.add(V.add(eye, V.scale(f, d)), V.add(V.scale(r, sx * hw), V.scale(u, sy * hh))); };
    const nr = [corner(st.near, -1, -1), corner(st.near, 1, -1), corner(st.near, 1, 1), corner(st.near, -1, 1)];
    const fr = [corner(st.far, -1, -1), corner(st.far, 1, -1), corner(st.far, 1, 1), corner(st.far, -1, 1)];
    for (let k = 0; k < 4; k++) { RA.line(nr[k], nr[(k + 1) % 4], '#b4441c', 2); RA.line(fr[k], fr[(k + 1) % 4], '#b4441c', 1.5, [5, 4]); RA.line(nr[k], fr[k], '#b4441c', 1.2, [3, 4]); }
    RA.poly(nr, 'rgba(180,68,28,.18)', '#b4441c');
    RA.dot(eye, '#b4441c', 6); RA.text(eye, 'eye', css('--ink'), 8, -10);
    RA.line(eye, target, css('--ink2'), 1, [4, 4]); RA.dot(target, css('--ink'), 4); RA.text(target, 'target', css('--ink2'), 8, 14);
    // camera view
    RB.VP = Mat.mul(Pc, Vc); RB.clear(); scene(RB);
    info.textContent = 'V = lookAt(eye, target, up)\n' + Mat.fmt(Vc) + '\n' + (st.persp ? 'P = perspective(fov, aspect, near, far)' : 'P = orthographic(height, aspect, near, far)') + '\n' + Mat.fmt(Pc);
  }
  orbit(st, A.cv, W, H, draw);
  draw();
})();

/* ==================================================================
   3. Scene graph: transforms compose down the tree
   ================================================================== */
(function(){
  const host = document.getElementById('d-graph'); if (!host) return;
  const W = 560, H = 380;
  const wrap = el('div', { class: 'row' }, host);
  const left = el('div', {}, wrap);
  const C = canvas(left, W, H);
  const right = el('div', {}, wrap);
  const tree = el('pre', { class: 'mat', style: 'min-width:300px' }, right);
  const st = { yaw: 0.8, pitch: 0.45, dist: 9, a1: 0.5, a2: -0.8, a3: 0.9, spin: 0 };
  const c = controls(host);
  c.slider('base rotation', -3.14, 3.14, 0.02, st.a1, v => { st.a1 = v; draw(); });
  c.slider('joint 1', -1.5, 1.5, 0.02, st.a2, v => { st.a2 = v; draw(); });
  c.slider('joint 2', -1.5, 1.5, 0.02, st.a3, v => { st.a3 = v; draw(); });
  c.toggle('animate', false, v => { v ? anim() : cancelAnimationFrame(raf); });
  el('p', { class: 'hint', text: 'Each node stores only its own local transform. A node\'s world matrix is the product of every matrix from the root down to it — that is all a scene graph does.' }, host);
  const R = Renderer(C);
  let raf = 0;
  function anim(){ st.spin += 0.02; st.a2 = Math.sin(st.spin) * 0.8; st.a3 = Math.cos(st.spin * 1.3) * 1.1; draw(); raf = requestAnimationFrame(anim); }
  function draw(){
    const eye = camPos(st);
    R.VP = Mat.mul(Mat.perspective(0.85, W / H, 0.1, 40), Mat.lookAt(eye, [0, 1.2, 0], [0, 1, 0]));
    R.clear(); R.grid(css('--line')); R.axes();
    const M0 = Mat.mul(Mat.translate(0, 0.15, 0), Mat.rotY(st.a1));
    const M1 = Mat.mulAll(M0, Mat.translate(0, 0.15, 0), Mat.rotZ(st.a2));
    const M2 = Mat.mulAll(M1, Mat.translate(0, 1.2, 0), Mat.rotZ(st.a3));
    const M3 = Mat.mul(M2, Mat.translate(0, 1.0, 0));
    const seg = (M, len, col) => { const saved = CUBE.c.slice(); CUBE.c.fill(col);
      drawCube(R, Mat.mulAll(M, Mat.translate(0, len / 2, 0), Mat.scale(0.28, len, 0.28))); CUBE.c.splice(0, 6, ...saved); };
    const saved = CUBE.c.slice(); CUBE.c.fill('#8a857c'); drawCube(R, Mat.mul(M0, Mat.scale(1.1, 0.3, 1.1))); CUBE.c.splice(0, 6, ...saved);
    seg(M1, 1.2, '#1f5f8b'); seg(M2, 1.0, '#b4441c');
    const saved2 = CUBE.c.slice(); CUBE.c.fill('#c9a227'); drawCube(R, Mat.mul(M3, Mat.scale(0.5, 0.35, 0.5))); CUBE.c.splice(0, 6, ...saved2);
    // frames
    [[M0, 'base'], [M1, 'arm 1'], [M2, 'arm 2'], [M3, 'hand']].forEach(([M, name]) => {
      const o = Mat.apply(M, [0, 0, 0]), ax = Mat.apply(M, [0.5, 0, 0]), ay = Mat.apply(M, [0, 0.5, 0]);
      R.line([o.x, o.y, o.z], [ax.x, ax.y, ax.z], '#c0392b', 2); R.line([o.x, o.y, o.z], [ay.x, ay.y, ay.z], '#27ae60', 2);
      R.dot([o.x, o.y, o.z], css('--ink'), 3.5); R.text([o.x, o.y, o.z], name, css('--ink'), 8, -4); });
    const p = Mat.apply(M3, [0, 0, 0]);
    tree.textContent =
`root
└─ base      local: R_y(${st.a1.toFixed(2)})
   └─ arm 1  local: T(0,0.15,0)·R_z(${st.a2.toFixed(2)})
      └─ arm 2  local: T(0,1.2,0)·R_z(${st.a3.toFixed(2)})
         └─ hand  local: T(0,1.0,0)

world(hand) = M_base · M_arm1 · M_arm2 · M_hand

${Mat.fmt(M3)}
hand position in world:
  (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
  }
  orbit(st, C.cv, W, H, draw);
  draw();
})();

/* ==================================================================
   4. Curves over the painting
   ================================================================== */
(function(){
  const host = document.getElementById('d-curve'); if (!host) return;
  const W = 660, H = 460;
  const wrap = el('div', { class: 'row' }, host);
  const left = el('div', { style: 'position:relative' }, wrap);
  const C = canvas(left, W, H);
  const right = el('div', {}, wrap);
  const out = el('pre', { class: 'mat', style: 'min-width:300px;max-height:420px;overflow:auto' }, right);
  const st = { t: 0.45, cast: true, mode: 'bezier', anim: false, showPoly: true };
  const c = controls(host);
  const tS = c.slider('parameter t', 0, 1, 0.005, st.t, v => { st.t = v; draw(); });
  c.toggle('de Casteljau construction', true, v => { st.cast = v; draw(); });
  c.toggle('control polygon', true, v => { st.showPoly = v; draw(); });
  const bB = c.button('Bézier (piecewise, C¹)', () => { st.mode = 'bezier'; bB.classList.add('on'); bC.classList.remove('on'); draw(); });
  const bC = c.button('Catmull–Rom (through the points)', () => { st.mode = 'cr'; bC.classList.add('on'); bB.classList.remove('on'); draw(); });
  bB.classList.add('on');
  c.button('animate', () => { st.anim = !st.anim; if (st.anim) loop(); });
  c.button('export JSON', () => { out.textContent = JSON.stringify({ painting: 'Kavunlu Naturmort', type: st.mode, points: pts.map(p => ({ x: +(p.x / W).toFixed(4), y: +(1 - p.y / H).toFixed(4) })) }, null, 1); });
  el('p', { class: 'hint', html: 'Drag the round points to trace a shape in the painting. Square points are Bézier handles — with C¹ continuity on, the handle on the far side of a joint mirrors the one you drag. The marker rides the curve at parameter <b>t</b>.' }, host);
  let img = null;
  const im = new Image(); im.onload = () => { img = im; draw(); }; im.src = window.KAVUNLU_SRC;
  // piecewise cubic Bézier: knots at 0,3,6… handles between
  const pts = [
    { x: 150, y: 330, k: 1 }, { x: 215, y: 250 }, { x: 290, y: 205 },
    { x: 330, y: 190, k: 1 }, { x: 390, y: 182 }, { x: 452, y: 196 },
    { x: 505, y: 245, k: 1 }, { x: 545, y: 290 }, { x: 572, y: 342 },
    { x: 585, y: 395, k: 1 },
  ];
  function bez(p0, p1, p2, p3, t){ const u = 1 - t;
    return { x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
             y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y }; }
  function crPoint(P, i, t){ const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[Math.min(P.length - 1, i + 1)], p3 = P[Math.min(P.length - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) }; }
  const knots = () => pts.filter(p => p.k);
  function curveAt(t){
    if (st.mode === 'cr') { const K = knots(), n = K.length - 1, s = Math.min(n - 1e-9, t * n), i = Math.floor(s); return crPoint(K, i, s - i); }
    const segs = (pts.length - 1) / 3, s = Math.min(segs - 1e-9, t * segs), i = Math.floor(s) * 3;
    return bez(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], s - Math.floor(s));
  }
  function enforceC1(moved){
    if (st.mode !== 'bezier') return;
    for (let k = 3; k < pts.length - 1; k += 3) {             // interior knot at index k
      const before = pts[k - 1], after = pts[k + 1], K = pts[k];
      if (moved === k - 1) { after.x = 2 * K.x - before.x; after.y = 2 * K.y - before.y; }
      else if (moved === k + 1) { before.x = 2 * K.x - after.x; before.y = 2 * K.y - after.y; }
      else if (moved === k) { /* knot dragged: handles follow rigidly */ }
    }
  }
  let drag = -1, prev = null;
  pointer(C.cv, W, H, {
    down(p){ let best = -1, bd = 196; pts.forEach((q, i) => { const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (d < bd) { bd = d; best = i; } });
      drag = best; prev = p; },
    move(p, d){ if (!d || drag < 0) return;
      if (pts[drag].k) { const dx = p.x - prev.x, dy = p.y - prev.y;      // move a knot with its handles
        [drag - 1, drag + 1].forEach(i => { if (pts[i] && !pts[i].k) { pts[i].x += dx; pts[i].y += dy; } }); }
      pts[drag].x = p.x; pts[drag].y = p.y; prev = p; enforceC1(drag); draw(); },
    up(){ drag = -1; } });
  function loop(){ if (!st.anim) return; st.t = (st.t + 0.004) % 1; tS.set(st.t); draw(); requestAnimationFrame(loop); }
  function draw(){
    const g = C.g; g.clearRect(0, 0, W, H);
    if (img) { g.globalAlpha = 0.85; g.drawImage(img, 0, 0, W, H); g.globalAlpha = 1; }
    else { g.fillStyle = '#222'; g.fillRect(0, 0, W, H); }
    // the curve
    g.strokeStyle = '#ffd54a'; g.lineWidth = 3.5; g.beginPath();
    for (let k = 0; k <= 300; k++) { const p = curveAt(k / 300); k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); } g.stroke();
    if (st.showPoly && st.mode === 'bezier') { g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.setLineDash([5, 4]);
      g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke(); g.setLineDash([]); }
    // de Casteljau at t (first-level interpolation shown for the active segment)
    if (st.cast && st.mode === 'bezier') {
      const segs = (pts.length - 1) / 3, s = Math.min(segs - 1e-9, st.t * segs), i = Math.floor(s) * 3, u = s - Math.floor(s);
      let level = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]].map(p => ({ x: p.x, y: p.y }));
      const cols = ['#6fb3e0', '#7cc478', '#f07a4a'];
      for (let d = 0; d < 3; d++) {
        const next = []; for (let k = 0; k + 1 < level.length; k++) next.push({ x: level[k].x + (level[k + 1].x - level[k].x) * u, y: level[k].y + (level[k + 1].y - level[k].y) * u });
        g.strokeStyle = cols[d]; g.lineWidth = 1.6; g.beginPath(); next.forEach((p, k) => k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)); g.stroke();
        next.forEach(p => { g.fillStyle = cols[d]; g.beginPath(); g.arc(p.x, p.y, 3.5, 0, 7); g.fill(); });
        level = next;
      }
    }
    // control points
    pts.forEach((p, i) => { const knot = !!p.k; if (st.mode === 'cr' && !knot) return;
      g.fillStyle = knot ? '#b4441c' : '#ffffff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
      g.beginPath(); knot ? g.arc(p.x, p.y, 8, 0, 7) : g.rect(p.x - 6, p.y - 6, 12, 12); g.fill(); g.stroke(); });
    // the moving marker
    const m = curveAt(st.t);
    g.fillStyle = '#ffd54a'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(m.x, m.y, 9, 0, 7); g.fill(); g.stroke();
    const K = knots();
    out.textContent =
`curve type : ${st.mode === 'bezier' ? 'piecewise cubic Bézier' : 'Catmull–Rom spline'}
segments   : ${st.mode === 'bezier' ? (pts.length - 1) / 3 : K.length - 1}
t          : ${st.t.toFixed(3)}
C(t)       : (${m.x.toFixed(1)}, ${m.y.toFixed(1)}) px
             (${(m.x / W).toFixed(3)}, ${(1 - m.y / H).toFixed(3)}) normalised

B(t) = (1−t)³P₀ + 3(1−t)²t P₁
     + 3(1−t)t² P₂ + t³P₃

de Casteljau: repeatedly interpolate
neighbouring points by t until one
point is left — that point is B(t).

C¹ at an interior knot K needs
P_after = 2K − P_before  (handles
opposite and equal in length).`;
  }
  draw();
})();
})();
