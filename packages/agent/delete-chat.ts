// Use the adopted persistence backend's exact path encoding, including Windows paths.
// The owner must shut down the SDK before invoking this helper.
import { rm, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { sessionDir } from '../runtime/modules/session/session-persistence-jsonl/src/format.ts'
import { SessionWriteLease } from '../runtime/modules/session/session-persistence-jsonl/src/lease.ts'
import type { SessionId } from '../runtime/modules/core/session/src/types.ts'

const [, , directory, channel] = process.argv
if (!directory || !channel) throw new Error('Missing conversation identity')
const cwd = resolve(directory)
const id = ('desktop-' + channel) as SessionId
const directoryPath = sessionDir(join(cwd, '.harness', 'sessions'), cwd, id)
const exists = await stat(directoryPath).catch(error => { if (error.code === 'ENOENT') return null; throw error })
if (exists) {
  const lease = await SessionWriteLease.acquire(directoryPath, id)
  try { await rm(directoryPath, { recursive: true, force: true }) }
  finally { await lease.release() }
}
