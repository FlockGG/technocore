/**
 * Namespaced localStorage helpers.
 *
 * Small on purpose: JSON in, JSON out, never throwing on a quota or private-mode
 * failure, and emitting a change event so views re-read instead of holding stale
 * copies. Agent private keys never come through here — see `identity/vault.ts`.
 */

const CHANGE_EVENT = "folester:store-change";

export function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    notify(key);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(key);
  notify(key);
}

function notify(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key } }));
}

/** Subscribe to local writes, including those made in another tab. */
export function onStoreChange(listener: (key: string) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const local = (event: Event) => listener((event as CustomEvent<{ key: string }>).detail.key);
  const cross = (event: StorageEvent) => {
    if (event.key) listener(event.key);
  };
  window.addEventListener(CHANGE_EVENT, local);
  window.addEventListener("storage", cross);
  return () => {
    window.removeEventListener(CHANGE_EVENT, local);
    window.removeEventListener("storage", cross);
  };
}

export function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.floor(Math.random() * 1e12).toString(36);
  return `${prefix}_${random}`;
}
