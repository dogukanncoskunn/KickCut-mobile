package com.unsatisfied0.kickcut.engine

/*
 * Port of KickCut's `src-tauri/src/hls.rs` and the parsing half of `kick.rs`.
 *
 * Media-playlist parsing and the time-to-segment arithmetic behind the range
 * picker. Kick's segments carry a nominal 10 s target duration, so it is
 * tempting to find the segment for a timecode with `seconds / 10`. Measured
 * against a real 8-hour VOD the `#EXTINF` values range from 2.000 to 11.916 s,
 * and that shortcut puts a 02:00:00 cut 18.7 s late. So durations are summed.
 * The same fixture and the same tests as the desktop app lock this down.
 */

class HlsException(message: String) : Exception(message)

/** One `.ts` file, with the duration its `#EXTINF` declared. */
data class Segment(val url: String, val duration: Double)

data class PlaylistSummary(
  val totalSeconds: Double,
  val segmentCount: Int,
  val discontinuitySeconds: List<Double>,
  val programStart: String?,
  val complete: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "totalSeconds" to totalSeconds,
    "segmentCount" to segmentCount,
    "discontinuitySeconds" to discontinuitySeconds,
    "programStart" to programStart,
    "complete" to complete,
  )
}

data class RangePlan(
  val startIndex: Int,
  val endIndex: Int,
  val segmentCount: Int,
  val trimOffset: Double,
  val outputSeconds: Double,
  val downloadSeconds: Double,
  val estimatedBytes: Long,
  val crossesDiscontinuity: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "startIndex" to startIndex,
    "endIndex" to endIndex,
    "segmentCount" to segmentCount,
    "trimOffset" to trimOffset,
    "outputSeconds" to outputSeconds,
    "downloadSeconds" to downloadSeconds,
    "estimatedBytes" to estimatedBytes.toDouble(),
    "crossesDiscontinuity" to crossesDiscontinuity,
  )
}

class MediaPlaylist(
  val segments: List<Segment>,
  /** `starts[i]` is the media time at which segment `i` begins. */
  val starts: List<Double>,
  val total: Double,
  /** Indices of segments preceded by `#EXT-X-DISCONTINUITY`. */
  val discontinuities: List<Int>,
  val programStart: String?,
  /** Whether `#EXT-X-ENDLIST` was present. */
  val complete: Boolean,
) {
  fun summary() = PlaylistSummary(
    totalSeconds = total,
    segmentCount = segments.size,
    discontinuitySeconds = discontinuities.map { starts[it] },
    programStart = programStart,
    complete = complete,
  )

  /** Index of the segment containing `seconds`, by binary search over the starts. */
  fun indexAt(seconds: Double): Int {
    if (seconds <= 0.0) return 0
    var lo = 0
    var hi = starts.size
    while (lo < hi) {
      val mid = (lo + hi) ushr 1
      if (starts[mid] < seconds) lo = mid + 1 else hi = mid
    }
    // `lo` is the first start >= seconds.
    return when {
      lo < starts.size && starts[lo] == seconds -> lo
      lo == 0 -> 0
      else -> lo - 1
    }
  }

  /**
   * Resolve a requested range to the segments that cover it. The requested
   * times are clamped to the playlist rather than rejected.
   */
  fun plan(start: Double, end: Double, bandwidth: Long): RangePlan {
    val s = start.coerceAtLeast(0.0).coerceAtMost(total)
    val e = end.coerceAtLeast(0.0).coerceAtMost(total)
    if (e - s < 0.5) throw HlsException("Pick an end time that is later than the start time.")

    val startIndex = indexAt(s)
    // `end` is exclusive at a boundary: a cut landing exactly where a segment
    // begins does not need that segment.
    val endIndex = if (e <= starts[startIndex]) startIndex else indexAt(e - maxOf(Math.ulp(1.0), 1e-6))

    val trimOffset = s - starts[startIndex]
    var downloadSeconds = 0.0
    for (i in startIndex..endIndex) downloadSeconds += segments[i].duration

    return RangePlan(
      startIndex = startIndex,
      endIndex = endIndex,
      segmentCount = endIndex - startIndex + 1,
      trimOffset = trimOffset,
      outputSeconds = e - s,
      downloadSeconds = downloadSeconds,
      estimatedBytes = (downloadSeconds * bandwidth / 8.0).coerceAtLeast(0.0).toLong(),
      crossesDiscontinuity = discontinuities.any { it > startIndex && it <= endIndex },
    )
  }
}

object Hls {
  fun parseMedia(body: String, baseUrl: String): MediaPlaylist {
    val segments = ArrayList<Segment>()
    val starts = ArrayList<Double>()
    val discontinuities = ArrayList<Int>()
    var programStart: String? = null
    var complete = false
    var pending: Double? = null
    var clock = 0.0

    for (raw in body.lineSequence()) {
      val line = raw.trim()
      if (line.isEmpty()) continue
      when {
        line.startsWith("#EXTINF:") ->
          pending = line.removePrefix("#EXTINF:").split(',').first().trim().toDoubleOrNull()
        line.startsWith("#EXT-X-DISCONTINUITY") -> discontinuities.add(segments.size)
        line.startsWith("#EXT-X-PROGRAM-DATE-TIME:") ->
          if (programStart == null) programStart = line.removePrefix("#EXT-X-PROGRAM-DATE-TIME:").trim()
        line.startsWith("#EXT-X-ENDLIST") -> complete = true
        !line.startsWith("#") -> {
          // A URI with no preceding #EXTINF would silently shift every later
          // segment, so the playlist is rejected.
          val duration = pending ?: throw HlsException("This playlist is malformed: a segment has no duration.")
          pending = null
          starts.add(clock)
          clock += duration
          segments.add(Segment(absolutize(line, baseUrl), duration))
        }
      }
    }

    if (segments.isEmpty()) {
      throw HlsException("That quality has no segments - the broadcast may still be processing.")
    }
    return MediaPlaylist(segments, starts, clock, discontinuities, programStart, complete)
  }

  /** Resolve a possibly-relative playlist path against the playlist URL it came from. */
  fun absolutize(reference: String, base: String): String {
    if (reference.startsWith("http://") || reference.startsWith("https://")) return reference
    val cut = base.lastIndexOf('/')
    return if (cut >= 0) base.substring(0, cut) + "/" + reference.trimStart('/') else reference
  }
}

/* ---------------------------------------------------------------- master -- */

data class Rendition(
  val name: String,
  val width: Int,
  val height: Int,
  val frameRate: Double,
  val bandwidth: Long,
  val playlistUrl: String,
  var isSource: Boolean = false,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "name" to name,
    "width" to width,
    "height" to height,
    "frameRate" to frameRate,
    "bandwidth" to bandwidth.toDouble(),
    "playlistUrl" to playlistUrl,
    "isSource" to isSource,
  )
}

object Master {
  /** Read one `KEY=VALUE` attribute out of an `#EXT-X-*` line. */
  fun attr(line: String, key: String): String? {
    val at = line.indexOf("$key=")
    if (at < 0) return null
    val rest = line.substring(at + key.length + 1)
    return if (rest.startsWith("\"")) {
      val close = rest.indexOf('"', 1)
      if (close < 0) null else rest.substring(1, close)
    } else {
      rest.split(',').first()
    }
  }

  private fun pairs(body: String): List<Pair<String, String>> {
    val lines = body.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
    val out = ArrayList<Pair<String, String>>()
    var i = 0
    while (i < lines.size) {
      val line = lines[i++]
      if (!line.startsWith("#EXT-X-STREAM-INF:")) continue
      val uri = lines.getOrNull(i) ?: continue
      if (uri.startsWith("#")) continue
      i++
      out.add(line to uri)
    }
    return out
  }

  fun parseMaster(body: String, baseUrl: String): MutableList<Rendition> {
    val out = pairs(body).map { (line, uri) ->
      val res = attr(line, "RESOLUTION")?.split('x')
      val w = res?.getOrNull(0)?.toIntOrNull()
      val h = res?.getOrNull(1)?.toIntOrNull()
      val (width, height) = if (w != null && h != null) w to h else 0 to 0
      Rendition(
        name = attr(line, "VIDEO") ?: uri.split('/').first(),
        width = width,
        height = height,
        frameRate = attr(line, "FRAME-RATE")?.toDoubleOrNull() ?: 0.0,
        bandwidth = attr(line, "BANDWIDTH")?.toLongOrNull() ?: 0L,
        playlistUrl = Hls.absolutize(uri, baseUrl),
      )
    }.toMutableList()
    if (out.isEmpty()) throw HlsException("That stream lists no downloadable qualities.")
    return out
  }

  /** H.264 profile out of each `CODECS` attribute, keyed by rendition. */
  fun parseProfiles(body: String): List<Pair<String, Int>> = pairs(body).mapNotNull { (line, uri) ->
    val name = attr(line, "VIDEO") ?: uri.split('/').first()
    val profile = attr(line, "CODECS")
      ?.split(',')
      ?.firstOrNull { it.trimStart().startsWith("avc1.") }
      ?.trim()
      ?.let { if (it.length >= 7) it.substring(5, 7).toIntOrNull(16) else null }
    if (profile == null) null else name to profile
  }

  /**
   * Whether the top rendition is the broadcaster's own stream: Kick's ladder
   * encodes every rung it makes at Main, so a top rung at High is a passthrough.
   */
  fun markSource(list: MutableList<Rendition>, profiles: List<Pair<String, Int>>) {
    fun profileOf(name: String) = profiles.firstOrNull { it.first == name }?.second
    val top = list.firstOrNull() ?: return
    val topProfile = profileOf(top.name) ?: return
    val rest = list.drop(1)
    if (rest.isEmpty()) {
      top.isSource = true
      return
    }
    top.isSource = rest.mapNotNull { profileOf(it.name) }.all { topProfile > it }
  }

  /** The quality options, best first: pixels, then frame rate, then bitrate. */
  fun renditions(body: String, masterUrl: String): List<Rendition> {
    val list = parseMaster(body, masterUrl)
    list.sortWith(
      compareByDescending<Rendition> { it.width.toLong() * it.height }
        .thenByDescending { it.frameRate }
        .thenByDescending { it.bandwidth },
    )
    markSource(list, parseProfiles(body))
    return list
  }
}
