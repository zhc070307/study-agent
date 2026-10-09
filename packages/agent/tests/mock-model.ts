// Test-only adapter mounted into the actual trimmed SDK profile.
import type { Context } from '../../runtime/foundation/cordis/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../runtime/modules/core/agent-loop/tests/mock-adapter.ts'
export const name = 'study-test-model'
export const inject = ['llm']
export function apply(ctx: Context) {
  ctx.llm.registerAdapter(['study-test'], new MockAdapter([
    toolCallResponse('profile-shell-set','bash',{command:'STUDY_CHECK_VALUE=runtime-ok; printf "%s\\n" "$STUDY_CHECK_VALUE"'}),
    options=>{
      const result=options.messages.filter(m=>m.role==='tool').at(-1)!
      if(result.isError||!JSON.stringify(result.content).includes('runtime-ok'))throw new Error('Real shell did not execute')
      return toolCallResponse('profile-shell-reuse','bash',{command:'printf "%s\\n" "$STUDY_CHECK_VALUE"'})
    },

    options => {
      const result=options.messages.filter(m=>m.role==='tool').at(-1)!
      if(result.isError||!JSON.stringify(result.content).includes('runtime-ok'))throw new Error('Shell state was not preserved')
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
