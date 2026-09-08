export type GunModelKind = 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'lmg' | 'railgun' | 'prism' | 'blade';

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
  /** Relative chance of coming out of the salvage crate. 0 = never. */
  boxWeight: number;
  /** Name shown once the weapon has been overclocked. */
  upgradedName: string;
}

export const WEAPONS: Record<string, WeaponDef> = {
  pistol: {
    id: 'pistol',
    name: 'PX-7 SIDEARM',
    upgradedName: 'PX-7 EXECUTOR',
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
    reloadTime: 1.0,
    cost: 0,
    range: 120,
    kick: 0.035,
    rise: 0.045,
    sfx: { len: 0.16, low: 150, bright: 2400, vol: 0.55 },
    accent: 0x22e6ff,
    boxWeight: 0,
  },
  smg: {
    id: 'smg',
    name: 'KESTREL SMG',
    upgradedName: 'KESTREL VORTEX',
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
    reloadTime: 1.45,
    cost: 750,
    range: 90,
    kick: 0.02,
    rise: 0.02,
    sfx: { len: 0.1, low: 190, bright: 3200, vol: 0.42 },
    accent: 0xff3ea5,
    boxWeight: 22,
  },
  shotgun: {
    id: 'shotgun',
    name: 'RIOT-12',
    upgradedName: 'RIOT-12 BREACHER',
    model: 'shotgun',
    auto: false,
    rpm: 150,
    damage: 31,
    headMult: 1.5,
    pellets: 9,
    spread: 0.065,
    adsSpread: 0.045,
    magSize: 6,
    reserveMax: 42,
    reloadTime: 1.9,
    cost: 1200,
    range: 40,
    kick: 0.09,
    rise: 0.11,
    sfx: { len: 0.32, low: 70, bright: 1600, vol: 0.8 },
    accent: 0xff8c1a,
    boxWeight: 18,
  },
  rifle: {
    id: 'rifle',
    name: 'HALCYON AR-90',
    upgradedName: 'HALCYON ZENITH',
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
    reloadTime: 1.6,
    cost: 1500,
    range: 160,
    kick: 0.03,
    rise: 0.03,
    sfx: { len: 0.18, low: 120, bright: 2800, vol: 0.6 },
    accent: 0x3dff8a,
    boxWeight: 20,
  },
  lmg: {
    id: 'lmg',
    name: 'HAVOC LMG',
    upgradedName: 'HAVOC JUDGEMENT',
    model: 'lmg',
    auto: true,
    rpm: 600,
    damage: 46,
    headMult: 2.0,
    pellets: 1,
    spread: 0.03,
    adsSpread: 0.012,
    magSize: 100,
    reserveMax: 400,
    reloadTime: 3.5,
    cost: 0,
    range: 150,
    kick: 0.03,
    rise: 0.03,
    sfx: { len: 0.2, low: 110, bright: 2600, vol: 0.62 },
    accent: 0xffb020,
    boxWeight: 16,
  },
  railgun: {
    id: 'railgun',
    name: 'ION LANCE',
    upgradedName: 'ION LANCE ZERO',
    model: 'railgun',
    auto: false,
    rpm: 70,
    damage: 340,
    headMult: 2.5,
    pellets: 1,
    spread: 0.004,
    adsSpread: 0.001,
    magSize: 5,
    reserveMax: 40,
    reloadTime: 2.4,
    cost: 0,
    range: 250,
    kick: 0.12,
    rise: 0.09,
    sfx: { len: 0.45, low: 60, bright: 5000, vol: 0.8 },
    accent: 0x7fb4ff,
    boxWeight: 12,
  },
  prism: {
    id: 'prism',
    name: 'PRISM CANNON',
    upgradedName: 'PRISM SINGULARITY',
    model: 'prism',
    auto: false,
    rpm: 200,
    damage: 480,
    headMult: 1.2,
    pellets: 1,
    spread: 0.006,
    adsSpread: 0.003,
    magSize: 20,
    reserveMax: 160,
    reloadTime: 2.3,
    cost: 0,
    range: 200,
    kick: 0.05,
    rise: 0.04,
    sfx: { len: 0.3, low: 220, bright: 6000, vol: 0.75 },
    accent: 0xff3ea5,
    boxWeight: 5,
  },
};

export const STARTING_WEAPON = 'pistol';
export const WEAPON_SLOTS = 2;

/** Melee weapons live in their own slot and can only be swapped for other melee weapons. */
export interface MeleeDef {
  id: string;
  name: string;
  model: GunModelKind;
  damage: number;
  range: number;
  /** Cosine of the half-angle of the swing arc. */
  arcCos: number;
  swingTime: number;
  cooldown: number;
  accent: number;
}

export const MELEE: Record<string, MeleeDef> = {
  blade: { id: 'blade', name: 'CARBON BLADE', model: 'blade', damage: 150, range: 2.0, arcCos: 0.5, swingTime: 0.42, cooldown: 0.6, accent: 0x22e6ff },
};

export const STARTING_MELEE = 'blade';

/** Weapons the salvage crate can produce, with weights. */
export const BOX_POOL: WeaponDef[] = Object.values(WEAPONS).filter((w) => w.boxWeight > 0);

export function rollBoxWeapon(rnd: number): WeaponDef {
  const total = BOX_POOL.reduce((a, w) => a + w.boxWeight, 0);
  let t = rnd * total;
  for (const w of BOX_POOL) {
    t -= w.boxWeight;
    if (t < 0) return w;
  }
  return BOX_POOL[BOX_POOL.length - 1];
}
