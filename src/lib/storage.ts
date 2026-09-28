import Storage from "expo-sqlite/kv-store";

/*
 * The desktop keeps its preferences in `localStorage`, which answers
 * synchronously - and that matters, because the first paint cannot wait for
 * the theme or the language without flashing the wrong one. This is the same
 * shape over Expo's SQLite key-value store, whose sync calls keep that
 * property, so every `localStorage.getItem` in the ported screens reads the
 * same as it does on the desktop.
 */
export const localStorage = {
  getItem(key: string): string | null {
    try {
      return Storage.getItemSync(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      Storage.setItemSync(key, value);
    } catch {
      /* A preference that fails to persist must not break the screen. */
    }
  },
};
