// Petit magasin d'état observable + hook Preact.
import { useEffect, useReducer, useRef } from 'preact/hooks';

export class Observable<T> {
  private listeners = new Set<() => void>();
  constructor(private value: T) {}
  get(): T {
    return this.value;
  }
  set(patch: Partial<T> | ((v: T) => Partial<T>)) {
    const p = typeof patch === 'function' ? patch(this.value) : patch;
    this.value = { ...this.value, ...p };
    this.listeners.forEach((l) => l());
  }
  subscribe(l: () => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** Re-rend le composant quand la valeur sélectionnée change. */
export function useObs<T, S>(obs: Observable<T>, select: (v: T) => S): S {
  const [, force] = useReducer((x: number) => x + 1, 0);
  const sel = useRef(select);
  sel.current = select;
  const last = useRef<S>(select(obs.get()));
  last.current = select(obs.get());
  useEffect(
    () =>
      obs.subscribe(() => {
        const next = sel.current(obs.get());
        if (!Object.is(next, last.current)) {
          last.current = next;
          force(0);
        }
      }),
    [obs],
  );
  return last.current;
}
