import { describe, expect, it } from 'vitest';
import { parseLevel, lineOfSight, moveWithCollision, CELL } from '../src/world/Grid';
import { MAP_ROWS, DOOR_COSTS, SIGNS, ZONES } from '../src/world/LevelData';
import { FlowField } from '../src/enemies/FlowField';

const level = parseLevel(MAP_ROWS, DOOR_COSTS);
const idx = (x: number, z: number) => z * level.width + x;

function walkableWithDoors(openDoors: Set<number>): Uint8Array {
  const w = new Uint8Array(level.width * level.height);
  for (let i = 0; i < w.length; i++) {
    w[i] = level.kinds[i] === 'floor' && !level.propAt[i] ? 1 : 0;
  }
  for (const d of level.doors) if (openDoors.has(d.id)) w[idx(d.x, d.z)] = 1;
  return w;
}

describe('map data', () => {
  it('parses with the expected dimensions', () => {
    expect(level.width).toBe(44);
    expect(level.height).toBe(32);
  });

  it('has the expected interactables', () => {
    expect(level.doors.length).toBe(4);
    expect(level.windows.length).toBe(9);
    expect(level.buys.length).toBe(3);
    expect(level.pods.length).toBe(3);
    expect(level.perks.length).toBe(5);
    expect(level.crates.length).toBe(4);
    expect(level.power).not.toBeNull();
    expect(level.upgrade).not.toBeNull();
    expect(level.playerSpawn).toEqual({ x: 11, z: 24 });
  });

  it('machines block their cell and can be reached from an adjacent walkable cell', () => {
    const field = new FlowField(level.width, level.height);
    const walkable = walkableWithDoors(new Set(level.doors.map((d) => d.id)));
    field.compute(walkable, level.playerSpawn.x, level.playerSpawn.z);
    const cells = [...level.perks, ...level.crates, level.upgrade!];
    for (const c of cells) {
      expect(level.propAt[idx(c.x, c.z)]).toBe(1);
      const reachable = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dz]) => field.distanceAt(c.x + dx, c.z + dz) < Infinity);
      expect(reachable).toBe(true);
    }
    const p = level.power!;
    expect(level.propAt[idx(p.x, p.z)]).toBe(0);
    expect(field.distanceAt(p.x, p.z)).toBeLessThan(Infinity);
  });

  it('assigns every floor cell to a known zone', () => {
    const seen = new Set<number>();
    for (let i = 0; i < level.kinds.length; i++) {
      if (level.kinds[i] === 'floor') {
        expect(level.zones[i]).toBeGreaterThan(0);
        seen.add(level.zones[i]);
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
    for (const z of seen) expect(ZONES[z]).toBeDefined();
  });

  it('doors connect two different zones', () => {
    for (const d of level.doors) {
      expect(d.zones[0]).not.toBe(d.zones[1]);
      expect(d.cost).toBeGreaterThan(0);
    }
  });

  it('signs hang on wall cells and face a floor cell', () => {
    for (const s of SIGNS) {
      expect(level.kinds[idx(s.x, s.z)]).toBe('wall');
      const fx = s.x + s.face.x;
      const fz = s.z + s.face.z;
      expect(level.kinds[idx(fx, fz)]).toBe('floor');
    }
  });

  it('every window is reachable from spawn once all doors are open', () => {
    const field = new FlowField(level.width, level.height);
    const allOpen = new Set(level.doors.map((d) => d.id));
    field.compute(walkableWithDoors(allOpen), level.playerSpawn.x, level.playerSpawn.z);
    for (const w of level.windows) {
      expect(field.distanceAt(w.inside.x, w.inside.z)).toBeLessThan(Infinity);
    }
    for (const p of level.pods) {
      expect(field.distanceAt(p.x, p.z)).toBeLessThan(Infinity);
    }
  });

  it('closed doors seal off other zones', () => {
    const field = new FlowField(level.width, level.height);
    field.compute(walkableWithDoors(new Set()), level.playerSpawn.x, level.playerSpawn.z);
    for (const w of level.windows) {
      const reachable = field.distanceAt(w.inside.x, w.inside.z) < Infinity;
      expect(reachable).toBe(w.zone === 1);
    }
  });
});

describe('grid helpers', () => {
  const blocked = (x: number, z: number) => x === 5 && z >= 0 && z <= 10; // a wall along x=5

  it('line of sight is blocked by walls and open otherwise', () => {
    expect(lineOfSight(1 * CELL, 3 * CELL, 9 * CELL, 3 * CELL, blocked)).toBe(false);
    expect(lineOfSight(1 * CELL, 3 * CELL, 4 * CELL, 8 * CELL, blocked)).toBe(true);
  });

  it('collision stops movement at a wall and keeps sliding along it', () => {
    const pos = { x: 4.2 * CELL, z: 3 * CELL };
    moveWithCollision(pos, 5, 1, 0.36, blocked);
    expect(pos.x).toBeLessThan(5 * CELL - 0.36);
    expect(pos.x).toBeGreaterThan(4.5 * CELL);
    expect(pos.z).toBeCloseTo(3 * CELL + 1);
  });
});
