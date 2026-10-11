// Uses the same version-matched PDF.js text-layer builder as the upstream Harness.
import * as pdfjs from './lib/pdfjs/pdf.min.mjs';
import {TextLayerBuilder} from './lib/pdfjs/pdf_viewer.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
export function mountPdfReader(host,file) {
  let disposed=false, document, canvasTask, textLayer, generation=0, lastWidth=0;
  const loading=pdfjs.getDocument({url:file.url,cMapUrl:new URL('./lib/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./lib/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./lib/pdfjs/wasm/',import.meta.url).href,enableXfa:false,isEvalSupported:false});
  host.innerHTML='<div class="pdf-toolbar"><button data-pdf="previous" aria-label="PDF 上一页">‹</button><label><input class="pdf-page-input" type="number" min="1" aria-label="PDF 页码" value="1"> / <span class="pdf-total">…</span></label><button data-pdf="next" aria-label="PDF 下一页">›</button><span class="toolbar-space"></span><button data-pdf="out" aria-label="PDF 缩小">−</button><span class="pdf-zoom">适合宽度</span><button data-pdf="in" aria-label="PDF 放大">＋</button><button data-pdf="fit">适合宽度</button></div><div class="pdf-pages"><div class="reader-empty">正在打开 PDF…</div></div>';
  const pages=host.querySelector('.pdf-pages');
  const remember=()=>host.dispatchEvent(new CustomEvent('reader-position',{bubbles:true,detail:{file:file.id}}));
  const observer=new ResizeObserver(()=>{const width=Math.round(host.clientWidth);if(document && width!==lastWidth){lastWidth=width;render();}});
  observer.observe(host);
  function cancelRender(){canvasTask?.cancel();textLayer?.cancel();canvasTask=null;textLayer=null;}
  function status(){
    host.querySelector('.pdf-page-input').value=file.pdfPage||1;
    host.querySelector('.pdf-total').textContent=document.numPages;
    host.querySelector('[data-pdf="previous"]').disabled=(file.pdfPage||1)<=1;
    host.querySelector('[data-pdf="next"]').disabled=(file.pdfPage||1)>=document.numPages;
    host.querySelector('.pdf-zoom').textContent=`${Math.round((file.pdfZoom||1)*100)}%`;
  }
  async function render(){
    if(disposed || !document)return;
    const token=++generation;cancelRender();status();
    try {
      const page=await document.getPage(file.pdfPage||1);
      if(disposed || token!==generation)return;
      const base=page.getViewport({scale:1});
      const fit=Math.max(.2,(host.clientWidth-34)/base.width);
      const viewport=page.getViewport({scale:fit*(file.pdfZoom||1)});
      const ratio=Math.min(window.devicePixelRatio||1,Math.sqrt(16_777_216/(viewport.width*viewport.height)));
      const sheet=window.document.createElement('div');sheet.className='pdf-sheet';sheet.dataset.pageNumber=String(file.pdfPage||1);sheet.style.width=`${viewport.width}px`;sheet.style.height=`${viewport.height}px`;
      const canvas=window.document.createElement('canvas');canvas.setAttribute('aria-label',`${file.name}，第 ${file.pdfPage||1} 页`);canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;sheet.append(canvas);pages.replaceChildren(sheet);
      canvasTask=page.render({canvas,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});
      textLayer=new TextLayerBuilder({pdfPage:page});
      textLayer.div.style.setProperty('--total-scale-factor',String(viewport.scale*viewport.userUnit));textLayer.div.style.setProperty('--scale-round-x','1px');textLayer.div.style.setProperty('--scale-round-y','1px');sheet.append(textLayer.div);
      await Promise.all([canvasTask.promise,textLayer.render({viewport,textContentParams:{includeMarkedContent:true,disableNormalization:false}})]);
      if(disposed || token!==generation)return;
      sheet.dataset.rendered='true';pages.scrollTop=file.pdfScroll||0;
    } catch(error){if(!disposed && token===generation && error.name!=='RenderingCancelledException'){pages.textContent=`PDF 读取失败：${error.message}`;}}
  }
  const click=event=>{const button=event.target.closest('[data-pdf]');if(!button || !document)return;
    const action=button.dataset.pdf;
    if(action==='previous')file.pdfPage=Math.max(1,(file.pdfPage||1)-1);
    if(action==='next')file.pdfPage=Math.min(document.numPages,(file.pdfPage||1)+1);
    if(action==='out')file.pdfZoom=Math.max(.5,(file.pdfZoom||1)-.15);
    if(action==='in')file.pdfZoom=Math.min(2.5,(file.pdfZoom||1)+.15);
    if(action==='fit')file.pdfZoom=1;
    file.pdfScroll=0;remember();render();
  };
  const change=event=>{if(!event.target.matches('.pdf-page-input')||!document)return;const value=Number(event.target.value);if(!Number.isInteger(value)||value<1||value>document.numPages){status();return;}file.pdfPage=value;file.pdfScroll=0;remember();render();};
  host.addEventListener('click',click);host.addEventListener('change',change);
  pages.addEventListener('scroll',()=>{file.pdfScroll=pages.scrollTop;remember();},{passive:true});
  loading.promise.then(value=>{if(disposed){value.destroy();return;}document=value;file.pdfPage=Math.min(file.pdfPage||1,document.numPages);lastWidth=Math.round(host.clientWidth);render();}).catch(error=>{if(!disposed)pages.textContent=`PDF 打开失败：${error.message}`;});
  return ()=>{disposed=true;++generation;observer.disconnect();cancelRender();host.removeEventListener('click',click);host.removeEventListener('change',change);loading.destroy().catch(()=>{});};
}
