// Executed from the upstream testkit directory by harness/check.sh.
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '../src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as Study from '../../../../../../harness/study.ts'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'

const project = process.env.STUDY_PROJECT!
function read(root: string, args: object) {
  return JSON.parse(execFileSync('python3', [join(project, 'harness/worker.py'), root], {
    input: JSON.stringify({ action: 'read', args }), encoding: 'utf8', timeout: 5000,
  })).result
}
function sql(root: string, expression: string) {
  return JSON.parse(execFileSync('python3', ['-c', `import sqlite3,json,sys
c=sqlite3.connect(sys.argv[1]); c.row_factory=sqlite3.Row
print(json.dumps(${expression})); c.close()`, join(root, '.study-system/data/task_memory.sqlite3')], { encoding: 'utf8' }))
}
async function mount(root: string, adapter: MockAdapter) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { tools: { mode: 'native' } })
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, '.sessions') })
  const bridge = ctx.plugin(Study, { data: root })
  await bridge
  ctx.llm.registerAdapter(['mock'], adapter)
  await mountAgentLoopTestHarness(ctx)
  return { ctx, bridge }
}
async function turn(ctx: Context, agent: Agent) {
  const idle = new Promise<void>((resolve) => {
    const dispose = ctx.on('agent/status', event => {
      if (event.agent === agent && event.status === 'idle') { dispose(); resolve() }
    })
  })
  agent.followup(createUserMessage({ content: [{ type: 'text', text: '根据我的要求继续学习' }], source: { kind: 'user' } }))
  await idle
}
function work(id: string, action: string, input: object) {
  return toolCallResponse(id, 'study_work', { action, input: JSON.stringify(input) })
}
function change(id: string, action: string, input: object) {
  return toolCallResponse(id, 'study_change', { action, input: JSON.stringify(input) })
}

it('real loop restores learning progress and uses a model-requested course change without losing evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-loop-'))
  const contexts: Context[] = []
  try {
    const first = await mount(root, new MockAdapter([
      work('start', 'start', { course: 'DEMO', flow: 'material' }),
      () => {
        execFileSync('python3', ['-c', 'from pathlib import Path;import sys;Path(sys.argv[1]).write_text("Actual lecture content")', join(root, 'DEMO/lecture.txt')])
        const state = read(root, { course: 'DEMO' })
        return work('inspect', 'advance', { run: state.runs[0].id, step: 'inspect',
          input: { event: state.materials[0].id, kind: 'transcript', summary: 'Read actual lecture contents', session: 'lesson-a' } })
      }, textResponse('已检查，等待下一步。'),
    ]))
    contexts.push(first.ctx)
    const handle = await first.ctx.agents.create({ sessionId: SessionId('study-demo'), agentOptions: { provider: 'mock', model: 'mock' } })
    await turn(first.ctx, handle.agent)
    const original = read(root, { course: 'DEMO' }).runs[0]
    expect(original.next.id).toBe('handoff')
    expect(original.history).toHaveLength(1)
    await handle.dispose()
    await first.ctx.fiber.dispose()

    const adapter = new MockAdapter([
      () => {
        const state = read(root, { course: 'DEMO' })
        const definition = structuredClone(state.flows.material.definition)
        definition.steps.find((step: { id: string }) => step.id === 'handoff').instructions = '用户自主安排阅读与练习，本次只接续实际需要的练习；不创建阅读前置条件。'
        return change('preview', 'preview', { flow: 'material', course: 'DEMO', reason: 'User requests autonomous learning order and reuse of existing notes', definition })
      },
      () => {
        const candidate = sql(root, "dict(c.execute('SELECT * FROM flow_versions WHERE parent IS NOT NULL ORDER BY rowid DESC LIMIT 1').fetchone())")
        return change('apply', 'apply', { flow: 'material', course: 'DEMO', version: candidate.id, expected: candidate.parent })
      },
      () => work('switch', 'switch', { run: original.id, reason: 'User applies change to this run' }),
      () => work('practice', 'advance', { run: original.id, step: 'handoff', input: { reason: 'User chooses independent practice with existing notes', tasks: [{ title: '独立练习', description: 'Answer the real questions independently' }] } }),
      textResponse('已接续独立练习。'),
    ])
    const second = await mount(root, adapter)
    contexts.push(second.ctx)
    const resumed = await second.ctx.agents.resume({ resumeSessionId: SessionId('study-demo'), agentOptions: { provider: 'mock', model: 'mock' } })
    expect(JSON.stringify(resumed.agent.session.snapshotEvents())).toContain('已检查')
    await turn(second.ctx, resumed.agent)
    const state = read(root, { course: 'DEMO' })
    expect(state.tasks.map((task: { title: string }) => task.title)).toEqual(['独立练习'])
    expect(state.tasks[0].status).toBe('open')
    expect(state.runs[0].history[0]).toEqual(original.history[0])
    expect(state.runs[0].version).not.toBe(original.version)
    expect(JSON.stringify(adapter.requests.at(-1))).toContain('receipt')
    await second.bridge.dispose()
    const removed = await second.ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('unloaded'), name: 'study_read', arguments: {} })
    expect(removed.isError).toBe(true)
  } finally {
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 20000)

it('model tool calls validate, activate and execute new handler code', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-handler-loop-'))
  let ctx: Context | undefined
  try {
    const adapter = new MockAdapter([
      change('code-preview', 'preview', { flow: 'material', reason: 'User wants practice load adapted to available time',
        definition: { title: 'Adapted practice', steps: [{ id: 'load', kind: 'custom', instructions: 'Adapt question count',
          handler: 'def run(inputs, context):\n return {"questions": min(inputs["requested"], inputs["available"])}',
          tests: [{ input: { requested: 6, available: 3 }, expected: { questions: 3 } }] }] } }),
      () => {
        const candidate = sql(root, "dict(c.execute('SELECT * FROM flow_versions WHERE parent IS NOT NULL ORDER BY rowid DESC LIMIT 1').fetchone())")
        return change('code-apply', 'apply', { flow: 'material', version: candidate.id, expected: candidate.parent })
      },
      work('code-start', 'start', { course: 'DEMO', flow: 'material' }),
      () => work('code-execute', 'advance', { run: read(root, { course: 'DEMO' }).runs[0].id, step: 'load', input: { requested: 8, available: 2 } }),
      textResponse('根据可用时间安排两题。'),
    ])
    const mounted = await mount(root, adapter)
    ctx = mounted.ctx
    const handle = await ctx.agents.create({ sessionId: SessionId('code-demo'), agentOptions: { provider: 'mock', model: 'mock' } })
    await turn(ctx, handle.agent)
    const run = read(root, { course: 'DEMO' }).runs[0]
    expect(run.history[0].result).toEqual({ questions: 2 })
    expect(run.status).toBe('completed')
    expect(JSON.stringify(handle.agent.session.snapshotEvents())).toContain('questions')
  } finally {
    await ctx?.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 20000)
