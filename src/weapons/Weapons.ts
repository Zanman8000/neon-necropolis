// Weapon instances, the two-slot arsenal, view-model animation and hitscan firing.
import * as THREE from 'three';
import { WEAPONS, WEAPON_SLOTS, type WeaponDef } from './WeaponDefs';
import { buildGunModel, type GunModel } from './GunModels';
import { MuzzleFlash, type Sparks } from '../fx/Particles';
import type { Input } from '../core/Input';
import type { Level } from '../world/Level';
import type { Sfx } from '../audio/Sfx';
import type { Player } from '../player/Player';

export class WeaponInstance {
  mag: number;
  reserve: number;
  reloading = false;
  reloadT = 0;
  cooldown = 0;
  cyclerT = 0;
  readonly model: GunModel;
  readonly flash: MuzzleFlash;
  private readonly cyclerBaseZ: number;

  constructor(readonly def: WeaponDef) {
    this.mag = def.magSize;
    this.reserve = def.reserveMax;
    this.model = buildGunModel(def.model, def.accent);
    this.flash = new MuzzleFlash(def.accent);
    this.flash.attach(this.model.muzzle);
    this.cyclerBaseZ = this.model.cycler ? this.model.cycler.position.z : 0;
    this.model.group.visible = false;
  }

  refill(): void {
    this.reserve = this.def.reserveMax;
  }

  get canFire(): boolean {
    return !this.reloading && this.cooldown <= 0 && this.mag > 0;
  }

  animate(dt: number): void {
    this.flash.update(dt);
    if (this.model.cycler) {
      if (this.cyclerT > 0) this.cyclerT = Math.max(0, this.cyclerT - dt);
      const k = this.cyclerT > 0 ? Math.sin((this.cyclerT / 0.09) * Math.PI) : 0;
      this.model.cycler.position.z = this.cyclerBaseZ + k * this.model.cyclerTravel;
    }
  }
}

export interface ZombieHit {
  object: THREE.Object3D;
  part: 'head' | 'body';
  point: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
}

const HIP = new THREE.Vector3(0.23, -0.21, -0.42);
const ADS = new THREE.Vector3(0, -0.13, -0.3);
const LOWERED = new THREE.Vector3(0.25, -0.55, -0.4);

export class Arsenal {
  readonly slots: (WeaponInstance | null)[] = new Array(WEAPON_SLOTS).fill(null);
  current = 0;
  ads = 0;
  readonly viewRoot = new THREE.Group();
  private switchT = 0;
  private pendingSwitch = -1;
  private kick = 0;
  private rise = 0;
  private swayX = 0;
  private swayY = 0;
  private spreadHeat = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpOrigin = new THREE.Vector3();
  onZombieHit: ((hit: ZombieHit) => void) | null = null;
  getZombieTargets: (() => THREE.Object3D[]) | null = null;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly level: Level,
    private readonly sfx: Sfx,
    private readonly sparks: Sparks,
  ) {
    camera.add(this.viewRoot);
    this.viewRoot.position.copy(HIP);
    (this.raycaster as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
  }

  get weapon(): WeaponInstance | null {
    return this.slots[this.current];
  }

  get spread(): number {
    const w = this.weapon;
    if (!w) return 0;
    const base = THREE.MathUtils.lerp(w.def.spread, w.def.adsSpread, this.ads);
    return base * (1 + this.spreadHeat * 2.2);
  }

  owns(id: string): boolean {
    return this.slots.some((s) => s?.def.id === id);
  }

  reset(): void {
    for (const s of this.slots) if (s) this.viewRoot.remove(s.model.group);
    this.slots.fill(null);
    this.current = 0;
    this.ads = 0;
    this.switchT = 0;
    this.pendingSwitch = -1;
    this.kick = 0;
    this.rise = 0;
    this.spreadHeat = 0;
  }

  /** Give a weapon. Returns 'refill' when already owned, 'new' when added, 'replaced' when it took the current slot. */
  give(id: string): 'refill' | 'new' | 'replaced' {
    const def = WEAPONS[id];
    const existing = this.slots.findIndex((s) => s?.def.id === id);
    if (existing >= 0) {
      this.slots[existing]!.refill();
      return 'refill';
    }
    const inst = new WeaponInstance(def);
    this.viewRoot.add(inst.model.group);
    const empty = this.slots.findIndex((s) => s === null);
    if (empty >= 0) {
      this.slots[empty] = inst;
      this.switchTo(empty, true);
      return 'new';
    }
    const old = this.slots[this.current];
    if (old) this.viewRoot.remove(old.model.group);
    this.slots[this.current] = inst;
    this.switchTo(this.current, true);
    return 'replaced';
  }

  switchTo(i: number, instant = false): void {
    if (i < 0 || i >= this.slots.length || !this.slots[i]) return;
    if (instant) {
      for (const s of this.slots) if (s) s.model.group.visible = false;
      this.current = i;
      this.slots[i]!.model.group.visible = true;
      this.switchT = 0.25;
      this.pendingSwitch = -1;
      return;
    }
    if (i === this.current || this.pendingSwitch >= 0) return;
    this.pendingSwitch = i;
    this.switchT = 0.5;
    const w = this.weapon;
    if (w) {
      w.reloading = false;
      w.reloadT = 0;
    }
    this.sfx.weaponSwap();
  }

  update(dt: number, input: Input, player: Player, allowInput: boolean): void {
    const w = this.weapon;
    // switching
    if (this.switchT > 0) {
      this.switchT -= dt;
      if (this.pendingSwitch >= 0 && this.switchT <= 0.25) {
        for (const s of this.slots) if (s) s.model.group.visible = false;
        this.current = this.pendingSwitch;
        this.pendingSwitch = -1;
        this.slots[this.current]!.model.group.visible = true;
      }
    }
    if (allowInput) {
      if (input.wasPressed('Digit1')) this.switchTo(0);
      if (input.wasPressed('Digit2')) this.switchTo(1);
      if (input.wheelDelta !== 0) {
        const n = this.slots.length;
        for (let k = 1; k < n; k++) {
          const i = (this.current + k * (input.wheelDelta > 0 ? 1 : -1) + n * 4) % n;
          if (this.slots[i]) {
            this.switchTo(i);
            break;
          }
        }
      }
    }

    const busy = this.switchT > 0 && this.pendingSwitch >= 0;
    const adsTarget = allowInput && w && !w.reloading && !player.sprinting && !busy && input.isButton(2) ? 1 : 0;
    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 11);
    const fov = THREE.MathUtils.lerp(player.baseFov, player.baseFov * 0.72, this.ads);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    if (w) {
      w.cooldown = Math.max(0, w.cooldown - dt);
      w.animate(dt);
      if (w.reloading) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) {
          const n = Math.min(w.def.magSize - w.mag, w.reserve);
          w.mag += n;
          w.reserve -= n;
          w.reloading = false;
          this.sfx.reloadEnd();
        }
      }
      if (allowInput && player.alive && !busy) {
        const wantFire = w.def.auto ? input.isButton(0) : input.wasButtonPressed(0);
        if (wantFire && !w.reloading && w.cooldown <= 0) {
          if (w.mag > 0 && !player.sprinting) this.fire(w, player);
          else if (w.mag === 0 && input.wasButtonPressed(0)) {
            if (w.reserve > 0) this.startReload(w);
            else this.sfx.dryFire();
          }
        }
        if (input.wasPressed('KeyR')) this.startReload(w);
      }
    }

    // recoil / sway / bob view-model animation
    this.kick = Math.max(0, this.kick - this.kick * Math.min(1, dt * 12) - dt * 0.05);
    this.rise -= this.rise * Math.min(1, dt * 10);
    this.spreadHeat = Math.max(0, this.spreadHeat - dt * 1.6);
    if (allowInput) {
      this.swayX += (THREE.MathUtils.clamp(-input.mouseDX * 0.0009, -0.05, 0.05) - this.swayX) * Math.min(1, dt * 9);
      this.swayY += (THREE.MathUtils.clamp(-input.mouseDY * 0.0009, -0.05, 0.05) - this.swayY) * Math.min(1, dt * 9);
    } else {
      this.swayX *= 0.9;
      this.swayY *= 0.9;
    }
    const target = new THREE.Vector3().lerpVectors(HIP, ADS, this.ads);
    if (busy) target.copy(LOWERED);
    else if (player.sprinting) target.set(0.28, -0.3, -0.42);
    const bob = player.bobAmount * (1 - this.ads * 0.85);
    target.x += Math.cos(player.bobPhase) * 0.012 * bob + this.swayX;
    target.y += Math.sin(player.bobPhase * 2) * 0.01 * bob + this.swayY * 0.6 - (player.sprinting ? 0.03 : 0);
    target.z += this.kick;
    this.viewRoot.position.lerp(target, Math.min(1, dt * 14));
    let rotX = this.rise + this.swayY * 0.8;
    let rotZ = -this.swayX * 0.6;
    if (player.sprinting) {
      rotX -= 0.35;
      rotZ += 0.25;
    }
    if (busy) rotX -= 0.7;
    if (w?.reloading) {
      const t = 1 - w.reloadT / w.def.reloadTime;
      const s = Math.sin(t * Math.PI);
      rotX -= s * 0.55;
      rotZ += s * 0.35;
      this.viewRoot.position.y -= s * 0.08;
    }
    this.viewRoot.rotation.x += (rotX - this.viewRoot.rotation.x) * Math.min(1, dt * 12);
    this.viewRoot.rotation.z += (rotZ - this.viewRoot.rotation.z) * Math.min(1, dt * 12);
    this.viewRoot.rotation.y = this.swayX * 0.8;
  }

  private startReload(w: WeaponInstance): void {
    if (w.reloading || w.mag >= w.def.magSize || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadT = w.def.reloadTime;
    this.sfx.reloadStart();
  }

  private fire(w: WeaponInstance, player: Player): void {
    w.mag--;
    w.cooldown = 60 / w.def.rpm;
    w.cyclerT = 0.09;
    w.flash.fire(w.def.model === 'shotgun' ? 1.7 : w.def.model === 'pistol' ? 0.8 : 1.1);
    this.sfx.gunshot(w.def.sfx);
    this.kick += w.def.kick;
    this.rise += w.def.rise;
    player.pitch += w.def.rise * 0.35 * (0.7 + Math.random() * 0.6);
    player.yaw += (Math.random() - 0.5) * w.def.rise * 0.25;
    this.spreadHeat = Math.min(1.5, this.spreadHeat + (w.def.pellets > 1 ? 0.6 : 0.25));

    this.camera.getWorldPosition(this.tmpOrigin);
    const targets = this.level.getBulletTargets();
    const zombieTargets = this.getZombieTargets ? this.getZombieTargets() : [];
    const all = targets.concat(zombieTargets);
    const spread = this.spread;
    for (let i = 0; i < w.def.pellets; i++) {
      this.tmpDir.copy(player.forward);
      const a = Math.random() * Math.PI * 2;
      const r = spread * Math.sqrt(Math.random());
      const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
      const up = new THREE.Vector3().crossVectors(right, this.tmpDir).normalize();
      this.tmpDir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      this.raycaster.set(this.tmpOrigin, this.tmpDir);
      this.raycaster.far = w.def.range;
      const hits = this.raycaster.intersectObjects(all, true);
      if (hits.length === 0) continue;
      const hit = hits[0];
      const ud = hit.object.userData as { zombie?: unknown; part?: 'head' | 'body' };
      if (ud.zombie) {
        const dist = hit.distance;
        const falloff = w.def.pellets > 1 ? THREE.MathUtils.clamp(1.4 - dist / w.def.range, 0.35, 1) : 1;
        const part = ud.part ?? 'body';
        const damage = w.def.damage * falloff * (part === 'head' ? w.def.headMult : 1);
        this.onZombieHit?.({ object: hit.object, part, point: hit.point, direction: this.tmpDir.clone(), damage });
      } else {
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : this.tmpDir.clone().negate();
        this.sparks.emit(hit.point, n, 6, new THREE.Color(w.def.accent).lerp(new THREE.Color(0xfff0c0), 0.5), 5, 0.05, 0.35);
      }
    }
  }
}
