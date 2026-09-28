import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo } from "react-native";
import { localStorage } from "./storage";

/*
 * Motion on/off. The default comes from the OS, but an explicit choice made
 * here outranks it and persists - someone can want the animations on a device
 * whose OS setting was flipped for something else entirely.
 */
const STORAGE_KEY = "kickcut.motion";

const Ctx = createContext<{ motion: boolean; setMotion: (v: boolean) => void } | null>(null);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [saved] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [motion, setMotionState] = useState<boolean>(saved !== "off");

  // The OS answer is asynchronous here, so it only applies when nothing was
  // chosen in the app.
  useEffect(() => {
    if (saved === "on" || saved === "off") return;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => setMotionState(!reduce));
  }, [saved]);

  const value = useMemo(
    () => ({
      motion,
      setMotion: (v: boolean) => {
        localStorage.setItem(STORAGE_KEY, v ? "on" : "off");
        setMotionState(v);
      },
    }),
    [motion],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMotion() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMotion must be used inside <MotionProvider>");
  return ctx;
}
