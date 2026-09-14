import { MeshBuilder, Mesh, VertexData, Color4, StandardMaterial, VertexBuffer } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { fbm } from '../utils/noise';

export const WORLD_SIZE = 480;
export const WATER_LEVEL = 1.6;

export function terrainHeight(x: number, z: number): number {
  // Rolling hills + a central valley lake + rim mountains
  const base = fbm(x * 0.008 + 13.7, z * 0.008 + 7.3, 5) * 22 - 6;
  const detail = fbm(x * 0.045, z * 0.045, 3) * 2.2 - 1.1;
  const dist = Math.sqrt(x * x + z * z);
  const rim = Math.max(0, (dist - 170) / 70) ** 2 * 26; // mountains at edge
  const lakeDip = Math.max(0, 1 - dist / 55) * -7; // central lake basin
  return base + detail + rim + lakeDip;
}

export function groundColor(y: number, slope: number): [number, number, number] {
  // sand / grass / rock / snow by height + slope
  if (y < WATER_LEVEL + 0.5) return [0.76, 0.7, 0.5]; // sand
  if (slope > 0.55) return [0.45, 0.42, 0.4]; // cliff rock
  if (y > 16) return [0.9, 0.92, 0.95]; // snow
  if (y > 10) return [0.42, 0.5, 0.35]; // highland
  // meadow green with slight variation
  const t = Math.min(1, Math.max(0, (y - 2) / 8));
  return [0.24 + t * 0.12, 0.55 - t * 0.08, 0.22];
}

export function buildTerrain(scene: Scene): Mesh {
  const subdivs = 150;
  const ground = MeshBuilder.CreateGround(
    'terrain',
    { width: WORLD_SIZE, height: WORLD_SIZE, subdivisions: subdivs, updatable: false },
    scene
  );

  const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
  const colors = new Float32Array((positions.length / 3) * 4);

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const y = terrainHeight(x, z);
    positions[i + 1] = y;
  }
  ground.updateVerticesData(VertexBuffer.PositionKind, positions, false, false);

  // recompute normals then color per-vertex
  VertexData.ComputeNormals(positions, ground.getIndices()!, ground.getVerticesData(VertexBuffer.NormalKind)!);
  const normals = ground.getVerticesData(VertexBuffer.NormalKind)!;
  for (let i = 0, v = 0; i < positions.length; i += 3, v += 4) {
    const ny = normals[i + 1];
    const slope = 1 - ny;
    const y = positions[i + 1];
    const [r, g, b] = groundColor(y, slope);
    // subtle checker variation to break banding
    const jitter = ((i * 0.37) % 1) * 0.03;
    colors[v] = r + jitter;
    colors[v + 1] = g + jitter;
    colors[v + 2] = b;
    colors[v + 3] = 1;
  }
  ground.setVerticesData(VertexBuffer.ColorKind, colors as unknown as number[], false);

  const mat = new StandardMaterial('terrainMat', scene);
  mat.specularColor.set(0, 0, 0);
  mat.backFaceCulling = true;
  ground.material = mat;
  ground.receiveShadows = true;
  ground.checkCollisions = false;
  ground.isPickable = false;
  ground.freezeWorldMatrix();

  return ground;
}

export function scatterPoint(count: number, rand: () => number, minR = 8, maxR = 200): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = minR + Math.sqrt(rand()) * (maxR - minR);
    pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
  }
  return pts;
}
