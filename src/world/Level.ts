// Builds the 3D level from the ASCII map, owns doors / barricades / wall buys / spawn pods,
// and answers collision + line-of-sight queries for the player and the horde.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import {
  CELL,
  WALL_H,
  PLANKS_MAX,
  parseLevel,
  cellCenter,
  worldToCell,
  lineOfSight,
  type ParsedLevel,
  type DoorDef,
  type WindowDef,
  type BuyDef,
  type PodDef,
} from './Grid';
import { MAP_ROWS, DOOR_COSTS, ZONES, SIGNS, EXTRA_LIGHTS, FLOODS, START_ZONE } from './LevelData';
import * as Tex from './Textures';
import { WEAPONS } from '../weapons/WeaponDefs';
import { buildGunModel } from '../weapons/GunModels';

// three-mesh-bvh acceleration for bullet raycasts
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: unknown }).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as unknown as { raycast: unknown }).raycast = acceleratedRaycast;

/** How many point lights are active at once. Kept constant so shaders never recompile. */
const ACTIVE_POINT_LIGHTS = 10;

export interface DoorState {
  def: DoorDef;
  open: boolean;
  anim: number;
  pos: { x: number; z: number };
  slab: THREE.Mesh;
  signs: THREE.Mesh[];
}

export interface WindowState {
  def: WindowDef;
  planks: number;
  plankMeshes: THREE.Mesh[];
  pos: { x: number; z: number };
  insidePos: { x: number; z: number };
  outsidePos: { x: number; z: number };
  /** Point just outside the barricade where zombies stand to tear it down. */
  tearPos: { x: number; z: number };
}

export interface BuyState {
  def: BuyDef;
  pos: { x: number; z: number };
  display: THREE.Group;
}

export interface PodState {
  def: PodDef;
  pos: { x: number; z: number };
  ring: THREE.Mesh;
}

/** An emissive material whose brightness follows the neon setting, optionally flickering. */
interface NeonEntry {
  mat: THREE.MeshBasicMaterial;
  base: THREE.Color;
  k: number;
  flicker?: 'flicker' | 'broken';
  light?: THREE.PointLight;
  lightBase?: number;
  on: boolean;
  t: number;
}

interface Materials {
  floorOut: THREE.MeshStandardMaterial;
  floorIn: THREE.MeshStandardMaterial;
  asphalt: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  metalDark: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  plant: THREE.MeshStandardMaterial;
  rack: THREE.MeshStandardMaterial;
  grate: THREE.MeshStandardMaterial;
}

function boxGeo(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

export class Level {
  readonly data: ParsedLevel;
  readonly group = new THREE.Group();
  readonly doors: DoorState[] = [];
  readonly windows: WindowState[] = [];
  readonly buys: BuyState[] = [];
  readonly pods: PodState[] = [];
  readonly walkable: Uint8Array;
  readonly activeZones = new Set<number>([START_ZONE]);
  readonly center: THREE.Vector3;
  readonly sun: THREE.DirectionalLight;
  readonly rain: THREE.Points;
  private readonly blockedStatic: Uint8Array;
  private readonly doorAtCell = new Map<number, DoorState>();
  private readonly staticTargets: THREE.Object3D[] = [];
  private bulletTargets: THREE.Object3D[] = [];
  private targetsDirty = true;
  private readonly neons: NeonEntry[] = [];
  private neonScale = 1;
  private readonly pointLights: THREE.PointLight[] = [];
  private readonly rainMat: THREE.ShaderMaterial;
  private readonly mats: Materials;
  private time = 0;
  private cullT = 0;
  onZoneActivated: ((zone: number) => void) | null = null;

  constructor() {
    this.data = parseLevel(MAP_ROWS, DOOR_COSTS);
    const { width, height, kinds, propAt } = this.data;
    this.center = new THREE.Vector3((width * CELL) / 2, 0, (height * CELL) / 2);
    this.blockedStatic = new Uint8Array(width * height);
    this.walkable = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const k = kinds[i];
      const floor = k === 'floor' && !propAt[i];
      this.blockedStatic[i] = floor || k === 'door' ? 0 : 1;
      this.walkable[i] = floor ? 1 : 0;
    }
    this.mats = this.makeMaterials();
    this.buildSky();
    this.buildFloors();
    this.buildWalls();
    this.buildCeilings();
    this.buildProps();
    this.buildWindows();
    this.buildDoors();
    this.buildBuys();
    this.buildPods();
    this.buildSigns();
    this.buildFloods();
    this.buildLights();
    this.buildSkyline();
    this.buildDebris();
    const rain = this.buildRain();
    this.rain = rain.points;
    this.rainMat = rain.mat;
    this.sun = this.buildSun();
    this.cullLights(this.center.x, this.center.z);
  }

  // ---------------------------------------------------------------- queries

  idx(x: number, z: number): number {
    return z * this.data.width + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.data.width && z < this.data.height;
  }

  /** Blocked for movement (player and zombies). Closed doors count as blocked. */
  isBlocked = (x: number, z: number): boolean => {
    if (!this.inBounds(x, z)) return true;
    const i = this.idx(x, z);
    if (this.blockedStatic[i]) return true;
    const d = this.doorAtCell.get(i);
    return d ? !d.open : false;
  };

  zoneAtWorld(wx: number, wz: number): number {
    const c = worldToCell(wx, wz);
    if (!this.inBounds(c.x, c.z)) return 0;
    return this.data.zones[this.idx(c.x, c.z)];
  }

  hasLineOfSight(ax: number, az: number, bx: number, bz: number): boolean {
    return lineOfSight(ax, az, bx, bz, this.isBlocked);
  }

  spawnPoint(): THREE.Vector3 {
    const c = cellCenter(this.data.playerSpawn.x, this.data.playerSpawn.z);
    return new THREE.Vector3(c.x, 0, c.z);
  }

  /** Objects bullets can hit, excluding enemies. */
  getBulletTargets(): THREE.Object3D[] {
    if (this.targetsDirty) {
      this.bulletTargets = [...this.staticTargets];
      for (const w of this.windows) {
        for (let i = 0; i < w.planks; i++) this.bulletTargets.push(w.plankMeshes[i]);
      }
      for (const d of this.doors) if (!d.open) this.bulletTargets.push(d.slab);
      this.targetsDirty = false;
    }
    return this.bulletTargets;
  }

  // ---------------------------------------------------------------- settings hooks

  /** Scales every neon / emissive sign. 1 is the default look. */
  setNeonScale(s: number): void {
    this.neonScale = s;
    for (const e of this.neons) this.applyNeon(e);
  }

  setRainVisible(v: boolean): void {
    this.rain.visible = v;
  }

  // ---------------------------------------------------------------- state changes

  openDoor(door: DoorState): void {
    if (door.open) return;
    door.open = true;
    this.walkable[this.idx(door.def.x, door.def.z)] = 1;
    this.targetsDirty = true;
    for (const z of door.def.zones) {
      if (!this.activeZones.has(z)) {
        this.activeZones.add(z);
        this.onZoneActivated?.(z);
      }
    }
  }

  tearPlank(w: WindowState): boolean {
    if (w.planks <= 0) return false;
    w.planks--;
    w.plankMeshes[w.planks].visible = false;
    this.targetsDirty = true;
    return true;
  }

  repairPlank(w: WindowState): boolean {
    if (w.planks >= PLANKS_MAX) return false;
    w.plankMeshes[w.planks].visible = true;
    w.planks++;
    this.targetsDirty = true;
    return true;
  }

  reset(): void {
    for (const d of this.doors) {
      d.open = false;
      d.anim = 0;
      d.slab.position.y = WALL_H / 2;
      for (const s of d.signs) {
        s.visible = true;
        (s.material as THREE.MeshBasicMaterial).opacity = 1;
      }
      this.walkable[this.idx(d.def.x, d.def.z)] = 0;
    }
    for (const w of this.windows) {
      w.planks = PLANKS_MAX;
      for (const m of w.plankMeshes) m.visible = true;
    }
    this.activeZones.clear();
    this.activeZones.add(START_ZONE);
    this.targetsDirty = true;
  }

  update(dt: number, playerPos: { x: number; z: number }): void {
    this.time += dt;
    for (const d of this.doors) {
      if (d.open && d.anim < 1) {
        d.anim = Math.min(1, d.anim + dt / 1.1);
        const e = 1 - Math.pow(1 - d.anim, 3);
        d.slab.position.y = WALL_H / 2 - e * (WALL_H + 0.2);
        for (const s of d.signs) {
          (s.material as THREE.MeshBasicMaterial).opacity = 1 - d.anim;
          if (d.anim >= 1) s.visible = false;
        }
      }
    }
    for (const e of this.neons) {
      if (!e.flicker) continue;
      e.t -= dt;
      if (e.t <= 0) {
        if (e.flicker === 'flicker') {
          e.on = e.on ? Math.random() < 0.25 : Math.random() < 0.85;
          e.t = e.on ? 0.15 + Math.random() * 2.2 : 0.03 + Math.random() * 0.14;
        } else {
          e.on = e.on ? false : Math.random() < 0.3;
          e.t = e.on ? 0.03 + Math.random() * 0.2 : 0.2 + Math.random() * 1.6;
        }
        e.k = e.on ? 1 : e.flicker === 'broken' ? 0.05 : 0.12;
        this.applyNeon(e);
      }
    }
    for (const b of this.buys) {
      b.display.rotation.y += dt * 0.8;
      b.display.position.y = 1.35 + Math.sin(this.time * 1.7 + b.def.id) * 0.05;
    }
    const pulse = 0.55 + 0.45 * Math.sin(this.time * 3);
    for (const p of this.pods) {
      (p.ring.material as THREE.MeshBasicMaterial).color.setRGB(1.4 * pulse * this.neonScale, 0.1 * pulse, 0.14 * pulse);
    }
    this.rainMat.uniforms.uTime.value = this.time;
    this.cullT -= dt;
    if (this.cullT <= 0) {
      this.cullT = 0.25;
      this.cullLights(playerPos.x, playerPos.z);
    }
  }

  // ---------------------------------------------------------------- helpers

  private applyNeon(e: NeonEntry): void {
    e.mat.color.copy(e.base).multiplyScalar(this.neonScale * e.k);
    if (e.light && e.lightBase !== undefined) e.light.intensity = e.lightBase * e.k;
  }

  /** Create an unlit emissive material registered with the neon system. */
  private neon(color: number, intensity = 1.35, flicker?: 'flicker' | 'broken'): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
    this.registerNeon(mat, flicker);
    return mat;
  }

  private registerNeon(mat: THREE.MeshBasicMaterial, flicker?: 'flicker' | 'broken', light?: THREE.PointLight): NeonEntry {
    const e: NeonEntry = {
      mat,
      base: mat.color.clone(),
      k: 1,
      flicker,
      light,
      lightBase: light?.intensity,
      on: flicker !== 'broken',
      t: Math.random(),
    };
    if (flicker === 'broken') e.k = 0.05;
    this.neons.push(e);
    this.applyNeon(e);
    return e;
  }

  private addPointLight(color: number, intensity: number, distance: number, x: number, y: number, z: number): THREE.PointLight {
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.set(x, y, z);
    this.group.add(light);
    this.pointLights.push(light);
    return light;
  }

  /** Keep exactly ACTIVE_POINT_LIGHTS nearest lights on so the shader light count never changes. */
  private cullLights(px: number, pz: number): void {
    const n = Math.min(ACTIVE_POINT_LIGHTS, this.pointLights.length);
    const sorted = this.pointLights
      .map((l) => ({ l, d: Math.hypot(l.position.x - px, l.position.z - pz) - l.distance * 0.35 }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < sorted.length; i++) sorted[i].l.visible = i < n;
  }

  private makeMaterials(): Materials {
    const floorTex = Tex.floorTexture();
    const rack = Tex.rackTextures();
    return {
      floorOut: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5, metalness: 0.15 }),
      floorIn: new THREE.MeshStandardMaterial({ map: floorTex, color: 0xd6deee, roughness: 0.32, metalness: 0.2 }),
      asphalt: new THREE.MeshStandardMaterial({ map: Tex.asphaltTexture(), roughness: 0.35, metalness: 0.1 }),
      wall: new THREE.MeshStandardMaterial({ map: Tex.wallTexture(), roughness: 0.58, metalness: 0.45 }),
      ceiling: new THREE.MeshStandardMaterial({ map: Tex.ceilingTexture(), roughness: 0.8, metalness: 0.2 }),
      metalDark: new THREE.MeshStandardMaterial({ color: 0x5a6170, roughness: 0.5, metalness: 0.7 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa3b0, roughness: 0.42, metalness: 0.88 }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x7a7e88, roughness: 0.92, metalness: 0.02 }),
      soil: new THREE.MeshStandardMaterial({ color: 0x3a2f26, roughness: 1 }),
      plant: new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.95 }),
      rack: new THREE.MeshStandardMaterial({
        map: rack.map,
        emissiveMap: rack.emissive,
        emissive: 0xffffff,
        emissiveIntensity: 1.4,
        roughness: 0.5,
        metalness: 0.6,
      }),
      grate: new THREE.MeshStandardMaterial({ color: 0x2e323a, roughness: 0.7, metalness: 0.6 }),
    };
  }

  private addStatic(mesh: THREE.Mesh, cast = true, receive = true, bvh = true): THREE.Mesh {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    if (bvh) (mesh.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
    this.group.add(mesh);
    this.staticTargets.push(mesh);
    return mesh;
  }

  private mergeInto(geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true, receive = true, bvh = true): THREE.Mesh | null {
    if (geos.length === 0) return null;
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) return null;
    return this.addStatic(new THREE.Mesh(merged, mat), cast, receive, bvh);
  }

  // ---------------------------------------------------------------- building

  private buildSky(): void {
    const geo = new THREE.SphereGeometry(420, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(0x05040c) },
        uHorizon: { value: new THREE.Color(0x1a1026) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld - cameraPosition).y;
          float t = smoothstep(-0.02, 0.45, h);
          gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.position.copy(this.center);
    sky.renderOrder = -10;
    this.group.add(sky);
  }

  private buildFloors(): void {
    const { width, height, kinds, zones } = this.data;
    const out: THREE.BufferGeometry[] = [];
    const inn: THREE.BufferGeometry[] = [];
    const asphalt: THREE.BufferGeometry[] = [];
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const i = this.idx(x, z);
        const k = kinds[i];
        if (k === 'void' || k === 'wall') continue;
        const g = new THREE.PlaneGeometry(CELL, CELL);
        g.rotateX(-Math.PI / 2);
        const c = cellCenter(x, z);
        g.translate(c.x, 0, c.z);
        if (k === 'outside') asphalt.push(g);
        else if (k === 'floor' && !ZONES[zones[i]]?.outdoor) inn.push(g);
        else out.push(g);
      }
    }
    this.mergeInto(out, this.mats.floorOut, false, true);
    this.mergeInto(inn, this.mats.floorIn, false, true);
    this.mergeInto(asphalt, this.mats.asphalt, false, true);
  }

  private buildWalls(): void {
    const { width, height, kinds, zones } = this.data;
    const walls: THREE.BufferGeometry[] = [];
    const stripsByZone = new Map<number, THREE.BufferGeometry[]>();
    const dirs = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ];
    const rnd = lcg(17);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        if (kinds[this.idx(x, z)] !== 'wall') continue;
        const c = cellCenter(x, z);
        walls.push(boxGeo(CELL, WALL_H, CELL, c.x, WALL_H / 2, c.z));
        for (const d of dirs) {
          const nx = x + d.x;
          const nz = z + d.z;
          if (!this.inBounds(nx, nz) || kinds[this.idx(nx, nz)] !== 'floor') continue;
          const zone = zones[this.idx(nx, nz)];
          const r = rnd();
          if (r < 0.15) continue; // dead segment
          const along = d.x !== 0 ? { w: 0.04, d: CELL - 0.02 } : { w: CELL - 0.02, d: 0.04 };
          const off = CELL / 2 + 0.03;
          const g = boxGeo(along.w, 0.06, along.d, c.x + d.x * off, 2.9, c.z + d.z * off);
          const zi = ZONES[zone];
          if (r < 0.27) {
            const m = new THREE.Mesh(g, this.neon(zi.color, 1.1, r < 0.19 ? 'broken' : 'flicker'));
            this.group.add(m);
            continue;
          }
          if (!stripsByZone.has(zone)) stripsByZone.set(zone, []);
          stripsByZone.get(zone)!.push(g);
          if (zi.outdoor && rnd() < 0.35) {
            stripsByZone.get(zone)!.push(boxGeo(along.w, 0.04, along.d, c.x + d.x * off, 0.12, c.z + d.z * off));
          }
        }
      }
    }
    this.mergeInto(walls, this.mats.wall, true, true);
    for (const [zone, geos] of stripsByZone) {
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      this.group.add(new THREE.Mesh(merged, this.neon(ZONES[zone].color, 1.1)));
    }
  }

  private buildCeilings(): void {
    const { width, height, kinds, zones } = this.data;
    const panels: THREE.BufferGeometry[] = [];
    const lightsOn: THREE.BufferGeometry[] = [];
    const rnd = lcg(5);
    for (let z = 0; z < height; z++) {
      for (let x = 0; x < width; x++) {
        const i = this.idx(x, z);
        if (kinds[i] !== 'floor' && kinds[i] !== 'door') continue;
        const zone = zones[i] || 3;
        if (ZONES[zone]?.outdoor) continue;
        const c = cellCenter(x, z);
        const g = new THREE.PlaneGeometry(CELL, CELL);
        g.rotateX(Math.PI / 2);
        g.translate(c.x, WALL_H, c.z);
        panels.push(g);
        if (x % 3 === 1 && z % 3 === 1 && kinds[i] === 'floor') {
          const p = boxGeo(1.3, 0.04, 0.5, c.x, WALL_H - 0.03, c.z);
          const r = rnd();
          if (r < 0.2) continue; // dead panel
          if (r < 0.32) {
            this.group.add(new THREE.Mesh(p, this.neon(0xdfe9ff, 1.5, 'flicker')));
            continue;
          }
          lightsOn.push(p);
        }
      }
    }
    this.mergeInto(panels, this.mats.ceiling, false, true);
    const merged = mergeGeometries(lightsOn, false);
    if (merged) this.group.add(new THREE.Mesh(merged, this.neon(0xdfe9ff, 1.5)));
  }

  private buildProps(): void {
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const push = (mat: THREE.Material, g: THREE.BufferGeometry) => {
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g);
    };
    const m = this.mats;
    const rnd = lcg(99);
    const dirs4 = [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ];
    for (const p of this.data.props) {
      const c = cellCenter(p.x, p.z);
      const zone = ZONES[p.zone];
      switch (p.kind) {
        case 'kiosk': {
          push(m.metalDark, boxGeo(1.7, 3.0, 1.7, c.x, 1.5, c.z));
          push(m.metalDark, boxGeo(1.9, 0.12, 1.9, c.x, 3.06, c.z));
          const screen = Tex.hologramTexture(['SECTOR 7', 'TRANSIT MAP'], zone.color, 256, 256);
          for (const d of dirs4) {
            const mat = new THREE.MeshBasicMaterial({ map: screen, transparent: true, color: new THREE.Color(zone.color).multiplyScalar(1.0) });
            const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.3), mat);
            mesh.position.set(c.x + d.x * 0.87, 1.9, c.z + d.z * 0.87);
            mesh.rotation.y = Math.atan2(d.x, d.z);
            this.group.add(mesh);
            this.registerNeon(mat, rnd() < 0.35 ? 'flicker' : undefined);
          }
          break;
        }
        case 'bench': {
          push(m.metalDark, boxGeo(1.7, 0.08, 0.6, c.x, 0.48, c.z));
          push(m.metalDark, boxGeo(1.7, 0.4, 0.08, c.x, 0.7, c.z - 0.26));
          push(m.steel, boxGeo(0.08, 0.46, 0.5, c.x - 0.75, 0.23, c.z));
          push(m.steel, boxGeo(0.08, 0.46, 0.5, c.x + 0.75, 0.23, c.z));
          break;
        }
        case 'planter': {
          push(m.concrete, boxGeo(1.7, 0.75, 1.7, c.x, 0.375, c.z));
          push(m.soil, boxGeo(1.5, 0.1, 1.5, c.x, 0.72, c.z));
          for (let i = 0; i < 4; i++) {
            const g = new THREE.ConeGeometry(0.06, 1.2 + rnd() * 0.8, 5);
            g.translate(0, 0.6, 0);
            g.rotateX((rnd() - 0.5) * 0.9);
            g.rotateZ((rnd() - 0.5) * 0.9);
            g.translate(c.x + (rnd() - 0.5) * 0.9, 0.75, c.z + (rnd() - 0.5) * 0.9);
            push(m.plant, g);
          }
          // integrated lamp post: the plaza's real street lighting
          const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8);
          pole.translate(c.x + 0.55, 0.75 + 1.7, c.z + 0.55);
          push(m.steel, pole);
          push(m.metalDark, boxGeo(0.7, 0.14, 0.34, c.x + 0.3, 4.2, c.z + 0.55));
          const face = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.26), this.neon(0xfff1dc, 1.2));
          face.rotation.x = Math.PI / 2;
          face.position.set(c.x + 0.3, 4.12, c.z + 0.55);
          this.group.add(face);
          this.addPointLight(0xffe6c4, 120, 22, c.x + 0.3, 3.9, c.z + 0.55);
          break;
        }
        case 'vendor': {
          const g = new THREE.BoxGeometry(1.2, 1.9, 0.9);
          g.rotateZ(-0.22);
          g.rotateY(0.6);
          g.translate(c.x, 0.9, c.z);
          push(m.metalDark, g);
          const tex = Tex.hologramTexture(['VEND-O', 'OUT OF ORDER'], 0xff3ea5, 256, 256);
          const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(0xff3ea5).multiplyScalar(1.0) });
          const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mat);
          screen.position.set(c.x + 0.3, 1.3, c.z + 0.42);
          screen.rotation.set(0, 0.6, -0.22);
          this.group.add(screen);
          this.registerNeon(mat, 'broken');
          break;
        }
        case 'column': {
          const g = new THREE.CylinderGeometry(0.55, 0.6, WALL_H, 14);
          g.translate(c.x, WALL_H / 2, c.z);
          push(m.wall, g);
          break;
        }
        case 'desk': {
          push(m.metalDark, boxGeo(CELL, 1.05, CELL, c.x, 0.525, c.z));
          push(m.steel, boxGeo(CELL, 0.04, CELL, c.x, 1.07, c.z));
          break;
        }
        case 'rack': {
          push(m.rack, boxGeo(1.7, 2.6, 1.7, c.x, 1.3, c.z));
          break;
        }
      }
    }
    for (const [mat, geos] of byMat) this.mergeInto(geos, mat, true, true);
    const deskStrip: THREE.BufferGeometry[] = [];
    for (const p of this.data.props) {
      const c = cellCenter(p.x, p.z);
      if (p.kind === 'desk') deskStrip.push(boxGeo(CELL, 0.03, 0.03, c.x, 1.0, c.z - CELL / 2 - 0.01));
    }
    const ds = mergeGeometries(deskStrip, false);
    if (ds) this.group.add(new THREE.Mesh(ds, this.neon(0xffffff, 1.0)));
  }

  private buildWindows(): void {
    for (const def of this.data.windows) {
      const c = cellCenter(def.x, def.z);
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      const alongX = def.dir.z !== 0; // passage along z means the opening spans x
      g.rotation.y = alongX ? 0 : Math.PI / 2;
      const frame: THREE.BufferGeometry[] = [
        boxGeo(CELL, WALL_H - 2.5, 0.7, 0, 2.5 + (WALL_H - 2.5) / 2, 0),
        boxGeo(CELL, 0.55, 0.7, 0, 0.275, 0),
        boxGeo(0.18, 1.95, 0.7, -CELL / 2 + 0.09, 1.525, 0),
        boxGeo(0.18, 1.95, 0.7, CELL / 2 - 0.09, 1.525, 0),
      ];
      const frameMesh = new THREE.Mesh(mergeGeometries(frame, false)!, this.mats.wall);
      frameMesh.castShadow = true;
      frameMesh.receiveShadow = true;
      (frameMesh.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
      g.add(frameMesh);
      this.staticTargets.push(frameMesh);
      const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), this.neon(0xff2a4a, 1.4));
      const outSign = def.dir.z !== 0 ? -def.dir.z : -def.dir.x;
      beacon.position.set(0, 2.75, outSign * 0.42);
      g.add(beacon);
      const planks: THREE.Mesh[] = [];
      for (let i = 0; i < PLANKS_MAX; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.3, 0.16, 0.1), this.mats.steel);
        plank.position.set(i % 2 === 0 ? 0.03 : -0.03, 0.72 + i * 0.4, i % 2 === 0 ? 0.04 : -0.04);
        plank.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.03;
        plank.castShadow = true;
        g.add(plank);
        planks.push(plank);
      }
      this.group.add(g);
      const inside = cellCenter(def.inside.x, def.inside.z);
      const outside = cellCenter(def.outside.x, def.outside.z);
      this.windows.push({
        def,
        planks: PLANKS_MAX,
        plankMeshes: planks,
        pos: c,
        insidePos: inside,
        outsidePos: outside,
        tearPos: { x: c.x - def.dir.x * 0.95, z: c.z - def.dir.z * 0.95 },
      });
    }
  }

  private buildDoors(): void {
    for (const def of this.data.doors) {
      const c = cellCenter(def.x, def.z);
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      g.rotation.y = def.axis === 'z' ? 0 : Math.PI / 2;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.05, WALL_H, 0.5), this.mats.metalDark);
      slab.position.y = WALL_H / 2;
      slab.castShadow = true;
      slab.receiveShadow = true;
      g.add(slab);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(CELL - 0.3, 0.08, 0.54), this.neon(0xff2a4a, 1.2));
      stripe.position.y = 2.6 - WALL_H / 2;
      slab.add(stripe);
      const tex = Tex.hologramTexture(['BLAST DOOR', `${def.cost}`], 0xff2a4a);
      const signs: THREE.Mesh[] = [];
      for (const side of [1, -1]) {
        const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.2, 1.2, 1.2), depthWrite: false });
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), mat);
        s.position.set(0, 2.35, side * 0.29);
        s.rotation.y = side > 0 ? 0 : Math.PI;
        g.add(s);
        signs.push(s);
        this.registerNeon(mat);
      }
      this.group.add(g);
      const state: DoorState = { def, open: false, anim: 0, pos: c, slab, signs };
      this.doors.push(state);
      this.doorAtCell.set(this.idx(def.x, def.z), state);
    }
  }

  private buildBuys(): void {
    for (const def of this.data.buys) {
      const weapon = WEAPONS[def.weapon];
      const c = cellCenter(def.x, def.z);
      const wallFace = { x: c.x + def.wallDir.x * (CELL / 2), z: c.z + def.wallDir.z * (CELL / 2) };
      const tex = Tex.hologramTexture([weapon.name, `${weapon.cost}`], weapon.accent);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.1, 1.1, 1.1), depthWrite: false });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.95), mat);
      sign.position.set(wallFace.x - def.wallDir.x * 0.04, 2.25, wallFace.z - def.wallDir.z * 0.04);
      sign.rotation.y = Math.atan2(-def.wallDir.x, -def.wallDir.z);
      this.group.add(sign);
      this.registerNeon(mat);
      const display = new THREE.Group();
      const model = buildGunModel(weapon.model, weapon.accent);
      model.group.scale.setScalar(1.5);
      model.group.rotation.z = 0.15;
      display.add(model.group);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 32), this.neon(weapon.accent, 1.3));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.5;
      display.add(ring);
      display.position.set(wallFace.x - def.wallDir.x * 0.55, 1.35, wallFace.z - def.wallDir.z * 0.55);
      this.group.add(display);
      this.buys.push({ def, pos: c, display });
    }
  }

  private buildPods(): void {
    for (const def of this.data.pods) {
      const c = cellCenter(def.x, def.z);
      const grate = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 1.7), this.mats.grate);
      grate.position.set(c.x, 0.03, c.z);
      grate.receiveShadow = true;
      this.group.add(grate);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: 0xff2a4a }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(c.x, 0.07, c.z);
      this.group.add(ring);
      this.pods.push({ def, pos: c, ring });
    }
  }

  private buildSigns(): void {
    for (const s of SIGNS) {
      const c = cellCenter(s.x, s.z);
      const px = c.x + s.face.x * (CELL / 2 + 0.05);
      const pz = c.z + s.face.z * (CELL / 2 + 0.05);
      const tex = Tex.signTexture(s.text, s.color, Math.round(s.w * 96), Math.round(s.h * 96));
      const k = s.broken ? 0.7 : 1.35;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(k, k, k) });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
      mesh.position.set(px, s.y, pz);
      mesh.rotation.y = Math.atan2(s.face.x, s.face.z);
      this.group.add(mesh);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.2, s.h + 0.2, 0.08), this.mats.metalDark);
      plate.position.set(c.x + s.face.x * (CELL / 2), s.y, c.z + s.face.z * (CELL / 2));
      plate.rotation.y = mesh.rotation.y;
      this.group.add(plate);
      let light: THREE.PointLight | undefined;
      if (s.light) light = this.addPointLight(s.color, 30, 12, px + s.face.x * 0.7, s.y - 0.5, pz + s.face.z * 0.7);
      this.registerNeon(mat, s.broken ? 'broken' : s.flicker ? 'flicker' : undefined, light);
    }
  }

  private buildFloods(): void {
    for (const f of FLOODS) {
      const c = cellCenter(f.x, f.z);
      const wx = c.x + f.face.x * (CELL / 2);
      const wz = c.z + f.face.z * (CELL / 2);
      const rotY = Math.atan2(f.face.x, f.face.z);
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.36), this.mats.metalDark);
      fixture.position.set(wx + f.face.x * 0.2, 3.6, wz + f.face.z * 0.2);
      fixture.rotation.y = rotY;
      fixture.castShadow = true;
      this.group.add(fixture);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), this.mats.steel);
      arm.position.set(wx + f.face.x * 0.1, 3.75, wz + f.face.z * 0.1);
      arm.rotation.y = rotY;
      this.group.add(arm);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.28), this.neon(f.color, 1.1));
      face.rotation.x = Math.PI / 2;
      face.rotation.z = rotY;
      face.position.set(wx + f.face.x * 0.2, 3.48, wz + f.face.z * 0.2);
      this.group.add(face);
      this.addPointLight(f.color, f.intensity, 22, wx + f.face.x * 0.9, 3.3, wz + f.face.z * 0.9);
    }
  }

  private buildLights(): void {
    for (const l of EXTRA_LIGHTS) this.addPointLight(l.color, l.intensity, l.distance, l.x * CELL, l.y, l.z * CELL);
    const hemi = new THREE.HemisphereLight(0x7a86bf, 0x3a3140, 1.5);
    this.group.add(hemi);
    // soft fill from the far side so shadowed faces never go fully black
    const fill = new THREE.DirectionalLight(0x6f7cb0, 0.7);
    fill.position.set(this.center.x - 60, 40, this.center.z + 50);
    fill.target.position.copy(this.center);
    this.group.add(fill);
    this.group.add(fill.target);
  }

  private buildSun(): THREE.DirectionalLight {
    const sun = new THREE.DirectionalLight(0xbcc8ff, 2.4);
    sun.position.set(this.center.x + 45, 70, this.center.z - 35);
    sun.target.position.copy(this.center);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const cam = sun.shadow.camera;
    cam.left = -60;
    cam.right = 60;
    cam.top = 60;
    cam.bottom = -60;
    cam.near = 10;
    cam.far = 220;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    this.group.add(sun);
    this.group.add(sun.target);
    return sun;
  }

  private buildSkyline(): void {
    const rnd = Tex.mulberry32(2026);
    const groups: { tex: THREE.CanvasTexture; geos: THREE.BufferGeometry[] }[] = [];
    for (let i = 0; i < 5; i++) {
      const tex = Tex.towerTexture(100 + i);
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      groups.push({ tex, geos: [] });
    }
    for (let i = 0; i < 80; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 75 + rnd() * 130;
      const w = 8 + rnd() * 22;
      const d = 8 + rnd() * 22;
      const h = 25 + Math.pow(rnd(), 1.6) * 150;
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv as THREE.BufferAttribute;
      const uRep = Math.max(1, Math.round(w / 15));
      const vRep = Math.max(1, Math.round(h / 84));
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * uRep, uv.getY(k) * vRep);
      g.translate(this.center.x + Math.cos(ang) * rad, h / 2 - 2, this.center.z + Math.sin(ang) * rad);
      groups[Math.floor(rnd() * groups.length)].geos.push(g);
    }
    for (const grp of groups) {
      const merged = mergeGeometries(grp.geos, false);
      if (!merged) continue;
      const mat = new THREE.MeshBasicMaterial({ map: grp.tex, color: new THREE.Color(0.55, 0.55, 0.55) });
      this.registerNeon(mat);
      this.group.add(new THREE.Mesh(merged, mat));
    }
    const brands: [string, number][] = [
      ['SYNTHCORP', 0x7fb4ff],
      ['KURO-TEK', 0xff3ea5],
      ['HELIX', 0x3dff8a],
      ['OMNI', 0xffb020],
      ['NEO-DYNE', 0x22e6ff],
    ];
    brands.forEach(([text, color], i) => {
      const ang = (i / brands.length) * Math.PI * 2 + 0.4;
      const rad = 120 + rnd() * 40;
      const tex = Tex.signTexture(text, color, 512, 128);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.2, 1.2, 1.2), depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(36, 9), mat);
      mesh.position.set(this.center.x + Math.cos(ang) * rad, 45 + rnd() * 50, this.center.z + Math.sin(ang) * rad);
      mesh.lookAt(this.center.x, mesh.position.y, this.center.z);
      this.group.add(mesh);
      this.registerNeon(mat, i % 2 === 0 ? 'flicker' : undefined);
    });
  }

  private buildDebris(): void {
    const rnd = Tex.mulberry32(77);
    const { width, height, kinds, propAt } = this.data;
    const floorCells: number[] = [];
    for (let i = 0; i < width * height; i++) if (kinds[i] === 'floor' && !propAt[i]) floorCells.push(i);
    const geos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 110; i++) {
      const cell = floorCells[Math.floor(rnd() * floorCells.length)];
      const x = cell % width;
      const z = (cell - x) / width;
      if (x === this.data.playerSpawn.x && z === this.data.playerSpawn.z) continue;
      const c = cellCenter(x, z);
      const s = 0.12 + rnd() * 0.32;
      const g = new THREE.BoxGeometry(s, s * (0.3 + rnd() * 0.5), s * (0.6 + rnd() * 0.8));
      g.rotateY(rnd() * Math.PI);
      g.translate(c.x + (rnd() - 0.5) * 1.5, s * 0.2, c.z + (rnd() - 0.5) * 1.5);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    if (merged) {
      const m = new THREE.Mesh(merged, this.mats.concrete);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  private buildRain(): { points: THREE.Points; mat: THREE.ShaderMaterial } {
    const rnd = Tex.mulberry32(4242);
    const { width, height, kinds, zones } = this.data;
    const cells: number[] = [];
    for (let i = 0; i < width * height; i++) {
      const k = kinds[i];
      if (k === 'outside' || k === 'wall' || k === 'window' || k === 'door' || (k === 'floor' && ZONES[zones[i]]?.outdoor)) cells.push(i);
    }
    const N = 7000;
    const pos = new Float32Array(N * 3);
    const speed = new Float32Array(N);
    const phase = new Float32Array(N);
    const H = 18;
    for (let i = 0; i < N; i++) {
      const cell = cells[Math.floor(rnd() * cells.length)];
      const x = cell % width;
      const z = (cell - x) / width;
      pos[i * 3] = (x + rnd()) * CELL;
      pos[i * 3 + 1] = rnd() * H;
      pos[i * 3 + 2] = (z + rnd()) * CELL;
      speed[i] = 9 + rnd() * 6;
      phase[i] = rnd() * H;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.boundingSphere = new THREE.Sphere(this.center.clone().setY(H / 2), Math.hypot(width * CELL, height * CELL));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uHeight: { value: H },
        uColor: { value: new THREE.Color(0.45, 0.6, 0.85) },
      },
      vertexShader: `
        attribute float aSpeed; attribute float aPhase;
        uniform float uTime; uniform float uHeight;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * aSpeed + aPhase, uHeight);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = max(0.1, -mv.z);
          gl_PointSize = clamp(240.0 / d, 2.0, 30.0);
          vAlpha = clamp(1.3 - d / 40.0, 0.0, 1.0) * 0.35;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          if (abs(c.x) > 0.07) discard;
          float a = (1.0 - abs(c.y) * 2.0) * vAlpha;
          gl_FragColor = vec4(uColor, a);
        }`,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, mat };
  }
}
