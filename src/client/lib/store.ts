// A tiny observable value for state shared outside the component tree
// (signed in or not).
// Components read one with useStore(); plain code with get/set/subscribe.
import { useEffect, useReducer } from "preact/hooks";

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
export function useStore<T extends object>(s: Store<T>): T {
  const [, bump] = useReducer((n: number, _: void) => n + 1, 0);
  useEffect(() => s.subscribe(() => bump()), [s]);
  return s.get();
}
