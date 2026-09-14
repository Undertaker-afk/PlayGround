// Mining + shaping: raycast dig/fill on the deformable heightfield,
// surface ore nodes, tree chopping, dust bursts, desktop + mobile input.

import {
  Scene, Vector3, Mesh, MeshBuilder, StandardMaterial, Color3,
  ParticleSystem, DynamicTexture, Color4
} from '@babylonjs/core';
import {
  digTerrain, fillTerrain, groundHeight, dugDepth, veinAt,
  ORE_VEINS, OreType
} from './utils';
import type { WorldRefs } from './world';
import type { VegRefs } from './vegetation';
import type { InventoryRefs, ItemId } from './inventory';

const ORE_STYLE: Record<OreType, { diffuse: Color3; emissive: Color3 }> = {
  copper: { diffuse: new Color3(0.85, 0.45, 0.2), emissive: new Color3(0.5, 0.2, 0.05) },
  iron: { diffuse: new Color3(0.5, 0.6, 0.75), emissive: new Color3(0.2, 0.28, 0.35) },
  gold: { diffuse: new Color3(1, 0.85, 0.3), emissive: new Color3(0.6, 0.45, 0.1) },
};

interface OreNode {
  root: Mesh;
  parts: Mesh[];
  x: number; z: number;
  hp: number; alive: boolean;
  type: OreType;
}

export interface MiningRefs {
  update(dt: number): void;
}

const DIG_RADIUS = 2.8;
const DIG_DEPTH = 1.15;
const FILL_RADIUS = 2.6;
const FILL_HEIGHT = 0.95;
const REACH = 16;
const COOLDOWN = 0.3;

export function buildMining(scene: Scene, world: WorldRefs, veg: VegRefs, inv: InventoryRefs): MiningRefs {
  const canvas = scene.getEngine().getRenderingCanvas()!;
  let cooldown = 0;

  // ---------- Ore surface nodes (one per vein, capped) ----------
  const nodes: OreNode[] = [];
  // Invisible-but-pickable hit proxy shared by all nodes (fat-finger friendly)
  const hitMat = new StandardMaterial('oreHitMat', scene);
  hitMat.alpha = 0;
  hitMat.disableLighting = true;
  hitMat.disableDepthWrite = true;
  for (const vein of ORE_VEINS.slice(0, 12)) {
    const gy = groundHeight(vein.x, vein.z);
    const root = new Mesh(`oreRoot_${vein.type}_${nodes.length}`, scene);
    root.position = new Vector3(vein.x, gy, vein.z);
    const style = ORE_STYLE[vein.type];
    const rockMat = new StandardMaterial(`oreRock${nodes.length}`, scene);
    rockMat.diffuseColor = new Color3(0.45, 0.43, 0.4);
    rockMat.specularColor = new Color3(0.08, 0.08, 0.08);
    const rock = MeshBuilder.CreateIcoSphere(`oreBase${nodes.length}`, { radius: 0.9, subdivisions: 1, flat: true }, scene);
    rock.scaling.y = 0.6;
    rock.material = rockMat;
    rock.parent = root;
    rock.isPickable = true;
    rock.metadata = { orePart: true };
    const cryMat = new StandardMaterial(`oreCry${nodes.length}`, scene);
    cryMat.diffuseColor = style.diffuse;
    cryMat.emissiveColor = style.emissive;
    const parts: Mesh[] = [rock];
    for (let k = 0; k < 3; k++) {
      const cry = MeshBuilder.CreateIcoSphere(`oreCry${nodes.length}_${k}`, { radius: 0.32, subdivisions: 0, flat: true }, scene);
      cry.scaling.y = 2.1;
      cry.position = new Vector3((k - 1) * 0.45, 0.55, (k % 2) * 0.35 - 0.15);
      cry.rotation.z = (k - 1) * 0.25;
      cry.material = cryMat;
      cry.parent = root;
      cry.isPickable = true;
      cry.metadata = { orePart: true };
      parts.push(cry);
    }
    root.metadata = { oreNode: true };
    root.isPickable = false; // root has no geometry; children carry the hitbox
    // generous invisible hit sphere so nodes are tappable on mobile
    const proxy = MeshBuilder.CreateSphere(`oreHit${nodes.length}`, { diameter: 2.6, segments: 6 }, scene);
    proxy.position.y = 0.7;
    proxy.material = hitMat;
    proxy.parent = root;
    proxy.isPickable = true;
    proxy.metadata = { orePart: true };
    parts.push(proxy);
    const node: OreNode = { root, parts, x: vein.x, z: vein.z, hp: 3, alive: true, type: vein.type };
    for (const part of parts) part.metadata.oreHost = node;
    try { world.shadowGen.addShadowCaster(rock); } catch { /* noop */ }
    nodes.push(node);
  }

  // ---------- Dust burst particles (procedural soft dot) ----------
  const dustTex = new DynamicTexture('dustTex', { width: 32, height: 32 }, scene, true);
  {
    const ctx = dustTex.getContext();
    const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    dustTex.update();
    dustTex.hasAlpha = true;
  }
  const dust = new ParticleSystem('digDust', 300, scene);
  dust.particleTexture = dustTex;
  dust.minSize = 0.4; dust.maxSize = 1.1;
  dust.minLifeTime = 0.4; dust.maxLifeTime = 0.9;
  dust.emitRate = 0;
  dust.manualEmitCount = 0;
  dust.direction1 = new Vector3(-2, 3, -2);
  dust.direction2 = new Vector3(2, 6, 2);
  dust.minEmitPower = 2; dust.maxEmitPower = 5;
  dust.color1 = new Color4(0.55, 0.42, 0.28, 0.9);
  dust.color2 = new Color4(0.4, 0.3, 0.2, 0);
  dust.gravity = new Vector3(0, -9, 0);
  dust.start();

  function burst(p: Vector3, ore: boolean): void {
    dust.emitter = p.clone();
    dust.color1 = ore ? new Color4(1, 0.8, 0.35, 0.95) : new Color4(0.55, 0.42, 0.28, 0.9);
    dust.manualEmitCount = ore ? 22 : 14;
  }

  function yieldForDig(x: number, z: number, volume: number): void {
    if (volume < 0.5) { inv.toast('⛏ Too deep — bedrock!'); return; }
    const vein = veinAt(x, z);
    const n = Math.max(1, Math.min(3, Math.round(volume / 7)));
    if (vein && Math.random() < 0.75) {
      inv.add(vein.type as ItemId, n);
      inv.toast(`⛏ +${n} ${vein.type}`);
    } else if (dugDepth(x, z) > 2) {
      inv.add('stone', n);
      inv.toast(`⛏ +${n} stone`);
    } else {
      inv.add('dirt', n);
      inv.toast(`⛏ +${n} dirt`);
    }
  }

  function digAt(x: number, z: number): void {
    if (Math.abs(x) > 185 || Math.abs(z) > 185) { inv.toast('⛏ World edge — undiggable'); return; }
    const res = digTerrain(x, z, DIG_RADIUS, DIG_DEPTH);
    world.refreshTerrainArea(x, z, DIG_RADIUS + 2);
    burst(new Vector3(x, groundHeight(x, z) + 0.5, z), false);
    yieldForDig(x, z, res.volume);
  }

  function fillAt(x: number, z: number): void {
    const sel = inv.selectedPlaceable();
    if (!sel) { inv.toast('🧱 Select dirt/stone in the hotbar (1/2)'); return; }
    if (!inv.remove(sel, 1)) { inv.toast(`🧱 Out of ${sel}! Mine more.`); return; }
    fillTerrain(x, z, FILL_RADIUS, FILL_HEIGHT);
    world.refreshTerrainArea(x, z, FILL_RADIUS + 2);
    burst(new Vector3(x, groundHeight(x, z) + 0.5, z), false);
  }

  function hitOreNode(node: OreNode): void {
    node.hp -= 1;
    node.root.scaling.setAll(Math.max(0.6, node.hp / 3));
    burst(node.root.position.add(new Vector3(0, 1, 0)), true);
    if (node.hp <= 0) {
      node.alive = false;
      node.root.setEnabled(false);
      inv.add(node.type as ItemId, 3);
      inv.toast(`💎 Vein depleted! +3 ${node.type}`);
      const res = digTerrain(node.x, node.z, 2.2, 1.4);
      world.refreshTerrainArea(node.x, node.z, 4.5);
      void res;
    } else {
      inv.add(node.type as ItemId, 1);
      inv.toast(`💎 +1 ${node.type}`);
    }
  }

  function actAtScreenPoint(sx: number, sy: number): boolean {
    if (cooldown > 0) { lastAct = { ok: false, kind: 'cooldown' }; return false; }
    // scene.pick wants render pixels; pointer events arrive in CSS pixels
    const eng0 = scene.getEngine();
    const kx = eng0.getRenderWidth() / Math.max(1, canvas.clientWidth);
    const ky = eng0.getRenderHeight() / Math.max(1, canvas.clientHeight);
    const pick = scene.pick(sx * kx, sy * ky, (m) => m.metadata?.orePart === true || m.metadata?.isGround === true);
    if (!pick?.hit || !pick.pickedPoint) { lastAct = { ok: false, kind: 'miss' }; return false; }
    const p = pick.pickedPoint;
    const oreHost: OreNode | undefined = pick.pickedMesh?.metadata?.oreHost;
    if (oreHost && oreHost.alive) {
      if (Vector3.Distance(p, scene.activeCamera!.position) > REACH + 4) { inv.toast('⛏ Too far away'); lastAct = { ok: false, kind: 'far' }; return false; }
      cooldown = COOLDOWN;
      hitOreNode(oreHost);
      lastAct = { ok: true, kind: 'ore', x: p.x, z: p.z };
      return true;
    }
    if (Vector3.Distance(p, scene.activeCamera!.position) > REACH) { inv.toast('⛏ Too far away'); lastAct = { ok: false, kind: 'far' }; return false; }
    cooldown = COOLDOWN;
    // Chop trees in priority when clicking near a trunk
    const chop = veg.chopTreeAt(p.x, p.z, 3.2);
    if (chop.wood > 0) {
      inv.add('wood', chop.wood);
      inv.toast(chop.felled ? `🪵 Tree felled! +${chop.wood} wood` : `🪓 +${chop.wood} wood`);
      lastAct = { ok: true, kind: 'chop', x: p.x, z: p.z };
      return true;
    }
    if (inv.mode === 'build') { fillAt(p.x, p.z); lastAct = { ok: true, kind: 'fill', x: p.x, z: p.z }; }
    else { digAt(p.x, p.z); lastAct = { ok: true, kind: 'dig', x: p.x, z: p.z }; }
    return true;
  }

  function actAtCrosshair(): boolean {
    return actAtScreenPoint(canvas.clientWidth / 2, canvas.clientHeight / 2);
  }
  (window as any).__mineAtCrosshair = actAtCrosshair;

  // ---------- Input: tap/click = act, drag = look (handled by player) ----------
  let downX = 0, downY = 0, downT = 0, downId: number | null = null;
  let moved = false;
  let repeatTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatActive = false;

  canvas.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest?.('#joystick,#mobile-actions,#hud,#hotbar,#inv-panel,#toasts')) return;
    downX = e.clientX; downY = e.clientY; downT = performance.now();
    downId = e.pointerId; moved = false;
    // hold-to-mine: if the pointer stays put, start repeating
    if (repeatTimer) clearTimeout(repeatTimer);
    repeatTimer = setTimeout(() => {
      if (downId === e.pointerId && !moved) {
        repeatActive = true;
        actAtScreenPoint(downX, downY);
      }
    }, 260);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (downId !== e.pointerId) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 10) {
      moved = true;
      if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
      repeatActive = false;
    } else if (repeatActive) {
      downX = e.clientX; downY = e.clientY;
      actAtScreenPoint(downX, downY);
    }
  });
  const endPointer = (e: PointerEvent) => {
    if (downId !== e.pointerId) return;
    if (repeatTimer) { clearTimeout(repeatTimer); repeatTimer = null; }
    const quick = performance.now() - downT < 450;
    if (!moved && quick && !repeatActive) actAtScreenPoint(e.clientX, e.clientY);
    downId = null;
    repeatActive = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  // ---------- Mobile Mine button (hold to keep digging at crosshair) ----------
  let mineHeld = false;
  let mineTimer: ReturnType<typeof setInterval> | null = null;
  const mineBtn = document.getElementById('btn-mine');
  const startHold = (e: Event) => {
    e.preventDefault();
    if (mineHeld) return;
    mineHeld = true;
    actAtCrosshair();
    if (mineTimer) clearInterval(mineTimer);
    mineTimer = setInterval(() => { if (mineHeld) actAtCrosshair(); }, 420);
  };
  const endHold = () => {
    mineHeld = false;
    if (mineTimer) { clearInterval(mineTimer); mineTimer = null; }
  };
  mineBtn?.addEventListener('touchstart', startHold, { passive: false });
  mineBtn?.addEventListener('touchend', endHold);
  mineBtn?.addEventListener('touchcancel', endHold);
  mineBtn?.addEventListener('mousedown', startHold);
  mineBtn?.addEventListener('mouseup', endHold);
  mineBtn?.addEventListener('mouseleave', endHold);

  // Keep node crystals slowly rotating for a glinting-ore look
  function update(dt: number): void {
    cooldown = Math.max(0, cooldown - dt);
    const t = performance.now() / 1000;
    for (const n of nodes) {
      if (!n.alive) continue;
      n.root.rotation.y = t * 0.4;
    }
  }

  interface LastAct { ok: boolean; kind: string; x?: number; z?: number }
  let lastAct: LastAct = { ok: false, kind: 'none' };
  (window as any).__lastMineAct = () => lastAct;

  return { update };
}
