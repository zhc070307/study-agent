/**
 * Adapted from DeepSeek Harness, MIT, Copyright (c) 2026 DeepSeek.
 * Source: d743267388641bc76f17c45ce8b4c231aed1d32c
 * packages/client/ui-primitives/src/{relative-time,useAnchoredPosition}.ts
 * Full license: ../packages/runtime/LICENSE.
 * Changes: plain browser JavaScript and DOM lifecycle instead of React hooks.
 */
export function relativeTime(at, now) {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY = 86_400_000
  const diff = Math.max(0, now - at)
  if (diff < MIN) return { unit: 'now', n: 0 }
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) }
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) }
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) }
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) }
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) }
}

// Geometry and tracking adapted from upstream useAnchoredPosition.
export function trackAnchoredMenu(anchor, panel, {side='bottom',align='end',gap=4,margin=12}={}) {
  const place=()=>{
    const rect=anchor.getBoundingClientRect();
    const width=panel.offsetWidth,height=panel.offsetHeight;
    let left=align==='end'?rect.right-width:rect.left;
    let top=side==='top'?rect.top-gap-height:rect.bottom+gap;
    if(width>0)left=Math.max(margin,Math.min(left,window.innerWidth-width-margin));
    if(height>0)top=Math.max(margin,Math.min(top,window.innerHeight-height-margin));
    panel.style.left=left+'px';panel.style.top=top+'px';
  };
  place();
  window.addEventListener('scroll',place,true);
  window.addEventListener('resize',place);
  const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(place);
  observer?.observe(panel);
  return ()=>{observer?.disconnect();window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};
}

// Study Agent integration: one open menu, keyboard navigation and dismissal.
export function installConversationMenus(container) {
  let active=null,untrack=null;
  function dismiss(focus=false){
    if(!active)return;
    const previous=active;active=null;untrack?.();untrack=null;
    previous.open=false;
    if(focus&&previous.isConnected)previous.querySelector('summary').focus();
  }
  container.addEventListener('toggle',event=>{
    const menu=event.target;
    if(!menu.matches('.chat-row-menu'))return;
    if(!menu.open){if(menu===active)dismiss();return;}
    if(active===menu)return;
    dismiss();active=menu;
    untrack=trackAnchoredMenu(menu.querySelector('summary'),menu.querySelector('div'));
  },true);
  document.addEventListener('pointerdown',event=>{if(active&&!active.contains(event.target))dismiss();});
  document.addEventListener('keydown',event=>{
    if(!active)return;
    if(event.key==='Escape'){event.preventDefault();dismiss(true);return;}
    const items=[...active.querySelectorAll('button:not(:disabled)')];
    if(!items.length||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=items.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:event.key==='ArrowDown'?(current+1)%items.length:(current<0?items.length-1:(current-1+items.length)%items.length);
    items[next].focus();
  });
  document.addEventListener('focusin',event=>{if(active&&!active.contains(event.target))dismiss();});
  return ()=>dismiss();
}

