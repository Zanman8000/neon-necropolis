// Orchestrates rendering, systems, game state and the DOM overlays.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Input } from '../core/Input';
import { Level, type DoorState, type WindowState, type BuyState } from '../world/Level';
import { ZONES } from '../world/LevelData';
import { PLANKS_MAX } from '../world/Grid';
import { Player } from '../player/Player';
import { Arsenal, type ZombieHit } from '../weapons/Weapons';
import { WEAPONS, STARTING_WEAPON } from '../weapons/WeaponDefs';
import { ZombieManager } from '../enemies/ZombieManager';
import { Sfx } from '../audio/Sfx';
import { Sparks } from '../fx/Particles';
import { Hud } from '../ui/Hud';
import { START_POINTS, POINTS, PLAYER, pointsForHit } from './Rules';

type State = 'boot' | 'start' | 'playing' | 'paused' | 'dead';

type Interactable =
  | { kind: 'door'; door: DoorState; d: number }
  | { kind: 'buy'; buy: BuyState; d: number }
  | { kind: 'window'; win: WindowState; d: number };

const BEST_KEY = 'neon-necropolis.best-round';

function $(id: string): HTMLElement {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing element #${id}`);
  return e;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: Input;
  readonly sfx = new Sfx();
  level!: Level;
  player!: Player;
  arsenal!: Arsenal;
  zombies!: ZombieManager;
  sparks!: Sparks;
  hud!: Hud;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  state: State = 'boot';
  points = START_POINTS;
  private repairPoints = 0;
  private repairT = 0;
  private last = 0;
  private fps = 60;
  private readonly nolock: boolean;
  private readonly debug: boolean;
  private readonly overlays = { start: $('overlay-start'), pause: $('overlay-pause'), dead: $('overlay-dead') };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const params = new URLSearchParams(location.search);
    this.nolock = params.has('nolock');
    this.debug = params.has('debug');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.input = new Input(canvas);
    this.input.allowUnlockedLook = this.nolock;
  }

  async init(): Promise<void> {
    await Promise.race([document.fonts.load('700 32px Orbitron'), new Promise((r) => setTimeout(r, 1500))]).catch(() => undefined);
    this.scene.fog = new THREE.Fog(0x1a1026, 18, 260);
    this.scene.background = new THREE.Color(0x1a1026);

    this.level = new Level();
    this.scene.add(this.level.group);
    this.player = new Player(this.level, this.input, this.sfx, window.innerWidth / window.innerHeight);
    this.scene.add(this.player.camera);
    this.sparks = new Sparks();
    this.scene.add(this.sparks.points);
    this.arsenal = new Arsenal(this.player.camera, this.level, this.sfx, this.sparks);
    this.zombies = new ZombieManager(this.level, this.sfx, this.sparks);
    this.scene.add(this.zombies.group);
    this.hud = new Hud();

    this.arsenal.getZombieTargets = () => this.zombies.getTargets();
    this.arsenal.onZombieHit = (hit) => this.onZombieHit(hit);
    this.zombies.onRoundStart = (round) => {
      this.hud.roundBanner(round);
      this.hud.setRound(round);
      this.sfx.roundStart();
      this.repairPoints = 0;
    };
    this.zombies.onRoundEnd = () => this.sfx.roundEnd();
    this.level.onZoneActivated = (zone) => {
      this.zombies.invalidateField();
      this.hud.showNotice(`${ZONES[zone].name} UNLOCKED`);
    };
    this.player.onDamaged = () => this.hud.damageFlash();
    this.player.onDeath = () => this.die();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.player.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.65, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.overlays.start.addEventListener('click', () => {
      if (this.state === 'start') void this.startGame();
    });
    $('btn-resume').addEventListener('click', () => void this.resume());
    $('btn-restart').addEventListener('click', () => void this.restart());
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.nolock) this.pause();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    $('best-round').textContent = localStorage.getItem(BEST_KEY) ?? '0';

    (window as unknown as { __game: Game }).__game = this;
    this.state = 'start';
    this.resetRun();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.player.camera.aspect = w / h;
    this.player.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- state transitions

  private resetRun(): void {
    this.level.reset();
    this.player.reset();
    this.arsenal.reset();
    this.arsenal.give(STARTING_WEAPON);
    this.zombies.start();
    this.points = START_POINTS;
    this.repairPoints = 0;
    this.repairT = 0;
    this.hud.setPoints(this.points);
    this.hud.setRound(1);
    this.hud.setHealth(this.player.health, PLAYER.maxHealth);
  }

  private async acquireLock(): Promise<void> {
    if (this.nolock) return;
    const ok = await this.input.requestLock();
    if (!ok) {
      this.input.allowUnlockedLook = true;
      this.hud.showNotice('POINTER LOCK UNAVAILABLE · MOUSE LOOK WITHOUT CAPTURE', 4);
    }
  }

  async startGame(): Promise<void> {
    this.sfx.init();
    this.sfx.resume();
    this.sfx.startAmbience();
    this.overlays.start.classList.add('hidden');
    this.hud.show();
    this.state = 'playing';
    this.input.enabled = true;
    await this.acquireLock();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.overlays.pause.classList.remove('hidden');
    this.sfx.suspend();
  }

  async resume(): Promise<void> {
    if (this.state !== 'paused') return;
    this.overlays.pause.classList.add('hidden');
    this.sfx.resume();
    this.input.enabled = true;
    this.state = 'playing';
    await this.acquireLock();
  }

  private die(): void {
    this.state = 'dead';
    this.input.enabled = false;
    this.input.exitLock();
    const best = Math.max(Number(localStorage.getItem(BEST_KEY) ?? 0), this.zombies.round);
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {
      /* storage unavailable */
    }
    $('dead-round').textContent = String(this.zombies.round);
    $('dead-kills').textContent = String(this.zombies.kills);
    $('dead-points').textContent = this.points.toLocaleString('en-US');
    $('best-round').textContent = String(best);
    setTimeout(() => this.overlays.dead.classList.remove('hidden'), 1400);
  }

  async restart(): Promise<void> {
    if (this.state !== 'dead') return;
    this.overlays.dead.classList.add('hidden');
    this.resetRun();
    this.sfx.resume();
    this.input.enabled = true;
    this.state = 'playing';
    await this.acquireLock();
  }

  // ---------------------------------------------------------------- loop

  private loop(t: number): void {
    requestAnimationFrame((n) => this.loop(n));
    const dt = Math.min(0.05, Math.max(0.0001, (t - this.last) / 1000));
    this.last = t;
    this.fps += (1 / dt - this.fps) * 0.05;
    this.update(dt);
    this.composer.render();
  }

  private update(dt: number): void {
    const playing = this.state === 'playing';
    if (this.nolock) {
      if (playing && this.input.wasPressed('Escape')) this.pause();
      else if (this.state === 'paused' && this.input.wasPressed('Escape')) void this.resume();
    }
    this.level.update(dt);
    this.sparks.update(dt);
    this.hud.update(dt);
    if (playing || this.state === 'dead') {
      this.player.update(dt, playing, this.arsenal.ads);
      this.arsenal.update(dt, this.input, this.player, playing);
      this.zombies.update(dt, this.player);
      if (playing) this.interactions(dt);
      else this.hud.setPrompt(null);
      this.sfx.listener = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw };
      this.syncHud();
    } else if (this.state === 'start') {
      // idle camera drift on the title screen
      this.player.yaw += dt * 0.05;
      this.player.update(dt, false, 0);
    }
    this.input.endFrame();
  }

  private syncHud(): void {
    const w = this.arsenal.weapon;
    this.hud.setPoints(this.points);
    this.hud.setRound(Math.max(1, this.zombies.round));
    this.hud.setHealth(this.player.health, PLAYER.maxHealth);
    if (w) {
      this.hud.setWeapon(
        w.def.name,
        this.arsenal.current,
        this.arsenal.slots.length,
        this.arsenal.slots.map((s) => (s ? s.def.name : null)),
      );
      this.hud.setAmmo(w.mag, w.reserve, w.reloading);
    }
    const zone = this.level.zoneAtWorld(this.player.pos.x, this.player.pos.z);
    this.hud.setZone(ZONES[zone]?.name ?? '');
    const fovRad = (this.player.camera.fov * Math.PI) / 180;
    const px = Math.tan(this.arsenal.spread) * (window.innerHeight / (2 * Math.tan(fovRad / 2)));
    this.hud.setCrosshair(6 + px, this.player.sprinting);
    this.hud.setFps(this.fps, this.debug);
  }

  // ---------------------------------------------------------------- economy & interactions

  private addPoints(n: number): void {
    if (n === 0) return;
    this.points += n;
    this.hud.popPoints(n);
  }

  private spend(cost: number): boolean {
    if (this.points < cost) {
      this.sfx.denied();
      this.hud.showNotice('NOT ENOUGH POINTS', 1.5);
      return false;
    }
    this.points -= cost;
    this.hud.popPoints(-cost);
    return true;
  }

  private onZombieHit(hit: ZombieHit): void {
    const res = this.zombies.applyDamage(hit);
    if (!res) return;
    this.hud.hitMarker(res.killed);
    this.sfx.hitMarker(res.killed);
    this.addPoints(pointsForHit(res.killed, res.headshot));
  }

  private nearestInteractable(): Interactable | null {
    const px = this.player.pos.x;
    const pz = this.player.pos.z;
    const f = this.player.forwardFlat;
    const facing = (x: number, z: number) => {
      const dx = x - px;
      const dz = z - pz;
      const d = Math.hypot(dx, dz) || 1;
      return (dx / d) * f.x + (dz / d) * f.y > -0.2;
    };
    let best: Interactable | null = null;
    const consider = (c: Interactable) => {
      if (!best || c.d < best.d) best = c;
    };
    for (const door of this.level.doors) {
      if (door.open) continue;
      const d = Math.hypot(door.pos.x - px, door.pos.z - pz);
      if (d < PLAYER.interactRange + 0.6 && facing(door.pos.x, door.pos.z)) consider({ kind: 'door', door, d });
    }
    for (const buy of this.level.buys) {
      const d = Math.hypot(buy.pos.x - px, buy.pos.z - pz);
      if (d < PLAYER.interactRange && facing(buy.pos.x, buy.pos.z)) consider({ kind: 'buy', buy, d });
    }
    for (const win of this.level.windows) {
      if (win.planks >= PLANKS_MAX) continue;
      const d = Math.hypot(win.pos.x - px, win.pos.z - pz);
      if (d < PLAYER.interactRange + 0.4 && facing(win.pos.x, win.pos.z)) consider({ kind: 'window', win, d: d + 0.5 });
    }
    return best;
  }

  private interactions(dt: number): void {
    const target = this.nearestInteractable();
    if (!target) {
      this.hud.setPrompt(null);
      this.repairT = 0;
      return;
    }
    const pressed = this.input.wasPressed('KeyF');
    const held = this.input.isDown('KeyF');
    if (target.kind === 'door') {
      const cost = target.door.def.cost;
      this.hud.setPrompt(`[F]  OPEN BLAST DOOR  ·  ${cost}`, this.points < cost);
      if (pressed && this.spend(cost)) {
        this.level.openDoor(target.door);
        this.sfx.doorOpen(target.door.pos.x, target.door.pos.z);
        this.sfx.purchase();
      }
    } else if (target.kind === 'buy') {
      const def = WEAPONS[target.buy.def.weapon];
      const owned = this.arsenal.owns(def.id);
      const cost = owned ? Math.round(def.cost / 2) : def.cost;
      this.hud.setPrompt(owned ? `[F]  REFILL ${def.name} AMMO  ·  ${cost}` : `[F]  BUY ${def.name}  ·  ${cost}`, this.points < cost);
      if (pressed && this.spend(cost)) {
        const result = this.arsenal.give(def.id);
        this.sfx.purchase();
        if (result === 'replaced') this.hud.showNotice(`${def.name} EQUIPPED`, 1.5);
      }
    } else {
      const capped = this.repairPoints >= POINTS.repairCapPerRound;
      this.hud.setPrompt(`[HOLD F]  REPAIR BARRICADE  ·  ${target.win.planks}/${PLANKS_MAX}`);
      if (held) {
        this.repairT += dt;
        if (this.repairT >= 0.7) {
          this.repairT = 0;
          if (this.level.repairPlank(target.win)) {
            this.sfx.repair();
            if (!capped) {
              this.addPoints(POINTS.repairPlank);
              this.repairPoints += POINTS.repairPlank;
            }
          }
        }
      } else {
        this.repairT = 0;
      }
    }
  }
}
