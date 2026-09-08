export type GunModelKind = 'pistol' | 'smg' | 'shotgun' | 'rifle';

export interface WeaponDef {
  id: string;
  name: string;
  model: GunModelKind;
  auto: boolean;
  rpm: number;
  damage: number;
  headMult: number;
  pellets: number;
  /** Hip-fire cone half-angle in radians. */
  spread: number;
  adsSpread: number;
  magSize: number;
  reserveMax: number;
  reloadTime: number;
  cost: number;
  range: number;
  /** View-model kick back distance (m) and muzzle rise (rad) per shot. */
  kick: number;
  rise: number;
  /** Synth gunshot parameters. */
  sfx: { len: number; low: number; bright: number; vol: number };
  accent: number;
}

export const WEAPONS: Record<string, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'PX-7 SIDEARM',
    model: 'pistol',
    auto: false,
    rpm: 430,
    damage: 36,
    headMult: 2.5,
    pellets: 1,
    spread: 0.014,
    adsSpread: 0.004,
    magSize: 12,
    reserveMax: 84,
    reloadTime: 1.3,
    cost: 0,
    range: 120,
    kick: 0.035,
    rise: 0.045,
    sfx: { len: 0.16, low: 150, bright: 2400, vol: 0.55 },
    accent: 0x22e6ff,
  },
  smg: {
    id: 'smg',
    name: 'KESTREL SMG',
    model: 'smg',
    auto: true,
    rpm: 820,
    damage: 24,
    headMult: 2.0,
    pellets: 1,
    spread: 0.03,
    adsSpread: 0.011,
    magSize: 32,
    reserveMax: 224,
    reloadTime: 1.9,
    cost: 750,
    range: 90,
    kick: 0.02,
    rise: 0.02,
    sfx: { len: 0.1, low: 190, bright: 3200, vol: 0.42 },
    accent: 0xff3ea5,
  },
  shotgun: {
    id: 'shotgun',
    name: 'RIOT-12',
    model: 'shotgun',
    auto: false,
    rpm: 72,
    damage: 24,
    headMult: 1.5,
    pellets: 9,
    spread: 0.065,
    adsSpread: 0.045,
    magSize: 6,
    reserveMax: 42,
    reloadTime: 2.6,
    cost: 1200,
    range: 40,
    kick: 0.09,
    rise: 0.11,
    sfx: { len: 0.32, low: 70, bright: 1600, vol: 0.8 },
    accent: 0xff8c1a,
  },
  rifle: {
    id: 'rifle',
    name: 'HALCYON AR-90',
    model: 'rifle',
    auto: true,
    rpm: 660,
    damage: 42,
    headMult: 2.2,
    pellets: 1,
    spread: 0.02,
    adsSpread: 0.005,
    magSize: 30,
    reserveMax: 240,
    reloadTime: 2.1,
    cost: 1500,
    range: 160,
    kick: 0.03,
    rise: 0.03,
    sfx: { len: 0.18, low: 120, bright: 2800, vol: 0.6 },
    accent: 0x3dff8a,
  },
};

export const STARTING_WEAPON = 'pistol';
export const WEAPON_SLOTS = 2;
