'use client';
import {useRef,useState,type DragEvent} from 'react';
import {CheckCircle2,FileWarning,FileText,LoaderCircle,ScanEye,Upload,X} from 'lucide-react';
import {STUDY_FILE_ACCEPT} from '../lib/files';
import type {MaterialUploads} from './use-material-upload';
import {useLanguage} from '../lib/i18n';
import {uploadTranslations} from '../lib/upload-translations';
import './material-upload.css';

export default function MaterialUpload({model,disabled}:{model:MaterialUploads;disabled:boolean}){
 const {t}=useLanguage(uploadTranslations);
 const input=useRef<HTMLInputElement>(null),depth=useRef(0);const[dragging,setDragging]=useState(false);
 const locked=disabled&&!model.running;
 const isFile=(event:DragEvent)=>Array.from(event.dataTransfer.types).includes('Files');
 return <div className="material-upload" aria-busy={model.running}
 onDragEnter={event=>{if(!isFile(event))return;event.preventDefault();event.stopPropagation();if(!disabled){depth.current++;setDragging(true)}}}
 onDragOver={event=>{if(!isFile(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect=disabled?'none':'copy'}}
 onDragLeave={event=>{if(!isFile(event))return;event.preventDefault();event.stopPropagation();depth.current=Math.max(0,depth.current-1);if(!depth.current)setDragging(false)}}
 onDrop={event=>{if(!isFile(event))return;event.preventDefault();event.stopPropagation();depth.current=0;setDragging(false);if(!disabled)void model.add(Array.from(event.dataTransfer.files))}}>
 <input ref={input} type="file" multiple hidden accept={STUDY_FILE_ACCEPT} onChange={event=>{const files=Array.from(event.target.files||[]);event.target.value='';void model.add(files)}}/>
 <button type="button" className={`upload-zone ${dragging?'is-dragging':''}`} disabled={disabled||model.running} onClick={()=>input.current?.click()}><Upload size={28}/><strong>{t(dragging?'Drop your files here':'Drop files here, or click to choose')}</strong><span>{t('Images, PDF, Word, PowerPoint, Markdown & text')}</span><span>{t('Up to 20 files · 12 MB each · 120,000 characters per kit')}</span></button>
 <p className="material-upload-note muted tiny">{t('PDF pages, PowerPoint slides, and photos are read visually by your selected AI. This includes readable text, diagrams, charts, and scanned pages. Visual reading uses your provider’s API allowance.')}</p>
 {model.items.length>0&&<div className="material-upload-actions"><span className="tiny muted">{t('Files: {count}',{count:model.items.length})}</span><div>{model.running?<button className="button secondary small" onClick={model.stop}>{t('Stop reading')}</button>:model.pending&&<button className="button secondary small" disabled={locked} onClick={()=>model.canAnalyze?void model.read():model.connect()}><ScanEye size={16}/>{t(model.canAnalyze?'Read visuals with AI':'Connect AI to read visuals')}</button>}<button className="button ghost small" disabled={locked} onClick={model.clear}>{t('Clear all')}</button></div></div>}
 <p className="material-upload-status tiny" role="status" aria-live="polite">{model.progress}</p>
 {model.items.length>0&&<ul className="material-upload-results" aria-label={t('Attached files')}>{model.items.map(item=><li key={item.id} className={item.status}>
 {item.preview?<img src={item.preview} alt="" className="material-thumbnail"/>:item.status==='reading'?<LoaderCircle size={20} className="material-spinner"/>:item.status==='done'?<CheckCircle2 size={20}/>:item.status==='error'?<FileWarning size={20}/>:<FileText size={20}/>}
 <div><strong>{item.file.name}</strong><span>{t(item.message,item.messageValues)}</span>{item.warnings.map(warning=><span className="material-warning" key={warning}>{t(warning)}</span>)}{item.visual&&['error','stopped'].includes(item.status)&&<button className="material-retry" disabled={disabled||model.running} onClick={()=>void model.read([item.id])}>{t('Retry visual reading')}</button>}</div>
 <button type="button" className="icon-button material-remove" disabled={locked} aria-label={t('Remove {filename}',{filename:item.file.name})} title={t('Remove file')} onClick={()=>model.remove(item.id)}><X size={18}/></button>
 </li>)}</ul>}
 {model.pending&&<p className="tiny muted">{t('Generate reads any pending visuals first. You can stop and resume without rereading completed pages. Keep this tab open until reading finishes.')}</p>}
 {model.running&&model.items.some(item=>item.status==='reading'&&item.file.name.toLowerCase().endsWith('.pptx'))&&<p className="tiny muted">{t('PowerPoint rendering resumes when you return to this tab.')}</p>}
 </div>;
}
