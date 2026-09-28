import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Uniwind } from "uniwind";
import { localStorage } from "./storage";

/*
 * Dark or light, as an explicit choice.
 *
 * Dark is the default because that is what the app was drawn against and what
 * sits next to a stream. The light theme is a real theme rather than an
 * inversion: the tokens in global.css move, and no component knows which one
 * is running.
 *
 * Applied before the first render, so there is no flash of the wrong theme.
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "kickcut.theme";

const Ctx = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null);

function initialTheme(): Theme {
  const theme: Theme = localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  Uniwind.setTheme(theme);
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  const value = useMemo(
    () => ({
      theme,
      setTheme: (next: Theme) => {
        localStorage.setItem(STORAGE_KEY, next);
        Uniwind.setTheme(next);
        setThemeState(next);
      },
    }),
    [theme],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
