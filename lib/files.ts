export const MAX_STUDY_FILE_BYTES = 12 * 1024 * 1024;
export const MAX_STUDY_CHARACTERS = 120000;
export const MAX_STUDY_BATCH_FILES = 20;
export const STUDY_FILE_ACCEPT = '.pdf,.docx,.pptx,.txt,.md,.csv,.srt,.vtt';
function checkedText(text: string): string {
  if (text.length > MAX_STUDY_CHARACTERS) throw new Error('This document is too long. Split it into smaller files (120,000 characters maximum).');
  if (!text.trim()) throw new Error('No readable text was found in this file.');
  return text.trim();
}
export async function readStudyFile(file: File): Promise<string> {
  if(file.size>MAX_STUDY_FILE_BYTES) throw new Error('This file is larger than 12 MB. Choose a smaller file.');
  const ext=file.name.split('.').pop()?.toLowerCase();
  if(ext==='ppt') throw new Error('Older .ppt files are not supported. Open it in PowerPoint and choose Save As → PowerPoint Presentation (.pptx), then try again.');
  if(ext==='pptx') {const {readPowerPoint}=await import('./pptx');return checkedText(await readPowerPoint(await file.arrayBuffer(),MAX_STUDY_CHARACTERS));}
  if(ext==='pdf') {
    const pdf=await import('pdfjs-dist');
    pdf.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';
    const task=pdf.getDocument({data:await file.arrayBuffer()});
    const doc=await task.promise;
    if(doc.numPages>200) {await task.destroy(); throw new Error('Please split PDFs longer than 200 pages.');}
    const pages:string[]=[];
    try { for(let i=1;i<=doc.numPages;i++) {const page=await doc.getPage(i);const content=await page.getTextContent();pages.push(`[Page ${i}]\n`+content.items.map(item=>'str' in item?item.str:'').join(' ')); if(pages.join('').length>120000)throw new Error('This document is too long. Please split it into smaller files.');} }finally{await task.destroy();}
    const text=pages.join('\n\n');
    if(text.replace(/\[Page \d+\]/g,'').trim().length<30)throw new Error('This PDF appears to be scanned. Paste its OCR text or use a PDF with selectable text.');
    return text;
  }
  if(ext==='docx') {const mammoth=await import('mammoth'); return checkedText((await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value);}
  if(['txt','md','csv','srt','vtt'].includes(ext||''))return checkedText(await file.text());
  throw new Error('Choose PDF, DOCX, PPTX, TXT, Markdown, CSV, SRT or VTT.');
}
export type StudyFileResult = { name: string; status: 'added' | 'error'; characters?: number; message?: string };
export type StudyBatchProgress = { index: number; total: number; name: string; results: StudyFileResult[] };
export async function readStudyFiles(files: readonly File[], existingText: string, onProgress?: (progress: StudyBatchProgress) => void, reader: (file: File) => Promise<string> = readStudyFile) {
  if (files.length > MAX_STUDY_BATCH_FILES) throw new Error('Choose up to 20 files at a time. None of this batch was added.');
  if (existingText.length > MAX_STUDY_CHARACTERS) throw new Error('Your material already exceeds 120,000 characters. Shorten it before adding files.');
  let text = existingText;
  let title = '';
  const results: StudyFileResult[] = [];
  for (const [index, file] of files.entries()) {
    onProgress?.({ index, total: files.length, name: file.name, results: [...results] });
    try {
      if (file.size > MAX_STUDY_FILE_BYTES) throw new Error('This file is larger than 12 MB. Choose a smaller file.');
      const content = checkedText(await reader(file));
      const label = file.name.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0,180);
      const addition = `${text ? '\n\n' : ''}[Source: ${label}]\n${content}`;
      if (text.length + addition.length > MAX_STUDY_CHARACTERS) throw new Error(`Not added: this would exceed the combined 120,000-character limit. ${Math.max(0, MAX_STUDY_CHARACTERS - text.length).toLocaleString()} characters remain.`);
      text += addition;
      if (!title) title = file.name.replace(/\.[^.]+$/, '').slice(0,160);
      results.push({ name: file.name, status: 'added', characters: content.length });
    } catch (error) {
      results.push({ name: file.name, status: 'error', message: error instanceof Error ? error.message : 'This file could not be read. Try exporting a new copy.' });
    }
  }
  return { text, title, results };
}
export function downloadFile(name:string,text:string,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
