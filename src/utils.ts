// Seeded RNG + value noise helpers shared by terrain & scattering.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise on integer lattice
function hash2(x: number, z: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 10000) / 10000;
}

function smooth(t: number) {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  const u = smooth(xf);
  const v = smooth(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; // 0..1
}

export function fbm(x: number, z: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // 0..1
}

/** Analytic terrain height — must match the displaced ground mesh. */
export function terrainHeight(x: number, z: number): number {
  const WORLD = 400;
  // Flatten near spawn so player doesn't spawn on a hill
  const distCenter = Math.hypot(x, z);
  const hills = (fbm(x * 0.012 + 7.3, z * 0.012 + 3.1, 4) - 0.5) * 22;
  const detail = (fbm(x * 0.06, z * 0.06, 2) - 0.5) * 2.2;
  // Rim mountains: use Chebyshev distance so corners don't spike to 100+ units
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rim = Math.max(0, (edge - 150) / 50) ** 2 * 18;
  // Pond depression at (40, -35)
  const pond = Math.hypot(x - 40, z + 35);
  const dip = -Math.max(0, 1 - pond / 26) * 4.5;
  const flat = Math.max(0, 1 - distCenter / 30); // blend to 0 near origin
  return (hills + detail + rim + dip) * (1 - flat * 0.92);
}

export function terrainColor(y: number, slope: number, rand: number): [number, number, number] {
  // grass -> dirt -> rock -> snow
  if (y > 20) return [0.92, 0.93, 0.95]; // snow caps on rim mountains
  if (slope > 0.55 || y > 13) return [0.45 + rand * 0.08, 0.4 + rand * 0.06, 0.36]; // rock
  if (slope > 0.35) return [0.5, 0.42 + rand * 0.08, 0.28]; // dirt cliffs
  if (y < -1.5) return [0.55, 0.5, 0.32]; // sandy pond bed
  const g = 0.32 + rand * 0.12;
  return [0.22 + rand * 0.08, g + 0.18, 0.18 + rand * 0.06]; // grass greens
}

// ================= Editable heightfield (mining / shaping) =================
// Analytic base height + a deformation grid. Everything gameplay-related must
// query groundHeight() (not terrainHeight()) so dug/filled ground stays in sync.

export const WORLD_SIZE = 400;
const DEFORM_CELL = 2; // world units per deform cell
const DEFORM_N = Math.ceil(WORLD_SIZE / DEFORM_CELL); // 200
const deformGrid = new Float32Array(DEFORM_N * DEFORM_N); // height offsets (+ = raised)
export const MAX_DIG_DEPTH = 9;
export const MAX_FILL_HEIGHT = 7;

/** Bilinear-sampled deformation offset at (x, z). */
export function deformOffset(x: number, z: number): number {
  const fx = (x + WORLD_SIZE / 2) / DEFORM_CELL - 0.5;
  const fz = (z + WORLD_SIZE / 2) / DEFORM_CELL - 0.5;
  const x0 = Math.max(0, Math.min(DEFORM_N - 2, Math.floor(fx)));
  const z0 = Math.max(0, Math.min(DEFORM_N - 2, Math.floor(fz)));
  const tx = Math.max(0, Math.min(1, fx - x0));
  const tz = Math.max(0, Math.min(1, fz - z0));
  const a = deformGrid[z0 * DEFORM_N + x0];
  const b = deformGrid[z0 * DEFORM_N + x0 + 1];
  const c = deformGrid[(z0 + 1) * DEFORM_N + x0];
  const d = deformGrid[(z0 + 1) * DEFORM_N + x0 + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

/** Live ground height = analytic base + player deformation. */
export function groundHeight(x: number, z: number): number {
  return terrainHeight(x, z) + deformOffset(x, z);
}

/** Depth dug below the original surface (0 = untouched or filled). */
export function dugDepth(x: number, z: number): number {
  return Math.max(0, -deformOffset(x, z));
}

function smoothFalloff(d: number, r: number): number {
  const t = Math.max(0, 1 - d / r);
  return t * t * (3 - 2 * t);
}

export interface ShapeResult {
  /** Approximate displaced volume (for resource yields). */
  volume: number;
  /** Deepest offset change applied. */
  maxDelta: number;
}

/**
 * Lower terrain in a radius (mining). Returns displaced volume.
 * Clamped so pits can't go deeper than MAX_DIG_DEPTH below the base surface.
 */
export function digTerrain(x: number, z: number, radius: number, depth: number): ShapeResult {
  let volume = 0;
  let maxDelta = 0;
  const cellR = Math.ceil(radius / DEFORM_CELL);
  const ccx = Math.floor((x + WORLD_SIZE / 2) / DEFORM_CELL);
  const ccz = Math.floor((z + WORLD_SIZE / 2) / DEFORM_CELL);
  for (let dz = -cellR; dz <= cellR; dz++) {
    for (let dx = -cellR; dx <= cellR; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (cx < 0 || cz < 0 || cx >= DEFORM_N || cz >= DEFORM_N) continue;
      const wx = (cx + 0.5) * DEFORM_CELL - WORLD_SIZE / 2;
      const wz = (cz + 0.5) * DEFORM_CELL - WORLD_SIZE / 2;
      const d = Math.hypot(wx - x, wz - z);
      if (d > radius) continue;
      const idx = cz * DEFORM_N + cx;
      const want = depth * smoothFalloff(d, radius);
      const minOff = -MAX_DIG_DEPTH;
      const applied = Math.max(minOff - deformGrid[idx], -want);
      if (applied < -1e-4) {
        deformGrid[idx] += applied;
        volume += -applied * DEFORM_CELL * DEFORM_CELL;
        maxDelta = Math.max(maxDelta, -applied);
      }
    }
  }
  return { volume, maxDelta };
}

/** Raise terrain in a radius (building with dirt/stone). */
export function fillTerrain(x: number, z: number, radius: number, height: number): ShapeResult {
  let volume = 0;
  let maxDelta = 0;
  const cellR = Math.ceil(radius / DEFORM_CELL);
  const ccx = Math.floor((x + WORLD_SIZE / 2) / DEFORM_CELL);
  const ccz = Math.floor((z + WORLD_SIZE / 2) / DEFORM_CELL);
  for (let dz = -cellR; dz <= cellR; dz++) {
    for (let dx = -cellR; dx <= cellR; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (cx < 0 || cz < 0 || cx >= DEFORM_N || cz >= DEFORM_N) continue;
      const wx = (cx + 0.5) * DEFORM_CELL - WORLD_SIZE / 2;
      const wz = (cz + 0.5) * DEFORM_CELL - WORLD_SIZE / 2;
      const d = Math.hypot(wx - x, wz - z);
      if (d > radius) continue;
      const idx = cz * DEFORM_N + cx;
      const want = height * smoothFalloff(d, radius);
      const applied = Math.min(MAX_FILL_HEIGHT - deformGrid[idx], want);
      if (applied > 1e-4) {
        deformGrid[idx] += applied;
        volume += applied * DEFORM_CELL * DEFORM_CELL;
        maxDelta = Math.max(maxDelta, applied);
      }
    }
  }
  return { volume, maxDelta };
}

// ================= Ore veins =================
export type OreType = 'copper' | 'iron' | 'gold';
export interface OreVein { x: number; z: number; r: number; type: OreType }

function buildVeins(): OreVein[] {
  const rng = mulberry32(0x0e57);
  const types: OreType[] = ['copper', 'iron', 'gold'];
  const veins: OreVein[] = [];
  for (let i = 0; i < 14; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const x = (rng() - 0.5) * 300;
      const z = (rng() - 0.5) * 300;
      if (Math.hypot(x, z) < 18) continue; // keep spawn clean
      if (Math.hypot(x - 40, z + 35) < 30) continue; // out of the pond
      if (terrainHeight(x, z) > 12) continue;
      veins.push({ x, z, r: 4 + rng() * 3, type: types[i % types.length] });
      break;
    }
  }
  return veins;
}

export const ORE_VEINS: OreVein[] = buildVeins();

/** Ore vein containing (x, z), if any. */
export function veinAt(x: number, z: number): OreVein | null {
  for (const v of ORE_VEINS) {
    if (Math.hypot(x - v.x, z - v.z) < v.r) return v;
  }
  return null;
}
