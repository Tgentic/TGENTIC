// Usage: npm run logo   -> writes public/brand/*.svg and public/favicon.svg from src/brand/mark.js
import fs from "node:fs";
import path from "node:path";
import { SIZE, markCells, LOGO_PATH, LOGO_W, LOGO_H } from "../src/brand/mark.js";

const root = path.resolve(import.meta.dirname, "..");
const cells = markCells();

// Merge adjacent same-color pixels in a row into one rect (smaller SVG).
function rects(fill, pick, dx = 0, dy = 0) {
  const on = new Set(cells.filter(pick).map((c) => `${c.x},${c.y}`));
  let out = "";
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!on.has(`${x},${y}`)) continue;
      let w = 1;
      while (on.has(`${x + w},${y}`)) w++;
      out += `<rect x="${x + dx}" y="${y + dy}" width="${w}" height="1" fill="${fill}"/>`;
      x += w - 1;
    }
  }
  return out;
}

const svg = (body, size = SIZE, bg = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${bg}${body}</svg>\n`;

// The header uses the exact vector trace; other assets use the pixel version.
const vector = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -6 ${LOGO_W + 6} ${LOGO_W + 6}"><path fill="${fill}" d="${LOGO_PATH}"/></svg>
`;

const files = {
  "public/brand/mark.svg": vector("#E8EBF2"),
  "public/brand/mark-pixel.svg": svg(rects("#E8EBF2", (c) => !c.accent) + rects("#1F5BFF", (c) => c.accent)),
  "public/brand/mark-ink.svg": svg(rects("#0F1B2D", (c) => !c.accent) + rects("#1F5BFF", (c) => c.accent)),
  // Favicon: the mark on a dark box, padded by 2 pixels.
  "public/favicon.svg": svg(rects("#E8EBF2", (c) => !c.accent, 2, 2) + rects("#1F5BFF", (c) => c.accent, 2, 2), SIZE + 4, `<rect width="${SIZE + 4}" height="${SIZE + 4}" fill="#05070D"/>`),
};

for (const [rel, content] of Object.entries(files)) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  console.log(`${rel}  ${content.length} bytes`);
}
console.log(`${cells.length} pixels, ${cells.filter((c) => c.accent).length} accents`);
