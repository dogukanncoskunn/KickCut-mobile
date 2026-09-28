import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { FfmpegStatus } from "./api";
import { cleanError } from "./errors";

/*
 * Whether ffmpeg is available, held in one place.
 *
 * On the desktop this also installs it. On Android it ships inside the APK -
 * the system will not execute a binary an app downloads - so there is nothing
 * to install, but Settings still shows which build is in use and the download
 * flow still asks before starting a job it could not finish.
 */
type Value = {
  status: FfmpegStatus | null;
  error: string | null;
  ready: boolean;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Value | null>(null);

export function FfmpegProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<FfmpegStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.ffmpegStatus());
      setError(null);
    } catch (err) {
      setError(cleanError(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Value>(
    () => ({ status, error, ready: status !== null && status.source !== "missing", refresh }),
    [status, error, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFfmpeg() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useFfmpeg must be used inside <FfmpegProvider>");
  return ctx;
}
