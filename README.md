# 🌿 Babylon.js Open World

A mobile-friendly Babylon.js open-world playground with **procedurally modeled** vegetation — no external assets.

## Features

- **Open world terrain** — 400×400 analytic heightfield (hills, rim mountains, pond basin), vertex-colored (grass / dirt / rock / snow / sand), fog + gradient sky dome with sun glow
- **Modeled grass shards** — custom bent-blade geometry (tapered 3-tri shards) merged into clumps, ~1.6k instanced clumps with vertex-shader wind sway
- **Trees** — two hand-modeled types: pines (trunk + 3 foliage cones) and broadleaf oaks (jittered icosphere crowns), instanced, swaying in wind
- **Bushes** — squashed jittered icospheres with berry dots
- **And more** — rocks, flowers (4 colors), mushrooms, drifting clouds, pond water + foam ring, pollen/firefly particles, day/night cycle
- **Player** — capsule avatar with squash-and-stretch, jump + gravity, tree/rock collision, 3rd/1st person camera
- **Mobile support** — virtual joystick (left), drag-look (right), jump + sprint buttons, pinch zoom, safe-area layout, touch detection, capped pixel ratio + auto quality scaling
- **Desktop** — WASD/arrows, mouse-drag look, wheel zoom, Shift sprint, Space jump

## Run

```bash
npm install
npm run dev      # → http://localhost:5173
npm run build    # production build → dist/
npm run preview
```

## Controls

| Input | Action |
|---|---|
| WASD / left stick | Move (camera-relative) |
| Mouse drag / right-side drag | Look |
| Space / ⤒ button | Jump |
| Shift / ≫ button | Sprint |
| Wheel / pinch | Zoom |
| Quality · Day · Cam pills | Toggle quality, time of day, camera |

## Structure

- `src/main.ts` — boot, engine, UI wiring, main loop, auto-quality
- `src/world.ts` — terrain mesh, sky shader, lights + shadows, pond, clouds, particles, day/night
- `src/vegetation.ts` — grass shards, trees, bushes, rocks, flowers, mushrooms (all instanced)
- `src/player.ts` — avatar, camera rig, keyboard + touch/joystick input, physics
- `src/utils.ts` — seeded RNG, value noise/fBm, shared `terrainHeight()` + colors
