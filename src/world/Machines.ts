// Interactive machines that make up the loop: perk vendors, the power lever,
// the overclock station and the roaming salvage crate.
import * as THREE from 'three';
import { CELL, cellCenter, type PerkDef, type CrateDef, type StationDef } from './Grid';
import * as Tex from './Textures';
import {
  PERKS,
  CRATE_COST,
  CRATE_ROLL_TIME,
  CRATE_OFFER_TIME,
  CRATE_MOVE_CHANCE,
  CRATE_MOVE_MIN_USES,
  UPGRADE_COST,
  UPGRADE_TIME,
  type PerkInfo,
} from '../game/Rules';
import { buildGunModel, type GunModel } from '../weapons/GunModels';
import { BOX_POOL, rollBoxWeapon, type WeaponDef } from '../weapons/WeaponDefs';

/** Emissive material helpers provided by the level so machine glow follows the neon setting. */
export interface Emissives {
  create(color: number, intensity?: number): THREE.MeshBasicMaterial;
  register(mat: THREE.MeshBasicMaterial): void;
  dim(mat: THREE.MeshBasicMaterial, k: number): void;
}

export interface MachineMaterials {
  metalDark: THREE.Material;
  steel: THREE.Material;
  fixture: THREE.Material;
  concrete: THREE.Material;
}

function facingRotation(wallDir: { x: number; z: number }): number {
  // local +z faces away from the wall, into the room
  return Math.atan2(-wallDir.x, -wallDir.z);
}

function shadowed(m: THREE.Mesh): THREE.Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- perk machine

export class PerkMachine {
  readonly group = new THREE.Group();
  readonly pos: { x: number; z: number };
  readonly info: PerkInfo;
  private readonly glow: THREE.MeshBasicMaterial[] = [];
  private powered = false;
  private time = Math.random() * 10;

  constructor(
    readonly def: PerkDef,
    em: Emissives,
    mats: MachineMaterials,
  ) {
    this.info = PERKS[def.kind];
    const c = cellCenter(def.x, def.z);
    this.pos = c;
    const depth = 0.85;
    this.group.position.set(c.x + def.wallDir.x * (CELL / 2 - depth / 2 - 0.03), 0, c.z + def.wallDir.z * (CELL / 2 - depth / 2 - 0.03));
    this.group.rotation.y = facingRotation(def.wallDir);
    const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.15, depth), mats.metalDark));
    body.position.y = 1.075;
    this.group.add(body);
    const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, depth + 0.1), mats.fixture));
    base.position.y = 0.06;
    this.group.add(base);
    const color = this.info.color;
    const panelTex = Tex.hologramTexture([this.info.name, `${this.info.cost}`], color, 512, 320);
    const panelMat = new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, color: new THREE.Color(1.0, 1.0, 1.0), depthWrite: false });
    em.register(panelMat);
    this.glow.push(panelMat);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), panelMat);
    panel.position.set(0, 1.62, depth / 2 + 0.01);
    this.group.add(panel);
    const descTex = Tex.hologramTexture([this.info.desc], color, 512, 128);
    const descMat = new THREE.MeshBasicMaterial({ map: descTex, transparent: true, color: new THREE.Color(0.8, 0.8, 0.8), depthWrite: false });
    em.register(descMat);
    this.glow.push(descMat);
    const desc = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), descMat);
    desc.position.set(0, 1.2, depth / 2 + 0.01);
    this.group.add(desc);
    // dispenser window with a glowing canister inside
    const win = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.2), mats.fixture));
    win.position.set(0, 0.62, depth / 2 - 0.1);
    this.group.add(win);
    const canMat = em.create(color, 1.2);
    this.glow.push(canMat);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 10), canMat);
    can.position.set(0, 0.62, depth / 2 - 0.02);
    this.group.add(can);
    const stripMat = em.create(color, 1.2);
    this.glow.push(stripMat);
    for (const sx of [-0.56, 0.56]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.0, 0.03), stripMat);
      strip.position.set(sx, 1.075, depth / 2 - 0.02);
      this.group.add(strip);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.05), stripMat);
    top.position.set(0, 2.12, depth / 2 - 0.02);
    this.group.add(top);
    this.em = em;
    this.setPower(false);
  }

  private readonly em: Emissives;

  setPower(on: boolean): void {
    this.powered = on;
    for (const m of this.glow) this.em.dim(m, on ? 1 : 0.08);
  }

  update(dt: number): void {
    if (!this.powered) return;
    this.time += dt;
    const k = 0.9 + 0.1 * Math.sin(this.time * 2.5);
    this.em.dim(this.glow[2], k);
  }
}

// ---------------------------------------------------------------- power lever

export class PowerLever {
  readonly group = new THREE.Group();
  readonly pos: { x: number; z: number };
  on = false;
  private readonly arm: THREE.Mesh;
  private readonly offMat: THREE.MeshBasicMaterial;
  private readonly onMat: THREE.MeshBasicMaterial;
  private anim = 0;

  constructor(
    readonly def: StationDef,
    private readonly em: Emissives,
    mats: MachineMaterials,
  ) {
    const c = cellCenter(def.x, def.z);
    this.pos = c;
    this.group.position.set(c.x + def.wallDir.x * (CELL / 2 - 0.1), 0, c.z + def.wallDir.z * (CELL / 2 - 0.1));
    this.group.rotation.y = facingRotation(def.wallDir);
    const panel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.1, 0.18), mats.fixture));
    panel.position.set(0, 1.45, 0);
    this.group.add(panel);
    const labelTex = Tex.hologramTexture(['MAIN POWER'], 0xffb020, 512, 128);
    const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, color: new THREE.Color(1.1, 1.1, 1.1), depthWrite: false });
    em.register(labelMat);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.76, 0.19), labelMat);
    label.position.set(0, 2.12, 0.1);
    this.group.add(label);
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.35, 0.1);
    this.group.add(pivot);
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), mats.steel);
    this.arm.position.y = 0.27;
    pivot.add(this.arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mats.steel);
    knob.position.y = 0.55;
    this.arm.add(knob);
    knob.position.y = 0.27;
    this.pivot = pivot;
    pivot.rotation.x = -0.6; // lever up = off
    this.offMat = em.create(0xff2a4a, 1.3);
    this.onMat = em.create(0x3dff8a, 1.3);
    const off = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), this.offMat);
    off.position.set(-0.22, 1.85, 0.1);
    this.group.add(off);
    const on = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), this.onMat);
    on.position.set(0.22, 1.85, 0.1);
    this.group.add(on);
    this.em.dim(this.onMat, 0.08);
  }

  private readonly pivot: THREE.Group;

  activate(): void {
    if (this.on) return;
    this.on = true;
    this.em.dim(this.offMat, 0.08);
    this.em.dim(this.onMat, 1);
  }

  reset(): void {
    this.on = false;
    this.anim = 0;
    this.pivot.rotation.x = -0.6;
    this.em.dim(this.offMat, 1);
    this.em.dim(this.onMat, 0.08);
  }

  update(dt: number): void {
    if (this.on && this.anim < 1) {
      this.anim = Math.min(1, this.anim + dt * 2.2);
      this.pivot.rotation.x = -0.6 + this.anim * 1.2;
    }
  }
}

// ---------------------------------------------------------------- overclock station

export interface HeldWeapon {
  def: WeaponDef;
  slot: number;
}

export class UpgradeStation {
  readonly group = new THREE.Group();
  readonly pos: { x: number; z: number };
  state: 'idle' | 'working' | 'ready' = 'idle';
  held: HeldWeapon | null = null;
  private timer = 0;
  private powered = false;
  private display: GunModel | null = null;
  private readonly chamber = new THREE.Group();
  private readonly glow: THREE.MeshBasicMaterial[] = [];
  private readonly coreMat: THREE.MeshBasicMaterial;
  private time = 0;
  onSpark: ((p: THREE.Vector3) => void) | null = null;

  constructor(
    readonly def: StationDef,
    private readonly em: Emissives,
    mats: MachineMaterials,
  ) {
    const c = cellCenter(def.x, def.z);
    this.pos = c;
    const depth = 1.3;
    this.group.position.set(c.x + def.wallDir.x * (CELL / 2 - depth / 2 - 0.03), 0, c.z + def.wallDir.z * (CELL / 2 - depth / 2 - 0.03));
    this.group.rotation.y = facingRotation(def.wallDir);
    const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, depth + 0.2), mats.metalDark));
    base.position.y = 0.25;
    this.group.add(base);
    const back = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.3, 0.35), mats.metalDark));
    back.position.set(0, 1.15, -depth / 2 + 0.175);
    this.group.add(back);
    for (const sx of [-0.85, 0.85]) {
      const pillar = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.3, depth), mats.fixture));
      pillar.position.set(sx, 1.15, 0);
      this.group.add(pillar);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8), mats.steel);
      pipe.position.set(sx * 1.08, 1.2, 0.2);
      this.group.add(pipe);
    }
    const top = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.3, depth), mats.metalDark));
    top.position.y = 2.15;
    this.group.add(top);
    this.coreMat = em.create(0xff3ea5, 1.3);
    this.glow.push(this.coreMat);
    const core = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 8, 40), this.coreMat);
    core.position.set(0, 1.25, -0.2);
    this.group.add(core);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 8, 40), this.coreMat);
    ring2.position.set(0, 1.25, -0.25);
    this.group.add(ring2);
    const sign = Tex.hologramTexture(['OVERCLOCK STATION', `${UPGRADE_COST}`], 0xff3ea5, 512, 200);
    const signMat = new THREE.MeshBasicMaterial({ map: sign, transparent: true, color: new THREE.Color(1.0, 1.0, 1.0), depthWrite: false });
    em.register(signMat);
    this.glow.push(signMat);
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.58), signMat);
    signMesh.position.set(0, 2.62, 0.2);
    this.group.add(signMesh);
    const stripMat = em.create(0xff3ea5, 1.1);
    this.glow.push(stripMat);
    for (const sx of [-0.85, 0.85]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.9, 0.03), stripMat);
      strip.position.set(sx, 1.15, depth / 2 - 0.02);
      this.group.add(strip);
    }
    this.chamber.position.set(0, 1.25, 0.05);
    this.group.add(this.chamber);
    this.setPower(false);
  }

  setPower(on: boolean): void {
    this.powered = on;
    for (const m of this.glow) this.em.dim(m, on ? 1 : 0.08);
  }

  get isPowered(): boolean {
    return this.powered;
  }

  /** Put a weapon into the machine. */
  begin(def: WeaponDef, slot: number): void {
    this.held = { def, slot };
    this.state = 'working';
    this.timer = UPGRADE_TIME;
    this.display = buildGunModel(def.model, def.accent);
    this.display.group.scale.setScalar(1.4);
    this.chamber.add(this.display.group);
  }

  /** Remove the finished weapon. Returns null unless one is ready. */
  take(): HeldWeapon | null {
    if (this.state !== 'ready' || !this.held) return null;
    const h = this.held;
    this.held = null;
    this.state = 'idle';
    if (this.display) this.chamber.remove(this.display.group);
    this.display = null;
    return h;
  }

  reset(): void {
    this.held = null;
    this.state = 'idle';
    if (this.display) this.chamber.remove(this.display.group);
    this.display = null;
    this.setPower(false);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.state === 'working') {
      this.timer -= dt;
      if (this.display) {
        this.display.group.rotation.y += dt * 9;
        this.display.group.rotation.x = Math.sin(this.time * 7) * 0.4;
        this.display.group.position.y = Math.sin(this.time * 11) * 0.05;
      }
      this.em.dim(this.coreMat, 1 + 0.8 * Math.abs(Math.sin(this.time * 12)));
      if (Math.random() < dt * 14 && this.onSpark) {
        const p = new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 0.1);
        this.chamber.localToWorld(p);
        this.onSpark(p);
      }
      if (this.timer <= 0) {
        this.state = 'ready';
        this.em.dim(this.coreMat, 1);
        if (this.display) {
          this.display.accent.color.multiplyScalar(1.8);
          this.display.group.rotation.x = 0;
          this.display.group.position.set(0, 0, 0.45);
        }
      }
    } else if (this.state === 'ready' && this.display) {
      this.display.group.rotation.y += dt * 1.2;
      this.display.group.position.y = Math.sin(this.time * 2) * 0.05;
    }
  }
}

// ---------------------------------------------------------------- salvage crate

export type CrateState = 'closed' | 'rolling' | 'offer' | 'moving' | 'closing';

export class SalvageCrate {
  readonly group = new THREE.Group();
  readonly padGroup = new THREE.Group();
  state: CrateState = 'closed';
  offered: WeaponDef | null = null;
  uses = 0;
  private padIndex = 0;
  private timer = 0;
  private tick = 0;
  private lidT = 0;
  private lidTarget = 0;
  private readonly lid: THREE.Mesh;
  private readonly beacon: THREE.Mesh;
  private readonly displays = new Map<string, GunModel>();
  private readonly displayRoot = new THREE.Group();
  private readonly hazard: THREE.Mesh;
  private readonly seamMat: THREE.MeshBasicMaterial;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly padMats: THREE.MeshBasicMaterial[] = [];
  private time = 0;
  onRefund: (() => void) | null = null;
  onTick: (() => void) | null = null;
  onOffer: ((def: WeaponDef) => void) | null = null;
  onMove: (() => void) | null = null;

  constructor(
    readonly pads: CrateDef[],
    private readonly em: Emissives,
    mats: MachineMaterials,
  ) {
    for (const pad of pads) {
      const c = cellCenter(pad.x, pad.z);
      const base = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 1.9), mats.concrete));
      base.position.set(c.x, 0.07, c.z);
      this.padGroup.add(base);
      const rimMat = em.create(0xffb020, 0.9);
      this.padMats.push(rimMat);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.03, 1.95), rimMat);
      rim.position.set(c.x, 0.15, c.z);
      // hollow look: a slightly smaller dark box on top hides the middle of the rim
      const inner = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.04, 1.75), mats.fixture);
      inner.position.set(c.x, 0.155, c.z);
      this.padGroup.add(rim);
      this.padGroup.add(inner);
    }
    // crate body
    const body = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.9), mats.metalDark));
    body.position.y = 0.17 + 0.375;
    this.group.add(body);
    this.seamMat = em.create(0xffb020, 1.2);
    for (const sz of [-0.46, 0.46]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.03, 0.02), this.seamMat);
      seam.position.set(0, 0.17 + 0.72, sz);
      this.group.add(seam);
    }
    for (const sx of [-0.76, 0.76]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.92), this.seamMat);
      seam.position.set(sx, 0.17 + 0.72, 0);
      this.group.add(seam);
    }
    const label = Tex.hologramTexture(['SALVAGE', `${CRATE_COST}`], 0xffb020, 256, 160);
    const labelMat = new THREE.MeshBasicMaterial({ map: label, transparent: true, color: new THREE.Color(1, 1, 1), depthWrite: false });
    em.register(labelMat);
    for (const side of [1, -1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.42), labelMat);
      m.position.set(0, 0.55, side * 0.46);
      m.rotation.y = side > 0 ? 0 : Math.PI;
      this.group.add(m);
    }
    // lid hinged at the back edge
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.17 + 0.75, -0.45);
    this.group.add(hinge);
    this.lid = shadowed(new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.1, 0.92), mats.fixture));
    this.lid.position.set(0, 0.05, 0.45);
    hinge.add(this.lid);
    this.hinge = hinge;
    this.displayRoot.position.set(0, 1.35, 0);
    this.group.add(this.displayRoot);
    for (const w of BOX_POOL) {
      const model = buildGunModel(w.model, w.accent);
      model.group.scale.setScalar(1.6);
      model.group.visible = false;
      this.displayRoot.add(model.group);
      this.displays.set(w.id, model);
    }
    this.hazard = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), em.create(0xff2a4a, 1.4));
    this.hazard.visible = false;
    this.displayRoot.add(this.hazard);
    // beacon: a tall light column visible across the map
    this.beaconMat = em.create(0xffb020, 0.7);
    const beaconGeo = new THREE.CylinderGeometry(0.06, 0.12, 60, 8, 1, true);
    beaconGeo.translate(0, 30, 0);
    this.beacon = new THREE.Mesh(beaconGeo, this.beaconMat);
    this.beacon.position.set(0, 0.9, 0);
    this.group.add(this.beacon);
    this.placeOnPad(0);
  }

  private readonly hinge: THREE.Group;

  get pos(): { x: number; z: number } {
    return cellCenter(this.pads[this.padIndex].x, this.pads[this.padIndex].z);
  }

  get padIndexPublic(): number {
    return this.padIndex;
  }

  get zone(): number {
    return this.pads[this.padIndex].zone;
  }

  private placeOnPad(i: number): void {
    this.padIndex = i;
    const c = this.pos;
    this.group.position.set(c.x, 0, c.z);
    this.padMats.forEach((m, k) => this.em.dim(m, k === i ? 1 : 0.15));
  }

  reset(rnd: number): void {
    this.state = 'closed';
    this.offered = null;
    this.uses = 0;
    this.lidT = 0;
    this.lidTarget = 0;
    this.hinge.rotation.x = 0;
    this.hideDisplays();
    this.placeOnPad(Math.floor(rnd * this.pads.length) % this.pads.length);
  }

  private hideDisplays(): void {
    for (const m of this.displays.values()) m.group.visible = false;
    this.hazard.visible = false;
  }

  /** Start a roll. The caller has already paid. */
  open(rnd: number): void {
    if (this.state !== 'closed') return;
    this.uses++;
    const move = this.uses > CRATE_MOVE_MIN_USES && rnd < CRATE_MOVE_CHANCE;
    this.offered = move ? null : rollBoxWeapon(Math.random());
    this.state = 'rolling';
    this.timer = CRATE_ROLL_TIME;
    this.tick = 0;
    this.lidTarget = 1;
  }

  /** Take the offered weapon. */
  take(): WeaponDef | null {
    if (this.state !== 'offer' || !this.offered) return null;
    const w = this.offered;
    this.offered = null;
    this.state = 'closing';
    this.lidTarget = 0;
    this.hideDisplays();
    return w;
  }

  update(dt: number): void {
    this.time += dt;
    // lid animation
    if (this.lidT !== this.lidTarget) {
      this.lidT += Math.sign(this.lidTarget - this.lidT) * dt * 2.2;
      this.lidT = Math.max(0, Math.min(1, this.lidT));
      this.hinge.rotation.x = -this.lidT * 1.9;
    }
    this.em.dim(this.beaconMat, 0.55 + 0.25 * Math.sin(this.time * 2));
    switch (this.state) {
      case 'rolling': {
        this.timer -= dt;
        this.tick -= dt;
        if (this.tick <= 0) {
          this.tick = 0.08 + (1 - this.timer / CRATE_ROLL_TIME) * 0.22;
          this.hideDisplays();
          const pool = [...this.displays.values()];
          const m = pool[Math.floor(Math.random() * pool.length)];
          m.group.visible = true;
          m.group.rotation.set(0, Math.random() * Math.PI * 2, 0.1);
          m.group.position.set(0, 0.15 * (1 - this.timer / CRATE_ROLL_TIME), 0);
          this.onTick?.();
        }
        if (this.timer <= 0) {
          this.hideDisplays();
          if (this.offered) {
            const m = this.displays.get(this.offered.id)!;
            m.group.visible = true;
            m.group.position.set(0, 0.2, 0);
            this.state = 'offer';
            this.timer = CRATE_OFFER_TIME;
            this.onOffer?.(this.offered);
          } else {
            this.hazard.visible = true;
            this.state = 'moving';
            this.timer = 1.8;
            this.onMove?.();
          }
        }
        break;
      }
      case 'offer': {
        this.timer -= dt;
        const m = this.offered ? this.displays.get(this.offered.id) : null;
        if (m) {
          m.group.rotation.y += dt * 1.3;
          m.group.position.y = 0.2 + Math.sin(this.time * 2.2) * 0.05;
          if (this.timer < 2.5) m.group.visible = Math.floor(this.timer * 6) % 2 === 0;
        }
        if (this.timer <= 0) {
          this.offered = null;
          this.hideDisplays();
          this.state = 'closing';
          this.lidTarget = 0;
        }
        break;
      }
      case 'moving': {
        this.timer -= dt;
        this.hazard.rotation.y += dt * 4;
        this.hazard.position.y = 0.2 + Math.sin(this.time * 6) * 0.08;
        if (this.timer <= 0) {
          this.hazard.visible = false;
          this.lidTarget = 0;
          this.state = 'closing';
          let next = this.padIndex;
          if (this.pads.length > 1) while (next === this.padIndex) next = Math.floor(Math.random() * this.pads.length);
          this.placeOnPad(next);
          this.lidT = 0;
          this.hinge.rotation.x = 0;
          this.onRefund?.();
        }
        break;
      }
      case 'closing': {
        if (this.lidT <= 0) this.state = 'closed';
        break;
      }
      default:
        break;
    }
  }
}
