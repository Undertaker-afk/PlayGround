import {
  Scene, Vector3, MeshBuilder, StandardMaterial, Color3,
  UniversalCamera, Mesh, Quaternion
} from '@babylonjs/core';
import { terrainHeight } from './utils';

export interface InputState {
  fwd: number; strafe: number; sprint: boolean; jump: boolean;
}

export interface PlayerRefs {
  update(dt: number): void;
  camera: UniversalCamera;
  position: Vector3;
  setThirdPerson(v: boolean): void;
  isThirdPerson(): boolean;
}

export function buildPlayer(scene: Scene, colliders: { x: number; z: number; r: number }[], shadowGen: any): PlayerRefs {
  const canvas = scene.getEngine().getRenderingCanvas()!;
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (isTouch) document.body.classList.add('touch');

  // ---------- Avatar (capsule body + head + eyes + backpack) ----------
  const avatar = new Mesh('player', scene);
  const bodyMat = new StandardMaterial('pBody', scene);
  bodyMat.diffuseColor = new Color3(0.2, 0.5, 0.95);
  bodyMat.emissiveColor = new Color3(0.05, 0.12, 0.3);
  const body = MeshBuilder.CreateCapsule('pCapsule', { radius: 0.42, height: 1.5 }, scene);
  body.position.y = 0.95; body.material = bodyMat; body.parent = avatar;
  const headMat = new StandardMaterial('pHead', scene);
  headMat.diffuseColor = new Color3(1, 0.82, 0.66);
  const head = MeshBuilder.CreateSphere('pHeadM', { diameter: 0.62, segments: 12 }, scene);
  head.position.y = 1.95; head.material = headMat; head.parent = avatar;
  const eyeMat = new StandardMaterial('pEye', scene);
  eyeMat.diffuseColor = new Color3(0.08, 0.08, 0.1);
  for (const sx of [-0.13, 0.13]) {
    const eye = MeshBuilder.CreateSphere('eye', { diameter: 0.1, segments: 6 }, scene);
    eye.position = new Vector3(sx, 1.98, 0.27); eye.material = eyeMat; eye.parent = avatar;
  }
  const packMat = new StandardMaterial('pPack', scene);
  packMat.diffuseColor = new Color3(0.95, 0.55, 0.2);
  const pack = MeshBuilder.CreateBox('pack', { size: 0.45 }, scene);
  pack.position = new Vector3(0, 1.25, -0.45); pack.material = packMat; pack.parent = avatar;
  try { shadowGen.addShadowCaster(body); shadowGen.addShadowCaster(head); } catch { /* noop */ }

  // ---------- Camera rig ----------
  const camera = new UniversalCamera('playerCam', new Vector3(0, 4, -8), scene);
  camera.minZ = 0.2; camera.maxZ = 1200;
  camera.inputs.clear(); // we drive it manually
  scene.activeCamera = camera;

  let yaw = Math.PI; // face +z
  let pitch = 0.32;
  let dist = 8;
  let thirdPerson = true;

  const pos = new Vector3(0, terrainHeight(0, 0), 0);
  let vy = 0;
  let grounded = true;
  let faceAngle = 0;
  let bobT = 0;

  // ---------- Keyboard ----------
  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  // ---------- Pointer look (drag) + pinch zoom ----------
  let dragging = false, lastX = 0, lastY = 0;
  let pinchD = 0;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => {
    // ignore presses starting on UI / joystick
    if ((e.target as HTMLElement).closest?.('#joystick,#mobile-actions,#hud,#buttons-row')) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    yaw -= dx * 0.005;
    pitch = Math.max(-0.2, Math.min(1.2, pitch + dy * 0.004));
  });
  const endDrag = () => { dragging = false; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    dist = Math.max(3, Math.min(20, dist + (e.deltaY > 0 ? 1 : -1)));
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (pinchD > 0) dist = Math.max(3, Math.min(20, dist + (pinchD - d) * 0.03));
      pinchD = d;
    }
  }, { passive: true });
  canvas.addEventListener('touchend', () => { pinchD = 0; });

  // ---------- Mobile joystick + buttons ----------
  const joy = { x: 0, y: 0, active: false };
  const joyEl = document.getElementById('joystick')!;
  const stickEl = document.getElementById('stick')!;
  let joyId: number | null = null;
  const setStick = (dx: number, dy: number) => {
    stickEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };
  const joyCenter = () => {
    const r = joyEl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: r.width / 2 };
  };
  joyEl.addEventListener('touchstart', (e) => { e.preventDefault(); joyId = e.changedTouches[0].identifier; joy.active = true; }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (!joy.active) return;
    for (const t of Array.from(e.touches)) {
      if (t.identifier === joyId) {
        const c = joyCenter();
        let dx = t.clientX - c.x, dy = t.clientY - c.y;
        const len = Math.hypot(dx, dy);
        const max = c.rad - 10;
        if (len > max) { dx = dx / len * max; dy = dy / len * max; }
        setStick(dx, dy);
        joy.x = dx / max; joy.y = dy / max;
      }
    }
  }, { passive: true });
  const joyEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === joyId) { joy.active = false; joy.x = 0; joy.y = 0; joyId = null; setStick(0, 0); }
    }
  };
  window.addEventListener('touchend', joyEnd);
  window.addEventListener('touchcancel', joyEnd);

  let jumpQueued = false, sprintHeld = false;
  document.getElementById('btn-jump')?.addEventListener('touchstart', (e) => { e.preventDefault(); jumpQueued = true; }, { passive: false });
  document.getElementById('btn-jump')?.addEventListener('mousedown', () => { jumpQueued = true; });
  const sprintBtn = document.getElementById('btn-sprint')!;
  sprintBtn?.addEventListener('touchstart', (e) => { e.preventDefault(); sprintHeld = true; sprintBtn.style.background = 'rgba(46,204,113,0.8)'; }, { passive: false });
  sprintBtn?.addEventListener('touchend', () => { sprintHeld = false; sprintBtn.style.background = ''; });
  sprintBtn?.addEventListener('mousedown', () => { sprintHeld = true; });
  sprintBtn?.addEventListener('mouseup', () => { sprintHeld = false; });

  function readInput(): InputState {
    let fwd = 0, strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (joy.active) { fwd += -joy.y; strafe += joy.x; }
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || sprintHeld;
    const jump = keys.has('Space') || jumpQueued;
    jumpQueued = false;
    const len = Math.hypot(fwd, strafe);
    if (len > 1) { fwd /= len; strafe /= len; }
    return { fwd, strafe, sprint, jump };
  }

  function update(dt: number) {
    const input = readInput();
    const speed = (input.sprint ? 11 : 6.2);
    // camera-relative move
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    // forward on ground plane pointing away from camera
    const fx = -sin, fz = -cos;
    const rx = -cos, rz = sin;
    let mx = fx * input.fwd + rx * input.strafe;
    let mz = fz * input.fwd + rz * input.strafe;

    pos.x += mx * speed * dt;
    pos.z += mz * speed * dt;
    // world bounds
    pos.x = Math.max(-185, Math.min(185, pos.x));
    pos.z = Math.max(-185, Math.min(185, pos.z));

    // tree/rock collision push-out
    for (const c of colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + 0.5;
      if (d > 0.001 && d < min) {
        pos.x = c.x + dx / d * min;
        pos.z = c.z + dz / d * min;
      }
    }

    const groundY = terrainHeight(pos.x, pos.z);
    if (input.jump && grounded) { vy = 7.5; grounded = false; }
    vy -= 22 * dt;
    pos.y += vy * dt;
    if (pos.y <= groundY) { pos.y = groundY; vy = 0; grounded = true; }

    const moving = Math.hypot(mx, mz) > 0.05;
    if (moving) {
      const target = Math.atan2(mx, mz);
      let d = target - faceAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      faceAngle += d * Math.min(1, dt * 12);
      bobT += dt * (input.sprint ? 13 : 9);
    }
    avatar.position.copyFrom(pos);
    avatar.rotationQuaternion = Quaternion.FromEulerAngles(0, faceAngle, 0);
    // squash & stretch / bob
    const stretch = grounded ? (moving ? 1 + Math.sin(bobT * 2) * 0.03 : 1) : 1.08;
    avatar.scaling.set(2 - stretch > 1 ? 1 : 1, stretch, 1);
    body.position.y = 0.95 + (moving && grounded ? Math.abs(Math.sin(bobT)) * 0.08 : 0);

    // camera
    const cx = pos.x + Math.sin(yaw) * Math.cos(pitch) * dist;
    const cz = pos.z + Math.cos(yaw) * Math.cos(pitch) * dist;
    let cy = pos.y + 1.8 + Math.sin(pitch) * dist;
    cy = Math.max(cy, terrainHeight(cx, cz) + 0.6);
    if (thirdPerson) {
      camera.position.set(cx, cy, cz);
      camera.setTarget(new Vector3(pos.x, pos.y + 1.6, pos.z));
    } else {
      camera.position.set(pos.x - Math.sin(faceAngle) * 0.4, pos.y + 2.05, pos.z - Math.cos(faceAngle) * 0.4);
      camera.setTarget(camera.position.add(new Vector3(-Math.sin(yaw) * 5, -pitch * 5 + 0.4, -Math.cos(yaw) * 5)));
    }
    avatar.setEnabled(thirdPerson);

    // keep shadow frustum near player
    try {
      const light = scene.getLightByName('sun') as any;
      if (light) {
        const sd = light.direction.normalize();
        light.position = new Vector3(pos.x - sd.x * 90, pos.y - sd.y * 90, pos.z - sd.z * 90);
        light.shadowMinZ = 20; light.shadowMaxZ = 220;
      }
    } catch { /* noop */ }
  }

  function setThirdPerson(v: boolean) { thirdPerson = v; }
  function isThirdPerson() { return thirdPerson; }

  return { update, camera, position: pos, setThirdPerson, isThirdPerson };
}
