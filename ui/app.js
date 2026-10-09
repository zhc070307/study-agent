'use strict';
// Standalone interaction prototype. No model requests, server storage, or personal data.
const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const files = [
  {id:'notes', name:'导数笔记.md', course:'微积分', folder:'notes-folder', kind:'text', label:'Markdown', mime:'text/markdown', source:'samples/notes/derivatives.md'},
  {id:'slides', name:'导数与微分.pdf', course:'微积分', folder:'materials-folder', kind:'pdf', label:'PDF', mime:'application/pdf', source:'samples/materials/derivatives.pdf'},
  {id:'practice', name:'变化率练习.txt', course:'微积分', folder:'practice-folder', kind:'practice', label:'文本', mime:'text/plain', source:'samples/practice/questions.txt'},
  {id:'answer', name:'解题思路.txt', course:'微积分', folder:'practice-folder', kind:'text', label:'文本', mime:'text/plain', source:'samples/practice/answer.txt'},
  {id:'linear', name:'向量与坐标.tex', course:'线性代数', folder:'notes-folder', kind:'text', label:'LaTeX 源码', mime:'text/x-tex', source:'samples/notes/vectors.tex'},
  {id:'ideas', name:'想讨论的问题.txt', course:'未归属', folder:null, kind:'text', label:'文本', mime:'text/plain', source:'samples/inbox/questions.txt'}
];
async function loadFile(file) {
  try {
    const response = await fetch(file.source);
    if (!response.ok) throw new Error(`读取失败 (${response.status})`);
    if (file.mime.startsWith('text/')) file.text = await response.text();
    else {await response.arrayBuffer(); file.url = file.source;}
  } catch (error) {file.loadError = error.message;}
}
const folders = [{id:'materials-folder', name:'课程材料'}, {id:'notes-folder', name:'笔记与想法'}, {id:'practice-folder', name:'练习与作答'}];
const tasks = [
  {id:'task-notes', title:'查看导数笔记', file:'notes', done:false},
  {id:'task-practice', title:'完成变化率练习', file:'practice', done:false},
  {id:'task-material', title:'核对导数与微分讲义', file:'slides', done:false}
];
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
  $('#tasks').innerHTML = tasks.map(task => `<div class="task-row ${task.done ? 'done' : ''}"><input type="checkbox" data-task="${esc(task.id)}" aria-label="完成任务 ${esc(task.title)}" ${task.done ? 'checked' : ''}><button data-task-open="${esc(task.file)}">${esc(task.title)}</button><span>${esc(getFile(task.file).name)}</span></div>`).join('');
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
    welcome.innerHTML = '<p>有什么需要我帮忙的？</p>';
    container.append(welcome);
  }
  for (const message of messages) {
    const div = document.createElement('div'); div.className = `message ${message.role === 'user' ? 'user' : 'assistant-message'}`;
    const label = document.createElement('span'); label.className = 'message-meta'; label.textContent = message.role === 'user' ? '你' : '助理 · 示例回复'; div.append(label);
    if (message.refs) { const refs = document.createElement('span'); refs.className = 'message-ref'; refs.textContent = message.refs; div.append(refs); }
    const body = document.createElement('span'); body.textContent = message.text; div.append(body);
    if (message.file) {const button = document.createElement('button'); button.className = 'message-artifact'; button.dataset.openArtifact = message.file; button.innerHTML = `${icon('file')}<span>${esc(getFile(message.file).name)}</span>${icon('arrow')}`; div.append(button);}
    container.append(div);
  }
  if (messages.length) container.scrollTop = container.scrollHeight;
}
function addMessage(role, text, extra = {}) {
  const key = channel(); if (!state.messages.has(key)) state.messages.set(key, []);
  state.messages.get(key).push({role, text, ...extra}); renderConversation();
}
function saveScroll() {
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
  saveScroll(); disposePdfReaders(); state.active = null; state.compare = null; restoreComposition(state.selected);
  $('#desktop').hidden = false; $('#task').hidden = true;
  renderDesktop(); renderContexts(); renderConversation(); renderTabs(); $('.workspace').scrollTop = state.deskScroll;
}
function paper(file) {
  if (file.loadError) return `<div class="reader-empty">${esc(file.loadError)}。请通过静态预览服务打开此页面。</div>`;
  let body;
  if (file.text !== undefined) {
    body = formatFor(file) === 'markdown' && file.mode !== 'source' ? `<article class="markdown-body">${markdownPreview(file.text)}</article>` : `<pre class="file-text ${formatFor(file) === 'latex' || file.mode === 'source' ? 'source-text' : ''}">${esc(file.text)}</pre>`;
    if (file.kind === 'practice') body += '<section class="answer-section"><h3>作答</h3><textarea class="answer-input" aria-label="练习作答" placeholder="写下你的思路……"></textarea><div class="answer-actions"><button class="button subtle save-answer">保存作答</button><button class="button subtle ask-answer">带着作答提问</button><span class="answer-status">仅保存在本页</span></div></section>';
  } else if (!file.url) body = '<div class="reader-empty">正在打开文件…</div>';
  else if (file.mime.startsWith('image/')) body = `<img class="file-image" src="${esc(file.url)}" alt="${esc(file.name)}">`;
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
  const markdown = state.active && formatFor(getFile(state.active)) === 'markdown';
  $('#reader-modes').hidden = !markdown;
  for (const button of $$('[data-mode]')) {const active = state.active && (getFile(state.active).mode || 'preview') === button.dataset.mode; button.classList.toggle('active', Boolean(active)); button.setAttribute('aria-pressed', String(Boolean(active)));}
}
function closeTab(id) {
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
  const ids = state.compare ? [state.active, state.compare] : [state.active];
  $('#document-area').classList.toggle('comparing', Boolean(state.compare));
  $('#document-area').innerHTML = ids.map(id => `<section class="document-pane" data-file="${esc(id)}" aria-label="${esc(getFile(id).name)}">${state.compare ? `<div class="pane-label"><span>${esc(getFile(id).name)}</span>${id === state.compare ? `<button class="icon-button" id="close-compare" aria-label="关闭并排文件">${icon('close')}</button>` : ''}</div>` : ''}${paper(getFile(id))}</section>`).join('');
  for (const pane of $$('.document-pane')) { const answer = $('.answer-input', pane); if (answer) answer.value = state.answers.get(pane.dataset.file) || ''; }
  $('#quote-bar').hidden = true;
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
  showPicker(title, candidates.map(file => `<label class="picker-option"><input type="${multiple ? 'checkbox' : 'radio'}" name="file" value="${esc(file.id)}" ${multiple && state.contexts.has(file.id) ? 'checked' : ''}><span>${esc(file.name)}<small> · ${esc(file.course)}</small></span></label>`).join(''), () => {const ids = $$('#picker-body input:checked').map(input => input.value); if (!ids.length) {toast('请选择文件'); return;} callback(multiple ? ids : ids[0]);});
}
$('#picker').addEventListener('close', () => {if ($('#picker').returnValue === 'confirm' && pickerCallback) pickerCallback(); pickerCallback = null;});
function createFolder() {
  showPicker('新建文件夹', '<label><span class="sr-only">文件夹名称</span><input class="picker-input" id="folder-name" maxlength="60" placeholder="给它一个名字" required></label>', () => {const name = $('#folder-name').value.trim(); if (!name) return; folders.push({id:`folder-${state.nextId++}`, name}); renderDesktop(); toast('已新建文件夹');});
}
function moveFiles() {
  if (!state.selected.size) return;
  showPicker('把文件放到哪里？', '<p class="picker-note">只改变本页的文件位置，保留文件身份与关联。</p>' + [{id:'', name:'桌面'}, ...folders].map(folder => `<label class="picker-option"><input type="radio" name="folder" value="${esc(folder.id)}"><span>${esc(folder.name)}</span></label>`).join(''), () => {const choice = $('#picker-body input:checked'); if (!choice) {toast('请选择位置'); return;} for (const id of state.selected) getFile(id).folder = choice.value || null; renderDesktop(); toast('已移动文件，可再次选择后移回');});
}
function refsText() {
  const names = [...state.contexts].map(id => getFile(id)?.name).filter(Boolean);
  if (state.quote) names.push(`${getFile(state.quote.file).name} · ${state.quote.source}：${state.quote.text.slice(0,80)}`);
  return names.join(' · ');
}
function quickAction(action) {
  if (action === 'question') {collapseAssistant(false); $('#prompt').focus(); $('#prompt').placeholder = '关于这份内容，你想问什么？'; return;}
  if (!state.contexts.size) {toast('先选择或关联一份文件'); $('#attach-context').focus(); return;}
  const names = [...state.contexts].map(id => getFile(id).name);
  if (action === 'organize') {
    const ids = [...state.contexts];
    showPicker('整理这些文件', `<p class="picker-note">预览将把 ${ids.length} 份关联文件放入你命名的文件夹，不猜测课程或内容类型。</p><label><span class="sr-only">文件夹名称</span><input class="picker-input" id="organize-name" placeholder="例如：这次要看的材料" maxlength="60" required></label>`, () => {
      const name = $('#organize-name').value.trim(); if (!name) return;
      const folderId = `folder-${state.nextId++}`; folders.push({id:folderId, name});
      for (const id of ids) getFile(id).folder = folderId;
      addMessage('user', `把这些文件整理到“${name}”。`, {refs:names.join(' · ')});
      addMessage('assistant', `已在本页把 ${ids.length} 份文件移入“${name}”。文件内容和课程归属保持原样。可以从桌面选择文件，再移动到其他位置。`);
      renderDesktop(); toast('整理完成 · 仅本次预览');
    });
  } else if (action === 'practice') {
    if (getFile('practice').text === undefined) {toast('示例文件尚未读取成功'); return;}
    addMessage('user', '组织一份练习。', {refs:refsText()});
    const id = `generated-${state.nextId++}`;
    files.push({id, name:'示例练习 ' + (files.filter(f => f.id.startsWith('generated-')).length + 1) + '.txt', course:'微积分', folder:'practice-folder', kind:'practice', label:'固定示例', mime:'text/plain', text:getFile('practice').text, sources:[...state.contexts]});
    renderDesktop();
    addMessage('assistant', '示例练习已放到桌面。内容为固定示例，并非根据关联文件生成。', {file:id});
    toast('示例练习已放回桌面');
  }
}
function sendMessage() {
  const input = $('#prompt'); const text = input.value.trim(); if (!text) return;
  addMessage('user', text, {refs:refsText()}); input.value = '';
  addMessage('assistant', '已记录你的问题与关联内容。此处是示例对话，实际回答将在模型接入后提供。');
  state.quote = null; renderContexts(); $('#quote-bar').hidden = true;
}
$('#chat-form').addEventListener('submit', event => {event.preventDefault(); sendMessage();});
$('#prompt').addEventListener('keydown', event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); sendMessage();}});
$('#home').addEventListener('click', event => {event.preventDefault(); backToDesktop();});
$('#back').addEventListener('click', backToDesktop);
$('#tasks').addEventListener('change',event=>{const input=event.target.closest('[data-task]');if(input){tasks.find(task=>task.id===input.dataset.task).done=input.checked;renderTasks();}});
$('#tasks').addEventListener('click',event=>{const button=event.target.closest('[data-task-open]');if(button)openFile(button.dataset.taskOpen);});
$('#reader-modes').addEventListener('click',event=>{const button=event.target.closest('[data-mode]');if(button){saveScroll();getFile(state.active).mode=button.dataset.mode;renderTask();}});
$('.workspace').addEventListener('scroll',()=>{$('#quote-bar').hidden=true;},{passive:true});
$('#folders').addEventListener('click', event => {const button = event.target.closest('[data-folder]'); if (!button) return; state.folder = state.folder === button.dataset.folder ? null : button.dataset.folder; renderDesktop();});
$('#clear-folder').addEventListener('click', () => {state.folder = null; renderDesktop();});
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
$('#document-area').addEventListener('click', event => {
  if(event.target.closest('.pdf-toolbar')) {$('#quote-bar').hidden=true;state.pendingQuote=null;}
  if (event.target.closest('#close-compare')) {saveScroll(); state.compare = null; renderTask();}
  const pane = event.target.closest('.document-pane'); if (!pane) return;
  if (event.target.closest('.save-answer')) {const answer = $('.answer-input', pane).value.trim(); if (!answer) {toast('先写下你的作答'); return;} state.answers.set(pane.dataset.file, answer); $('.answer-status', pane).textContent = '已保存到本次预览'; toast('作答已保留 · 刷新后重置');}
  if (event.target.closest('.ask-answer')) {const answer = $('.answer-input', pane).value.trim(); if (!answer) {toast('先写下你的作答'); return;} state.answers.set(pane.dataset.file, answer); state.contexts.add(pane.dataset.file); state.quote = {file:pane.dataset.file, text:answer, source:'作答'}; renderContexts(); collapseAssistant(false); $('#prompt').value = '请检查这份作答的推导。'; $('#prompt').focus();}
});
$('#document-area').addEventListener('input', event => {if (event.target.matches('.answer-input')) state.answers.set(event.target.closest('.document-pane').dataset.file, event.target.value);});
function captureSelection() {
  const selection = window.getSelection(); if (!selection || !selection.rangeCount || selection.isCollapsed) return;
  const node = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement;
  const end = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement;
  const pane = node?.closest('.document-pane');
  if (!pane || end?.closest('.document-pane') !== pane) return;
  const text = selection.toString().trim().slice(0,2000); if (!text) return;
  state.pendingQuote = {file:pane.dataset.file, text, source:node.closest('[data-page-number]') ? `第 ${node.closest('[data-page-number]').dataset.pageNumber} 页选区` : '文字选区'};
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
  let added = 0;
  for (const raw of incoming) {
    if (raw.size > 5 * 1024 * 1024) {toast(`${raw.name} 超过预览的 5 MB 上限`); continue;}
    const file = {id:`upload-${state.nextId++}`, name:raw.name, course:'未归属', folder:state.folder === 'unfiled' ? null : state.folder, kind:'upload', label:'本页文件 · 待判断', mime:raw.type || '', url:URL.createObjectURL(raw)};
    // MIME only chooses the browser preview; it never assigns a learning content type.
    if (raw.type.startsWith('text/') || ['markdown','latex'].includes(formatFor(file))) file.text = await raw.text();
    files.unshift(file); added++;
  }
  renderDesktop(); if (added) toast(`已添加 ${added} 份文件到本页，没有上传到服务器`);
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
Promise.all(files.map(loadFile)).then(() => {if (state.active) renderTask();});
if (matchMedia('(max-width:720px)').matches) collapseAssistant(true);
