import {
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  ParticleSystem,
  Texture,
  Vector3,
  Animation,
  Scene,
} from '@babylonjs/core';
import type { QualitySettings } from '../utils/quality';

export interface SkyRig {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  shadows: ShadowGenerator | null;
  skyDome: unknown;
  clouds: unknown[];
  setNight: (night: boolean) => void;
  update: (t: number) => void;
  isNight: () => boolean;
}

export function buildSky(scene: Scene, quality: QualitySettings): SkyRig {
  scene.clearColor = new Color4(0.47, 0.75, 0.92, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0022;
  scene.fogColor = new Color3(0.7, 0.83, 0.92);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.85;
  hemi.groundColor = new Color3(0.35, 0.45, 0.3);

  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, -0.35), scene);
  sun.position = new Vector3(60, 90, 40);
  sun.intensity = 1.6;

  let shadows: ShadowGenerator | null = null;
  if (quality.shadows) {
    shadows = new ShadowGenerator(quality.shadowMapSize, sun);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 16;
    shadows.setTransparencyShadow(false);
  }

  // Gradient sky dome (inverted sphere, BackSide)
  const dome = MeshBuilder.CreateSphere('skyDome', { diameter: 1500, segments: 16 }, scene);
  const domeMat = new StandardMaterial('skyMat', scene);
  domeMat.backFaceCulling = false;
  domeMat.disableLighting = true;
  domeMat.emissiveColor = new Color3(0.35, 0.65, 0.95);
  domeMat.alpha = 1;
  dome.material = domeMat;
  dome.isPickable = false;
  dome.infiniteDistance = true;

  // Sun disc sprite-ish
  const sunBall = MeshBuilder.CreateSphere('sunBall', { diameter: 60, segments: 12 }, scene);
  const sunMat = new StandardMaterial('sunMat', scene);
  sunMat.emissiveColor = new Color3(1, 0.9, 0.6);
  sunMat.disableLighting = true;
  sunBall.material = sunMat;
  sunBall.position = new Vector3(300, 330, 180);
  sunBall.isPickable = false;

  // Drifting low-poly clouds (merged spheres, white, unlit)
  const clouds: unknown[] = [];
  const cloudMat = new StandardMaterial('cloudMat', scene);
  cloudMat.emissiveColor = new Color3(1, 1, 1);
  cloudMat.disableLighting = true;
  cloudMat.alpha = 0.92;
  for (let i = 0; i < 10; i++) {
    const c = MeshBuilder.CreateSphere(`cloud${i}`, { diameter: 22 + (i % 4) * 8, segments: 7 }, scene);
    c.material = cloudMat;
    c.position = new Vector3((i - 5) * 90, 90 + (i % 3) * 14, -160 + (i % 5) * 70);
    c.scaling.y = 0.45;
    c.isPickable = false;
    (clouds as { position: Vector3; }[]).push(c as unknown as { position: Vector3 });
  }

  // Floating dust / pollen particles for atmosphere
  const ps = new ParticleSystem('pollen', 220, scene);
  ps.particleTexture = new Texture('https://www.babylonjs-playground.com/textures/flare.png', scene);
  ps.emitter = new Vector3(0, 8, 0);
  ps.minEmitBox = new Vector3(-90, 2, -90);
  ps.maxEmitBox = new Vector3(90, 16, 90);
  ps.color1 = new Color4(1, 0.95, 0.6, 0.7);
  ps.color2 = new Color4(1, 1, 1, 0);
  ps.minSize = 0.15;
  ps.maxSize = 0.5;
  ps.minLifeTime = 4;
  ps.maxLifeTime = 9;
  ps.emitRate = 24;
  ps.direction1 = new Vector3(-1, 0.2, 0.4);
  ps.direction2 = new Vector3(1, 0.6, -0.4);
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1.4;
  ps.start();

  let night = false;

  const dayCfg = {
    sky: new Color3(0.35, 0.65, 0.95),
    clear: new Color4(0.47, 0.75, 0.92, 1),
    fog: new Color3(0.7, 0.83, 0.92),
    sun: 1.6, hemi: 0.85,
  };
  const nightCfg = {
    sky: new Color3(0.04, 0.07, 0.18),
    clear: new Color4(0.03, 0.05, 0.12, 1),
    fog: new Color3(0.08, 0.1, 0.2),
    sun: 0.25, hemi: 0.3,
  };

  return {
    sun, hemi, shadows, skyDome: dome, clouds,
    isNight: () => night,
    setNight: (n: boolean) => {
      night = n;
      const c = n ? nightCfg : dayCfg;
      (domeMat.emissiveColor as Color3).copyFrom(c.sky);
      (scene.clearColor as Color4).copyFrom(c.clear);
      (scene.fogColor as Color3).copyFrom(c.fog);
      sun.intensity = c.sun;
      hemi.intensity = c.hemi;
      sunMat.emissiveColor.copyFrom(n ? new Color3(0.8, 0.85, 1) : new Color3(1, 0.9, 0.6));
    },
    update: (t: number) => {
      for (let i = 0; i < (clouds as { position: Vector3 }[]).length; i++) {
        const c = (clouds as { position: Vector3 }[])[i];
        c.position.x += 0.02 + (i % 3) * 0.008;
        if (c.position.x > 320) c.position.x = -320;
      }
      void t;
    },
  };
}

export function buildWater(scene: Scene): void {
  const water = MeshBuilder.CreateGround('water', { width: 130, height: 130, subdivisions: 1 }, scene);
  water.position.y = 1.6;
  const mat = new StandardMaterial('waterMat', scene);
  mat.diffuseColor = new Color3(0.15, 0.45, 0.65);
  mat.emissiveColor = new Color3(0.05, 0.2, 0.3);
  mat.alpha = 0.78;
  mat.specularColor = new Color3(0.6, 0.7, 0.8);
  water.material = mat;
  water.isPickable = false;

  // gentle opacity shimmer (cheap + mobile friendly)
  let t = 0;
  scene.registerBeforeRender(() => {
    t += 0.016;
    mat.alpha = 0.72 + Math.sin(t * 1.4) * 0.06;
  });

  // reeds ring handled in vegetation; sandy shore handled by terrain colors
  void Animation;
}
