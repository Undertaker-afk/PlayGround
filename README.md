# PlayGround — Babylon.js Open World 🌿

A mobile-friendly Babylon.js open-world playground: procedural rolling terrain with a central lake,
**modeled grass blades** (tapered 3-blade tufts, thin-instanced + wind shader plugin), pines / oaks / birches,
bushes, boulders, flowers, reeds, mushrooms, butterflies, drifting clouds and collectible ✦ shards.

## Run

```bash
npm install
npm run dev        # → http://localhost:5173
npm run build      # type-check + production build
npm run test:world # headless NullEngine world-integrity test
```

Tip: `?help=0` skips the intro card, `?cam=0.6` overrides the start camera angle.

Open on your phone — a virtual joystick (left), look-drag (right half), jump ▲ and sprint ≫ buttons appear automatically.

## Controls

| Desktop | Mobile |
|---|---|
| WASD / arrows move · Space jump · Shift sprint | Left stick moves |
| Mouse-drag orbits · wheel zooms | Drag right half of screen to look |
| ⚙ cycles quality · 🌙 day/night | Same HUD buttons |

## Tech

- `babylonjs/core` only, Vite + TypeScript, zero model downloads — everything procedural.
- Thin instances for grass/trees/bushes/rocks/flowers (single draw call per type).
- Auto quality: mobile gets capped pixel ratio, fewer instances, no shadows.
