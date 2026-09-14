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
  const rim = Math.max(0, (distCenter - 150) / 50) ** 2 * 18; // mountains at edge
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
