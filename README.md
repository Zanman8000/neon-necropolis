# Neon Necropolis

A browser-based, round-survival first-person shooter set in a clean corporate cyberpunk transit plaza that the outbreak turned into a necropolis. Original work inspired by round-based zombies modes. No third-party game assets are used: every texture, model and sound is generated procedurally at load.

## Play

- Desktop Chrome, Edge, Firefox or Safari 16+.
- Click **DEPLOY** to capture the mouse. Press **Esc** to pause.
- Add `?nolock` to the URL to play without pointer lock, and `?debug` to show an FPS counter.

| Action | Key |
| --- | --- |
| Move | W A S D |
| Aim / fire | Mouse / left button |
| Aim down sights | Right button |
| Reload | R |
| Interact (buy, open doors, repair barricades) | F (hold F to repair) |
| Sprint / crouch / jump | Shift / Ctrl / Space |
| Swap weapon | 1, 2 or mouse wheel |

## What is in the game right now

- One map, **Sector 7**, with four zones: Transit Plaza (spawn), Noodle Street, SynthCorp Lobby and the Data Vault. Blast doors open zones for points.
- Nine barricaded windows and three floor spawn pods. Zombies tear through barricades; you can repair them for points.
- Rounds that scale in count, health and speed on the classic zombies curve, with a 24-zombie cap.
- Points economy: hits, kills, headshots and repairs earn points; doors and wall buys spend them.
- Four weapons: the PX-7 sidearm you start with, plus the Kestrel SMG, Riot-12 shotgun and Halcyon AR-90 as wall buys. Two weapon slots, reloads, aim-down-sights, recoil and hip-fire spread.
- Health with regeneration, damage vignette, death screen and a persistent best round.
- Procedural neon signage, flickering lights, rain, a distant skyline, bloom and shadows.
- Fully synthesized sound: gunfire, reloads, groans, barricade tearing, doors, round stingers and ambience.

## Development

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm test           # unit tests (map validity, round curves, collision)
npm run build      # type-check + production build into dist/
```

Pushes to `main` deploy to GitHub Pages through the workflow in `.github/workflows/deploy.yml`.

## Project layout

```
src/
  main.ts                 bootstrap
  game/Game.ts            game loop, state machine, HUD sync, interactions
  game/Rules.ts           balance constants and round curves (pure, tested)
  core/Input.ts           keyboard, mouse and pointer lock
  world/Grid.ts           ASCII map parser, grid collision, line of sight (pure, tested)
  world/LevelData.ts      the map, door prices, zone info, signage
  world/Level.ts          builds the 3D level, owns doors, barricades, buys, pods
  world/Textures.ts       procedural canvas textures
  player/Player.ts        first-person controller
  weapons/                weapon definitions, procedural gun models, arsenal and firing
  enemies/                zombie body and animation, horde manager, flow-field pathfinding
  fx/Particles.ts         sparks and muzzle flash
  audio/Sfx.ts            Web Audio synthesis
  ui/Hud.ts               DOM heads-up display
tests/                    vitest suites
```

## Roadmap

1. Mystery box, power switch, perks and the upgrade machine.
2. Power-up drops: max ammo, insta-kill, double points, nuke, carpenter.
3. Real character models and animations to replace the procedural placeholders.
4. Settings menu: sensitivity, field of view, volume, quality presets.
5. Balance pass, performance pass and cross-browser testing for v1.0.
