import { config } from './config.mjs'
import { counters } from './db.mjs'

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Takes one AI call from the user's daily allowance and from the server-wide daily cap, atomically.
 * Returns null when either is used up. `release()` hands the slot back when the request fails
 * before it cost anything (bad input).
 */
export function takeAiSlot(kind, userId, limit) {
  const day = today()
  const userKey = `${kind}:${userId}:${day}`
  const globalKey = `ai-total:${day}`
  if (!counters.take(userKey, limit)) return null
  if (!counters.take(globalKey, config.aiDailyCap)) {
    counters.give(userKey)
    return null
  }
  let released = false
  return {
    left: Math.max(0, limit - counters.used(userKey)),
    release() {
      if (released) return
      released = true
      counters.give(userKey)
      counters.give(globalKey)
    }
  }
}
