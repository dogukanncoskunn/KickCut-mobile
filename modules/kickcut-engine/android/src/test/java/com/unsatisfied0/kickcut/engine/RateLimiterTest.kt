package com.unsatisfied0.kickcut.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Test

/** Ported one for one from `src-tauri/src/rate.rs`. Real clock, as there. */
class RateLimiterTest {
  private fun ms(since: Long) = (System.nanoTime() - since) / 1_000_000

  @Test fun no_limit_means_no_waiting() = runBlocking {
    val limiter = RateLimiter()
    val started = System.nanoTime()
    repeat(50) { limiter.take(1_000_000) }
    assertTrue(ms(started) < 50)
  }

  @Test fun spending_the_burst_is_free_and_the_rest_is_paced() = runBlocking {
    val limiter = RateLimiter()
    limiter.set(1_000_000)
    var started = System.nanoTime()
    limiter.take(1_000_000)
    assertTrue("burst should be free", ms(started) < 100)
    started = System.nanoTime()
    limiter.take(1_000_000)
    val waited = ms(started)
    assertTrue("waited only $waited", waited > 700)
    assertTrue("waited $waited", waited < 1600)
  }

  /** Eight workers sharing one ceiling. */
  @Test fun concurrent_workers_share_one_ceiling() = runBlocking {
    val limiter = RateLimiter()
    limiter.set(2_000_000)
    val started = System.nanoTime()
    val workers = (0 until 8).map { launch(Dispatchers.Default) { repeat(2) { limiter.take(250_000) } } }
    workers.forEach { it.join() }
    val waited = ms(started)
    assertTrue("too fast: $waited", waited > 800)
    assertTrue("too slow: $waited", waited < 1600)
  }

  @Test fun turning_a_limit_on_does_not_credit_idle_time() = runBlocking {
    val limiter = RateLimiter()
    limiter.take(10)
    delay(300)
    limiter.set(1_000_000)
    limiter.take(1_000_000)
    val started = System.nanoTime()
    limiter.take(500_000)
    assertTrue("idle time was credited: ${ms(started)}", ms(started) > 300)
  }
}
