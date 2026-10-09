/**
 * Unified input: keyboard, mouse (with pointer lock), wheel, gamepad and a
 * minimal touch layer. UI focus (typing in fields) suppresses game bindings.
 */

export type ActionName =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sprint' | 'crouch'
  | 'interact' | 'secondary' | 'inventory' | 'map' | 'inspect'
  | 'build' | 'stats' | 'settings' | 'pause'
  | 'tool1' | 'tool2' | 'tool3' | 'tool4' | 'tool5' | 'tool6'
  | 'cameraToggle' | 'godMode' | 'debug' | 'screenshot';

export const DEFAULT_BINDINGS: Record<ActionName, string> = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ShiftLeft',
  crouch: 'ControlLeft',
  interact: 'KeyE',
  secondary: 'KeyF',
  inventory: 'Tab',
  map: 'KeyM',
  inspect: 'KeyI',
  build: 'KeyB',
  stats: 'KeyN',
  settings: 'Escape',
  pause: 'Escape',
  tool1: 'Digit1',
  tool2: 'Digit2',
  tool3: 'Digit3',
  tool4: 'Digit4',
  tool5: 'Digit5',
  tool6: 'Digit6',
  cameraToggle: 'KeyC',
  godMode: 'KeyG',
  debug: 'F3',
  screenshot: 'KeyP',
};

export class Input {
  bindings: Record<ActionName, string> = { ...DEFAULT_BINDINGS };
  keysDown = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDx = 0;
  mouseDy = 0;
  wheel = 0;
  mouseButtons = new Set<number>();
  private mousePressed = new Set<number>();
  pointerLocked = false;
  /** True while typing in a UI field — game bindings are suppressed. */
  uiFocused = false;
  /** Touch movement stick (−1..1) and look delta. */
  touchMove = { x: 0, y: 0 };
  touchLook = { x: 0, y: 0 };
  touchActive = false;

  private el: HTMLElement;

  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('blur', this.onBlur);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setupTouch(el);
    try {
      const saved = localStorage.getItem('eden.bindings');
      if (saved) this.bindings = { ...DEFAULT_BINDINGS, ...JSON.parse(saved) };
    } catch {
      /* storage unavailable — defaults stand */
    }
  }

  private setupTouch(el: HTMLElement): void {
    let lookId: number | null = null;
    let moveId: number | null = null;
    let lastLook = { x: 0, y: 0 };
    let moveOrigin = { x: 0, y: 0 };

    el.addEventListener('touchstart', (e) => {
      this.touchActive = true;
      for (const t of Array.from(e.changedTouches)) {
        if (t.clientX < window.innerWidth * 0.4 && moveId === null) {
          moveId = t.identifier;
          moveOrigin = { x: t.clientX, y: t.clientY };
        } else if (lookId === null) {
          lookId = t.identifier;
          lastLook = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });

    el.addEventListener('touchmove', (e) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveId) {
          const dx = (t.clientX - moveOrigin.x) / 70;
          const dy = (t.clientY - moveOrigin.y) / 70;
          this.touchMove.x = Math.max(-1, Math.min(1, dx));
          this.touchMove.y = Math.max(-1, Math.min(1, dy));
        } else if (t.identifier === lookId) {
          this.touchLook.x += t.clientX - lastLook.x;
          this.touchLook.y += t.clientY - lastLook.y;
          lastLook = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    }, { passive: false });

    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === moveId) {
          moveId = null;
          this.touchMove.x = 0;
          this.touchMove.y = 0;
        }
        if (t.identifier === lookId) lookId = null;
      }
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  saveBindings(): void {
    try {
      localStorage.setItem('eden.bindings', JSON.stringify(this.bindings));
    } catch {
      /* ignore */
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    // Escape/F3 must work even while a UI field has focus.
    if (this.uiFocused && e.code !== 'Escape' && e.code !== 'F3') return;
    if (e.code === 'Tab') e.preventDefault();
    if (!this.keysDown.has(e.code)) this.pressed.add(e.code);
    this.keysDown.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keysDown.delete(e.code);
    this.released.add(e.code);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.pointerLocked && !this.uiFocused) {
      this.mouseDx += e.movementX;
      this.mouseDy += e.movementY;
    }
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.mouseButtons.has(e.button)) this.mousePressed.add(e.button);
    this.mouseButtons.add(e.button);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons.delete(e.button);
  };

  private onWheel = (e: WheelEvent): void => {
    this.wheel += e.deltaY;
  };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.el || document.pointerLockElement === document.body;
  };

  private onBlur = (): void => {
    this.keysDown.clear();
    this.mouseButtons.clear();
  };

  requestPointerLock(): void {
    this.el.requestPointerLock?.();
  }

  exitPointerLock(): void {
    document.exitPointerLock?.();
  }

  actionDown(action: ActionName): boolean {
    if (this.uiFocused) return false;
    return this.keysDown.has(this.bindings[action]);
  }

  actionPressed(action: ActionName): boolean {
    if (this.uiFocused) return false;
    return this.pressed.has(this.bindings[action]);
  }

  /** Raw key press this frame (for hotkeys not in the action map). */
  keyPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Gamepad polling (called once per frame). */
  pollGamepad(): { moveX: number; moveY: number; lookX: number; lookY: number; run: boolean; jump: boolean } {
    const out = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, run: false, jump: false };
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad || this.uiFocused) return out;
    const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    out.moveX = dead(pad.axes[0] ?? 0);
    out.moveY = dead(pad.axes[1] ?? 0);
    out.lookX = dead(pad.axes[2] ?? 0) * 10;
    out.lookY = dead(pad.axes[3] ?? 0) * 10;
    out.run = (pad.buttons[10]?.pressed ?? false) || (pad.buttons[5]?.pressed ?? false);
    out.jump = pad.buttons[0]?.pressed ?? false;
    return out;
  }

  /** Consume per-frame deltas. */
  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.mousePressed.clear();
    this.mouseDx = 0;
    this.mouseDy = 0;
    this.wheel = 0;
    this.touchLook.x = 0;
    this.touchLook.y = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('blur', this.onBlur);
  }
}
