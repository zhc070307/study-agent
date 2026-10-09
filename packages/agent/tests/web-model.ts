// Deterministic test adapter only. No remote inference; exercises the real SDK/tools.
import type { Context } from '../../../vendor/deepseek-harness/vendor/cordis/src/index.ts'
import { MockAdapter, textResponse, toolCallResponse } from '../../../vendor/deepseek-harness/packages/core/agent-loop/tests/mock-adapter.ts'
export const name = 'study-web-test-model'
export const inject = ['llm']
export function apply(ctx: Context) {
  let source: any, practice: any, tex: any, pdf: any, compiled: any, preview: any, feedbackRun: any, answer: any
  const last = (options: any) => {
    const message = options.messages.filter((m: any)=>m.role==='tool').at(-1)
    if(message?.isError) throw new Error('Tool failed: '+JSON.stringify(message))
    return JSON.parse(message.content.find((b: any)=>b.type==='text').text)
  }
  const userRequest = (options: any) => {
    for (const message of [...options.messages].reverse()) {
      if (message.role !== 'user') continue
      const text=message.content.find((b: any)=>b.type==='text')?.text ?? ''
      try {const value=JSON.parse(text);if(value['用户要求'])return value} catch {}
    }
    throw new Error('Original user request missing')
  }
  const tool = (id: string, action: string, input: object) => toolCallResponse(id,'study_desktop',{action,input:JSON.stringify(input)})
  class VisionMock extends MockAdapter {
    override async resolveModel(provider: string, model: string) {return {...await super.resolveModel(provider,model),inputModalities:['text' as const,'image' as const]}}
  }
  ctx.llm.registerAdapter(['study-web-test'],new VisionMock([
    options=>{
      const input=userRequest(options)
      if(!input['选区或作答']?.text.includes('导数'))throw new Error('Selected quote was not passed to the model')
      source=input['关联文件'][0]
      return tool('web-read','read',{file:source.id})
    },
    options=>{
      const read=last(options)
      if(!read.text.includes('瞬时变化率'))throw new Error('Actual source was not read')
      return tool('web-folder','folder',{name:'本次练习'})
    },
    options=>tool('web-practice','create',{name:'平方函数练习.md',mime:'text/markdown',kind:'practice',folder:last(options).id,text:'# 练习\n\n求 f(x)=x² 在 x=3 时的导数，并解释其含义。',sources:[source.id]}),
    options=>{practice=last(options);return tool('web-task','task',{title:'完成平方函数练习',file:practice.id})},
    ()=>tool('web-tex','create',{name:'导数说明.tex',mime:'text/x-tex',text:String.raw`\documentclass[UTF8,fontset=fandol]{ctexart}
\usepackage{amsmath}
\begin{document}
\section{导数与变化率}
平方函数 $f(x)=x^2$ 的导数为 $f'(x)=2x$。
\end{document}`,sources:[source.id]}),
    options=>{tex=last(options);return tool('web-compile','compile',{file:tex.id,expected:tex.sha256})},
    options=>{compiled=last(options);if(!compiled.ok)throw new Error(compiled.log);return tool('web-list','list',{})},
    options=>{pdf=last(options).files.find((f: any)=>f.compile===compiled.id);return tool('web-page','page',{file:pdf.id,page:1})},
    options=>{
      const result=options.messages.filter(m=>m.role==='tool').at(-1)!
      if(!result.content.some(b=>b.type==='image'))throw new Error('Actual page image was not projected through Harness: '+JSON.stringify(result))
      return tool('web-review','review',{file:pdf.id,sha256:pdf.sha256,pages:[{page:1,status:'passed',summary:'示例核验：标题、中文与平方函数导数公式'}],checks:{source_scope:'示例仅写入已读的平方函数导数',layout:'示例页面渲染已返回，测试不证明模型视觉判断'}})
    },
    ()=>toolCallResponse('web-change-preview','study_change',{action:'preview',input:JSON.stringify({flow:'memory',scope:'learning',reason:'用户要求保留约定但不设置阅读与练习先后',definition:{scope:'workspace',title:'自由安排的学习约定',steps:[{id:'remember',kind:'custom',instructions:'只保存用户要求',handler:'def run(input, context):\n    return {"free_order": True}',tests:[{input:{},expected:{free_order:true}}]}]}})}),
    options=>{preview=last(options);return toolCallResponse('web-change-apply','study_change',{action:'apply',input:JSON.stringify({flow:'memory',scope:'learning',version:preview.version,expected:preview.current})})},
    ()=>tool('web-agreement-list','list',{}),
    options=>tool('web-agreement-save','agreement',{scope:'learning',key:'学习安排',text:'阅读和练习根据当前意愿自由选择',reason:'用户明确要求不设置阅读与练习先后',expected:last(options).agreements.learning.version}),
    textResponse('**练习与 PDF 已保存**，学习约定已更新。阅读和练习可自由安排。'),
    options=>{
      const input=userRequest(options)
      if(!options.messages.some(m=>m.content.some(b=>b.type==='text'&&b.text.includes('学习安排'))))throw new Error('Overall memory reference was not supplied')
      answer=input['选区或作答']
      if(answer?.source!=='作答' || !answer.text.includes('6'))throw new Error('Original answer was not passed')
      return toolCallResponse('web-feedback-start','study_work',{action:'start',input:JSON.stringify({course:'DEMO',flow:'feedback'})})
    },
    options=>{feedbackRun=last(options);return toolCallResponse('web-feedback-save','study_work',{action:'advance',input:JSON.stringify({run:feedbackRun.id,step:'feedback',input:{answers:answer.text,summary:'示例作答 f′(3)=6，实际作答已保留；此测试不证明教学判断',source:practice.id,issues:[]}})})},
    textResponse('作答反馈已登记，原始推导仍保留。'),
    'hang',
  ]))
}
