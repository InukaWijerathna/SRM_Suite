import { useEffect } from 'react';

/**
 * Android hardware/gesture back button support. Without this, Capacitor's default behaviour
 * is to exit the app on the very first press — there's no browser history to go back through
 * since navigation here is plain React state, not the History API.
 *
 * Any open overlay (a modal, Settings) registers itself with useBackHandler while mounted;
 * the most recently opened one is always on top of the stack and gets the next back press, so
 * closing several in a row (e.g. an edit form inside a modal) naturally unwinds one at a time.
 * main.tsx wires the single native listener that drives this stack; it's a no-op on web/iOS.
 */

type Handler = () => void;

const stack: Handler[] = [];

/** Registers `onBack` while `active`; called instead of the default action on the next press. */
export function useBackHandler(onBack: Handler, active = true) {
  useEffect(() => {
    if (!active) return;
    stack.push(onBack);
    return () => {
      const i = stack.lastIndexOf(onBack);
      if (i !== -1) stack.splice(i, 1);
    };
  }, [onBack, active]);
}

/** Runs the top handler, if any. Returns false when the stack is empty (caller's call). */
export function runTopBackHandler(): boolean {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}
