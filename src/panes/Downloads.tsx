import { Text, View } from "react-native";
import { useLocale, useT } from "../i18n";
import { ask, useQueue } from "../lib/Queue";
import { EmptyState, Note } from "../lib/ui";
import { isActive, JobCard } from "./JobCard";

/*
 * The history: everything that finished, and everything that gave up.
 *
 * Two different removals, and the difference is the file on disk. The trash
 * icon forgets the record and leaves the MP4 alone; "remove" deletes the video
 * itself, so it asks first and says plainly what is about to happen.
 */
export function Downloads() {
  const t = useT();
  const { locale } = useLocale();
  const { jobs, error, resume, cancel } = useQueue();

  const history = jobs.filter((job) => !isActive(job)).sort((a, b) => b.createdAt - a.createdAt);

  if (history.length === 0 && !error) {
    return <EmptyState icon="download">{t("empty.downloads")}</EmptyState>;
  }

  const when = (ms: number) =>
    new Date(ms).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <View className="flex-col gap-4">
      {error ? <Note kind="error">{error}</Note> : null}
      {history.map((job) => (
        <View key={job.id} className="flex-col gap-1.5">
          <JobCard
            job={job}
            onResume={resume}
            onRemove={(id) => {
              void ask(t("downloads.delete.confirm"), {
                title: t("downloads.delete"),
                okLabel: t("downloads.delete.ok"),
                cancelLabel: t("action.cancel"),
                destructive: true,
              }).then((yes) => {
                if (yes) void cancel(id, true);
              });
            }}
            onForget={(id) => void cancel(id, false)}
          />
          <Text className="px-1 font-mono text-mini text-muted">
            {t("downloads.completed", { when: when(job.createdAt) })}
          </Text>
        </View>
      ))}
    </View>
  );
}
