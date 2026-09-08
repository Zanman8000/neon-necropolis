// Orchestrates rendering, systems, game state and the DOM overlays.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { Input } from '../core/Input';
import { Level, type DoorState, type WindowState, type BuyState } from '../world/Level';
import type { PerkMachine } from '../world/Machines';
import { ZONES } from '../world/LevelData';
import { PLANKS_MAX } from '../world/Grid';
import { Player } from '../player/Player';
import { Arsenal, type WeaponInstance, type ZombieHit } from '../weapons/Weapons';
import { WEAPONS, STARTING_WEAPON } from '../weapons/WeaponDefs';
import { ZombieManager } from '../enemies/ZombieManager';
import { Sfx } from '../audio/Sfx';
import { Sparks } from '../fx/Particles';
import { Hud } from '../ui/Hud';
import { SettingsPanel, loadSettings, type SettingsData, type Quality } from '../ui/Settings';
import { Powerups } from './Powerups';
import { Utilities } from '../weapons/Utilities';
import {
  START_POINTS,
  POINTS,
  PLAYER,
  PERKS,
  PERK_LIMIT,
  QUICKPATCH_MAX_BUYS,
  IRONHIDE_HEALTH,
  RAPID_RACK_RELOAD,
  TRIGGER_TONIC,
  CRATE_COST,
  UPGRADE_COST,
  POWERUPS,
  NUKE_POINTS,
  CARPENTER_POINTS,
  pointsForHit,
  type PowerupKind,
} from './Rules';

type State = 'boot' | 'start' | 'playing' | 'paused' | 'dead';

type Interactable =
  | { kind: 'door'; door: DoorState; d: number }
  | { kind: 'buy'; buy: BuyState; d: number }
  | { kind: 'window'; win: WindowState; d: number }
  | { kind: 'perk'; machine: PerkMachine; d: number }
  | { kind: 'crate'; d: number }
  | { kind: 'upgrade'; d: number }
  | { kind: 'power'; d: number };

const BEST_KEY = 'neon-necropolis.best-round';
const BASE_SENSITIVITY = 0.0022;
const REVIVE_TIME = 3.2;

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
  settings!: SettingsPanel;
  powerups!: Powerups;
  utilities!: Utilities;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  state: State = 'boot';
  points = START_POINTS;
  readonly perks = new Set<string>();
  private quickPatchBuys = 0;
  private reviveT = 0;
  private upgrading: WeaponInstance | null = null;
  private upgradeAnnounced = false;
  private repairPoints = 0;
  private repairT = 0;
  private escGuard = 0;
  private last = 0;
  private fps = 60;
  private quality: Quality | null = null;
  private settingsReturn: 'start' | 'pause' = 'start';
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
    this.renderer.toneMappingExposure = 1.0;
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
    this.powerups = new Powerups();
    this.scene.add(this.powerups.group);
    this.utilities = new Utilities(this.sfx, this.sparks);
    this.scene.add(this.utilities.group);
    this.utilities.onGrenadeKills = (hits, kills) => {
      const pts = (hits * POINTS.hit + kills * POINTS.killBody) * this.powerups.pointsMultiplier;
      this.addPoints(pts);
      if (hits > 0) this.hud.hitMarker(kills > 0);
    };
    this.utilities.onKnifeHit = (killed) => {
      this.addPoints(pointsForHit(killed, false, this.powerups.pointsMultiplier));
      this.hud.hitMarker(killed);
    };
    this.utilities.onSelfDamage = (amount) => this.player.takeDamage(amount);
    this.utilities.onPickup = (kind) => this.hud.showNotice(kind === 'knives' ? '+2 THROWING KNIVES' : '+1 GRENADE', 1.5);
    this.hud = new Hud();

    this.arsenal.getZombieTargets = () => this.zombies.getTargets();
    this.arsenal.onZombieHit = (hit) => this.onZombieHit(hit);
    this.arsenal.onMeleeSwing = (damage, range, arcCos) => this.onMelee(damage, range, arcCos);
    this.zombies.onRoundStart = (round) => {
      this.hud.roundBanner(round);
      this.hud.setRound(round);
      this.sfx.roundStart();
      this.repairPoints = 0;
      this.powerups.resetRound();
    };
    this.zombies.onRoundEnd = () => this.sfx.roundEnd();
    this.zombies.onKill = (z) => {
      this.powerups.maybeDrop(z.pos.x, z.pos.z);
      this.utilities.dropLoot(z.pos.x, z.pos.z);
    };
    this.powerups.onPickup = (kind, x, z) => this.applyPowerup(kind, x, z);
    this.powerups.onExpire = () => this.sfx.powerupExpire();
    this.level.onZoneActivated = (zone) => {
      this.zombies.invalidateField();
      this.hud.showNotice(`${ZONES[zone].name} UNLOCKED`);
    };
    if (this.level.upgrade) {
      this.level.upgrade.onSpark = (p) => this.sparks.emit(p, new THREE.Vector3(0, 1, 0), 5, new THREE.Color(0xff3ea5), 3, 0.05, 0.4);
    }
    if (this.level.crate) {
      const crate = this.level.crate;
      crate.onRefund = () => {
        this.addPoints(CRATE_COST);
        this.hud.showNotice('CRATE RELOCATED · POINTS REFUNDED', 3);
      };
      crate.onTick = () => this.sfx.crateTick(crate.pos.x, crate.pos.z, 0.8 + Math.random() * 0.6);
      crate.onOffer = () => this.sfx.crateOffer(crate.pos.x, crate.pos.z);
      crate.onMove = () => this.sfx.crateMove(crate.pos.x, crate.pos.z);
    }
    this.player.onDamaged = () => this.hud.damageFlash();
    this.player.onDeath = () => this.onPlayerDown();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.player.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.28, 0.45, 0.96);
    this.composer.addPass(this.bloom);
    // Cap what a single pixel can feed into the bloom so surfaces right next to a light
    // (lamp heads, fixtures) glow gently instead of smearing into a giant blob.
    const highPass = this.bloom.materialHighPassFilter;
    const mixLine = 'gl_FragColor = mix( outputColor, texel, alpha );';
    if (highPass.fragmentShader.includes(mixLine)) {
      highPass.fragmentShader = highPass.fragmentShader.replace(mixLine, 'gl_FragColor = mix( outputColor, min( texel, vec4( 2.2 ) ), alpha );');
      highPass.needsUpdate = true;
    }
    this.composer.addPass(new OutputPass());
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.settings = new SettingsPanel(
      loadSettings(),
      (s) => this.applySettings(s),
      () => this.closeSettings(),
    );
    this.applySettings(this.settings.data);

    $('btn-start').addEventListener('click', () => {
      if (this.state === 'start') void this.startGame();
    });
    $('btn-resume').addEventListener('click', () => void this.resume());
    $('btn-restart').addEventListener('click', () => void this.restart());
    $('btn-settings-start').addEventListener('click', () => this.openSettings('start'));
    $('btn-settings-pause').addEventListener('click', () => this.openSettings('pause'));
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.nolock) {
        this.escGuard = 0.4;
        this.pause();
      }
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

  // ---------------------------------------------------------------- settings

  private applySettings(s: SettingsData): void {
    this.player.sensitivity = BASE_SENSITIVITY * s.sensitivity;
    this.player.invertY = s.invertY;
    this.player.baseFov = s.fov;
    this.sfx.setVolume(s.volume);
    this.level.setNeonScale(s.neon);
    this.level.setRainVisible(s.rain);
    if (s.quality !== this.quality) this.applyQuality(s.quality);
  }

  private applyQuality(q: Quality): void {
    this.quality = q;
    const dpr = q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : q === 'medium' ? Math.min(window.devicePixelRatio, 1) : 0.85;
    this.renderer.setPixelRatio(dpr);
    this.composer.setPixelRatio(dpr);
    this.resize();
    const sun = this.level.sun;
    sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    this.bloom.enabled = q !== 'low';
  }

  private openSettings(from: 'start' | 'pause'): void {
    this.settingsReturn = from;
    this.overlays[from].classList.add('hidden');
    this.settings.open();
  }

  private closeSettings(): void {
    this.settings.close();
    this.overlays[this.settingsReturn].classList.remove('hidden');
  }

  // ---------------------------------------------------------------- state transitions

  private resetRun(): void {
    this.level.reset();
    this.player.reset();
    this.arsenal.reset();
    this.arsenal.give(STARTING_WEAPON);
    this.zombies.start();
    this.zombies.instaKill = false;
    this.powerups.reset();
    this.utilities.reset();
    this.perks.clear();
    this.quickPatchBuys = 0;
    this.reviveT = 0;
    this.upgrading = null;
    this.upgradeAnnounced = false;
    this.applyPerks();
    this.points = START_POINTS;
    this.repairPoints = 0;
    this.repairT = 0;
    this.hud.setPoints(this.points);
    this.hud.setRound(1);
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setPowerups([]);
  }

  private async acquireLock(): Promise<void> {
    if (this.nolock) return;
    let ok = await this.input.requestLock();
    if (!ok) {
      // Browsers refuse a re-lock for about a second after Esc released it. Try once more.
      await new Promise((r) => setTimeout(r, 1200));
      if (this.state !== 'playing') return;
      ok = await this.input.requestLock();
    }
    if (!ok && this.state === 'playing') {
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

  private onPlayerDown(): void {
    if (this.perks.has('quickpatch')) {
      this.player.alive = true;
      this.player.goDown();
      this.reviveT = REVIVE_TIME;
      this.hud.damageFlash();
      this.hud.showNotice('QUICK PATCH ENGAGED · HOLD ON', REVIVE_TIME);
      return;
    }
    this.die();
  }

  private revive(): void {
    this.perks.clear();
    this.applyPerks();
    this.player.revive(this.player.maxHealth);
    this.sfx.revive();
    this.hud.showNotice('BACK UP · ALL PERKS LOST', 3);
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
    this.escGuard = Math.max(0, this.escGuard - dt);
    if (this.input.wasPressed('Escape') && this.escGuard <= 0) {
      if (this.settings.isOpen) this.closeSettings();
      else if (this.state === 'paused') void this.resume();
      else if (playing && this.nolock) this.pause();
    }
    this.level.update(dt, this.player.pos);
    this.sparks.update(dt);
    this.hud.update(dt);
    if (playing || this.state === 'dead') {
      if (playing && this.reviveT > 0) {
        this.reviveT -= dt;
        if (this.reviveT <= 0) this.revive();
      }
      this.zombies.instaKill = this.powerups.instaKill;
      this.player.update(dt, playing, this.arsenal.ads);
      this.arsenal.update(dt, this.input, this.player, playing);
      this.zombies.update(dt, this.player);
      this.powerups.update(dt, this.player.pos);
      if (playing) this.throwables();
      this.utilities.update(dt, this.level, this.zombies, this.player.pos);
      if (playing) this.interactions(dt);
      else this.hud.setPrompt(null);
      const up = this.level.upgrade;
      if (up && up.state === 'ready' && !this.upgradeAnnounced) {
        this.upgradeAnnounced = true;
        this.sfx.upgradeReady(up.pos.x, up.pos.z);
      }
      this.sfx.listener = { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw };
      this.syncHud();
    } else if (this.state === 'start') {
      // idle camera drift on the title screen; arsenal update keeps the field of view live for the settings panel
      this.player.yaw += dt * 0.05;
      this.arsenal.update(dt, this.input, this.player, false);
      this.player.update(dt, false, 0);
    } else if (this.state === 'paused') {
      // keep the view model and field of view in sync so settings changes show live
      this.arsenal.update(dt, this.input, this.player, false);
      this.player.update(dt, false, this.arsenal.ads);
    }
    this.input.endFrame();
  }

  private syncHud(): void {
    const w = this.arsenal.weapon;
    this.hud.setPoints(this.points);
    this.hud.setRound(Math.max(1, this.zombies.round));
    this.hud.setHealth(this.player.health, this.player.maxHealth);
    this.hud.setWeapon(this.arsenal.currentName, this.arsenal.slotViews());
    if (w) this.hud.setAmmo(w.mag, w.reserve, w.reloading, false);
    else this.hud.setAmmo(0, 0, false, true);
    const zone = this.level.zoneAtWorld(this.player.pos.x, this.player.pos.z);
    this.hud.setZone(ZONES[zone]?.name ?? '');
    const fovRad = (this.player.camera.fov * Math.PI) / 180;
    const px = Math.tan(this.arsenal.spread) * (window.innerHeight / (2 * Math.tan(fovRad / 2)));
    this.hud.setCrosshair(6 + px, this.player.sprinting);
    this.hud.setFps(this.fps, this.debug);
    this.hud.setUtilities(this.utilities.grenades, this.utilities.knives);
    const active = this.powerups.active;
    const list = (['instakill', 'doublepoints'] as const)
      .filter((k) => active[k] > 0)
      .map((k) => ({ name: POWERUPS[k].name, color: POWERUPS[k].color, remaining: active[k], duration: POWERUPS[k].duration }));
    this.hud.setPowerups(list);
  }

  // ---------------------------------------------------------------- throwables

  private throwables(): void {
    if (!this.player.alive || this.player.downed) return;
    const wantGrenade = this.input.wasPressed('KeyG');
    const wantKnife = this.input.wasPressed('KeyT');
    if (!wantGrenade && !wantKnife) return;
    const origin = this.player.camera.position.clone().addScaledVector(this.player.forward, 0.35);
    origin.y -= 0.1;
    if (wantGrenade) {
      if (this.utilities.grenades <= 0) {
        this.hud.showNotice('NO GRENADES', 1);
        return;
      }
      const dir = this.player.forward.clone();
      dir.y += 0.18;
      if (this.utilities.throwGrenade(origin, dir)) this.arsenal.playThrow();
    } else {
      if (this.utilities.knives <= 0) {
        this.hud.showNotice('NO THROWING KNIVES', 1);
        return;
      }
      if (this.utilities.throwKnife(origin, this.player.forward)) this.arsenal.playThrow();
    }
  }

  // ---------------------------------------------------------------- perks & power-ups

  private applyPerks(): void {
    const has = (id: string) => this.perks.has(id);
    this.player.maxHealth = has('ironhide') ? IRONHIDE_HEALTH : PLAYER.maxHealth;
    this.player.health = Math.min(this.player.health, this.player.maxHealth);
    this.arsenal.mods.reload = has('rapidrack') ? RAPID_RACK_RELOAD : 1;
    this.arsenal.mods.rpm = has('triggertonic') ? TRIGGER_TONIC.rpm : 1;
    this.arsenal.mods.damage = has('triggertonic') ? TRIGGER_TONIC.damage : 1;
    this.arsenal.setGunSlots(has('packmule') ? 3 : 2);
    this.hud.setPerks([...this.perks].map((id) => ({ short: PERKS[id].short, name: PERKS[id].name, color: PERKS[id].color })));
  }

  private buyPerk(machine: PerkMachine): void {
    const info = machine.info;
    if (!this.level.powerOn) {
      this.sfx.denied();
      this.hud.showNotice('REQUIRES POWER', 1.5);
      return;
    }
    if (this.perks.has(info.id)) {
      this.sfx.denied();
      this.hud.showNotice(`${info.name} ALREADY ACTIVE`, 1.5);
      return;
    }
    if (info.id === 'quickpatch' && this.quickPatchBuys >= QUICKPATCH_MAX_BUYS) {
      this.sfx.denied();
      this.hud.showNotice('QUICK PATCH DEPLETED', 1.5);
      return;
    }
    if (this.perks.size >= PERK_LIMIT) {
      this.sfx.denied();
      this.hud.showNotice('PERK LIMIT REACHED', 1.5);
      return;
    }
    if (!this.spend(info.cost)) return;
    this.perks.add(info.id);
    if (info.id === 'quickpatch') this.quickPatchBuys++;
    this.applyPerks();
    if (info.id === 'ironhide') this.player.health = this.player.maxHealth;
    this.sfx.perkDrink();
    this.hud.showNotice(`${info.name} ACQUIRED`, 2);
  }

  private applyPowerup(kind: PowerupKind, x: number, z: number): void {
    const info = POWERUPS[kind];
    this.sfx.powerupPickup(kind);
    this.hud.showNotice(info.name, 2);
    switch (kind) {
      case 'maxammo':
        for (const g of this.arsenal.guns) {
          if (!g) continue;
          g.refill();
          g.mag = g.magSize;
        }
        this.hud.flash(info.color, 0.5, 0.35);
        break;
      case 'instakill':
      case 'doublepoints':
        this.powerups.activate(kind);
        this.hud.flash(info.color, 0.5, 0.35);
        break;
      case 'nuke': {
        this.zombies.killAll();
        this.addPoints(NUKE_POINTS);
        this.hud.flash(0xffffff, 1.2, 0.95);
        this.sparks.emit(new THREE.Vector3(x, 1.2, z), new THREE.Vector3(0, 1, 0), 60, new THREE.Color(0xfff2c0), 8, 0.12, 1.2);
        break;
      }
      case 'carpenter': {
        for (const w of this.level.windows) while (this.level.repairPlank(w)) {
          /* repair every segment */
        }
        this.addPoints(CARPENTER_POINTS);
        this.hud.flash(info.color, 0.5, 0.35);
        break;
      }
    }
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
    this.addPoints(pointsForHit(res.killed, res.headshot, this.powerups.pointsMultiplier));
  }

  private onMelee(damage: number, range: number, arcCos: number): void {
    const f = this.player.forwardFlat;
    const hits = this.zombies.meleeHit(this.player.pos.x, this.player.pos.z, f.x, f.y, range, arcCos, damage);
    if (hits.length === 0) return;
    let killed = false;
    let pts = 0;
    for (const h of hits) {
      pts += POINTS.hit + (h.killed ? POINTS.killMelee : 0);
      killed = killed || h.killed;
    }
    this.addPoints(pts * this.powerups.pointsMultiplier);
    this.hud.hitMarker(killed);
    this.sfx.meleeHit(killed);
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
    const machineRange = PLAYER.interactRange + 0.8;
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
    for (const machine of this.level.perks) {
      const d = Math.hypot(machine.pos.x - px, machine.pos.z - pz);
      if (d < machineRange && facing(machine.pos.x, machine.pos.z)) consider({ kind: 'perk', machine, d });
    }
    const crate = this.level.crate;
    if (crate) {
      const d = Math.hypot(crate.pos.x - px, crate.pos.z - pz);
      if (d < machineRange && facing(crate.pos.x, crate.pos.z)) consider({ kind: 'crate', d });
    }
    const up = this.level.upgrade;
    if (up) {
      const d = Math.hypot(up.pos.x - px, up.pos.z - pz);
      if (d < machineRange + 0.3 && facing(up.pos.x, up.pos.z)) consider({ kind: 'upgrade', d });
    }
    const power = this.level.power;
    if (power && !power.on) {
      const d = Math.hypot(power.pos.x - px, power.pos.z - pz);
      if (d < PLAYER.interactRange && facing(power.pos.x, power.pos.z)) consider({ kind: 'power', d });
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
    const pressed = this.input.wasPressed('KeyF') && !this.player.downed;
    const held = this.input.isDown('KeyF') && !this.player.downed;
    switch (target.kind) {
      case 'door': {
        const cost = target.door.def.cost;
        this.hud.setPrompt(`[F]  OPEN BLAST DOOR  ·  ${cost}`, this.points < cost);
        if (pressed && this.spend(cost)) {
          this.level.openDoor(target.door);
          this.sfx.doorOpen(target.door.pos.x, target.door.pos.z);
          this.sfx.purchase();
        }
        break;
      }
      case 'buy':
        this.buyInteraction(target.buy, pressed);
        break;
      case 'window': {
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
        break;
      }
      case 'perk': {
        const info = target.machine.info;
        if (!this.level.powerOn) this.hud.setPrompt(`${info.name}  ·  REQUIRES POWER`, true);
        else if (this.perks.has(info.id)) this.hud.setPrompt(`${info.name}  ·  ACTIVE`, true);
        else this.hud.setPrompt(`[F]  ${info.name}  ·  ${info.cost}`, this.points < info.cost);
        if (pressed) this.buyPerk(target.machine);
        break;
      }
      case 'power': {
        this.hud.setPrompt('[F]  RESTORE MAIN POWER');
        if (pressed && this.level.power) {
          this.level.setPower(true);
          this.sfx.powerOn(this.level.power.pos.x, this.level.power.pos.z);
          this.hud.showNotice('POWER RESTORED', 3);
        }
        break;
      }
      case 'crate':
        this.crateInteraction(pressed);
        break;
      case 'upgrade':
        this.upgradeInteraction(pressed);
        break;
    }
  }

  private buyInteraction(buy: BuyState, pressed: boolean): void {
    const def = WEAPONS[buy.def.weapon];
    const owned = this.arsenal.gun(def.id);
    if (!owned) {
      this.hud.setPrompt(`[F]  BUY ${def.name}  ·  ${def.cost}`, this.points < def.cost);
      if (pressed && this.spend(def.cost)) {
        const result = this.arsenal.give(def.id);
        this.sfx.purchase();
        if (result === 'replaced') this.hud.showNotice(`${def.name} EQUIPPED`, 1.5);
      }
      return;
    }
    const refillCost = Math.round(def.cost / 2);
    if (owned.ammoFull) {
      this.hud.setPrompt(`${owned.name}  ·  AMMO FULL`, true);
      return;
    }
    if (this.points >= refillCost) {
      this.hud.setPrompt(`[F]  REFILL ${owned.name} AMMO  ·  ${refillCost}`);
      if (pressed && this.spend(refillCost)) {
        owned.refill();
        this.sfx.purchase();
      }
      return;
    }
    if (this.points <= 0) {
      this.hud.setPrompt(`REFILL ${owned.name} AMMO  ·  NO POINTS`, true);
      return;
    }
    const frac = this.points / refillCost;
    this.hud.setPrompt(`[F]  PARTIAL REFILL  ·  ${this.points} PTS FOR ${Math.round(frac * 100)}%`);
    if (pressed) {
      const spent = this.points;
      const added = owned.refillFraction(frac);
      this.points = 0;
      this.hud.popPoints(-spent);
      this.sfx.purchase();
      this.hud.showNotice(`+${added} ROUNDS`, 1.5);
    }
  }

  private crateInteraction(pressed: boolean): void {
    const crate = this.level.crate;
    if (!crate) return;
    switch (crate.state) {
      case 'closed':
        this.hud.setPrompt(`[F]  SALVAGE CRATE  ·  ${CRATE_COST}`, this.points < CRATE_COST);
        if (pressed && this.spend(CRATE_COST)) {
          crate.open(Math.random());
          this.sfx.crateOpen(crate.pos.x, crate.pos.z);
        }
        break;
      case 'rolling':
        this.hud.setPrompt('SALVAGING...', true);
        break;
      case 'offer': {
        const w = crate.offered;
        if (!w) break;
        const owned = this.arsenal.owns(w.id);
        this.hud.setPrompt(owned ? `[F]  TAKE ${w.name} AMMO` : `[F]  TAKE ${w.name}`);
        if (pressed) {
          const def = crate.take();
          if (def) {
            this.arsenal.give(def.id);
            this.sfx.purchase();
          }
        }
        break;
      }
      case 'moving':
        this.hud.setPrompt('CRATE RELOCATING', true);
        break;
      default:
        this.hud.setPrompt(null);
    }
  }

  private upgradeInteraction(pressed: boolean): void {
    const up = this.level.upgrade;
    if (!up) return;
    if (!this.level.powerOn) {
      this.hud.setPrompt('OVERCLOCK STATION  ·  REQUIRES POWER', true);
      return;
    }
    switch (up.state) {
      case 'idle': {
        const w = this.arsenal.weapon;
        if (!w) {
          this.hud.setPrompt('OVERCLOCK STATION  ·  EQUIP A GUN', true);
          return;
        }
        if (w.upgraded) {
          this.hud.setPrompt(`${w.name}  ·  ALREADY OVERCLOCKED`, true);
          return;
        }
        this.hud.setPrompt(`[F]  OVERCLOCK ${w.name}  ·  ${UPGRADE_COST}`, this.points < UPGRADE_COST);
        if (pressed && this.spend(UPGRADE_COST)) {
          const slot = this.arsenal.current;
          const inst = this.arsenal.removeGun(slot);
          if (inst) {
            this.upgrading = inst;
            this.upgradeAnnounced = false;
            up.begin(inst.def, slot);
            this.sfx.upgradeStart(up.pos.x, up.pos.z);
          }
        }
        break;
      }
      case 'working':
        this.hud.setPrompt('OVERCLOCKING...', true);
        break;
      case 'ready': {
        const name = up.held ? up.held.def.upgradedName : 'WEAPON';
        this.hud.setPrompt(`[F]  TAKE ${name}`);
        if (pressed) {
          const held = up.take();
          if (held && this.upgrading) {
            this.upgrading.upgrade();
            this.arsenal.insertGun(this.upgrading, held.slot);
            this.upgrading = null;
            this.sfx.purchase();
            this.hud.showNotice(`${name} ONLINE`, 2);
          }
        }
        break;
      }
    }
  }
}
