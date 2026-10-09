// Test-only adapter mounted into the actual trimmed SDK profile.
import type { Context } from '../../../vendor/deepseek-harness/vendor/cordis/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../vendor/deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
export const name = 'study-test-model'
export const inject = ['llm']
export function apply(ctx: Context) {
  ctx.llm.registerAdapter(['study-test'], new MockAdapter([
    options => {
      const names = options.tools?.map(tool => tool.name) ?? []
      if (!['study_read', 'study_work', 'study_change'].every(name => names.includes(name))) {
        throw new Error('Study tools were not mounted in the actual profile')
      }
      return toolCallResponse('profile-start', 'study_work', { action: 'start', input: JSON.stringify({ course: 'DEMO', flow: 'feedback' }) })
    },
    toolCallResponse('profile-read', 'study_read', { course: 'DEMO' }),
    textResponse('学习流程已经开始。'),
  ]))
}
