// Use PDF.js's full viewer for continuous pages, lazy rendering and selectable text.
import * as pdfjs from './lib/pdfjs/pdf.min.mjs';
import {PDFViewer, EventBus, PDFLinkService} from './lib/pdfjs/pdf_viewer.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdfjs/pdf.worker.min.mjs',import.meta.url).href;
export function mountPdfReader(host,file) {
  let disposed=false, document, ready=false, lastWidth=0;
  const saved={page:file.pdfPage||1,scroll:file.pdfScroll||0,continuous:file.pdfContinuous===true,zoom:file.pdfZoom||1};
  const loading=pdfjs.getDocument({url:file.url,cMapUrl:new URL('./lib/pdfjs/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./lib/pdfjs/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./lib/pdfjs/wasm/',import.meta.url).href,enableXfa:false,isEvalSupported:false});
  host.innerHTML='<div class="pdf-toolbar"><button data-pdf="previous" aria-label="PDF 上一页">‹</button><label><input class="pdf-page-input" type="number" min="1" aria-label="PDF 页码" value="1"> / <span class="pdf-total">…</span></label><button data-pdf="next" aria-label="PDF 下一页">›</button><span class="toolbar-space"></span><button data-pdf="out" aria-label="PDF 缩小">−</button><span class="pdf-zoom">适合宽度</span><button data-pdf="in" aria-label="PDF 放大">＋</button><button data-pdf="fit">适合宽度</button></div><div class="pdf-scroll-frame"><div class="pdf-pages"><div class="pdfViewer"></div></div></div>';
  const pages=host.querySelector('.pdf-pages'),eventBus=new EventBus(),linkService=new PDFLinkService({eventBus});
  const viewer=new PDFViewer({container:pages,eventBus,linkService,annotationMode:0,annotationEditorMode:-1,maxCanvasPixels:16_777_216,enableDetailCanvas:false,enableAutoLinking:false});
  linkService.setViewer(viewer);
  const remember=()=>{if(ready&&!disposed){file.pdfScroll=pages.scrollTop;file.pdfContinuous=true;host.dispatchEvent(new CustomEvent('reader-position',{bubbles:true,detail:{file:file.id}}));}};
  function status(){
    if(!document||disposed)return;
    host.querySelector('.pdf-page-input').value=viewer.currentPageNumber;
    host.querySelector('.pdf-total').textContent=document.numPages;
    host.querySelector('[data-pdf="previous"]').disabled=viewer.currentPageNumber<=1;
    host.querySelector('[data-pdf="next"]').disabled=viewer.currentPageNumber>=document.numPages;
    host.querySelector('.pdf-zoom').textContent=`${Math.round((file.pdfZoom||1)*100)}%`;
  }
  function fit(){
    if(!ready||disposed)return;
    const page=viewer.currentPageNumber;
    viewer.currentScaleValue='page-width';
    if((file.pdfZoom||1)!==1)viewer.currentScale*=file.pdfZoom;
    viewer.currentPageNumber=page;
    status();
  }
  eventBus.on('pagesinit',()=>{
    if(disposed)return;
    for(let i=0;i<document.numPages;i++)viewer.getPageView(i).div.classList.add('pdf-sheet');
    ready=true;file.pdfZoom=saved.zoom;fit();
    viewer.currentPageNumber=Math.min(saved.page,document.numPages);
    // Legacy positions were offsets inside one page; new positions are continuous.
    pages.scrollTop=saved.continuous?saved.scroll:pages.scrollTop+saved.scroll;
    file.pdfPage=viewer.currentPageNumber;status();remember();
  });
  eventBus.on('pagerendered',event=>{if(!disposed){viewer.getPageView(event.pageNumber-1).div.dataset.rendered='true';}});
  eventBus.on('pagechanging',event=>{if(!disposed&&ready){file.pdfPage=event.pageNumber;status();remember();}});
  const observer=new ResizeObserver(()=>{const width=Math.round(host.clientWidth);if(ready&&width!==lastWidth){lastWidth=width;fit();}});observer.observe(host);
  const click=event=>{
    const button=event.target.closest('[data-pdf]');if(!button||!ready)return;
    const action=button.dataset.pdf;
    if(action==='previous')viewer.currentPageNumber=Math.max(1,viewer.currentPageNumber-1);
    else if(action==='next')viewer.currentPageNumber=Math.min(document.numPages,viewer.currentPageNumber+1);
    else{if(action==='out')file.pdfZoom=Math.max(.5,(file.pdfZoom||1)-.15);if(action==='in')file.pdfZoom=Math.min(2.5,(file.pdfZoom||1)+.15);if(action==='fit')file.pdfZoom=1;fit();}
    file.pdfPage=viewer.currentPageNumber;status();remember();
  };
  const change=event=>{if(!event.target.matches('.pdf-page-input')||!ready)return;const value=Number(event.target.value);if(Number.isInteger(value)&&value>=1&&value<=document.numPages)viewer.currentPageNumber=value;file.pdfPage=viewer.currentPageNumber;status();remember();};
  host.addEventListener('click',click);host.addEventListener('change',change);pages.addEventListener('scroll',remember,{passive:true});
  loading.promise.then(value=>{if(disposed){value.destroy();return;}document=value;lastWidth=Math.round(host.clientWidth);linkService.setDocument(value);viewer.setDocument(value);}).catch(error=>{if(!disposed)pages.textContent=`PDF 打开失败：${error.message}`;});
  return ()=>{disposed=true;observer.disconnect();host.removeEventListener('click',click);host.removeEventListener('change',change);pages.removeEventListener('scroll',remember);viewer.setDocument(null);linkService.setDocument(null);loading.destroy().catch(()=>{});};
}
