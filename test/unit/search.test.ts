// Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ClipSearch, parseQuery, tokenize, type SearchDoc } from '../../src/main/library/search.ts'

const NOW = Date.parse('2026-11-18T15:00:00')
const day = (n: number) => new Date(NOW - n * 86400_000).toISOString()
const doc = (id: string, title: string, game: string, extra: Partial<SearchDoc> = {}): SearchDoc => ({ id, title, game, tags: [], trigger: 'hotkey', createdAt: day(1), durationSec: 20, favorite: false, ...extra })

const clips = [
  doc('mc1', 'Creeper blew up my house', 'Minecraft', { tags: ['funny'], createdAt: day(0) }),
  doc('mc2', 'Ender dragon down', 'Minecraft', { event: 'Boss kill', createdAt: day(10) }),
  doc('val1', 'ACE on Haven', 'VALORANT', { tags: ['clutch'], favorite: true, createdAt: day(2) }),
  doc('val2', '1v4 clutch retake', 'VALORANT', { createdAt: day(40), durationSec: 90 }),
  doc('fn1', 'Victory Royale', 'Fortnite', { trigger: 'voice', createdAt: day(1) }),
  doc('cod1', 'Triple headshot', 'Call of Duty: Warzone', { createdAt: day(3) }),
  doc('acc', 'Clútch Pókemon moment', 'Pokémon Legends', { createdAt: day(5) })
]
const s = new ClipSearch(clips)
const ids = (q: string) => s.search(q, NOW).map((r) => r.id)

test('not case sensitive', () => {
  assert.deepEqual(ids('VALORANT').sort(), ['val1', 'val2'])
  assert.deepEqual(ids('valorant').sort(), ['val1', 'val2'])
  assert.deepEqual(ids('vAlOrAnT').sort(), ['val1', 'val2'])
})

test('accents are ignored', () => {
  assert.ok(ids('pokemon').includes('acc'))
  assert.ok(ids('clutch').includes('acc'))
})

test('forgives typos', () => {
  assert.ok(ids('minecraf').includes('mc1'), 'missing letter')
  assert.ok(ids('mincraft').includes('mc1'), 'dropped letter')
  assert.ok(ids('valroant').includes('val1'), 'swapped letters')
})

test('prefixes match while typing', () => {
  assert.ok(ids('mine').includes('mc1'))
  assert.ok(ids('fortn').includes('fn1'))
})

test('related words and game nicknames', () => {
  assert.ok(ids('win').includes('fn1'), 'win -> victory')
  assert.ok(ids('cod').includes('cod1'), 'cod -> call of duty')
  assert.ok(ids('mc').includes('mc2'), 'mc -> minecraft')
  assert.ok(ids('sniper').includes('cod1'), 'sniper -> headshot')
})

test('all words must match', () => {
  assert.deepEqual(ids('clutch valorant').sort(), ['val1', 'val2'])
  assert.deepEqual(ids('creeper valorant'), [])
})

test('plain-English filters', () => {
  assert.deepEqual(ids('minecraft today'), ['mc1'])
  assert.deepEqual(ids('favorites'), ['val1'])
  assert.deepEqual(ids('valorant last week'), ['val1'])
  assert.deepEqual(ids('long valorant'), ['val2'])
  assert.deepEqual(ids('voice clips'), ['fn1'])
})

test('best match comes first', () => {
  assert.equal(ids('clutch')[0], 'val2', 'title beats tag')
})

test('parser keeps search words and drops filler', () => {
  assert.deepEqual(parseQuery('show me funny clips from minecraft', NOW).terms, ['funny', 'minecraft'])
  assert.deepEqual(tokenize('Call of Duty: Warzone'), ['call', 'of', 'duty', 'warzone'])
})

test('a few thousand clips search fast', () => {
  const many = Array.from({ length: 5000 }, (_, i) => doc(`x${i}`, `Clip number ${i} ${i % 7 ? 'run' : 'boss fight'}`, ['Minecraft', 'Valorant', 'Fortnite', 'Apex Legends'][i % 4]))
  const big = new ClipSearch(many)
  const t = performance.now()
  const r = big.search('bos minecraft', NOW)
  const ms = performance.now() - t
  assert.ok(r.length > 0)
  assert.ok(ms < 250, `took ${ms.toFixed(0)} ms`)
})
