import {
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  ArcRotateCamera,
  Mesh,
  TransformNode,
} from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import { terrainHeight, WATER_LEVEL } from './world/terrain';
import type { InputState } from './mobile/joystick';

export class Player {
  public root = new TransformNode('player');
  public camera!: ArcRotateCamera;
  private body!: Mesh;
  private head!: Mesh;
  private legL!: Mesh;
  private legR!: Mesh;
  private armL!: Mesh;
  private armR!: Mesh;
  private vy = 0;
  private grounded = true;
  private walkPhase = 0;
  private yaw = 0; // facing
  public position = new Vector3(0, 0, 14);

  constructor(private scene: Scene) {}

  public build(): void {
    const scene = this.scene;
    // Spawn in the southern meadow, overlooking the lake + mountains
    const sx = 0;
    const sz = 85;
    this.position.set(sx, terrainHeight(sx, sz), sz);

    const skin = new StandardMaterial('skin', scene);
    skin.diffuseColor = new Color3(0.95, 0.75, 0.6);
    const shirt = new StandardMaterial('shirt', scene);
    shirt.diffuseColor = new Color3(0.2, 0.55, 0.85);
    shirt.specularColor = new Color3(0, 0, 0);
    const pants = new StandardMaterial('pants', scene);
    pants.diffuseColor = new Color3(0.25, 0.3, 0.4);
    const packMat = new StandardMaterial('pack', scene);
    packMat.diffuseColor = new Color3(0.85, 0.55, 0.2);

    this.body = MeshBuilder.CreateCapsule('pBody', { radius: 0.32, height: 0.85 }, scene);
    this.body.material = shirt;
    this.body.position.y = 1.05;
    this.body.parent = this.root;

    this.head = MeshBuilder.CreateSphere('pHead', { diameter: 0.55, segments: 12 }, scene);
    this.head.material = skin;
    this.head.position.y = 1.85;
    this.head.parent = this.root;

    // eyes
    const eyeMat = new StandardMaterial('eye', scene);
    eyeMat.diffuseColor = new Color3(0.1, 0.1, 0.12);
    for (const s of [-1, 1]) {
      const eye = MeshBuilder.CreateSphere('eye', { diameter: 0.08, segments: 6 }, scene);
      eye.material = eyeMat;
      eye.position.set(0.12 * s, 1.9, 0.24);
      eye.parent = this.root;
    }
    // cap / hair
    const cap = MeshBuilder.CreateSphere('cap', { diameter: 0.58, segments: 10 }, scene);
    const capMat = new StandardMaterial('cap', scene);
    capMat.diffuseColor = new Color3(0.75, 0.25, 0.2);
    cap.material = capMat;
    cap.position.y = 1.98;
    cap.scaling.y = 0.55;
    cap.parent = this.root;
    // backpack
    const pack = MeshBuilder.CreateBox('pack', { size: 0.42 }, scene);
    pack.material = packMat;
    pack.position.set(0, 1.15, -0.38);
    pack.parent = this.root;

    const mkLimb = (name: string, mat: unknown, x: number, y: number, w: number, h: number) => {
      const m = MeshBuilder.CreateCapsule(name, { radius: w, height: h }, scene);
      m.material = mat as never;
      m.position.set(x, y, 0);
      m.parent = this.root;
      return m;
    };
    this.legL = mkLimb('legL', pants, -0.16, 0.4, 0.13, 0.5);
    this.legR = mkLimb('legR', pants, 0.16, 0.4, 0.13, 0.5);
    this.armL = mkLimb('armL', shirt, -0.48, 1.1, 0.11, 0.45);
    this.armR = mkLimb('armR', shirt, 0.48, 1.1, 0.11, 0.45);

    this.root.position.copyFrom(this.position);

    // Third-person orbit camera
    const params = new URLSearchParams(window.location.search);
    const camOverride = parseFloat(params.get('cam') ?? '');
    const initAlpha = Number.isFinite(camOverride) ? camOverride : Math.PI;
    this.camera = new ArcRotateCamera('followCam', initAlpha, 1.05, 10, this.root.position.clone(), scene);
    this.camera.lowerBetaLimit = 0.15;
    this.camera.upperBetaLimit = 1.45;
    this.camera.lowerRadiusLimit = 4;
    this.camera.upperRadiusLimit = 26;
    this.camera.inertia = 0.6;
    scene.activeCamera = this.camera;
  }

  public enableShadows(add: (m: Mesh) => void): void {
    for (const m of [this.body, this.head, this.legL, this.legR, this.armL, this.armR]) add(m);
  }

  public update(dt: number, input: InputState, colliders: { x: number; z: number; r: number }[], radiusLimit = 215): void {
    const dtC = Math.min(dt, 0.05);
    // --- camera orbit from look deltas ---
    this.camera.alpha -= input.lookDX * 0.005;
    this.camera.beta += input.lookDY * 0.004;
    this.camera.beta = Math.max(this.camera.lowerBetaLimit!, Math.min(this.camera.upperBetaLimit!, this.camera.beta));
    if (input.zoom !== 0) {
      this.camera.radius = Math.max(4, Math.min(26, this.camera.radius + input.zoom * 1.2));
      input.zoom = 0;
    }
    input.lookDX = 0;
    input.lookDY = 0;

    // --- movement relative to camera ---
    const camYaw = this.camera.alpha + Math.PI / 2; // camera forward on ground plane
    const fwd = new Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const right = new Vector3(-fwd.z, 0, fwd.x);
    const mx = input.moveX;
    const mz = input.moveZ;
    const moving = Math.hypot(mx, mz) > 0.08;
    const speed = (input.sprint ? 11 : 6.2) * (this.inWater() ? 0.55 : 1);

    if (moving) {
      const dir = right.scale(mx).add(fwd.scale(mz)).normalize();
      this.position.addInPlace(dir.scale(speed * dtC));
      this.yaw = Math.atan2(dir.x, dir.z);
      this.walkPhase += dtC * (input.sprint ? 13 : 9);
    } else {
      this.walkPhase *= 1 - Math.min(1, dtC * 8);
    }

    // world border (rim mountains)
    const d = Math.hypot(this.position.x, this.position.z);
    if (d > radiusLimit) {
      this.position.x *= radiusLimit / d;
      this.position.z *= radiusLimit / d;
    }

    // tree/rock push-out
    for (const c of colliders) {
      const dx = this.position.x - c.x;
      const dz = this.position.z - c.z;
      const dist = Math.hypot(dx, dz);
      const min = c.r + 0.5;
      if (dist < min && dist > 0.001) {
        this.position.x = c.x + (dx / dist) * min;
        this.position.z = c.z + (dz / dist) * min;
      }
    }

    // --- vertical: gravity + jump + buoyancy ---
    const ground = terrainHeight(this.position.x, this.position.z);
    const floorY = Math.max(ground, WATER_LEVEL - 0.4);
    if (input.jump && this.grounded) {
      this.vy = 7.5;
      this.grounded = false;
    }
    input.jump = false;
    this.vy -= 22 * dtC;
    this.position.y += this.vy * dtC;
    if (this.position.y <= floorY) {
      this.position.y = floorY;
      this.vy = 0;
      this.grounded = true;
    }

    // --- pose ---
    this.root.position.set(this.position.x, this.position.y, this.position.z);
    this.root.rotation.y = this.yaw;
    const sw = moving ? Math.sin(this.walkPhase) : 0;
    this.legL.rotation.x = sw * 0.7;
    this.legR.rotation.x = -sw * 0.7;
    this.armL.rotation.x = -sw * 0.6;
    this.armR.rotation.x = sw * 0.6;
    this.body.position.y = 1.05 + (moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(performance.now() * 0.002) * 0.015);

    // camera target follows head
    this.camera.target.set(this.position.x, this.position.y + 1.6, this.position.z);
  }

  private inWater(): boolean {
    const g = terrainHeight(this.position.x, this.position.z);
    return g < WATER_LEVEL - 0.1;
  }
}
