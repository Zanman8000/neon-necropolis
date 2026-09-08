import type { Vec2i } from './Grid';

/**
 * SECTOR 7 — a clean corporate transit plaza that the outbreak turned into a necropolis.
 *
 * Legend
 *   ' ' void            'o' outside ground (zombie spawn side)   '#' wall
 *   '1'-'4' floor (zone) 'D' blast door   'W' barricaded window   'P' player spawn   'S' floor spawn pod
 *   'A' SMG wall buy    'B' shotgun wall buy   'C' rifle wall buy
 *   'E' power lever     'U' overclock station  'X' salvage crate pad
 *   perk machines: Q quick patch  J ironhide  R rapid rack  T trigger tonic  M pack mule
 *   props (block movement): k kiosk  b bench  p planter  v vending drone  c column  d desk  r server rack
 *
 * Zones: 1 Transit Plaza (spawn, outdoor)  2 Noodle Street (outdoor)  3 SynthCorp Lobby (indoor)  4 Data Vault (indoor)
 */
export const MAP_ROWS: string[] = [
  'oooooooooooooooooooooooooooooooooooooooooooo',
  'oooooooooooooooooooooooooooooooooooooooooooo',
  'oo########W#####################W#########oo',
  'oo#333333333333333333#444444444U444444444#oo',
  'oo#333333333333333S33#44444444444444444X4#oo',
  'oo#333333333333333333#444rrrrrr44rrrrrr44#oo',
  'ooW333c33333333c33333#4444444444444444444Woo',
  'oo#333333dddd33333333#4444444444444444444#oo',
  'oo#333333dddd33333333D444rrrrrr44rrrrrr44#oo',
  'oo#C33333333333333333#444444444444444444E#oo',
  'oo#333333333333333333#4444444444444444444#oo',
  'oo#333c33333333c33333#444rrrrrr44rrrrrr44#oo',
  'oo#33333333333333333T#4444444444444444444#oo',
  'oo#33X333333333333333#R4444444444444444S4#oo',
  'oo#333333333333333333#4444444444444444444#oo',
  'oo#########D###################D##########oo',
  'oo#111111111111111111#2222222222222222X22#oo',
  'oo#1p11111111111111p1#222222222222222222J#oo',
  'oo#11111111111111111A#2222222222222222222#oo',
  'oo#111b111111111b1111#2222####222####2222#oo',
  'oo#11111111kk11111111#2222####222####2222#oo',
  'oo#11111111kk11111111#222222222222222222B#oo',
  'ooW11111111111111v111#2222222222222222222#oo',
  'oo#111111111111111111D2222222222222222222#oo',
  'oo#11111111P111111111#2222####222####2222Woo',
  'oo#111b111111111b1111#2222####222####2222#oo',
  'oo#Q11111111111111X11#2222222222222222222#oo',
  'oo#1p11111111111111p1#M222222222222222S22#oo',
  'oo#111111111111111111#2222222222222222222#oo',
  'oo######W#######W#############W###########oo',
  'oooooooooooooooooooooooooooooooooooooooooooo',
  'oooooooooooooooooooooooooooooooooooooooooooo',
];

/** Door prices keyed by "lowZone-highZone". */
export const DOOR_COSTS: Record<string, number> = {
  '1-2': 750,
  '1-3': 1000,
  '2-4': 1250,
  '3-4': 1250,
};

export interface ZoneInfo {
  name: string;
  color: number;
  outdoor: boolean;
}

export const ZONES: Record<number, ZoneInfo> = {
  1: { name: 'TRANSIT PLAZA', color: 0x22e6ff, outdoor: true },
  2: { name: 'NOODLE STREET', color: 0xff3ea5, outdoor: true },
  3: { name: 'SYNTHCORP LOBBY', color: 0x7fb4ff, outdoor: false },
  4: { name: 'DATA VAULT', color: 0x3dff8a, outdoor: false },
};

export const START_ZONE = 1;

/** Neon signage mounted on wall cells. `face` is the direction the sign faces (into the room). */
export interface SignDef {
  text: string;
  color: number;
  x: number;
  z: number;
  face: Vec2i;
  w: number;
  h: number;
  y: number;
  flicker?: boolean;
  light?: boolean;
  broken?: boolean;
}

export const SIGNS: SignDef[] = [
  // Zone 1 — Transit Plaza
  { text: 'SECTOR 7 TRANSIT', color: 0x22e6ff, x: 6, z: 15, face: { x: 0, z: 1 }, w: 7, h: 1.2, y: 3.0, light: true },
  { text: 'QUARANTINE', color: 0xffb020, x: 2, z: 18, face: { x: 1, z: 0 }, w: 4.2, h: 0.9, y: 2.7, flicker: true },
  { text: 'NOODLE ST', color: 0xff3ea5, x: 21, z: 26, face: { x: -1, z: 0 }, w: 3.6, h: 0.9, y: 3.0 },
  { text: 'LINE 7', color: 0x22e6ff, x: 12, z: 29, face: { x: 0, z: -1 }, w: 4, h: 1.1, y: 3.1, light: true, broken: true },
  // Zone 2 — Noodle Street
  { text: 'NOODLE 24H', color: 0xff3ea5, x: 26, z: 15, face: { x: 0, z: 1 }, w: 5.5, h: 1.2, y: 3.1, light: true, flicker: true },
  { text: 'SYNTH RAMEN', color: 0xff8c1a, x: 36, z: 29, face: { x: 0, z: -1 }, w: 5.5, h: 1.1, y: 3.0, light: true },
  { text: 'BAR', color: 0xff5fc8, x: 41, z: 18, face: { x: -1, z: 0 }, w: 2.4, h: 1.0, y: 3.0, flicker: true },
  { text: 'HOT POT', color: 0xff8c1a, x: 27, z: 19, face: { x: 0, z: -1 }, w: 3.2, h: 0.8, y: 3.2 },
  { text: 'DUMPLING', color: 0xff3ea5, x: 28, z: 20, face: { x: 0, z: 1 }, w: 3.2, h: 0.8, y: 3.2, light: true },
  { text: 'TEA HOUSE', color: 0x3dff8a, x: 34, z: 19, face: { x: 0, z: -1 }, w: 3.4, h: 0.8, y: 3.2 },
  { text: 'PHO 88', color: 0x22e6ff, x: 35, z: 25, face: { x: 0, z: 1 }, w: 3, h: 0.8, y: 3.2, flicker: true },
  { text: 'BAO', color: 0xffb020, x: 27, z: 24, face: { x: 0, z: -1 }, w: 2.2, h: 0.8, y: 3.2 },
  { text: 'KARAOKE', color: 0xff3ea5, x: 34, z: 24, face: { x: 0, z: -1 }, w: 3.4, h: 0.8, y: 3.2, light: true, flicker: true },
  // Zone 3 — SynthCorp Lobby
  { text: 'SYNTHCORP', color: 0x7fb4ff, x: 13, z: 2, face: { x: 0, z: 1 }, w: 7, h: 1.4, y: 3.0, light: true },
  { text: 'RECEPTION', color: 0xffffff, x: 2, z: 12, face: { x: 1, z: 0 }, w: 3.6, h: 0.8, y: 2.8 },
  { text: 'EXIT', color: 0x22e6ff, x: 8, z: 15, face: { x: 0, z: -1 }, w: 2.4, h: 0.8, y: 3.2, light: true },
  // Zone 4 — Data Vault
  { text: 'DATA VAULT 4', color: 0x3dff8a, x: 27, z: 2, face: { x: 0, z: 1 }, w: 5.5, h: 1.2, y: 3.1, light: true, flicker: true },
  { text: 'CORE ACCESS', color: 0x3dff8a, x: 41, z: 10, face: { x: -1, z: 0 }, w: 4.2, h: 0.9, y: 3.0 },
  { text: 'AUTHORIZED ONLY', color: 0xff2a4a, x: 36, z: 15, face: { x: 0, z: -1 }, w: 5.5, h: 0.9, y: 3.1, flicker: true },
];

/** Extra point lights (cell coordinates, world y). */
export interface LightDef {
  x: number;
  z: number;
  y: number;
  color: number;
  intensity: number;
  distance: number;
}

export const EXTRA_LIGHTS: LightDef[] = [
  { x: 11.5, z: 20.5, y: 4.0, color: 0x22e6ff, intensity: 45, distance: 14 }, // plaza kiosk
  // lobby ceiling lights (cool white)
  { x: 6.5, z: 5.5, y: 3.3, color: 0xdfe8ff, intensity: 90, distance: 20 },
  { x: 15.5, z: 5.5, y: 3.3, color: 0xdfe8ff, intensity: 90, distance: 20 },
  { x: 6.5, z: 12.5, y: 3.3, color: 0xdfe8ff, intensity: 90, distance: 20 },
  { x: 15.5, z: 12.5, y: 3.3, color: 0xdfe8ff, intensity: 90, distance: 20 },
  // vault ceiling lights (pale green)
  { x: 26.5, z: 6.5, y: 3.3, color: 0xd6ffe4, intensity: 80, distance: 20 },
  { x: 36.5, z: 6.5, y: 3.3, color: 0xd6ffe4, intensity: 80, distance: 20 },
  { x: 26.5, z: 12.5, y: 3.3, color: 0xd6ffe4, intensity: 80, distance: 20 },
  { x: 36.5, z: 12.5, y: 3.3, color: 0xd6ffe4, intensity: 80, distance: 20 },
];

/** Wall-mounted floodlights: a fixture on a wall cell face plus a point light in front of it. */
export interface FloodDef {
  x: number;
  z: number;
  face: Vec2i;
  color: number;
  intensity: number;
}

export const FLOODS: FloodDef[] = [
  // Transit Plaza
  { x: 2, z: 25, face: { x: 1, z: 0 }, color: 0xffe6c4, intensity: 110 },
  { x: 14, z: 15, face: { x: 0, z: 1 }, color: 0xffe6c4, intensity: 110 },
  { x: 21, z: 20, face: { x: -1, z: 0 }, color: 0xffe6c4, intensity: 110 },
  // Noodle Street (warm amber)
  { x: 29, z: 19, face: { x: 0, z: -1 }, color: 0xffc990, intensity: 90 },
  { x: 33, z: 20, face: { x: 0, z: 1 }, color: 0xffc990, intensity: 90 },
  { x: 36, z: 24, face: { x: 0, z: -1 }, color: 0xffc990, intensity: 90 },
  { x: 26, z: 25, face: { x: 0, z: 1 }, color: 0xffc990, intensity: 90 },
  { x: 41, z: 27, face: { x: -1, z: 0 }, color: 0xffc990, intensity: 90 },
  { x: 38, z: 15, face: { x: 0, z: 1 }, color: 0xffc990, intensity: 90 },
];
