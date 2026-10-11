// A stateless scripted adapter: a new process must get old history from the Harness.
import type { Context } from '../../runtime/foundation/cordis/src/index.ts'
import { MockAdapter, textResponse } from '../../runtime/modules/core/agent-loop/tests/mock-adapter.ts'
import type { GenerateOptions } from '../../runtime/modules/llm/llm/src/index.ts'
export const name = 'study-restart-model'
export const inject = ['llm']
function requestOf(options: GenerateOptions) {
  const users = options.messages.filter(message => message.role === 'user')
  const last = users.at(-1)?.content.find(block => block.type === 'text')
  if (last?.type !== 'text') throw new Error('Missing question')
  const envelope = JSON.parse(last.text)
  return JSON.parse(envelope['用户要求'] ?? last.text)
}
function reply(options: GenerateOptions) {
  const request = requestOf(options)
  if (request.expectModel && options.model !== request.expectModel) throw new Error('Old model settings used')
  if (request.remember) return textResponse('已记住代号：' + request.remember)
  if (request.continue) {
    const history = JSON.stringify(options.messages.slice(0, -1))
    if (!history.includes(request.continue) || !history.includes('已记住代号')) throw new Error('Persisted conversation not restored')
    return textResponse('已恢复历史：' + request.continue + '；当前模型：' + options.model)
  }
  throw new Error('Unknown test request')
}
class RestartAdapter extends MockAdapter {
  override async *stream(options: GenerateOptions) {
    if (requestOf(options).wait) {
      yield { type: 'block-start' as const, index: 0, blockType: 'text' as const }
      yield { type: 'text-delta' as const, index: 0, text: '正在等待停止测试…' }
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error('aborted')); return }
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      return
    }
    yield* super.stream(options)
  }
}
export function apply(ctx: Context) {
  ctx.llm.registerAdapter(['study-restart-test'], new RestartAdapter(Array.from({ length: 25 }, () => reply)))
}
