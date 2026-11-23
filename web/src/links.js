// One place for the token address and public links, shared by the landing page and the dapp.
// An empty href = not set yet: rendered as "coming soon", not a dead link.
export const CA = ""; // fill in the token address once it is set

// 9x9 pixel glyphs for frameSVG: "1" = main color, "o" = blue accent, "." = empty.
export const SOCIALS = [
  { name: "X", href: "https://x.com/_Tgentic", glyph: ["11.....11", ".11...11.", "..11.11..", "...111...", "....o....", "...111...", "..11.11..", ".11...11.", "11.....11"] },
  { name: "Telegram", href: "", glyph: ["........1", "......111", "....111.1", "..111..1.", "1111..11.", "...o.11..", "...o.1...", "...oo....", "........."] },
  { name: "GitHub", href: "", glyph: [".1.....1.", ".11...11.", ".1111111.", "111111111", "11o111o11", "111111111", ".1111111.", "..1...1..", "..1...1.."] },
  { name: "Docs", href: "", glyph: [".11111...", ".1...11..", ".1...111.", ".1.....1.", ".1.ooo.1.", ".1.....1.", ".1.ooo.1.", ".1.....1.", ".1111111."] },
];

const COLS = [
  ["Dapp", [["Check a tally", "/app#/lookup"], ["Leaderboard", "/app#/board"], ["Your bond", "/app#/bond"]]],
  ["Protocol", [["Why receipts", "/#why"], ["How a tally is counted", "/#count"], ["Bond", "/#bond"], ["Who reads a tally", "/#readers"]]],
];

/** Shared footer as HTML (the landing page uses innerHTML, the dapp uses dangerouslySetInnerHTML). */
export function footerHTML(frameSVG) {
  const soc = SOCIALS.map((s) => {
    const inner = `${frameSVG(s.glyph, { main: "currentColor" })}<span>${s.name}</span>`;
    return s.href
      ? `<li><a class="soc" href="${s.href}" target="_blank" rel="noreferrer">${inner}</a></li>`
      : `<li><span class="soc soon" title="${s.name}: coming soon">${inner}<small>soon</small></span></li>`;
  }).join("");
  const cols = COLS.map(([h, items]) => `<div class="foot-col"><h2>${h}</h2><ul>${items.map(([t, u]) => `<li><a href="${u}">${t}</a></li>`).join("")}</ul></div>`).join("");
  return `
  <canvas class="foot-field" aria-hidden="true"></canvas>
  <div class="wrap foot-top">
    <div class="foot-brand">
      <a class="foot-mark" href="/"><img src="/brand/mark-pixel.svg" width="44" height="44" alt="">TGENTIC</a>
      <p>No receipt, no reputation.</p>
      <ul class="socs" aria-label="Community">${soc}</ul>
    </div>
    ${cols}
  </div>`;
}
