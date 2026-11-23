# TGENTIC landing asset guide (stage 2: static images)

The hero stays as it is. The "How a tally is counted" section downward uses **static images only**, generated in Flow with Nano Banana 2.1 (**0 credits**, all free). Sections are joined by a navy-to-cream gradient, so images are produced with a **dark navy background** so their edges can blend into the gradient.

## General rules

- Prompts in English. Model: **Nano Banana 2.1**. Download the largest version ("upscaled" 2K when available).
- No letters, logos, or writing in the images. Do not write "no text" in the prompt (it invites it); just describe what should be there.
- No hands or people.
- Palette: ink navy, cream, brass. Side light from the left, shallow depth of field, photographic style.
- **Subject centered with a flat dark navy background at the edges**, so the image edges can blend into the page gradient.
- If a result does not fit, regenerate (free) until it does.

## Asset list

| # | File | Section | Ratio | Minimum source | Page slot (desktop) |
|---|---|---|---|---|---|
| 1 | `s1-strip.jpeg` | How a tally is counted | 3:4 | 1024×1365 | 440×590 |
| 2 | `s2-bar.jpeg` | Bond (wide band) | 16:9 | 1280×720 | 1440×620 (cropped from 16:9) |
| 3 | `s2-burn.jpeg` | Bond (burning) | 1:1 | 1024×1024 | 420×420 |
| 4 | `s3-empty.jpeg` | What does not exist yet | 3:4 | 1024×1365 | 380×510 |
| 5 | `t-stamp.jpeg` | Total (closing) | 16:9 | 1280×720 | 720×405 |

The compositions deliberately alternate (portrait, wide band, small square, sparse portrait, mid-width) so the page does not feel uniform.

## Asset 1: "How a tally is counted" section (3:4)

```
Extreme macro photograph of a cream paper strip lying flat on a dark ink-navy surface, seen from slightly above, the strip running vertically through the frame. Tidy rows of short dark navy ink strokes in groups of four, each group crossed by one diagonal stroke. One group in the center is struck in brass-gold ink. Soft side light from the left, deep ink-navy darkness around the strip, shallow depth of field, photographic.
```

Save as `s1-strip.jpeg`. Check: strip centered, dark navy image edges, strokes readable, one brass group.

## Asset 2: "Bond" section, wide band (16:9)

```
Macro photograph of a dark slate-blue metal plate with a narrow horizontal slot at the center, a polished brass bar seated fully in the slot so the plate looks locked, soft side light from the left catching the brass edge, deep ink-navy darkness around it. The subject is centered with generous empty darkness above and below. Shallow depth of field, photographic.
```

Save as `s2-bar.jpeg`. Check: top and bottom of the image pitch dark (will be cropped).

## Asset 3: "Bond" section, burning (1:1)

```
Macro photograph of the torn edge of a cream paper strip lying on a dark slate surface, a thin line of glowing brass-orange embers along the scorched edge, a few faint wisps of smoke rising, deep ink-navy background, the subject centered. Shallow depth of field, photographic.
```

Save as `s2-burn.jpeg`.

## Asset 4: "What does not exist yet" section (3:4)

```
Photograph of an empty cardboard receipt-roll core standing upright on a dark slate surface, a short stub of blank cream paper hanging from it, quiet and sparse, soft side light from the left, deep ink-navy background, the subject centered with plenty of empty space around it. Shallow depth of field, photographic.
```

Save as `s3-empty.jpeg`.

## Asset 5: "Total" closing (16:9)

```
Macro photograph of a polished brass hand-stamp with a plain round face resting beside a sheet of cream paper that carries one clean circular ring of brass-gold ink with an empty center, soft side light from the left, deep ink-navy surroundings, the subject centered. Shallow depth of field, photographic.
```

Save as `t-stamp.jpeg`. Risk: the stamp may leave letters in its ring. If so, regenerate (free).

## If a result looks bad

| Problem | Fix |
|---|---|
| Random letters or stamps | regenerate; add "a plain smooth surface" to the problematic object |
| Background not evenly dark | add "deep ink-navy darkness around the subject, no bright background" |
| Subject off-center | add "the subject is centered in the frame" |
| Colors differ between images | add "deep ink-navy, cream and brass-gold palette" |
| Brass looks orange/green | add "warm brass-gold, not orange" |

## Deliverables

Place the files in `web/assets-source/` with the exact names from the table. Assets that end up not being made are fine: that section ships without an image.

Processed output: WebP with a long side of at most 1600 px, under 200 KB per image, edges blended into the gradient via CSS.
