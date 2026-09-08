// Weapon instances, the arsenal (gun slots plus a permanent melee slot), view-model animation and hitscan firing.
import * as THREE from 'three';
import { WEAPONS, MELEE, STARTING_MELEE, type WeaponDef, type MeleeDef } from './WeaponDefs';
import { buildGunModel, type GunModel } from './GunModels';
import { MuzzleFlash, type Sparks } from '../fx/Particles';
import type { Input } from '../core/Input';
import type { Level } from '../world/Level';
import type { Sfx } from '../audio/Sfx';
import type { Player } from '../player/Player';
import { UPGRADE } from '../game/Rules';

/** Global multipliers applied by perks. */
export interface Modifiers {
  damage: number;
  rpm: number;
  reload: number;
}

export class WeaponInstance {
  mag: number;
  reserve: number;
  reloading = false;
  reloadT = 0;
  cooldown = 0;
  cyclerT = 0;
  upgraded = false;
  readonly model: GunModel;
  readonly flash: MuzzleFlash;
  private readonly cyclerBaseZ: number;

  constructor(
    readonly def: WeaponDef,
    private readonly mods: Modifiers,
  ) {
    this.mag = def.magSize;
    this.reserve = def.reserveMax;
    this.model = buildGunModel(def.model, def.accent);
    this.flash = new MuzzleFlash(def.accent);
    this.flash.attach(this.model.muzzle);
    this.cyclerBaseZ = this.model.cycler ? this.model.cycler.position.z : 0;
    this.model.group.visible = false;
  }

  get name(): string {
    return this.upgraded ? this.def.upgradedName : this.def.name;
  }

  get damage(): number {
    return this.def.damage * (this.upgraded ? UPGRADE.damage : 1) * this.mods.damage;
  }

  get rpm(): number {
    return this.def.rpm * this.mods.rpm;
  }

  get magSize(): number {
    return Math.round(this.def.magSize * (this.upgraded ? UPGRADE.mag : 1));
  }

  get reserveMax(): number {
    return Math.round(this.def.reserveMax * (this.upgraded ? UPGRADE.reserve : 1));
  }

  get reloadTime(): number {
    return this.def.reloadTime * this.mods.reload;
  }

  get ammoFull(): boolean {
    return this.reserve >= this.reserveMax;
  }

  get canFire(): boolean {
    return !this.reloading && this.cooldown <= 0 && this.mag > 0;
  }

  upgrade(): void {
    if (this.upgraded) return;
    this.upgraded = true;
    this.mag = this.magSize;
    this.reserve = this.reserveMax;
    this.model.accent.color.multiplyScalar(1.8);
  }

  refill(): void {
    this.reserve = this.reserveMax;
  }

  /** Add a fraction of the missing reserve ammo. Returns the rounds added. */
  refillFraction(f: number): number {
    const missing = this.reserveMax - this.reserve;
    const add = Math.max(0, Math.min(missing, Math.round(missing * f)));
    this.reserve += add;
    return add;
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

export class MeleeWeapon {
  cooldown = 0;
  swingT = 0;
  hitDone = true;
  readonly model: GunModel;

  constructor(readonly def: MeleeDef) {
    this.model = buildGunModel(def.model, def.accent);
    this.model.group.visible = false;
  }
}

export interface ZombieHit {
  object: THREE.Object3D;
  part: 'head' | 'body';
  point: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
}

export interface SlotView {
  label: string;
  name: string | null;
  active: boolean;
  kind: 'gun' | 'melee' | 'empty';
}

const HIP = new THREE.Vector3(0.23, -0.21, -0.42);
const ADS = new THREE.Vector3(0, -0.13, -0.3);
const LOWERED = new THREE.Vector3(0.25, -0.55, -0.4);
const MELEE_HIP = new THREE.Vector3(0.24, -0.22, -0.34);

export class Arsenal {
  guns: (WeaponInstance | null)[] = [null, null];
  readonly melee: MeleeWeapon;
  /** Index into guns, or -1 for the melee slot. */
  current = 0;
  readonly mods: Modifiers = { damage: 1, rpm: 1, reload: 1 };
  ads = 0;
  readonly viewRoot = new THREE.Group();
  private switchT = 0;
  private pending: number | null = null;
  private quickMelee = 0;
  private kick = 0;
  private rise = 0;
  private swayX = 0;
  private swayY = 0;
  private spreadHeat = 0;
  private sprintFire = false;
  private throwT = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpOrigin = new THREE.Vector3();
  onZombieHit: ((hit: ZombieHit) => void) | null = null;
  onMeleeSwing: ((damage: number, range: number, arcCos: number) => void) | null = null;
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
    this.melee = new MeleeWeapon(MELEE[STARTING_MELEE]);
    this.viewRoot.add(this.melee.model.group);
  }

  get weapon(): WeaponInstance | null {
    return this.current >= 0 ? this.guns[this.current] : null;
  }

  get isMelee(): boolean {
    return this.current < 0;
  }

  get currentName(): string {
    return this.weapon?.name ?? this.melee.def.name;
  }

  get spread(): number {
    const w = this.weapon;
    if (!w) return 0;
    const base = THREE.MathUtils.lerp(w.def.spread, w.def.adsSpread, this.ads);
    return base * (1 + this.spreadHeat * 2.2) * (this.sprintFire ? 3.5 : 1);
  }

  /** Slots in HUD order: gun 1, gun 2, melee (3), optional gun (4). */
  slotViews(): SlotView[] {
    const gun = (i: number, label: string): SlotView => {
      const g = this.guns[i];
      return { label, name: g ? g.name : null, active: this.current === i, kind: g ? 'gun' : 'empty' };
    };
    const views: SlotView[] = [gun(0, '1'), gun(1, '2'), { label: '3', name: this.melee.def.name, active: this.current === -1, kind: 'melee' }];
    if (this.guns.length > 2) views.push(gun(2, '4'));
    return views;
  }

  private cycleOrder(): number[] {
    const order = [0, 1, -1];
    if (this.guns.length > 2) order.push(2);
    return order.filter((i) => i === -1 || this.guns[i]);
  }

  owns(id: string): boolean {
    return this.guns.some((s) => s?.def.id === id);
  }

  gun(id: string): WeaponInstance | undefined {
    return this.guns.find((s) => s?.def.id === id) ?? undefined;
  }

  reset(): void {
    for (const s of this.guns) if (s) this.viewRoot.remove(s.model.group);
    this.guns = [null, null];
    this.current = 0;
    this.ads = 0;
    this.switchT = 0;
    this.pending = null;
    this.quickMelee = 0;
    this.kick = 0;
    this.rise = 0;
    this.spreadHeat = 0;
    this.mods.damage = 1;
    this.mods.rpm = 1;
    this.mods.reload = 1;
    this.melee.cooldown = 0;
    this.melee.swingT = 0;
    this.melee.hitDone = true;
  }

  /** Grow or shrink the gun slots (Pack Mule). Shrinking drops the third gun. */
  setGunSlots(n: 2 | 3): void {
    if (n === 3 && this.guns.length === 2) this.guns.push(null);
    if (n === 2 && this.guns.length === 3) {
      const dropped = this.guns.pop();
      if (dropped) this.viewRoot.remove(dropped.model.group);
      if (this.current === 2) this.switchTo(this.guns[0] ? 0 : this.guns[1] ? 1 : -1, true);
    }
  }

  /** Give a gun. Returns 'refill' when already owned, 'new' when added, 'replaced' when it took the current slot. */
  give(id: string): 'refill' | 'new' | 'replaced' {
    const def = WEAPONS[id];
    const existing = this.gun(id);
    if (existing) {
      existing.refill();
      return 'refill';
    }
    const inst = new WeaponInstance(def, this.mods);
    this.viewRoot.add(inst.model.group);
    const empty = this.guns.findIndex((s) => s === null);
    if (empty >= 0) {
      this.guns[empty] = inst;
      this.switchTo(empty, true);
      return 'new';
    }
    const target = this.current >= 0 ? this.current : 0;
    const old = this.guns[target];
    if (old) this.viewRoot.remove(old.model.group);
    this.guns[target] = inst;
    this.switchTo(target, true);
    return 'replaced';
  }

  /** Take a gun out of the arsenal (for the overclock station). */
  removeGun(index: number): WeaponInstance | null {
    const inst = this.guns[index];
    if (!inst) return null;
    this.viewRoot.remove(inst.model.group);
    this.guns[index] = null;
    if (this.current === index) {
      const other = this.guns.findIndex((g) => g !== null);
      this.switchTo(other >= 0 ? other : -1, true);
    }
    return inst;
  }

  /** Put a gun back into a slot and select it. */
  insertGun(inst: WeaponInstance, index: number): void {
    const old = this.guns[index];
    if (old) this.viewRoot.remove(old.model.group);
    if (index >= this.guns.length) index = this.guns.findIndex((g) => g === null);
    if (index < 0) index = 0;
    this.guns[index] = inst;
    this.viewRoot.add(inst.model.group);
    this.switchTo(index, true);
  }

  refillAll(): void {
    for (const g of this.guns) if (g) g.refill();
  }

  switchTo(i: number, instant = false): void {
    if (i >= 0 && (i >= this.guns.length || !this.guns[i])) return;
    if (instant) {
      this.current = i;
      this.switchT = 0.25;
      this.pending = null;
      return;
    }
    if (i === this.current || this.pending !== null) return;
    this.pending = i;
    this.switchT = 0.5;
    const w = this.weapon;
    if (w) {
      w.reloading = false;
      w.reloadT = 0;
    }
    this.sfx.weaponSwap();
  }

  /** Quick arm-back animation for a throw. */
  playThrow(): void {
    this.throwT = 0.32;
  }

  /** Knife without switching slots. */
  quickMeleeAttack(): boolean {
    if (this.melee.cooldown > 0 || this.quickMelee > 0) return false;
    this.quickMelee = this.melee.def.swingTime + 0.08;
    const w = this.weapon;
    if (w) {
      w.reloading = false;
      w.reloadT = 0;
    }
    this.startSwing();
    return true;
  }

  private startSwing(): void {
    const m = this.melee;
    m.cooldown = m.def.cooldown;
    m.swingT = m.def.swingTime;
    m.hitDone = false;
    this.sfx.meleeSwing();
  }

  update(dt: number, input: Input, player: Player, allowInput: boolean): void {
    const canAct = allowInput && player.alive && !player.downed;
    // switching
    if (this.switchT > 0) {
      this.switchT -= dt;
      if (this.pending !== null && this.switchT <= 0.25) {
        this.current = this.pending;
        this.pending = null;
      }
    }
    if (canAct) {
      if (input.wasPressed('Digit1')) this.switchTo(0);
      if (input.wasPressed('Digit2')) this.switchTo(1);
      if (input.wasPressed('Digit3')) this.switchTo(-1);
      if (input.wasPressed('Digit4') && this.guns.length > 2) this.switchTo(2);
      if (input.wheelDelta !== 0) {
        const order = this.cycleOrder();
        const idx = order.indexOf(this.current);
        if (order.length > 1 && idx >= 0) this.switchTo(order[(idx + (input.wheelDelta > 0 ? 1 : -1) + order.length) % order.length]);
      }
      if (input.wasPressed('KeyV') && this.pending === null) {
        if (this.isMelee) {
          if (this.melee.cooldown <= 0) this.startSwing();
        } else {
          this.quickMeleeAttack();
        }
      }
    }

    // melee timers
    const m = this.melee;
    m.cooldown = Math.max(0, m.cooldown - dt);
    if (m.swingT > 0) {
      m.swingT -= dt;
      if (!m.hitDone && m.swingT <= m.def.swingTime * 0.62) {
        m.hitDone = true;
        this.onMeleeSwing?.(m.def.damage, m.def.range, m.def.arcCos);
      }
    }
    if (this.quickMelee > 0) this.quickMelee -= dt;
    const showMelee = this.isMelee || this.quickMelee > 0;
    const busy = this.switchT > 0 && this.pending !== null;

    const w = this.weapon;
    const adsTarget = canAct && w && !showMelee && !w.reloading && !player.sprinting && !busy && input.isButton(2) ? 1 : 0;
    this.ads += (adsTarget - this.ads) * Math.min(1, dt * 11);
    const fov = THREE.MathUtils.lerp(player.baseFov, player.baseFov * 0.72, this.ads);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    for (const g of this.guns) if (g) g.animate(dt);
    if (w) {
      w.cooldown = Math.max(0, w.cooldown - dt);
      if (w.reloading) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) {
          const n = Math.min(w.magSize - w.mag, w.reserve);
          w.mag += n;
          w.reserve -= n;
          w.reloading = false;
          this.sfx.reloadEnd();
        }
      }
      if (canAct && !busy && !showMelee) {
        const held = input.isButton(0);
        const wantFire = w.def.auto ? held : input.wasButtonPressed(0);
        this.sprintFire = player.sprinting;
        if (wantFire && !w.reloading && w.cooldown <= 0 && w.mag > 0) this.fire(w, player);
        // running dry while holding the trigger starts a reload straight away
        if (w.mag === 0 && !w.reloading) {
          if (w.reserve > 0 && (held || input.wasButtonPressed(0))) this.startReload(w);
          else if (w.reserve === 0 && input.wasButtonPressed(0)) this.sfx.dryFire();
        }
        if (input.wasPressed('KeyR')) this.startReload(w);
      }
    } else if (canAct && !busy && this.isMelee) {
      if (input.wasButtonPressed(0) && m.cooldown <= 0) this.startSwing();
    }

    // view-model visibility
    for (let i = 0; i < this.guns.length; i++) {
      const g = this.guns[i];
      if (g) g.model.group.visible = i === this.current && !showMelee;
    }
    m.model.group.visible = showMelee;

    // recoil / sway / bob
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
    const target = showMelee ? MELEE_HIP.clone() : new THREE.Vector3().lerpVectors(HIP, ADS, this.ads);
    if (busy) target.copy(LOWERED);
    else if (player.sprinting && !showMelee) target.set(0.28, -0.3, -0.42);
    const bob = player.bobAmount * (1 - this.ads * 0.85);
    target.x += Math.cos(player.bobPhase) * 0.012 * bob + this.swayX;
    target.y += Math.sin(player.bobPhase * 2) * 0.01 * bob + this.swayY * 0.6 - (player.sprinting ? 0.03 : 0);
    target.z += this.kick;
    this.viewRoot.position.lerp(target, Math.min(1, dt * 14));
    let rotX = this.rise + this.swayY * 0.8;
    let rotZ = -this.swayX * 0.6;
    if (player.sprinting && !showMelee) {
      rotX -= 0.35;
      rotZ += 0.25;
    }
    if (busy) rotX -= 0.7;
    if (this.throwT > 0) {
      this.throwT -= dt;
      const s = Math.sin((this.throwT / 0.32) * Math.PI);
      rotX += s * 0.45;
      rotZ -= s * 0.3;
      this.viewRoot.position.x += s * 0.08;
    }
    if (w && w.reloading && !showMelee) {
      const t = 1 - w.reloadT / w.reloadTime;
      const s = Math.sin(t * Math.PI);
      rotX -= s * 0.55;
      rotZ += s * 0.35;
      this.viewRoot.position.y -= s * 0.08;
    }
    this.viewRoot.rotation.x += (rotX - this.viewRoot.rotation.x) * Math.min(1, dt * 12);
    this.viewRoot.rotation.z += (rotZ - this.viewRoot.rotation.z) * Math.min(1, dt * 12);
    this.viewRoot.rotation.y = this.swayX * 0.8;

    // knife pose and swing
    const mg = m.model.group;
    if (m.swingT > 0) {
      const p = 1 - m.swingT / m.def.swingTime;
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      mg.rotation.set(-0.2 + Math.sin(p * Math.PI) * 0.3, THREE.MathUtils.lerp(0.5, -0.9, e), THREE.MathUtils.lerp(0.7, -0.9, e));
      mg.position.set(THREE.MathUtils.lerp(0.08, -0.22, e), THREE.MathUtils.lerp(-0.02, 0.04, e), -Math.sin(p * Math.PI) * 0.22);
    } else {
      mg.rotation.set(-0.1, 0.45, 0.55);
      mg.position.set(0, 0, 0);
    }
  }

  private startReload(w: WeaponInstance): void {
    if (w.reloading || w.mag >= w.magSize || w.reserve <= 0) return;
    w.reloading = true;
    w.reloadT = w.reloadTime;
    this.sfx.reloadStart();
  }

  private fire(w: WeaponInstance, player: Player): void {
    w.mag--;
    w.cooldown = 60 / w.rpm;
    w.cyclerT = 0.09;
    w.flash.fire(w.def.model === 'shotgun' ? 1.7 : w.def.model === 'pistol' ? 0.8 : w.def.model === 'railgun' || w.def.model === 'prism' ? 1.5 : 1.1);
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
        const damage = w.damage * falloff * (part === 'head' ? w.def.headMult : 1);
        this.onZombieHit?.({ object: hit.object, part, point: hit.point, direction: this.tmpDir.clone(), damage });
      } else {
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : this.tmpDir.clone().negate();
        this.sparks.emit(hit.point, n, 6, new THREE.Color(w.def.accent).lerp(new THREE.Color(0xfff0c0), 0.5), 5, 0.05, 0.35);
      }
    }
  }
}
