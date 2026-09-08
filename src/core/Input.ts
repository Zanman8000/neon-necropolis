// Keyboard, mouse and pointer-lock state. Read by the game each frame, cleared with endFrame().

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private buttons = [false, false, false];
  private buttonsPressed = [false, false, false];
  mouseDX = 0;
  mouseDY = 0;
  wheelDelta = 0;
  locked = false;
  /** When true, mouse movement steers the view even without pointer lock (debug / unsupported browsers). */
  allowUnlockedLook = false;
  enabled = false;
  onLockChange: ((locked: boolean) => void) | null = null;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.enabled && (e.code === 'Space' || e.code === 'Tab' || e.code === 'KeyR')) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.fill(false);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.allowUnlockedLook) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button < 3) {
        this.buttons[e.button] = true;
        this.buttonsPressed[e.button] = true;
      }
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button < 3) this.buttons[e.button] = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener(
      'wheel',
      (e) => {
        if (this.enabled) this.wheelDelta += Math.sign(e.deltaY);
      },
      { passive: true },
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this.onLockChange?.(false);
    });
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  isButton(b: number): boolean {
    return this.buttons[b];
  }

  wasButtonPressed(b: number): boolean {
    return this.buttonsPressed[b];
  }

  endFrame(): void {
    this.pressed.clear();
    this.buttonsPressed.fill(false);
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
  }

  /** Request pointer lock. Resolves true when the lock is acquired, false when refused. */
  requestLock(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!('requestPointerLock' in this.el)) {
        resolve(false);
        return;
      }
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        resolve(ok);
      };
      const onChange = () => done(document.pointerLockElement === this.el);
      const onError = () => done(false);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError);
      try {
        const el = this.el as HTMLElement & { requestPointerLock: (o?: unknown) => Promise<void> | void };
        const p = el.requestPointerLock({ unadjustedMovement: true });
        if (p && typeof (p as Promise<void>).catch === 'function') {
          (p as Promise<void>).catch(() => {
            // Retry without unadjustedMovement, which some browsers reject.
            try {
              const p2 = el.requestPointerLock();
              if (p2 && typeof (p2 as Promise<void>).catch === 'function') (p2 as Promise<void>).catch(() => done(false));
            } catch {
              done(false);
            }
          });
        }
      } catch {
        done(false);
      }
      setTimeout(() => done(document.pointerLockElement === this.el), 1500);
    });
  }

  exitLock(): void {
    if (document.pointerLockElement === this.el) document.exitPointerLock();
  }
}
