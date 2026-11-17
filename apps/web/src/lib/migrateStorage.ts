/**
 * The product was renamed (D-181): browser keys moved from `leadflow.*` / `leadflow:*` to
 * `simplecatch.*` / `simplecatch:*`. Copies what a returning user already saved (language, "tour
 * seen", draft backups …) so nothing resets. Runs once, as the first import of main.tsx, because
 * the language is read as soon as the i18n module loads.
 */
const OLD = /^leadflow([.:])/;

export function migrateStorage(storage: Storage | undefined = safeLocalStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && OLD.test(k)) keys.push(k);
    }
    for (const k of keys) {
      const next = k.replace(OLD, 'simplecatch$1');
      if (storage.getItem(next) === null) {
        const v = storage.getItem(k);
        if (v !== null) storage.setItem(next, v);
      }
      storage.removeItem(k);
    }
  } catch {
    // Storage blocked or full: the app works without it.
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

migrateStorage();
