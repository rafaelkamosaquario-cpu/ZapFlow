"use client";

import { useCallback, useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

/**
 * Sincroniza um estado com localStorage usando useSyncExternalStore, para
 * que o valor persistido seja lido de forma segura para hidratação (sem
 * "piscar" o valor inicial e sem efeitos que disparem setState).
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  const getSnapshot = useCallback(() => window.localStorage.getItem(key), [key]);
  const getServerSnapshot = useCallback(() => null, []);

  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  let value = initialValue;
  if (raw) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = initialValue;
    }
  }

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = next instanceof Function ? next(value) : next;
      const serialized = JSON.stringify(resolved);
      window.localStorage.setItem(key, serialized);
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: serialized }));
    },
    [key, value]
  );

  return [value, setValue] as const;
}
