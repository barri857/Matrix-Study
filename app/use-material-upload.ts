'use client';
import {useEffect,useRef,useState} from 'react';
import {readStudyFile,MAX_STUDY_FILE_BYTES} from '../lib/files';
import {appendImportedBlock,removeImportedBlocks,MAX_UPLOAD_DRAFT_CHARACTERS,type ImportedBlock} from '../lib/upload-content';
import type {StudyPage,VisualPage} from '../lib/visual-documents';
import {MAX_PDF_AI_PAGES,pdfBatchFits} from '../lib/pdf-read-batch';
import {useLanguage,type TranslationVariables} from '../lib/i18n';
import {uploadTranslations} from '../lib/upload-translations';

export type UploadEntry={id:string;file:File;visual:boolean;status:'ready'|'reading'|'done'|'error'|'stopped';message:string;messageValues?:TranslationVariables;pagesRead:number;blocks:ImportedBlock[];preview?:string;warnings:string[]};
type Options={value:string;onChange:(value:string)=>void;onTitle:(title:string)=>void;onBusy:(message:string)=>void;notify:(message:string,error?:boolean)=>void;canAnalyze:boolean;onConnect:()=>void;analyze:(page:VisualPage,signal:AbortSignal)=>Promise<string>;analyzeBatch?:(pages:readonly VisualPage[],signal:AbortSignal)=>Promise<string[]|null>};
const visualExtensions=new Set(['pdf','pptx','jpg','jpeg','png','webp','gif','bmp']);

function readingError(error:unknown,fallback:string){
  if(!(error instanceof Error))return fallback;
  if(/failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i.test(error.message)){
    return 'The file reader could not load. Copy any text you want to keep, refresh Matrix, and add the file again.';
  }
  return error.message;
}

export function useMaterialUploads(options:Options){
  const {t}=useLanguage(uploadTranslations);
  const translateRef=useRef(t);translateRef.current=t;
  const [items,setItems]=useState<UploadEntry[]>([]),[progress,setProgress]=useState(''),[running,setRunning]=useState(false);
  const [progressValues,setProgressValues]=useState<TranslationVariables>({});
  const itemsRef=useRef(items),valueRef=useRef(options.value),optionsRef=useRef(options),controllerRef=useRef<AbortController|null>(null),mounted=useRef(true),working=useRef(false);
  optionsRef.current=options;valueRef.current=options.value;
  const update=(fn:(entries:UploadEntry[])=>UploadEntry[])=>{itemsRef.current=fn(itemsRef.current);if(mounted.current)setItems(itemsRef.current)};
  const change=(value:string)=>{valueRef.current=value;optionsRef.current.onChange(value)};
  const patch=(id:string,values:Partial<UploadEntry>)=>update(entries=>entries.map(item=>item.id===id?{...item,...values}:item));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controllerRef.current?.abort();itemsRef.current.forEach(item=>{if(item.preview)URL.revokeObjectURL(item.preview)})}},[]);

  async function add(files:File[]){
    if(working.current||!files.length)return;
    if(itemsRef.current.length+files.length>20){optionsRef.current.notify(translateRef.current('Keep up to 20 files in one kit. Remove a file or start another kit.'),true);return}
    const controller=new AbortController();controllerRef.current=controller;
    working.current=true;setRunning(true);optionsRef.current.onBusy(translateRef.current('Reading your documents'));
    let added=0;
    try{
      for(const file of files){
        if(!mounted.current||controller.signal.aborted)break;
        const extension=file.name.split('.').pop()?.toLowerCase()||'';
        const id=crypto.randomUUID(),visual=visualExtensions.has(extension);
        const entry:UploadEntry={id,file,visual,status:visual?'ready':'reading',message:visual?'Ready for visual reading':'Reading text…',pagesRead:0,blocks:[],warnings:[]};
        update(entries=>[...entries,entry]);setProgress('Adding {filename}');setProgressValues({filename:file.name});
        try{
          if(file.size>MAX_STUDY_FILE_BYTES)throw new Error('This file is larger than 12 MB. Choose a smaller file.');
          if(visual){
            if(['jpg','jpeg','png','webp','gif','bmp'].includes(extension))patch(id,{preview:URL.createObjectURL(file)});
            added++;
          }else{
            const text=await readStudyFile(file,MAX_UPLOAD_DRAFT_CHARACTERS);
            if(controller.signal.aborted||!mounted.current)throw new DOMException('Reading stopped','AbortError');
            if(!itemsRef.current.some(item=>item.id===id))continue;
            const result=appendImportedBlock(valueRef.current,file.name,text);
            change(result.value);patch(id,{status:'done',message:'Text added',blocks:[result.block]});added++;
          }
          optionsRef.current.onTitle(file.name.replace(/\.[^.]+$/,'').slice(0,160));
        }catch(error){
          const stopped=controller.signal.aborted;
          patch(id,{status:stopped?'stopped':'error',message:stopped?'Stopped before text was added. Remove this file and add it again.':readingError(error,'This file could not be read.')});
          if(stopped)break;
        }
      }
      if(mounted.current&&!controller.signal.aborted){
        const pending=itemsRef.current.some(item=>item.visual&&item.status==='ready');
        optionsRef.current.notify(translateRef.current('Files added: {count}.',{count:added})+(pending?' '+translateRef.current('Choose Read files to process your attachments.') : ''),added!==files.length);
      }
    }finally{controllerRef.current=null;working.current=false;if(mounted.current){setProgress('');setRunning(false);optionsRef.current.onBusy('')}}
  }

  async function read(ids?:string[]):Promise<{complete:boolean;text:string}>{
    if(working.current)return {complete:false,text:valueRef.current};
    const pending=itemsRef.current.filter(item=>item.visual&&item.status!=='done'&&(!ids||ids.includes(item.id)));
    if(!pending.length)return {complete:!itemsRef.current.some(item=>item.status!=='done'),text:valueRef.current};
    const controller=new AbortController();controllerRef.current=controller;working.current=true;setRunning(true);optionsRef.current.onBusy(translateRef.current('Reading your documents'));
    try{
      for(const queued of pending){
        if(controller.signal.aborted)break;
        const item=itemsRef.current.find(current=>current.id===queued.id);if(!item)continue;
        patch(item.id,{status:'reading',message:'Preparing visual pages…'});
        let rendering=true;
        try{
          const name=item.file.name.toLowerCase();
          const isPowerPoint=name.endsWith('.pptx');
          const isPdf=name.endsWith('.pdf');
          const signal=controller.signal;
          const iterator=isPowerPoint?(await import('../lib/visual-powerpoint')).renderPowerPointVisuals(item.file,{
            signal:controller.signal,
            onSlide(number){
              if(number<=item.pagesRead)return;
              setProgress('Preparing {filename} · slide {number}');setProgressValues({filename:item.file.name,number});
              patch(item.id,{message:'Preparing slide {number}…',messageValues:{number}});
            },
            onPdfFallback(number){
              if(number<=item.pagesRead)return;
              setProgress('Converting {filename} · slide {number} to PDF');setProgressValues({filename:item.file.name,number});
              patch(item.id,{message:'Converting slide {number} to PDF…',messageValues:{number}});
            },
          }):isPdf?(await import('../lib/visual-documents')).readPdfForStudy(item.file,signal,item.pagesRead,(number,total)=>{
              setProgress('Preparing {filename} · page {number} of {total}');
              setProgressValues({filename:item.file.name,number,total});
              patch(item.id,{message:'Preparing page {number} of {total}…',messageValues:{number,total}});
            })
            :(await import('../lib/visual-documents')).renderVisualDocument(item.file,{signal});
          let pageNumber=isPdf?item.pagesRead:0;
          const batch: {page:VisualPage;number:number}[]=[];
          function commit(page:StudyPage,number:number,content:string){
            signal.throwIfAborted();
            const current=itemsRef.current.find(entry=>entry.id===queued.id);if(!current)return;
            const blank='kind' in page&&page.kind==='blank';
            const warnings=[...current.warnings,...(page.warnings||[])];
            let blocks=current.blocks;
            if(blank)warnings.push('Blank PDF pages were skipped.');
            else{
              const result=appendImportedBlock(valueRef.current,page.label,content);
              change(result.value);
              blocks=[...blocks,result.block];
            }
            patch(current.id,{pagesRead:number,blocks,warnings:[...new Set(warnings)].slice(0,12)});
          }
          async function readBatch(){
            if(!batch.length)return;
            signal.throwIfAborted();
            rendering=false;
            const {analyze,analyzeBatch,canAnalyze,onConnect}=optionsRef.current;
            if(!canAnalyze){
              onConnect();
              throw new Error('Connect a vision-capable AI model to read images and document pages.');
            }
            const number=batch[0].number;
            const last=batch[batch.length-1].number;
            const values={filename:queued.file.name,number,last};
            setProgress(batch.length>1?'Reading {filename} · pages {number}–{last}':isPowerPoint?'Reading {filename} · slide {number}':'Reading {filename} · page {number}');
            setProgressValues(values);
            patch(queued.id,{message:batch.length>1?'Reading pages {number}–{last}…':isPowerPoint?'Reading slide {number}…':'Reading page {number}…',messageValues:values});
            const replies=batch.length>1&&analyzeBatch?await analyzeBatch(batch.map(entry=>entry.page),signal):null;
            for(const [index,entry] of batch.entries()){
              signal.throwIfAborted();
              commit(entry.page,entry.number,replies?.[index]??await analyze(entry.page,signal));
            }
            batch.length=0;
            rendering=true;
          }
          for await(const page of iterator){
            pageNumber++;
            signal.throwIfAborted();
            if(pageNumber<=item.pagesRead)continue;
            if(!itemsRef.current.some(current=>current.id===item.id))break;
            if('kind' in page){
              await readBatch();
              rendering=false;
              commit(page,pageNumber,page.text);
              rendering=true;
              continue;
            }
            if(batch.length&&!pdfBatchFits([...batch.map(entry=>entry.page),page]))await readBatch();
            batch.push({page,number:pageNumber});
            if(!isPdf||!optionsRef.current.analyzeBatch||batch.length>=MAX_PDF_AI_PAGES)await readBatch();
          }
          await readBatch();
          if(itemsRef.current.some(current=>current.id===item.id))patch(item.id,{status:'done',message:isPowerPoint?'Visual reading complete · slides: {count}':isPdf?'PDF reading complete · pages: {count}':'Visual reading complete · pages/images: {count}',messageValues:{count:pageNumber}});
        }catch(error){
          const stopped=controller.signal.aborted;
          if(itemsRef.current.some(current=>current.id===item.id))patch(item.id,{status:stopped?'stopped':'error',message:stopped?'Stopped. Read again to continue from the next unread page.':readingError(error,'Visual reading failed. Try again.')});
          // An unreadable file is isolated. Provider failures and kit limits apply to the entire batch.
          if(stopped||!rendering)break;
        }
      }
    }finally{controllerRef.current=null;working.current=false;if(mounted.current){setProgress('');setRunning(false);optionsRef.current.onBusy('')}}
    const complete=!controller.signal.aborted&&!itemsRef.current.some(item=>item.status!=='done');
    if(mounted.current&&!complete&&!controller.signal.aborted)optionsRef.current.notify(translateRef.current('Some files still need attention. Retry them or remove them before generating.'),true);
    return {complete,text:valueRef.current};
  }

  function remove(id:string){
    const item=itemsRef.current.find(item=>item.id===id);if(!item)return;
    if(item.status==='reading')controllerRef.current?.abort();
    const result=removeImportedBlocks(valueRef.current,item.blocks);change(result.value);
    if(item.preview)URL.revokeObjectURL(item.preview);update(entries=>entries.filter(entry=>entry.id!==id));
    optionsRef.current.notify(translateRef.current(result.edited?'File removed. Your edited notes were kept.':'File and its unchanged imported content removed.'));
  }
  function clear(){
    controllerRef.current?.abort();let text=valueRef.current,edited=false;
    for(const item of [...itemsRef.current].reverse()){const result=removeImportedBlocks(text,item.blocks);text=result.value;edited=edited||result.edited;if(item.preview)URL.revokeObjectURL(item.preview)}
    change(text);update(()=>[]);optionsRef.current.notify(translateRef.current(edited?'Files cleared. Your edited notes were kept.':'Files and their unchanged imported content cleared.'));
  }
  function reset(){controllerRef.current?.abort();itemsRef.current.forEach(item=>{if(item.preview)URL.revokeObjectURL(item.preview)});update(()=>[])}
  return {items,progress:t(progress,progressValues),running,add,read,remove,clear,reset,stop:()=>controllerRef.current?.abort(),pending:items.some(item=>item.visual&&item.status!=='done')};
}
export type MaterialUploads=ReturnType<typeof useMaterialUploads>;
