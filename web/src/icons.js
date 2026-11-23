// Code-styled pixel animation icons: each icon is a sequence of 12x12 frames ('x' = main, 'o' = blue).
const N = 12;
const blank = () => Array.from({ length: N }, () => ".".repeat(N));
const set = (rows, x, y, ch) => { if (x < 0 || y < 0 || x >= N || y >= N) return; rows[y] = rows[y].slice(0, x) + ch + rows[y].slice(x + 1); };
const box = (r, x0, y0, x1, y1, ch = "x") => { for (let x = x0; x <= x1; x++) { set(r, x, y0, ch); set(r, x, y1, ch); } for (let y = y0; y <= y1; y++) { set(r, x0, y, ch); set(r, x1, y, ch); } };

// request: an arrow enters the box, the box fills once accepted
function request() {
  const arrow = (r, dx) => { set(r, dx + 2, 4, "o"); set(r, dx + 3, 5, "o"); for (let x = 0; x < 5; x++) set(r, dx + x, 6, "o"); set(r, dx + 3, 7, "o"); set(r, dx + 2, 8, "o"); };
  const frames = [0, 1, 2, 3].map((dx) => { const r = blank(); box(r, 8, 3, 11, 9); arrow(r, dx); return r; });
  const last = blank(); box(last, 8, 3, 11, 9); for (let y = 5; y <= 7; y++) for (let x = 9; x <= 10; x++) set(last, x, y, "o");
  return [...frames, last];
}

// pay: a coin drops into the slot
function pay() {
  return [0, 2, 4, 6].map((y0) => {
    const r = blank();
    for (let x = 2; x <= 9; x++) set(r, x, 10, "x");
    for (let y = 0; y < 3; y++) for (let x = 4; x < 8; x++) set(r, x, y0 + y, "o");
    return r;
  });
}

// verify: random blocks (a hash) converge into a checkmark
const check = ["............", "............", "..........o.", ".........oo.", "........oo..", ".x.....oo...", ".xx...oo....", "..xx.oo.....", "...xoo......", "....o.......", "............", "............"];
function verify() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const r = blank();
    for (let y = 2; y < 10; y++) for (let x = 1; x < 11; x++) if (Math.random() < 0.55 - f * 0.12) set(r, x, y, "x");
    frames.push(r);
  }
  return [...frames, check];
}

// tally: lines grow one by one, then a blue strike-through
function tally() {
  const frames = [];
  for (let n = 1; n <= 5; n++) {
    const r = blank();
    [2, 4, 6, 8].slice(0, Math.min(n, 4)).forEach((x) => { for (let y = 2; y <= 9; y++) set(r, x, y, "x"); });
    if (n === 5) for (let i = 0; i <= 9; i++) set(r, 1 + i, 9 - Math.round((i * 7) / 9), "o");
    frames.push(r);
  }
  return frames;
}

// lock: open, then locked
const lockOpen = ["....xxxx....", "...x....x...", "...x....x...", "...x........", "...x........", "..xxxxxxxx..", "..x......x..", "..x..oo..x..", "..x..oo..x..", "..x......x..", "..xxxxxxxx..", "............"];
const lockShut = ["............", "....xxxx....", "...x....x...", "...x....x...", "...x....x...", "..xxxxxxxx..", "..x......x..", "..x..oo..x..", "..x..oo..x..", "..x......x..", "..xxxxxxxx..", "............"];

// burn: the paper strip burns away from the right, a blue ember at its tip, smoke rising
function burn() {
  return [10, 8, 6, 4, 2].map((len, f) => {
    const r = blank();
    for (let x = 1; x < 1 + len; x++) for (let y = 6; y <= 8; y++) set(r, x, y, "x");
    set(r, len, 6, "o"); set(r, len + 1, 7, "o"); set(r, len, 8, "o");
    set(r, len + 1, 4 - (f % 2), "x"); set(r, len + 2, 2 + (f % 2), "x");
    return r;
  });
}

// empty: a marching dashed frame, a blinking cursor, then still
function empty() {
  const frames = [0, 1, 0, 1].map((phase, f) => {
    const r = blank();
    for (let x = 1; x <= 10; x++) { if ((x + phase) % 2) { set(r, x, 2, "x"); set(r, x, 9, "x"); } }
    for (let y = 2; y <= 9; y++) { if ((y + phase) % 2) { set(r, 1, y, "x"); set(r, 10, y, "x"); } }
    if (f % 2 === 0) { set(r, 4, 7, "o"); set(r, 5, 7, "o"); }
    return r;
  });
  return frames;
}

// receipt: paper prints line by line, the total line in blue
function receipt() {
  const frames = [];
  for (let n = 1; n <= 4; n++) {
    const r = blank();
    const bottom = 1 + n * 2 + 1;
    for (let y = 0; y <= bottom; y++) { set(r, 3, y, "x"); set(r, 8, y, "x"); }
    for (let k = 1; k <= n; k++) for (let x = 4; x <= 7; x++) set(r, x, k * 2, k === 4 ? "o" : "x");
    frames.push(r);
  }
  return frames;
}

export const ICONS = {
  request: request(), pay: pay(), verify: verify(), tally: tally(),
  lock: [lockOpen, lockOpen, lockShut], burn: burn(), empty: empty(), receipt: receipt(),
};

/** Draw one frame as pixel SVG. */
export function frameSVG(rows, { main = "#E8EBF2", accent = "#1F5BFF" } = {}) {
  let body = "";
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (ch !== ".") body += `<rect x="${x}" y="${y}" width="1" height="1" fill="${ch === "o" ? accent : main}"/>`;
  }));
  return `<svg viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${body}</svg>`;
}

/** Play the frames once, then stop on the last one. Reduced motion: jump straight to the last frame. */
export function playOnce(el, frames, interval = 220) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  clearInterval(el._t);
  let i = reduce ? frames.length - 1 : 0;
  el.innerHTML = frameSVG(frames[i]);
  if (reduce) return;
  el._t = setInterval(() => {
    if (++i >= frames.length) { clearInterval(el._t); return; }
    el.innerHTML = frameSVG(frames[i]);
  }, interval);
}
