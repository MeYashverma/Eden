/**
 * EDEN entry point: boots the engine behind the main menu, wires the UI,
 * starts the frame loop and guards against fatal errors with a real error
 * surface (never a fake loading screen).
 *
 * Menu transitions are reported by the UI through `onMenuChange`, so this file
 * no longer wraps UI methods.
 */

import './ui/styles.css';
import { Engine } from './engine';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

function showFatal(message: string): void {
  const el = document.getElementById('fatal-error');
  const msg = document.getElementById('fatal-message');
  if (el && msg) {
    msg.textContent = message;
    el.classList.remove('hidden');
  }
  // eslint-disable-next-line no-console
  console.error('[EDEN] fatal:', message);
}

window.addEventListener('error', (e) => {
  if (!document.getElementById('boot-screen')?.classList.contains('hidden')) {
    showFatal(e.message ?? 'Unknown error during startup.');
  }
});

async function main(): Promise<void> {
  try {
    const engine = new Engine(canvas);
    const ui = engine.createUI();
    engine.initInput();

    await engine.boot((pct, status) => ui.setBootProgress(pct, status));

    // The live 3D world runs behind the menu; the menu shows only if a save exists.
    ui.setMenuVisible(true, false);
    ui.finishBoot();
    const saves = await engine.listSaves();
    ui.setMenuVisible(true, saves.length > 0);

    engine.startLoop();

    // Clicking the world while playing acquires pointer lock.
    canvas.addEventListener('click', () => {
      if (!ui.isPanelOpen && !ui.isMenuVisible) {
        void engine.audioEngine.unlock();
        engine.inputManager.requestPointerLock();
      }
    });

    // First user gesture unlocks audio anywhere in the app.
    const unlock = () => void engine.audioEngine.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

    (window as unknown as { eden: Engine }).eden = engine;
  } catch (err) {
    showFatal(err instanceof Error ? `${err.message}` : String(err));
  }
}

void main();
