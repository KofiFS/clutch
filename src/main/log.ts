import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 2 * 1024 * 1024
const KEEP = 3
let dir = ''
let file = ''

/** Where the log files live (Help → Open log folder). */
export function logDir(): string {
  return dir || path.join(app.getPath('userData'), 'logs')
}

/**
 * Plain-text log in the data folder, kept across restarts: clutch.log plus a few rotated copies.
 * The activity feed in the app only lives in memory, so without this a problem that happened an
 * hour ago leaves no trace.
 */
export function initLog() {
  dir = logDir()
  fs.mkdirSync(dir, { recursive: true })
  file = path.join(dir, 'clutch.log')
  rotateIfBig()
}

function rotateIfBig() {
  let size = 0
  try { size = fs.statSync(file).size } catch { return }
  if (size < MAX_BYTES) return
  for (let i = KEEP - 1; i >= 1; i--) {
    try { fs.renameSync(path.join(dir, `clutch.${i}.log`), path.join(dir, `clutch.${i + 1}.log`)) } catch { /* no such file */ }
  }
  try { fs.renameSync(file, path.join(dir, 'clutch.1.log')) } catch { /* in use: keep appending */ }
}

let lines = 0
export function logLine(kind: string, message: string) {
  if (!file) return
  const line = `${new Date().toISOString()} [${kind}] ${message.replace(/\r?\n/g, ' | ')}\n`
  try { fs.appendFileSync(file, line) } catch { /* disk full or folder gone: nothing to do */ }
  if (++lines % 200 === 0) rotateIfBig()
}
