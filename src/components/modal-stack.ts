// Which dialog is on top (0.20.1). Escape closes that one only: each dialog used to listen for Escape itself, so a
// dialog opened from another (a confirmation over an editor, a picker over a form) closed both at once. A tip or a
// list inside a dialog that handles Escape first (capture phase) marks the key as handled, and no dialog closes.

interface Entry { id: number; close: () => void }

const entries: Entry[] = [];
let next = 1;
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || !entries.length) return;
  e.preventDefault();
  modalStack.escape();
}

export const modalStack = {
  /** A dialog opened: `close` is what Escape does to it. Returns its id. */
  push(close: () => void): number {
    if (!listening && typeof window !== 'undefined') {
      window.addEventListener('keydown', onKey);
      listening = true;
    }
    const id = next++;
    entries.push({ id, close });
    return id;
  },
  /** The dialog's close changed (it closes over newer state). */
  update(id: number, close: () => void) {
    const e = entries.find((x) => x.id === id);
    if (e) e.close = close;
  },
  /** The dialog closed. */
  remove(id: number) {
    const i = entries.findIndex((x) => x.id === id);
    if (i >= 0) entries.splice(i, 1);
  },
  /** Escape: close the dialog on top. False when none is open. */
  escape(): boolean {
    const top = entries.at(-1);
    if (!top) return false;
    top.close();
    return true;
  },
};
