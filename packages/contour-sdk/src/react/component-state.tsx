"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Component state that lives ABOVE the adaptive surface, keyed by
 * componentId. A layout change can move a component to another region (a
 * different React parent, so React remounts it); reading its state back
 * from this store keeps typed drafts, filters and toggles intact.
 */
class ComponentStateStore {
  private values = new Map<string, unknown>();
  has(key: string) {
    return this.values.has(key);
  }
  read<T>(key: string): T {
    return this.values.get(key) as T;
  }
  write(key: string, value: unknown) {
    this.values.set(key, value);
  }
  clear() {
    this.values.clear();
  }
}

const StoreContext = createContext<ComponentStateStore | null>(null);

export function ComponentStateProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new ComponentStateStore());
  return <StoreContext value={store}>{children}</StoreContext>;
}

/** Like useState, but persisted by (componentId, key) across remounts and layout swaps. */
export function useComponentState<T>(componentId: string, key: string, initial: T): [T, (next: T) => void] {
  const store = useContext(StoreContext);
  const storeKey = `${componentId}::${key}`;
  const [value, setValue] = useState<T>(() => (store?.has(storeKey) ? store.read<T>(storeKey) : initial));
  const set = useCallback(
    (next: T) => {
      store?.write(storeKey, next);
      setValue(next);
    },
    [store, storeKey],
  );
  return [value, set];
}

/** Clears all held component state (e.g. on sign-out). */
export function useClearComponentState(): () => void {
  const store = useContext(StoreContext);
  return useCallback(() => store?.clear(), [store]);
}
