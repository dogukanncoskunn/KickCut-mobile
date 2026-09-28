import { requireNativeModule } from "expo";
import type { EventSubscription } from "expo-modules-core";

/*
 * The same surface as the desktop's `src/lib/api.ts`, with the Kotlin engine
 * (`modules/kickcut-engine`) standing where Tauri's `invoke` stood. Every
 * function keeps its desktop name and signature, so the screens above it are
 * the desktop's screens.
 */

export type Vod = {
  uuid: string;
  title: string;
  channel: string;
  startedAt: string;
  durationMs: number;
  views: number;
  thumbnail: string | null;
  masterUrl: string;
};

export type Rendition = {
  name: string;
  width: number;
  height: number;
  frameRate: number;
  bandwidth: number;
  playlistUrl: string;
  /**
   * True when this is the broadcaster's own stream rather than one of Kick's
   * transcodes - the top rung, when its H.264 profile shows it was passed through.
   */
  isSource: boolean;
};

/** What the range picker needs to draw the timeline. */
export type PlaylistSummary = {
  totalSeconds: number;
  segmentCount: number;
  /** Media times where the broadcast has a break, for marking the timeline. */
  discontinuitySeconds: number[];
  programStart: string | null;
  /** False while Kick is still writing the VOD - the end can still move. */
  complete: boolean;
};

/** The resolved consequences of a requested time range. */
export type RangePlan = {
  startIndex: number;
  endIndex: number;
  segmentCount: number;
  /** Seconds dropped from the first segment so the clip starts where asked. */
  trimOffset: number;
  outputSeconds: number;
  /** Media actually fetched: the clip plus the partial segments at each end. */
  downloadSeconds: number;
  estimatedBytes: number;
  crossesDiscontinuity: boolean;
};

/**
 * Where ffmpeg comes from. On Android it is always `bundled`: the system will
 * not execute a binary an app downloads, so it ships inside the APK.
 */
export type FfmpegSource = "bundled" | "missing";

export type FfmpegStatus = {
  source: FfmpegSource;
  version: string | null;
};

/** A segment that never downloaded, and where it falls in the broadcast. */
export type FailedSegment = {
  index: number;
  startSeconds: number;
  endSeconds: number;
};

export type JobState = "queued" | "downloading" | "paused" | "muxing" | "done" | "failed";

/** How the segments become an MP4. See Mux.kt (and the desktop's mux.rs). */
export type MuxMode = "copy" | "reencode";

/** A queued job flattened together with what is actually on disk. */
export type JobProgress = {
  id: string;
  title: string;
  channel: string;
  quality: string;
  playlistUrl: string;
  startIndex: number;
  endIndex: number;
  trimOffset: number;
  outputSeconds: number;
  crossesDiscontinuity: boolean;
  /** A SAF folder URI. */
  outputDir: string;
  fileName: string;
  muxMode: MuxMode;
  frameRate: number;
  /** A SAF document URI once the file exists. */
  outputPath: string | null;
  failedSegments: FailedSegment[];
  state: JobState;
  createdAt: number;
  error: string | null;
  segmentsDone: number;
  segmentsTotal: number;
  bytesDone: number;
  /** Measured from this session's start, so a resumed job reports honestly. */
  bytesPerSecond: number;
  etaSeconds: number | null;
  /** 0..1 while ffmpeg is assembling, otherwise null. */
  muxFraction: number | null;
};

/** What the Setup screen hands over to start a download. */
export type NewJob = {
  title: string;
  channel: string;
  quality: string;
  playlistUrl: string;
  startIndex: number;
  endIndex: number;
  trimOffset: number;
  outputSeconds: number;
  crossesDiscontinuity: boolean;
  outputDir: string;
  fileName: string;
  muxMode: MuxMode;
  frameRate: number;
};

type Native = {
  loadJobs(): Promise<void>;
  enqueueJob(job: NewJob): Promise<string>;
  pauseJob(id: string): Promise<void>;
  resumeJob(id: string): Promise<void>;
  cancelJob(id: string, deleteOutput: boolean): Promise<void>;
  setSpeedLimit(bytesPerSecond: number): Promise<void>;
  setAutoResume(enabled: boolean): Promise<void>;
  reveal(path: string): Promise<void>;
  share(path: string): Promise<void>;
  ffmpegVersion(): Promise<string>;
  freeBytes(): Promise<number>;
  renditions(masterUrl: string): Promise<Rendition[]>;
  playlistSummary(playlistUrl: string): Promise<PlaylistSummary>;
  planRange(playlistUrl: string, start: number, end: number, bandwidth: number): Promise<RangePlan>;
  pickFolder(): Promise<string | null>;
  folderLabel(uri: string): string;
  setNotificationLabels(channel: string, downloading: string, muxing: string): Promise<void>;
  addListener(event: "queue", listener: (e: { jobs: JobProgress[] }) => void): EventSubscription;
};

const native = requireNativeModule<Native>("KickcutEngine");

export const api = {
  loadJobs: () => native.loadJobs(),
  enqueueJob: (job: NewJob) => native.enqueueJob(job),
  pauseJob: (id: string) => native.pauseJob(id),
  resumeJob: (id: string) => native.resumeJob(id),
  /**
   * Remove a job. `deleteOutput` also deletes the finished video - forgetting a
   * line in a list is not the same act as destroying a recording.
   */
  cancelJob: (id: string, deleteOutput: boolean) => native.cancelJob(id, deleteOutput),
  /** Bytes per second; 0 removes the cap. Applies to a running download. */
  setSpeedLimit: (bytesPerSecond: number) => native.setSpeedLimit(bytesPerSecond),
  /** Whether a job that came up short puts itself back in the queue. */
  setAutoResume: (enabled: boolean) => native.setAutoResume(enabled),
  /** Open a finished file in the video player, or a folder in the files app. */
  reveal: (path: string) => native.reveal(path),
  share: (path: string) => native.share(path),
  ffmpegStatus: async (): Promise<FfmpegStatus> => {
    try {
      return { source: "bundled", version: await native.ffmpegVersion() };
    } catch {
      return { source: "missing", version: null };
    }
  },
  freeBytes: () => native.freeBytes(),
  renditions: (masterUrl: string) => native.renditions(masterUrl),
  playlistSummary: (playlistUrl: string) => native.playlistSummary(playlistUrl),
  planRange: (playlistUrl: string, startSeconds: number, endSeconds: number, bandwidth: number) =>
    native.planRange(playlistUrl, startSeconds, endSeconds, bandwidth),
  pickFolder: () => native.pickFolder(),
  folderLabel: (uri: string) => native.folderLabel(uri),
  setNotificationLabels: (channel: string, downloading: string, muxing: string) =>
    native.setNotificationLabels(channel, downloading, muxing),
  onQueue: (listener: (jobs: JobProgress[]) => void) =>
    native.addListener("queue", (e) => listener(e.jobs)),
};
