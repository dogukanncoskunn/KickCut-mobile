import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import { useT } from "../i18n";
import { api } from "./api";
import type { JobProgress } from "./api";
import { cleanError } from "./errors";

/*
 * The queue, mirrored from the engine.
 *
 * The engine owns it outright and pushes the whole list on every change rather
 * than deltas, so this side can never be holding a job the engine has already
 * finished, removed, or failed.
 */
type Value = {
  jobs: JobProgress[];
  error: string | null;
  pause: (id: string) => Promise<void>;
  resume: (id: string) => Promise<void>;
  cancel: (id: string, deleteOutput: boolean) => Promise<void>;
};

const Ctx = createContext<Value | null>(null);

export function QueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobProgress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    const sub = api.onQueue(setJobs);
    // Jobs left over from a previous run are read back from disk; anything
    // that was mid-download returns as paused, ready to resume.
    void api.loadJobs().catch((err) => setError(cleanError(err)));
    return () => sub.remove();
  }, []);

  // The download notification speaks the app's language, not the phone's.
  useEffect(() => {
    void api
      .setNotificationLabels(t("queue.title"), t("queue.state.downloading"), t("queue.state.muxing"))
      .catch(() => {});
  }, [t]);

  const value = useMemo<Value>(() => {
    const act =
      <A extends unknown[]>(fn: (...args: A) => Promise<void>) =>
      async (...args: A) => {
        try {
          await fn(...args);
          setError(null);
        } catch (err) {
          setError(cleanError(err));
        }
      };
    return {
      jobs,
      error,
      pause: act(api.pauseJob),
      resume: act(api.resumeJob),
      cancel: act(api.cancelJob),
    };
  }, [jobs, error]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQueue() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useQueue must be used inside <QueueProvider>");
  return ctx;
}

/**
 * Ask a yes/no question the platform way. The desktop goes through Tauri's
 * dialog plugin; here it is the system alert, with the same wording.
 */
export function ask(
  message: string,
  opts: { title: string; okLabel: string; cancelLabel: string; destructive?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      opts.title,
      message,
      [
        { text: opts.cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: opts.okLabel, style: opts.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/*
 * Cancelling, with the question that has to come first. Stopping a job throws
 * away every segment it has fetched, and an hour of downloading is a real
 * thing to lose to a mistap. Two places offer the button, so the question
 * lives here, once.
 */
export function useConfirmedCancel() {
  const t = useT();
  const { cancel } = useQueue();
  return (id: string) => {
    void ask(t("queue.cancel.confirm"), {
      title: t("queue.cancel"),
      okLabel: t("queue.cancel"),
      cancelLabel: t("action.cancel"),
      destructive: true,
    }).then((yes) => {
      if (yes) void cancel(id, true);
    });
  };
}
