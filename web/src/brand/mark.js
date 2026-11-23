// TGENTIC logo. Two shapes from one source:
// 1. LOGO_PATH: an exact vector trace of the owner's logo (76x70), header only. The shape is unchanged.
// 2. ROWS: a 19x19 pixel version for other assets (favicon, footer, canvas, loader). The logo's gap is kept 1 pixel.
export const LOGO_W = 76;
export const LOGO_H = 70;
export const LOGO_PATH = "M0 0H27L44 17V0H76V18H0Z M40 18H54V70H40Z M0 21H20L37 38V70H23V39H0Z M37 66H40V70H37Z";

export const SIZE = 19;
const ROWS = [
  "#######....########",
  "########...########",
  "#########..########",
  "##########.########",
  "###################",
  "..........####.....",
  "######....####.....",
  "#######...####.....",
  "########..####.....",
  "#########.####.....",
  "......###.####.....",
  "......###.####.....",
  "......###.####.....",
  "......###.####.....",
  "......###.####.....",
  "......###.####.....",
  "......########.....",
  "......########.....",
  "...................",
];

/** @returns {{x:number,y:number,accent:boolean}[]} the lit pixels */
export function markCells() {
  const out = [];
  ROWS.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === "#") out.push({ x, y, accent: false }); }));
  return out;
}
