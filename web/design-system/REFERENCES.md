# Design references: principles, not copies

Collected 2026-11-20 by opening the sites directly in a browser (desktop 1366px). Only **principles** were taken (structure, kinds of motion, color logic, typographic feel). Their code, copy, images, ASCII logos, and names are **not** used. TGENTIC must have its own identity.

Owner preference: the best fit is reference 3 (Anthracite Studio).

## 1. Anthracite Studio (anthracitestudio.be): primary reference

Measured: Astro (per-section components), Lenis (smooth scroll), 4 custom canvases (`pixel-lens`, `pixel-frame`, `binary-reveal`, `screensaver`), page height ±10,100 px.

| Item | Measured value |
|---|---|
| Background | `#04040e` (navy-black) |
| Accent | `#0004eb`, `#3d4bff`, `#5c68ff`, `#838dff` (electric blue), secondary `#f6beb1` (peach) |
| Headings | Instrument Serif 400, ±96 px |
| Body | Figtree Variable 16 px |
| Labels/buttons | Sometype Mono 12 px, uppercase, 0.06em letter spacing, 0.67 px lines, **radius 0** |
| Highlight | `<mark>`: a color block .94em tall behind a phrase (`background: linear-gradient` + `box-decoration-break: clone` to survive line breaks) |
| Motion | 0.25–0.6 s, easing `cubic-bezier(.76,0,.24,1)`, `(.45,0,.55,1)`, one overshoot `(.34,1.56,.64,1)` |
| Container | `clamp(992px, 92vw, ...)` |

Page structure (in order): pixel hero, client wall, manifesto, four services in columns, featured projects (3,700 px, moving with scroll), awards (thin-line list), testimonials, closing (email address in big serif + skill chips).

Principles worth taking:
1. **The futuristic look comes from meaningful pixel/ASCII canvases**, not neon. Images become mosaics, then sharpen; binary numbers are revealed.
2. **Type contrast**: big editorial serif against small mono. Firm hierarchy, almost no decoration.
3. **Large text lighting up gradually with scroll** (manifesto).
4. **Thin outline buttons, square corners**, no shadows or gradients.
5. **One saturated accent color** on a near-black background.
6. **A human closing**: contact as a big sentence, not a form.

Not taken: their signature blue highlight (too identifiable), blue vertical lines on project cards (a generic tell), a cookie banner that covers the screen.

## 2. Memory Quest (memoryquest.nl/en): retro arcade

Press Start 2P + Saira, black and neon pink, CRT tunnel effects, 2 canvases + 2 videos, hijacked scroll (document height only 800 px), arcade-style loading bar.
Worth keeping in mind: **loading as part of the story**. Not a fit for this brand (the neon pink is a cliché).

## 3. Grail (grail-app.com): not used

6 canvases, Lenis, a long loading screen (stuck at 98–100% in the test browser), PP Pangaia (commercial). Too heavy and needs a paid font. Not researched further.

## Warnings from generic-taste checklists

Some things in the references and in this design are "generic tells" when used without a reason. Used only where the content demands it:
- 01/02/03 numbering (only for real sequences; the TGENTIC sections are **not** a sequence, so `item 01..03` was removed)
- uppercase labels on every heading; small mono labels everywhere (mono only for real data: addresses, amounts, hashes)
- one word highlighted in a heading
- `→` in buttons, colored left corner stripes on cards
- fade-and-slide entrance on every section (one orchestrated moment is better)

## Not verified

- Whether the Anthracite canvases are 2D or WebGL: unconfirmed.
- Front pages only, desktop. Not mobile, not inner pages.
- Grail and Memory Quest were not fully explored.
