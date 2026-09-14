/* Headless logic test: build the full world with NullEngine and assert content. */
(globalThis as Record<string, unknown>).window = { devicePixelRatio: 1 };
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', hardwareConcurrency: 8 },
  configurable: true,
});

import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { buildTerrain, terrainHeight } from './src/world/terrain';
import { buildSky, buildWater } from './src/world/sky';
import { buildVegetation } from './src/world/vegetation';
import { defaultQuality } from './src/utils/quality';

const engine = new NullEngine();
const scene = new Scene(engine);

for (const mobile of [false, true]) {
  const q = defaultQuality(mobile);
  console.log(`--- quality=${q.level} grass=${q.grassCount} trees=${q.treeCount} ---`);
}

const q = defaultQuality(false);
q.grassCount = 7000;
buildTerrain(scene);
const sky = buildSky(scene, q);
buildWater(scene);
const casters: string[] = [];
const veg = buildVegetation(scene, q, (m) => casters.push(m.name));

const thinCounts = (name: string) => {
  const m = scene.getMeshByName(name);
  const buf = (m as unknown as { thinInstanceCount?: number })?.thinInstanceCount;
  return buf ?? -1;
};

console.log('meshes:', scene.meshes.length);
console.log('grassTuft instances:', thinCounts('grassTuft'));
console.log('coins:', veg.coins.length, 'taken:', veg.coinTaken.length);
console.log('colliders:', veg.colliders.length);
console.log('shadow casters:', casters.length, '| shadows on:', !!sky.shadows);

// every tree/rock/bush master should have instances
for (const n of ['pineTrunk', 'oakTrunk', 'birchTrunk', 'bushA', 'bushB', 'rock', 'reed', 'stem']) {
  console.log(`${n}: instances=${thinCounts(n)}`);
}

// coins float above ground
let bad = 0;
for (const c of veg.coins) {
  const g = terrainHeight(c.position.x, c.position.z);
  if (c.position.y < g) { bad++; }
}
console.log('coins below ground:', bad);

// player spawn ground check
const sy = terrainHeight(0, 85);
console.log('spawn height:', sy.toFixed(2), sy > 1.6 + 0.3 ? 'OK (dry)' : 'WET!');

// simulate 5s of updates (coins spin, butterflies, wind time)
veg.update(0.016, undefined as never);
for (let i = 0; i < 300; i++) veg.update(i * 0.016, undefined as never);
console.log('update loop OK');

const assert = (cond: boolean, msg: string) => {
  if (!cond) { console.error('ASSERT FAIL:', msg); process.exit(1); }
};
assert(veg.coins.length === 24, 'expected 24 coins');
assert(thinCounts('grassTuft') > 2000, 'expected thousands of grass instances');
assert(veg.colliders.length > 50, 'expected tree/rock colliders');
assert(bad === 0, 'coins must float above ground');
assert(sy > 1.9, 'spawn must be dry land');
console.log('ALL ASSERTS PASSED');
process.exit(0);
