// Horde controller: rounds, spawning through barricades and floor pods, flow-field chasing, attacks.
import * as THREE from 'three';
import { Zombie } from './Zombie';
import { FlowField } from './FlowField';
import type { Level, WindowState, PodState } from '../world/Level';
import type { Sfx } from '../audio/Sfx';
import type { Sparks } from '../fx/Particles';
import type { Player } from '../player/Player';
import type { ZombieHit } from '../weapons/Weapons';
import { cellCenter, worldToCell, moveWithCollision } from '../world/Grid';
import {
  MAX_ALIVE,
  ZOMBIE,
  TIER_SPEED,
  zombieHealthForRound,
  zombiesForRound,
  spawnIntervalForRound,
  intermissionForRound,
  pickTier,
} from '../game/Rules';

const ICHOR = new THREE.Color(0x5a1030);
const SPARK = new THREE.Color(0x22e6ff);

export class ZombieManager {
  readonly zombies: Zombie[] = [];
  readonly group = new THREE.Group();
  round = 0;
  roundActive = false;
  toSpawn = 0;
  alive = 0;
  kills = 0;
  intermission = 0;
  private spawnTimer = 0;
  private readonly field: FlowField;
  private fieldT = 0;
  private fieldDirty = true;
  private lastCell = { x: -1, z: -1 };
  private targets: THREE.Object3D[] = [];
  private targetsDirty = true;
  /** While true every hit is lethal. */
  instaKill = false;
  onRoundStart: ((round: number) => void) | null = null;
  onRoundEnd: ((round: number) => void) | null = null;
  onKill: ((zombie: Zombie, headshot: boolean) => void) | null = null;

  constructor(
    private readonly level: Level,
    private readonly sfx: Sfx,
    private readonly sparks: Sparks,
  ) {
    this.field = new FlowField(level.data.width, level.data.height);
  }

  start(): void {
    this.reset();
    this.intermission = intermissionForRound(1);
  }

  reset(): void {
    for (const z of this.zombies) {
      z.state = 'idle';
      z.root.visible = false;
    }
    this.round = 0;
    this.roundActive = false;
    this.toSpawn = 0;
    this.alive = 0;
    this.kills = 0;
    this.intermission = 0;
    this.spawnTimer = 0;
    this.fieldDirty = true;
    this.targetsDirty = true;
  }

  invalidateField(): void {
    this.fieldDirty = true;
  }

  getTargets(): THREE.Object3D[] {
    if (this.targetsDirty) {
      this.targets = this.zombies.filter((z) => z.active).map((z) => z.root);
      this.targetsDirty = false;
    }
    return this.targets;
  }

  /** Apply a bullet hit. Returns null when the target is no longer valid. */
  applyDamage(hit: ZombieHit): { zombie: Zombie; killed: boolean; headshot: boolean } | null {
    const z = (hit.object.userData as { zombie?: Zombie }).zombie;
    if (!z || !z.active) return null;
    z.health -= this.instaKill ? z.health : hit.damage;
    z.hitFlash();
    const n = hit.direction.clone().negate();
    this.sparks.emit(hit.point, n, 5, ICHOR, 2.5, 0.07, 0.6);
    if (hit.part === 'head') this.sparks.emit(hit.point, n, 4, SPARK, 4, 0.04, 0.3);
    this.sfx.zombieHit(z.pos.x, z.pos.z);
    const headshot = hit.part === 'head';
    if (z.health <= 0) {
      this.kill(z, headshot);
      return { zombie: z, killed: true, headshot };
    }
    return { zombie: z, killed: false, headshot };
  }

  /** Swing a melee weapon from the player. Hits up to two zombies in the arc. Returns what was hit. */
  meleeHit(px: number, pz: number, fx: number, fz: number, range: number, arcCos: number, damage: number): { zombie: Zombie; killed: boolean }[] {
    const cands: { z: Zombie; d: number }[] = [];
    for (const z of this.zombies) {
      if (!z.active) continue;
      const dx = z.pos.x - px;
      const dz = z.pos.z - pz;
      const d = Math.hypot(dx, dz);
      if (d > range + ZOMBIE.radius) continue;
      if (d > 0.01 && (dx / d) * fx + (dz / d) * fz < arcCos) continue;
      cands.push({ z, d });
    }
    cands.sort((a, b) => a.d - b.d);
    const out: { zombie: Zombie; killed: boolean }[] = [];
    for (const { z } of cands.slice(0, 2)) {
      z.health -= this.instaKill ? z.health : damage;
      z.hitFlash();
      const p = new THREE.Vector3(z.pos.x, z.y + 1.3, z.pos.z);
      const n = new THREE.Vector3(z.pos.x - px, 0.3, z.pos.z - pz).normalize();
      this.sparks.emit(p, n, 8, ICHOR, 3, 0.07, 0.6);
      this.sfx.zombieHit(z.pos.x, z.pos.z);
      const killed = z.health <= 0;
      if (killed) this.kill(z, false);
      out.push({ zombie: z, killed });
    }
    return out;
  }

  /** Kill every active zombie (nuke). No per-kill callbacks fire. */
  killAll(): number {
    let n = 0;
    for (const z of this.zombies) {
      if (!z.active) continue;
      this.kill(z, false, true);
      n++;
    }
    return n;
  }

  private kill(z: Zombie, headshot: boolean, silent = false): void {
    z.state = 'dying';
    z.timer = ZOMBIE.dieTime;
    z.fallDir = Math.random() < 0.8 ? 1 : -1;
    z.health = 0;
    this.alive--;
    this.kills++;
    this.targetsDirty = true;
    this.sfx.zombieDie(z.pos.x, z.pos.z);
    if (!silent) this.onKill?.(z, headshot);
  }

  update(dt: number, player: Player): void {
    // rounds
    if (!this.roundActive) {
      if (this.intermission > 0) {
        this.intermission -= dt;
        if (this.intermission <= 0) this.beginRound();
      }
    } else {
      this.spawnTimer -= dt;
      if (this.toSpawn > 0 && this.alive < MAX_ALIVE && this.spawnTimer <= 0) {
        if (this.spawnOne(player)) {
          this.toSpawn--;
          this.spawnTimer = spawnIntervalForRound(this.round) * (0.7 + Math.random() * 0.6);
        } else {
          this.spawnTimer = 0.5;
        }
      }
      if (this.toSpawn === 0 && this.alive === 0) {
        this.roundActive = false;
        this.intermission = intermissionForRound(this.round + 1);
        this.onRoundEnd?.(this.round);
      }
    }

    // flow field
    const pc = worldToCell(player.pos.x, player.pos.z);
    this.fieldT -= dt;
    if (this.fieldDirty || this.fieldT <= 0 || pc.x !== this.lastCell.x || pc.z !== this.lastCell.z) {
      this.field.compute(this.level.walkable, pc.x, pc.z);
      this.lastCell = pc;
      this.fieldT = 0.35;
      this.fieldDirty = false;
    }

    for (const z of this.zombies) {
      if (z.state === 'idle') continue;
      this.updateZombie(z, dt, player);
    }
    this.separate(dt, player);
    for (const z of this.zombies) if (z.state !== 'idle') z.update(dt);
  }

  private beginRound(): void {
    this.round++;
    this.toSpawn = zombiesForRound(this.round);
    this.roundActive = true;
    this.spawnTimer = 1.2;
    this.onRoundStart?.(this.round);
  }

  private freeZombie(): Zombie | null {
    for (const z of this.zombies) if (z.state === 'idle') return z;
    if (this.zombies.length < MAX_ALIVE + 6) {
      const z = new Zombie(this.zombies.length);
      this.zombies.push(z);
      this.group.add(z.root);
      return z;
    }
    return null;
  }

  private spawnOne(player: Player): boolean {
    type Cand = { kind: 'window'; w: WindowState; d: number } | { kind: 'pod'; p: PodState; d: number };
    const cands: Cand[] = [];
    const px = player.pos.x;
    const pz = player.pos.z;
    for (const w of this.level.windows) {
      if (!this.level.activeZones.has(w.def.zone)) continue;
      const queued = this.zombies.filter((z) => z.window === w && (z.state === 'approach' || z.state === 'tearing' || z.state === 'climb')).length;
      if (queued >= 3) continue;
      cands.push({ kind: 'window', w, d: Math.hypot(w.insidePos.x - px, w.insidePos.z - pz) });
    }
    for (const p of this.level.pods) {
      if (!this.level.activeZones.has(p.def.zone)) continue;
      const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
      if (d < 7) continue; // never rise right next to the player
      cands.push({ kind: 'pod', p, d: d + 6 });
    }
    if (cands.length === 0) return false;
    cands.sort((a, b) => a.d - b.d);
    const top = cands.slice(0, 5);
    const weights = top.map((_, i) => top.length - i);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    let pick = top[0];
    for (let i = 0; i < top.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pick = top[i];
        break;
      }
    }
    const z = this.freeZombie();
    if (!z) return false;
    z.randomizeLook();
    z.maxHealth = zombieHealthForRound(this.round);
    z.health = z.maxHealth;
    z.tier = pickTier(this.round, Math.random());
    z.speed = TIER_SPEED[z.tier] * (0.9 + Math.random() * 0.2);
    z.window = null;
    z.pod = null;
    z.y = 0;
    if (pick.kind === 'window') {
      z.window = pick.w;
      z.pos = { x: pick.w.outsidePos.x + (Math.random() - 0.5) * 0.8, z: pick.w.outsidePos.z + (Math.random() - 0.5) * 0.8 };
      z.state = 'approach';
      z.yaw = z.targetYaw = Math.atan2(-pick.w.def.dir.x, -pick.w.def.dir.z);
    } else {
      z.pod = pick.p;
      z.pos = { x: pick.p.pos.x + (Math.random() - 0.5) * 0.4, z: pick.p.pos.z + (Math.random() - 0.5) * 0.4 };
      z.state = 'rise';
      z.timer = ZOMBIE.riseTime;
      z.y = -2;
      z.yaw = z.targetYaw = Math.random() * Math.PI * 2;
      this.sfx.zombieRise(z.pos.x, z.pos.z);
    }
    z.root.visible = true;
    z.update(0);
    this.alive++;
    this.targetsDirty = true;
    return true;
  }

  private updateZombie(z: Zombie, dt: number, player: Player): void {
    const px = player.pos.x;
    const pz = player.pos.z;
    const dx = px - z.pos.x;
    const dz = pz - z.pos.z;
    const dist = Math.hypot(dx, dz);
    z.cooldown = Math.max(0, z.cooldown - dt);

    if (z.active) {
      z.groanT -= dt;
      if (z.groanT <= 0) {
        z.groanT = 2.5 + Math.random() * 5;
        if (dist < 35) this.sfx.zombieGroan(z.pos.x, z.pos.z, z.tier === 'sprint' ? 1.3 : z.tier === 'jog' ? 1.08 : 0.9);
      }
    }

    switch (z.state) {
      case 'approach': {
        const w = z.window!;
        const tx = w.tearPos.x - z.pos.x;
        const tz = w.tearPos.z - z.pos.z;
        const d = Math.hypot(tx, tz);
        if (d < 0.12) {
          z.state = 'tearing';
          z.timer = ZOMBIE.tearInterval * 0.5;
        } else {
          const step = Math.min(d, z.speed * dt);
          z.pos.x += (tx / d) * step;
          z.pos.z += (tz / d) * step;
          z.targetYaw = Math.atan2(-tx, -tz);
        }
        break;
      }
      case 'tearing': {
        const w = z.window!;
        z.targetYaw = Math.atan2(-w.def.dir.x, -w.def.dir.z);
        if (w.planks <= 0) {
          z.state = 'climb';
          z.timer = ZOMBIE.climbTime;
          z.climbFrom = { ...z.pos };
          z.climbTo = { x: w.insidePos.x + (Math.random() - 0.5) * 0.6, z: w.insidePos.z + (Math.random() - 0.5) * 0.6 };
          break;
        }
        z.timer -= dt;
        if (z.timer <= 0) {
          z.timer = ZOMBIE.tearInterval * (0.8 + Math.random() * 0.4);
          if (this.level.tearPlank(w)) this.sfx.tearPlank(w.pos.x, w.pos.z);
        }
        break;
      }
      case 'climb': {
        z.timer -= dt;
        const p = 1 - Math.max(0, z.timer) / ZOMBIE.climbTime;
        z.pos.x = z.climbFrom.x + (z.climbTo.x - z.climbFrom.x) * p;
        z.pos.z = z.climbFrom.z + (z.climbTo.z - z.climbFrom.z) * p;
        if (z.timer <= 0) {
          z.state = 'chase';
          z.window = null;
        }
        break;
      }
      case 'rise': {
        z.timer -= dt;
        z.y = -2 * Math.max(0, z.timer) / ZOMBIE.riseTime;
        if (z.timer <= 0) {
          z.y = 0;
          z.state = 'chase';
        }
        break;
      }
      case 'chase': {
        if (!player.alive || player.downed) {
          z.targetYaw = Math.atan2(-dx, -dz);
          if (player.downed && dist < 3.5) {
            // wander off a little while the player is down
            moveWithCollision(z.pos, (-dx / (dist || 1)) * z.speed * 0.5 * dt, (-dz / (dist || 1)) * z.speed * 0.5 * dt, ZOMBIE.radius, this.level.isBlocked);
          }
          break;
        }
        if (dist < ZOMBIE.attackRange && z.cooldown <= 0 && !player.downed) {
          z.state = 'attack';
          z.timer = ZOMBIE.attackWindup;
          this.sfx.zombieAttack(z.pos.x, z.pos.z);
          break;
        }
        let dirX: number;
        let dirZ: number;
        if (dist < 22 && this.level.hasLineOfSight(z.pos.x, z.pos.z, px, pz)) {
          dirX = dx / dist;
          dirZ = dz / dist;
        } else {
          const c = worldToCell(z.pos.x, z.pos.z);
          const best = this.field.bestNeighbor(c.x, c.z, this.level.walkable);
          if (best) {
            const cc = cellCenter(best.x, best.z);
            const tx = cc.x - z.pos.x;
            const tz = cc.z - z.pos.z;
            const d = Math.hypot(tx, tz) || 1;
            dirX = tx / d;
            dirZ = tz / d;
          } else {
            dirX = dx / (dist || 1);
            dirZ = dz / (dist || 1);
          }
        }
        if (dist > 0.9) {
          const step = z.speed * dt;
          moveWithCollision(z.pos, dirX * step, dirZ * step, ZOMBIE.radius, this.level.isBlocked);
        }
        z.targetYaw = Math.atan2(-dirX, -dirZ);
        break;
      }
      case 'attack': {
        z.targetYaw = Math.atan2(-dx, -dz);
        z.timer -= dt;
        if (z.timer <= 0) {
          if (dist < ZOMBIE.attackReach && player.alive && !player.downed) player.takeDamage(ZOMBIE.damage);
          z.cooldown = ZOMBIE.attackCooldown;
          z.state = 'chase';
        }
        break;
      }
      case 'dying': {
        z.timer -= dt;
        if (z.timer <= 0) {
          z.state = 'sinking';
          z.timer = ZOMBIE.sinkTime;
        }
        break;
      }
      case 'sinking': {
        z.timer -= dt;
        z.y = -2.4 * (1 - Math.max(0, z.timer) / ZOMBIE.sinkTime);
        if (z.timer <= 0) {
          z.state = 'idle';
          z.root.visible = false;
          z.y = 0;
        }
        break;
      }
    }
  }

  private separate(dt: number, player: Player): void {
    const list = this.zombies.filter((z) => z.state === 'chase' || z.state === 'attack');
    const minD = ZOMBIE.radius * 2.1;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d >= minD || d < 0.0001) continue;
        const push = ((minD - d) / d) * 0.5 * Math.min(1, dt * 10);
        moveWithCollision(a.pos, -dx * push, -dz * push, ZOMBIE.radius, this.level.isBlocked);
        moveWithCollision(b.pos, dx * push, dz * push, ZOMBIE.radius, this.level.isBlocked);
      }
      const dx = a.pos.x - player.pos.x;
      const dz = a.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      const keep = 0.72;
      if (d < keep && d > 0.0001) {
        const push = (keep - d) / d;
        moveWithCollision(a.pos, dx * push, dz * push, ZOMBIE.radius, this.level.isBlocked);
      }
    }
  }
}
