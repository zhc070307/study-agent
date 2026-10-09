import type { Context } from '../vendor/deepseek-harness/vendor/cordis/src/index.ts'
import { createUserMessage } from '../vendor/deepseek-harness/packages/llm/llm/src/index.ts'
import type { ContextFormed } from '../vendor/deepseek-harness/packages/llm/llm/src/index.ts'
import { defineTool } from '../vendor/deepseek-harness/packages/core/tools/src/index.ts'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

declare module '../vendor/deepseek-harness/packages/llm/llm/src/index.ts' {
  interface MessageSourceMap { 'study': { kind: 'study' } & ContextFormed }
}

export const name = 'study'
export const inject = ['tools', 'systemPrompt']
export interface Config { data: string; python?: string }

const worker = fileURLToPath(new URL('./worker.py', import.meta.url))

export function apply(ctx: Context, config: Config) {
  if (!config.data?.trim()) throw new Error('Study data directory is required')
  const python = config.python ?? 'python3'

  async function call(action: string, args: object, id: string, signal?: AbortSignal) {
    // execFile provides cancellation and timeout; Python owns ledger transactions.
    return new Promise<any>((resolve, reject) => {
      const child = execFile(python, [worker, config.data], {
        signal, timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      }, (error, stdout, stderr) => {
        if (signal?.aborted) { reject(signal.reason ?? new Error('Cancelled')); return }
        try {
          const message = JSON.parse(stdout)
          if (!message.ok) { reject(new Error(message.error)); return }
          if (error) { reject(error); return }
          resolve(message.result)
        } catch (failure) { reject(error ?? new Error(stderr || String(failure))) }
      })
      child.stdin!.on('error', () => {}) // Process failure is reported by the callback.
      child.stdin!.end(JSON.stringify({ action, args, id }))
    })
  }

  const output = {
    schema: { type: 'object' as const, additionalProperties: true },
    render: (_args: object, value: object) => [{ type: 'text' as const, text: JSON.stringify(value) }],
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'study_read', description: '读取学习进度、课程事实与核对版本、作答与错点历史、长期约定或流程实现。context=true 获取完整当前上下文；day 可指定日期。',
    parameters: { course: { type: 'string' }, run: { type: 'string' }, day: { type: 'string' }, context: { type: 'boolean' }, calendar: { type: 'boolean' } }, output,
    async execute(args, exec) {
      return call('read', { ...args, session: exec.agent?.session.id }, '', exec.signal)
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'study_work',
    description: '开始或继续学习流程。先读取可执行操作，选择所需操作并保存真实输入和结果；出卷不代表学生已作答。switch 只在用户要求改变正在执行的流程时使用。',
    parameters: {
      action: { type: 'string', enum: ['start', 'advance', 'switch'], required: true },
      input: { type: 'string', required: true, description: 'JSON 对象。start: flow,course(课程流程需要),name；全局 daily/memory 无需课程。处理器字段见 study_read 返回的 implementation 和 operations 文件；advance: run,step,input；switch: run,reason。' },
    }, output,
    async execute(args, exec) {
      const input = JSON.parse(args.input)
      if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('步骤输入必须是对象')
      return call(args.action, { ...input, session: exec.agent?.session.id },
        `${exec.agent?.session.id ?? 'direct'}:${exec.callId}`, exec.signal)
    },
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'study_change',
    description: '根据用户要求修改实际流程。preview 保存并验证修改，apply 采用通过验证的版本，rollback 恢复上个版本。范围可为一门课程或通用流程；已运行的记录不会自动改写。handler 可增加执行代码，必须带输入和预期结果 tests。',
    parameters: {
      action: { type: 'string', enum: ['preview', 'apply', 'rollback'], required: true },
      input: { type: 'string', required: true, description: 'JSON 对象：flow,course(可选)。preview: reason,definition；apply: version,expected；rollback: expected。definition 包含 title 和 steps，每步有 id,kind,instructions，after 只声明模型操作所需的真实证据依赖；列表顺序不构成依赖；可加 handler Python 代码 run(input,context) 与 tests。' },
    }, output,
    async execute(args, exec) {
      const input = JSON.parse(args.input)
      if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('流程修改必须是对象')
      return call('change', { ...input, action: args.action },
        `${exec.agent?.session.id ?? 'direct'}:${exec.callId}`, exec.signal)
    },
  })))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'study', order: 0, interpolate: false,
    text: '你是学习助手。说话简洁自然，先看材料和学生要求，再决定怎样帮助学习。使用 study 工具读取、执行和修改实际流程；不知道的事实保持未知，不从文件名推断材料类型。读笔记与练习由用户自主安排，不能默认两者有先后，不自动添加用户任务依赖。流程约束模型保存依据与核对事实。用户只需表达学习要求，不让用户填写流程配置、版本或核验字段。技术记录留在工具内部，向用户说明学习上的改变与下一步。修改流程须依据用户要求，验证失败先修正；保留原始作答，不把讲解、笔记或发卷当作掌握。',
  }))
  const supplied = new Map<string, string>()
  ctx.effect(() => () => supplied.clear())
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = await call('read', { session: agent.session.id }, '', signal)
    const context = { pending: state.pending ?? [], memory: state.memory?.content ?? '', recovery: state.recovery_warnings ?? [] }
    if (!context.pending.length && !context.memory && !context.recovery.length) return decision
    const content = JSON.stringify(context)
    if (supplied.get(agent.session.id) === content) return decision
    supplied.set(agent.session.id, content)
    return { ...decision, messages: [...decision.messages, createUserMessage({
      source: { kind: 'study' },
      content: [{ type: 'text', text: `当前学习流程（内部上下文）：${content}` }],
    })] }
  })
}
