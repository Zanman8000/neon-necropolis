// Persistent player settings and the DOM panel that edits them.

export type Quality = 'low' | 'medium' | 'high';

export interface SettingsData {
  sensitivity: number;
  fov: number;
  volume: number;
  neon: number;
  quality: Quality;
  rain: boolean;
  invertY: boolean;
}

export const DEFAULT_SETTINGS: SettingsData = {
  sensitivity: 1,
  fov: 75,
  volume: 0.8,
  neon: 1,
  quality: 'high',
  rain: true,
  invertY: false,
};

const KEY = 'neon-necropolis.settings';

function clamp(v: number, lo: number, hi: number, fallback: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
}

export function loadSettings(): SettingsData {
  const d = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<SettingsData>;
    d.sensitivity = clamp(Number(p.sensitivity), 0.2, 3, d.sensitivity);
    d.fov = clamp(Number(p.fov), 60, 110, d.fov);
    d.volume = clamp(Number(p.volume), 0, 1, d.volume);
    d.neon = clamp(Number(p.neon), 0, 2, d.neon);
    if (p.quality === 'low' || p.quality === 'medium' || p.quality === 'high') d.quality = p.quality;
    if (typeof p.rain === 'boolean') d.rain = p.rain;
    if (typeof p.invertY === 'boolean') d.invertY = p.invertY;
  } catch {
    /* corrupt or unavailable storage: use defaults */
  }
  return d;
}

export function saveSettings(s: SettingsData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Missing settings element #${id}`);
  return e as T;
}

export class SettingsPanel {
  private readonly overlay = el<HTMLElement>('overlay-settings');
  private readonly sens = el<HTMLInputElement>('set-sens');
  private readonly fov = el<HTMLInputElement>('set-fov');
  private readonly vol = el<HTMLInputElement>('set-vol');
  private readonly neon = el<HTMLInputElement>('set-neon');
  private readonly quality = el<HTMLSelectElement>('set-quality');
  private readonly rain = el<HTMLInputElement>('set-rain');
  private readonly invert = el<HTMLInputElement>('set-invert');
  private readonly outSens = el<HTMLOutputElement>('out-sens');
  private readonly outFov = el<HTMLOutputElement>('out-fov');
  private readonly outVol = el<HTMLOutputElement>('out-vol');
  private readonly outNeon = el<HTMLOutputElement>('out-neon');

  constructor(
    readonly data: SettingsData,
    private readonly onApply: (s: SettingsData) => void,
    private readonly onBack: () => void,
  ) {
    const changed = () => {
      this.data.sensitivity = Number(this.sens.value);
      this.data.fov = Number(this.fov.value);
      this.data.volume = Number(this.vol.value);
      this.data.neon = Number(this.neon.value);
      this.data.quality = this.quality.value as Quality;
      this.data.rain = this.rain.checked;
      this.data.invertY = this.invert.checked;
      this.sync();
      this.onApply(this.data);
      saveSettings(this.data);
    };
    for (const input of [this.sens, this.fov, this.vol, this.neon, this.rain, this.invert]) input.addEventListener('input', changed);
    this.quality.addEventListener('change', changed);
    el<HTMLButtonElement>('btn-settings-reset').addEventListener('click', () => {
      Object.assign(this.data, DEFAULT_SETTINGS);
      this.sync();
      this.onApply(this.data);
      saveSettings(this.data);
    });
    el<HTMLButtonElement>('btn-settings-back').addEventListener('click', () => this.onBack());
    this.sync();
  }

  get isOpen(): boolean {
    return !this.overlay.classList.contains('hidden');
  }

  open(): void {
    this.sync();
    this.overlay.classList.remove('hidden');
  }

  close(): void {
    this.overlay.classList.add('hidden');
  }

  private sync(): void {
    const d = this.data;
    this.sens.value = String(d.sensitivity);
    this.fov.value = String(d.fov);
    this.vol.value = String(d.volume);
    this.neon.value = String(d.neon);
    this.quality.value = d.quality;
    this.rain.checked = d.rain;
    this.invert.checked = d.invertY;
    this.outSens.value = d.sensitivity.toFixed(2);
    this.outFov.value = String(Math.round(d.fov));
    this.outVol.value = `${Math.round(d.volume * 100)}%`;
    this.outNeon.value = `${Math.round(d.neon * 100)}%`;
  }
}
