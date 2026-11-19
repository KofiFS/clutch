/**
 * Clip search that runs entirely on this PC: no AI keys, no servers, nothing leaves the machine.
 * It works like a small search engine (Elasticsearch-style), tuned for clip titles:
 *
 *  - case- and accent-insensitive ("CLUTCH", "clutch" and "clútch" match)
 *  - typo tolerant ("minecraf", "mincraft", "valornat" still find the game)
 *  - prefix matching while typing ("mine" finds Minecraft)
 *  - related words ("kill" also finds "elimination", "frag", "ace")
 *  - plain-English filters: "today", "yesterday", "last week", "this month", "favorites",
 *    "long" / "short", "voice" / "hype" / "manual" clips, "from <game>"
 *  - ranked by relevance (BM25 with field weights), newest first on ties
 *
 * Pure functions, no Electron: testable with plain Node.
 */

export interface SearchDoc {
  id: string
  title: string
  game: string
  event?: string
  tags: string[]
  trigger: string
  createdAt: string
  durationSec: number
  favorite: boolean
}

export interface ParsedQuery {
  terms: string[]
  since?: number
  until?: number
  favorite?: boolean
  minSec?: number
  maxSec?: number
  trigger?: string
}

const FIELDS = { title: 3, game: 2.2, tags: 2, event: 1.6, trigger: 0.8 } as const
type Field = keyof typeof FIELDS

/** Words that mean the same thing in clips. Each group expands to all of its members. */
const SYNONYMS: string[][] = [
  ['kill', 'kills', 'elim', 'elimination', 'eliminations', 'frag', 'frags', 'knock', 'down', 'downed'],
  ['ace', 'wipe', 'teamwipe', 'squadwipe', 'multikill', 'multi', 'triple', 'quad', 'penta'],
  ['win', 'won', 'victory', 'winner', 'dub', 'chicken', 'royale'],
  ['clutch', 'comeback', 'save', 'saved', '1v3', '1v4', '1v5'],
  ['funny', 'lol', 'lmao', 'fail', 'fails', 'troll', 'meme', 'hilarious', 'laugh'],
  ['boss', 'bossfight', 'raid', 'miniboss'],
  ['snipe', 'sniper', 'headshot', 'hs', 'noscope', 'quickscope', 'flick'],
  ['death', 'died', 'dead', 'die', 'killed'],
  ['build', 'building', 'base', 'house'],
  ['speedrun', 'speed', 'pb', 'record', 'wr'],
  ['montage', 'highlights', 'highlight', 'best'],
  ['voice', 'voicechat', 'vc', 'discord', 'friends', 'squad']
]
/** Common short names for games. */
const ALIASES: Record<string, string[]> = {
  mc: ['minecraft'], cod: ['call', 'duty', 'warzone'], wz: ['warzone'], val: ['valorant'], lol: ['league', 'legends'],
  cs: ['counter', 'strike', 'cs2'], csgo: ['counter', 'strike', 'cs2'], ow: ['overwatch'], apex: ['apex', 'legends'],
  fn: ['fortnite'], gta: ['grand', 'theft', 'auto'], r6: ['rainbow', 'siege'], rl: ['rocket', 'league'], pubg: ['battlegrounds', 'pubg'],
  tf2: ['team', 'fortress'], botw: ['zelda'], totk: ['zelda'], bg3: ['baldur'], elden: ['elden', 'ring'], dbd: ['dead', 'daylight']
}
const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'my', 'me', 'i', 'and', 'or', 'with', 'clip', 'clips', 'video', 'videos', 'show', 'find', 'that', 'where', 'when', 'was', 'were', 'is', 'it', 'all', 'some', 'for', 'from', 'by'])

const synonymOf = new Map<string, string[]>()
for (const g of SYNONYMS) for (const w of g) synonymOf.set(w, g)

/** Lowercase, strip accents, split on anything that isn't a letter or digit. */
export function tokenize(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

const DAY = 86400_000
function startOfDay(t: number) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Pulls plain-English filters out of the query; the rest are search terms. */
export function parseQuery(q: string, now = Date.now()): ParsedQuery {
  let s = ` ${q.toLowerCase()} `
  const out: ParsedQuery = { terms: [] }
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => { const m = s.match(re); if (m) { fn(m); s = s.replace(re, ' ') } }
  const today = startOfDay(now)
  take(/\btoday\b/, () => { out.since = today })
  take(/\byesterday\b/, () => { out.since = today - DAY; out.until = today })
  take(/\b(this|past|last)\s+week\b/, (m) => { out.since = m[1] === 'this' ? today - ((new Date(now).getDay() + 6) % 7) * DAY : now - 7 * DAY })
  take(/\b(this|past|last)\s+month\b/, (m) => { out.since = m[1] === 'this' ? new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime() : now - 30 * DAY })
  take(/\b(?:last|past)\s+(\d{1,3})\s+days?\b/, (m) => { out.since = now - Number(m[1]) * DAY })
  take(/\b(favou?rites?|favs?|starred|liked)\b/, () => { out.favorite = true })
  take(/\b(long|longer)\b/, () => { out.minSec = 60 })
  take(/\b(short|quick)\b/, () => { out.maxSec = 30 })
  take(/\b(voice|said|shouted)\s+(clips?|triggers?)\b/, () => { out.trigger = 'voice' })
  take(/\bhype\b/, () => { out.trigger = 'hype' })
  take(/\b(full|long)\s+recordings?\b/, () => { out.trigger = 'long'; out.minSec = undefined })
  out.terms = tokenize(s).filter((t) => !STOP.has(t))
  return out
}

/** Damerau-Levenshtein distance with an early exit above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const prev2 = new Array<number>(b.length + 1).fill(0)
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur.push(v)
      if (v < best) best = v
    }
    if (best > max) return max + 1
    for (let j = 0; j <= b.length; j++) prev2[j] = prev[j]
    prev = cur
  }
  return prev[b.length]
}

/** How well a query term matches an indexed word: 1 exact, less for prefix, synonym or typo; 0 none. */
function termMatch(q: string, w: string): number {
  if (q === w) return 1
  if (w.startsWith(q) && q.length >= 2) return 0.85 * Math.min(1, q.length / w.length + 0.35)
  const syn = synonymOf.get(q)
  if (syn && syn.includes(w)) return 0.7
  if (q.length >= 4) {
    const max = q.length >= 8 ? 2 : 1
    const d = editDistance(q, w.length > q.length + max ? w.slice(0, q.length + max) : w, max)
    if (d <= max) return 0.6 - 0.15 * (d - 1)
  }
  return 0
}

/** An index over clips, rebuilt when the library changes (fast: thousands of clips in a few ms). */
export class ClipSearch {
  private docs: { doc: SearchDoc; fields: Record<Field, string[]>; len: number }[] = []
  private vocab = new Map<string, number>() // word -> number of clips containing it
  private avgLen = 1

  constructor(docs: SearchDoc[]) {
    let total = 0
    for (const doc of docs) {
      const fields: Record<Field, string[]> = {
        title: tokenize(doc.title),
        game: tokenize(doc.game),
        tags: doc.tags.flatMap(tokenize),
        event: tokenize(doc.event ?? ''),
        trigger: tokenize(doc.trigger)
      }
      const len = Object.values(fields).reduce((n, f) => n + f.length, 0)
      total += len
      this.docs.push({ doc, fields, len })
      for (const w of new Set(Object.values(fields).flat())) this.vocab.set(w, (this.vocab.get(w) ?? 0) + 1)
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 1
  }

  /** Expands a query term to the indexed words it matches, with how well each one matches. */
  private expand(term: string): Map<string, number> {
    const out = new Map<string, number>()
    const terms = [term, ...(ALIASES[term] ?? [])]
    for (const t of terms) {
      for (const w of this.vocab.keys()) {
        const m = termMatch(t, w)
        if (m > (out.get(w) ?? 0)) out.set(w, t === term ? m : m * 0.9)
      }
    }
    return out
  }

  /** Clip ids, best match first. Every term must match something (AND), like a search engine. */
  search(query: string, now = Date.now()): { id: string; score: number }[] {
    const q = parseQuery(query, now)
    const N = this.docs.length || 1
    const expansions = q.terms.map((t) => this.expand(t))
    const k1 = 1.2
    const b = 0.6
    const results: { id: string; score: number; created: string }[] = []
    for (const { doc, fields, len } of this.docs) {
      const t = Date.parse(doc.createdAt)
      if (q.since !== undefined && t < q.since) continue
      if (q.until !== undefined && t >= q.until) continue
      if (q.favorite && !doc.favorite) continue
      if (q.minSec !== undefined && doc.durationSec < q.minSec) continue
      if (q.maxSec !== undefined && doc.durationSec > q.maxSec) continue
      if (q.trigger && doc.trigger !== q.trigger) continue
      let score = 0
      let matchedAll = true
      for (const exp of expansions) {
        let best = 0
        for (const [field, weight] of Object.entries(FIELDS) as [Field, number][]) {
          for (const w of fields[field]) {
            const m = exp.get(w)
            if (!m) continue
            const df = this.vocab.get(w) ?? 1
            const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
            const tf = 1
            const s = weight * m * idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / this.avgLen)))
            if (s > best) best = s
          }
        }
        if (!best) { matchedAll = false; break }
        score += best
      }
      if (!matchedAll) continue
      if (!expansions.length) score = 1 // filters only ("favorites from today")
      if (doc.favorite) score *= 1.05
      results.push({ id: doc.id, score, created: doc.createdAt })
    }
    return results.sort((x, y) => y.score - x.score || y.created.localeCompare(x.created)).map(({ id, score }) => ({ id, score }))
  }
}
