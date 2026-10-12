'use strict';
if(window.studyDesktop?.platform)document.documentElement.dataset.platform=window.studyDesktop.platform;
// Files, drafts and conversations share the current semester's local workspace.
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const files = [];
const folders = [];
const tasks = [];
let courses=[],taskPeriod="today",taskCourse="";
const collapsedTaskGroups=new Set();
let transcription={installed:false,jobs:[]};
let semesterId=null,semesterList=null,readonly=false,removedFiles=[];
let serverVersion = -1, applying = false, metadataTimer, busy = false, sending = false;
let savedMetadata = '', syncChain = Promise.resolve();
let runtimeView={status:'idle',revision:-1},chatSemester=null,chatStream;
const pendingMessages=new Map(),conversationViews=new Map();
let renderedChannel=null, draftChain=Promise.resolve();
const chatFind={query:'',id:null};
const savedAnswers=new Map(),answerTimers=new Map();
let chats=[],chatRowEdit=null,chatRowDelete=null;
let harnessRelativeTime=null,closeConversationMenus=()=>{};
function conversationAge(time){
  if(!harnessRelativeTime||!time)return '';
  const {unit,n}=harnessRelativeTime(time,Date.now());
  return unit==='now'?'刚刚':`${n}${({minutes:'分钟',hours:'小时',days:'天',months:'个月',years:'年'})[unit]}前`;
}
const requestId = () => crypto.randomUUID();
async function api(path, value) {
  const headers=semesterId?{'X-Study-Semester':semesterId}:{};
  const response = await fetch(path, value === undefined ? {headers} : {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(value)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失败');
  return result;
}
const operation = (action,args) => api('/api/workspace',{action,args,id:requestId()});
function metadata() {return JSON.stringify({folders,files:files.map((file,order)=>({id:file.id,name:file.name,folder:file.folder,order}))});}
function persistMetadata() {
  if (readonly || applying || serverVersion < 0) return;
  clearTimeout(metadataTimer);
  metadataTimer = setTimeout(()=>{
    syncChain = syncChain.then(async()=>{
      const current = metadata(); if (current === savedMetadata) return;
      $('.prototype-note').textContent='正在保存…';
      try {await operation('metadata',{...JSON.parse(current),expected:serverVersion});savedMetadata=current;await refresh(false);$('.prototype-note').textContent='已保存';}
      catch(error){toast(error.message);await refresh(true);}
    });
  },100);
}
async function refresh(force=false) {
  const data = await api('/api/state');
  if(semesterId && semesterId!==data.semesters.active){location.reload();return;}
  semesterList=data.semesters;semesterId=data.semesters.active;transcription=data.transcription||{installed:false,jobs:[]};
  const semester=data.semesters.items.find(s=>s.id===semesterId);readonly=semester.status!=='open';
  $('#semester-menu').textContent=semester.name+(readonly?' · 已归档':'');
  removedFiles=data.trash||[];$('#file-trash').hidden=!removedFiles.length;
  for(const element of $$('#new-folder,#new-task,#add-files,#remove-files,#move-files,#move-first,#rename,#edit-file,#compile-file,#transcribe-file,#prompt,.send-button'))element.disabled=readonly;
  for(const file of data.files){file.source+='?semester='+semesterId;file.url+='&semester='+semesterId;}
  applyConversation(data,data.semesters.active);
  if(data.warnings?.length)$('.prototype-note').textContent='课程文件有其他修改，已保留版本，待助理核对';
  $('#stop-agent').hidden=!busy;
  if (!force && metadata()!==savedMetadata && serverVersion>=0) return;
  const readerStamp=list=>JSON.stringify(list.filter(file=>[state.active,state.compare,getFile(state.active)?.pdf?.file].includes(file.id)).map(file=>[file.id,file.sha256,file.name,file.folder,file.pdf,file.compile_result,file.accepted]));
  const contentChanged=readerStamp(files)!==readerStamp(data.files);
  applying=true;
  const old = new Map(files.map(file=>[file.id,file]));
  files.splice(0,files.length,...data.files.map(file=>{
    const previous=old.get(file.id), merged={...previous,...file};
    if(previous?.sha256!==file.sha256){delete merged.text;delete merged.loading;delete merged.loadError;}
    return merged;
  }));
  folders.splice(0,folders.length,...data.folders);
  tasks.splice(0,tasks.length,...data.tasks);courses=data.courses||[];
  for(const [id,text] of Object.entries(data.answers)){savedAnswers.set(id,text);if(!state.answers.has(id))state.answers.set(id,text);}
  const firstLoad=serverVersion<0;
  if (firstLoad) {
    for(const [id,value] of Object.entries(data.drafts)) {
      if(id.startsWith('__answer:')){state.answers.set(id.slice(9),value.text||'');continue;}
      if(id.startsWith('__reader:')){const file=getFile(id.slice(9));if(file)for(const key of ['pdfPage','pdfZoom','pdfScroll','pdfContinuous','mode'])if(value[key]!==undefined)file[key]=value[key];continue;}
      if(id.startsWith('__'))continue;
      state.compositions.set(id,{...value,contexts:new Set(value.contexts||[])});
      if(value.scroll!==undefined)state.scrolls.set(id,value.scroll);if(value.chatScroll)conversationViews.set(id,value.chatScroll);
    }
    restoreComposition([]);
  }
  serverVersion=data.version;
  savedMetadata=metadata();
  state.tabs=state.tabs.filter(id=>getFile(id));
  if(state.compare&&!getFile(state.compare))state.compare=null;
  if(state.active&&!getFile(state.active)){backToDesktop();toast('这份文件已移除，对话记录仍保留');}
  renderDesktop(); renderConversation();renderContexts();renderTabs();
  if(state.active && contentChanged){saveScroll();renderTask();}
  if(firstLoad&&data.drafts.__layout){
    const layout=data.drafts.__layout;state.tabs=(layout.tabs||[]).filter(id=>getFile(id));state.folder=folders.some(f=>f.id===layout.folder)||layout.folder==='unfiled'?layout.folder:null;state.deskScroll=layout.deskScroll||0;
    if(layout.active&&getFile(layout.active))openFile(layout.active);else renderDesktop();
    if(layout.chatChannel&&(chats.some(chat=>chat.channel===layout.chatChannel)||state.messages.has(layout.chatChannel)||layout.chatChannel===defaultChat(state.active)))switchConversation(layout.chatChannel);
  }
  applying=false;
}
let layoutChain=Promise.resolve();
function persistLayout(){if(readonly)return;const value={active:state.active,tabs:[...state.tabs],folder:state.folder,deskScroll:state.deskScroll,chatChannel:state.chatChannel};layoutChain=layoutChain.then(()=>api('/api/workspace',{action:'draft',args:{channel:'__layout',value}})).catch(()=>{});}
function saveDraft(key,value){if(readonly||(!key.startsWith('__')&&chatLocked(key)))return Promise.resolve(false);const write=draftChain.then(()=>operation('draft',{channel:key,value}));draftChain=write.catch(()=>{});return write.then(()=>true,error=>{toast(error.message);return false;});}
function readerState(file){return {pdfPage:file.pdfPage,pdfZoom:file.pdfZoom,pdfScroll:file.pdfScroll,pdfContinuous:file.pdfContinuous,mode:file.mode};}
function persistReader(file){if(file)saveDraft('__reader:'+file.id,readerState(file));}
function persistAnswer(file,text){clearTimeout(answerTimers.get(file));return saveDraft('__answer:'+file,{text});}
function compositionValue(){return {prompt:$('#prompt').value,contexts:[...state.contexts],quote:state.quote,scroll:$('.workspace').scrollTop,chatScroll:conversationViews.get(channel()),failed:state.compositions.get(channel())?.failed};}
function persistDraft() {
  if(readonly||chatLocked(channel()))return;
  const key=channel();
  const value=compositionValue();
  state.compositions.set(key,{...value,contexts:new Set(value.contexts)});
  return saveDraft(key,value);
}
const pdfDisposers = [];
function disposePdfReaders() {for (const dispose of pdfDisposers.splice(0)) dispose();}
function formatFor(file) {
  if (file.mime === 'text/markdown' || /\.(md|markdown)$/i.test(file.name)) return 'markdown';
  if (file.mime === 'text/x-tex' || file.mime === 'application/x-tex' || /\.tex$/i.test(file.name)) return 'latex';
  return 'text';
}
function markdownPreview(text) {
  const renderer = new marked.Renderer();
  renderer.image = token => esc(token.text || '图片');
  return DOMPurify.sanitize(marked.parse(text,{renderer}), {
    ALLOWED_TAGS:['h1','h2','h3','h4','h5','h6','p','a','ul','ol','li','pre','code','blockquote','strong','em','del','table','thead','tbody','tr','th','td','hr','br'],
    ALLOWED_ATTR:['href','title'], SANITIZE_NAMED_PROPS:true
  });
}
function localDay(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function taskDay(value){if(!value)return null;if(value.length===10)return value;const date=new Date(value);return Number.isNaN(date.getTime())?null:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function renderTasks() {
  const today=localDay();
  const available=tasks.filter(task=>task.actor==='student'&&(!taskCourse||task.course===taskCourse));
  const pending=available.filter(task=>!task.done).filter(task=>taskPeriod==='all'||(taskPeriod==='today'?(task.scheduled_date===today||taskDay(task.due_at)&&taskDay(task.due_at)<=today):(task.scheduled_date!==today&&!(taskDay(task.due_at)&&taskDay(task.due_at)<=today)&&(task.scheduled_date>today||taskDay(task.due_at)>today))));
  const completed=available.filter(task=>task.done);
  $('#task-count').textContent=`${pending.length} 项`;
  const select=$('#task-course');const focused=document.activeElement===select;
  if(!focused){select.innerHTML='<option value="">全部课程</option>'+courses.map(course=>`<option value="${esc(course.id)}">${esc(course.name)}</option>`).join('');select.value=taskCourse;}
  $$('#task-period button').forEach(button=>{button.classList.toggle('active',button.dataset.period===taskPeriod);button.setAttribute('aria-pressed',String(button.dataset.period===taskPeriod));});
  const row=task=>{const due=taskDay(task.due_at),overdue=due&&due<today;const date=due?(overdue?'已过截止 · ': '截止 · ')+due.slice(5):task.scheduled_date&&task.scheduled_date!==today?'安排 · '+task.scheduled_date.slice(5):'';return `<div class="task-row ${task.done?'done':''}"><input type="checkbox" data-task="${esc(task.id)}" aria-label="完成任务 ${esc(task.title)}" ${task.done?'checked':''} ${readonly?'disabled':''}><button data-task-id="${esc(task.id)}" data-task-open="${esc(task.file||'')}"><strong>${esc(task.title)}</strong><small>${esc(getFile(task.file)?.name||'')}${date?' · '+esc(date):''}</small></button>${overdue&&!task.done?'<span class="overdue">待处理</span>':''}</div>`;};
  const groups=new Map();for(const task of pending){const key=task.course||'general';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(task);}
  let content=[...groups].map(([key,items])=>`<details class="task-group" data-task-group="${esc(key)}" ${collapsedTaskGroups.has(key)?'':'open'}><summary><span>${esc(courses.find(course=>course.id===key)?.name||'其他事项')}</span><small>${items.length}</small></summary>${items.map(row).join('')}</details>`).join('');
  if(!pending.length)content=`<p class="task-empty">${taskPeriod==='today'?'今天没有已安排的任务':taskPeriod==='next'?'没有已安排的后续任务':'没有未完成任务'}</p>`;
  if(completed.length)content+=`<details class="completed-tasks" data-task-group="completed" ${collapsedTaskGroups.has('completed-open')?'open':''}><summary>已完成 <small>${completed.length}</small></summary>${completed.map(row).join('')}</details>`;
  $('#tasks').innerHTML=content;
}
const state = {chatChannel:null,folder:null, selected:new Set(), contexts:new Set(), quote:null, active:null, compare:null, tabs:[], messages:new Map(), compositions:new Map(), scrolls:new Map(), answers:new Map(), deskScroll:0, nextId:1};
let draggedId = null, fileSearch = "";
let toastTimer;
let pickerCallback;
const getFile = id => files.find(file => file.id === id);
const defaultChat = file => chats.filter(chat=>chat.status==='open'&&chat.file===(file||null)).at(-1)?.channel || file || 'desktop';
const channel = () => state.chatChannel || defaultChat(state.active);
const chatFile = key => chats.find(chat=>chat.channel===key)?.file || (key==='desktop'?null:getFile(key)?.id||removedFiles.find(file=>file.id===key)?.id);
const chatLocked = key => {const chat=chats.find(chat=>chat.channel===key),file=chatFile(key);return chat?.status==='archived'||Boolean(file&&!getFile(file));};
const matchesFile = (file, query) => `${file.name} ${folderPath(file.folder)}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
const visibleFiles = () => fileSearch.trim() ? files.filter(file=>matchesFile(file,fileSearch)) : files.filter(file => !state.folder||state.folder==='unfiled'?!file.folder:file.folder===state.folder);
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 3600); }
function folderPath(id){const names=[],seen=new Set();while(id){if(seen.has(id))break;seen.add(id);const folder=folders.find(item=>item.id===id);if(!folder){if(id==='unfiled')names.unshift('未整理');break;}names.unshift(folder.name);id=folder.parent;}return names.join(' / ');}
function breadcrumbs(id) {
  const chain=[],seen=new Set();
  while(id&&!seen.has(id)){seen.add(id);const folder=folders.find(item=>item.id===id);if(!folder)break;chain.unshift(folder);id=folder.parent;}
  return `<button class="text-button" data-browse-folder="">桌面</button>`+chain.map(folder=>`<span aria-hidden="true">/</span><button class="text-button" data-browse-folder="${esc(folder.id)}">${esc(folder.name)}</button>`).join('');
}
function browseFolder(id) {fileSearch='';$('#file-search').value='';state.folder=id||null;state.selected.clear();if(state.active)backToDesktop();else renderDesktop();persistLayout();}
function searchableChoices(html, placeholder='搜索…') {return `<input type="search" class="picker-input picker-search" aria-label="${esc(placeholder)}" placeholder="${esc(placeholder)}"><div class="picker-options">${html}</div><p class="picker-no-results picker-note" hidden>没有匹配项</p>`;}
function insideFolder(id,parent){const seen=new Set();while(id&&!seen.has(id)){if(id===parent)return true;seen.add(id);id=folders.find(folder=>folder.id===id)?.parent;}return false;}
function renderDesktop() {
  persistMetadata();
  const atRoot = !state.folder, searching=Boolean(fileSearch.trim());
  const children=folders.filter(folder=>(folder.parent||null)===(state.folder==='unfiled'? '__none__':state.folder));

  $('#folders').hidden=searching||!children.length;
  $('#task-list').hidden=!atRoot||searching;
  renderTasks();
  $('#folders').innerHTML=children.map(folder=>`<button class="folder" data-folder="${esc(folder.id)}" aria-label="${esc(folder.name)}">${icon('folder')}<span><strong>${esc(folder.name)}</strong><small>${files.filter(file=>folder.id==='unfiled'?!file.folder:insideFolder(file.folder,folder.id)).length} 份文件</small></span></button>`).join('');
  $('#files-heading').innerHTML=searching?'搜索结果 · '+visibleFiles().length+' 份文件':breadcrumbs(state.folder);
  $('#clear-file-search').hidden=!fileSearch;
  $('#clear-folder').hidden=atRoot;
  $('#add-files').hidden=false;
  $('#new-folder').hidden=state.folder==='unfiled';
  $('#new-folder').title=atRoot?'新建课程':'新建文件夹';
  $('#new-folder').setAttribute('aria-label',atRoot?'新建课程':'新建文件夹');
  const visible = visibleFiles();
  $('#files').hidden=false;
  $('#inbox-heading').hidden=!atRoot||!visible.length||searching;
  $('#files').classList.add('list');
  $('#files').innerHTML = visible.map(file => `<article class="file-card ${state.selected.has(file.id) ? 'selected' : ''}" draggable="true" data-id="${esc(file.id)}"><input type="checkbox" class="file-check" aria-label="选择 ${esc(file.name)}" ${state.selected.has(file.id) ? 'checked' : ''}><button class="file-open" aria-label="打开 ${esc(file.name)}">${icon('file')}<span><strong>${esc(file.name)}</strong>${searching?`<small>${esc(folderPath(file.folder)||'桌面 · 待整理')}</small>`:''}</span></button><span class="file-type">${esc(file.name.split('.').length>1?file.name.split('.').pop().toUpperCase().slice(0,8):'文件')}</span></article>`).join('');
  $('#empty').hidden=visible.length!==0||(!searching&&children.length>0);
  $('#empty h3').textContent=searching?'没有找到文件':'这里还没有文件';
  $('#empty p').textContent=searching?'试试文件名或所属课程、文件夹名称。':'添加文件，或拖入材料。';
  $('#selection-bar').hidden=state.selected.size===0;
  $('#selection-count').textContent = `已选择 ${state.selected.size} 份文件`;
}
function renderContexts() {
  const quoteOpen=$('.quote-context')?.open;
  const chips = [...state.contexts].filter(id => getFile(id)).map(id => `<span class="context-chip"><button type="button" class="context-open" data-open-context="${esc(id)}" title="${esc(folderPath(getFile(id).folder))}">${esc(getFile(id).name)}</button><button type="button" data-remove="${esc(id)}" aria-label="移除关联 ${esc(getFile(id).name)}">×</button></span>`);
  if (state.quote) chips.push(`<details class="quote-context"><summary>${esc(getFile(state.quote.file)?.name||'原文件')} · ${esc(state.quote.source||'选区')}</summary><blockquote>${esc(state.quote.text)}</blockquote><button type="button" class="text-button" data-remove-quote aria-label="移除选区">移除引用</button></details>`);
  $('#contexts').innerHTML = chips.length ? chips.join('') : '<span>尚未关联文件 · 可点 ＋ 添加</span>';
  if(quoteOpen&&$('.quote-context'))$('.quote-context').open=true;
  $('#clear-context').hidden = chips.length === 0;
  $('.context-heading').hidden = chips.length === 0;
  const failed=state.compositions.get(channel())?.failed;
  if(failed)$('#contexts').insertAdjacentHTML('beforeend','<button type="button" class="text-button" id="recover-prompt">查看未发送的问题</button>');
  $('#contexts').hidden=chips.length===0&&!failed;
}
function renderConversation() {
  const container = $('#conversation');
  const key=channel(),switched=renderedChannel!==key;
  $('#conversation-title').textContent=conversationName(key);
  const archived=chats.find(chat=>chat.channel===key)?.status==='archived',unavailable=chatLocked(key);$('#chat-unavailable').hidden=!unavailable;$('#chat-unavailable').innerHTML=archived?'这段对话已归档。<button class="text-button" id="restore-chat" type="button">取消归档，继续对话</button>':'原文件已移除，对话记录仍可阅读。';$('#prompt').disabled=readonly||unavailable;$('.send-button').disabled=readonly||unavailable||busy||sending;
  renderHistory();
  const view=conversationViews.get(key)||{top:0,follow:true};conversationViews.set(key,view);
  const selection=getSelection();
  if(!switched&&selection&&!selection.isCollapsed&&container.contains(selection.anchorNode))view.follow=false;
  const top=switched?view.top:container.scrollTop;
  const messages = [...(state.messages.get(key) || [])];
  for(const [id,pending] of pendingMessages)if(pending.channel===key&&!messages.some(message=>message.id===id))messages.push(pending);
  const live=runtimeView.live;
  if(live?.channel===key&&live.text)messages.push({id:'live-'+live.id,role:'assistant',text:live.text});
  resizeComposer();
  const existing=new Map([...container.children].map(node=>[node.dataset.message,node]));
  const wanted=[];
  if (!messages.length) {
    const welcome = existing.get('welcome')||document.createElement('div'); welcome.className = 'welcome';welcome.dataset.message='welcome';
    welcome.innerHTML = readonly ? '<p>这个学期已归档，文件和记录保留。需要修改或提问时，可以重新开始。</p>' : '<p>可以放入课程材料，也可以直接告诉我你想学什么。</p>';
    wanted.push(welcome);
  }
  for (const [index,message] of messages.entries()) {
    const id=message.id||'history-'+index;
    const artifacts=message===messages[messages.length-1]&&message.role==='assistant'?files.filter(f=>f.session==='desktop-'+key):[];
    const signature=JSON.stringify([message,artifacts.map(file=>[file.id,file.name])]);
    const div = existing.get(id)||document.createElement('div');wanted.push(div);
    if(div.dataset.signature===signature)continue;
    div.dataset.message=id;div.dataset.signature=signature;div.replaceChildren();div.className = `message ${message.role === 'user' ? 'user' : 'assistant-message'}`;
    div._message=message;
    const label = document.createElement('span'); label.className = 'message-meta'; label.textContent = message.role === 'user' ? '你' : '助理'; div.append(label);if(Number.isFinite(message.time)){const time=document.createElement('time');time.className='message-time';time.dateTime=new Date(message.time).toISOString();time.textContent=new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(message.time));label.append(' · ',time);}
    if (message.refs) { const refs = document.createElement('span'); refs.className = 'message-ref'; refs.textContent = message.refs; div.append(refs); }
    const body = document.createElement('div');body.className='chat-body';if(message.role==='assistant')body.innerHTML=markdownPreview(message.text);else body.textContent=message.text;div.append(body);
    for(const link of $$('a',body)){link.target='_blank';link.rel='noopener noreferrer';}
    for(const pre of $$('pre',body)){const wrapper=document.createElement('div');wrapper.className='chat-code';pre.replaceWith(wrapper);wrapper.append(pre);const copy=document.createElement('button');copy.type='button';copy.className='text-button copy-code';copy.textContent='复制代码';wrapper.append(copy);}
    if(!id.startsWith('live-')){const actions=document.createElement('div');actions.className='message-actions';actions.innerHTML=`<button type="button" class="text-button" data-copy-message>复制</button><button type="button" class="text-button" data-reuse-message>${message.role==='user'?'再次编辑':'引用提问'}</button>`;div.append(actions);}
    if (message.file&&getFile(message.file)) {const button = document.createElement('button'); button.className = 'message-artifact'; button.dataset.openArtifact = message.file; button.innerHTML = `${icon('file')}<span>${esc(getFile(message.file).name)}</span>${icon('arrow')}`; div.append(button);}
    for(const file of artifacts){const button=document.createElement('button');button.className='message-artifact';button.dataset.openArtifact=file.id;button.textContent=file.name;div.append(button);}
  }
  if((busy&&runtimeView.active===key)||[...pendingMessages.values()].some(message=>message.channel===key)){
    const progress=existing.get('progress')||document.createElement('div');progress.dataset.message='progress';progress.className='chat-progress';progress.setAttribute('role','status');
    const text=live?.channel===key&&live.text?'正在回复…':busy?'助理正在处理…':'正在发送…';if(progress.textContent!==text)progress.textContent=text;wanted.push(progress);
  }
  for(const node of [...container.children])if(!wanted.includes(node))node.remove();
  wanted.forEach((node,index)=>{if(container.children[index]!==node)container.insertBefore(node,container.children[index]||null);});
  renderedChannel=key;
  container.scrollTop=view.follow?container.scrollHeight:top;
  view.top=container.scrollTop;

  updateChatFind();
}
function applyConversation(data,semester){
  if(semesterId&&semester!==semesterId)return;
  if(chatSemester===semester&&runtimeView.generation===data.runtime.generation&&data.runtime.revision<runtimeView.revision)return;
  chatSemester=semester;runtimeView=data.runtime;busy=runtimeView.status==='running';
  if(serverVersion>=0&&!state.chatChannel)state.chatChannel=channel();
  const previous=chats.find(chat=>chat.channel===state.chatChannel);
  state.messages=new Map(Object.entries(data.messages));
  if(data.chats)chats=data.chats;
  if(previous&&!chats.some(chat=>chat.channel===previous.channel)){
    state.compositions.delete(previous.channel);conversationViews.delete(previous.channel);
    state.chatChannel=defaultChat(previous.file);restoreComposition(previous.file&&getFile(previous.file)?[previous.file]:[]);
    toast('这段对话已删除，已打开其他对话');
  }
  $('#stop-agent').hidden=!busy;
  $('.send-button').disabled=readonly||busy||sending;
  renderConversation();
}
let chatScrollTimer;
$('#conversation').addEventListener('scroll',()=>{
  if(renderedChannel!==channel())return;
  const container=$('#conversation'),view=conversationViews.get(channel());if(!view)return;
  view.top=container.scrollTop;view.follow=container.scrollHeight-container.clientHeight-container.scrollTop<24;
  clearTimeout(chatScrollTimer);chatScrollTimer=setTimeout(persistDraft,400);
},{passive:true});
function connectChat(){
  chatStream?.close();
  chatStream=new EventSource('/api/chat-events');
  chatStream.onmessage=event=>{const data=JSON.parse(event.data);if(semesterId&&data.semester!==semesterId){location.reload();return;}applyConversation(data,data.semester);};
  chatStream.onerror=()=>{if(busy){const progress=$('.chat-progress');if(progress)progress.textContent='连接中断，正在重连…';}};
}
function addMessage(role, text, extra = {}) {
  const key = channel(); if (!state.messages.has(key)) state.messages.set(key, []);
  state.messages.get(key).push({role, text, ...extra}); renderConversation();
}
function saveScroll() {
  persistDraft();
  state.compositions.set(channel(),{...compositionValue(),contexts:new Set(state.contexts)});
  if (!state.active) state.deskScroll = $('.workspace').scrollTop;
  for (const pane of $$('.document-pane')) {
    const answer = $('.answer-input', pane);if(answer){state.answers.set(pane.dataset.file,answer.value);persistAnswer(pane.dataset.file,answer.value);}persistReader(getFile(pane.dataset.file));
  }
  if (state.active) state.scrolls.set(state.active, $('.workspace').scrollTop);
}
function restoreComposition(defaultContexts) {
  const saved = state.compositions.get(channel());
  state.contexts = saved ? new Set(saved.contexts) : new Set(defaultContexts);
  state.quote = saved?.quote || null;
  state.pendingQuote = null;
  $('#prompt').value = saved?.prompt || '';resizeComposer();
  $('#prompt').placeholder=state.quote?'关于这段内容，你想问什么？':'说说你想做什么……';
}
const textReads=new Set();
async function loadText(file) {
  if(!file.textual || file.text!==undefined || file.loadError)return;
  const semester=semesterId, digest=file.sha256, key=semester+':'+file.id+':'+digest;
  if(textReads.has(key))return;
  textReads.add(key);file.loading=true;
  try {
    const result=await operation('read',{file:file.id,expected:digest});
    const current=getFile(file.id);
    if(semesterId===semester && current?.sha256===digest && result.sha256===digest){current.text=result.text;delete current.loadError;}
  } catch(error) {
    const current=getFile(file.id);
    if(semesterId===semester && current?.sha256===digest)current.loadError=error.message;
  } finally {
    textReads.delete(key);
    const current=getFile(file.id);
    if(semesterId===semester && current?.sha256===digest){delete current.loading;if(state.active===file.id || state.compare===file.id)renderTask();}
  }
}
function openFile(id,{keepConversation=false}={}) {
  setTimeout(persistLayout,0);
  if (!getFile(id)) return;
  setChatExpanded(false);
  delete getFile(id).loadError;
  const previousChannel=channel();saveScroll();const changed=state.active!==id;
  state.active=id;state.compare=null;state.chatChannel=keepConversation?previousChannel:null;
  if (!state.tabs.includes(id)) state.tabs.push(id);
  if(channel()!==previousChannel)restoreComposition([id]);
  $('#desktop').hidden = true; $('#task').hidden = false;
  renderTask(); renderContexts(); renderConversation();
  $('.workspace').scrollTop = state.scrolls.get(id) || 0;
  if (matchMedia('(max-width:720px)').matches) collapseAssistant(true);
}
function backToDesktop() {
  setTimeout(persistLayout,0);
  saveScroll();disposePdfReaders();state.active=null;state.compare=null;state.chatChannel=null;restoreComposition(state.selected);
  $('#desktop').hidden = false; $('#task').hidden = true;
  renderDesktop(); renderContexts(); renderConversation(); renderTabs(); $('.workspace').scrollTop = state.deskScroll;
}
function paper(file) {
  if (file.loadError) return `<div class="reader-empty">${esc(file.loadError)}。请重新打开文件重试。</div>`;
  let body;
  if (file.text !== undefined) {
    body = formatFor(file) === 'markdown' && file.mode !== 'source' ? `<article class="markdown-body">${markdownPreview(file.text)}</article>` : `<pre class="file-text ${formatFor(file) === 'latex' || file.mode === 'source' ? 'source-text' : ''}">${esc(file.text)}</pre>`;
    if (file.kind === 'practice') body += `<section class="answer-section"><h3>作答</h3><textarea class="answer-input" ${readonly?'disabled':''} aria-label="练习作答" placeholder="写下你的思路……"></textarea><div class="answer-actions"><button class="button subtle save-answer" ${readonly?'disabled':''}>保存作答</button><button class="button subtle ask-answer" ${readonly?'disabled':''}>带着作答提问</button><span class="answer-status">作答单独保存，保留历史</span></div></section>`;
  } else if (file.textual) body = '<div class="reader-empty">正在读取文件…</div>';
  else if (!file.url) body = '<div class="reader-empty">无法读取此文件</div>';
  else if (['image/png','image/jpeg','image/webp','image/gif'].includes(file.mime)) body = `<img class="file-image" src="${esc(file.url)}" alt="${esc(file.name)}">`;
  else if (file.mime === 'application/pdf') body = '<div class="pdf-host"><div class="reader-empty">正在打开 PDF…</div></div>';
  else if (file.mime.startsWith('audio/')) body = `<audio controls src="${esc(file.url)}"></audio>`;
  else body = '<div class="reader-empty">此格式暂不支持预览。内容尚未被读取或分类。</div>';
  return `<div class="file-reader ${file.mime === 'application/pdf' ? 'pdf-reader' : ''}">${body}</div>`;
}
function renderTabs() {
  $('#document-tabs').innerHTML = state.tabs.map(id => `<div class="file-tab ${id === state.active ? 'active' : ''}"><button data-tab="${esc(id)}" aria-current="${id === state.active ? 'page' : 'false'}">${icon('file')}<span>${esc(getFile(id).name)}</span></button><button data-close-tab="${esc(id)}" class="tab-close" aria-label="关闭 ${esc(getFile(id).name)}" title="关闭">${icon('close')}</button></div>`).join('');
  const tab=$('#document-tabs .active'),strip=$('#document-tabs');
  if(tab){const box=tab.getBoundingClientRect(),frame=strip.getBoundingClientRect();if(box.right>frame.right)strip.scrollLeft+=box.right-frame.right;else if(box.left<frame.left)strip.scrollLeft+=box.left-frame.left;}
  $('#back').classList.toggle('active', !state.active);
  $('#back').setAttribute('aria-current', state.active ? 'false' : 'page');
  $('#file-actions').hidden = !state.active;
  const current=state.active && getFile(state.active);
  if(current){$('#download-file').href=current.url;$('#download-file').download=current.name;}
  $('#open-native-file').hidden=$('#reveal-native-file').hidden=!current||!window.studyDesktop?.files;
  const markdown = current && formatFor(current) === 'markdown';
  const latex=current && formatFor(current)==='latex';
  const audio=current?.mime.startsWith('audio/');
  const transcriptionJob=transcription.jobs.find(job=>job.file===current?.id&&job.source_sha256===current.sha256);
  $('#transcribe-file').hidden=!audio;$('#transcribe-status').hidden=!audio||!transcriptionJob;
  $('#transcribe-file').textContent=transcriptionJob?.status==='running'?'停止转写':transcriptionJob?.status==='completed'?'打开原稿':'转写';
  $('#transcribe-status').textContent=transcriptionJob?.message||'';
  $('#compile-file').hidden=!latex; $('#view-pdf').hidden=!latex || !current.pdf;
  $('#edit-file').hidden=!current || current.text===undefined;
  $('#history-file').hidden=!current || current.text===undefined;
  $('#view-pdf').textContent=current?.mode==='pdf'?'源码':'PDF';
  $('#reader-modes').hidden = !markdown;
  for (const button of $$('[data-mode]')) {const active = state.active && (getFile(state.active).mode || 'preview') === button.dataset.mode; button.classList.toggle('active', Boolean(active)); button.setAttribute('aria-pressed', String(Boolean(active)));}
}
function closeTab(id) {
  setTimeout(persistLayout,0);
  const current = state.active === id;
  if (current) saveScroll();
  state.tabs = state.tabs.filter(tab => tab !== id);
  if (current) {
    if (state.tabs.length) openFile(state.tabs[state.tabs.length - 1]);
    else backToDesktop();
  } else renderTabs();
}
for(const [id,action] of [['open-native-file','open'],['reveal-native-file','reveal']]){
  $('#'+id).addEventListener('click',async()=>{
    $('#file-actions').open=false;
    try{await window.studyDesktop.files[action](state.active,semesterId);}catch(error){toast(error.message||'暂时无法打开本地文件');}
  });
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#file-actions'))$('#file-actions').open=false;});
$('#file-actions').addEventListener('keydown',event=>{if(event.key==='Escape'){$('#file-actions').open=false;$('#file-actions summary').focus();}});
function renderTask() {
  disposePdfReaders();
  const file = getFile(state.active);if(!file)return;
  $('#document-title').textContent = file.name;
  $('#document-meta').innerHTML = breadcrumbs(file.folder)+`<span aria-hidden="true">/</span><span>${esc(file.name)}</span>`;
  renderTabs();
  const sourceIds = state.compare ? [state.active, state.compare] : [state.active];
  const ids=sourceIds.map(id=>{const file=getFile(id);return file.mode==='pdf'&&file.pdf?file.pdf.file:id;});
  for(const id of ids)loadText(getFile(id));
  $('#document-area').classList.toggle('comparing', Boolean(state.compare));
  $('#document-area').innerHTML = ids.map(id => `<section class="document-pane" data-file="${esc(id)}" aria-label="${esc(getFile(id).name)}">${state.compare ? `<div class="pane-label"><span>${esc(getFile(id).name)}</span>${id === state.compare ? `<button class="icon-button" id="close-compare" aria-label="关闭并排文件">${icon('close')}</button>` : ''}</div>` : ''}${paper(getFile(id))}</section>`).join('');
  for(const pane of $$('.document-pane')){const answer=$('.answer-input',pane);if(answer){answer.value=state.answers.get(pane.dataset.file)||'';$('.answer-status',pane).textContent=answer.value!== (savedAnswers.get(pane.dataset.file)||'')?'草稿已保留 · 尚未保存作答':'作答单独保存，保留历史';}}
  $('#quote-bar').hidden = true;
  if (file.compile_result) {const status=document.createElement('div');status.className='compile-status';status.textContent=file.compile_result.ok ? (file.pdf?.stale ? '源码已修改，PDF 待重新编译' : '已编译 · '+file.compile_result.pages+' 页 · '+(getFile(file.pdf?.file)?.accepted?'已核验':'待核验')) : '编译失败，上一版 PDF 已保留';if(!file.compile_result.ok){const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent='查看编译记录';const log=document.createElement('pre');log.textContent=file.compile_result.log;details.append(summary,log);status.append(details);}$('#document-area').prepend(status);}
  for (const pane of $$('.document-pane')) {
    const host = $('.pdf-host',pane); if (!host) continue;
    const file = getFile(pane.dataset.file);
    import('./pdf-reader.mjs').then(({mountPdfReader}) => {
      if (!host.isConnected) return;
      pdfDisposers.push(mountPdfReader(host,file));
    }).catch(error => {if (host.isConnected) host.textContent = `PDF 打开失败：${error.message}`;});
  }
}
function collapseAssistant(collapsed) {
  if(collapsed)setChatExpanded(false);
  $('#shell').classList.toggle('collapsed', collapsed); $('#restore-assistant').hidden = !collapsed;
  for (const button of $$('.assistant-toggle')) {button.setAttribute('aria-label', collapsed ? '打开助理' : '收起助理'); button.title = collapsed ? '打开助理' : '收起助理';}
}
function showPicker(title, html, callback, {confirm=true}={}) {
  $('#picker-title').textContent=title;$('#picker-body').innerHTML=html;pickerCallback=callback;$('#picker').returnValue='';$('#picker-confirm').hidden=!confirm;$('#picker-confirm').disabled=false;$('#picker-confirm').textContent='确定';$('#picker').showModal();
}
function filePicker(title, callback, exclude = null, multiple = false) {
  const candidates = files.filter(file => file.id !== exclude);
  showPicker(title, searchableChoices(candidates.map(file => `<label class="picker-option"><input type="${multiple ? 'checkbox' : 'radio'}" name="file" value="${esc(file.id)}" ${multiple && state.contexts.has(file.id) ? 'checked' : ''}><span>${esc(file.name)}<small> · ${esc(folderPath(file.folder)||'未整理')}</small></span></label>`).join(''),'搜索文件名或所在文件夹'), () => {const ids = $$('#picker-body input:checked').map(input => input.value); if(!ids.length)throw new Error('请选择文件'); return callback(multiple ? ids : ids[0]);});
}
let pickerSaving=false;
$('#picker form').addEventListener('submit',async event=>{
  if(event.submitter?.value!=='confirm')return;
  event.preventDefault();if(pickerSaving)return;
  const callback=pickerCallback;pickerSaving=true;$('#picker-confirm').disabled=true;$('#picker-confirm').textContent='正在保存…';$('.picker-error')?.remove();
  try{const result=await callback?.();if(callback===pickerCallback&&result!==false)$('#picker').close('confirm');}
  catch(error){const message=document.createElement('p');message.className='picker-error';message.setAttribute('role','alert');message.textContent=error.message;$('#picker-body').append(message);}
  finally{pickerSaving=false;$('#picker-confirm').disabled=false;$('#picker-confirm').textContent='确定';}
});
$('#picker').addEventListener('cancel',event=>{if(pickerSaving)event.preventDefault();});
$('#picker form').addEventListener('click',event=>{if(event.target.closest('[value="cancel"]')){event.preventDefault();if(!pickerSaving)$('#picker').close('cancel');}});
$('#picker').addEventListener('close',()=>{pickerCallback=null;});
function createFolder() {
  const parent=state.folder;
  showPicker(parent?'新建文件夹':'新建课程','<label><span class="sr-only">名称</span><input class="picker-input" id="folder-name" maxlength="60" placeholder="给它一个名字" required></label>',async()=>{
    const name=$('#folder-name').value.trim();if(!name)return;
    try{await operation(parent?'folder':'course',parent?{name,parent}:{name});await refresh(true);toast(parent?'已新建文件夹':'已建立课程和分类文件夹');}catch(error){toast(error.message);}
  });
}
function moveFiles() {
  if (!state.selected.size) return;
  showPicker('把文件放到哪里？', '<p class="picker-note">移动后仍保留原文和历史。所属课程改变时，关联的未完成任务会一并调整；既有学习记录保留。</p>' + searchableChoices([{id:'', name:'未整理'}, ...folders.map(folder=>({...folder,name:folderPath(folder.id)}))].map(folder => `<label class="picker-option"><input type="radio" name="folder" value="${esc(folder.id)}"><span>${esc(folder.name)}</span></label>`).join(''),'搜索目标文件夹'), async () => {const choice = $('#picker-body input:checked'); if(!choice)throw new Error('请选择位置'); try{await syncChain;await operation('metadata',{expected:serverVersion,files:[...state.selected].map(id=>({id,folder:choice.value||null}))});state.selected.clear();await refresh(true);toast('文件已移动');}catch(error){toast(error.message);await refresh(true);}});
}
function refsText() {
  const names = [...state.contexts].map(id => getFile(id)?.name).filter(Boolean);
  if (state.quote) names.push(`${getFile(state.quote.file).name} · ${state.quote.source}：${state.quote.text.slice(0,80)}`);
  return names.join(' · ');
}

async function sendMessage() {
  const input=$('#prompt'),text=input.value.trim();if(!text||sending||busy||chatManaging||readonly||chatLocked(channel()))return;
  if(modelSetupNeeded){try{await openSettings();}catch(error){toast(error.message);}return;}
  sending=true;
  const key=channel(),args={id:requestId(),channel:key,text,files:[...state.contexts].filter(id=>getFile(id)),quote:state.quote};
  const refs=[...state.contexts].map(id=>getFile(id)?.name).filter(Boolean).join(' · ');
  input.value='';state.quote=null;renderContexts();persistDraft();
  pendingMessages.set(args.id,{id:args.id,channel:key,role:'user',text,refs});
  conversationViews.set(key,{top:0,follow:true});$('.send-button').disabled=true;renderConversation();
  try {
    await api('/api/chat',args);
    // Admission only retires this attempt; later input belongs to the user.
    if(channel()===key)persistDraft();
    await refresh();
  }catch(error){
    await refresh().catch(()=>{});
    const recorded=(state.messages.get(key)||[]).some(message=>message.id===args.id);
    const saved=state.compositions.get(key)||{prompt:'',contexts:new Set(args.files),quote:null};
    if(recorded){/* The question is already in history; explicit edit/retry remains available. */}
    else if(channel()===key&&!input.value){input.value=text;state.quote=args.quote;renderContexts();persistDraft();}
    else{saved.failed={text,files:args.files,quote:args.quote};state.compositions.set(key,saved);if(channel()===key){renderContexts();persistDraft();}else saveDraft(key,{...saved,contexts:[...saved.contexts]});}
    toast(error.message);
  }finally{pendingMessages.delete(args.id);sending=false;$('.send-button').disabled=readonly||busy;renderConversation();}
}
$('#chat-form').addEventListener('submit', event => {event.preventDefault(); sendMessage();});
$('#prompt').addEventListener('keydown', event => {if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.isComposing) {event.preventDefault(); sendMessage();}});
function returnToDesktop(){state.folder=null;fileSearch='';$('#file-search').value='';setChatExpanded(false);backToDesktop();}
$('#home').addEventListener('click',event=>{event.preventDefault();returnToDesktop();});
$('#back').addEventListener('click',returnToDesktop);
$('#task-period').addEventListener('click',event=>{const button=event.target.closest('[data-period]');if(button){taskPeriod=button.dataset.period;renderTasks();}});
$('#task-course').addEventListener('change',event=>{taskCourse=event.target.value;renderTasks();});
$('#tasks').addEventListener('toggle',event=>{const key=event.target.dataset.taskGroup;if(!key)return;if(key==='completed'){if(event.target.open)collapsedTaskGroups.add('completed-open');else collapsedTaskGroups.delete('completed-open');}else if(event.target.open)collapsedTaskGroups.delete(key);else collapsedTaskGroups.add(key);},true);
$('#tasks').addEventListener('change',async event=>{const input=event.target.closest('[data-task]');if(!input)return;try{await operation('check_task',{task:input.dataset.task,done:input.checked});await refresh();}catch(error){toast(error.message);await refresh(true);}});
$('#tasks').addEventListener('click',event=>{const button=event.target.closest('[data-task-open]');if(button?.dataset.taskOpen)openFile(button.dataset.taskOpen);else if(button){collapseAssistant(false);insertPrompt('关于任务“'+tasks.find(t=>t.id===button.dataset.taskId).title+'”，');$('#prompt').focus();}});
$('#reader-modes').addEventListener('click',event=>{const button=event.target.closest('[data-mode]');if(button){saveScroll();getFile(state.active).mode=button.dataset.mode;persistReader(getFile(state.active));renderTask();}});
$('.workspace').addEventListener('scroll',()=>{$('#quote-bar').hidden=true;clearTimeout(draftTimer);draftTimer=setTimeout(persistDraft,500);},{passive:true});
$('#folders').addEventListener('click', event => {const button = event.target.closest('[data-folder]');if(button)browseFolder(button.dataset.folder);});
$('#files-heading').addEventListener('click',event=>{const button=event.target.closest('[data-browse-folder]');if(button)browseFolder(button.dataset.browseFolder);});
$('#document-meta').addEventListener('click',event=>{const button=event.target.closest('[data-browse-folder]');if(button)browseFolder(button.dataset.browseFolder);});
$('#file-search').addEventListener('input',event=>{fileSearch=event.target.value;renderDesktop();});
$('#clear-file-search').addEventListener('click',()=>{fileSearch='';$('#file-search').value='';renderDesktop();$('#file-search').focus();});
$('#picker-body').addEventListener('input',event=>{if(!event.target.matches('.picker-search'))return;const query=event.target.value.trim().toLocaleLowerCase();let count=0;for(const choice of $$('.picker-option')){choice.hidden=!choice.textContent.toLocaleLowerCase().includes(query);if(!choice.hidden)count++;}const empty=$('.picker-no-results');if(empty)empty.hidden=Boolean(count);});
$('#clear-folder').addEventListener('click', () => browseFolder(folders.find(folder=>folder.id===state.folder)?.parent));
$('#new-folder').addEventListener('click', createFolder);
$('#move-files').addEventListener('click', moveFiles);
$('#move-first').addEventListener('click', () => {const selected = files.filter(file => state.selected.has(file.id)); const rest = files.filter(file => !state.selected.has(file.id)); files.splice(0, files.length, ...selected, ...rest); renderDesktop(); toast('所选文件已放到最前');});
$('#clear-selection').addEventListener('click', () => {for (const id of state.selected) state.contexts.delete(id); state.selected.clear(); renderDesktop(); renderContexts();});
$('#files').addEventListener('click', event => {const card = event.target.closest('[data-id]'); if (!card) return; if (event.target.closest('.file-open')) openFile(card.dataset.id);});
$('#files').addEventListener('dblclick', event => {const card = event.target.closest('[data-id]'); if (card && !event.target.closest('input')) openFile(card.dataset.id);});
$('#files').addEventListener('keydown', event => {if (event.target.matches('.file-open') && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); openFile(event.target.closest('[data-id]').dataset.id);}});
$('#files').addEventListener('change', event => {if (!event.target.matches('.file-check')) return; const id = event.target.closest('[data-id]').dataset.id; if (event.target.checked) {state.selected.add(id); state.contexts.add(id);} else {state.selected.delete(id); state.contexts.delete(id);} renderDesktop(); renderContexts();});
$('#files').addEventListener('dragstart', event => {draggedId = event.target.closest('[data-id]')?.dataset.id || null; if (draggedId) event.dataTransfer.setData('text/plain', draggedId);});
$('#files').addEventListener('dragover', event => {if (draggedId) event.preventDefault();});
$('#files').addEventListener('drop', event => {if (!draggedId) return; event.preventDefault(); const targetId = event.target.closest('[data-id]')?.dataset.id; if (targetId && targetId !== draggedId) {const from = files.findIndex(f => f.id === draggedId); const [file] = files.splice(from,1); files.splice(files.findIndex(f => f.id === targetId),0,file); renderDesktop(); toast('文件位置已调整');} draggedId = null;});
$('#folders').addEventListener('dragover',event=>{const folder=event.target.closest('[data-folder]');if(!draggedId||!folder||readonly)return;event.preventDefault();event.dataTransfer.dropEffect='move';folder.classList.add('drop-target');});
$('#folders').addEventListener('dragleave',event=>{const folder=event.target.closest('[data-folder]');if(folder&&!folder.contains(event.relatedTarget))folder.classList.remove('drop-target');});
$('#folders').addEventListener('drop',async event=>{
  const folder=event.target.closest('[data-folder]');if(!draggedId||!folder||readonly)return;
  event.preventDefault();folder.classList.remove('drop-target');
  const ids=state.selected.has(draggedId)?[...state.selected]:[draggedId],target=folder.dataset.folder;draggedId=null;
  try{clearTimeout(metadataTimer);await syncChain;await operation('metadata',{expected:serverVersion,files:ids.map(id=>({id,folder:target}))});state.selected.clear();await refresh(true);toast('已移入 '+folderPath(target));}catch(error){toast(error.message);await refresh(true);}
});
$('#files').addEventListener('dragend', () => {draggedId = null;});
$$('.assistant-toggle').forEach(button => button.addEventListener('click', () => collapseAssistant(!$('#shell').classList.contains('collapsed'))));
$('#restore-assistant').addEventListener('click', () => {collapseAssistant(false); $('#prompt').focus();});
$('#clear-context').addEventListener('click', () => {state.contexts.clear(); state.quote = null; renderContexts();});
$('#contexts').addEventListener('click',event=>{if(event.target.closest('#recover-prompt')){const failed=state.compositions.get(channel())?.failed;showPicker('未发送的问题',`<p class="picker-note">确认后放回输入框，保留正在写的内容。不会自动发送。</p><blockquote class="failed-prompt">${esc(failed.text)}</blockquote>`,()=>{insertPrompt(failed.text);for(const id of failed.files||[])if(getFile(id))state.contexts.add(id);if(failed.quote&&!state.quote)state.quote=failed.quote;delete state.compositions.get(channel()).failed;renderContexts();persistDraft();});return;}const open=event.target.closest('[data-open-context]');if(open){openFile(open.dataset.openContext,{keepConversation:true});return;}const remove = event.target.closest('[data-remove]'); if (remove) state.contexts.delete(remove.dataset.remove); if (event.target.closest('[data-remove-quote]')) state.quote = null; renderContexts();});
$('#attach-context').addEventListener('click', () => filePicker('关联桌面文件', ids => {state.contexts = new Set(ids); renderContexts();}, null, true));
$('#conversation').addEventListener('click', event => {const button = event.target.closest('[data-open-artifact]'); if(button)openFile(button.dataset.openArtifact,{keepConversation:true});});
$('#document-tabs').addEventListener('click', event => {const close = event.target.closest('[data-close-tab]'); if (close) {closeTab(close.dataset.closeTab); return;} const tab = event.target.closest('[data-tab]'); if (tab) openFile(tab.dataset.tab);});
$('#compare').addEventListener('click', () => filePicker('选择并排查看的文件', id => {saveScroll(); state.compare = id; renderTask();}, state.active));
$('#rename').addEventListener('click', () => {const file = getFile(state.active); showPicker('重命名文件', `<label><span class="sr-only">文件名称</span><input class="picker-input" id="rename-input" value="${esc(file.name)}" maxlength="120" required></label>`, () => {const name = $('#rename-input').value.trim(); if (!name) return; saveScroll(); file.name = name; renderDesktop(); renderTask(); renderContexts(); renderConversation(); toast('名称已更新，文件关联保留');});});
$('#document-area').addEventListener('scroll', () => {$('#quote-bar').hidden=true;},true);
$('#document-area').addEventListener('click', async event => {
  if(event.target.closest('.pdf-toolbar')) {$('#quote-bar').hidden=true;state.pendingQuote=null;}
  if (event.target.closest('#close-compare')) {saveScroll(); state.compare = null; renderTask();}
  const pane = event.target.closest('.document-pane'); if (!pane) return;
  if (event.target.closest('.save-answer')) {const answer = $('.answer-input', pane).value.trim(); if (!answer) {toast('先写下你的作答'); return;} state.answers.set(pane.dataset.file, answer); try {await operation('answer',{file:pane.dataset.file,text:answer});savedAnswers.set(pane.dataset.file,answer);await persistAnswer(pane.dataset.file,answer);$('.answer-status',pane).textContent='已保存';toast('原始作答已保存');}catch(error){toast(error.message);}}
  if (event.target.closest('.ask-answer')) {const answer = $('.answer-input', pane).value.trim(); if (!answer) {toast('先写下你的作答'); return;} state.answers.set(pane.dataset.file, answer);try{await operation('answer',{file:pane.dataset.file,text:answer});savedAnswers.set(pane.dataset.file,answer);await persistAnswer(pane.dataset.file,answer);state.contexts.add(pane.dataset.file); state.quote = {file:pane.dataset.file, text:answer, source:'作答',sha256:getFile(pane.dataset.file).sha256}; renderContexts(); collapseAssistant(false); insertPrompt('请检查这份作答的推导。'); $('#prompt').focus();}catch(error){toast(error.message);}}
});
$('#document-area').addEventListener('input',event=>{
  if(!event.target.matches('.answer-input'))return;
  const pane=event.target.closest('.document-pane'),id=pane.dataset.file,text=event.target.value;state.answers.set(id,text);$('.answer-status',pane).textContent='草稿尚未保存…';
  clearTimeout(answerTimers.get(id));answerTimers.set(id,setTimeout(async()=>{const saved=await persistAnswer(id,text);if(pane.isConnected&&event.target.value===text)$('.answer-status',pane).textContent=saved?'草稿已保留 · 尚未保存作答':'草稿尚未保存，请稍后重试';},400));
});
let readerTimer;
$('#document-area').addEventListener('reader-position',event=>{clearTimeout(readerTimer);readerTimer=setTimeout(()=>persistReader(getFile(event.detail.file)),400);});
function captureSelection() {
  const selection = window.getSelection(); if (!selection || !selection.rangeCount || selection.isCollapsed) return;
  const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  const end = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
  const pane = node?.closest('.document-pane');
  if (!pane || end?.closest('.document-pane') !== pane) return;
  const text = selection.toString().trim().slice(0,20000); if (!text) return;
  state.pendingQuote = {file:pane.dataset.file, text, sha256:getFile(pane.dataset.file).sha256, source:node.closest('[data-page-number]') ? `第 ${node.closest('[data-page-number]').dataset.pageNumber} 页选区` : '文字选区'};
  $('#quote-preview').textContent = `“${text}”`;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const workspace = $('.workspace').getBoundingClientRect();
  $('#quote-bar').style.left = `${Math.max(workspace.left+10,Math.min(rect.left,workspace.right-130))}px`;
  $('#quote-bar').style.top = `${Math.max(65,Math.min(rect.bottom+8,innerHeight-55))}px`;
  $('#quote-bar').hidden = false;
}
$('#document-area').addEventListener('mouseup', () => setTimeout(captureSelection,0));
$('#document-area').addEventListener('keyup', () => setTimeout(captureSelection,0));
$('#document-area').addEventListener('touchend', () => setTimeout(captureSelection,100));
$('#ask-selection').addEventListener('click', () => {if (!state.pendingQuote) return; state.quote = state.pendingQuote; state.contexts.add(state.quote.file); renderContexts(); collapseAssistant(false); $('#prompt').focus(); $('#prompt').placeholder = '关于这段内容，你想问什么？'; $('#quote-bar').hidden = true;});
$('#add-files').addEventListener('click', () => $('#file-input').click());
async function importFiles(incoming) {
  let saved=0;
  for (const raw of incoming) {
    const limit=raw.type.startsWith('audio/')?200:100;
    if(raw.size>limit*1024*1024){toast(`${raw.name} 超过 ${limit} MB`);continue;}
    try {
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(raw);});
      await operation('create',{name:raw.name,mime:raw.type,data,folder:null});saved++;
    }catch(error){toast(error.message);}
  }
  await refresh(true);if(saved){state.folder=null;backToDesktop();toast('已放到桌面待整理 · '+saved+' 份文件');}
}
$('#file-input').addEventListener('change', async event => {await importFiles(event.target.files); event.target.value = '';});
$('.workspace').addEventListener('dragover', event => {if (event.dataTransfer.types.includes('Files')) event.preventDefault();});
$('.workspace').addEventListener('drop', async event => {if (!event.dataTransfer.files.length) return; event.preventDefault(); await importFiles(event.dataTransfer.files);});
window.addEventListener('beforeunload', () => {for (const file of files) if (file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url);});
const divider = $('#divider');
function setAssistantWidth(width) {const sidebar=$('#shell').classList.contains('chats-hidden')?0:$('#chat-sidebar').getBoundingClientRect().width;const max = Math.min(760, window.innerWidth - sidebar - 340); const value = Math.max(300,Math.min(max,width)); document.documentElement.style.setProperty('--assistant-width', `${value}px`); divider.setAttribute('aria-valuenow', String(value));}
divider.addEventListener('pointerdown', event => {divider.setPointerCapture(event.pointerId);});
divider.addEventListener('pointermove', event => {if (divider.hasPointerCapture(event.pointerId)) setAssistantWidth(event.clientX - $('.assistant').getBoundingClientRect().left);});
divider.addEventListener('keydown', event => {if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault(); setAssistantWidth($('.assistant').getBoundingClientRect().width + (event.key === 'ArrowRight' ? 20 : -20));}});
// Conversation navigation is independent of the open file reader.
function conversationName(key){
  const chat=chats.find(chat=>chat.channel===key),first=(state.messages.get(key)||[]).find(message=>message.role==='user');
  return chat?.title||first?.text.split('\n')[0].slice(0,80)||(chatFile(key)?getFile(chatFile(key))?.name||removedFiles.find(file=>file.id===chatFile(key))?.name||'文件对话':'新对话');
}
function switchConversation(key,messageId=null){
  saveScroll();state.chatChannel=key;const file=chatFile(key);restoreComposition(file&&getFile(file)?[file]:[]);
  if(messageId)conversationViews.set(key,{top:0,follow:false});
  closeChatFind();renderContexts();renderConversation();persistLayout();
  if(messageId)jumpToMessage(messageId);
}
function jumpToMessage(id){
  const container=$('#conversation'),node=[...container.children].find(node=>node.dataset.message===id);if(!node)return;
  container.scrollTop+=node.getBoundingClientRect().top-container.getBoundingClientRect().top-12;
  conversationViews.set(channel(),{top:container.scrollTop,follow:false});persistDraft();
  node.classList.add('message-located');setTimeout(()=>node.classList.remove('message-located'),1600);persistDraft();
}
let historyStamp='';
function renderHistory(){
  const term=$('#history-search').value.trim().toLocaleLowerCase(),filter=$('#history-filter').value;
  const keys=[...new Set([...chats.map(chat=>chat.channel),...state.messages.keys(),channel()])];
  const entries=keys.map(key=>{
    const chat=chats.find(chat=>chat.channel===key),messages=state.messages.get(key)||[],name=conversationName(key),file=getFile(chatFile(key)),path=file?folderPath(file.folder):'';
    if((chat?.status||'open')!==filter)return null;
    if(!messages.length&&!chat?.title&&key!==channel())return null;
    const named=`${name} ${file?.name||''} ${path}`.toLocaleLowerCase().includes(term);
    const matches=messages.filter(message=>`${message.text} ${message.refs||''}`.toLocaleLowerCase().includes(term));
    if(term&&!named&&!matches.length)return null;
    return {key,name,path,file,messages,target:(named?messages:matches).at(-1),time:messages.at(-1)?.time||chat?.created||0,archived:chat?.status==='archived'};
  }).filter(Boolean).sort((a,b)=>b.time-a.time||a.key.localeCompare(b.key));
  const html=entries.map(({key,name,path,file,messages,target,archived,time})=>`<div class="history-row ${channel()===key?'current':''} ${archived?'archived':''}">
    <button type="button" class="history-open" data-chat-channel="${esc(key)}" data-chat-message="${term&&target?esc(target.id||''):''}" ${channel()===key?'aria-current="true"':''}><strong title="${esc(name)}">${esc(name)}</strong><small title="${esc(file?.name||'桌面对话')}${path?' · '+esc(path):''}">${esc(file?.name||'桌面对话')}${archived?' · 已归档':''}${conversationAge(time)?' · '+conversationAge(time):''}</small>${term&&target?`<span>${esc(target.text.slice(0,110))}</span>`:''}</button>
    <details class="chat-row-menu" data-row-menu="${esc(key)}"><summary aria-label="管理对话：${esc(name)}">···</summary><div><button type="button" data-chat-action="rename" data-channel="${esc(key)}" ${readonly?'disabled':''}>重命名</button><button type="button" data-chat-action="${archived?'restore':'archive'}" data-channel="${esc(key)}" ${readonly||busy?'disabled':''}>${archived?'取消归档':'归档'}</button><button type="button" class="chat-delete" data-chat-action="delete" data-channel="${esc(key)}" ${readonly||busy?'disabled':''}>删除</button></div></details>
    ${chatRowEdit===key?`<form class="chat-row-edit" data-chat-rename="${esc(key)}"><input aria-label="对话名称" maxlength="180" value="${esc(name)}" required><button type="submit">保存</button><button type="button" data-chat-action="cancel">取消</button></form>`:''}
    ${chatRowDelete===key?`<div class="chat-row-confirm"><p>删除这段对话和草稿？课程文件、任务和学习成果保留。</p><button type="button" class="chat-delete" data-chat-action="confirm-delete" data-channel="${esc(key)}">删除对话</button><button type="button" data-chat-action="cancel">取消</button></div>`:''}
    </div>`).join('')||`<p class="picker-note">${term?'没有找到对应对话':filter==='archived'?'还没有归档对话':'点击新建对话，或直接向助理提问'}</p>`;
  $('#new-chat').disabled=readonly;
  if(html===historyStamp||((chatRowEdit||chatRowDelete)&&document.activeElement?.closest('.chat-row-edit')))return;
  const opened=new Set($$('#history-results details[open]').map(node=>node.dataset.rowMenu));
  closeConversationMenus();
  historyStamp=html;$('#history-results').innerHTML=html;
  for(const node of $$('#history-results details'))if(opened.has(node.dataset.rowMenu))node.open=true;
}
function resizeComposer(){const input=$('#prompt');input.style.height='24px';input.style.height=Math.min(160,Math.max(24,input.scrollHeight))+'px';}
function setChatExpanded(expanded){$('#shell').classList.toggle('chat-expanded',expanded);$('#expand-chat').setAttribute('aria-label',expanded?'返回文件与对话':'展开对话');$('#expand-chat').title=expanded?'返回文件与对话':'展开对话';}
$('#expand-chat').addEventListener('click',()=>{collapseAssistant(false);setChatExpanded(!$('#shell').classList.contains('chat-expanded'));});
if(matchMedia('(max-width:720px)').matches)$('#shell').classList.add('chats-hidden');
function openHistory(){
  $('#shell').classList.remove('chats-hidden');$('#conversation-menu').setAttribute('aria-expanded','true');
  renderHistory();
}
$('#conversation-menu').addEventListener('click',openHistory);
$('#hide-chat-sidebar').addEventListener('click',()=>{$('#shell').classList.add('chats-hidden');$('#conversation-menu').setAttribute('aria-expanded','false');});
$('#history-search').addEventListener('input',renderHistory);
$('#history-filter').addEventListener('change',()=>{chatRowEdit=chatRowDelete=null;renderHistory();});
let chatManaging=false;
async function manageChat(action,key,extra={}){
  if(chatManaging)return;chatManaging=true;
  const current=channel(),file=chatFile(key);state.chatChannel=current;
  try{
    if(await persistDraft()===false)throw new Error('未能保存草稿，请重试后再管理对话');
    await draftChain;
    const result=await api('/api/chats',{action,channel:key,...extra});
    chatRowEdit=chatRowDelete=null;
    if(action==='delete'){state.compositions.delete(key);conversationViews.delete(key);}
    await refresh(true);
    if(action==='create'){switchConversation(result.channel);$('#history-filter').value='open';}
    else if((action==='archive'||action==='delete')&&current===key)switchConversation(defaultChat(file));
    renderHistory();persistLayout();
    toast({create:'已新建对话',archive:'已归档，可在已归档列表恢复',restore:'已取消归档',delete:'对话已删除',rename:'名称已保存'}[action]);
    if(action==='create')$('#prompt').focus();
  }catch(error){toast(error.message);}finally{chatManaging=false;}
}
$('#new-chat').addEventListener('click',()=>manageChat('create',null,{file:chatFile(channel())||null}));
$('#chat-unavailable').addEventListener('click',event=>{if(event.target.closest('#restore-chat'))manageChat('restore',channel());});
$('#history-results').addEventListener('click',event=>{
  const action=event.target.closest('[data-chat-action]');
  if(action){
    const key=action.dataset.channel;action.closest('details')?.removeAttribute('open');
    if(action.dataset.chatAction==='rename'){chatRowDelete=null;chatRowEdit=key;renderHistory();$('#history-results input')?.focus();$('#history-results input')?.select();}
    else if(action.dataset.chatAction==='delete'){chatRowEdit=null;chatRowDelete=key;renderHistory();}
    else if(action.dataset.chatAction==='cancel'){chatRowEdit=chatRowDelete=null;historyStamp='';renderHistory();}
    else manageChat(action.dataset.chatAction==='confirm-delete'?'delete':action.dataset.chatAction,key);
    return;
  }
  const button=event.target.closest('[data-chat-channel]');if(!button)return;
  chatRowEdit=chatRowDelete=null;switchConversation(button.dataset.chatChannel,button.dataset.chatMessage||null);
  if(matchMedia('(max-width:720px)').matches)$('#shell').classList.add('chats-hidden');
});
$('#history-results').addEventListener('submit',event=>{event.preventDefault();const form=event.target.closest('[data-chat-rename]');if(form)manageChat('rename',form.dataset.chatRename,{title:$('input',form).value});});
function updateChatFind(step=0,jump=false){
  const nodes=$$('#conversation .message'),term=chatFind.query.toLocaleLowerCase();
  const matches=term?nodes.filter(node=>node._message?.text.toLocaleLowerCase().includes(term)):[];
  let index=matches.findIndex(node=>node.dataset.message===chatFind.id);
  if(index<0)index=0;else if(step)index=(index+step+matches.length)%matches.length;
  chatFind.id=matches[index]?.dataset.message||null;
  for(const node of nodes){node.classList.toggle('find-match',matches.includes(node));node.classList.toggle('find-current',node.dataset.message===chatFind.id);}
  $('#chat-find-count').textContent=term?(matches.length?`${index+1}/${matches.length} 条`:'无结果'):'';
  $('#chat-find-prev').disabled=$('#chat-find-next').disabled=!matches.length;
  if(jump&&chatFind.id)jumpToMessage(chatFind.id);
}
function openChatFind(){collapseAssistant(false);$('#chat-find').hidden=false;$('#chat-find-input').focus();$('#chat-find-input').select();}
function closeChatFind(){$('#chat-find').hidden=true;$('#chat-find-input').value='';chatFind.query='';chatFind.id=null;updateChatFind();}
$('#find-chat').addEventListener('click',openChatFind);
$('#chat-find-input').addEventListener('input',event=>{chatFind.query=event.target.value.trim();chatFind.id=null;updateChatFind(0,true);});
$('#chat-find-input').addEventListener('keydown',event=>{if(event.isComposing)return;if(event.key==='Enter'){event.preventDefault();updateChatFind(event.shiftKey?-1:1,true);}if(event.key==='Escape'){event.preventDefault();closeChatFind();$('#find-chat').focus();}});
$('#chat-find-prev').addEventListener('click',()=>updateChatFind(-1,true));
$('#chat-find-next').addEventListener('click',()=>updateChatFind(1,true));
$('#chat-find-close').addEventListener('click',closeChatFind);
function insertPrompt(text){
  collapseAssistant(false);const input=$('#prompt');
  // Deliberate insertions append to an existing question instead of replacing it.
  input.value=input.value?input.value+'\n\n'+text:text;input.focus();input.setSelectionRange(input.value.length,input.value.length);resizeComposer();persistDraft();
}
$('#conversation').addEventListener('click',async event=>{
  const message=event.target.closest('.message')?._message;if(!message)return;
  const copy=event.target.closest('[data-copy-message],.copy-code');
  if(copy){
    const text=copy.matches('.copy-code')?copy.closest('.chat-code').querySelector('pre').textContent:message.text;
    try{const {writeClipboard}=await import('./clipboard.mjs');if(await writeClipboard(text)){const label=copy.textContent;copy.textContent='已复制';setTimeout(()=>{copy.textContent=label;},1200);}else toast('无法复制，请选中文字后复制');}catch{toast('暂时无法复制，请选中文字后复制');}return;
  }
  if(event.target.closest('[data-reuse-message]')){
    if(readonly||$('#prompt').disabled){toast('请先切换到可提问的对话');return;}
    insertPrompt(message.role==='user'?message.text:'关于这段回答：\n'+message.text.split('\n').map(line=>'> '+line).join('\n')+'\n\n');
    if(message.role==='user'){for(const id of message.files||[])if(getFile(id))state.contexts.add(id);if(message.quote&&!state.quote&&getFile(message.quote.file)?.sha256===message.quote.sha256)state.quote=message.quote;renderContexts();persistDraft();}
  }
});
document.addEventListener('keydown',event=>{
  if(event.isComposing||event.altKey||$('#picker').open||!(event.metaKey||event.ctrlKey))return;
  const key=event.key.toLocaleLowerCase();
  if(key==='k'){event.preventDefault();filePicker('快速打开文件',id=>openFile(id));}
  if(key==='f'&&event.shiftKey){event.preventDefault();openHistory();}
  else if(key==='f'&&event.target.closest('.assistant')){event.preventDefault();openChatFind();}
  if(key==='w'&&state.active){event.preventDefault();closeTab(state.active);}
});

renderDesktop(); renderContexts(); renderConversation(); renderTabs();
refresh(true).then(()=>{connectChat();$('.prototype-note').textContent='文件与对话自动保存';}).catch(error=>{toast('暂时无法连接，请重新打开软件。');$('.prototype-note').textContent='尚未连接服务';});
if (matchMedia('(max-width:720px)').matches) collapseAssistant(true);

let draftTimer;
$('#prompt').addEventListener('input',()=>{resizeComposer();clearTimeout(draftTimer);draftTimer=setTimeout(persistDraft,400);});
$('#stop-agent').addEventListener('click',async()=>{try{await api('/api/stop',{});await refresh();}catch(error){toast(error.message);}});
$('#new-task').addEventListener('click',()=>{showPicker('新建任务',`<input id="task-title" class="picker-input" placeholder="要做什么？" required><label class="settings-label">课程<select id="task-new-course" class="picker-input"><option value="">其他事项</option>${courses.map(course=>`<option value="${esc(course.id)}">${esc(course.name)}</option>`).join('')}</select></label><label class="settings-label">安排日期<input id="task-date" class="picker-input" type="date" value="${localDay()}"></label><p class="picker-note">日期留空表示暂不安排，可在“全部”中找到。</p>`,async()=>{try{await operation('task',{title:$('#task-title').value,course:$('#task-new-course').value||undefined,date:$('#task-date').value||null});await refresh();}catch(error){toast(error.message);}});$('#task-new-course').value=taskCourse;});
$('#transcribe-file').addEventListener('click',async()=>{
  const file=getFile(state.active),job=transcription.jobs.find(item=>item.file===file.id&&item.source_sha256===file.sha256);
  if(job?.status==='completed'){openFile(job.transcript);return;}
  const button=$('#transcribe-file');button.disabled=true;
  try {
    if(job?.status==='running')await api('/api/transcription',{action:'stop',args:{job:job.id}});
    else {
      const resources=await api('/api/transcription',{action:'check',args:{}});
      if(!resources.eligible){toast(resources.message+'。已有文字稿可直接使用。');return;}
      const allow_install=!transcription.installed;
      if(allow_install&&!confirm('已有讲稿或转写稿？直接添加文字文件即可，无需安装。\n\n'+resources.message+'\n首次下载约 3.8 GiB 模型及运行环境；检测要求至少 '+resources.required_disk_gib+' GiB 空闲磁盘、'+resources.required_memory_gib+' GiB 实际可用内存。录音在本机处理。是否下载并开始？'))return;
      const result=await api('/api/transcription',{action:'start',args:{file:file.id,expected:file.sha256,allow_install}});
      toast((result.needs_install||result.blocked)?result.message:'正在转写；原录音会保留');
    }
    await refresh(true);
  }catch(error){toast(error.message);}finally{button.disabled=readonly;}
});
$('#compile-file').addEventListener('click',async()=>{
  const file=getFile(state.active),button=$('#compile-file');button.disabled=true;button.textContent='编译中…';
  try{const result=await operation('compile',{file:file.id,expected:file.sha256});await refresh(true);if(result.ok){getFile(file.id).mode='pdf';renderTask();toast('PDF 已生成，等待内容与版式核验');}else{toast('编译失败，已保留上一版 PDF');}}
  catch(error){toast(error.message);}finally{button.disabled=false;button.textContent='编译 PDF';}
});
$('#view-pdf').addEventListener('click',()=>{const file=getFile(state.active);file.mode=file.mode==='pdf'?'source':'pdf';persistReader(file);renderTask();});
$('#edit-file').addEventListener('click',()=>{
  const file=getFile(state.active),expected=file.sha256;
  showPicker('编辑源码','<textarea id="edit-text" class="source-editor" aria-label="文件源码"></textarea>',async()=>{
    await operation('write',{file:file.id,expected,text:$('#edit-text').value});await refresh(true);toast('已保存新版本');if(formatFor(file)==='latex'&&state.active===file.id)$('#compile-file').click();
  });$('#edit-text').value=file.text;
});
$('#history-file').addEventListener('click',async()=>{
  const file=getFile(state.active);
  try{const {versions}=await operation('history',{file:file.id});const distinct=[...new Map(versions.map(v=>[v.sha256,v])).values()].reverse();showPicker('恢复文件版本',distinct.map((v,i)=>`<label class="picker-option"><input type="radio" name="version" value="${esc(v.sha256)}"><span>${i===0?'当前版本':'历史版本 '+i}</span></label>`).join(''),async()=>{const version=$('#picker-body input:checked')?.value;if(!version)return;try{await operation('restore',{file:file.id,expected:file.sha256,version});await refresh(true);toast('已恢复，后续版本仍保留');}catch(error){toast(error.message);}});}catch(error){toast(error.message);}
});

window.addEventListener('pagehide',()=>{
  if(readonly)return;
  const key=channel(),value=compositionValue();
  const beacon=(channel,value)=>navigator.sendBeacon('/api/workspace',new Blob([JSON.stringify({action:'draft',args:{channel,value},semester:semesterId})],{type:'application/json'}));
  if(!chatLocked(key))beacon(key,value);for(const [id,text] of state.answers)if(text!==(savedAnswers.get(id)||''))beacon('__answer:'+id,{text});for(const pane of $$('.document-pane')){const file=getFile(pane.dataset.file);if(file)beacon('__reader:'+file.id,readerState(file));}
});

// One unobtrusive menu; ordinary learning does not require a configuration page.
$('#semester-menu').addEventListener('click',()=>{
  if(!semesterList)return;
  const choices=semesterList.items.map(s=>`<label class="picker-option"><input type="radio" name="semester" value="${esc(s.id)}" ${s.id===semesterId?'checked':''}><span>${esc(s.name)}${s.status==='archived'?' · 已归档':s.status==='removed'?' · 已移除':''}</span></label>`).join('');
  showPicker('学期',choices+`<select id="semester-action" class="picker-input" aria-label="学期操作"><option value="switch">打开选中学期</option><option value="create">开始新学期</option><option value="rename">重命名</option><option value="archive">归档，保留记录</option><option value="reopen">重新开始</option><option value="remove">移除，可恢复</option><option value="restore">恢复已移除学期</option><option value="export">下载选中学期备份</option><option value="import">恢复备份为独立学期</option></select><input id="semester-backup" class="picker-input" type="file" accept=".zip" hidden><p class="picker-note">通用学习习惯和助理流程独立保存，换学期仍保留。旧任务与课程状态不会带入新学期。</p>`,async()=>{
    const action=$('#semester-action').value,id=$('#picker-body input:checked')?.value;
    const selected=semesterList.items.find(s=>s.id===id);
    if(!selected)return;
    if(action==='import'){
      const file=$('#semester-backup').files[0];if(!file){toast('请先选择学期备份文件');return;}
      if(file.size>50*1024**3){toast('备份超过当前支持的 50 GB');return;}
      try{const response=await fetch('/api/semester-import?expected='+semesterList.version,{method:'POST',headers:{'Content-Type':'application/zip'},body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);await refresh(true);toast('已恢复为独立学期，原有学期未改动');}catch(error){toast(error.message);}return;
    }
    if(action==='export'){location.href='/api/semester-export?semester='+id;return;}
    const args={semester:id,expected:semesterList.version};
    if(action==='create'||action==='rename'){args.name=window.prompt(action==='create'?'新学期叫什么？':'学期名称',action==='rename'?selected.name:'');if(!args.name)return;}
    if(action==='archive'&&!window.confirm('归档后保留文件、对话和未完成任务，可以重新开始。现在归档“'+selected.name+'”？'))return;
    if(action==='remove'){args.confirm=window.prompt('移除后可以恢复。请输入要移除的学期名称：'+selected.name);if(args.confirm===null)return;}
    try{await syncChain;await api('/api/semesters',{action,args});location.reload();}catch(error){toast(error.message);await refresh();}
  });
  $('#semester-action').addEventListener('change',()=>{$('#semester-backup').hidden=$('#semester-action').value!=='import';});
});
$('#remove-files').addEventListener('click',async()=>{
  const chosen=[...state.selected].map(getFile).filter(Boolean);
  if(!chosen.length||!window.confirm('移除这 '+chosen.length+' 份文件？可从“已移除”恢复；课程原件、任务与学习记录保留。'))return;
  try{for(const file of chosen)await operation('remove_file',{file:file.id,expected:file.sha256});state.selected.clear();await refresh(true);}catch(error){toast(error.message);}
});
$('#file-trash').addEventListener('click',()=>showPicker('恢复文件',removedFiles.map(f=>`<label class="picker-option"><input type="radio" name="removed-file" value="${esc(f.id)}"><span>${esc(f.name)}</span></label>`).join(''),async()=>{
  const file=removedFiles.find(f=>f.id===$('#picker-body input:checked')?.value);if(!file)return;
  try{await operation('restore_file',{file:file.id,expected:file.sha256});await refresh(true);}catch(error){toast(error.message);}
}));

let settingsChecked=false;
let modelSetupNeeded=false;
let updateState=null;
function updateControls(){
  if(!updateState||updateState.status==='disabled')return '';
  const action=updateState.status==='available'?'download':updateState.status==='ready'?'install':'check';
  const waiting=['checking','downloading','installing'].includes(updateState.status);
  const label=action==='download'?'下载更新':action==='install'?(updateState.installKind==='installer'?'安装更新':'重启更新'):'检查更新';
  return `<section id="update-settings" class="update-settings"><strong>软件更新</strong><small>当前版本 ${esc(updateState.current)}</small><p>${esc(updateState.message||'可以检查是否有新版本')}${updateState.status==='downloading'?' '+updateState.percent+'%':''}</p><button type="button" class="button subtle" data-update-action="${action}" ${waiting?'disabled':''}>${label}</button>${updateState.canInstall?'':'<p class="picker-note">这版需要从下载页面安装新版，学习资料会保留。</p>'}</section>`;
}
function showUpdateState(value){
  updateState=value;
  const button=$('#app-update');button.hidden=!['available','downloading','ready','installing'].includes(value.status);
  button.textContent=value.status==='ready'?(value.installKind==='installer'?'安装更新':'重启更新'):value.status==='downloading'?'更新 · '+value.percent+'%':'有新版本';
  const panel=$('#update-settings');if(panel)panel.outerHTML=updateControls();
}
$('#app-update').addEventListener('click',()=>{if(updateState.status==='ready')runUpdate('install');else if(updateState.status==='available')runUpdate('download');else toast(updateState.message);});
async function runUpdate(action){
  try{
    if(action==='install'){
      if($('#edit-text')){toast('请先保存或取消当前文件编辑，再更新软件');return;}
      if($('#model-key')?.value){toast('请先保存设置，再重启更新');return;}
      const settings=await api('/api/settings');
      if($('#model-key')?.value||($('#model-choice')&&$('#model-choice').value!==settings.model)){toast('请先保存设置，再更新软件');return;}
      const current=await api('/api/state');
      if([...state.answers].some(([id,text])=>text.trim()!==(current.answers[id]||'').trim())){toast('请先保存尚未保存的作答，再重启更新');return;}
      if(await persistDraft()===false){toast('请先保存草稿，再更新软件');return;}
      await draftChain;
    }
    showUpdateState(await window.studyDesktop.updates[action]());
  }catch{toast('暂时无法完成更新，请稍后重试');}
}
$('#picker-body').addEventListener('click',event=>{const action=event.target.closest('[data-update-action]')?.dataset.updateAction;if(action)runUpdate(action);});
if(window.studyDesktop?.updates){window.studyDesktop.updates.subscribe(showUpdateState);window.studyDesktop.updates.state().then(showUpdateState).catch(()=>{});}
async function openSettings(){
  if($('#edit-text')){toast('请先保存或取消当前编辑，再打开设置');return;}
  const settings=await api('/api/settings');
  showPicker('设置',`${updateControls()}<p class="picker-note">填写 DeepSeek 的服务密钥，让助理回答问题。阅读文件、手动整理无需先填写。</p><label class="settings-label">模型服务密钥<input id="model-key" class="picker-input" type="password" autocomplete="off" placeholder="${settings.configured?'已保存；留空保留现有密钥':'填写你的密钥'}"></label><a class="text-button" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">获取密钥</a><label class="settings-label">助理模型<select id="model-choice" class="picker-input"><option value="deepseek-flash">DeepSeek Flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro（文本）</option></select></label>`,async()=>{
    await api('/api/settings',{api_key:$('#model-key').value,model:$('#model-choice').value,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});modelSetupNeeded=false;$('#model-setup').hidden=true;$('#model-key').value='';toast('设置已保存');
  });
  $('#model-choice').value=settings.model;
}
$('#settings').addEventListener('click',()=>openSettings().catch(error=>toast(error.message)));
$('#setup-assistant').addEventListener('click',()=>openSettings().catch(error=>toast(error.message)));
async function checkSettings(){if(settingsChecked)return;settingsChecked=true;try{const value=await api('/api/settings');modelSetupNeeded=Boolean(value.needs_setup);$('#model-setup').hidden=!modelSetupNeeded;}catch(error){toast(error.message);}}
checkSettings();

setInterval(()=>refresh().catch(()=>{}),2000);
import('./harness-ui.mjs').then(({relativeTime,installConversationMenus})=>{
  harnessRelativeTime=relativeTime;
  closeConversationMenus=installConversationMenus($('#history-results'));
  historyStamp='';renderHistory();
}).catch(()=>toast('对话菜单未能加载，请重新打开软件'));
