// A character field modeled after the reference recording: a wave of characters sweeps across the screen,
// then as it enters the viewport a light appears at the center and the characters gather into the TGENTIC logo,
// the wave erodes outward, and characters near the cursor glow white.
// "form" mode: the full sequence. "band" mode: only the dim wave (footer backdrop).
import { LOGO_H, LOGO_PATH, LOGO_W } from "./brand/mark.js";

const CH = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// [color, weight]: dim dot, dim band, blue, bright blue, white
const LEVELS = [["#1a2236", 400], ["#26398a", 500], ["#3b5cff", 500], ["#8fb3ff", 500], ["#ffffff", 600]];
// footer: a dimmer band because it sits behind text (text still reads >= 4.5:1 on top of it)
const BAND_LEVELS = [["#0f1626", 400], ["#131c33", 500], ["#18233f", 500], ["#1f2d55", 500], ["#3b5cff", 500]];

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} [o]
 * @param {"form"|"band"} [o.mode]
 * @param {HTMLElement} [o.scrollHost] tall section that drives logo formation through scroll
 * @param {(p:number)=>void} [o.onProgress] called with 0..1 progress every frame
 */
export function mountLogoform(canvas, { mode = "form", scrollHost = null, onProgress = null } = {}) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const band = mode === "band";
  const ctx = canvas.getContext("2d");
  let W, H, dpr, cw, ch, cols, rows, chars, noise, tone, atlas, logo, lcx, lcy, maxD;
  let raf = 0, last = 0, running = false, visible = false, rt;
  const pointer = { x: -1e4, y: -1e4 };

  function setup() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const small = W < 720;
    cw = small ? 9 : 12; ch = small ? 14 : 18;
    cols = Math.ceil(W / cw); rows = Math.ceil(H / ch);
    const n = cols * rows;
    chars = new Uint8Array(n).map(() => (Math.random() * CH.length) | 0);
    noise = new Float32Array(n).map(Math.random);
    tone = new Uint8Array(n).map(() => (Math.random() < 0.28 ? 3 : 2));

    atlas = document.createElement("canvas");
    atlas.width = CH.length * cw * dpr; atlas.height = 5 * ch * dpr;
    const a = atlas.getContext("2d");
    a.scale(dpr, dpr); a.textBaseline = "top";
    (band ? BAND_LEVELS : LEVELS).forEach(([c, w], l) => {
      a.font = `${w} ${small ? 11 : 13}px "IBM Plex Mono", ui-monospace, monospace`;
      a.fillStyle = c;
      for (let g = 0; g < CH.length; g++) a.fillText(CH[g], g * cw + 1, l * ch + 2);
    });

    // The logo is rasterized from the vector trace onto the character grid; cell height > width, so columns are corrected.
    logo = new Uint8Array(n);
    if (!band) {
      let lr = Math.round(rows * (small ? 0.34 : 0.6));
      let lc = Math.round(lr * (LOGO_W / LOGO_H) * (ch / cw));
      const cap = cols * (small ? 0.8 : 0.46); // room for the explainer text on the left and right
      if (lc > cap) { lc = Math.round(cap); lr = Math.round(lc / ((LOGO_W / LOGO_H) * (ch / cw))); }
      const off = document.createElement("canvas");
      off.width = lc; off.height = lr;
      const o = off.getContext("2d");
      o.scale(lc / LOGO_W, lr / LOGO_H);
      o.fill(new Path2D(LOGO_PATH));
      const px = o.getImageData(0, 0, lc, lr).data;
      const x0 = Math.floor((cols - lc) / 2), y0 = Math.floor((rows - lr) / 2);
      for (let y = 0; y < lr; y++) for (let x = 0; x < lc; x++) if (px[(y * lc + x) * 4 + 3] > 120) logo[(y0 + y) * cols + x0 + x] = 1;
      lcx = cols / 2; lcy = rows / 2;
      maxD = Math.hypot(lc / 2, (lr / 2) * (ch / cw));
    }
  }

  function draw(now) {
    if (!chars) return; // setup() not done yet (race with fonts.ready)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = reduce ? 0 : now / 1000;
    // p: logo formation progress, 0 = band only, 1 = full logo
    const p = band ? 0 : reduce ? 1 : progress();
    onProgress?.(p);
    const lit = new Int8Array(cols * rows).fill(-1);

    // background dots blinking slowly
    for (let i = 0; i < lit.length; i++) if (noise[i] < 0.02 && Math.sin(t * 1.3 + noise[i] * 600) > 0.2) lit[i] = 0;

    // the waving band, its edges jagged from per-cell noise; it erodes outward from the center as the logo forms
    const erode = p * (cols * 0.75);
    const mid = band ? 0.8 : 0.38; // in the footer the band sits below the text so the text stays readable
    for (let x = 0; x < cols; x++) {
      const c = rows * mid + Math.sin(x * 0.045 + t * 0.35) * rows * 0.1 + Math.sin(x * 0.11 - t * 0.5) * rows * 0.04;
      const th = rows * (band ? 0.16 : 0.09) * (0.45 + 0.55 * Math.abs(Math.sin(x * 0.027 + t * 0.2 + 1.3)));
      for (let y = Math.max(0, Math.floor(c - th * 1.3)); y <= Math.min(rows - 1, Math.ceil(c + th * 1.3)); y++) {
        const i = y * cols + x;
        const d = Math.abs(y - c) / th;
        if (d > 0.7 + noise[i] * 0.6) continue;
        if (erode > 0 && Math.hypot(x - lcx, (y - lcy) * (ch / cw)) < erode * (0.8 + noise[i] * 0.4)) continue;
        lit[i] = band ? (d < 0.4 ? 3 : d < 0.8 ? 2 : 1) : d < 0.35 && noise[i] > 0.55 ? 2 : 1;
      }
    }

    if (!band && p > 0) {
      // the logo appears from the center outward with noisy edges
      const reach = p * maxD * 1.25;
      for (let i = 0; i < lit.length; i++) {
        if (!logo[i]) continue;
        const d = Math.hypot((i % cols) - lcx, (((i / cols) | 0) - lcy) * (ch / cw));
        if (d < reach - noise[i] * maxD * 0.25) lit[i] = d < reach * 0.35 && p < 0.7 ? 4 : tone[i];
      }
      // the light: rises fast, then fades
      const g = p < 0.25 ? p / 0.25 : Math.max(0, 1 - (p - 0.25) / 0.75);
      if (g > 0) {
        const gx = lcx * cw, gy = lcy * ch, r = Math.min(W, H) * (0.12 + 0.18 * p);
        const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
        grad.addColorStop(0, `rgba(220,230,255,${0.55 * g})`);
        grad.addColorStop(0.25, `rgba(90,120,255,${0.35 * g})`);
        grad.addColorStop(1, "rgba(31,91,255,0)");
        ctx.fillStyle = grad; ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
    }

    // cursor lens: lit characters turn white, empty cells surface a dim character
    if (!reduce && pointer.x > -1e3) {
      const px = pointer.x / cw, py = pointer.y / ch, r = band ? 5 : 6;
      for (let y = Math.max(0, (py - r) | 0); y <= Math.min(rows - 1, (py + r) | 0); y++) {
        for (let x = Math.max(0, (px - r * 1.5) | 0); x <= Math.min(cols - 1, (px + r * 1.5) | 0); x++) {
          const d = Math.hypot((x - px) / 1.5, y - py);
          if (d > r) continue;
          const i = y * cols + x;
          lit[i] = lit[i] >= 1 ? (band ? 4 : 4) : d < r * 0.6 && noise[i] > 0.4 ? 1 : lit[i];
          if (Math.random() < 0.25) chars[i] = (Math.random() * CH.length) | 0;
        }
      }
    }
    if (!reduce) for (let k = (chars.length * 0.02) | 0; k > 0; k--) chars[(Math.random() * chars.length) | 0] = (Math.random() * CH.length) | 0;

    const sw = cw * dpr, sh = ch * dpr;
    for (let i = 0; i < lit.length; i++) {
      const l = lit[i];
      if (l >= 0) ctx.drawImage(atlas, chars[i] * sw, l * sh, sw, sh, (i % cols) * cw, ((i / cols) | 0) * ch, cw, ch);
    }
  }

  // progress from scroll position: the first 15% is band only, the full logo at 70%, the rest is for the explainer text
  function progress() {
    if (!scrollHost) return 1;
    const r = scrollHost.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - innerHeight)));
    return Math.min(1, Math.max(0, (s - 0.15) / 0.55));
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (now - last < 33) return; // about 30 fps
    last = now;
    draw(now);
  }
  const play = () => { if (didSetup && !running && visible && !reduce) { running = true; raf = requestAnimationFrame(loop); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };

  let alive = true, didSetup = false;
  (document.fonts?.ready ?? Promise.resolve()).then(() => { if (!alive) return; setup(); didSetup = true; reduce ? draw(0) : play(); });

  const host = canvas.parentElement;
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    visible ? play() : stop();
  });
  io.observe(canvas);
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (!ready) return; setup(); if (reduce) draw(0); }, 150); };
  const onVis = () => (document.hidden ? stop() : play());
  const onMove = (e) => { const r = canvas.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; };
  const onLeave = () => { pointer.x = pointer.y = -1e4; };
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
