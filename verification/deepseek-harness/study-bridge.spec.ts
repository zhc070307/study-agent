// Temporary feasibility probe, not the proposed production workflow engine.
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'

const source = process.env.STUDY_SOURCE
if (!source) throw new Error('Set STUDY_SOURCE to packages/learning/src')

function python(database: string, body: string): string {
  return execFileSync('python3', ['-c', body, database], {
    encoding: 'utf8', env: { ...process.env, PYTHONPATH: source }, timeout: 5000,
  }).trim()
}

async function mount(root: string, database: string, stage: 'note' | 'practice') {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(JsonlSessionPersistence, { root })
  const adapter = new MockAdapter([
    toolCallResponse(`call-${stage}`, 'study_next', {}), textResponse(`saved ${stage}`),
  ])
  ctx.llm.registerAdapter(['mock'], adapter)
  const bridge = ctx.plugin({ name: 'study-probe', inject: ['tools'], apply(owner: Context) {
    owner.effect(() => owner.tools.register(defineTool({
      name: 'study_next', description: 'Save the next learning task.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(_args, exec) {
        if (exec.signal.aborted) throw new Error('cancelled')
        return python(database, `import sys
from study_agent import db
from study_agent.service import TaskService
c=db.connect(sys.argv[1])
try:
 t=TaskService(c).create_task('${stage}', course='DEMO101', status='open')
 print(t.task_key + ':${stage}')
finally:
 c.close()
`)
      },
    })))
  } })
  await bridge
  await mountAgentLoopTestHarness(ctx)
  return { ctx, adapter, bridge }
}

async function turn(ctx: Context, agent: Agent) {
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', event => {
      if (event.agent === agent && event.status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue learning' }], source: { kind: 'user' } }))
  await idle
}

it('saves real Python tasks, resumes history, applies a changed plugin and denies unevidenced completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-bridge-'))
  const database = join(root, 'study.sqlite3')
  const contexts: Context[] = []
  try {
    python(database, `import sys
from study_agent import db
from study_agent.service import TaskService
c=db.initialize(sys.argv[1])
TaskService(c).add_course('DEMO101','Example course')
c.close()
`)
    const first = await mount(join(root, 'sessions'), database, 'note')
    contexts.push(first.ctx)
    const handle = await first.ctx.agents.create({
      sessionId: SessionId('study-demo'), agentOptions: { provider: 'mock', model: 'mock' },
    })
    await turn(first.ctx, handle.agent)
    expect(JSON.stringify(handle.agent.session.snapshotEvents())).toContain('T-000001:note')
    await handle.dispose()
    await first.ctx.fiber.dispose()

    const second = await mount(join(root, 'sessions'), database, 'practice')
    contexts.push(second.ctx)
    const resumed = await second.ctx.agents.resume({
      resumeSessionId: SessionId('study-demo'), agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(JSON.stringify(resumed.agent.session.snapshotEvents())).toContain('T-000001:note')
    await turn(second.ctx, resumed.agent)
    const events = resumed.agent.session.snapshotEvents()
    expect(JSON.stringify(events)).toContain('T-000002:practice')
    expect(events.map(event => event.seq)).toEqual(events.map((_, i) => i))
    expect(python(database, `import sys
from study_agent import db
from study_agent.service import TaskService
from study_agent.errors import ValidationError
c=db.connect(sys.argv[1]); s=TaskService(c)
print(','.join(t.title for t in s.list_tasks()))
try:
 s.complete('T-000002')
 raise AssertionError('unexpected completion')
except ValidationError as error:
 assert 'evidence entry is required' in str(error)
 print(type(error).__name__)
assert s.get_task('T-000002').status == 'open'
c.close()
`)).toMatch(/note,practice\n.*Error/)
    await second.bridge.dispose()
    const removed = await second.ctx.tools.execute({
      signal: new AbortController().signal, callId: ToolCallId('after-unload'), name: 'study_next', arguments: {},
    })
    expect(removed.isError).toBe(true)
  } finally {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 15000)
