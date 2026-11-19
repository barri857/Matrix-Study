export async function readStudyFile(file: File): Promise<string> {
  if(file.size>12*1024*1024) throw new Error('Please choose a file smaller than 12 MB.');
  const ext=file.name.split('.').pop()?.toLowerCase();
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
  if(ext==='docx') {const mammoth=await import('mammoth'); return (await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;}
  if(['txt','md','csv','srt','vtt'].includes(ext||''))return file.text();
  throw new Error('Choose PDF, DOCX, TXT, Markdown, CSV, SRT or VTT.');
}
export function downloadFile(name:string,text:string,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
