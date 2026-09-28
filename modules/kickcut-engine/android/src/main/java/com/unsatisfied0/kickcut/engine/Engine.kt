package com.unsatisfied0.kickcut.engine

import android.content.Context
import android.net.Uri
import android.os.StatFs
import android.provider.DocumentsContract
import androidx.documentfile.provider.DocumentFile
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFprobeKit
import com.arthenica.ffmpegkit.ReturnCode
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.coroutines.resume

/*
 * Port of `src-tauri/src/download.rs`: the download engine. Segments to disk,
 * pausable, resumable, queued.
 *
 * **The segment files on disk are the state.** A segment is written as
 * `N.part` and renamed to `N.ts` only once it is complete, so resuming means
 * listing the directory, and a crash mid-write costs one segment.
 *
 * Jobs run one at a time. The engine is a process-wide singleton so the
 * foreground service and the JS module see the same queue; JS going away (the
 * activity being destroyed) does not stop a download.
 */

class EngineException(message: String) : Exception(message)

enum class JobState(val wire: String) {
  Queued("queued"),
  Downloading("downloading"),
  Paused("paused"),
  Muxing("muxing"),
  Done("done"),
  Failed("failed");

  companion object {
    fun from(wire: String?) = entries.firstOrNull { it.wire == wire } ?: Paused
  }
}

data class FailedSegment(val index: Int, val startSeconds: Double, val endSeconds: Double)

/** Everything needed to resume a job in a later run of the app. */
data class Job(
  val id: String,
  val title: String,
  val channel: String,
  val quality: String,
  val playlistUrl: String,
  val startIndex: Int,
  val endIndex: Int,
  val trimOffset: Double,
  val outputSeconds: Double,
  val crossesDiscontinuity: Boolean,
  /** A SAF tree URI on Android. */
  val outputDir: String,
  val fileName: String,
  val muxMode: MuxMode,
  val frameRate: Double,
  var outputPath: String? = null,
  var failedSegments: List<FailedSegment> = emptyList(),
  var state: JobState,
  val createdAt: Long,
  var error: String? = null,
) {
  val segmentCount get() = endIndex - startIndex + 1

  fun toJson(): JSONObject = JSONObject().apply {
    put("id", id); put("title", title); put("channel", channel); put("quality", quality)
    put("playlistUrl", playlistUrl); put("startIndex", startIndex); put("endIndex", endIndex)
    put("trimOffset", trimOffset); put("outputSeconds", outputSeconds)
    put("crossesDiscontinuity", crossesDiscontinuity); put("outputDir", outputDir)
    put("fileName", fileName); put("muxMode", muxMode.wire); put("frameRate", frameRate)
    put("outputPath", outputPath ?: JSONObject.NULL)
    put(
      "failedSegments",
      JSONArray().apply {
        failedSegments.forEach {
          put(JSONObject().put("index", it.index).put("startSeconds", it.startSeconds).put("endSeconds", it.endSeconds))
        }
      },
    )
    put("state", state.wire); put("createdAt", createdAt); put("error", error ?: JSONObject.NULL)
  }

  fun toMap(): MutableMap<String, Any?> = mutableMapOf(
    "id" to id, "title" to title, "channel" to channel, "quality" to quality,
    "playlistUrl" to playlistUrl, "startIndex" to startIndex, "endIndex" to endIndex,
    "trimOffset" to trimOffset, "outputSeconds" to outputSeconds,
    "crossesDiscontinuity" to crossesDiscontinuity, "outputDir" to outputDir,
    "fileName" to fileName, "muxMode" to muxMode.wire, "frameRate" to frameRate,
    "outputPath" to outputPath,
    "failedSegments" to failedSegments.map {
      mapOf("index" to it.index, "startSeconds" to it.startSeconds, "endSeconds" to it.endSeconds)
    },
    "state" to state.wire, "createdAt" to createdAt.toDouble(), "error" to error,
  )

  companion object {
    fun fromJson(o: JSONObject): Job {
      val failed = o.optJSONArray("failedSegments")
      return Job(
        id = o.getString("id"),
        title = o.getString("title"),
        channel = o.getString("channel"),
        quality = o.getString("quality"),
        playlistUrl = o.getString("playlistUrl"),
        startIndex = o.getInt("startIndex"),
        endIndex = o.getInt("endIndex"),
        trimOffset = o.getDouble("trimOffset"),
        outputSeconds = o.getDouble("outputSeconds"),
        crossesDiscontinuity = o.getBoolean("crossesDiscontinuity"),
        outputDir = o.getString("outputDir"),
        fileName = o.getString("fileName"),
        muxMode = MuxMode.from(o.optString("muxMode")),
        frameRate = o.optDouble("frameRate", 0.0),
        outputPath = if (o.isNull("outputPath")) null else o.optString("outputPath"),
        failedSegments = (0 until (failed?.length() ?: 0)).map {
          val f = failed!!.getJSONObject(it)
          FailedSegment(f.getInt("index"), f.getDouble("startSeconds"), f.getDouble("endSeconds"))
        },
        state = JobState.from(o.optString("state")),
        createdAt = o.getLong("createdAt"),
        error = if (o.isNull("error")) null else o.optString("error"),
      )
    }
  }
}

/** Per-job stop switches, held only while a job is active. */
private class Control {
  val pause = AtomicBool()
  val cancel = AtomicBool()
}

private typealias AtomicBool = AtomicBoolean

private class Live(
  val id: String,
  val segmentsDone: AtomicLong,
  val bytesDone: AtomicLong,
  val started: Long,
  val bytesAtStart: Long,
)

private sealed class Outcome {
  object Finished : Outcome()
  /** Paused or cancelled on request. */
  object Stopped : Outcome()
  class Incomplete(val missing: List<FailedSegment>) : Outcome()
}

object Engine {
  /** Concurrent segment requests. */
  const val DEFAULT_CONCURRENCY = 8
  /** Attempts per segment before a job is failed. */
  const val MAX_ATTEMPTS = 10
  const val MAX_BACKOFF_MS = 8_000L
  /** How many times a job restarts itself after coming up short. */
  const val MAX_AUTO_RETRIES = 5
  const val AUTO_RETRY_DELAY_MS = 20_000L

  /**
   * Claims the platform it is actually running on, as the macOS build does.
   * stream.kick.com is not behind the rule that blocks the API, so this buys
   * nothing - it is simply not a lie.
   */
  const val UA = "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/140.0.0.0 Mobile Safari/537.36"

  private lateinit var app: Context
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val lock = Any()

  private val jobs = ArrayList<Job>()
  private var control: Pair<String, Control>? = null
  private var muxing: Pair<String, AtomicLong>? = null
  private var live: Live? = null
  private var loaded = false
  val limiter = RateLimiter()
  val autoResume = AtomicBoolean(true)
  private val autoRetries = HashMap<String, Int>()
  private val playlists = HashMap<String, MediaPlaylist>()
  private var sequence = 0L

  /** Receives the whole queue whenever it changes. */
  @Volatile var listener: ((List<Map<String, Any?>>) -> Unit)? = null

  /** Receives the running job, for the foreground notification. */
  @Volatile var onActivity: ((running: Map<String, Any?>?) -> Unit)? = null

  /*
   * The client the rest of the app uses caps a whole request at 30 s: right
   * for a playlist and wrong for a segment, which at 0.3 MB/s needs over half a
   * minute just to transfer. What needs a deadline there is a stall, not the
   * transfer, so segments get their own client.
   */
  private val client by lazy {
    OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build()
  }
  private val segmentClient by lazy {
    OkHttpClient.Builder()
      .connectTimeout(30, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .build()
  }

  fun init(context: Context) {
    if (!::app.isInitialized) {
      app = context.applicationContext
      FFmpegKitConfig.enableLogCallback(null)
    }
  }

  private val jobsDir get() = File(app.filesDir, "jobs")
  private fun partsDir(id: String) = File(File(app.filesDir, "parts"), id)
  private fun stagingDir(id: String) = File(File(app.filesDir, "staging"), id)

  /* ------------------------------------------------------------- network -- */

  fun getText(url: String): String {
    val request = Request.Builder().url(url).header("User-Agent", UA).build()
    val response = try {
      client.newCall(request).execute()
    } catch (e: InterruptedIOException) {
      throw EngineException("The stream server did not answer in time. Check your connection and try again.")
    } catch (e: IOException) {
      throw EngineException("Could not reach the stream server: ${e.message}")
    }
    response.use {
      if (it.code == 404) throw EngineException("That stream is no longer available - Kick may have pruned it.")
      if (!it.isSuccessful) throw EngineException("The stream server answered ${it.code}.")
      return try {
        it.body!!.string()
      } catch (e: IOException) {
        throw EngineException("The stream server's response could not be read: ${e.message}")
      }
    }
  }

  fun renditions(masterUrl: String): List<Rendition> = Master.renditions(getText(masterUrl), masterUrl)

  /** Parsed playlists, keyed by URL: fetched once per quality and kept. */
  private fun playlist(url: String): MediaPlaylist {
    synchronized(lock) { playlists[url] }?.let { return it }
    val parsed = Hls.parseMedia(getText(url), url)
    synchronized(lock) { playlists[url] = parsed }
    return parsed
  }

  fun playlistSummary(url: String) = playlist(url).summary()

  fun planRange(url: String, start: Double, end: Double, bandwidth: Long) = playlist(url).plan(start, end, bandwidth)

  /* ---------------------------------------------------------- persistence -- */

  private fun save(job: Job) {
    try {
      jobsDir.mkdirs()
      File(jobsDir, "${job.id}.json").writeText(job.toJson().toString(2))
    } catch (e: Exception) {
      throw EngineException("Job could not be saved: ${e.message}")
    }
  }

  /**
   * Anything recorded as running belongs to a previous run of the app and is
   * no longer running, so it comes back paused rather than lying about itself.
   */
  private fun loadAll(): List<Job> {
    val files = jobsDir.listFiles { f -> f.extension == "json" } ?: return emptyList()
    return files.mapNotNull { f ->
      // One bad record must not hide the rest of the queue.
      runCatching { Job.fromJson(JSONObject(f.readText())) }.getOrNull()
    }.map {
      if (it.state == JobState.Downloading || it.state == JobState.Muxing) it.state = JobState.Paused
      it
    }.sortedBy { it.createdAt }
  }

  /** Which segments are already complete, and how many bytes they account for. */
  private fun scanParts(dir: File): Pair<Set<Int>, Long> {
    val done = HashSet<Int>()
    var bytes = 0L
    dir.listFiles()?.forEach { f ->
      // Only `.ts` counts. A `.part` is an interrupted write, fetched again.
      val index = f.name.removeSuffix(".ts").takeIf { f.name.endsWith(".ts") }?.toIntOrNull() ?: return@forEach
      bytes += f.length()
      done += index
    }
    return done to bytes
  }

  /* ------------------------------------------------------------- queue -- */

  private fun setState(id: String, state: JobState, error: String?): Job? = synchronized(lock) {
    jobs.firstOrNull { it.id == id }?.also {
      it.state = state
      it.error = error
    }?.copy()
  }

  /** Emit the whole queue, so the UI can never hold a job the engine has forgotten. */
  fun emitQueue() {
    val list = synchronized(lock) {
      val mux = muxing?.let { it.first to it.second.get() / 1_000_000.0 }
      val l = live
      jobs.map { job ->
        val total = job.segmentCount
        val map = job.toMap()
        val muxFraction = mux?.takeIf { it.first == job.id }?.second
        if (l != null && l.id == job.id) {
          val done = l.segmentsDone.get()
          val bytes = l.bytesDone.get()
          val elapsed = (System.nanoTime() - l.started) / 1e9
          // Measured from this session's start, or a resumed job would report
          // a speed inflated by everything the previous session already had.
          val rate = if (elapsed > 1.0) ((bytes - l.bytesAtStart) / elapsed).toLong() else 0L
          val eta = if (rate > 0 && done > 0 && done < total) {
            val perSegment = (bytes - l.bytesAtStart).toDouble() / maxOf(done, 1)
            ((total - done) * perSegment / rate).toLong().toDouble()
          } else null
          map += mapOf(
            "segmentsDone" to done.toInt(), "segmentsTotal" to total, "bytesDone" to bytes.toDouble(),
            "bytesPerSecond" to rate.toDouble(), "etaSeconds" to eta, "muxFraction" to muxFraction,
          )
        } else {
          map += mapOf(
            "segmentsDone" to if (job.state == JobState.Muxing || job.state == JobState.Done) total else 0,
            "segmentsTotal" to total, "bytesDone" to 0.0, "bytesPerSecond" to 0.0,
            "etaSeconds" to null, "muxFraction" to muxFraction,
          )
        }
        map
      }
    }
    listener?.invoke(list)
    val running = synchronized(lock) { control?.first }
    onActivity?.invoke(running?.let { id -> list.firstOrNull { it["id"] == id } })
  }

  /** Start the next queued job if nothing is running. */
  private fun pump() {
    val (job, ctl) = synchronized(lock) {
      if (control != null) return
      val next = jobs.firstOrNull { it.state == JobState.Queued } ?: run {
        onActivity?.invoke(null)
        return
      }
      val c = Control()
      control = next.id to c
      next.state = JobState.Downloading
      next.error = null
      next.copy() to c
    }
    // Recorded, not only held in memory: a job that is running when the app
    // dies must come back as paused, and it can only do that if the file says
    // it was running. (The desktop's pump skips this save, so a job killed
    // mid-download comes back as "waiting" and nothing ever starts it.)
    runCatching { save(job) }
    DownloadService.start(app)

    scope.launch {
      val id = job.id
      val downloaded = runCatching { runJob(job, ctl) }
      synchronized(lock) { live = null }

      // Downloading and muxing are one job: the control slot stays held across
      // both, and a job only reports Done once the file has been read back.
      val outcome: Result<JobState> = downloaded.fold(
        onSuccess = { result ->
          when (result) {
            is Outcome.Finished -> {
              setState(id, JobState.Muxing, null)?.let { runCatching { save(it) } }
              emitQueue()
              runCatching { assemble(job, ctl) }.fold(
                onSuccess = { path ->
                  synchronized(lock) {
                    jobs.firstOrNull { it.id == id }?.apply {
                      outputPath = path
                      failedSegments = emptyList()
                    }
                    autoRetries.remove(id)
                  }
                  Result.success(JobState.Done)
                },
                onFailure = { e ->
                  // A pause or cancel during the mux is not a failure.
                  if (ctl.pause.get() || ctl.cancel.get()) Result.success(JobState.Paused) else Result.failure(e)
                },
              )
            }
            is Outcome.Stopped -> Result.success(JobState.Paused)
            is Outcome.Incomplete -> {
              val spent = synchronized(lock) {
                jobs.firstOrNull { it.id == id }?.failedSegments = result.missing
                val n = (autoRetries[id] ?: 0) + 1
                autoRetries[id] = n
                n
              }
              if (autoResume.get() && spent <= MAX_AUTO_RETRIES) {
                // Only the missing segments are fetched on the way round.
                delay(AUTO_RETRY_DELAY_MS)
                Result.success(JobState.Queued)
              } else {
                Result.failure(
                  EngineException("${result.missing.size} segment(s) could not be downloaded after $MAX_ATTEMPTS attempts each."),
                )
              }
            }
          }
        },
        onFailure = { Result.failure(it) },
      )

      synchronized(lock) {
        control = null
        muxing = null
      }
      val (next, error) = outcome.fold({ it to null }, { JobState.Failed to (it.message ?: it.toString()) })
      // A cancelled job has already been removed; do not resurrect its record.
      if (!ctl.cancel.get()) setState(id, next, error)?.let { runCatching { save(it) } }
      emitQueue()
      // Whatever happened to this job, the queue moves on.
      pump()
    }

    emitQueue()
  }

  /** Fetch every missing segment. */
  private suspend fun runJob(job: Job, ctl: Control): Outcome {
    val dir = partsDir(job.id)
    if (!dir.mkdirs() && !dir.isDirectory) throw EngineException("Could not create the working folder.")

    // Re-fetched rather than cached: the stored indices make it unambiguous,
    // and a resume after days should see what Kick serves now.
    val pl = Hls.parseMedia(getText(job.playlistUrl), job.playlistUrl)
    if (job.endIndex >= pl.segments.size) {
      throw EngineException("This broadcast no longer has the segments this job was planned around.")
    }

    val (already, bytesAlready) = scanParts(dir)
    // Reversed because workers take from the back, so segments arrive in
    // playback order.
    val todo = ArrayList((job.startIndex..job.endIndex).filter { it !in already }.reversed())

    val segmentsDone = AtomicLong(already.count { it in job.startIndex..job.endIndex }.toLong())
    val bytesDone = AtomicLong(bytesAlready)
    synchronized(lock) { live = Live(job.id, segmentsDone, bytesDone, System.nanoTime(), bytesAlready) }
    emitQueue()

    if (todo.isEmpty()) return Outcome.Finished

    val stopped = AtomicBoolean(false)
    val failure = ArrayList<Int>()
    // No more workers than there is work.
    val workerCount = minOf(DEFAULT_CONCURRENCY, todo.size)

    // Progress on a timer, not per segment.
    val ticker = scope.launch {
      while (isActive && !stopped.get()) {
        delay(250)
        emitQueue()
      }
    }

    kotlinx.coroutines.coroutineScope {
      (0 until workerCount).map {
        async(Dispatchers.IO) {
          while (true) {
            if (ctl.pause.get() || ctl.cancel.get()) {
              stopped.set(true)
              return@async
            }
            val index = synchronized(todo) { todo.removeLastOrNull() } ?: return@async
            val r = runCatching { fetchSegment(pl.segments[index].url, dir, index, ctl) }
            r.fold(
              onSuccess = { len ->
                if (len != null) {
                  bytesDone.addAndGet(len)
                  segmentsDone.incrementAndGet()
                } else {
                  // Stopped mid-segment; put it back so a resume picks it up.
                  synchronized(todo) { todo.add(index) }
                  stopped.set(true)
                  return@async
                }
              },
              // One segment gave up after every attempt. The rest of the run
              // continues; every gap is reported together at the end.
              onFailure = { synchronized(failure) { failure.add(index) } },
            )
          }
        }
      }.awaitAll()
    }
    stopped.set(true)
    ticker.cancel()

    if (ctl.cancel.get()) {
      dir.deleteRecursively()
      return Outcome.Stopped
    }
    if (failure.isNotEmpty()) {
      return Outcome.Incomplete(
        failure.sorted().map { FailedSegment(it, pl.starts[it], pl.starts[it] + pl.segments[it].duration) },
      )
    }
    if (ctl.pause.get()) return Outcome.Stopped
    return Outcome.Finished
  }

  /**
   * Fetch one segment to `dir`; null means it was stopped part-way. The write
   * goes to `N.part` and is renamed to `N.ts` only after the last byte lands.
   */
  private suspend fun fetchSegment(url: String, dir: File, index: Int, ctl: Control): Long? {
    val part = File(dir, "$index.part")
    val finalFile = File(dir, "$index.ts")
    var backoff = 400L
    for (attempt in 1..MAX_ATTEMPTS) {
      try {
        val len = streamToFile(url, part, ctl)
        if (len == null) {
          part.delete()
          return null
        }
        if (!part.renameTo(finalFile)) throw EngineException("Segment $index could not be saved.")
        return len
      } catch (e: EngineException) {
        throw e
      } catch (e: Exception) {
        part.delete()
        if (attempt == MAX_ATTEMPTS) {
          throw EngineException("Segment $index failed after $MAX_ATTEMPTS attempts: ${e.message}")
        }
        // A CDN hiccup answered by eight workers retrying at once is how a
        // slow moment becomes a failure.
        delay(backoff)
        backoff = minOf(backoff * 2, MAX_BACKOFF_MS)
      }
    }
    error("loop returns on the final attempt")
  }

  private suspend fun streamToFile(url: String, path: File, ctl: Control): Long? {
    val request = Request.Builder().url(url).header("User-Agent", UA).build()
    segmentClient.newCall(request).execute().use { response ->
      if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
      val body = response.body ?: throw IOException("empty body")
      var written = 0L
      path.outputStream().use { out ->
        body.byteStream().use { input ->
          val buf = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            limiter.take(n.toLong())
            // Checked after the throttle wait: a pause pressed during a long
            // wait lands as soon as it ends.
            if (ctl.pause.get() || ctl.cancel.get()) return null
            out.write(buf, 0, n)
            written += n
          }
        }
      }
      return written
    }
  }

  /**
   * Turn the downloaded segments into the finished MP4 in the chosen folder.
   * The segments are deleted only after the file has been read back.
   */
  private suspend fun assemble(job: Job, ctl: Control): String {
    val dir = partsDir(job.id)
    val joined = Mux.joinSegments(dir, job.startIndex, job.endIndex)
    val staging = stagingDir(job.id).apply { deleteRecursively(); mkdirs() }
    val staged = File(staging, "${job.fileName}.mp4")
    val progressFile = File(staging, "progress.txt")

    val fraction = AtomicLong(0)
    synchronized(lock) { muxing = job.id to fraction }

    val args = Mux.buildArgs(
      MuxRequest(
        source = joined.absolutePath,
        output = staged.absolutePath,
        mode = job.muxMode,
        trimOffset = job.trimOffset,
        outputSeconds = job.outputSeconds,
        frameRate = job.frameRate,
        progressTarget = progressFile.absolutePath,
      ),
    )

    val ticker = scope.launch {
      while (isActive) {
        delay(400)
        val text = runCatching { progressFile.readText() }.getOrNull()
        if (text != null) Mux.progressFraction(text, job.outputSeconds)?.let { fraction.set((it * 1_000_000).toLong()) }
        if (ctl.pause.get() || ctl.cancel.get()) FFmpegKit.cancel()
        emitQueue()
      }
    }

    val session = try {
      suspendCancellableCoroutine { cont ->
        val s = FFmpegKit.executeWithArgumentsAsync(args.toTypedArray()) { done -> cont.resume(done) }
        cont.invokeOnCancellation { FFmpegKit.cancel(s.sessionId) }
      }
    } finally {
      ticker.cancel()
    }

    if (ctl.pause.get() || ctl.cancel.get()) {
      staging.deleteRecursively()
      throw EngineException("Cancelled.")
    }
    if (!ReturnCode.isSuccess(session.returnCode)) {
      val reason = session.allLogsAsString.lines().filter { it.isNotBlank() }.takeLast(12).joinToString("\n")
      staging.deleteRecursively()
      throw EngineException("ffmpeg could not assemble this clip.\n$reason")
    }

    verify(staged, job.outputSeconds)
    joined.delete()

    val uri = try {
      publish(staged, job.outputDir, job.fileName)
    } finally {
      staging.deleteRecursively()
    }
    // The segments have served their purpose.
    dir.deleteRecursively()
    return uri
  }

  /** Check the output before telling anyone it is ready. */
  private fun verify(output: File, expectedSeconds: Double) {
    val info = FFprobeKit.getMediaInformation(output.absolutePath).mediaInformation
      ?: throw EngineException("The finished file could not be read back, so it is probably damaged.")
    val all = info.allProperties ?: JSONObject()
    val streams = all.optJSONArray("streams") ?: JSONArray()
    val list = (0 until streams.length()).map { streams.getJSONObject(it) }
    val video = list.firstOrNull { it.optString("codec_type") == "video" }
    val frames = video?.optString("nb_frames")?.toDoubleOrNull() ?: 0.0
    val videoSeconds = video?.optString("duration")?.toDoubleOrNull() ?: 0.0
    Mux.judge(
      Mux.Verified(
        seconds = all.optJSONObject("format")?.optString("duration")?.toDoubleOrNull() ?: 0.0,
        hasVideo = video != null,
        hasAudio = list.any { it.optString("codec_type") == "audio" },
        impliedFps = if (videoSeconds > 0) frames / videoSeconds else 0.0,
        declaredFps = Mux.ratio(video?.optString("r_frame_rate")),
      ),
      expectedSeconds,
    )
  }

  /** Copy the verified file into the SAF folder under a name that overwrites nothing. */
  private fun publish(staged: File, treeUri: String, stem: String): String {
    val folder = DocumentFile.fromTreeUri(app, Uri.parse(treeUri))
    if (folder == null || !folder.canWrite()) {
      throw EngineException("The folder chosen to save into can no longer be written. Pick it again.")
    }
    val existing = folder.listFiles().mapNotNull { it.name }.toHashSet()
    val name = Mux.freeOutputName(stem) { it in existing }
    val target = folder.createFile("video/mp4", name)
      ?: throw EngineException("The file could not be created in the chosen folder.")
    try {
      app.contentResolver.openOutputStream(target.uri, "w")!!.use { out ->
        staged.inputStream().use { it.copyTo(out, 1 shl 20) }
      }
    } catch (e: Exception) {
      target.delete()
      throw EngineException("The file could not be written to the chosen folder: ${e.message}")
    }
    return target.uri.toString()
  }

  /* ------------------------------------------------------------ commands -- */

  fun loadJobs() {
    val first = synchronized(lock) { !loaded.also { loaded = true } }
    if (first) {
      val restored = loadAll()
      restored.filter { it.state == JobState.Paused }.forEach { runCatching { save(it) } }
      synchronized(lock) {
        jobs.clear()
        jobs.addAll(restored)
      }
      emitQueue()
      // A job still waiting its turn was asked to run; it should not sit there
      // until someone pauses and resumes it.
      pump()
      return
    }
    emitQueue()
  }

  data class NewJob(
    val title: String,
    val channel: String,
    val quality: String,
    val playlistUrl: String,
    val startIndex: Int,
    val endIndex: Int,
    val trimOffset: Double,
    val outputSeconds: Double,
    val crossesDiscontinuity: Boolean,
    val outputDir: String,
    val fileName: String,
    val muxMode: MuxMode,
    val frameRate: Double,
  )

  fun enqueue(job: NewJob): String {
    if (job.endIndex < job.startIndex) throw EngineException("That range is empty.")
    val folder = runCatching { DocumentFile.fromTreeUri(app, Uri.parse(job.outputDir)) }.getOrNull()
    if (job.outputDir.isBlank() || folder == null || !folder.isDirectory || !folder.canWrite()) {
      throw EngineException("Pick a folder that exists to save into.")
    }
    val createdAt = System.currentTimeMillis()
    val id = synchronized(lock) { "${createdAt.toString(16)}-${(sequence++).toString(16)}" }
    val record = Job(
      id = id, title = job.title, channel = job.channel, quality = job.quality,
      playlistUrl = job.playlistUrl, startIndex = job.startIndex, endIndex = job.endIndex,
      trimOffset = job.trimOffset, outputSeconds = job.outputSeconds,
      crossesDiscontinuity = job.crossesDiscontinuity, outputDir = job.outputDir,
      fileName = safeFileName(job.fileName), muxMode = job.muxMode, frameRate = job.frameRate,
      state = JobState.Queued, createdAt = createdAt,
    )
    save(record)
    synchronized(lock) { jobs.add(record) }
    emitQueue()
    pump()
    return id
  }

  fun setSpeedLimit(bytesPerSecond: Long) = limiter.set(bytesPerSecond)

  fun setAutoResume(enabled: Boolean) = autoResume.set(enabled)

  fun pause(id: String) {
    synchronized(lock) {
      control?.let { (running, c) ->
        if (running == id) {
          c.pause.set(true)
          return // The runner records Paused when it winds down.
        }
      }
    }
    // Not the running job: it is queued, so pausing takes it out of line.
    setState(id, JobState.Paused, null)?.let { save(it) }
    emitQueue()
  }

  /** Pause whatever is running - the system ran out of foreground time. */
  fun pauseRunning() {
    synchronized(lock) { control?.second?.pause?.set(true) }
  }

  fun resume(id: String) {
    setState(id, JobState.Queued, null)?.let { save(it) }
    emitQueue()
    pump()
  }

  /**
   * Remove a job. `deleteOutput` separates forgetting a line in a list from
   * destroying a recording.
   */
  fun cancel(id: String, deleteOutput: Boolean) {
    val output = synchronized(lock) {
      control?.let { (running, c) -> if (running == id) c.cancel.set(true) }
      val out = jobs.firstOrNull { it.id == id }?.outputPath
      jobs.removeAll { it.id == id }
      autoRetries.remove(id)
      out
    }
    File(jobsDir, "$id.json").delete()
    partsDir(id).deleteRecursively()
    stagingDir(id).deleteRecursively()
    if (deleteOutput && output != null) {
      runCatching { DocumentsContract.deleteDocument(app.contentResolver, Uri.parse(output)) }
    }
    emitQueue()
  }

  /** Bytes free where segments are written. */
  fun freeBytes(): Long = StatFs(app.filesDir.absolutePath).availableBytes

  fun ffmpegVersion(): String = "ffmpeg version " + (FFmpegKitConfig.getFFmpegVersion() ?: "?")

  fun isBusy(): Boolean = synchronized(lock) { control != null || jobs.any { it.state == JobState.Queued } }
}

