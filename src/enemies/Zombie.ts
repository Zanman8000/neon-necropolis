// One member of the horde: procedural body, state, and per-frame animation.
import * as THREE from 'three';
import { skinTexture, clothTexture } from '../world/Textures';
import type { SpeedTier } from '../game/Rules';
import { ZOMBIE } from '../game/Rules';
import type { WindowState, PodState } from '../world/Level';

export type ZombieState = 'idle' | 'approach' | 'tearing' | 'climb' | 'rise' | 'chase' | 'attack' | 'dying' | 'sinking';

let skinTex: THREE.CanvasTexture | null = null;
let clothTex: THREE.CanvasTexture | null = null;

const TRIM = [0x22e6ff, 0xff3ea5, 0xff8c1a, 0x3dff8a, 0xffb020, 0xff2a4a];
const JACKETS = [0x4a4d5a, 0x5a4460, 0x40585a, 0x5e4c44, 0x485a44, 0x30333c];

function part(geo: THREE.BufferGeometry, mat: THREE.Material, zombie: Zombie, kind: 'head' | 'body'): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.userData = { zombie, part: kind };
  return m;
}

export class Zombie {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head: THREE.Mesh;
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly skinMat: THREE.MeshStandardMaterial;
  readonly clothMat: THREE.MeshStandardMaterial;
  readonly eyeMat: THREE.MeshBasicMaterial;

  state: ZombieState = 'idle';
  pos = { x: 0, z: 0 };
  y = 0;
  yaw = 0;
  targetYaw = 0;
  health = 150;
  maxHealth = 150;
  tier: SpeedTier = 'walk';
  speed = 1.4;
  phase = 0;
  timer = 0;
  cooldown = 0;
  groanT = 2;
  flashT = 0;
  fallDir = 1;
  window: WindowState | null = null;
  pod: PodState | null = null;
  climbFrom = { x: 0, z: 0 };
  climbTo = { x: 0, z: 0 };

  constructor(readonly id: number) {
    if (!skinTex) skinTex = skinTexture();
    if (!clothTex) clothTex = clothTexture();
    this.skinMat = new THREE.MeshStandardMaterial({ map: skinTex, roughness: 0.85, metalness: 0.02 });
    this.clothMat = new THREE.MeshStandardMaterial({ map: clothTex, roughness: 0.9, metalness: 0.05 });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.root.add(this.body);
    const skin = this.skinMat;
    const cloth = this.clothMat;

    // legs (pivot at hip)
    for (const [grp, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      grp.position.set(x, 0.86, 0);
      const leg = part(new THREE.BoxGeometry(0.17, 0.86, 0.19), cloth, this, 'body');
      leg.position.y = -0.43;
      grp.add(leg);
      this.body.add(grp);
    }
    const pelvis = part(new THREE.BoxGeometry(0.4, 0.24, 0.26), cloth, this, 'body');
    pelvis.position.y = 0.97;
    this.body.add(pelvis);
    const torso = part(new THREE.BoxGeometry(0.48, 0.62, 0.28), cloth, this, 'body');
    torso.position.y = 1.4;
    this.body.add(torso);
    const chest = part(new THREE.BoxGeometry(0.3, 0.3, 0.06), skin, this, 'body');
    chest.position.set(0, 1.5, -0.15);
    this.body.add(chest);
    // arms (pivot at shoulder)
    for (const [grp, x] of [
      [this.armL, -0.31],
      [this.armR, 0.31],
    ] as const) {
      grp.position.set(x, 1.63, 0);
      const upper = part(new THREE.BoxGeometry(0.13, 0.34, 0.13), cloth, this, 'body');
      upper.position.y = -0.17;
      grp.add(upper);
      const lower = part(new THREE.BoxGeometry(0.11, 0.34, 0.11), skin, this, 'body');
      lower.position.y = -0.5;
      grp.add(lower);
      this.body.add(grp);
    }
    // head
    this.head = part(new THREE.BoxGeometry(0.25, 0.28, 0.26), skin, this, 'head');
    this.head.position.y = 1.85;
    this.body.add(this.head);
    const jaw = part(new THREE.BoxGeometry(0.2, 0.08, 0.2), skin, this, 'head');
    jaw.position.set(0, -0.16, -0.02);
    this.head.add(jaw);
    for (const ex of [-0.06, 0.06]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), this.eyeMat);
      eye.position.set(ex, 0.03, -0.135);
      eye.userData = { zombie: this, part: 'head' };
      this.head.add(eye);
    }
    // neon trim on the jacket
    const trimMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.02), trimMat);
    trim.position.set(0, 1.66, -0.15);
    trim.userData = { zombie: this, part: 'body' };
    this.body.add(trim);
    const trim2 = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.02), trimMat);
    trim2.position.set(0.25, 1.35, -0.15);
    trim2.userData = { zombie: this, part: 'body' };
    this.body.add(trim2);
    this.trimMat = trimMat;
    this.root.visible = false;
  }

  private readonly trimMat: THREE.MeshBasicMaterial;

  get active(): boolean {
    return this.state !== 'idle' && this.state !== 'dying' && this.state !== 'sinking';
  }

  randomizeLook(): void {
    const trim = TRIM[Math.floor(Math.random() * TRIM.length)];
    this.trimMat.color.set(trim).multiplyScalar(1.4);
    this.eyeMat.color.set(Math.random() < 0.7 ? 0xff2a3a : trim).multiplyScalar(1.8);
    this.clothMat.color.set(JACKETS[Math.floor(Math.random() * JACKETS.length)]);
    const h = 0.22 + Math.random() * 0.14;
    this.skinMat.color.setHSL(h, 0.12 + Math.random() * 0.15, 0.4 + Math.random() * 0.2);
    this.skinMat.emissive.set(0x000000);
    this.clothMat.emissive.set(0x000000);
    const s = 0.9 + Math.random() * 0.14;
    this.root.scale.setScalar(s);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.phase = Math.random() * 10;
    this.groanT = 1 + Math.random() * 4;
    this.cooldown = 0;
    this.flashT = 0;
  }

  hitFlash(): void {
    this.flashT = 0.09;
  }

  update(dt: number): void {
    this.root.position.set(this.pos.x, this.y, this.pos.z);
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * Math.min(1, dt * 7);
    this.root.rotation.y = this.yaw;

    if (this.flashT > 0) {
      this.flashT -= dt;
      const k = this.flashT > 0 ? 0.7 : 0;
      this.skinMat.emissive.setRGB(k, k * 0.15, k * 0.1);
      this.clothMat.emissive.setRGB(k * 0.8, k * 0.1, k * 0.1);
    }

    const s = this.state;
    const swing = this.tier === 'sprint' ? 0.85 : this.tier === 'jog' ? 0.65 : 0.5;
    const lean = this.tier === 'sprint' ? 0.32 : this.tier === 'jog' ? 0.2 : 0.1;
    if (s === 'chase' || s === 'approach') {
      this.phase += dt * this.speed * 2.6;
      const p = this.phase;
      this.legL.rotation.x = Math.sin(p) * swing;
      this.legR.rotation.x = -Math.sin(p) * swing;
      this.armL.rotation.x = 1.35 + Math.sin(p * 0.5 + 1) * 0.12;
      this.armR.rotation.x = 1.2 + Math.cos(p * 0.5) * 0.14;
      this.armL.rotation.z = 0.18;
      this.armR.rotation.z = -0.18;
      this.body.rotation.x = -lean;
      this.body.rotation.z = Math.sin(p) * 0.04;
      this.body.position.y = Math.abs(Math.sin(p)) * 0.04;
      this.head.rotation.x = 0.25 + Math.sin(p * 2) * 0.05;
    } else if (s === 'tearing') {
      this.phase += dt * 14;
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
      this.armL.rotation.x = 1.3 + Math.sin(this.phase) * 0.55;
      this.armR.rotation.x = 1.3 + Math.cos(this.phase) * 0.55;
      this.body.rotation.x = -0.2;
      this.body.position.y = 0;
    } else if (s === 'attack') {
      const p = 1 - this.timer / ZOMBIE.attackWindup;
      const a = Math.sin(p * Math.PI);
      this.armL.rotation.x = 1.4 + a * 1.1;
      this.armR.rotation.x = 1.4 + a * 1.1;
      this.body.rotation.x = -0.15 - a * 0.3;
      this.head.rotation.x = 0.1 + a * 0.3;
    } else if (s === 'climb') {
      const p = 1 - this.timer / ZOMBIE.climbTime;
      const a = Math.sin(p * Math.PI);
      this.body.position.y = -0.45 * a;
      this.body.rotation.x = -0.5 * a;
      this.legL.rotation.x = -0.9 * a;
      this.legR.rotation.x = 0.3 * a;
      this.armL.rotation.x = 1.9;
      this.armR.rotation.x = 1.9;
    } else if (s === 'rise') {
      this.armL.rotation.x = 2.6;
      this.armR.rotation.x = 2.6;
      this.body.rotation.x = 0;
      this.body.position.y = 0;
    } else if (s === 'dying') {
      const p = 1 - this.timer / ZOMBIE.dieTime;
      const e = p * p;
      this.body.rotation.x = this.fallDir * (Math.PI / 2) * e;
      this.armL.rotation.x = 1.4 - e * 1.2;
      this.armR.rotation.x = 1.4 - e * 1.0;
      this.legL.rotation.x = e * 0.2;
      this.legR.rotation.x = -e * 0.3;
    }
  }
}
