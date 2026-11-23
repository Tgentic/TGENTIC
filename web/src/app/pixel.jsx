// Pixel motion components for the dapp. All respect prefers-reduced-motion (render straight to the final state).
import { useEffect, useRef, useState } from "react";
import { SIZE, markCells } from "../brand/mark.js";
import { ICONS, playOnce } from "../icons.js";

const HEX = "0123456789abcdef";
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Text that appears from a hex scramble, then settles left to right. Screen readers get the plain text. */
export function Scramble({ text, className = "", duration = 650 }) {
  const [out, setOut] = useState(() => (reduced() ? text : text.replace(/[^\s.,:]/g, "0")));
  useEffect(() => {
    if (reduced()) { setOut(text); return; }
    const steps = Math.max(8, Math.round(duration / 32));
    let f = 0;
    const id = setInterval(() => {
      f++;
      setOut([...text].map((c, i) => (/[\s.,:]/.test(c) || i < (text.length * f) / steps ? c : HEX[(Math.random() * 16) | 0])).join(""));
      if (f >= steps) { clearInterval(id); setOut(text); }
    }, 32);
    return () => clearInterval(id);
  }, [text, duration]);
  return <span className={className}><span className="sr-only">{text}</span><span aria-hidden="true">{out}</span></span>;
}

/** Deterministic, symmetric 5x5 pixel identicon from a wallet address. */
export function Identicon({ address, size = 32 }) {
  const h = address.toLowerCase().replace(/^0x/, "");
  const accent = parseInt(h[39], 16) % 15;
  const cells = [];
  for (let y = 0; y < 5; y++) for (let x = 0; x < 3; x++) {
    if (parseInt(h[y * 3 + x], 16) % 2) continue;
    const fill = (y * 3 + x) === accent % 15 ? "var(--blue)" : "var(--text)";
    cells.push([x, y, fill]);
    if (x < 2) cells.push([4 - x, y, fill]);
  }
  return (
    <svg className="ident" width={size} height={size} viewBox="-1 -1 7 7" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="-1" y="-1" width="7" height="7" fill="var(--panel)" />
      {cells.map(([x, y, f]) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={f} />)}
    </svg>
  );
}

/** Segmented bar that fills cell by cell. ratio 0..1. */
export function PixelBar({ ratio, cells = 24, label }) {
  const n = Math.max(0, Math.min(cells, Math.round(ratio * cells)));
  return (
    <div className="pbar" role="img" aria-label={label}>
      {Array.from({ length: cells }, (_, i) => <i key={i} className={i < n ? "on" : ""} style={{ "--i": i }} />)}
    </div>
  );
}

/** A 1-5 rating as five pixel squares. */
export function RatingPips({ value }) {
  return (
    <span className="pips" role="img" aria-label={`rating ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((k) => <i key={k} className={k <= value ? "on" : ""} />)}
    </span>
  );
}

/** The TGENTIC logo printing line by line (loading state). */
const CELLS = markCells();
export function MarkLoader({ size = 44 }) {
  return (
    <svg className="mark-loader" viewBox={`0 0 ${SIZE} ${SIZE}`} width={size} height={size} aria-hidden="true" shapeRendering="crispEdges">
      {CELLS.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill="var(--text)" style={{ animationDelay: `${c.y * 60}ms` }} />)}
    </svg>
  );
}

/** Pixel icons from src/icons.js, played once; a replay swaps the key to restart. */
export function PixelIcon({ name, size = 64, replay = 0 }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) playOnce(ref.current, ICONS[name]); }, [name, replay]);
  return <div ref={ref} className="picon" style={{ width: size, height: size }} aria-hidden="true" />;
}
