'use strict';
// The desktop and assistant share the cloud workspace and upstream Harness.
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const files = [];
const folders = [];
const tasks = [];
let transcription={installed:false,jobs:[]};
let semesterId=null,semesterList=null,readonly=false,removedFiles=[];
let serverVersion = -1, applying = false, metadataTimer, busy = false, sending = false;
let savedMetadata = '', syncChain = Promise.resolve();
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
  for(const element of $$('#new-folder,#new-task,#add-files,#remove-files,#move-files,#move-first,#rename,#edit-file,#compile-file,#transcribe-file,#prompt,.send-button,.quick-actions button'))element.disabled=readonly;
  for(const file of data.files){file.source+='?semester='+semesterId;file.url+='&semester='+semesterId;}
  busy=data.runtime.status==='running';
  if(data.warnings?.length)$('.prototype-note').textContent='课程文件有其他修改，已保留版本，待助理核对';
  $('#stop-agent').hidden=!busy;
  $('.preview-label').textContent=busy ? '助理处理中' : '学习桌';
  if (!force && metadata()!==savedMetadata && serverVersion>=0) return;
  const contentChanged = force || JSON.stringify(files.map(f=>[f.id,f.sha256,f.name,f.folder,f.pdf,f.compile_result,f.accepted])) !== JSON.stringify(data.files.map(f=>[f.id,f.sha256,f.name,f.folder,f.pdf,f.compile_result,f.accepted]));
  applying=true;
  const old = new Map(files.map(file=>[file.id,file]));
  files.splice(0,files.length,...data.files.map(file=>({...old.get(file.id),...file})));
  folders.splice(0,folders.length,...data.folders);
  tasks.splice(0,tasks.length,...data.tasks);
  state.messages=new Map(Object.entries(data.messages));
  for(const [id,text] of Object.entries(data.answers)) if(!state.answers.has(id)) state.answers.set(id,text);
  const firstLoad=serverVersion<0;
  if (firstLoad) {
    for(const [id,value] of Object.entries(data.drafts)) {
      state.compositions.set(id,{...value,contexts:new Set(value.contexts||[])});
      if(value.scroll!==undefined)state.scrolls.set(id,value.scroll);
    }
    restoreComposition([]);
  }
  serverVersion=data.version;
  savedMetadata=metadata();
  renderDesktop(); renderConversation();renderContexts();renderTabs();
  if(state.active && contentChanged)renderTask();
  if(firstLoad && data.drafts.__layout){const layout=data.drafts.__layout;state.tabs=(layout.tabs||[]).filter(id=>getFile(id));state.folder=folders.some(f=>f.id===layout.folder)||layout.folder==='unfiled'?layout.folder:null;if(layout.active && getFile(layout.active))openFile(layout.active);else renderDesktop();}
  applying=false;
}
let layoutChain=Promise.resolve();
function persistLayout(){if(readonly)return;const value={active:state.active,tabs:[...state.tabs],folder:state.folder,deskScroll:state.deskScroll};layoutChain=layoutChain.then(()=>api('/api/workspace',{action:'draft',args:{channel:'__layout',value}})).catch(()=>{});}
function persistDraft() {
  if(readonly)return;
  const key=channel();
  const value={prompt:$('#prompt').value,contexts:[...state.contexts],quote:state.quote,scroll:$('.workspace').scrollTop};
  state.compositions.set(key,{...value,contexts:new Set(value.contexts)});
  api('/api/workspace',{action:'draft',args:{channel:key,value}}).catch(error=>toast(error.message));
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
function renderTasks() {
  $('#tasks').innerHTML = tasks.map(task => `<div class="task-row ${task.done ? 'done' : ''}"><input type="checkbox" data-task="${esc(task.id)}" aria-label="完成任务 ${esc(task.title)}" ${task.done ? 'checked' : ''} ${readonly || task.actor==='agent' ? 'disabled' : ''}><button data-task-id="${esc(task.id)}" data-task-open="${esc(task.file || '')}">${esc(task.title)}</button><span>${esc(getFile(task.file)?.name || '')}</span></div>`).join('');
}
const state = {folder:null, selected:new Set(), contexts:new Set(), quote:null, active:null, compare:null, tabs:[], messages:new Map(), compositions:new Map(), scrolls:new Map(), answers:new Map(), deskScroll:0, nextId:1};
let draggedId = null;
let toastTimer;
let pickerCallback;
const getFile = id => files.find(file => file.id === id);
const channel = () => state.active || 'desktop';
const visibleFiles = () => files.filter(file => !state.folder || (state.folder === 'unfiled' ? !file.folder : file.folder === state.folder));
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 3600); }
function renderDesktop() {
  persistMetadata();
  const atRoot = !state.folder;
  const rootFolders = [...folders, {id:'unfiled', name:'未整理'}];
  $('#folders').hidden = !atRoot;
  $('#task-list').hidden = !atRoot;
  renderTasks();
  $('#folders').innerHTML = rootFolders.map(folder => `<button class="folder" data-folder="${esc(folder.id)}" aria-label="${esc(folder.name)}">${icon('folder')}<span><strong>${esc(folder.name)}</strong><small>${files.filter(file => folder.id === 'unfiled' ? !file.folder : file.folder === folder.id).length} 份文件</small></span></button>`).join('');
  $('#files-heading').textContent = atRoot ? '' : rootFolders.find(f => f.id === state.folder).name;
  $('#clear-folder').hidden = atRoot;
  $('#add-files').hidden = atRoot;
  $('#new-folder').hidden = !atRoot;
  const visible = visibleFiles();
  $('#files').hidden = atRoot;
  $('#files').classList.add('list');
  $('#files').innerHTML = visible.map(file => `<article class="file-card ${state.selected.has(file.id) ? 'selected' : ''}" draggable="true" data-id="${esc(file.id)}"><input type="checkbox" class="file-check" aria-label="选择 ${esc(file.name)}" ${state.selected.has(file.id) ? 'checked' : ''}><button class="file-open" aria-label="打开 ${esc(file.name)}">${icon('file')}<span>${esc(file.name)}</span></button></article>`).join('');
  $('#empty').hidden = atRoot || visible.length !== 0;
  $('#selection-bar').hidden = atRoot || state.selected.size === 0;
  $('#selection-count').textContent = `已选择 ${state.selected.size} 份文件`;
}
function renderContexts() {
  const chips = [...state.contexts].filter(id => getFile(id)).map(id => `<span class="context-chip"><span>${esc(getFile(id).name)}</span><button type="button" data-remove="${esc(id)}" aria-label="移除关联 ${esc(getFile(id).name)}">×</button></span>`);
  if (state.quote) chips.push(`<span class="context-chip"><span>选区 · ${esc(state.quote.text.slice(0,30))}</span><button type="button" data-remove-quote aria-label="移除选区">×</button></span>`);
  $('#contexts').innerHTML = chips.length ? chips.join('') : '<span>尚未关联文件 · 可点 ＋ 添加</span>';
  $('#clear-context').hidden = chips.length === 0;
  $('.context-heading').hidden = chips.length === 0;
  $('#contexts').hidden = chips.length === 0;
}
function renderConversation() {
  const container = $('#conversation');
  const messages = state.messages.get(channel()) || [];
  container.innerHTML = '';
  if (!messages.length) {
    const welcome = document.createElement('div'); welcome.className = 'welcome';
    welcome.innerHTML = readonly ? '<p>这个学期已归档，文件和记录保留。需要修改或提问时，可以重新开始。</p>' : '<p>可以放入课程材料，也可以直接告诉我你想学什么。</p>';
    container.append(welcome);
  }
  for (const message of messages) {
    const div = document.createElement('div'); div.className = `message ${message.role === 'user' ? 'user' : 'assistant-message'}`;
    const label = document.createElement('span'); label.className = 'message-meta'; label.textContent = message.role === 'user' ? '你' : '助理'; div.append(label);
    if (message.refs) { const refs = document.createElement('span'); refs.className = 'message-ref'; refs.textContent = message.refs; div.append(refs); }
    const body = document.createElement('div');body.className='chat-body';if(message.role==='assistant')body.innerHTML=markdownPreview(message.text);else body.textContent=message.text;div.append(body);
    if (message.file) {const button = document.createElement('button'); button.className = 'message-artifact'; button.dataset.openArtifact = message.file; button.innerHTML = `${icon('file')}<span>${esc(getFile(message.file).name)}</span>${icon('arrow')}`; div.append(button);}
    if(message===messages[messages.length-1] && message.role==='assistant') {for(const file of files.filter(f=>f.session==='desktop-'+channel())){const button=document.createElement('button');button.className='message-artifact';button.dataset.openArtifact=file.id;button.textContent=file.name;div.append(button);}}
    container.append(div);
  }
  if (messages.length) container.scrollTop = container.scrollHeight;
}
function addMessage(role, text, extra = {}) {
  const key = channel(); if (!state.messages.has(key)) state.messages.set(key, []);
  state.messages.get(key).push({role, text, ...extra}); renderConversation();
}
function saveScroll() {
  persistDraft();
  state.compositions.set(channel(), {prompt:$('#prompt').value, contexts:new Set(state.contexts), quote:state.quote});
  if (!state.active) state.deskScroll = $('.workspace').scrollTop;
  for (const pane of $$('.document-pane')) {
    const answer = $('.answer-input', pane); if (answer) state.answers.set(pane.dataset.file, answer.value);
  }
  if (state.active) state.scrolls.set(state.active, $('.workspace').scrollTop);
}
function restoreComposition(defaultContexts) {
  const saved = state.compositions.get(channel());
  state.contexts = saved ? new Set(saved.contexts) : new Set(defaultContexts);
  state.quote = saved?.quote || null;
  state.pendingQuote = null;
  $('#prompt').value = saved?.prompt || '';
}
function openFile(id) {
  setTimeout(persistLayout,0);
  if (!getFile(id)) return;
  saveScroll(); const changed = state.active !== id;
  state.active = id; state.compare = null;
  if (!state.tabs.includes(id)) state.tabs.push(id);
  if (changed) restoreComposition([id]);
  $('#desktop').hidden = true; $('#task').hidden = false;
  renderTask(); renderContexts(); renderConversation();
  $('.workspace').scrollTop = state.scrolls.get(id) || 0;
  if (matchMedia('(max-width:720px)').matches) collapseAssistant(true);
}
function backToDesktop() {
  setTimeout(persistLayout,0);
  saveScroll(); disposePdfReaders(); state.active = null; state.compare = null; restoreComposition(state.selected);
  $('#desktop').hidden = false; $('#task').hidden = true;
  renderDesktop(); renderContexts(); renderConversation(); renderTabs(); $('.workspace').scrollTop = state.deskScroll;
}
function paper(file) {
  if (file.loadError) return `<div class="reader-empty">${esc(file.loadError)}。请通过静态预览服务打开此页面。</div>`;
  let body;
  if (file.text !== undefined) {
    body = formatFor(file) === 'markdown' && file.mode !== 'source' ? `<article class="markdown-body">${markdownPreview(file.text)}</article>` : `<pre class="file-text ${formatFor(file) === 'latex' || file.mode === 'source' ? 'source-text' : ''}">${esc(file.text)}</pre>`;
    if (file.kind === 'practice') body += '<section class="answer-section"><h3>作答</h3><textarea class="answer-input" aria-label="练习作答" placeholder="写下你的思路……"></textarea><div class="answer-actions"><button class="button subtle save-answer">保存作答</button><button class="button subtle ask-answer">带着作答提问</button><span class="answer-status">作答单独保存，保留历史</span></div></section>';
  } else if (!file.url) body = '<div class="reader-empty">无法读取此文件</div>';
  else if (['image/png','image/jpeg','image/webp','image/gif'].includes(file.mime)) body = `<img class="file-image" src="${esc(file.url)}" alt="${esc(file.name)}">`;
  else if (file.mime === 'application/pdf') body = '<div class="pdf-host"><div class="reader-empty">正在打开 PDF…</div></div>';
  else if (file.mime.startsWith('audio/')) body = `<audio controls src="${esc(file.url)}"></audio>`;
  else body = '<div class="reader-empty">此格式暂不支持预览。内容尚未被读取或分类。</div>';
  return `<div class="file-reader ${file.mime === 'application/pdf' ? 'pdf-reader' : ''}">${body}</div>`;
}
function renderTabs() {
  $('#document-tabs').innerHTML = state.tabs.map(id => `<div class="file-tab ${id === state.active ? 'active' : ''}"><button data-tab="${esc(id)}" aria-current="${id === state.active ? 'page' : 'false'}">${icon('file')}<span>${esc(getFile(id).name)}</span></button><button data-close-tab="${esc(id)}" class="tab-close" aria-label="关闭 ${esc(getFile(id).name)}" title="关闭">${icon('close')}</button></div>`).join('');
  $('#back').classList.toggle('active', !state.active);
  $('#back').setAttribute('aria-current', state.active ? 'false' : 'page');
  $('#file-actions').hidden = !state.active;
  const current=state.active && getFile(state.active);
  if(current){$('#download-file').href=current.url;$('#download-file').download=current.name;}
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
function renderTask() {
  disposePdfReaders();
  const file = getFile(state.active);
  $('#document-title').textContent = file.name;
  $('#document-meta').textContent = `${folders.find(folder=>folder.id===file.folder)?.name || '未整理'} / ${file.name}`;
  renderTabs();
  const sourceIds = state.compare ? [state.active, state.compare] : [state.active];
  const ids=sourceIds.map(id=>{const file=getFile(id);return file.mode==='pdf'&&file.pdf?file.pdf.file:id;});
  $('#document-area').classList.toggle('comparing', Boolean(state.compare));
  $('#document-area').innerHTML = ids.map(id => `<section class="document-pane" data-file="${esc(id)}" aria-label="${esc(getFile(id).name)}">${state.compare ? `<div class="pane-label"><span>${esc(getFile(id).name)}</span>${id === state.compare ? `<button class="icon-button" id="close-compare" aria-label="关闭并排文件">${icon('close')}</button>` : ''}</div>` : ''}${paper(getFile(id))}</section>`).join('');
  for (const pane of $$('.document-pane')) { const answer = $('.answer-input', pane); if (answer) answer.value = state.answers.get(pane.dataset.file) || ''; }
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
  $('#shell').classList.toggle('collapsed', collapsed); $('#restore-assistant').hidden = !collapsed;
  for (const button of $$('.assistant-toggle')) {button.setAttribute('aria-label', collapsed ? '打开助理' : '收起助理'); button.title = collapsed ? '打开助理' : '收起助理';}
}
function showPicker(title, html, callback) {
  $('#picker-title').textContent = title; $('#picker-body').innerHTML = html; pickerCallback = callback; $('#picker').showModal();
}
function filePicker(title, callback, exclude = null, multiple = false) {
  const candidates = files.filter(file => file.id !== exclude);
  showPicker(title, candidates.map(file => `<label class="picker-option"><input type="${multiple ? 'checkbox' : 'radio'}" name="file" value="${esc(file.id)}" ${multiple && state.contexts.has(file.id) ? 'checked' : ''}><span>${esc(file.name)}<small> · ${esc(file.course || '未归属')}</small></span></label>`).join(''), () => {const ids = $$('#picker-body input:checked').map(input => input.value); if (!ids.length) {toast('请选择文件'); return;} callback(multiple ? ids : ids[0]);});
}
$('#picker').addEventListener('close', () => {if ($('#picker').returnValue === 'confirm' && pickerCallback) pickerCallback(); pickerCallback = null;});
function createFolder() {
  showPicker('新建文件夹', '<label><span class="sr-only">文件夹名称</span><input class="picker-input" id="folder-name" maxlength="60" placeholder="给它一个名字" required></label>', () => {const name = $('#folder-name').value.trim(); if (!name) return; folders.push({id:requestId(), name}); renderDesktop(); toast('已新建文件夹');});
}
function moveFiles() {
  if (!state.selected.size) return;
  showPicker('把文件放到哪里？', '<p class="picker-note">移动后仍保留文件身份与关联。</p>' + [{id:'', name:'桌面'}, ...folders].map(folder => `<label class="picker-option"><input type="radio" name="folder" value="${esc(folder.id)}"><span>${esc(folder.name)}</span></label>`).join(''), () => {const choice = $('#picker-body input:checked'); if (!choice) {toast('请选择位置'); return;} for (const id of state.selected) getFile(id).folder = choice.value || null; renderDesktop(); toast('已移动文件，可再次选择后移回');});
}
function refsText() {
  const names = [...state.contexts].map(id => getFile(id)?.name).filter(Boolean);
  if (state.quote) names.push(`${getFile(state.quote.file).name} · ${state.quote.source}：${state.quote.text.slice(0,80)}`);
  return names.join(' · ');
}
function quickAction(action) {
  collapseAssistant(false);
  if (!state.contexts.size && action !== 'question') {toast('先选择或关联文件');return;}
  $('#prompt').value=action==='organize'?'请读取这些文件，并按内容整理到合适的文件夹。':action==='practice'?'请根据这些材料组织练习，保存题目，并加入任务清单。':$('#prompt').value;
  $('#prompt').focus();
}
async function sendMessage() {
  const input=$('#prompt'),text=input.value.trim();if(!text || sending)return;
  sending=true;
  const key=channel(),args={id:requestId(),channel:key,text,files:[...state.contexts],quote:state.quote};
  try {
    await api('/api/chat',args);
    if(channel()===key){input.value='';state.quote=null;renderContexts();persistDraft();}
    await refresh();
  } catch(error){toast(error.message);await refresh();}finally{sending=false;}
}
$('#chat-form').addEventListener('submit', event => {event.preventDefault(); sendMessage();});
$('#prompt').addEventListener('keydown', event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); sendMessage();}});
$('#home').addEventListener('click', event => {event.preventDefault(); backToDesktop();});
$('#back').addEventListener('click', backToDesktop);
$('#tasks').addEventListener('change',async event=>{const input=event.target.closest('[data-task]');if(!input)return;try{await operation('check_task',{task:input.dataset.task,done:input.checked});await refresh();}catch(error){toast(error.message);await refresh(true);}});
$('#tasks').addEventListener('click',event=>{const button=event.target.closest('[data-task-open]');if(button?.dataset.taskOpen)openFile(button.dataset.taskOpen);else if(button){collapseAssistant(false);$('#prompt').value='关于任务“'+tasks.find(t=>t.id===button.dataset.taskId).title+'”，';$('#prompt').focus();}});
$('#reader-modes').addEventListener('click',event=>{const button=event.target.closest('[data-mode]');if(button){saveScroll();getFile(state.active).mode=button.dataset.mode;renderTask();}});
$('.workspace').addEventListener('scroll',()=>{$('#quote-bar').hidden=true;clearTimeout(draftTimer);draftTimer=setTimeout(persistDraft,500);},{passive:true});
$('#folders').addEventListener('click', event => {const button = event.target.closest('[data-folder]'); if (!button) return; state.folder = state.folder === button.dataset.folder ? null : button.dataset.folder; renderDesktop();persistLayout();});
$('#clear-folder').addEventListener('click', () => {state.folder = null; renderDesktop();persistLayout();});
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
$('#files').addEventListener('dragend', () => {draggedId = null;});
$$('.assistant-toggle').forEach(button => button.addEventListener('click', () => collapseAssistant(!$('#shell').classList.contains('collapsed'))));
$('#restore-assistant').addEventListener('click', () => {collapseAssistant(false); $('#prompt').focus();});
$('#clear-context').addEventListener('click', () => {state.contexts.clear(); state.quote = null; renderContexts();});
$('#contexts').addEventListener('click', event => {const remove = event.target.closest('[data-remove]'); if (remove) state.contexts.delete(remove.dataset.remove); if (event.target.closest('[data-remove-quote]')) state.quote = null; renderContexts();});
$('#attach-context').addEventListener('click', () => filePicker('关联桌面文件', ids => {state.contexts = new Set(ids); renderContexts();}, null, true));
$$('[data-action]').forEach(button => button.addEventListener('click', () => quickAction(button.dataset.action)));
$('#conversation').addEventListener('click', event => {const button = event.target.closest('[data-open-artifact]'); if (button) openFile(button.dataset.openArtifact);});
$('#document-tabs').addEventListener('click', event => {const close = event.target.closest('[data-close-tab]'); if (close) {closeTab(close.dataset.closeTab); return;} const tab = event.target.closest('[data-tab]'); if (tab) openFile(tab.dataset.tab);});
$('#compare').addEventListener('click', () => filePicker('选择并排查看的文件', id => {saveScroll(); state.compare = id; renderTask();}, state.active));
$('#rename').addEventListener('click', () => {const file = getFile(state.active); showPicker('重命名文件', `<label><span class="sr-only">文件名称</span><input class="picker-input" id="rename-input" value="${esc(file.name)}" maxlength="120" required></label>`, () => {const name = $('#rename-input').value.trim(); if (!name) return; saveScroll(); file.name = name; renderDesktop(); renderTask(); renderContexts(); renderConversation(); toast('名称已更新，文件关联保留');});});
$('#document-area').addEventListener('scroll', () => {$('#quote-bar').hidden=true;},true);
$('#document-area').addEventListener('click', async event => {
  if(event.target.closest('.pdf-toolbar')) {$('#quote-bar').hidden=true;state.pendingQuote=null;}
  if (event.target.closest('#close-compare')) {saveScroll(); state.compare = null; renderTask();}
  const pane = event.target.closest('.document-pane'); if (!pane) return;
  if (event.target.closest('.save-answer')) {const answer = $('.answer-input', pane).value.trim(); if (!answer) {toast('先写下你的作答'); return;} state.answers.set(pane.dataset.file, answer); try {await operation('answer',{file:pane.dataset.file,text:answer});$('.answer-status',pane).textContent='已保存';toast('原始作答已保存');}catch(error){toast(error.message);}}
  if (event.target.closest('.ask-answer')) {const answer = $('.answer-input', pane).value.trim(); if (!answer) {toast('先写下你的作答'); return;} state.answers.set(pane.dataset.file, answer); state.contexts.add(pane.dataset.file); await operation('answer',{file:pane.dataset.file,text:answer}); state.quote = {file:pane.dataset.file, text:answer, source:'作答',sha256:getFile(pane.dataset.file).sha256}; renderContexts(); collapseAssistant(false); $('#prompt').value = '请检查这份作答的推导。'; $('#prompt').focus();}
});
$('#document-area').addEventListener('input', event => {if (event.target.matches('.answer-input')) state.answers.set(event.target.closest('.document-pane').dataset.file, event.target.value);});
function captureSelection() {
  const selection = window.getSelection(); if (!selection || !selection.rangeCount || selection.isCollapsed) return;
  const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  const end = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
  const pane = node?.closest('.document-pane');
  if (!pane || end?.closest('.document-pane') !== pane) return;
  const text = selection.toString().trim().slice(0,2000); if (!text) return;
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
    const limit=raw.type.startsWith('audio/')?200:20;
    if(raw.size>limit*1024*1024){toast(`${raw.name} 超过 ${limit} MB`);continue;}
    try {
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(raw);});
      await operation('create',{name:raw.name,mime:raw.type,data,folder:state.folder==='unfiled'?null:state.folder});saved++;
    }catch(error){toast(error.message);}
  }
  await refresh(true);if(saved)toast('已保存 '+saved+' 份文件');
}
$('#file-input').addEventListener('change', async event => {await importFiles(event.target.files); event.target.value = '';});
$('.workspace').addEventListener('dragover', event => {if (event.dataTransfer.types.includes('Files')) event.preventDefault();});
$('.workspace').addEventListener('drop', async event => {if (!event.dataTransfer.files.length) return; event.preventDefault(); await importFiles(event.dataTransfer.files);});
window.addEventListener('beforeunload', () => {for (const file of files) if (file.url?.startsWith('blob:')) URL.revokeObjectURL(file.url);});
const divider = $('#divider');
function setAssistantWidth(width) {const max = Math.min(560, window.innerWidth - 420); const value = Math.max(300,Math.min(max,width)); document.documentElement.style.setProperty('--assistant-width', `${value}px`); divider.setAttribute('aria-valuenow', String(value));}
divider.addEventListener('pointerdown', event => {divider.setPointerCapture(event.pointerId);});
divider.addEventListener('pointermove', event => {if (divider.hasPointerCapture(event.pointerId)) setAssistantWidth(window.innerWidth - event.clientX);});
divider.addEventListener('keydown', event => {if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {event.preventDefault(); setAssistantWidth($('.assistant').getBoundingClientRect().width + (event.key === 'ArrowLeft' ? 20 : -20));}});
renderDesktop(); renderContexts(); renderConversation(); renderTabs();
refresh(true).then(()=>{$('.prototype-note').textContent='文件与对话自动保存';}).catch(error=>{toast('无法连接云端服务：'+error.message);$('.prototype-note').textContent='尚未连接服务';});
setInterval(()=>refresh().catch(()=>{$('.preview-label').textContent='连接中断';}),2000);
if (matchMedia('(max-width:720px)').matches) collapseAssistant(true);

let draftTimer;
$('#prompt').addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(persistDraft,400);});
$('#stop-agent').addEventListener('click',async()=>{try{await api('/api/stop',{});await refresh();}catch(error){toast(error.message);}});
$('#new-task').addEventListener('click',()=>showPicker('新建任务','<input id="task-title" class="picker-input" placeholder="要做什么？" required>',async()=>{try{await operation('task',{title:$('#task-title').value});await refresh();}catch(error){toast(error.message);}}));
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
$('#view-pdf').addEventListener('click',()=>{const file=getFile(state.active);file.mode=file.mode==='pdf'?'source':'pdf';renderTask();});
$('#edit-file').addEventListener('click',()=>{
  const file=getFile(state.active),expected=file.sha256;
  showPicker('编辑源码','<textarea id="edit-text" class="source-editor" aria-label="文件源码"></textarea>',async()=>{
    try{await operation('write',{file:file.id,expected,text:$('#edit-text').value});await refresh(true);toast('已保存新版本');if(formatFor(file)==='latex')$('#compile-file').click();}catch(error){toast(error.message);}
  });$('#edit-text').value=file.text;
});
$('#history-file').addEventListener('click',async()=>{
  const file=getFile(state.active);
  try{const {versions}=await operation('history',{file:file.id});const distinct=[...new Map(versions.map(v=>[v.sha256,v])).values()].reverse();showPicker('恢复文件版本',distinct.map((v,i)=>`<label class="picker-option"><input type="radio" name="version" value="${esc(v.sha256)}"><span>${i===0?'当前版本':'历史版本 '+i}</span></label>`).join(''),async()=>{const version=$('#picker-body input:checked')?.value;if(!version)return;try{await operation('restore',{file:file.id,expected:file.sha256,version});await refresh(true);toast('已恢复，后续版本仍保留');}catch(error){toast(error.message);}});}catch(error){toast(error.message);}
});

window.addEventListener('pagehide',()=>{
  if(readonly)return;
  const key=channel(),value={prompt:$('#prompt').value,contexts:[...state.contexts],quote:state.quote,scroll:$('.workspace').scrollTop};
  navigator.sendBeacon('/api/workspace',new Blob([JSON.stringify({action:'draft',args:{channel:key,value},semester:semesterId})],{type:'application/json'}));
});

// One unobtrusive menu; ordinary learning does not require a configuration page.
$('#semester-menu').addEventListener('click',()=>{
  if(!semesterList)return;
  const choices=semesterList.items.map(s=>`<label class="picker-option"><input type="radio" name="semester" value="${esc(s.id)}" ${s.id===semesterId?'checked':''}><span>${esc(s.name)}${s.status==='archived'?' · 已归档':s.status==='removed'?' · 已移除':''}</span></label>`).join('');
  showPicker('学期',choices+`<select id="semester-action" class="picker-input" aria-label="学期操作"><option value="switch">打开选中学期</option><option value="create">开始新学期</option><option value="rename">重命名</option><option value="archive">归档，保留记录</option><option value="reopen">重新开始</option><option value="remove">移除，可恢复</option><option value="restore">恢复已移除学期</option><option value="export">下载选中学期备份</option></select><p class="picker-note">通用学习习惯和助理流程独立保存，换学期仍保留。旧任务与课程状态不会带入新学期。</p>`,async()=>{
    const action=$('#semester-action').value,id=$('#picker-body input:checked')?.value;
    const selected=semesterList.items.find(s=>s.id===id);
    if(!selected)return;
    if(action==='export'){location.href='/api/semester-export?semester='+id;return;}
    const args={semester:id,expected:semesterList.version};
    if(action==='create'||action==='rename'){args.name=window.prompt(action==='create'?'新学期叫什么？':'学期名称',action==='rename'?selected.name:'');if(!args.name)return;}
    if(action==='archive'&&!window.confirm('归档后保留文件、对话和未完成任务，可以重新开始。现在归档“'+selected.name+'”？'))return;
    if(action==='remove'){args.confirm=window.prompt('移除后可以恢复。请输入要移除的学期名称：'+selected.name);if(args.confirm===null)return;}
    try{await syncChain;await api('/api/semesters',{action,args});location.reload();}catch(error){toast(error.message);await refresh();}
  });
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
