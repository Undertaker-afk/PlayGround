import { Engine, Scene } from '@babylonjs/core';
import './style.css';
import { buildWorld } from './world';
import { buildVegetation } from './vegetation';
import { buildPlayer } from './player';
import { buildInventory } from './inventory';
import { buildWeather, weatherLabel } from './weather';
import { buildMining } from './mining';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const loadFill = document.getElementById('load-fill')!;
const loadText = document.getElementById('load-text')!;
const loading = document.getElementById('loading')!;
const fpsEl = document.getElementById('fps')!;
const statsEl = document.getElementById('stats')!;

const setProgress = (p: number, label: string) => {
  loadFill.style.width = `${Math.round(p * 100)}%`;
  loadText.textContent = label;
};

async function boot() {
  const engine = new Engine(canvas, true, {
    stencil: false,
    antialias: true,
    adaptToDeviceRatio: false,
    powerPreference: 'high-performance',
  });
  const isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
  engine.setHardwareScalingLevel(isMobile ? 1.25 : 1 / Math.min(window.devicePixelRatio, 2));

  const scene = new Scene(engine);
  scene.skipFrustumClipping = false;
  (window as any).__scene = scene; // debug handle (used by automated browser checks)

  setProgress(0.05, 'Creating terrain…');
  await new Promise((r) => setTimeout(r, 30)); // let loader paint

  const world = buildWorld(scene, setProgress);
  const veg = buildVegetation(scene, world.colliders, world.shadowGen, setProgress);
  const player = buildPlayer(scene, world.colliders, world.shadowGen);
  const inv = buildInventory();
  const weather = buildWeather(scene, world, veg, (m) => inv.toast(m));
  const mining = buildMining(scene, world, veg, inv);

  // ---------- UI wiring ----------
  const qualityBtn = document.getElementById('btn-quality')!;
  const timeBtn = document.getElementById('btn-time')!;
  const weatherBtn = document.getElementById('btn-weather')!;
  const camBtn = document.getElementById('btn-cam')!;
  const qualities = ['Auto', 'High', 'Low'] as const;
  let qi = 0;
  qualityBtn.addEventListener('click', () => {
    qi = (qi + 1) % qualities.length;
    const q = qualities[qi];
    qualityBtn.textContent = `Quality: ${q}`;
    if (q === 'High') { engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2)); veg.setDensity(1); }
    if (q === 'Low') { engine.setHardwareScalingLevel(1.75); veg.setDensity(0.35); }
    if (q === 'Auto') { engine.setHardwareScalingLevel(isMobile ? 1.25 : 1); veg.setDensity(isMobile ? 0.6 : 1); }
  });
  if (isMobile) veg.setDensity(0.6);

  let tod = 0.32;
  const todLabel = () => (tod < 0.2 || tod > 0.8 ? '🌙 Night' : tod > 0.22 && tod < 0.33 ? '🌅 Morning' : tod > 0.6 ? '🌇 Dusk' : '☀ Day');
  timeBtn.addEventListener('click', () => {
    tod = (tod + 0.18) % 1;
    world.setTimeOfDay(tod);
    weather.setTimeOfDay(tod);
    timeBtn.textContent = todLabel();
  });
  weatherBtn.textContent = weatherLabel(weather.type);
  weatherBtn.addEventListener('click', () => {
    weatherBtn.textContent = weatherLabel(weather.cycle());
  });
  camBtn.addEventListener('click', () => {
    player.setThirdPerson(!player.isThirdPerson());
    camBtn.textContent = player.isThirdPerson() ? '🎥 3rd' : '🎥 1st';
  });

  window.addEventListener('resize', () => engine.resize());

  // ---------- Main loop ----------
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsT = 0;
  let elapsed = 0;
  const shadow = world.shadowGen.getShadowMap();
  if (shadow) shadow.refreshRate = isMobile ? 1 : 0; // 0 = every frame on desktop

  scene.executeWhenReady(() => {
    setProgress(1, 'Ready!');
    setTimeout(() => loading.classList.add('hidden'), 350);
  });

  engine.runRenderLoop(() => {
    const now = performance.now();
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 0.05);
    elapsed += dt;

    player.update(dt);
    world.update(elapsed, dt);
    veg.update(elapsed);
    weather.update(dt, player.camera.position);
    mining.update(dt);

    // auto quality: drop pixel ratio if fps tanks
    fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; fpsT += dt;
    if (fpsT > 0.75) {
      const avg = Math.round(fpsAcc / fpsN);
      fpsEl.textContent = `${avg} fps`;
      statsEl.textContent = isMobile
        ? `Left stick move · Drag look · ${avg} fps`
        : `WASD move · Drag look · Space jump · ${avg} fps`;
      if (qualities[qi] === 'Auto') {
        if (avg < 28 && engine.getHardwareScalingLevel() < 2) engine.setHardwareScalingLevel(engine.getHardwareScalingLevel() + 0.25);
        else if (avg > 55 && engine.getHardwareScalingLevel() > (isMobile ? 1.25 : 1)) engine.setHardwareScalingLevel(engine.getHardwareScalingLevel() - 0.25);
      }
      fpsAcc = 0; fpsN = 0; fpsT = 0;
    }

    scene.render();
  });
}

boot().catch((e) => {
  loadText.textContent = 'Failed to start: ' + (e as Error).message;
  console.error(e);
});
