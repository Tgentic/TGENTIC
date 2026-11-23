# TGENTIC v2.1: design system (source of truth)

Version 2.1, 2026-11-20. Owner's revisions over v2: **P3 blue replaces brass**, **the owner's three-bar logo becomes a 16x16 pixel mark**, and **all photos are replaced by code-generated animated pixel icons**.

**Design read:** landing + dapp for on-chain reputation, aimed at developers and AI-agent integrators. Visual language: a dark instrument that prints proof. Dials: ENERGY 3 / RHYTHM 3 / MOTION 2.

## Subject and primary job

- Subject: an AI agent's reputation that only rises from verified USDG payments.
- Audience: agent builders, marketplaces, integrators. Technical, skeptical of claims.
- The page's job: explain the counting rules in 30 seconds and lead to "Check an agent's tally".

## Colors (all contrast verified)

| Token | Hex | Role | Contrast |
|---|---|---|---|
| `--void` | `#05070D` | page background (darkened ink navy, not neutral black) | |
| `--panel` | `#0C111C` | dapp panel surface | |
| `--text` | `#E8EBF2` | primary text | 16.88:1 on `--void` |
| `--mute` | `#9AA3B5` | secondary text | 7.94:1 on `--void`, 7.44:1 on `--panel` |
| `--blue` | `#1F5BFF` | blocks: highlights, primary buttons (white text) | white 5.25:1, vs background 3.84:1 |
| `--blue-text` | `#72A2FF` | text, links, accents on dark backgrounds | 7.99:1 |
| `--edge` | `#5A6478` | control borders (inputs, outline buttons) | 3.38:1 (non-text, passes 3:1) |
| `--hair` | `#2A3346` | decorative divider lines only | 1.59:1, not for text or control borders |

## Typography

- **Newsreader** (Google Fonts, optical size 6–72): giant headlines use opsz 72 (high contrast, editorial feel), body text uses small opsz. One family for headings and body: keeps brand continuity and does not copy the reference's Instrument Serif.
- **IBM Plex Mono**: the hex character field, addresses, amounts, hashes, and section labels in the menu. Never for headings.
- Scale: 16 / 18 / 22 / 30 / 44 / 68 / clamp(56px, 9vw, 132px). Body line-height 1.6 (serif), headings 0.95.
- No wide-tracked uppercase labels. Menu labels are lowercase.

## Shape and space

- Radius 0 on everything. 1px lines. No shadows, no glow, no frosted glass.
- Container: `min(1240px, 100% - 2 × clamp(16px, 5vw, 72px))`, left-aligned.
- Section rhythm deliberately varies (RHYTHM 3): full-screen hero, thin standards strip, asymmetric manifesto columns, 4-column steps, wide bond, ruled list, giant closing.

## Logo (code, not an image)

- The owner's logo (three bars forming a T: left diamond, upper-right bar, bottom stem) traced from the original image, then cleaned into a 16x16 pixel mark with a 1-pixel gap between bars. Single source: `src/brand/mark.js`; `npm run logo` writes the SVGs and favicon.
- The hero renders the same logo from hex characters; the dapp uses it as a loader.

## Icons (code, not images)

- `src/icons.js`: animated 12x12 pixel icons (request, pay, verify, tally, lock, burn, empty, receipt). Played once on entering the viewport and on hover; the last frame renders immediately under reduced-motion.
- No photos on the site anymore. The old photo sources remain in `assets-source/`.

## Motion (MOTION 2)

One big moment, everything else calm:
1. **Hero:** the hex character field forms waves and the TGENTIC mark; the mark "prints" line by line with scroll; the cursor lights nearby characters (a lens).
2. **Small:** section labels in the menu swap in with a 300 ms character scramble; the manifesto lights up word by word with scroll; images sharpen from pixels once on entering the viewport.
- `prefers-reduced-motion`: the hero is drawn once in its finished state, no lens, no scramble, images sharp immediately, text fully rendered at once.
- Animation stops when the hero is off screen or the tab is hidden.

## Landing structure

```
[ mark  how it counts  Menu ]              [ Open the dapp ]   <- floating pill
+----------------------------------------------------------+
| hex field  .  .  ~~~~~~   ##  tally mark made of         |
| No receipt,              ##  hex characters             |
| [no reputation.]  <- brass block  ##                    |
| lede + Check an agent's tally / How a tally is counted  |
+----------------------------------------------------------+
| standards strip: x402  EIP-3009  USDG  Robinhood Chain  ERC-8004 (planned)
| manifesto: big serif text lighting up    | pixel image |
| 4 steps (a real order): request, pay, verify, tally + cream receipt strip
| bond: wide image band + 3 terms + burning image
| what does not exist yet: ruled list, status on the right
| closing: giant "Check an agent's tally." as a link
| small footer
```

## Decisions against generic defaults

- **Rejected:** a generic suggestion of Inter + indigo + a testimonial carousel. Testimonials do not exist and must not be invented.
- **At the owner's request:** the reference-style blue is used, with its own value (`#1F5BFF`, not the reference's `#0004eb`).
- **Replaced:** the reference's client-logo row becomes a standards strip of things actually in use, with ERC-8004 marked "planned".
- **Kept at the owner's request:** one highlighted phrase in the hero headline. A generic tell by checklist standards, but a requested trait of the reference. Used only in the hero and the closing.
- **Kept because the content is a real order:** the 1–4 numbering appears only in "how it counts" (request, pay, verify, tally).
- No `→` in buttons, no colored side stripes on cards, no per-section fade-up.

## Content honesty

- No invented statistics, testimonials, client logos, or awards.
- Example calculations are labeled "illustration".
- The "what does not exist yet" section stays.
- No em dashes in display text. Site copy is in English.
