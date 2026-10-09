import type { Context } from '../vendor/deepseek-harness/vendor/cordis/src/index.ts'
import { createUserMessage } from '../vendor/deepseek-harness/packages/llm/llm/src/index.ts'
import type { ContextFormed } from '../vendor/deepseek-harness/packages/llm/llm/src/index.ts'
import { defineTool } from '../vendor/deepseek-harness/packages/core/tools/src/index.ts'
import { assertImageCapableRoute } from '../vendor/deepseek-harness/packages/fs/tool-fs/src/read-image.ts'
import { admitEncodedImages } from '../vendor/deepseek-harness/packages/attachment/attachment/src/index.ts'
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

  async function call(action: string, args: object, id: string, signal?: AbortSignal, desktop = false) {
    // execFile provides cancellation and timeout; Python owns ledger transactions.
    return new Promise<any>((resolve, reject) => {
      const child = execFile(python, [desktop ? fileURLToPath(new URL('./workspace.py', import.meta.url)) : worker, config.data], {
        signal, timeout: desktop ? 120000 : 15000, maxBuffer: desktop ? 32 * 1024 * 1024 : 1024 * 1024, encoding: 'utf8',
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
  ctx.inject(['attachments', 'llm'], (ctx) => {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'study_desktop',
    description: '读取与操作用户的真实桌面。list/read 获取文件身份与原文（PDF 提取含分页文本）；create 保存文件（kind=practice 可显示作答框，sources 记录真实题源）；write/restore 必须带当前 sha256 的 expected；folder 建文件夹；metadata 移动/重命名需 list 的 version 作 expected。publish 根据已读内容将文件显式关联到已注册 course 的 path（课程内相对位置），必须说明 reason；原材料扫描和回执使用此真实课程文件。课程文件在桌面之外被修改时保留两份并报告冲突。task 建学生任务，无默认前后依赖；不自动勾选或登记掌握。compile 编译 .tex，expected 为源码哈希，正式学习交付关联写作前已保存的 preparation；assets 为明确附件 {file,path}；失败返回日志并保留上版 PDF。page 传 PDF file/page 返回实际页面图像；逐页阅读图像并核对来源后 review，编译成功不是验收。正式笔记/练习须先 prepare(course,kind,brief) 保存真实草案，create 带返回的 preparation 身份；review 还须 kind=note/worksheet、course、brief，并遵守 study_read 返回的原交付标准。history/restore 可恢复文件。',
    parameters: {
      action: { type: 'string', enum: ['list','read','prepare','publish','create','write','restore','folder','metadata','task','compile','page','review','history'], required: true },
      input: { type: 'string', required: true, description: 'JSON 对象。文件操作使用 file 身份；create: name,text,mime,folder(可选),kind,sources；write:file,text,expected；compile:file,expected,assets(可选)。page:file,page。review:file,sha256,pages:[{page,status:passed,summary:具体核验}],checks:{source_scope,layout,...原交付核验}。源码或 PDF 变化会拒绝旧核验。task:title,file(可选),course(已注册可选)。操作实现位于 harness/workspace.py，可通过 shell 查阅。' },
    },
    output: {
      schema: { type: 'object' as const, additionalProperties: true },
      render: (_args: object, value: any) => {
        const { images, ...record } = value
        return [{ type: 'text' as const, text: JSON.stringify(record) },
          ...(images ?? []).map((img: any) => ({ type: 'image' as const, attachment: img }))]
      },
    },
    async execute(args, exec) {
      const input = JSON.parse(args.input)
      if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('桌面输入必须是对象')
      if (args.action === 'page' || args.action === 'review') await assertImageCapableRoute(ctx, exec, 'PDF 页面')
      const result = await call(args.action, {...input, session: exec.agent?.session.id}, `${exec.agent?.session.id ?? 'direct'}:${exec.callId}`, exec.signal, true)
      if (result.images) {
        await assertImageCapableRoute(ctx, exec, '桌面图像')
        if (!ctx.get('attachments')) throw new Error('页面图像服务不可用')
        result.images = await admitEncodedImages(ctx.attachments, result.images.map((img: any) => ({data: img.data, mediaType: img.mimeType})))
      }
      return result
    },
  })))
  })
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'desktop', order: 1, interpolate: false,
    text: '桌面文件由 study_desktop 与网页共同保存。用户关联的是文件身份和当前哈希，必须 read 实际内容；选区与作答是用户提供的原文，不替代完整题目。生成练习须依据已读材料，不使用固定示例充当真实出题；结果必须 create/write 保存，不能只在回复声称完成。修改 LaTeX 后 compile，再逐页 page 看实际图像，核对来源和版式后才 review；失败先根据日志修正。原 study-notes/study-worksheets 的内容与交付质量要求仍适用；历史 pi/Codex 本机分工在此由当前助理负责写作、编译与核验，不要求用户安装本机工具，也不因文档类型强制用户阅读或练习顺序。任务完成、模型批改、知识掌握仍需现有 study 服务的真实证据；桌面勾选仅是学生确认完成。',
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
