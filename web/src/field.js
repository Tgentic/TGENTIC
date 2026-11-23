// Hex character field: the TGENTIC logo is "printed" from hash noise, slow waves, a cursor lens.
// Used by the landing hero and the dapp top band. Returns a function that tears down all listeners.
import { SIZE, markCells } from "./brand/mark.js";

const HEX = "0123456789abcdef";
const LEVELS = ["#1b2438", "#3a4a6b", "#e8ebf2", "#72a2ff"]; // dim, medium, bright, blue

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [o]
 * @param {number} [o.markFrac=0.8]   logo height as a fraction of the field height (wide screens)
 * @param {number} [o.markFracSmall=0.4] same on narrow screens (logo centered at the top)
 * @param {number} [o.minScale=2]     minimum size of one logo pixel, in character rows
 * @param {number} [o.lift=0.12]      how far the logo is lifted above center (fraction of height)
 * @param {number} [o.waveY=0.74]     wave center position (fraction of height)
 */
export function mountField(canvas, { markFrac = 0.8, markFracSmall = 0.4, minScale = 2, lift = 0.12, waveY = 0.74 } = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  const mark = markCells();
  let W, H, dpr, cw, ch, cols, rows, chars, atlas, markMap, k, speck;
  let t = 0, start = 0, running = false, visible = true, raf = 0, last = 0, rt;
  const pointer = { x: -1e4, y: -1e4 };

  function setup() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const small = W < 720;
    cw = small ? 8 : 10; ch = small ? 13 : 16;
    cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
    chars = new Uint8Array(cols * rows).map(() => (Math.random() * 16) | 0);
    speck = new Uint8Array(cols * rows).map(() => (Math.random() < 0.025 ? 1 : 0));

    atlas = document.createElement("canvas"); // 16 characters x 4 color levels, drawn once
    atlas.width = 16 * cw * dpr; atlas.height = 4 * ch * dpr;
    const a = atlas.getContext("2d");
    a.scale(dpr, dpr);
    a.font = `${small ? 11 : 13}px "IBM Plex Mono", ui-monospace, monospace`;
    a.textBaseline = "top";
    LEVELS.forEach((c, l) => { a.fillStyle = c; for (let g = 0; g < 16; g++) a.fillText(HEX[g], g * cw + 1, l * ch + 1); });

    // Character cells are taller than they are wide, so each logo pixel uses kx columns x k rows to stay square.
    // the logo must not enter the nav pill area (roughly the top 96px)
    const top = Math.ceil(96 / ch);
    k = Math.max(1, Math.min(Math.max(minScale, Math.floor((rows * (small ? markFracSmall : markFrac)) / SIZE)), Math.floor((rows - top - 2) / SIZE)));
    const kx = Math.max(1, Math.round((k * ch) / cw));
    const mx0 = small ? Math.floor((cols - SIZE * kx) / 2) : cols - SIZE * kx - Math.floor(cols * 0.05);
    const my0 = Math.max(top, small ? Math.floor(rows * 0.1) : Math.floor((rows - SIZE * k) / 2) - Math.floor(rows * lift));
    markMap = new Map();
    for (const c of mark) for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < kx; dx++) {
      markMap.set((my0 + c.y * k + dy) * cols + (mx0 + c.x * kx + dx), { level: c.accent ? 3 : 2, row: c.y * k + dy });
    }
  }

  const ease = (x) => 1 - Math.pow(1 - x, 3);

  function draw(now) {
    if (!chars) return; // setup() not done yet (race with fonts.ready)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const printed = reduce ? Infinity : ease(Math.min(1, (now - start) / 1600)) * SIZE * k;
    const lit = new Int8Array(cols * rows).fill(-1);
    for (let i = 0; i < speck.length; i++) if (speck[i]) lit[i] = 0;

    const tt = reduce ? 0 : t;
    for (let x = 0; x < cols; x++) {
      const c = rows * waveY + Math.sin(x * 0.09 + tt * 0.6) * rows * 0.05 + Math.sin(x * 0.031 - tt * 0.35) * rows * 0.05;
      const th = rows * 0.06 * (0.55 + 0.45 * Math.sin(x * 0.05 + tt * 0.8));
      for (let y = Math.max(0, Math.floor(c - th)); y <= Math.min(rows - 1, Math.ceil(c + th)); y++) lit[y * cols + x] = Math.abs(y - c) < th * 0.4 ? 1 : 0;
    }
    for (const [i, m] of markMap) if (m.row < printed && i >= 0 && i < lit.length) lit[i] = m.level;

    if (!reduce && pointer.x > -1e3) {
      const px = pointer.x / cw, py = pointer.y / ch, r = 7;
      for (let y = Math.max(0, (py - r) | 0); y <= Math.min(rows - 1, (py + r) | 0); y++) {
        for (let x = Math.max(0, (px - r * 1.6) | 0); x <= Math.min(cols - 1, (px + r * 1.6) | 0); x++) {
          const d = Math.hypot((x - px) / 1.6, y - py);
          if (d > r) continue;
          const i = y * cols + x;
          lit[i] = lit[i] >= 1 ? 3 : Math.max(lit[i], d < r * 0.5 ? 1 : 0);
          if (Math.random() < 0.2) chars[i] = (Math.random() * 16) | 0;
        }
      }
    }
    if (!reduce) for (let n = (chars.length * 0.015) | 0; n > 0; n--) chars[(Math.random() * chars.length) | 0] = (Math.random() * 16) | 0;

    const sw = cw * dpr, sh = ch * dpr;
    for (let i = 0; i < lit.length; i++) {
      const l = lit[i];
      if (l >= 0) ctx.drawImage(atlas, chars[i] * sw, l * sh, sw, sh, (i % cols) * cw, ((i / cols) | 0) * ch, cw, ch);
    }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return; // about 30 fps is enough for the character field
    last = now; t = now / 1000;
    draw(now);
  }
  const play = () => { if (!running && visible && !reduce) { running = true; raf = requestAnimationFrame(loop); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  let alive = true;
  (document.fonts?.ready ?? Promise.resolve()).then(() => { if (!alive) return; setup(); start = performance.now(); reduce ? draw(start) : play(); });

  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { setup(); start = -1e6; if (reduce) draw(0); }, 150); };
  const onVis = () => (document.hidden ? stop() : play());
  const host = canvas.parentElement;
  const onMove = (e) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; };
  const onLeave = () => { pointer.x = pointer.y = -1e4; };
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? play() : stop(); });
  io.observe(canvas);
  addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", onVis);
  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerleave", onLeave);

  return () => {
    alive = false; stop(); io.disconnect(); clearTimeout(rt);
    removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVis);
    host.removeEventListener("pointermove", onMove);
    host.removeEventListener("pointerleave", onLeave);
  };
}
