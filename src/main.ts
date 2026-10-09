/**
 * EDEN entry point: boots the engine behind the main menu, wires the UI,
 * starts the frame loop and guards against fatal errors with a real error
 * surface (never a fake loading screen).
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

    // Live 3D menu background: world is already running behind the menu.
    engine.setInMenu(true);
    ui.setMenuVisible(true, false);
    ui.finishBoot();

    // Prepare the save list state for the Continue button.
    const db = (engine as unknown as { db: { listSlots(): Promise<Array<{ id: string }>> } }).db;
    const slots = await db.listSlots();
    ui.setMenuVisible(true, slots.length > 0);

    engine.startLoop();

    // When the user leaves the menu, hand control back to the game.
    const origSetMenu = ui.setMenuVisible.bind(ui);
    (ui as unknown as { setMenuVisible: (v: boolean, hasSave?: boolean) => void }).setMenuVisible = (
      visible: boolean,
      hasSave?: boolean,
    ) => {
      origSetMenu(visible, hasSave);
      engine.setInMenu(visible);
      if (!visible) {
        engine.inputManager.uiFocused = false;
        canvas.focus();
      } else {
        engine.inputManager.uiFocused = true;
      }
    };

    // Clicking the canvas while playing acquires pointer lock.
    canvas.addEventListener('click', () => {
      if (!engine.uiManager.isPanelOpen) {
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
