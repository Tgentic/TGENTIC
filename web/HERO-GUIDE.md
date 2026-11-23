# TGENTIC hero video guide (to be produced manually in Flow)

Goal: one 8-second clip of a receipt strip feeding out of a printer, later sliced into frames and installed as the scroll-driven hero.

Deliverable: **one `hero.mp4` file** (plus two new keyframes, if any). Save location: `web/hero-source/`

## Spec summary

| Item | Value |
|---|---|
| Ratio | 16:9 |
| Duration | 8 seconds |
| Resolution | 720p is enough (1280×720). 1080p fine if free (download "upscaled") |
| Image model | Nano Banana 2.1 (0 credits) |
| Video model (recommended) | Omni 1.1 Flash, 8 s, 720p = **12 credits** |
| Video model (alternative) | Veo 3.1 Lite 10 credits, Veo 3.1 Fast 20 credits (both still 8 s) |
| Total budget | images 0, video 12 to 44 (draft + final + one redo). Last known credit balance: 250 |
| Video filename | `hero.mp4` |
| Processed output | 120 WebP frames at 1280 wide (desktop), 64 frames at 640 wide (mobile), 1 JPG poster |

## Composition

- **Printer in the right third** of the frame, **left half empty** dark navy. The left space is where the tagline text appears. This is why the old keyframes (printer centered) do not fit.
- Camera locked off at eye level, medium-wide framing, **one** camera move: a slow push-in.
- The printer must not move or rotate. Only the paper slides.
- No letters, logos, or writing in the images or the video (the video model will randomize them).

## Step 1: make two images (free)

Open a Flow project, choose **image** generation, model **Nano Banana 2.1**, ratio **16:9**.

**Image A (start frame).** Paste this prompt:

> Photograph from a locked-off camera at eye level, medium-wide framing. A compact matte dark slate-blue thermal receipt printer sits in the right third of the frame, seen from the front at a slight angle, a plain smooth body, its slot at the top front with a short tongue of blank cream paper just emerging. The left half of the frame is empty deep ink-navy darkness with a faint soft gradient. Soft side light from the left catches a thin brass-gold edge on the printer rim. Shallow depth of field, photographic.

Pick the best result, save as `keyframe-start.jpeg`.

**Image B (end frame).** Add Image A as a **reference** (so the printer stays identical), then paste:

> Same printer, same framing and lighting. A long cream paper strip has fed out of the slot and hangs down in front of the printer almost to the bottom edge of the frame, marked with tidy rows of short dark navy ink strokes in groups of four with one diagonal stroke across each group. One group near the middle is struck in brass-gold ink. The left half of the frame stays empty deep ink-navy darkness. Shallow depth of field, photographic.

Save as `keyframe-end.jpeg`.

**Checklist before continuing (all must be "yes"):**
- The printer is identical in A and B (shape, color, position, angle)?
- The left half empty and dark in both?
- The strokes read as tallies (four upright + one diagonal), one group in brass?
- No letters, logos, or stamps anywhere?

If anything is "no": regenerate the images (free). **Do not** write "no text" in the prompt; describe what should be there. Mentioning unwanted objects invites them.

**Fallback:** two older good keyframes are in this folder (`keyframe-start-v1.jpeg`, `keyframe-end-v1.jpeg`). Their weakness: the printer is centered, so the hero text would have to sit over the dark upper part or the printer body with a thin dark overlay.

## Step 2: make the video

1. Choose video generation from **two images** (start and end frames).
2. Start frame = `keyframe-start.jpeg`, end frame = `keyframe-end.jpeg`.
3. Model **Omni 1.1 Flash**, duration **8 seconds**, resolution **720p**, ratio **16:9**, **1 result**.
4. Prompt:

> 0.0-8.0 s: the cream paper strip feeds steadily out of the printer slot and slides toward the camera, carrying its rows of ink strokes with it, while the printer stays completely still. A single slow push-in, locked and smooth. Deep ink-navy background, soft side light from the left, matte paper, brass-gold edge on the printer rim, photographic, shallow depth of field.

5. Download the result, rename it `hero.mp4`.

## Check the video before handing it over

Play it slowly, frame by frame (Flow often fails mid-motion, not at the start or end):
- The printer does not change shape, rotate, or shift?
- The strokes do not change count or shape while moving (no "melting")?
- No sudden cut in the middle of the clip?
- No text or letters appearing?
- The paper moves in one direction from start to end (no back-and-forth)?

## If a result looks bad

| Problem | Fix |
|---|---|
| The printer moves/changes | Add "the printer body is completely static in every frame". Or use Veo 3.1 Fast (20 credits) |
| Random or shifting strokes | Tighten the composition: fewer rows in image B, larger strokes |
| A cut in the middle | Do not put timestamps in the middle of the prompt ("at 4 s ..."); keep one motion from 0 to 8 seconds |
| Text appears | Make sure the on-screen-text option is off in Flow |
| Camera sways | Write "static locked-off camera with only a slow push-in" |

## What not to do

- Do not flip or rotate the object (the printer must keep the same side).
- Do not ask for many small moving particles (sparks, confetti, dust).
- Do not add people or hands.

## After it is done

Place `hero.mp4` (and new keyframes, if any) in `web/hero-source/`, then run:

```bash
cd web
npm run frames -- hero-source/hero.mp4
```

That produces the frames, the poster, and the `manifest.json` the landing page reads directly.
