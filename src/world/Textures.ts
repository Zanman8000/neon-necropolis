// Procedural canvas textures. Everything is generated at load so the game ships with zero image assets.
import * as THREE from 'three';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  return { c, g };
}

export function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function hex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0');
}

function speckle(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, count: number, color: string, alpha: number, size = 1.5): void {
  g.fillStyle = color;
  g.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const s = size * (0.5 + rnd());
    g.fillRect(rnd() * w, rnd() * h, s, s);
  }
  g.globalAlpha = 1;
}

function grime(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = (0.08 + rnd() * 0.25) * w;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function crack(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, count: number): void {
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 1.2;
  for (let i = 0; i < count; i++) {
    let x = rnd() * w;
    let y = rnd() * h;
    g.beginPath();
    g.moveTo(x, y);
    const segs = 4 + Math.floor(rnd() * 6);
    for (let s = 0; s < segs; s++) {
      x += (rnd() - 0.5) * w * 0.12;
      y += (rnd() - 0.5) * h * 0.12;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

/** Polished concrete plaza tile, one 2 m cell per texture repeat. */
export function floorTexture(seed = 1): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#4b515d';
  g.fillRect(0, 0, S, S);
  speckle(g, rnd, S, S, 9000, '#5d6472', 0.35, 2);
  speckle(g, rnd, S, S, 5000, '#2e333d', 0.4, 2);
  // sub-tiles: 2 x 2 per cell with seams
  g.strokeStyle = '#1e222a';
  g.lineWidth = 6;
  g.strokeRect(0, 0, S, S);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2, S);
  g.moveTo(0, S / 2);
  g.lineTo(S, S / 2);
  g.stroke();
  // faint inlaid guide line
  g.strokeStyle = 'rgba(90,200,230,0.35)';
  g.lineWidth = 2;
  g.strokeRect(14, 14, S - 28, S - 28);
  grime(g, rnd, S, S, 6, 0.5);
  crack(g, rnd, S, S, 3);
  return toTexture(c);
}

/** Wet asphalt outside the plaza walls. */
export function asphaltTexture(seed = 7): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#2a2d35';
  g.fillRect(0, 0, S, S);
  speckle(g, rnd, S, S, 5000, '#3a3e48', 0.4, 1.5);
  grime(g, rnd, S, S, 3, 0.6);
  return toTexture(c);
}

/** Corporate metal wall panels: 2 m wide by 4 m tall per repeat. */
export function wallTexture(seed = 3, tint = '#4c525e'): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const W = 256;
  const H = 512;
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = tint;
  g.fillRect(0, 0, W, H);
  speckle(g, rnd, W, H, 4000, '#5c6270', 0.3, 1.5);
  // panel grid 2 x 4
  const pw = W / 2;
  const ph = H / 4;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 4; j++) {
      const x = i * pw;
      const y = j * ph;
      const grad = g.createLinearGradient(x, y, x + pw, y + ph);
      grad.addColorStop(0, 'rgba(255,255,255,0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = grad;
      g.fillRect(x + 3, y + 3, pw - 6, ph - 6);
      g.strokeStyle = '#22262e';
      g.lineWidth = 3;
      g.strokeRect(x + 1.5, y + 1.5, pw - 3, ph - 3);
      g.fillStyle = '#767d8c';
      for (const [rx, ry] of [
        [x + 9, y + 9],
        [x + pw - 9, y + 9],
        [x + 9, y + ph - 9],
        [x + pw - 9, y + ph - 9],
      ]) {
        g.beginPath();
        g.arc(rx, ry, 2.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // grime streaks running down from panel seams
  for (let i = 0; i < 8; i++) {
    const x = rnd() * W;
    const len = H * (0.2 + rnd() * 0.5);
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 3 + rnd() * 6, len);
  }
  // rust bloom
  for (let i = 0; i < 4; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 12 + rnd() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(120,60,20,0.35)');
    grad.addColorStop(1, 'rgba(120,60,20,0)');
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return toTexture(c);
}

export function ceilingTexture(seed = 5): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#3a3e48';
  g.fillRect(0, 0, S, S);
  speckle(g, rnd, S, S, 2000, '#474c58', 0.4, 2);
  g.strokeStyle = '#1c1f26';
  g.lineWidth = 4;
  g.strokeRect(0, 0, S, S);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(S / 2, 0);
  g.lineTo(S / 2, S);
  g.moveTo(0, S / 2);
  g.lineTo(S, S / 2);
  g.stroke();
  return toTexture(c);
}

/** Server rack front with LED rows. Returns colour map and emissive map. */
export function rackTextures(seed = 11): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const rnd = mulberry32(seed);
  const W = 128;
  const H = 256;
  const a = makeCanvas(W, H);
  const e = makeCanvas(W, H);
  a.g.fillStyle = '#353942';
  a.g.fillRect(0, 0, W, H);
  e.g.fillStyle = '#000';
  e.g.fillRect(0, 0, W, H);
  for (let y = 8; y < H - 8; y += 14) {
    a.g.fillStyle = '#1c1f25';
    a.g.fillRect(6, y, W - 12, 10);
    a.g.fillStyle = '#4a4f5a';
    a.g.fillRect(8, y + 2, W - 40, 6);
    for (let i = 0; i < 4; i++) {
      const on = rnd() > 0.35;
      const col = rnd() < 0.15 ? '#ff3030' : rnd() < 0.5 ? '#3dff8a' : '#22e6ff';
      e.g.fillStyle = on ? col : '#000';
      e.g.fillRect(W - 30 + i * 6, y + 3, 3, 3);
    }
  }
  return { map: toTexture(a.c), emissive: toTexture(e.c) };
}

/** Neon sign on a transparent background. Meant for MeshBasicMaterial with a bright colour multiplier. */
export function signTexture(text: string, color: number, wPx: number, hPx: number, font = 'Orbitron'): THREE.CanvasTexture {
  const { c, g } = makeCanvas(wPx, hPx);
  g.clearRect(0, 0, wPx, hPx);
  const col = hex(color);
  let size = hPx * 0.62;
  g.font = `700 ${size}px ${font}, "Segoe UI", sans-serif`;
  while (g.measureText(text).width > wPx * 0.9 && size > 8) {
    size -= 2;
    g.font = `700 ${size}px ${font}, "Segoe UI", sans-serif`;
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = col;
  g.shadowBlur = hPx * 0.35;
  g.fillStyle = col;
  g.fillText(text, wPx / 2, hPx / 2);
  g.fillText(text, wPx / 2, hPx / 2);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.globalAlpha = 0.85;
  g.fillText(text, wPx / 2, hPx / 2);
  g.globalAlpha = 1;
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Holographic price tag: bordered panel with two text lines and scanlines. */
export function hologramTexture(lines: string[], color: number, wPx = 512, hPx = 256): THREE.CanvasTexture {
  const { c, g } = makeCanvas(wPx, hPx);
  const col = hex(color);
  g.clearRect(0, 0, wPx, hPx);
  g.fillStyle = 'rgba(0,20,30,0.55)';
  g.fillRect(0, 0, wPx, hPx);
  g.strokeStyle = col;
  g.lineWidth = 6;
  g.strokeRect(8, 8, wPx - 16, hPx - 16);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = col;
  g.shadowBlur = 18;
  lines.forEach((line, i) => {
    const size = i === 0 ? hPx * 0.26 : hPx * 0.2;
    g.font = `${i === 0 ? 700 : 500} ${size}px Orbitron, "Segoe UI", sans-serif`;
    g.fillStyle = i === 0 ? '#ffffff' : col;
    const y = lines.length === 1 ? hPx / 2 : hPx * (0.36 + i * 0.3);
    g.fillText(line, wPx / 2, y);
  });
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let y = 0; y < hPx; y += 4) g.fillRect(0, y, wPx, 1);
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Distant tower facade: dark with a scatter of lit windows. */
export function towerTexture(seed: number, floors = 24, cols = 6): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const W = 128;
  const H = 512;
  const { c, g } = makeCanvas(W, H);
  g.fillStyle = '#05060a';
  g.fillRect(0, 0, W, H);
  const cw = W / cols;
  const fh = H / floors;
  const palette = ['#ffd27a', '#22e6ff', '#ff3ea5', '#9ec4ff', '#ffffff'];
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < cols; i++) {
      if (rnd() < 0.55) continue;
      g.fillStyle = palette[Math.floor(rnd() * palette.length)];
      g.globalAlpha = 0.5 + rnd() * 0.5;
      g.fillRect(i * cw + 3, f * fh + 3, cw - 6, fh - 6);
    }
  }
  g.globalAlpha = 1;
  const t = toTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Mottled necrotic skin. */
export function skinTexture(seed = 21): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const S = 128;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = '#9aa494';
  g.fillRect(0, 0, S, S);
  speckle(g, rnd, S, S, 2500, '#6f7a6a', 0.5, 2);
  speckle(g, rnd, S, S, 900, '#b8c0ae', 0.4, 2);
  g.strokeStyle = 'rgba(40,20,40,0.5)';
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    let x = rnd() * S;
    let y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      x += (rnd() - 0.5) * 24;
      y += (rnd() - 0.5) * 24;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  grime(g, rnd, S, S, 4, 0.45);
  return toTexture(c);
}

/** Worn dark fabric. */
export function clothTexture(seed = 33, base = '#5a5e6a'): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const S = 128;
  const { c, g } = makeCanvas(S, S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  speckle(g, rnd, S, S, 3000, '#000000', 0.2, 1.5);
  speckle(g, rnd, S, S, 1200, '#ffffff', 0.1, 1.5);
  grime(g, rnd, S, S, 3, 0.4);
  return toTexture(c);
}

/** Soft round particle sprite. */
export function sparkTexture(): THREE.CanvasTexture {
  const S = 64;
  const { c, g } = makeCanvas(S, S);
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Muzzle flash: bright star burst. */
export function flashTexture(): THREE.CanvasTexture {
  const S = 128;
  const { c, g } = makeCanvas(S, S);
  g.clearRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,230,160,0.9)');
  grad.addColorStop(0.6, 'rgba(255,150,60,0.35)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(S * 0.5, -S * 0.08);
    g.lineTo(S * 0.5, S * 0.08);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, S * 0.2, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
