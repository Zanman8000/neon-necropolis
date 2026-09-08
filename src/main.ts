import './style.css';
import { Game } from './game/Game';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
if (!canvas) throw new Error('Missing #game canvas');

const game = new Game(canvas);
game.init().catch((err: unknown) => {
  console.error(err);
  const box = document.getElementById('start-error');
  if (box) {
    box.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
    box.classList.remove('hidden');
  }
});
