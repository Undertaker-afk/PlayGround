import {
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Matrix,
  MaterialPluginBase,
  RegisterMaterialPlugin,
  UniformBuffer,
  Material,
  MaterialDefines,
} from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { terrainHeight, WATER_LEVEL, scatterPoint } from './terrain';
import { mulberry32 } from '../utils/noise';
import type { QualitySettings } from '../utils/quality';

// ---------------------------------------------------------------------------
// Wind plugin: world-space vertex sway for grass (thin-instance friendly).
// Only enabled for the 'grassMat' material; all other materials unaffected.
// ---------------------------------------------------------------------------
class WindPlugin extends MaterialPluginBase {
  private _time = 0;
  private _isGrass: boolean;
  constructor(material: Material) {
    super(material, 'Wind', 200, { WIND: false });
    this._isGrass = material.name === 'grassMat';
    if (this._isGrass) {
      this._enable(true);
    }
  }
  public setTime(t: number): void {
    this._time = t;
  }
  public override prepareDefines(defines: MaterialDefines): void {
    (defines as unknown as Record<string, unknown>)['WIND'] = this._isGrass;
  }
  public override getUniforms() {
    // UBO declaration (`float uTime;`) is generated automatically from this.
    return { ubo: [{ name: 'uTime', size: 1, type: 'float' }] };
  }
  public override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat('uTime', this._time);
  }
  public override getCustomCode(shaderType: string) {
    if (shaderType === 'vertex') {
      return {
        // Injected right before gl_Position — `worldPos` and `positionUpdated`
        // are both in scope here. positionUpdated.y is 0 at blade base, ~1 at tip.
        CUSTOM_VERTEX_UPDATE_WORLDPOS: `
          #ifdef WIND
            float windH = clamp(positionUpdated.y, 0.0, 1.2);
            float windPhase = worldPos.x * 0.35 + worldPos.z * 0.45;
            float windSway = sin(uTime * 2.2 + windPhase) * 0.16 * windH;
            worldPos.x += windSway;
            worldPos.z += windSway * 0.6;
          #endif
        `,
      };
    }
    return null;
  }
}
try {
  RegisterMaterialPlugin('Wind', (m) => new WindPlugin(m));
} catch { /* older core: ignore, grass just won't sway */ }

export interface Vegetation {
  update: (t: number, playerPos: Vector3) => void;
  coins: Mesh[];
  coinTaken: boolean[];
  colliders: { x: number; z: number; r: number }[];
}

// Helper: taper a plane into a grass blade (base wide, tip pointed), base at y=0
function makeBlade(scene: Scene, width: number, height: number, lean: number): Mesh {
  const blade = MeshBuilder.CreatePlane('blade', { width, height }, scene);
  const pos = blade.getVerticesData('position')!;
  const uv = blade.getVerticesData('uv')!;
  for (let i = 0; i < pos.length; i += 3) {
    const y = pos[i + 1]; // -h/2..h/2
    const f = (y + height / 2) / height; // 0 base .. 1 tip
    pos[i] *= 1 - f * 0.92; // taper to point
    pos[i] += lean * f * f; // lean outward
    pos[i + 1] = f * height; // base at 0
    void uv;
  }
  blade.updateVerticesData('position', pos, false, false);
  // gradient vertex colors: dark base -> vivid tip
  const count = pos.length / 3;
  const colors = new Float32Array(count * 4);
  const base = new Color3(0.13, 0.32, 0.1);
  const tip = new Color3(0.42, 0.78, 0.25);
  for (let i = 0; i < count; i++) {
    const f = pos[i * 3 + 1] / height;
    colors[i * 4] = base.r + (tip.r - base.r) * f;
    colors[i * 4 + 1] = base.g + (tip.g - base.g) * f;
    colors[i * 4 + 2] = base.b + (tip.b - base.b) * f;
    colors[i * 4 + 3] = 1;
  }
  blade.setVerticesData('color', Array.from(colors), false);
  return blade;
}

function jitterSphere(mesh: Mesh, amount: number, rand: () => number): void {
  const pos = mesh.getVerticesData('position')!;
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] += (rand() - 0.5) * amount;
    pos[i + 1] += (rand() - 0.5) * amount;
    pos[i + 2] += (rand() - 0.5) * amount;
  }
  mesh.updateVerticesData('position', pos, false, false);
  mesh.refreshBoundingInfo(true);
}

export function buildVegetation(scene: Scene, quality: QualitySettings, addShadowCaster: (m: Mesh) => void): Vegetation {
  const rand = mulberry32(1337);
  const colliders: { x: number; z: number; r: number }[] = [];

  // ================= GRASS TUFTS (modeled blades, instanced, wind) =================
  const bladeA = makeBlade(scene, 0.34, 1.05, 0.12);
  const bladeB = makeBlade(scene, 0.3, 0.85, -0.14);
  bladeB.rotation.y = (Math.PI * 2) / 3;
  const bladeC = makeBlade(scene, 0.32, 0.95, 0.1);
  bladeC.rotation.y = (-Math.PI * 2) / 3;
  // bake rotations before merge
  bladeB.bakeCurrentTransformIntoVertices();
  bladeC.bakeCurrentTransformIntoVertices();
  const tuft = Mesh.MergeMeshes([bladeA, bladeB, bladeC], true, false, undefined, false, true)!;
  tuft.name = 'grassTuft';
  bladeA.dispose(); bladeB.dispose(); bladeC.dispose();

  const grassMat = new StandardMaterial('grassMat', scene);
  grassMat.backFaceCulling = false;
  grassMat.specularColor = new Color3(0, 0, 0);
  grassMat.emissiveColor = new Color3(0.06, 0.1, 0.03);
  // WindPlugin self-enables for materials named 'grassMat' — no setup needed.
  tuft.material = grassMat;
  tuft.isVisible = false;

  const grassPts = scatterPoint(quality.grassCount, rand, 6, 195);
  const dummy = Matrix.Identity();
  let placedGrass = 0;
  const grassInstances: Mesh[] = [];
  // Use real InstancedMesh clones in batches (thin-instance alternative that always works)
  const BATCH = 1; // one InstancedMesh per tuft would be 11k draw calls — instead use thin instances
  void BATCH;
  // Thin instances: single draw call, mobile friendly
  const grassMat4s = new Float32Array(quality.grassCount * 16);
  let gi = 0;
  for (const p of grassPts) {
    const y = terrainHeight(p.x, p.z);
    if (y < WATER_LEVEL + 0.25 || y > 15) continue;
    const s = 0.7 + rand() * 0.9;
    const rot = rand() * Math.PI * 2;
    Matrix.ComposeToRef(
      new Vector3(s, s * (0.8 + rand() * 0.5), s),
      null as unknown as never,
      new Vector3(p.x, y - 0.05, p.z),
      dummy
    );
    // manual compose with Y rotation
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    // row-major 4x4: scale + rotY + translate
    const m = [
      cos * s, 0, -sin * s, 0,
      0, s, 0, 0,
      sin * s, 0, cos * s, 0,
      p.x, y - 0.05, p.z, 1,
    ];
    for (let k = 0; k < 16; k++) grassMat4s[gi * 16 + k] = m[k];
    gi++;
  }
  tuft.thinInstanceSetBuffer('matrix', grassMat4s.subarray(0, gi * 16), 16, true);
  tuft.isVisible = true;
  placedGrass = gi;
  void placedGrass;
  void dummy;
  void grassInstances;

  // ================= TREES (3 modeled variants) =================
  const trunkMat = new StandardMaterial('trunkMat', scene);
  trunkMat.diffuseColor = new Color3(0.35, 0.22, 0.12);
  trunkMat.specularColor = new Color3(0, 0, 0);
  const trunkWhiteMat = new StandardMaterial('trunkWhiteMat', scene);
  trunkWhiteMat.diffuseColor = new Color3(0.82, 0.8, 0.74);
  trunkWhiteMat.specularColor = new Color3(0, 0, 0);
  const pineMat = new StandardMaterial('pineMat', scene);
  pineMat.diffuseColor = new Color3(0.12, 0.35, 0.16);
  pineMat.specularColor = new Color3(0, 0, 0);
  pineMat.backFaceCulling = false;
  const oakMat = new StandardMaterial('oakMat', scene);
  oakMat.diffuseColor = new Color3(0.22, 0.48, 0.2);
  oakMat.specularColor = new Color3(0, 0, 0);
  const birchLeafMat = new StandardMaterial('birchLeafMat', scene);
  birchLeafMat.diffuseColor = new Color3(0.45, 0.66, 0.28);
  birchLeafMat.specularColor = new Color3(0, 0, 0);

  function pineMaster(): { trunk: Mesh; leaves: Mesh } {
    const trunk = MeshBuilder.CreateCylinder('pineTrunk', { height: 3.2, diameterTop: 0.45, diameterBottom: 0.7, tessellation: 7 }, scene);
    trunk.position.y = 1.6;
    const c1 = MeshBuilder.CreateCylinder('pc1', { height: 2.6, diameterTop: 0, diameterBottom: 3.2, tessellation: 8 }, scene);
    c1.position.y = 3.6;
    const c2 = MeshBuilder.CreateCylinder('pc2', { height: 2.2, diameterTop: 0, diameterBottom: 2.5, tessellation: 8 }, scene);
    c2.position.y = 5.0;
    const c3 = MeshBuilder.CreateCylinder('pc3', { height: 1.8, diameterTop: 0, diameterBottom: 1.7, tessellation: 8 }, scene);
    c3.position.y = 6.2;
    const leaves = Mesh.MergeMeshes([c1, c2, c3], true, false, undefined, false, true)!;
    c1.dispose(); c2.dispose(); c3.dispose();
    trunk.material = trunkMat;
    leaves.material = pineMat;
    return { trunk, leaves };
  }
  function oakMaster(): { trunk: Mesh; leaves: Mesh } {
    const trunk = MeshBuilder.CreateCylinder('oakTrunk', { height: 3.6, diameterTop: 0.5, diameterBottom: 0.85, tessellation: 7 }, scene);
    trunk.position.y = 1.8;
    const s1 = MeshBuilder.CreateSphere('os1', { diameter: 3.6, segments: 7 }, scene);
    s1.position.y = 4.6; s1.scaling.set(1.15, 0.9, 1.15);
    const s2 = MeshBuilder.CreateSphere('os2', { diameter: 2.6, segments: 7 }, scene);
    s2.position.y = 5.8; s2.position.x = 0.9;
    jitterSphere(s1, 0.5, rand);
    jitterSphere(s2, 0.4, rand);
    const leaves = Mesh.MergeMeshes([s1, s2], true, false, undefined, false, true)!;
    s1.dispose(); s2.dispose();
    trunk.material = trunkMat;
    leaves.material = oakMat;
    return { trunk, leaves };
  }
  function birchMaster(): { trunk: Mesh; leaves: Mesh } {
    const trunk = MeshBuilder.CreateCylinder('birchTrunk', { height: 4.2, diameterTop: 0.35, diameterBottom: 0.5, tessellation: 7 }, scene);
    trunk.position.y = 2.1;
    const s = MeshBuilder.CreateSphere('bs', { diameter: 3.0, segments: 7 }, scene);
    s.position.y = 5.2; s.scaling.set(1, 1.15, 1);
    jitterSphere(s, 0.35, rand);
    trunk.material = trunkWhiteMat;
    s.material = birchLeafMat;
    return { trunk, leaves: s };
  }

  const treeTypes = [pineMaster(), oakMaster(), birchMaster()];
  for (const t of treeTypes) {
    t.trunk.isVisible = false;
    t.leaves.isVisible = false;
  }
  const treePts = scatterPoint(quality.treeCount, rand, 25, 190);
  const perType: { x: number; z: number; y: number; s: number; r: number }[][] = [[], [], []];
  for (const p of treePts) {
    const y = terrainHeight(p.x, p.z);
    if (y < WATER_LEVEL + 0.6 || y > 14) continue;
    // keep clearing at spawn
    if (Math.hypot(p.x, p.z) < 14) continue;
    perType[Math.floor(rand() * 3)].push({ x: p.x, z: p.z, y, s: 0.8 + rand() * 0.8, r: rand() * Math.PI * 2 });
  }
  treeTypes.forEach((t, ti) => {
    const list = perType[ti];
    if (list.length === 0) return;
    const trunkM = new Float32Array(list.length * 16);
    const leafM = new Float32Array(list.length * 16);
    list.forEach((it, i) => {
      const cos = Math.cos(it.r);
      const sin = Math.sin(it.r);
      const m = [cos * it.s, 0, -sin * it.s, 0, 0, it.s, 0, 0, sin * it.s, 0, cos * it.s, 0, it.x, it.y - 0.1, it.z, 1];
      for (let k = 0; k < 16; k++) { trunkM[i * 16 + k] = m[k]; leafM[i * 16 + k] = m[k]; }
      colliders.push({ x: it.x, z: it.z, r: 0.9 * it.s });
    });
    t.trunk.thinInstanceSetBuffer('matrix', trunkM, 16, true);
    t.leaves.thinInstanceSetBuffer('matrix', leafM, 16, true);
    t.trunk.isVisible = true;
    t.leaves.isVisible = true;
    addShadowCaster(t.trunk);
    addShadowCaster(t.leaves);
  });

  // ================= BUSHES (modeled squashed jittered spheres) =================
  const bushMatA = new StandardMaterial('bushA', scene);
  bushMatA.diffuseColor = new Color3(0.2, 0.45, 0.18);
  bushMatA.specularColor = new Color3(0, 0, 0);
  const bushMatB = new StandardMaterial('bushB', scene);
  bushMatB.diffuseColor = new Color3(0.32, 0.52, 0.22);
  bushMatB.specularColor = new Color3(0, 0, 0);
  const bushMasterA = MeshBuilder.CreateSphere('bushA', { diameter: 1.6, segments: 7 }, scene);
  bushMasterA.scaling.y = 0.7;
  jitterSphere(bushMasterA, 0.35, rand);
  bushMasterA.material = bushMatA;
  bushMasterA.isVisible = false;
  const bushMasterB = MeshBuilder.CreateSphere('bushB', { diameter: 1.3, segments: 7 }, scene);
  bushMasterB.scaling.y = 0.75;
  jitterSphere(bushMasterB, 0.3, rand);
  bushMasterB.material = bushMatB;
  bushMasterB.isVisible = false;

  const bushPts = scatterPoint(quality.bushCount, rand, 10, 185);
  const bushAList: number[][] = [];
  const bushBList: number[][] = [];
  for (const p of bushPts) {
    const y = terrainHeight(p.x, p.z);
    if (y < WATER_LEVEL + 0.4 || y > 14) continue;
    if (Math.hypot(p.x, p.z) < 8) continue;
    const s = 0.7 + rand() * 1.3;
    const r = rand() * Math.PI * 2;
    const m = [Math.cos(r) * s, 0, -Math.sin(r) * s, 0, 0, s * 0.8, 0, 0, Math.sin(r) * s, 0, Math.cos(r) * s, 0, p.x, y + 0.3 * s, p.z, 1];
    (rand() > 0.5 ? bushAList : bushBList).push(m);
    if (s > 1.1) colliders.push({ x: p.x, z: p.z, r: 0.8 * s });
  }
  function setThin(mesh: Mesh, list: number[][]): void {
    if (list.length === 0) return;
    const buf = new Float32Array(list.length * 16);
    list.forEach((m, i) => { for (let k = 0; k < 16; k++) buf[i * 16 + k] = m[k]; });
    mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
    mesh.isVisible = true;
    addShadowCaster(mesh);
  }
  setThin(bushMasterA, bushAList);
  setThin(bushMasterB, bushBList);

  // ================= ROCKS (modeled faceted boulders) =================
  const rockMat = new StandardMaterial('rockMat', scene);
  rockMat.diffuseColor = new Color3(0.5, 0.5, 0.52);
  rockMat.specularColor = new Color3(0.05, 0.05, 0.05);
  const rockMaster = MeshBuilder.CreateSphere('rock', { diameter: 1.6, segments: 5 }, scene);
  jitterSphere(rockMaster, 0.7, rand);
  rockMaster.material = rockMat;
  rockMaster.isVisible = false;
  const rockPts = scatterPoint(quality.rockCount, rand, 12, 200);
  const rockList: number[][] = [];
  for (const p of rockPts) {
    const y = terrainHeight(p.x, p.z);
    if (y < WATER_LEVEL - 0.5) continue;
    const s = 0.5 + rand() * 1.8;
    const r = rand() * Math.PI * 2;
    const sy = s * (0.5 + rand() * 0.5);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    rockList.push([cos * s, 0, -sin * s, 0, 0, sy, 0, 0, sin * s, 0, cos * s, 0, p.x, y + 0.1, p.z, 1]);
    if (s > 1) colliders.push({ x: p.x, z: p.z, r: 0.9 * s });
  }
  setThin(rockMaster, rockList);

  // ================= FLOWERS (modeled stem + blossom, 3 colors) =================
  const stemMat = new StandardMaterial('stemMat', scene);
  stemMat.diffuseColor = new Color3(0.2, 0.45, 0.18);
  stemMat.specularColor = new Color3(0, 0, 0);
  const blossomColors = [new Color3(0.95, 0.25, 0.3), new Color3(0.98, 0.8, 0.2), new Color3(0.95, 0.95, 0.95)];
  const flowerPts = scatterPoint(quality.flowerCount, rand, 6, 150);
  const validFlowers = flowerPts.filter((p) => {
    const y = terrainHeight(p.x, p.z);
    return y > WATER_LEVEL + 0.4 && y < 11;
  });
  const stemMaster = MeshBuilder.CreateCylinder('stem', { height: 0.55, diameter: 0.05, tessellation: 5 }, scene);
  stemMaster.position.y = 0.27;
  stemMaster.material = stemMat;
  stemMaster.isVisible = false;
  const headMaster = MeshBuilder.CreateSphere('head', { diameter: 0.22, segments: 6 }, scene);
  headMaster.position.y = 0.6;
  headMaster.isVisible = false;
  // split flowers across 3 blossom materials
  const buckets: { x: number; z: number; y: number }[][] = [[], [], []];
  validFlowers.forEach((p, i) => buckets[i % 3].push({ ...p, y: terrainHeight(p.x, p.z) }));
  const stemBuf = new Float32Array(validFlowers.length * 16);
  validFlowers.forEach((p, i) => {
    const y = terrainHeight(p.x, p.z);
    const s = 0.8 + rand() * 0.7;
    stemBuf.set([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, p.x, y, p.z, 1], i * 16);
  });
  stemMaster.thinInstanceSetBuffer('matrix', stemBuf, 16, true);
  stemMaster.isVisible = true;
  buckets.forEach((list, bi) => {
    if (list.length === 0) return;
    const head = headMaster.clone(`head${bi}`)!;
    const m = new StandardMaterial(`blossom${bi}`, scene);
    m.diffuseColor = blossomColors[bi];
    m.emissiveColor = blossomColors[bi].scale(0.35);
    m.specularColor = new Color3(0, 0, 0);
    head.material = m;
    const buf = new Float32Array(list.length * 16);
    list.forEach((p, i) => {
      const s = 0.8 + rand() * 0.7;
      buf.set([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, p.x, p.y + 0.6 * s - 0.6, p.z, 1], i * 16);
    });
    // note: head master already offset at y=0.6; bake offset into matrix Y instead
    head.thinInstanceSetBuffer('matrix', buf, 16, true);
    head.isVisible = true;
  });
  headMaster.dispose();

  // ================= REEDS near water + MUSHROOMS in shade =================
  const reedMat = new StandardMaterial('reedMat', scene);
  reedMat.diffuseColor = new Color3(0.3, 0.5, 0.25);
  reedMat.specularColor = new Color3(0, 0, 0);
  const reedMaster = MeshBuilder.CreateCylinder('reed', { height: 1.6, diameterTop: 0.05, diameterBottom: 0.09, tessellation: 5 }, scene);
  reedMaster.position.y = 0.8;
  reedMaster.material = reedMat;
  reedMaster.isVisible = false;
  const reedList: number[][] = [];
  for (let i = 0; i < 220; i++) {
    const a = rand() * Math.PI * 2;
    const r = 30 + rand() * 18; // ring around central lake
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = terrainHeight(x, z);
    if (y < WATER_LEVEL - 0.6 || y > WATER_LEVEL + 0.9) continue;
    const s = 0.8 + rand() * 0.8;
    reedList.push([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, x, y, z, 1]);
  }
  setThin(reedMaster, reedList);

  const mushStemMat = new StandardMaterial('mushStem', scene);
  mushStemMat.diffuseColor = new Color3(0.9, 0.87, 0.8);
  const mushCapMat = new StandardMaterial('mushCap', scene);
  mushCapMat.diffuseColor = new Color3(0.8, 0.2, 0.15);
  mushCapMat.emissiveColor = new Color3(0.25, 0.03, 0.02);
  const mushStem = MeshBuilder.CreateCylinder('mushStemM', { height: 0.4, diameter: 0.18, tessellation: 6 }, scene);
  mushStem.position.y = 0.2;
  mushStem.material = mushStemMat;
  mushStem.isVisible = false;
  const mushCap = MeshBuilder.CreateSphere('mushCapM', { diameter: 0.5, segments: 8 }, scene);
  mushCap.position.y = 0.45; mushCap.scaling.y = 0.6;
  mushCap.material = mushCapMat;
  mushCap.isVisible = false;
  const mushPts = scatterPoint(90, rand, 20, 170);
  const mushS: number[][] = [];
  const mushC: number[][] = [];
  for (const p of mushPts) {
    const y = terrainHeight(p.x, p.z);
    if (y < WATER_LEVEL + 0.6 || y > 12) continue;
    const s = 0.7 + rand() * 1.4;
    mushS.push([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, p.x, y, p.z, 1]);
    mushC.push([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, p.x, y, p.z, 1]);
  }
  setThin(mushStem, mushS);
  setThin(mushCap, mushC);

  // ================= COLLECTIBLE ✦ SHARDS =================
  const coins: Mesh[] = [];
  const coinMat = new StandardMaterial('coinMat', scene);
  coinMat.emissiveColor = new Color3(1, 0.75, 0.2);
  coinMat.diffuseColor = new Color3(1, 0.8, 0.3);
  const ringMat = new StandardMaterial('ringMat', scene);
  ringMat.emissiveColor = new Color3(1, 0.85, 0.4);
  ringMat.alpha = 0.5;
  const coinPts = scatterPoint(24, rand, 15, 165);
  for (let i = 0; i < coinPts.length; i++) {
    const p = coinPts[i];
    let y = terrainHeight(p.x, p.z);
    if (y < WATER_LEVEL + 0.5) y = WATER_LEVEL + 1.2;
    const star = MeshBuilder.CreatePolyhedron('shard' + i, { type: 1, size: 0.55 }, scene); // octahedron
    star.position.set(p.x, y + 1.6, p.z);
    star.material = coinMat;
    star.isPickable = false;
    const ring = MeshBuilder.CreateTorus('ring' + i, { diameter: 1.6, thickness: 0.07, tessellation: 24 }, scene);
    ring.position.copyFrom(star.position);
    ring.material = ringMat;
    ring.isPickable = false;
    star.metadata = { ring, baseY: star.position.y, phase: rand() * Math.PI * 2 };
    coins.push(star);
  }

  // ================= BUTTERFLIES (2 flapping quads) =================
  const butterflyMat = new StandardMaterial('bflyMat', scene);
  butterflyMat.diffuseColor = new Color3(1, 0.6, 0.2);
  butterflyMat.emissiveColor = new Color3(0.5, 0.25, 0.05);
  butterflyMat.backFaceCulling = false;
  interface Fly { mesh: Mesh; cx: number; cz: number; cy: number; r: number; sp: number; ph: number }
  const flies: Fly[] = [];
  for (let i = 0; i < 14; i++) {
    const m = MeshBuilder.CreatePlane('bfly' + i, { size: 0.45 }, scene);
    m.material = butterflyMat;
    m.isPickable = false;
    const cx = (rand() - 0.5) * 160;
    const cz = (rand() - 0.5) * 160;
    flies.push({ mesh: m, cx, cz, cy: terrainHeight(cx, cz) + 2 + rand() * 2, r: 3 + rand() * 7, sp: 0.4 + rand() * 0.5, ph: rand() * 6 });
  }

  const windPlugins: WindPlugin[] = [];
  const windPlugin = grassMat.pluginManager?.getPlugin<WindPlugin>('Wind') ?? null;
  if (windPlugin) windPlugins.push(windPlugin);

  const update = (t: number, _playerPos: Vector3): void => {
    for (const w of windPlugins) w.setTime(t);
    for (const c of coins) {
      if (!c.isEnabled()) continue;
      const meta = c.metadata as { ring: Mesh; baseY: number; phase: number };
      c.rotation.y = t * 2 + meta.phase;
      c.position.y = meta.baseY + Math.sin(t * 2 + meta.phase) * 0.25;
      meta.ring.rotation.x = Math.PI / 2 + Math.sin(t + meta.phase) * 0.2;
      meta.ring.rotation.z = t * 0.6;
    }
    for (const f of flies) {
      const a = t * f.sp + f.ph;
      f.mesh.position.set(f.cx + Math.cos(a) * f.r, f.cy + Math.sin(t * 1.3 + f.ph) * 0.8, f.cz + Math.sin(a) * f.r);
      f.mesh.rotation.y = -a;
      f.mesh.scaling.x = 0.4 + Math.abs(Math.sin(t * 12 + f.ph)) * 0.8; // flap
    }
    void _playerPos;
  };

  return { update, coins, coinTaken: coins.map(() => false), colliders };
}
