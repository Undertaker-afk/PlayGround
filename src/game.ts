import {
  Engine,
  Scene,
  Vector3,
  Mesh,
} from '@babylonjs/core';
import { buildTerrain } from './world/terrain';
import { buildSky, buildWater } from './world/sky';
import { buildVegetation } from './world/vegetation';
import type { Vegetation } from './world/vegetation';
import { Player } from './player';
import { createInput, bindKeyboard, bindMouseLook, bindTouch } from './mobile/joystick';
import { HUD } from './ui/hud';
import { isMobileDevice, defaultQuality, cycleQuality } from './utils/quality';
import type { QualityLevel } from './utils/quality';

function setProgress(pct: number, label: string): void {
  const fill = document.getElementById('load-fill');
  const status = document.getElementById('load-status');
  if (fill) fill.style.width = `${Math.round(pct * 100)}%`;
  if (status) status.textContent = label;
}
const tick = () => new Promise((r) => setTimeout(r, 16));

export async function startGame(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const mobile = isMobileDevice();
  let quality = defaultQuality(mobile);
  let qualityLabel = quality.level[0].toUpperCase() + quality.level.slice(1);

  setProgress(0.05, 'engine…');
  await tick();

  const engine = new Engine(canvas, true, { stencil: true, antialias: !mobile });
  engine.setHardwareScalingLevel(1 / quality.pixelRatio);

  const buildWorld = async () => {
    const scene = new Scene(engine);
    scene.collisionsEnabled = false;

    setProgress(0.15, 'terrain…');
    await tick();
    buildTerrain(scene);

    setProgress(0.35, 'sky & water…');
    await tick();
    const sky = buildSky(scene, quality);
    buildWater(scene);

    setProgress(0.55, 'planting grass…');
    await tick();
    const addCaster = (m: Mesh) => {
      if (sky.shadows) {
        try { sky.shadows.addShadowCaster(m, true); } catch { /* noop */ }
        m.receiveShadows = false;
      }
    };
    const veg = buildVegetation(scene, quality, addCaster);

    setProgress(0.8, 'waking player…');
    await tick();
    const player = new Player(scene);
    player.build();
    if (sky.shadows) player.enableShadows(addCaster);

    return { scene, sky, veg, player };
  };

  let { scene, sky, veg, player } = await buildWorld();

  const input = createInput();
  const unbindKeys = bindKeyboard(input);
  const unbindMouse = bindMouseLook(canvas, input);
  const touch = bindTouch(input);
  touch.setJoystickVisible(mobile);
  if (mobile) document.getElementById('touch-ui')!.classList.remove('hidden');

  let collected = 0;
  const total = veg.coins.length;
  const hud = new HUD(
    () => {
      quality = cycleQuality(quality, mobile);
      qualityLabel = quality.level[0].toUpperCase() + quality.level.slice(1) as QualityLevel as unknown as string;
      hud.setQualityLabel(qualityLabel);
      hud.toast(`Quality: ${qualityLabel} — reloads world`);
      setTimeout(() => window.location.reload(), 600);
    },
    () => {
      sky.setNight(!sky.isNight());
      hud.setNight(sky.isNight());
    },
  );
  hud.setQualityLabel(qualityLabel);
  hud.show();

  // coin collection bounds
  const coinPos = (i: number) => veg.coins[i].position;

  setProgress(1, 'ready!');
  document.getElementById('loading')!.style.display = 'none';
  if (!mobile) {
    // show help briefly on desktop first run
    document.getElementById('help-modal')!.classList.remove('hidden');
  }
  hud.toast(mobile ? 'Left stick to move · drag right side to look' : 'WASD to move · drag to look · collect ✦ shards');

  let last = performance.now();
  let elapsed = 0;

  scene.registerBeforeRender(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;

    player.update(dt, input, (veg as Vegetation).colliders);
    (veg as Vegetation).update(elapsed, player.position);
    sky.update(elapsed);

    // collect shards
    for (let i = 0; i < veg.coins.length; i++) {
      if (veg.coinTaken[i]) continue;
      const c = coinPos(i);
      const dx = c.x - player.position.x;
      const dz = c.z - player.position.z;
      const dy = c.y - (player.position.y + 1.2);
      if (dx * dx + dz * dz < 2.6 && Math.abs(dy) < 2.4) {
        veg.coinTaken[i] = true;
        veg.coins[i].setEnabled(false);
        (veg.coins[i].metadata?.ring as Mesh | undefined)?.setEnabled(false);
        collected++;
        hud.toast(collected >= total ? '🏆 All shards collected!' : `✦ Shard ${collected}/${total}`);
      }
    }

    hud.update(dt, player.position.x, player.position.z, collected, total, veg.coins);
  });

  engine.runRenderLoop(() => scene.render());

  window.addEventListener('resize', () => {
    engine.resize();
    // keep pixel ratio cap on orientation change
    const q = defaultQuality(isMobileDevice());
    engine.setHardwareScalingLevel(1 / Math.min(q.pixelRatio, quality.pixelRatio));
  });

  document.addEventListener('visibilitychange', () => {
    // Babylon handles throttling; nothing needed
  });

  // HMR / cleanup safety
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unbindKeys();
      unbindMouse();
      scene.dispose();
      engine.dispose();
    });
  }

  // follow camera already active; ensure canvas focus for keys
  canvas.tabIndex = 1;
  canvas.focus?.();
  void Vector3;
}
