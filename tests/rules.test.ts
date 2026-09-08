import { describe, expect, it } from 'vitest';
import {
  zombieHealthForRound,
  zombiesForRound,
  spawnIntervalForRound,
  pickTier,
  pointsForHit,
  POINTS,
} from '../src/game/Rules';

describe('round scaling', () => {
  it('health grows every round', () => {
    expect(zombieHealthForRound(1)).toBe(150);
    expect(zombieHealthForRound(9)).toBe(950);
    for (let r = 2; r <= 40; r++) {
      expect(zombieHealthForRound(r)).toBeGreaterThan(zombieHealthForRound(r - 1));
    }
  });

  it('zombie counts never decrease', () => {
    expect(zombiesForRound(1)).toBe(6);
    for (let r = 2; r <= 60; r++) {
      expect(zombiesForRound(r)).toBeGreaterThanOrEqual(zombiesForRound(r - 1));
    }
  });

  it('spawn interval shrinks but stays above the floor', () => {
    expect(spawnIntervalForRound(1)).toBe(2);
    expect(spawnIntervalForRound(200)).toBe(0.4);
  });

  it('early rounds only produce walkers', () => {
    for (let i = 0; i < 20; i++) expect(pickTier(1, i / 20)).toBe('walk');
    expect(pickTier(20, 0.99)).toBe('sprint');
  });
});

describe('points', () => {
  it('awards hit plus kill bonuses', () => {
    expect(pointsForHit(false, false)).toBe(POINTS.hit);
    expect(pointsForHit(true, false)).toBe(POINTS.hit + POINTS.killBody);
    expect(pointsForHit(true, true)).toBe(POINTS.hit + POINTS.killHead);
    expect(pointsForHit(true, true, 2)).toBe((POINTS.hit + POINTS.killHead) * 2);
  });
});
