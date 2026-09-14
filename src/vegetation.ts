import {
  Scene, Mesh, Vector3, Color3, StandardMaterial, VertexData,
  MeshBuilder, Quaternion, Matrix, InstancedMesh, VertexBuffer
} from '@babylonjs/core';
import { CustomMaterial } from '@babylonjs/materials';
import { terrainHeight, mulberry32 } from './utils';

export function setWindTime(mat: CustomMaterial, t: number) {
  (mat as any)._newUniformInstances = (mat as any)._newUniformInstances || {};
  (mat as any)._newUniformInstances['float-time'] = t;
}

export interface VegRefs {
  update(t: number): void;
  setDensity(factor: number): void;
}

function windify(mat: CustomMaterial, strength = 0.14, freq = 2.2) {
  mat.AddUniform('time', 'float', 0.001);
  (mat as any)._newUniformInstances['float-time'] = 0;
  mat.Vertex_Definitions('varying float vWindH;\n');
  mat.Fragment_Definitions('varying float vWindH;\n');
  // NOTE: injected at CUSTOM_VERTEX_UPDATE_POSITION where the mutable var is "positionUpdated"
  // (the helper method only rewrites the first occurrence of "result", so use positionUpdated directly).
  mat.Vertex_Before_PositionUpdated(`
    #ifdef INSTANCES
      float phW = world3.x*0.35 + world3.z*0.41;
    #else
      float phW = 0.0;
    #endif
    float hW = clamp(position.y * 1.2, 0.0, 1.5);
    positionUpdated.x += sin(time*${freq} + phW) * ${strength} * hW;
    positionUpdated.z += cos(time*${(freq * 0.77).toFixed(2)} + phW*1.3) * ${(strength * 0.7).toFixed(3)} * hW;
    vWindH = hW;
  `);
  return mat;
}

/** Single bent grass shard: 5 verts, 3 tris, tapered to tip. */
function bladeVertexData(height: number, width: number, bend: number, lean: number): VertexData {
  const w0 = width / 2, w1 = width * 0.32, hw = height;
  // x: width axis, y: up, z: bend axis
  const positions = [
    -w0, 0, 0,
     w0, 0, 0,
    -w1, hw * 0.45, bend * 0.25 + lean * 0.2,
     w1, hw * 0.45, bend * 0.25 + lean * 0.2,
     0, hw, bend + lean * 0.4,
  ];
  const indices = [0, 1, 2, 2, 1, 3, 2, 3, 4];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const uvs = [0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1];
  // dark base -> light tip
  const colors = [0.25, 0.45, 0.2, 1, 0.25, 0.45, 0.2, 1, 0.4, 0.65, 0.3, 1, 0.4, 0.65, 0.3, 1, 0.62, 0.85, 0.4, 1];
  const vd = new VertexData();
  vd.positions = positions; vd.indices = indices; vd.normals = normals; vd.uvs = uvs; vd.colors = colors;
  return vd;
}

function mergeBlades(scene: Scene, blades: { vd: VertexData; rotY: number; offset: [number, number]; tilt: number }[]): Mesh | null {
  const transformed = blades.map((b) => {
    const m = Matrix.Compose(
      new Vector3(1, 1, 1),
      Quaternion.FromEulerAngles(b.tilt, b.rotY, 0),
      new Vector3(b.offset[0], 0, b.offset[1])
    );
    const vd = b.vd;
    vd.transform(m);
    return vd;
  });
  // manual merge
  let vOff = 0;
  const pos: number[] = [], norm: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (const vd of transformed) {
    pos.push(...(vd.positions as number[]));
    norm.push(...(vd.normals as number[]));
    uv.push(...(vd.uvs as number[]));
    col.push(...(vd.colors as number[]));
    for (const i of vd.indices as number[]) idx.push(i + vOff);
    vOff += (vd.positions as number[]).length / 3;
  }
  const out = new VertexData();
  out.positions = pos; out.normals = norm; out.uvs = uv; out.colors = col; out.indices = idx;
  const mesh = new Mesh('clump-part', scene);
  out.applyToMesh(mesh);
  return mesh;
}

export function buildVegetation(scene: Scene, colliders: { x: number; z: number; r: number }[], shadowGen: any, onProgress: (p: number, l: string) => void): VegRefs {
  const rng = mulberry32(20260914);
  const isMobile = /Android|iPhone|iPad|Mobi/i.test(navigator.userAgent);
  const windMats: CustomMaterial[] = [];
  const allInstances: InstancedMesh[] = [];

  const validSpot = (x: number, z: number) => {
    if (Math.abs(x) > 165 || Math.abs(z) > 165) return false;
    if (Math.hypot(x, z) < 4) return false; // spawn clearing
    if (Math.hypot(x - 40, z + 35) < 27) return false; // pond
    const y = terrainHeight(x, z);
    if (y > 17 || y < -2.5) return false;
    const e = 1.5;
    const slope = Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    if (slope > 0.75) return false;
    return true;
  };
  const pickSpot = (): [number, number, number] | null => {
    for (let i = 0; i < 24; i++) {
      const x = (rng() - 0.5) * 330;
      const z = (rng() - 0.5) * 330;
      if (validSpot(x, z)) return [x, terrainHeight(x, z), z];
    }
    return null;
  };

  // ================= GRASS SHARDS =================
  onProgress(0.45, 'Planting grass shards…');
  const grassMat = new CustomMaterial('grassMat', scene);
  grassMat.diffuseColor = new Color3(1, 1, 1);
  grassMat.specularColor = new Color3(0, 0, 0);
  grassMat.backFaceCulling = false;
  windify(grassMat, 0.16, 2.4);
  windMats.push(grassMat);

  const GRASS_CLUMPS = isMobile ? 900 : 1600;
  const clumpTemplates: Mesh[] = [];
  for (let v = 0; v < 3; v++) {
    const blades: { vd: VertexData; rotY: number; offset: [number, number]; tilt: number }[] = [];
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      blades.push({
        vd: bladeVertexData(0.55 + rng() * 0.65, 0.09 + rng() * 0.07, 0.08 + rng() * 0.16, (rng() - 0.5) * 0.25),
        rotY: (i / n) * Math.PI * 2 + rng() * 0.7,
        offset: [(rng() - 0.5) * 0.35, (rng() - 0.5) * 0.35],
        tilt: (rng() - 0.5) * 0.35,
      });
    }
    const merged = mergeBlades(scene, blades)!;
    merged.material = grassMat;
    merged.useVertexColors = true;
    merged.isPickable = false;
    merged.setEnabled(false);
    merged.doNotSyncBoundingInfo = false;
    clumpTemplates.push(merged);
  }
  const perTemplate = Math.floor(GRASS_CLUMPS / 3);
  const dummyGrass: InstancedMesh[] = [];
  for (let t = 0; t < 3; t++) {
    for (let i = 0; i < perTemplate; i++) {
      const s = pickSpot();
      if (!s) continue;
      const inst = clumpTemplates[t].createInstance(`grass${t}_${i}`) as InstancedMesh;
      const sc = 0.7 + rng() * 1.1;
      inst.position = new Vector3(s[0], s[1] - 0.02, s[2]);
      inst.rotation.y = rng() * Math.PI * 2;
      inst.scaling.setAll(sc);
      inst.isPickable = false;
      inst.doNotSyncBoundingInfo = true;
      dummyGrass.push(inst);
      allInstances.push(inst);
    }
  }

  // ================= TREES (modeled trunk + foliage) =================
  onProgress(0.62, 'Growing trees…');
  const trunkMat = new StandardMaterial('trunkMat', scene);
  trunkMat.diffuseColor = new Color3(0.4, 0.27, 0.16);
  trunkMat.specularColor = new Color3(0.05, 0.05, 0.05);

  const pineLeafMat = new CustomMaterial('pineLeafMat', scene);
  pineLeafMat.diffuseColor = new Color3(0.16, 0.42, 0.2);
  pineLeafMat.emissiveColor = new Color3(0.02, 0.06, 0.02);
  pineLeafMat.specularColor = new Color3(0.05, 0.05, 0.05);
  windify(pineLeafMat, 0.08, 1.4);
  windMats.push(pineLeafMat);

  const leafMat = new CustomMaterial('leafMat', scene);
  leafMat.diffuseColor = new Color3(0.25, 0.55, 0.22);
  leafMat.emissiveColor = new Color3(0.03, 0.07, 0.02);
  leafMat.specularColor = new Color3(0.08, 0.08, 0.08);
  windify(leafMat, 0.1, 1.6);
  windMats.push(leafMat);

  // Pine template
  const pineTrunk = MeshBuilder.CreateCylinder('pineTrunk', { height: 3.2, diameterTop: 0.45, diameterBottom: 0.7, tessellation: 6 }, scene);
  pineTrunk.material = trunkMat; pineTrunk.setEnabled(false);
  const pineF1 = MeshBuilder.CreateCylinder('pineF1', { height: 2.6, diameterTop: 0.4, diameterBottom: 3.0, tessellation: 7 }, scene);
  pineF1.position.y = 3.4; pineF1.material = pineLeafMat; pineF1.setEnabled(false);
  const pineF2 = MeshBuilder.CreateCylinder('pineF2', { height: 2.2, diameterTop: 0.3, diameterBottom: 2.3, tessellation: 7 }, scene);
  pineF2.position.y = 4.8; pineF2.material = pineLeafMat; pineF2.setEnabled(false);
  const pineF3 = MeshBuilder.CreateCylinder('pineF3', { height: 1.8, diameterTop: 0.15, diameterBottom: 1.5, tessellation: 7 }, scene);
  pineF3.position.y = 6.0; pineF3.material = pineLeafMat; pineF3.setEnabled(false);

  // Broadleaf template
  const oakTrunk = MeshBuilder.CreateCylinder('oakTrunk', { height: 2.6, diameterTop: 0.5, diameterBottom: 0.85, tessellation: 6 }, scene);
  oakTrunk.material = trunkMat; oakTrunk.setEnabled(false);
  const oakCrown = MeshBuilder.CreateIcoSphere('oakCrown', { radius: 2.4, subdivisions: 1, flat: true }, scene);
  // jitter crown verts for hand-modeled look
  {
    const p = oakCrown.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < p.length; i += 3) {
      const j = 1 + (rng() - 0.5) * 0.35;
      p[i] *= j; p[i + 1] *= j * 0.9; p[i + 2] *= j;
    }
    oakCrown.updateVerticesData(VertexBuffer.PositionKind, p);
    // NOTE: flat icosphere is non-indexed → do not recompute normals (getIndices/createNormals need indices)
    oakCrown.refreshBoundingInfo();
  }
  oakCrown.position.y = 4.1; oakCrown.material = leafMat; oakCrown.setEnabled(false);
  const oakCrown2 = MeshBuilder.CreateIcoSphere('oakCrown2', { radius: 1.6, subdivisions: 1, flat: true }, scene);
  oakCrown2.position.y = 5.6; oakCrown2.material = leafMat; oakCrown2.setEnabled(false);

  const TREE_COUNT = isMobile ? 90 : 150;
  for (let i = 0; i < TREE_COUNT; i++) {
    const s = pickSpot();
    if (!s) continue;
    const isPine = rng() > 0.45;
    const sc = 0.8 + rng() * 1.3;
    const rot = rng() * Math.PI * 2;
    const add = (base: Mesh, dy: number, sMul = 1) => {
      const inst = base.createInstance(`${base.name}_i${i}`) as InstancedMesh;
      inst.position = new Vector3(s[0], s[1] + dy * sc, s[2]);
      inst.rotation.y = rot;
      inst.scaling.setAll(sc * sMul);
      inst.isPickable = false;
      try { shadowGen.addShadowCaster(inst); } catch { /* noop */ }
      allInstances.push(inst);
    };
    if (isPine) {
      add(pineTrunk, 1.6); add(pineF1, 3.4); add(pineF2, 4.8); add(pineF3, 6.0);
    } else {
      add(oakTrunk, 1.3); add(oakCrown, 4.1); add(oakCrown2, 5.6);
    }
    if (sc > 0.9) colliders.push({ x: s[0], z: s[2], r: 0.9 * sc });
  }

  // ================= BUSHES =================
  onProgress(0.74, 'Planting bushes…');
  const bushMat = new CustomMaterial('bushMat', scene);
  bushMat.diffuseColor = new Color3(0.22, 0.5, 0.22);
  bushMat.emissiveColor = new Color3(0.02, 0.05, 0.02);
  bushMat.specularColor = new Color3(0.05, 0.05, 0.05);
  windify(bushMat, 0.05, 1.8);
  windMats.push(bushMat);

  const bushBase = MeshBuilder.CreateIcoSphere('bushBase', { radius: 1, subdivisions: 1, flat: true }, scene);
  {
    const p = bushBase.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < p.length; i += 3) {
      const j = 1 + (rng() - 0.5) * 0.5;
      p[i] *= j; p[i + 1] *= j * 0.7; p[i + 2] *= j;
    }
    bushBase.updateVerticesData(VertexBuffer.PositionKind, p);
    bushBase.refreshBoundingInfo();
  }
  bushBase.material = bushMat; bushBase.setEnabled(false);
  // shared berry template (one mesh reused for all bushes)
  const berryBase = MeshBuilder.CreateSphere('berryBase', { diameter: 0.22, segments: 6 }, scene);
  const berryMat = new StandardMaterial('berryMat', scene);
  berryMat.diffuseColor = new Color3(0.85, 0.2, 0.3);
  berryMat.emissiveColor = new Color3(0.4, 0.05, 0.08);
  berryBase.material = berryMat; berryBase.setEnabled(false);
  const BUSH_COUNT = isMobile ? 70 : 130;
  for (let i = 0; i < BUSH_COUNT; i++) {
    const s = pickSpot();
    if (!s) continue;
    const inst = bushBase.createInstance(`bush${i}`) as InstancedMesh;
    inst.position = new Vector3(s[0], s[1] + 0.35, s[2]);
    inst.scaling = new Vector3(0.8 + rng() * 1.4, 0.6 + rng() * 0.8, 0.8 + rng() * 1.4);
    inst.rotation.y = rng() * Math.PI * 2;
    inst.isPickable = false;
    try { shadowGen.addShadowCaster(inst); } catch { /* noop */ }
    allInstances.push(inst);
    // berry dots on some bushes
    if (rng() > 0.6) {
      for (let b = 0; b < 4; b++) {
        const bi = berryBase.createInstance(`berry${i}_${b}`) as InstancedMesh;
        bi.position = new Vector3(s[0] + (rng() - 0.5) * 1.4 * inst.scaling.x, s[1] + 0.5 + rng() * 0.7, s[2] + (rng() - 0.5) * 1.4 * inst.scaling.z);
        bi.isPickable = false;
      }
    }
  }

  // ================= ROCKS =================
  onProgress(0.82, 'Scattering rocks…');
  const rockMat = new StandardMaterial('rockMat', scene);
  rockMat.diffuseColor = new Color3(0.55, 0.55, 0.58);
  rockMat.specularColor = new Color3(0.1, 0.1, 0.1);
  const rockBase = MeshBuilder.CreateBox('rockBase', { size: 1 }, scene);
  {
    const p = rockBase.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < p.length; i += 3) {
      p[i] *= 1 + (rng() - 0.5) * 0.55;
      p[i + 1] *= 0.6 + (rng() - 0.5) * 0.4;
      p[i + 2] *= 1 + (rng() - 0.5) * 0.55;
    }
    rockBase.updateVerticesData(VertexBuffer.PositionKind, p);
    rockBase.refreshBoundingInfo();
    rockBase.createNormals(false);
    rockBase.refreshBoundingInfo();
  }
  rockBase.material = rockMat; rockBase.setEnabled(false);
  const ROCK_COUNT = isMobile ? 50 : 90;
  for (let i = 0; i < ROCK_COUNT; i++) {
    const s = pickSpot();
    if (!s) continue;
    const inst = rockBase.createInstance(`rock${i}`) as InstancedMesh;
    const sc = 0.4 + rng() * 1.8;
    inst.position = new Vector3(s[0], s[1] + 0.1 * sc, s[2]);
    inst.scaling = new Vector3(sc, sc * (0.55 + rng() * 0.5), sc);
    inst.rotation = new Vector3(rng() * 0.3, rng() * Math.PI * 2, rng() * 0.3);
    inst.isPickable = false;
    try { shadowGen.addShadowCaster(inst); } catch { /* noop */ }
    allInstances.push(inst);
    if (sc > 1) colliders.push({ x: s[0], z: s[2], r: sc * 0.8 });
  }

  // ================= FLOWERS + MUSHROOMS =================
  onProgress(0.9, 'Planting flowers…');
  const stemMat = new StandardMaterial('stemMat', scene);
  stemMat.diffuseColor = new Color3(0.2, 0.45, 0.2);
  stemMat.emissiveColor = new Color3(0.02, 0.06, 0.02);
  const stemBase = MeshBuilder.CreateCylinder('stemBase', { height: 0.5, diameterTop: 0.04, diameterBottom: 0.05, tessellation: 5 }, scene);
  stemBase.material = stemMat; stemBase.setEnabled(false);
  const petalColors = [new Color3(1, 0.35, 0.55), new Color3(1, 0.85, 0.25), new Color3(0.75, 0.4, 1), new Color3(1, 1, 1)];
  const headBases: Mesh[] = petalColors.map((c, k) => {
    const m = MeshBuilder.CreateSphere(`flowerHead${k}`, { diameter: 0.22, segments: 6 }, scene);
    const mm = new StandardMaterial(`flowerMat${k}`, scene);
    mm.diffuseColor = c; mm.emissiveColor = c.scale(0.45);
    m.material = mm; m.setEnabled(false);
    return m;
  });
  const FLOWERS = isMobile ? 160 : 320;
  for (let i = 0; i < FLOWERS; i++) {
    const s = pickSpot();
    if (!s) continue;
    const sc = 0.7 + rng() * 1.2;
    const si = stemBase.createInstance(`stem${i}`) as InstancedMesh;
    si.position = new Vector3(s[0], s[1] + 0.25 * sc, s[2]);
    si.scaling.setAll(sc);
    si.isPickable = false;
    const head = headBases[i % headBases.length].createInstance(`fhead${i}`) as InstancedMesh;
    head.position = new Vector3(s[0], s[1] + 0.55 * sc, s[2]);
    head.scaling.setAll(sc);
    head.isPickable = false;
  }

  // Mushrooms near trees
  const mushStemMat = new StandardMaterial('mushStem', scene);
  mushStemMat.diffuseColor = new Color3(0.92, 0.88, 0.78);
  const mushCapMat = new StandardMaterial('mushCap', scene);
  mushCapMat.diffuseColor = new Color3(0.85, 0.25, 0.2);
  mushCapMat.emissiveColor = new Color3(0.3, 0.05, 0.05);
  const mushStem = MeshBuilder.CreateCylinder('mushStemBase', { height: 0.4, diameterTop: 0.14, diameterBottom: 0.2, tessellation: 6 }, scene);
  mushStem.material = mushStemMat; mushStem.setEnabled(false);
  const mushCap = MeshBuilder.CreateSphere('mushCapBase', { diameter: 0.5, segments: 8 }, scene);
  mushCap.scaling.y = 0.6;
  mushCap.material = mushCapMat; mushCap.setEnabled(false);
  for (let i = 0; i < 40; i++) {
    const s = pickSpot();
    if (!s) continue;
    const sc = 0.6 + rng() * 1.6;
    const a = mushStem.createInstance(`ms${i}`) as InstancedMesh;
    a.position = new Vector3(s[0], s[1] + 0.2 * sc, s[2]);
    a.scaling.setAll(sc); a.isPickable = false;
    const b = mushCap.createInstance(`mc${i}`) as InstancedMesh;
    b.position = new Vector3(s[0], s[1] + 0.42 * sc, s[2]);
    b.scaling.setAll(sc); b.isPickable = false;
    try { shadowGen.addShadowCaster(b); } catch { /* noop */ }
  }

  onProgress(0.96, 'Waking wildlife…');

  function update(t: number) {
    for (const m of windMats) setWindTime(m, t);
  }
  function setDensity(factor: number) {
    // cheap LOD: hide a deterministic fraction of grass instances
    for (let n = 0; n < dummyGrass.length; n++) {
      const hash = ((n * 2654435761) >>> 0) % 1000 / 1000;
      dummyGrass[n].setEnabled(hash < factor || n % 5 === 0);
    }
  }

  return { update, setDensity };
}
