"use client";

import { useSyncExternalStore } from "react";

function subscribe() {
  return () => {};
}

function getSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

/**
 * Retorna false durante a renderização no servidor/hidratação e true assim
 * que o componente está montado no cliente. Útil para adiar a renderização
 * de valores que dependem de APIs do navegador (ex.: tema resolvido).
 */
export function useHasMounted() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
