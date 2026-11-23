# TGENTIC web v2 (landing + dapp)

Landing: plain HTML/CSS/JS (`index.html`, `src/landing.*`). Dapp: React + viem (`app.html`, `src/app/`). The v2 design is dark and futuristic, following the Anthracite Studio reference principles: `design-system/MASTER.md` (tokens, reasoning) and `design-system/REFERENCES.md` (what was taken and what was not).

## Running

```bash
cd web
npm install
npm run dev        # http://localhost:5173 (landing) and /app (dapp)
npm run build
```

## Logo and icons (code)

The owner's three-bar mark as 16x16 pixels in `src/brand/mark.js`. `npm run logo` writes `public/brand/mark.svg`, `mark-ink.svg`, and `public/favicon.svg`. Section animation icons live in `src/icons.js`.

## Hero

A hex character field on a 2D canvas (`src/landing.js`): the TGENTIC mark prints line by line as the page opens, slow waves, the cursor lights characters up. It stops when off screen, and is drawn once without animation under `prefers-reduced-motion`.

The v1 hero video (receipt printer) is no longer used. Its source stays in `hero-source/`; `npm run frames` can still regenerate its frames.

## Images

The site no longer uses photos (v2.1). The old photos remain in `assets-source/` as an archive.

## Dapp

**Local preview:** under `npm run dev`, while no contract is configured, the dapp automatically uses sample data (9 agents, receipts, leaderboard, a simulated bond) unlabeled, so the look can be judged as if live. This is **local server only**: production builds always read the real chain, and `?demo` on a production build always shows the "Demo data" label. Do not share local preview screenshots as real activity.

Copy `.env.example` to `.env` and fill in `VITE_TGENTIC_ADDRESS` and `VITE_DEPLOY_BLOCK` (required: the Robinhood Chain RPC rejects `getLogs` spanning more than 10 million blocks). Without both, every screen shows "Contract not deployed yet".

## Test status (v2)

Tested in-browser: landing desktop 1366px and 390px without overflow, hero field and mark, pill label swapping, manifesto lighting up, images sharpening, menu (open, Escape, focus return), dapp not-configured, loading, and empty states against the real RPC.
**Not yet tested:** profile and leaderboard with real data, the bond flow (needs a deployed contract and a wallet), reduced-motion rendering on real devices, canvas performance on low-end phones.
