package com.unsatisfied0.kickcut.engine

import kotlinx.coroutines.delay
import java.util.concurrent.atomic.AtomicLong

/*
 * Port of `src-tauri/src/rate.rs`: a download speed limit shared by every
 * worker and adjustable while running.
 *
 * A token bucket whose balance may go negative, so each of the eight workers
 * borrows what it needs and sleeps off exactly its own share of the debt.
 */
class RateLimiter(private val clock: () -> Long = System::nanoTime) {
  /** Bytes per second; zero means no limit. */
  private val limit = AtomicLong(0)
  private val lock = Any()
  private var tokens = 0.0
  private var last = clock()

  /** Set the ceiling in bytes per second, or 0 to remove it. */
  fun set(bytesPerSecond: Long) {
    val previous = limit.getAndSet(bytesPerSecond)
    if (previous == 0L && bytesPerSecond > 0) {
      // Coming from unlimited, the bucket holds a stale timestamp; without a
      // reset the first chunk would be credited with every idle second.
      synchronized(lock) {
        tokens = bytesPerSecond * BURST_SECONDS
        last = clock()
      }
    }
  }

  /** Wait until `bytes` may be spent. */
  suspend fun take(bytes: Long) {
    val rate = limit.get().toDouble()
    if (rate == 0.0) return
    val wait = synchronized(lock) {
      val now = clock()
      val elapsed = (now - last) / 1e9
      last = now
      tokens = minOf(tokens + elapsed * rate, rate * BURST_SECONDS)
      val owed = bytes - tokens
      tokens -= bytes
      if (owed > 0) owed / rate else 0.0
    }
    if (wait > 0) delay((wait * 1000).toLong())
  }

  companion object {
    /** How much unspent allowance can accumulate, in seconds of it. */
    const val BURST_SECONDS = 1.0
  }
}
