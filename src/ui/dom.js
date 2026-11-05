// Tiny DOM helpers for the control panel (no UI library needed).

export function el(tag, attrs = {}, parent) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (parent) parent.appendChild(e);
  return e;
}

export function section(parent, title, badge, open = true) {
  const d = el('details', { class: 'section' }, parent);
  d.open = open;
  const s = el('summary', {}, d);
  el('span', { class: 'title', text: title }, s);
  if (badge) el('span', { class: 'badge', text: badge }, s);
  return el('div', { class: 'body' }, d);
}

export function row(parent, cls = 'row') {
  return el('div', { class: cls }, parent);
}

export function slider(parent, label, { min, max, step, value, digits = 2, unit = '' }, onInput) {
  const wrap = el('label', { class: 'slider' }, parent);
  el('span', { class: 'lbl', text: label }, wrap);
  const input = el('input', { type: 'range', min, max, step, value }, wrap);
  const out = el('span', { class: 'val' }, wrap);
  const show = (v) => { out.textContent = Number(v).toFixed(digits) + unit; };
  show(value);
  input.addEventListener('input', () => { show(input.value); onInput(parseFloat(input.value)); });
  return {
    set(v) { input.value = v; show(v); },
    input,
  };
}

export function toggle(parent, label, value, onChange, title = '') {
  const b = el('button', { class: 'toggle', text: label, title }, parent);
  const set = (v) => { value = v; b.classList.toggle('on', !!v); b.setAttribute('aria-pressed', String(!!v)); };
  set(value);
  b.addEventListener('click', () => { set(!value); onChange(value); });
  return { set, el: b };
}

export function segmented(parent, options, value, onChange) {
  const g = el('div', { class: 'seg', role: 'group' }, parent);
  const buttons = options.map(([v, label, title = '']) => {
    const b = el('button', { text: label, title }, g);
    b.addEventListener('click', () => { set(v); onChange(v); });
    return [v, b];
  });
  function set(v) { buttons.forEach(([bv, b]) => { b.classList.toggle('on', bv === v); b.setAttribute('aria-pressed', String(bv === v)); }); }
  set(value);
  return { set };
}

export function button(parent, label, onClick, title = '') {
  return el('button', { class: 'btn', text: label, title, onclick: onClick }, parent);
}

export function select(parent, label, options, value, onChange) {
  const wrap = el('label', { class: 'select' }, parent);
  el('span', { class: 'lbl', text: label }, wrap);
  const s = el('select', {}, wrap);
  for (const [v, text] of options) el('option', { value: v, text }, s);
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return { set(v) { s.value = v; } };
}

export function readout(parent, cls = '') {
  return el('pre', { class: 'readout ' + cls }, parent);
}

export function hint(parent, html) {
  return el('p', { class: 'hint', html }, parent);
}
