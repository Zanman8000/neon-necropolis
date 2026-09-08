// Pure grid/map parsing. No three.js imports here so it can be unit tested in node.

export const CELL = 2; // metres per grid cell
export const WALL_H = 4; // wall height in metres
export const PLANKS_MAX = 5; // barricade segments per window

export type CellKind = 'void' | 'outside' | 'wall' | 'floor' | 'door' | 'window';

export interface Vec2i {
  x: number;
  z: number;
}

export interface DoorDef {
  id: number;
  x: number;
  z: number;
  cost: number;
  axis: 'x' | 'z'; // axis of travel through the door
  zones: [number, number];
}

export interface WindowDef {
  id: number;
  x: number;
  z: number;
  inside: Vec2i;
  outside: Vec2i;
  dir: Vec2i; // unit step from the window cell toward the inside cell
  zone: number;
}

export interface BuyDef {
  id: number;
  x: number;
  z: number;
  weapon: string;
  wallDir: Vec2i; // unit step from the buy cell toward the wall it hangs on
  zone: number;
}

export interface PodDef {
  id: number;
  x: number;
  z: number;
  zone: number;
}

export interface PropDef {
  kind: string;
  x: number;
  z: number;
  zone: number;
}

/** A perk vending machine. Occupies its cell and backs onto a wall. */
export interface PerkDef {
  id: number;
  kind: string;
  x: number;
  z: number;
  wallDir: Vec2i;
  zone: number;
}

/** A pad the salvage crate can sit on. Occupies its cell. */
export interface CrateDef {
  id: number;
  x: number;
  z: number;
  zone: number;
}

/** Power lever (walkable cell, lever on the wall) and the upgrade station (occupies its cell). */
export interface StationDef {
  x: number;
  z: number;
  wallDir: Vec2i;
  zone: number;
}

export interface ParsedLevel {
  width: number;
  height: number;
  kinds: CellKind[];
  zones: Int16Array; // zone id per cell, 0 = none
  propAt: Uint8Array; // 1 if a blocking prop occupies the cell
  props: PropDef[];
  doors: DoorDef[];
  windows: WindowDef[];
  buys: BuyDef[];
  pods: PodDef[];
  perks: PerkDef[];
  crates: CrateDef[];
  power: StationDef | null;
  upgrade: StationDef | null;
  playerSpawn: Vec2i;
}

export const PROP_CHARS: Record<string, string> = {
  k: 'kiosk',
  b: 'bench',
  p: 'planter',
  v: 'vendor',
  c: 'column',
  d: 'desk',
  r: 'rack',
};

export const BUY_CHARS: Record<string, string> = {
  A: 'smg',
  B: 'shotgun',
  C: 'rifle',
};

export const PERK_CHARS: Record<string, string> = {
  Q: 'quickpatch',
  J: 'ironhide',
  R: 'rapidrack',
  T: 'triggertonic',
  M: 'packmule',
};

const DIRS4: Vec2i[] = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

export function cellCenter(x: number, z: number): { x: number; z: number } {
  return { x: (x + 0.5) * CELL, z: (z + 0.5) * CELL };
}

export function worldToCell(wx: number, wz: number): Vec2i {
  return { x: Math.floor(wx / CELL), z: Math.floor(wz / CELL) };
}

export function parseLevel(rows: string[], doorCosts: Record<string, number>): ParsedLevel {
  const height = rows.length;
  const width = rows[0].length;
  for (let z = 0; z < height; z++) {
    if (rows[z].length !== width) {
      throw new Error(`Map row ${z} has length ${rows[z].length}, expected ${width}`);
    }
  }
  const n = width * height;
  const kinds: CellKind[] = new Array(n).fill('void');
  const zones = new Int16Array(n);
  const propAt = new Uint8Array(n);
  const idx = (x: number, z: number) => z * width + x;
  const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < width && z < height;

  const props: PropDef[] = [];
  const doorCells: Vec2i[] = [];
  const windowCells: Vec2i[] = [];
  const buyCells: { x: number; z: number; weapon: string }[] = [];
  const podCells: Vec2i[] = [];
  const perkCells: { x: number; z: number; kind: string }[] = [];
  const crateCells: Vec2i[] = [];
  let powerCell: Vec2i | null = null;
  let upgradeCell: Vec2i | null = null;
  let playerSpawn: Vec2i | null = null;

  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[z][x];
      const i = idx(x, z);
      if (ch === ' ') {
        kinds[i] = 'void';
      } else if (ch === 'o') {
        kinds[i] = 'outside';
      } else if (ch === '#') {
        kinds[i] = 'wall';
      } else if (ch === 'D') {
        kinds[i] = 'door';
        doorCells.push({ x, z });
      } else if (ch === 'W') {
        kinds[i] = 'window';
        windowCells.push({ x, z });
      } else if (ch >= '1' && ch <= '9') {
        kinds[i] = 'floor';
        zones[i] = ch.charCodeAt(0) - 48;
      } else if (ch === 'P') {
        kinds[i] = 'floor';
        if (playerSpawn) throw new Error('Multiple player spawns');
        playerSpawn = { x, z };
      } else if (ch === 'S') {
        kinds[i] = 'floor';
        podCells.push({ x, z });
      } else if (ch === 'E') {
        kinds[i] = 'floor';
        if (powerCell) throw new Error('Multiple power switches');
        powerCell = { x, z };
      } else if (ch === 'U') {
        kinds[i] = 'floor';
        propAt[i] = 1;
        if (upgradeCell) throw new Error('Multiple upgrade stations');
        upgradeCell = { x, z };
      } else if (ch === 'X') {
        kinds[i] = 'floor';
        propAt[i] = 1;
        crateCells.push({ x, z });
      } else if (BUY_CHARS[ch]) {
        kinds[i] = 'floor';
        buyCells.push({ x, z, weapon: BUY_CHARS[ch] });
      } else if (PERK_CHARS[ch]) {
        kinds[i] = 'floor';
        propAt[i] = 1;
        perkCells.push({ x, z, kind: PERK_CHARS[ch] });
      } else if (PROP_CHARS[ch]) {
        kinds[i] = 'floor';
        propAt[i] = 1;
        props.push({ kind: PROP_CHARS[ch], x, z, zone: 0 });
      } else {
        throw new Error(`Unknown map char '${ch}' at ${x},${z}`);
      }
    }
  }
  if (!playerSpawn) throw new Error('Map has no player spawn (P)');

  // Flood-fill zone ids into floor cells that have none (props, buys, pods, spawn).
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (kinds[i] === 'floor' && zones[i] > 0) queue.push(i);
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    const x = i % width;
    const z = (i - x) / width;
    for (const d of DIRS4) {
      const nx = x + d.x;
      const nz = z + d.z;
      if (!inBounds(nx, nz)) continue;
      const j = idx(nx, nz);
      if (kinds[j] === 'floor' && zones[j] === 0) {
        zones[j] = zones[i];
        queue.push(j);
      }
    }
  }
  for (let i = 0; i < n; i++) {
    if (kinds[i] === 'floor' && zones[i] === 0) {
      throw new Error(`Floor cell ${i % width},${Math.floor(i / width)} has no zone`);
    }
  }
  for (const p of props) p.zone = zones[idx(p.x, p.z)];

  const wallNeighbor = (c: Vec2i, what: string): Vec2i => {
    const wall = DIRS4.find((d) => inBounds(c.x + d.x, c.z + d.z) && kinds[idx(c.x + d.x, c.z + d.z)] === 'wall');
    if (!wall) throw new Error(`${what} at ${c.x},${c.z} is not next to a wall`);
    return wall;
  };

  const doors: DoorDef[] = doorCells.map((c, id) => {
    const floorAt = (x: number, z: number) => inBounds(x, z) && kinds[idx(x, z)] === 'floor';
    let axis: 'x' | 'z';
    let a: Vec2i;
    let b: Vec2i;
    if (floorAt(c.x - 1, c.z) && floorAt(c.x + 1, c.z)) {
      axis = 'x';
      a = { x: c.x - 1, z: c.z };
      b = { x: c.x + 1, z: c.z };
    } else if (floorAt(c.x, c.z - 1) && floorAt(c.x, c.z + 1)) {
      axis = 'z';
      a = { x: c.x, z: c.z - 1 };
      b = { x: c.x, z: c.z + 1 };
    } else {
      throw new Error(`Door at ${c.x},${c.z} is not between two floor cells`);
    }
    const za = zones[idx(a.x, a.z)];
    const zb = zones[idx(b.x, b.z)];
    const key = `${Math.min(za, zb)}-${Math.max(za, zb)}`;
    const cost = doorCosts[key];
    if (cost === undefined) throw new Error(`No door cost for zones ${key}`);
    return { id, x: c.x, z: c.z, cost, axis, zones: [za, zb] };
  });

  const windows: WindowDef[] = windowCells.map((c, id) => {
    const insides = DIRS4.filter((d) => inBounds(c.x + d.x, c.z + d.z) && kinds[idx(c.x + d.x, c.z + d.z)] === 'floor');
    if (insides.length !== 1) {
      throw new Error(`Window at ${c.x},${c.z} must touch exactly one floor cell, found ${insides.length}`);
    }
    const dir = insides[0];
    const inside = { x: c.x + dir.x, z: c.z + dir.z };
    const outside = { x: c.x - dir.x, z: c.z - dir.z };
    if (!inBounds(outside.x, outside.z) || kinds[idx(outside.x, outside.z)] !== 'outside') {
      throw new Error(`Window at ${c.x},${c.z} has no outside cell behind it`);
    }
    return { id, x: c.x, z: c.z, inside, outside, dir, zone: zones[idx(inside.x, inside.z)] };
  });

  const buys: BuyDef[] = buyCells.map((c, id) => ({
    id,
    x: c.x,
    z: c.z,
    weapon: c.weapon,
    wallDir: wallNeighbor(c, 'Wall buy'),
    zone: zones[idx(c.x, c.z)],
  }));

  const pods: PodDef[] = podCells.map((c, id) => ({ id, x: c.x, z: c.z, zone: zones[idx(c.x, c.z)] }));

  const perks: PerkDef[] = perkCells.map((c, id) => ({
    id,
    kind: c.kind,
    x: c.x,
    z: c.z,
    wallDir: wallNeighbor(c, 'Perk machine'),
    zone: zones[idx(c.x, c.z)],
  }));

  const crates: CrateDef[] = crateCells.map((c, id) => ({ id, x: c.x, z: c.z, zone: zones[idx(c.x, c.z)] }));

  const station = (c: Vec2i | null, what: string): StationDef | null =>
    c ? { x: c.x, z: c.z, wallDir: wallNeighbor(c, what), zone: zones[idx(c.x, c.z)] } : null;

  return {
    width,
    height,
    kinds,
    zones,
    propAt,
    props,
    doors,
    windows,
    buys,
    pods,
    perks,
    crates,
    power: station(powerCell, 'Power switch'),
    upgrade: station(upgradeCell, 'Upgrade station'),
    playerSpawn,
  };
}

/** Grid-aligned line of sight test between two world points (2D). */
export function lineOfSight(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  isBlocked: (cx: number, cz: number) => boolean,
): boolean {
  // Amanatides & Woo voxel traversal.
  let cx = Math.floor(ax / CELL);
  let cz = Math.floor(az / CELL);
  const ex = Math.floor(bx / CELL);
  const ez = Math.floor(bz / CELL);
  const dx = bx - ax;
  const dz = bz - az;
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(CELL / dx) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(CELL / dz) : Infinity;
  const nextX = stepX > 0 ? (cx + 1) * CELL : cx * CELL;
  const nextZ = stepZ > 0 ? (cz + 1) * CELL : cz * CELL;
  let tMaxX = stepX !== 0 ? (nextX - ax) / dx : Infinity;
  let tMaxZ = stepZ !== 0 ? (nextZ - az) / dz : Infinity;
  let guard = 0;
  while (guard++ < 512) {
    if (isBlocked(cx, cz)) return false;
    if (cx === ex && cz === ez) return true;
    if (tMaxX < tMaxZ) {
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      tMaxZ += tDeltaZ;
      cz += stepZ;
    }
    if (tMaxX > 1 && tMaxZ > 1 && cx === ex && cz === ez) return !isBlocked(cx, cz);
  }
  return false;
}

/**
 * Move a circle of radius r by (dx, dz) through blocked cells, sliding along walls.
 * The circle is treated as an axis-aligned square for wall tests, which never snags on seams.
 */
export function moveWithCollision(
  pos: { x: number; z: number },
  dx: number,
  dz: number,
  r: number,
  isBlocked: (cx: number, cz: number) => boolean,
): void {
  const EPS = 0.001;
  if (dx !== 0) {
    const oldEdge = dx > 0 ? pos.x + r : pos.x - r;
    pos.x += dx;
    const newEdge = dx > 0 ? pos.x + r : pos.x - r;
    const minZ = Math.floor((pos.z - r) / CELL);
    const maxZ = Math.floor((pos.z + r) / CELL);
    const c0 = Math.floor(oldEdge / CELL);
    const c1 = Math.floor(newEdge / CELL);
    const step = dx > 0 ? 1 : -1;
    outer: for (let cx = c0; step > 0 ? cx <= c1 : cx >= c1; cx += step) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        if (isBlocked(cx, cz)) {
          pos.x = dx > 0 ? cx * CELL - r - EPS : (cx + 1) * CELL + r + EPS;
          break outer;
        }
      }
    }
  }
  if (dz !== 0) {
    const oldEdge = dz > 0 ? pos.z + r : pos.z - r;
    pos.z += dz;
    const newEdge = dz > 0 ? pos.z + r : pos.z - r;
    const minX = Math.floor((pos.x - r) / CELL);
    const maxX = Math.floor((pos.x + r) / CELL);
    const c0 = Math.floor(oldEdge / CELL);
    const c1 = Math.floor(newEdge / CELL);
    const step = dz > 0 ? 1 : -1;
    outer: for (let cz = c0; step > 0 ? cz <= c1 : cz >= c1; cz += step) {
      for (let cx = minX; cx <= maxX; cx++) {
        if (isBlocked(cx, cz)) {
          pos.z = dz > 0 ? cz * CELL - r - EPS : (cz + 1) * CELL + r + EPS;
          break outer;
        }
      }
    }
  }
}
