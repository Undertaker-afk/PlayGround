# 🌿 Babylon.js Open World

A mobile-friendly Babylon.js open-world playground with **procedurally modeled** vegetation — no external assets.

## Features

- **Open world terrain** — 400×400 analytic heightfield (hills, rim mountains, pond basin), vertex-colored (grass / dirt / rock / snow / sand), fog + gradient sky dome with sun glow
- **Modeled grass shards** — custom bent-blade geometry (tapered 3-tri shards) merged into clumps, ~1.6k instanced clumps with vertex-shader wind sway
- **Trees** — two hand-modeled types: pines (trunk + 3 foliage cones) and broadleaf oaks (jittered icosphere crowns), instanced, swaying in wind
- **Bushes** — squashed jittered icospheres with berry dots
- **And more** — rocks, flowers (4 colors), mushrooms, drifting clouds, pond water + foam ring, pollen/firefly particles, day/night cycle
- **Player** — capsule avatar with squash-and-stretch, jump + gravity, tree/rock collision, 3rd/1st person camera
- **Mining & shaping (low-poly deformable terrain)** — click/tap the ground to dig real craters into the heightfield (mesh, normals, colors and physics all update); dirt from topsoil, stone from deep pits, copper/iron/gold from glowing veins and surface crystal nodes; chop trees for wood; Build mode spends dirt/stone to raise mounds
- **Inventory** — 6-slot hotbar + bag panel (E), toasts for pickups, persists in localStorage
- **Wind & weather** — Clear/Cloudy/Rain/Storm cycle (auto + pill button): gusts drive grass/tree sway and cloud drift, rain particles follow the camera, storms bring fog, darkness and lightning flashes
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
| Click / tap ground, ⛏ button, or F | Mine at point / crosshair (dig, chop trees, hit ore) |
| B or 🧱/⛏ button, 1–2 | Toggle build mode / select dirt-stone to place |
| E or 🎒 Bag | Open inventory |
| Wheel / pinch | Zoom |
| Quality · Day · Weather · Cam pills | Toggle quality, time of day, weather, camera |

## Structure

- `src/main.ts` — boot, engine, UI wiring, main loop, auto-quality
- `src/world.ts` — terrain mesh (dynamically re-displaced by mining), sky shader, lights + shadows, pond, clouds, particles, day/night
- `src/vegetation.ts` — grass shards, trees (choppable), bushes, rocks, flowers, mushrooms (all instanced)
- `src/inventory.ts` — resources, hotbar, bag panel, toasts, localStorage saves
- `src/weather.ts` — wind gusts + clear/cloudy/rain/storm simulation driving sway, clouds, rain, lightning
- `src/mining.ts` — tap/click + crosshair digging, ore nodes, craters, dust bursts
- `src/player.ts` — avatar, camera rig, keyboard + touch/joystick input, physics
- `src/utils.ts` — seeded RNG, value noise/fBm, analytic base + editable deform grid (`digTerrain`/`fillTerrain`/`groundHeight`), ore veins
