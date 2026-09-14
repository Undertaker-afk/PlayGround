import {
  Scene, Vector3, Mesh, VertexData, Color4, StandardMaterial, Color3,
  HemisphericLight, DirectionalLight, ShadowGenerator, MeshBuilder,
  ShaderMaterial, Effect, ParticleSystem, Texture, TransformNode, Animation,
  GlowLayer
} from '@babylonjs/core';
import { terrainHeight, terrainColor, mulberry32 } from './utils';

export interface WorldRefs {
  shadowGen: ShadowGenerator;
  sun: DirectionalLight;
  hemi: HemisphericLight;
  skyMat: ShaderMaterial;
  water: Mesh;
  colliders: { x: number; z: number; r: number }[];
  setTimeOfDay(t: number): void;
  update(t: number, dt: number): void;
}

export function buildWorld(scene: Scene, onProgress: (p: number, label: string) => void): WorldRefs {
  scene.clearColor = new Color4(0.53, 0.81, 0.98, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0028;
  scene.fogColor = new Color3(0.7, 0.85, 0.95);

  // ---------- Lights ----------
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  hemi.groundColor = new Color3(0.35, 0.45, 0.3);
  hemi.specular = new Color3(0.1, 0.1, 0.1);

  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.35), scene);
  sun.position = new Vector3(60, 90, -40);
  sun.intensity = 1.6;

  const isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
  const shadowGen = new ShadowGenerator(isMobile ? 1024 : 2048, sun);
  shadowGen.useBlurExponentialShadowMap = true;
  shadowGen.blurKernel = 16;
  shadowGen.setDarkness(0.25);
  sun.shadowMaxZ = 220;
  sun.shadowMinZ = 10;
  // Tight ortho box follows player (updated in main loop via sun.position/direction trick)
  sun.autoCalcShadowZBounds = false;
  (sun as any).shadowOrthoScale = 0.6;

  // ---------- Terrain ----------
  onProgress(0.15, 'Sculpting terrain…');
  const SIZE = 400, SUB = 150;
  const ground = new Mesh('ground', scene);
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const rand = mulberry32(1337);

  for (let iz = 0; iz <= SUB; iz++) {
    for (let ix = 0; ix <= SUB; ix++) {
      const x = (ix / SUB - 0.5) * SIZE;
      const z = (iz / SUB - 0.5) * SIZE;
      const y = terrainHeight(x, z);
      positions.push(x, y, z);
      uvs.push(ix / SUB, iz / SUB);
      // slope estimate
      const e = 1.2;
      const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
      const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
      const slope = Math.min(1, Math.hypot(dx, dz) / (2 * e) * 0.9);
      const [r, g, b] = terrainColor(y, slope, rand());
      colors.push(r, g, b, 1);
    }
  }
  for (let iz = 0; iz < SUB; iz++) {
    for (let ix = 0; ix < SUB; ix++) {
      const a = iz * (SUB + 1) + ix;
      const b = a + 1, c = a + SUB + 1, d = c + 1;
      // counter-clockwise seen from above → normals point up (see VertexData.ComputeNormals convention)
      indices.push(a, b, c, b, d, c);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.colors = colors;
  vd.uvs = uvs;
  vd.applyToMesh(ground);

  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.specularColor = new Color3(0.05, 0.05, 0.05);
  groundMat.diffuseColor = new Color3(1, 1, 1);
  groundMat.maxSimultaneousLights = 4;
  ground.useVertexColors = true;
  ground.receiveShadows = true;
  groundMat.freeze();
  ground.material = groundMat;
  ground.freezeWorldMatrix();
  ground.isPickable = true;
  ground.metadata = { isGround: true };

  // ---------- Sky dome (gradient + sun glow) ----------
  Effect.ShadersStore['skyVertexShader'] = `
    precision highp float;
    attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
    uniform mat4 worldViewProjection; uniform mat4 world;
    varying vec3 vDir; varying vec3 vPos;
    void main() {
      vec4 p = vec4(position, 1.0);
      vDir = normalize(position);
      vPos = (world * p).xyz;
      vec4 outp = worldViewProjection * p;
      outp.z = outp.w * 0.99999;
      gl_Position = outp;
    }`;
  Effect.ShadersStore['skyFragmentShader'] = `
    precision highp float;
    varying vec3 vDir; varying vec3 vPos;
    uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;
    uniform vec3 sunDir; uniform vec3 sunColor; uniform float time;
    void main() {
      float h = normalize(vDir).y;
      vec3 col = h > 0.12
        ? mix(midColor, topColor, smoothstep(0.12, 0.75, h))
        : mix(botColor, midColor, smoothstep(-0.12, 0.12, h));
      float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
      col += sunColor * (pow(s, 900.0) * 1.4 + pow(s, 18.0) * 0.22);
      // subtle drifting horizon haze bands
      col += vec3(1.0,0.98,0.9) * 0.03 * sin(vDir.x*8.0 + time*0.05) * smoothstep(0.35,0.0,abs(h-0.06));
      gl_FragColor = vec4(col, 1.0);
    }`;
  const skyMat = new ShaderMaterial('sky', scene, { vertex: 'sky', fragment: 'sky' }, {
    attributes: ['position', 'normal', 'uv'], uniforms: ['world', 'worldViewProjection', 'topColor', 'midColor', 'botColor', 'sunDir', 'sunColor', 'time']
  });
  skyMat.setColor3('topColor', new Color3(0.16, 0.42, 0.85));
  skyMat.setColor3('midColor', new Color3(0.55, 0.8, 0.97));
  skyMat.setColor3('botColor', new Color3(0.75, 0.88, 0.9));
  skyMat.setVector3('sunDir', new Vector3(0.5, 0.6, -0.35));
  skyMat.setColor3('sunColor', new Color3(1, 0.9, 0.65));
  skyMat.setFloat('time', 0);
  skyMat.backFaceCulling = false;
  skyMat.fogEnabled = false;
  const sky = MeshBuilder.CreateSphere('sky', { diameter: 1500, segments: 24 }, scene);
  sky.material = skyMat;
  sky.isPickable = false;
  sky.infiniteDistance = true;
  sky.applyFog = false;

  // ---------- Pond water ----------
  onProgress(0.3, 'Filling pond…');
  const waterMat = new StandardMaterial('waterMat', scene);
  waterMat.diffuseColor = new Color3(0.15, 0.45, 0.6);
  waterMat.emissiveColor = new Color3(0.05, 0.18, 0.24);
  waterMat.alpha = 0.78;
  waterMat.specularColor = new Color3(0.6, 0.6, 0.6);
  waterMat.specularPower = 128;
  const water = MeshBuilder.CreateDisc('pond', { radius: 24, tessellation: 48 }, scene);
  water.rotation.x = Math.PI / 2;
  const pondY = terrainHeight(40, -35) + 2.2;
  water.position = new Vector3(40, pondY, -35);
  water.material = waterMat;
  water.receiveShadows = true;
  water.isPickable = false;

  // animated ripple via uv offset trick on a cloned overlay ring
  const foam = MeshBuilder.CreateTorus('foam', { diameter: 47, thickness: 0.7, tessellation: 64 }, scene);
  foam.position = new Vector3(40, pondY + 0.15, -35);
  foam.rotation.x = Math.PI / 2;
  const foamMat = new StandardMaterial('foamMat', scene);
  foamMat.diffuseColor = new Color3(0.9, 0.95, 0.9);
  foamMat.alpha = 0.5;
  foam.material = foamMat;

  // ---------- Clouds (instanced puffy spheres, drifting) ----------
  const cloudRoot = new TransformNode('clouds', scene);
  const puff = MeshBuilder.CreateSphere('puff', { diameter: 10, segments: 7 }, scene);
  const puffMat = new StandardMaterial('puffMat', scene);
  puffMat.diffuseColor = new Color3(1, 1, 1);
  puffMat.emissiveColor = new Color3(0.75, 0.78, 0.82);
  puffMat.alpha = 0.92;
  puffMat.disableLighting = false;
  puff.material = puffMat;
  puff.isPickable = false;
  const cloudRand = mulberry32(99);
  const clouds: { node: TransformNode; speed: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const node = new TransformNode('cloud' + i, scene);
    node.parent = cloudRoot;
    node.position = new Vector3((cloudRand() - 0.5) * 500, 70 + cloudRand() * 40, (cloudRand() - 0.5) * 500);
    const n = 3 + Math.floor(cloudRand() * 4);
    for (let k = 0; k < n; k++) {
      const inst = puff.createInstance(`cloud${i}p${k}`);
      inst.parent = node;
      inst.position = new Vector3((cloudRand() - 0.5) * 26, (cloudRand() - 0.5) * 4, (cloudRand() - 0.5) * 12);
      const s = 0.8 + cloudRand() * 1.8;
      inst.scaling = new Vector3(s * 1.6, s * 0.7, s);
    }
    clouds.push({ node, speed: 0.6 + cloudRand() * 1.2 });
  }
  puff.setEnabled(false);

  // ---------- Fireflies / butterflies particles ----------
  const ps = new ParticleSystem('pollen', 220, scene);
  ps.particleTexture = new Texture('https://www.babylonjs-playground.com/textures/flare.png', scene);
  ps.emitter = new Vector3(0, 3, 0);
  ps.minEmitBox = new Vector3(-90, 1, -90);
  ps.maxEmitBox = new Vector3(90, 8, 90);
  ps.color1 = new Color4(1, 0.95, 0.6, 0.9);
  ps.color2 = new Color4(1, 1, 1, 0);
  ps.minSize = 0.15; ps.maxSize = 0.5;
  ps.minLifeTime = 3; ps.maxLifeTime = 7;
  ps.emitRate = 26;
  ps.direction1 = new Vector3(-1, 0.4, -1);
  ps.direction2 = new Vector3(1, 1, 1);
  ps.minEmitPower = 0.4; ps.maxEmitPower = 1.4;
  ps.updateSpeed = 0.02;
  ps.start();

  try { new GlowLayer('glow', scene, { mainTextureSamples: 2, blurKernelSize: 32 }); } catch { /* mobile perf: ignore */ }

  // ---------- Day / night ----------
  let tod = 0.32; // 0..1
  function setTimeOfDay(t: number) {
    tod = t;
    const dayAmt = Math.max(0, Math.sin(t * Math.PI * 2)); // 1 at noon
    const duskAmt = Math.max(0, 1 - Math.abs(t - 0.27) * 6) + Math.max(0, 1 - Math.abs(t - 0.75) * 6);
    sun.intensity = 0.25 + dayAmt * 1.5;
    hemi.intensity = 0.35 + dayAmt * 0.65;
    const night = 1 - dayAmt;
    scene.fogColor = new Color3(0.7 - night * 0.5, 0.85 - night * 0.55, 0.95 - night * 0.5);
    skyMat.setColor3('topColor', new Color3(0.16 * dayAmt + 0.02, 0.42 * dayAmt + 0.03, 0.85 * dayAmt + 0.1));
    skyMat.setColor3('midColor', duskAmt > 0.4
      ? new Color3(0.98, 0.55, 0.35)
      : new Color3(0.2 + 0.35 * dayAmt, 0.4 + 0.4 * dayAmt, 0.6 + 0.37 * dayAmt));
    const ang = t * Math.PI * 2;
    const sd = new Vector3(Math.cos(ang), Math.sin(ang), -0.35).normalize();
    skyMat.setVector3('sunDir', sd);
    sun.direction = sd.scale(-1);
    sun.position = sd.scale(120);
  }
  setTimeOfDay(tod);

  function update(t: number, dt: number) {
    skyMat.setFloat('time', t);
    water.position.y = pondY + Math.sin(t * 1.2) * 0.08;
    foam.scaling.setAll(1 + Math.sin(t * 0.8) * 0.008);
    for (const c of clouds) {
      c.node.position.x += c.speed * dt;
      if (c.node.position.x > 280) c.node.position.x = -280;
    }
    ps.emitter = (scene.activeCamera?.position ?? Vector3.Zero()).add(new Vector3(0, 2, 0));
  }

  return { shadowGen, sun, hemi, skyMat, water, colliders: [], setTimeOfDay, update };
}
