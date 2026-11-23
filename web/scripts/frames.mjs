// Usage: npm run frames -- path/to/hero.mp4
// Slices the hero video into WebP frames (desktop + mobile) and writes public/frames/manifest.json.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error("Usage: npm run frames -- path/to/hero.mp4");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public", "frames");
const sets = [
  { key: "desktop", dir: "d", width: 1280, fps: 15, quality: 72 }, // 8 seconds ≈ 120 frames
  { key: "mobile", dir: "m", width: 640, fps: 8, quality: 68 }, // ≈ 64 frames
];

fs.rmSync(out, { recursive: true, force: true });
const manifest = {};

for (const s of sets) {
  const dir = path.join(out, s.dir);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(
    ffmpeg,
    ["-v", "error", "-y", "-i", input, "-vf", `fps=${s.fps},scale=${s.width}:-2`, "-c:v", "libwebp", "-quality", String(s.quality), path.join(dir, "f%04d.webp")],
    { stdio: "inherit" },
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".webp")).sort();
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  manifest[s.key] = { dir: `frames/${s.dir}/`, count: files.length, pattern: "f%04d.webp", bytes };
}

// The poster = the first desktop frame, as a JPG for the hero <img> (loaded before all frames).
execFileSync(ffmpeg, ["-v", "error", "-y", "-i", path.join(out, "d", "f0001.webp"), "-q:v", "3", path.join(root, "public", "hero", "poster.jpg")]);
fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));

for (const [k, v] of Object.entries(manifest)) console.log(`${k}: ${v.count} frame, ${(v.bytes / 1048576).toFixed(2)} MB`);
