import { mountField } from "./field.js";
import { ICONS, frameSVG, playOnce } from "./icons.js";
import { CA, PONS, FOMO, footerHTML } from "./links.js";
import { mountLogoform } from "./logoform.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const HEX = "0123456789abcdef";
document.documentElement.classList.add("js");

/* 1. Hero: hex character field (src/field.js). */
const canvas = document.querySelector(".field");
if (canvas) mountField(canvas, { markFrac: 0.7, lift: 0 }); // logo vertically centered, in line with the hero copy

/* Shared footer and the hero CA box (address from src/links.js). */
const foot = document.querySelector("[data-foot]");
if (foot) { foot.innerHTML = footerHTML(frameSVG); mountLogoform(foot.querySelector(".foot-field"), { mode: "band" }); }
const form = document.querySelector(".form-field");
const sides = document.querySelectorAll("[data-side]");
// the explainer text prints after the logo is complete, and fades again when the user scrolls back
if (form) mountLogoform(form, { scrollHost: form.closest(".form"), onProgress: (p) => sides.forEach((s) => s.classList.toggle("on", p >= 0.98 || (s.classList.contains("on") && p > 0.9))) });
const caEl = document.querySelector("[data-ca]");
const copyBtn = document.querySelector("[data-copy]");
if (caEl && CA) caEl.textContent = CA;
// When the token is live (deployment links set): fix the bond note and add trade links to the CA row.
const launchNote = document.querySelector("[data-launch]");
if (CA && launchNote) launchNote.textContent = "Live on Robinhood Chain — launched via Pons V2.";
const tradeRow = document.querySelector("[data-trade]");
if (CA && tradeRow) {
  for (const [name, href] of [["Pons", PONS], ["fomo", FOMO]]) {
    if (!href) continue;
    const a = document.createElement("a");
    a.className = "ca-link"; a.href = href; a.target = "_blank"; a.rel = "noreferrer"; a.textContent = name + " ↗";
    tradeRow.appendChild(a);
  }
}
copyBtn?.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(caEl.textContent.trim()); copyBtn.textContent = "Copied"; }
  catch { copyBtn.textContent = "Press Ctrl+C"; getSelection().selectAllChildren(caEl); }
  setTimeout(() => { copyBtn.textContent = "Copy"; }, 1600);
});

/* ---------------------------------------------------------------------------
   2. Menu: native <dialog> (Escape, focus trapped, focus returned to the button).
   --------------------------------------------------------------------------- */
const dlg = document.getElementById("menu");
document.querySelector(".pill-menu")?.addEventListener("click", () => dlg.showModal());
dlg?.addEventListener("click", (e) => { if (e.target === dlg || e.target.closest("a,[data-close]")) dlg.close(); });

/* ---------------------------------------------------------------------------
   3. Section label in the pill: swaps in with a short character scramble.
   --------------------------------------------------------------------------- */
const label = document.querySelector("[data-pill-label]");
let timer;
function scramble(text) {
  clearInterval(timer);
  if (reduce) { label.textContent = text; return; }
  let f = 0;
  timer = setInterval(() => {
    f++;
    label.textContent = [...text].map((c, i) => (c === " " || i < (text.length * f) / 10 ? c : HEX[(Math.random() * 16) | 0])).join("");
    if (f >= 10) { clearInterval(timer); label.textContent = text; }
  }, 30);
}
if (label) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting && label.textContent !== e.target.dataset.label) scramble(e.target.dataset.label);
  }, { rootMargin: "-45% 0px -50% 0px" });
  document.querySelectorAll("[data-label]").forEach((s) => io.observe(s));
}

/* ---------------------------------------------------------------------------
   4. Manifesto: words light up following the scroll position.
   --------------------------------------------------------------------------- */
const big = document.querySelector("[data-reveal]");
if (big && !reduce) {
  big.innerHTML = big.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(" ");
  const words = big.querySelectorAll(".w");
  let q = false;
  const update = () => {
    q = false;
    const r = big.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
    const n = Math.round(p * words.length);
    words.forEach((w, i) => w.classList.toggle("on", i < n));
  };
  addEventListener("scroll", () => { if (!q) { q = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

/* ---------------------------------------------------------------------------
   5. Pixel icons: played once when they enter the viewport, replayed on hover.
   --------------------------------------------------------------------------- */
const icons = document.querySelectorAll("[data-icon]");
const iconIO = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { iconIO.unobserve(e.target); playOnce(e.target, ICONS[e.target.dataset.icon]); }
}, { threshold: 0.4 });
icons.forEach((el) => {
  el.innerHTML = frameSVG(ICONS[el.dataset.icon][0]);
  iconIO.observe(el);
  el.addEventListener("pointerenter", () => playOnce(el, ICONS[el.dataset.icon]));
});
