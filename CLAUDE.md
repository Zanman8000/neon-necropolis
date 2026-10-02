# Neon Necropolis

Browser cyberpunk round-survival FPS (Vite + TypeScript + three.js + three-mesh-bvh, vitest). See README.md for the feature list, controls and project layout.

## Commands

Node and gh live at `C:\Program Files\nodejs` and `C:\Program Files\GitHub CLI` and may be missing from PATH in older shells. Prefix with `export PATH="/c/Program Files/nodejs:/c/Program Files/GitHub CLI:$PATH"` (Bash) or `$env:Path += ";C:\Program Files\nodejs;C:\Program Files\GitHub CLI"` (PowerShell).

- `npm run dev`: dev server at http://127.0.0.1:5173 (use preview_start `dev` from `.claude/launch.json`, not Bash)
- `npm test`: vitest suites in `tests/` (map validity, round curves, collision)
- `npm run typecheck`: `tsc --noEmit`
- `npm run build`: typecheck plus production build into `dist/`

Run `npm test` and `npm run build` before committing. Pushing to `main` deploys to GitHub Pages (https://zanman8000.github.io/neon-necropolis/) via `.github/workflows/deploy.yml`, so only push builds that pass.

## Conventions

- Original names and procedurally generated assets only: no Activision/Call of Duty IP, no downloaded assets without Eddie's approval.
- Balance numbers and round curves belong in `src/game/Rules.ts` (pure and tested); map layout, door prices and zones in `src/world/LevelData.ts`.
- Line endings are LF (`.gitattributes`).
- `brag-output/` is the launch video and its headless-Chrome capture rig; it is intentionally untracked.

## Testing in the browser pane

The in-app browser throttles `requestAnimationFrame`, so the game will not advance on its own there.

- Open with `?nolock&debug` (no pointer lock, FPS counter).
- Step the simulation from javascript_tool: loop `window.__game.update(1/60)`, then call `window.__game.composer.render()` before screenshots.
- Click DOM buttons through JS rather than by coordinate.
- Spawn test zombies on free floor cells. The kiosk block occupies cells 11-12 x 20-21 (world x 22-26, z 40-44).
- Throws have a 0.45 s cooldown between knife and grenade.

## Tooling gotchas

- Large heredocs through the Bash tool fail to parse. Write big scripts or patches to a file with the Write tool and run them.
