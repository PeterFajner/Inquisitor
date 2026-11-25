// A tiny observable value for state shared outside the component tree
// (signed in or not).
// Components read one with useStore(); plain code with get/set/subscribe.
import { useEffect, useReducer, useRef } from "preact/hooks";

export type Store<T extends object> = {
  get(): T;
  set(patch: Partial<T>): void;
  subscribe(listener: () => void): () => void;
};

export function store<T extends object>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(patch) {
      value = { ...value, ...patch };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// The store's current value; the component re-renders when it changes.
// Not `live` (a page kept hidden: src/client/lib/router.ts), it keeps the
// value it last had and isn't re-rendered until live again, then once if
// the store changed meanwhile.
export function useStore<T extends object>(s: Store<T>, live = true): T {
  const [, bump] = useReducer((n: number, _: void) => n + 1, 0);
  const seen = useRef(s.get());
  useEffect(() => {
    if (!live) return;
    if (s.get() !== seen.current) bump();
    return s.subscribe(() => bump());
  }, [s, live]);
  if (live) seen.current = s.get();
  return seen.current;
}
