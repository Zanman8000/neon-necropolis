// Round scaling, economy and balance constants. Pure functions so they can be unit tested.

export const MAX_ALIVE = 24;
export const START_POINTS = 500;

export const POINTS = {
  hit: 10,
  killBody: 50,
  killHead: 100,
  repairPlank: 10,
  repairCapPerRound: 100,
} as const;

export const PLAYER = {
  maxHealth: 100,
  regenDelay: 4.0,
  regenRate: 30,
  walkSpeed: 4.6,
  sprintSpeed: 7.0,
  crouchSpeed: 2.4,
  radius: 0.36,
  eyeHeight: 1.68,
  crouchEyeHeight: 1.1,
  jumpSpeed: 5.2,
  gravity: 16,
  interactRange: 2.3,
} as const;

export const ZOMBIE = {
  radius: 0.38,
  attackRange: 1.35,
  attackReach: 1.75,
  attackWindup: 0.35,
  attackCooldown: 1.05,
  damage: 35,
  tearInterval: 1.25,
  climbTime: 1.1,
  riseTime: 1.5,
  dieTime: 0.7,
  sinkTime: 1.6,
} as const;

/** Zombie health for a round (classic curve: +100 per round to 10, then 10% compounding). */
export function zombieHealthForRound(round: number): number {
  if (round < 1) return 150;
  if (round < 10) return 150 + 100 * (round - 1);
  return Math.round(950 * Math.pow(1.1, round - 9));
}

/** Total zombies spawned in a round for one player. */
export function zombiesForRound(round: number): number {
  const early = [6, 8, 13, 18];
  if (round <= 4) return early[Math.max(0, round - 1)];
  const r = round;
  return Math.round(0.000058 * r * r * r + 0.074032 * r * r + 0.718119 * r + 14.738699);
}

/** Seconds between spawns. Faster as rounds progress. */
export function spawnIntervalForRound(round: number): number {
  return Math.max(0.4, 2.0 * Math.pow(0.95, round - 1));
}

export type SpeedTier = 'walk' | 'jog' | 'sprint';

export const TIER_SPEED: Record<SpeedTier, number> = {
  walk: 1.35,
  jog: 2.6,
  sprint: 4.4,
};

/** Probability weights of each speed tier for a round. */
export function tierWeights(round: number): Record<SpeedTier, number> {
  if (round <= 2) return { walk: 1, jog: 0, sprint: 0 };
  if (round <= 4) return { walk: 0.7, jog: 0.3, sprint: 0 };
  if (round <= 7) return { walk: 0.4, jog: 0.45, sprint: 0.15 };
  if (round <= 12) return { walk: 0.2, jog: 0.45, sprint: 0.35 };
  return { walk: 0.1, jog: 0.35, sprint: 0.55 };
}

export function pickTier(round: number, rnd: number): SpeedTier {
  const w = tierWeights(round);
  const total = w.walk + w.jog + w.sprint;
  let t = rnd * total;
  if ((t -= w.walk) < 0) return 'walk';
  if ((t -= w.jog) < 0) return 'jog';
  return 'sprint';
}

export function intermissionForRound(round: number): number {
  return round <= 1 ? 3.5 : 7;
}

/** Points awarded for a hit. Killing shots add a kill bonus on top of the hit. */
export function pointsForHit(kill: boolean, headshot: boolean, multiplier = 1): number {
  let p = POINTS.hit;
  if (kill) p += headshot ? POINTS.killHead : POINTS.killBody;
  return p * multiplier;
}
