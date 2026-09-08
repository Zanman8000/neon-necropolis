// Throwables (grenades, throwing knives) and the loot drops that replenish them.
import * as THREE from 'three';
import type { Level } from '../world/Level';
import type { ZombieManager } from '../enemies/ZombieManager';
import type { Sfx } from '../audio/Sfx';
import type { Sparks } from '../fx/Particles';
import { buildGunModel } from './GunModels';
import { flashTexture } from '../world/Textures';

export const UTIL = {
  maxGrenades: 4,
  maxKnives: 6,
  startGrenades: 1,
  startKnives: 2,
  grenadeFuse: 2.4,
  grenadeRadius: 4.2,
  grenadeDamage: 480,
  grenadeSelfRadius: 3,
  grenadeSelfDamage: 35,
  knifeSpeed: 30,
  knifeDamage: 260,
  throwCooldown: 0.45,
  lootChance: 0.22,
  lootLife: 25,
} as const;

type ProjKind = 'grenade' | 'knife';

interface Projectile {
  kind: ProjKind;
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  led?: THREE.MeshBasicMaterial;
}

interface Loot {
  kind: 'knives' | 'grenade';
  mesh: THREE.Group;
  x: number;
  z: number;
  life: number;
}

interface Blast {
  sprite: THREE.Sprite;
  t: number;
}

const GRAVITY = 16;

export class Utilities {
  grenades: number = UTIL.startGrenades;
  knives: number = UTIL.startKnives;
  readonly group = new THREE.Group();
  private readonly projectiles: Projectile[] = [];
  private readonly loot: Loot[] = [];
  private readonly blasts: Blast[] = [];
  private cooldown = 0;
  private readonly grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  private readonly grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2e4a34, roughness: 0.6, metalness: 0.4 });
  private readonly flashTex = flashTexture();
  onGrenadeKills: ((hits: number, kills: number) => void) | null = null;
  onKnifeHit: ((killed: boolean) => void) | null = null;
  onSelfDamage: ((amount: number) => void) | null = null;
  onPickup: ((kind: 'knives' | 'grenade') => void) | null = null;

  constructor(
    private readonly sfx: Sfx,
    private readonly sparks: Sparks,
  ) {}

  reset(): void {
    for (const p of this.projectiles) this.group.remove(p.mesh);
    for (const l of this.loot) this.group.remove(l.mesh);
    for (const b of this.blasts) this.group.remove(b.sprite);
    this.projectiles.length = 0;
    this.loot.length = 0;
    this.blasts.length = 0;
    this.grenades = UTIL.startGrenades;
    this.knives = UTIL.startKnives;
    this.cooldown = 0;
  }

  get canThrow(): boolean {
    return this.cooldown <= 0;
  }

  throwGrenade(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.grenades <= 0 || this.cooldown > 0) return false;
    this.grenades--;
    this.cooldown = UTIL.throwCooldown;
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    mesh.castShadow = true;
    const led = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
    const ledMesh = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), led);
    ledMesh.position.y = 0.09;
    mesh.add(ledMesh);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 16), new THREE.MeshBasicMaterial({ color: 0x3dff8a }));
    band.rotation.x = Math.PI / 2;
    mesh.add(band);
    const vel = dir.clone().normalize().multiplyScalar(13);
    vel.y += 3.2;
    this.group.add(mesh);
    this.projectiles.push({ kind: 'grenade', mesh, pos: origin.clone(), vel, life: UTIL.grenadeFuse, led });
    this.sfx.throwWhoosh();
    return true;
  }

  throwKnife(origin: THREE.Vector3, dir: THREE.Vector3): boolean {
    if (this.knives <= 0 || this.cooldown > 0) return false;
    this.knives--;
    this.cooldown = UTIL.throwCooldown;
    const model = buildGunModel('blade', 0x22e6ff);
    model.group.scale.setScalar(1.1);
    const holder = new THREE.Group();
    holder.add(model.group);
    const d = dir.clone().normalize();
    holder.lookAt(d.clone());
    this.group.add(holder);
    this.projectiles.push({ kind: 'knife', mesh: holder, pos: origin.clone(), vel: d.multiplyScalar(UTIL.knifeSpeed), life: 1.4 });
    this.sfx.throwWhoosh();
    return true;
  }

  /** Roll a loot drop at a kill position. */
  dropLoot(x: number, z: number): void {
    if (Math.random() > UTIL.lootChance) return;
    const kind: Loot['kind'] = Math.random() < 0.6 ? 'knives' : 'grenade';
    const mesh = new THREE.Group();
    if (kind === 'knives') {
      for (const rot of [0.6, -0.6]) {
        const blade = buildGunModel('blade', 0x22e6ff);
        blade.group.rotation.set(0, rot, Math.PI / 2);
        blade.group.scale.setScalar(1.3);
        mesh.add(blade.group);
      }
    } else {
      const g = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
      g.scale.setScalar(1.6);
      mesh.add(g);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.02, 6, 16), new THREE.MeshBasicMaterial({ color: 0x3dff8a }));
      band.rotation.x = Math.PI / 2;
      mesh.add(band);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.02, 6, 24), new THREE.MeshBasicMaterial({ color: kind === 'knives' ? 0x22e6ff : 0x3dff8a }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -0.45;
    mesh.add(ring);
    mesh.position.set(x, 0.7, z);
    this.group.add(mesh);
    this.loot.push({ kind, mesh, x, z, life: UTIL.lootLife });
  }

  update(dt: number, level: Level, zombies: ZombieManager, player: { x: number; y: number; z: number }): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.kind === 'grenade') this.stepGrenade(p, dt, level);
      else this.stepKnife(p, dt, level, zombies);
      p.mesh.position.copy(p.pos);
      if (p.kind === 'grenade') {
        p.mesh.rotation.x += dt * 6;
        if (p.led) p.led.color.setHex(Math.floor(p.life * 8) % 2 === 0 ? 0xff2a2a : 0x330000);
        if (p.life <= 0) {
          this.explode(p.pos, zombies, player);
          this.group.remove(p.mesh);
          this.projectiles.splice(i, 1);
        }
      } else if (p.life <= 0) {
        this.group.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.loot.length - 1; i >= 0; i--) {
      const l = this.loot[i];
      l.life -= dt;
      l.mesh.rotation.y += dt * 2;
      l.mesh.position.y = 0.7 + Math.sin(l.life * 3) * 0.08;
      l.mesh.visible = l.life > 6 || Math.floor(l.life * 5) % 2 === 0;
      const d = Math.hypot(l.x - player.x, l.z - player.z);
      if (d < 1.3) {
        if (l.kind === 'knives') this.knives = Math.min(UTIL.maxKnives, this.knives + 2);
        else this.grenades = Math.min(UTIL.maxGrenades, this.grenades + 1);
        this.onPickup?.(l.kind);
        this.sfx.lootPickup();
        this.group.remove(l.mesh);
        this.loot.splice(i, 1);
        continue;
      }
      if (l.life <= 0) {
        this.group.remove(l.mesh);
        this.loot.splice(i, 1);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      const k = Math.max(0, b.t / 0.3);
      b.sprite.scale.setScalar(4 + (1 - k) * 3);
      (b.sprite.material as THREE.SpriteMaterial).opacity = k;
      if (b.t <= 0) {
        this.group.remove(b.sprite);
        this.blasts.splice(i, 1);
      }
    }
  }

  private stepGrenade(p: Projectile, dt: number, level: Level): void {
    p.vel.y -= GRAVITY * dt;
    // horizontal movement with wall bounces
    const nx = p.pos.x + p.vel.x * dt;
    if (level.isBlockedFor(Math.floor(nx / 2), Math.floor(p.pos.z / 2), p.pos.y)) {
      p.vel.x *= -0.4;
      this.sfx.grenadeBounce(p.pos.x, p.pos.z);
    } else p.pos.x = nx;
    const nz = p.pos.z + p.vel.z * dt;
    if (level.isBlockedFor(Math.floor(p.pos.x / 2), Math.floor(nz / 2), p.pos.y)) {
      p.vel.z *= -0.4;
      this.sfx.grenadeBounce(p.pos.x, p.pos.z);
    } else p.pos.z = nz;
    p.pos.y += p.vel.y * dt;
    const ground = level.groundAt(p.pos.x, p.pos.z, 0.08, p.pos.y) + 0.09;
    if (p.pos.y <= ground) {
      p.pos.y = ground;
      if (p.vel.y < -1.5) this.sfx.grenadeBounce(p.pos.x, p.pos.z);
      p.vel.y = Math.abs(p.vel.y) > 1 ? -p.vel.y * 0.35 : 0;
      p.vel.x *= 0.6;
      p.vel.z *= 0.6;
    }
  }

  private stepKnife(p: Projectile, dt: number, level: Level, zombies: ZombieManager): void {
    p.vel.y -= 6 * dt;
    const next = p.pos.clone().addScaledVector(p.vel, dt);
    const hit = zombies.hitAt(next.x, next.y, next.z, 0.45);
    if (hit) {
      const killed = zombies.damageZombie(hit, UTIL.knifeDamage, next.y > hit.y + 1.55);
      this.onKnifeHit?.(killed);
      this.sfx.knifeHit(next.x, next.z);
      p.life = 0;
      return;
    }
    if (next.y <= 0.02 || level.isBlockedFor(Math.floor(next.x / 2), Math.floor(next.z / 2), next.y)) {
      this.sparks.emit(p.pos, p.vel.clone().normalize().negate(), 6, new THREE.Color(0x9ec4ff), 4, 0.04, 0.3);
      this.sfx.knifeClatter(next.x, next.z);
      p.life = 0;
      return;
    }
    p.pos.copy(next);
    p.mesh.rotation.x += dt * 18;
  }

  private explode(at: THREE.Vector3, zombies: ZombieManager, player: { x: number; y: number; z: number }): void {
    const res = zombies.areaDamage(at.x, at.z, UTIL.grenadeRadius, UTIL.grenadeDamage);
    this.onGrenadeKills?.(res.hits, res.kills);
    this.sfx.explosion(at.x, at.z);
    this.sparks.emit(at, new THREE.Vector3(0, 1, 0), 60, new THREE.Color(0xffb060), 9, 0.1, 0.9);
    this.sparks.emit(at, new THREE.Vector3(0, 0.3, 0), 30, new THREE.Color(0xfff2c0), 14, 0.06, 0.4);
    const mat = new THREE.SpriteMaterial({ map: this.flashTex, color: new THREE.Color(2.5, 1.6, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(at).setY(at.y + 0.6);
    sprite.scale.setScalar(4);
    this.group.add(sprite);
    this.blasts.push({ sprite, t: 0.3 });
    const d = Math.hypot(player.x - at.x, player.z - at.z);
    if (d < UTIL.grenadeSelfRadius) this.onSelfDamage?.(UTIL.grenadeSelfDamage * (1 - d / UTIL.grenadeSelfRadius));
  }
}
