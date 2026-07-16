/**
 * input.js — unified keyboard + touch input.
 *
 * Exposes:
 *   held        — is a jump control currently held? (hold = auto-rejump)
 *   bufferTime  — a short "coyote buffer": a press registers even if it
 *                 lands a few ms before touching the ground, which keeps
 *                 high-bpm play feeling fair.
 *   consumeJump() — physics calls this when it acts on a press.
 *
 * Escape / P fire the onPause callback; R fires onRestart.
 */
const JUMP_KEYS = new Set(['Space', 'KeyW', 'ArrowUp']);
const BUFFER_WINDOW = 0.1;   // seconds a press stays "live"

/** True while the user is typing into a form control (editor panels). */
export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
               t.tagName === 'SELECT' || t.isContentEditable);
}

export class Input {
  constructor() {
    this.held = false;
    this.bufferTime = 0;
    this.onPause = null;
    this.onRestart = null;
    this.onAnyInput = null;      // used to unlock the AudioContext
    this._touchHeld = false;
    this._keysDown = new Set();

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;      // never steal keys from editor text fields
      if (JUMP_KEYS.has(e.code)) {
        e.preventDefault();
        if (!this._keysDown.has(e.code)) {
          this._keysDown.add(e.code);
          this._press();
        }
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onPause && this.onPause(e.code);
      } else if (e.code === 'KeyR') {
        this.onRestart && this.onRestart();
      }
    });
    window.addEventListener('keyup', (e) => {
      this._keysDown.delete(e.code);
      this._syncHeld();
    });
    window.addEventListener('blur', () => {
      this._keysDown.clear();
      this._touchHeld = false;
      this._syncHeld();
    });
  }

  /** Touch / pointer jumping only applies on the canvas so UI buttons work. */
  bindPointer(canvas) {
    const down = (e) => { e.preventDefault(); this._touchHeld = true; this._press(); };
    // touch grants user activation on pointerup (not pointerdown), so give
    // the AudioContext a second unlock chance when the tap ends
    const up = () => { this._touchHeld = false; this._syncHeld(); this.onAnyInput && this.onAnyInput(); };
    canvas.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  _press() {
    this.bufferTime = BUFFER_WINDOW;
    this._syncHeld();
    this.onAnyInput && this.onAnyInput();
  }

  _syncHeld() { this.held = this._keysDown.size > 0 || this._touchHeld; }

  /** Called once per physics substep to age the press buffer. */
  tick(dt) { if (this.bufferTime > 0) this.bufferTime -= dt; }

  get jumpQueued() { return this.bufferTime > 0; }

  consumeJump() { this.bufferTime = 0; }

  clear() { this.bufferTime = 0; }
}
