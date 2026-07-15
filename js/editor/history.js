/**
 * editor/history.js — snapshot-based undo/redo.
 *
 * The editor calls `record()` with the CURRENT state *before* mutating it.
 * Snapshots cover the object list and the theme (the two things that change
 * rapidly); metadata edits go through forms and are cheap to redo manually.
 * Snapshot cloning uses structuredClone, capped so a multi-thousand-object
 * level cannot exhaust memory.
 */
export class History {
  constructor(limit = 50) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  /** Push the pre-mutation state. Invalidates the redo branch. */
  record(state) {
    this.undoStack.push(structuredClone(state));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Returns the state to restore, or null. `current` moves to redo. */
  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(structuredClone(current));
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(structuredClone(current));
    return this.redoStack.pop();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}
