// Dijkstra flow field over the grid. Every walkable cell stores its distance to the target;
// enemies descend the gradient. One field serves every enemy, so cost does not grow with the horde.

const SQRT2 = Math.SQRT2;

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lastK = k.pop()!;
    const lastV = v.pop()!;
    if (k.length > 0) {
      k[0] = lastK;
      v[0] = lastV;
      let i = 0;
      const n = k.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < n && k[l] < k[m]) m = l;
        if (r < n && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export class FlowField {
  readonly dist: Float32Array;
  private readonly width: number;
  private readonly height: number;
  targetX = -1;
  targetZ = -1;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.dist = new Float32Array(width * height).fill(Infinity);
  }

  private idx(x: number, z: number): number {
    return z * this.width + x;
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  /** Recompute distances from the target cell. `walkable[i] === 1` marks passable cells. */
  compute(walkable: Uint8Array, targetX: number, targetZ: number): void {
    const { width, height, dist } = this;
    dist.fill(Infinity);
    if (!this.inBounds(targetX, targetZ)) return;
    this.targetX = targetX;
    this.targetZ = targetZ;
    const start = this.idx(targetX, targetZ);
    dist[start] = 0;
    const heap = new MinHeap();
    heap.push(0, start);
    while (heap.size > 0) {
      const i = heap.pop();
      const d = dist[i];
      const x = i % width;
      const z = (i - x) / width;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
          const j = nz * width + nx;
          if (!walkable[j]) continue;
          if (dx !== 0 && dz !== 0) {
            // no corner cutting: both orthogonal neighbours must be walkable
            if (!walkable[z * width + nx] || !walkable[nz * width + x]) continue;
          }
          const nd = d + (dx !== 0 && dz !== 0 ? SQRT2 : 1);
          if (nd < dist[j]) {
            dist[j] = nd;
            heap.push(nd, j);
          }
        }
      }
    }
  }

  distanceAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return Infinity;
    return this.dist[this.idx(x, z)];
  }

  /** Neighbour cell with the lowest distance, or null when the cell is unreachable. */
  bestNeighbor(x: number, z: number, walkable: Uint8Array): { x: number; z: number } | null {
    const { width } = this;
    let best = this.distanceAt(x, z);
    let bx = -1;
    let bz = -1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inBounds(nx, nz)) continue;
        if (!walkable[nz * width + nx]) continue;
        if (dx !== 0 && dz !== 0) {
          if (!walkable[z * width + nx] || !walkable[nz * width + x]) continue;
        }
        const d = this.dist[nz * width + nx];
        if (d < best) {
          best = d;
          bx = nx;
          bz = nz;
        }
      }
    }
    return bx < 0 ? null : { x: bx, z: bz };
  }
}
