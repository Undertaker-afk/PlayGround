// Wind + weather simulation: clear / cloudy / rain / storm with gusts,
// rain particles, lightning flashes, and hooks into vegetation + clouds + lights.

import {
  Scene, Vector3, ParticleSystem, DynamicTexture, Color4, Color3
} from '@babylonjs/core';
import type { WorldRefs } from './world';
import type { VegRefs } from './vegetation';

export type WeatherType = 'clear' | 'cloudy' | 'rain' | 'storm';

interface WeatherDef {
  label: string;
  icon: string;
  cloud: number;      // 0..1 cloud cover
  windBase: number;   // sustained wind speed
  gustAmp: number;    // gust strength
  rainRate: number;   // particles/sec
  sunMul: number;     // sunlight multiplier
  fogMul: number;     // fog density multiplier
}

const DEFS: Record<WeatherType, WeatherDef> = {
  clear:  { label: 'Clear',  icon: '🌤', cloud: 0.12, windBase: 1.2, gustAmp: 0.8, rainRate: 0,    sunMul: 1.0,  fogMul: 1.0 },
  cloudy: { label: 'Cloudy', icon: '☁', cloud: 0.65, windBase: 2.2, gustAmp: 1.2, rainRate: 0,    sunMul: 0.72, fogMul: 1.5 },
  rain:   { label: 'Rain',   icon: '🌧', cloud: 0.9,  windBase: 3.0, gustAmp: 1.6, rainRate: 900,  sunMul: 0.5,  fogMul: 2.2 },
  storm:  { label: 'Storm',  icon: '⛈', cloud: 1.0,  windBase: 4.5, gustAmp: 2.6, rainRate: 1600, sunMul: 0.34, fogMul: 2.8 },
};

const ORDER: WeatherType[] = ['clear', 'cloudy', 'rain', 'storm'];

export interface WeatherRefs {
  type: WeatherType;
  windSpeed: number;
  cycle(): WeatherType;
  set(t: WeatherType): void;
  setTimeOfDay(t: number): void;
  update(dt: number, camPos: Vector3): void;
}

export function buildWeather(
  scene: Scene, world: WorldRefs, veg: VegRefs,
  onToast: (msg: string) => void
): WeatherRefs {
  let type: WeatherType = 'clear';
  let tod = 0.32;
  let windAngle = 0.6;
  let windSpeed = 1.2;
  let gust = 0;
  let elapsed = 0;
  let autoTimer = 80;
  let lightningTimer = 5;
  let lightningFlash = 0;
  const isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);

  // ---------- Rain streak texture (procedural, no network) ----------
  const rainTex = new DynamicTexture('rainTex', { width: 16, height: 64 }, scene, true);
  {
    const ctx = rainTex.getContext();
    ctx.clearRect(0, 0, 16, 64);
    const grad = ctx.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(170,200,255,0)');
    grad.addColorStop(0.5, 'rgba(170,200,255,0.9)');
    grad.addColorStop(1, 'rgba(170,200,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(6, 0, 4, 64);
    rainTex.update();
    rainTex.hasAlpha = true;
  }
  const rain = new ParticleSystem('rain', isMobile ? 900 : 2200, scene);
  rain.particleTexture = rainTex;
  rain.minSize = 0.5; rain.maxSize = 1.1;
  rain.minLifeTime = 0.7; rain.maxLifeTime = 1.1;
  rain.emitRate = 0;
  rain.direction1 = new Vector3(-1, -14, -1);
  rain.direction2 = new Vector3(1, -16, 1);
  rain.minEmitPower = 9; rain.maxEmitPower = 13;
  rain.color1 = new Color4(0.65, 0.75, 0.95, 0.55);
  rain.color2 = new Color4(0.65, 0.75, 0.95, 0.25);
  rain.gravity = new Vector3(0, -18, 0);
  rain.updateSpeed = 0.016;
  rain.start();

  const flashEl = document.getElementById('flash');

  function dayAmount(): number {
    return Math.max(0, Math.sin(tod * Math.PI * 2));
  }

  function applyLights(): void {
    const def = DEFS[type];
    const day = dayAmount();
    const flicker = lightningFlash > 0 ? lightningFlash * 2.2 : 0;
    world.sun.intensity = (0.25 + day * 1.5) * def.sunMul + flicker;
    world.hemi.intensity = (0.35 + day * 0.65) * (1 - def.cloud * 0.35);
    scene.fogDensity = 0.0028 * def.fogMul;
    const night = 1 - day;
    const dark = def.cloud * 0.35;
    scene.fogColor = new Color3(
      0.7 - night * 0.5 - dark * 0.25,
      0.85 - night * 0.55 - dark * 0.25,
      0.95 - night * 0.5 - dark * 0.2
    );
    world.setCloudCover(def.cloud);
  }

  function set(t: WeatherType): void {
    type = t;
    autoTimer = 80;
    applyLights();
  }

  function update(dt: number, camPos: Vector3): void {
    elapsed += dt;
    const def = DEFS[type];

    // --- wind: slowly veering direction + smooth gusts ---
    windAngle += dt * 0.05 * Math.sin(elapsed * 0.11);
    const gustTarget = Math.max(0, Math.sin(elapsed * 0.9) * 0.5 + Math.sin(elapsed * 2.3 + 1.7) * 0.5) * def.gustAmp;
    gust += (gustTarget - gust) * Math.min(1, dt * 2);
    const target = def.windBase + gust;
    windSpeed += (target - windSpeed) * Math.min(1, dt * 1.5);
    const dx = Math.cos(windAngle), dz = Math.sin(windAngle);

    // drive vegetation sway + cloud drift
    veg.setWind(0.35 + windSpeed * 0.32);
    world.setWind(dx, dz, 0.4 + windSpeed * 0.45);

    // --- rain follows the camera ---
    rain.emitRate += ((type === 'rain' || type === 'storm' ? def.rainRate : 0) - rain.emitRate) * Math.min(1, dt * 2);
    rain.emitter = camPos.add(new Vector3(0, 12, 0));
    rain.minEmitBox = new Vector3(-28, -2, -28);
    rain.maxEmitBox = new Vector3(28, 6, 28);
    rain.direction1 = new Vector3(-1 - dx * windSpeed, -14, -1 - dz * windSpeed);
    rain.direction2 = new Vector3(1 - dx * windSpeed, -16, 1 - dz * windSpeed);

    // --- lightning ---
    if (lightningFlash > 0) {
      lightningFlash = Math.max(0, lightningFlash - dt * 6);
      if (flashEl) flashEl.style.opacity = String(Math.min(0.7, lightningFlash));
    }
    if (type === 'storm') {
      lightningTimer -= dt * (0.7 + windSpeed * 0.15);
      if (lightningTimer <= 0) {
        lightningTimer = 4 + Math.random() * 6;
        lightningFlash = 1;
        onToast('⛈ Lightning strike!');
      }
    }

    // --- auto weather cycle ---
    autoTimer -= dt;
    if (autoTimer <= 0) {
      const next = ORDER[(ORDER.indexOf(type) + 1) % ORDER.length];
      set(next);
      onToast(`${DEFS[next].icon} Weather shifting: ${DEFS[next].label}`);
      const btn = document.getElementById('btn-weather');
      if (btn) btn.textContent = `${DEFS[next].icon} ${DEFS[next].label}`;
    }

    applyLights();
  }

  applyLights();
  return {
    get type() { return type; },
    get windSpeed() { return windSpeed; },
    cycle() {
      const next = ORDER[(ORDER.indexOf(type) + 1) % ORDER.length];
      set(next);
      onToast(`${DEFS[next].icon} Weather: ${DEFS[next].label}`);
      return next;
    },
    set,
    setTimeOfDay(t: number) { tod = t; applyLights(); },
    update,
  };
}

export function weatherLabel(t: WeatherType): string {
  return `${DEFS[t].icon} ${DEFS[t].label}`;
}
