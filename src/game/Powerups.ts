// Power-up drops: spinning glyphs left behind by dead zombies, plus the timers for timed effects.
import * as THREE from 'three';
import {
  POWERUPS,
  POWERUP_DROP_CHANCE,
  POWERUP_LIFETIME,
  POWERUP_MAX_PER_ROUND,
  POWERUP_MIN_GAP,
  pickPowerup,
  type PowerupKind,
} from './Rules';

interface Drop {
  kind: PowerupKind;
  root: THREE.Group;
  glyph: THREE.Mesh;
  ring: THREE.Mesh;
  x: number;
  z: number;
  life: number;
}

export class Powerups {
  readonly group = new THREE.Group();
  readonly active: Record<'instakill' | 'doublepoints', number> = { instakill: 0, doublepoints: 0 };
  private readonly drops: Drop[] = [];
  private sinceDrop = 999;
  private dropsThisRound = 0;
  onPickup: ((kind: PowerupKind, x: number, z: number) => void) | null = null;
  onExpire: ((kind: PowerupKind) => void) | null = null;

  get instaKill(): boolean {
    return this.active.instakill > 0;
  }

  get pointsMultiplier(): number {
    return this.active.doublepoints > 0 ? 2 : 1;
  }

  resetRound(): void {
    this.dropsThisRound = 0;
  }

  reset(): void {
    for (const d of this.drops) this.group.remove(d.root);
    this.drops.length = 0;
    this.active.instakill = 0;
    this.active.doublepoints = 0;
    this.sinceDrop = 999;
    this.dropsThisRound = 0;
  }

  /** Roll for a drop at a kill position. */
  maybeDrop(x: number, z: number): PowerupKind | null {
    if (this.sinceDrop < POWERUP_MIN_GAP || this.dropsThisRound >= POWERUP_MAX_PER_ROUND) return null;
    if (Math.random() > POWERUP_DROP_CHANCE) return null;
    const kind = pickPowerup(Math.random());
    this.spawn(kind, x, z);
    return kind;
  }

  spawn(kind: PowerupKind, x: number, z: number): void {
    const info = POWERUPS[kind];
    const root = new THREE.Group();
    root.position.set(x, 0, z);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(info.color).multiplyScalar(1.6) });
    const glyph = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat);
    glyph.position.y = 1.1;
    root.add(glyph);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 28), mat);
    ring.position.y = 1.1;
    ring.rotation.x = Math.PI / 2;
    root.add(ring);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.25 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    root.add(shadow);
    this.group.add(root);
    this.drops.push({ kind, root, glyph, ring, x, z, life: POWERUP_LIFETIME });
    this.sinceDrop = 0;
    this.dropsThisRound++;
  }

  /** Start (or extend) a timed effect. */
  activate(kind: PowerupKind): void {
    const d = POWERUPS[kind].duration;
    if (kind === 'instakill') this.active.instakill = Math.max(this.active.instakill, d);
    if (kind === 'doublepoints') this.active.doublepoints = Math.max(this.active.doublepoints, d);
  }

  update(dt: number, player: { x: number; z: number }): void {
    this.sinceDrop += dt;
    for (const k of ['instakill', 'doublepoints'] as const) {
      if (this.active[k] > 0) {
        this.active[k] -= dt;
        if (this.active[k] <= 0) {
          this.active[k] = 0;
          this.onExpire?.(k);
        }
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.life -= dt;
      d.glyph.rotation.y += dt * 2.5;
      d.glyph.rotation.x = Math.sin(d.life * 1.5) * 0.3;
      d.glyph.position.y = 1.1 + Math.sin(d.life * 2.5) * 0.12;
      d.ring.rotation.z += dt * 1.2;
      d.root.visible = d.life > 8 || Math.floor(d.life * 5) % 2 === 0;
      const dist = Math.hypot(d.x - player.x, d.z - player.z);
      if (dist < 1.35) {
        this.group.remove(d.root);
        this.drops.splice(i, 1);
        this.onPickup?.(d.kind, d.x, d.z);
        continue;
      }
      if (d.life <= 0) {
        this.group.remove(d.root);
        this.drops.splice(i, 1);
      }
    }
  }
}
