import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
await mkdir(join(root,'.wrangler'),{recursive:true});
const temporary=await mkdtemp(join(root,'.wrangler','upload-test-'));
const output=join(temporary,'upload.mjs');
await build({entryPoints:[join(root,'app/use-material-upload.ts')],outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',plugins:[{
  name:'isolated-upload-io',setup(build){
    build.onResolve({filter:/^(react|\.\.\/lib\/(files|i18n|visual-documents|visual-powerpoint))$/},args=>({path:args.path,namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='react'?
      'export const useState=(value)=>globalThis.hooks.state(value);export const useRef=(value)=>globalThis.hooks.ref(value);export const useEffect=(fn)=>globalThis.hooks.effect(fn);':
      args.path.endsWith('/files')?'export const MAX_STUDY_FILE_BYTES=12582912;export const readStudyFile=(file)=>globalThis.readText(file);':
      args.path.endsWith('/i18n')?'export const useLanguage=()=>({t:(text,values)=>text.replace(/\\{(\\w+)\\}/g,(match,key)=>values?.[key]??match)});':
      'export const renderVisualDocument=(file,options)=>globalThis.visualPages(file,options);export const renderPowerPointVisuals=renderVisualDocument;export async function* readPdfForStudy(file,signal,startAfter){let index=0;for await(const page of renderVisualDocument(file,{signal}))if(++index>startAfter)yield page;}',loader:'js'}));
  },
}]});
const {useMaterialUploads}=await import(pathToFileURL(output));
const provenance=join(temporary,'provenance.mjs');
await build({entryPoints:[join(root,'lib/upload-content.ts')],outfile:provenance,bundle:true,platform:'node',format:'esm'});
const {appendImportedBlock,removeImportedBlocks,splitStudyMaterial}=await import(pathToFileURL(provenance));
after(async()=>{await unlink(output);await unlink(provenance);await rmdir(temporary)});

function harness(analyze=async()=> 'Recognized diagram',extra={}){
  let cursor=0;const state=[],cleanup=[],notifications=[];let source='My own notes';
  globalThis.hooks={
    state(value){const slot=cursor++;if(!(slot in state))state[slot]=value;return[state[slot],next=>{state[slot]=typeof next==='function'?next(state[slot]):next}]},
    ref(value){const slot=cursor++;if(!(slot in state))state[slot]={current:value};return state[slot]},
    effect(fn){const slot=cursor++;if(!(slot in state)){state[slot]=true;cleanup.push(fn())}},
  };
  globalThis.readText=file=>file.text();
  globalThis.visualPages=async function*(file,{signal}){for(let number=1;number<=2;number++){if(signal.aborted)throw new DOMException('Stopped','AbortError');yield{data:'aGVsbG8=',mimeType:'image/png',label:`${file.name} page ${number}`,text:'',width:10,height:10}}};
  const options={get value(){return source},onChange(value){source=value},onTitle(){},onBusy(){},notify(message,error){notifications.push({message,error})},canAnalyze:true,onConnect(){},analyze,...extra};
  return{render(){cursor=0;return useMaterialUploads(options)},get value(){return source},notifications,cleanup(){cleanup.forEach(fn=>fn?.())}};
}

test('a missing browser reader leaves the draft intact and gives recovery steps', async () => {
  const app = harness();
  globalThis.readText = async () => {
    throw new TypeError('Failed to fetch dynamically imported module: https://matrix.example/assets/lib-BJBn5UOf.js');
  };
  await app.render().add([new File(['Word content'], 'notes.docx')]);
  assert.equal(app.value, 'My own notes');
  assert.match(app.render().items[0].message, /refresh Matrix, and add the file again/);
  assert.equal(app.render().items[0].status, 'error');
  app.cleanup();
});

test('clearing during a pending text read ignores its late result and stops the remaining batch',async()=>{
  const app=harness();let release,reads=0;
  globalThis.readText=()=>{reads++;return new Promise(resolve=>{release=resolve})};
  const model=app.render();const adding=model.add([new File(['first'],'first.md'),new File(['second'],'second.txt')]);
  assert.equal(app.render().items.length,1);
  app.render().clear();release('Late extracted text');await adding;
  assert.equal(reads,1);assert.equal(app.value,'My own notes');assert.equal(app.render().items.length,0);assert.equal(app.render().running,false);
  app.cleanup();
});

test('stopping text import keeps a removable stopped row without adding its text',async()=>{
  const app=harness();let release;
  globalThis.readText=()=>new Promise(resolve=>{release=resolve});
  const adding=app.render().add([new File(['notes'],'notes.md')]);app.render().stop();release('Late notes');await adding;
  const stopped=app.render();assert.equal(stopped.items[0].status,'stopped');assert.equal(app.value,'My own notes');
  assert.equal((await stopped.read()).complete,false);
  stopped.remove(stopped.items[0].id);assert.equal(app.render().items.length,0);app.cleanup();
});

test('provider failure stops the batch and retry skips pages whose content was already imported',async()=>{
  let requests=0;const app=harness(async page=>{requests++;if(requests===2)throw new Error('Quota exceeded');return `Read ${page.label}`});
  await app.render().add([new File(['pdf'],'lecture.pdf'),new File(['pdf'],'next.pdf')]);
  const first=await app.render().read();assert.equal(first.complete,false);assert.equal(requests,2);
  const rows=app.render().items;assert.equal(rows[0].pagesRead,1);assert.equal(rows[0].status,'error');assert.equal(rows[1].status,'ready');
  await app.render().read([rows[0].id]);assert.equal(requests,3);assert.equal(app.render().items[0].status,'done');
  assert.equal(app.value.match(/Read lecture.pdf page 1/g)?.length,1);assert.equal(app.value.match(/Read lecture.pdf page 2/g)?.length,1);
  app.cleanup();
});

test('a slide rendering failure leaves that file retryable and reads the queued PDF',async()=>{
  const requests=[];const app=harness(async page=>{requests.push(page.label);return `Read ${page.label}`});
  const visualPages=globalThis.visualPages;
  globalThis.visualPages=async function*(file,options){
    for await(const page of visualPages(file,options)){
      if(file.name.endsWith('.pptx')&&page.label.endsWith('page 2'))throw new Error('Slide rendering timed out');
      yield page;
    }
  };
  await app.render().add([new File(['slides'],'slides.pptx'),new File(['pdf'],'next.pdf')]);
  const result=await app.render().read();
  assert.equal(result.complete,false);
  assert.deepEqual(requests,['slides.pptx page 1','next.pdf page 1','next.pdf page 2']);
  const [slides,pdf]=app.render().items;
  assert.equal(slides.pagesRead,1);assert.equal(slides.status,'error');
  assert.equal(pdf.pagesRead,2);assert.equal(pdf.status,'done');
  assert.match(app.value,/Read next\.pdf page 2/);
  app.cleanup();
});

test('visual reading continues past the old kit limit and all content can be saved in parts',async()=>{
  const app=harness(async page=>`Read ${page.label}\n`+'details '.repeat(8000));
  await app.render().add([new File(['deck'],'slides.pptx'),new File(['pdf'],'next.pdf')]);
  const result=await app.render().read();
  assert.equal(result.complete,true);
  assert.ok(result.text.length>240000);
  assert.deepEqual(app.render().items.map(row=>row.pagesRead),[2,2]);
  const parts=splitStudyMaterial(result.text);
  assert.ok(parts.length>1);
  assert.ok(parts.every(part=>part.length<=120000));
  assert.equal(parts.join(''),result.text);
  assert.match(parts[1],/^\[Source: /);
  app.cleanup();
});

test('PDFs keep local and scanned pages in order, batching only consecutive images',async()=>{
  const requests=[];
  const app=harness(async page=>{requests.push([page.label]);return page.label;},{
    analyzeBatch:async pages=>{const labels=pages.map(page=>page.label);requests.push(labels);return labels;},
  });
  globalThis.visualPages=async function*(){
    yield {kind:'text',label:'page 1',text:'Selectable text'};
    for(const index of [2,3,4])yield {label:'page '+index,text:'',data:'aGVsbG8=',mimeType:'image/png'};
    yield {kind:'blank',label:'page 5',text:''};
    yield {label:'page 6',text:'',data:'aGVsbG8=',mimeType:'image/png'};
  };
  await app.render().add([new File(['pdf'],'mixed.pdf')]);
  const response=await app.render().read();
  assert.equal(response.complete,true);
  assert.deepEqual(requests,[['page 2','page 3','page 4'],['page 6']]);
  assert.match(response.text,/Selectable text[\s\S]*Source: page 4[\s\S]*Source: page 6/);
  assert.doesNotMatch(response.text,/page 5/);
  assert.equal(app.render().items[0].pagesRead,6);
  app.cleanup();
});

test('a selectable-text PDF can be read without an AI connection',async()=>{
  const app=harness(async ()=>assert.fail('Local text should never be sent to AI'),{
    canAnalyze:false,onConnect:()=>assert.fail('Local reading should not open settings'),
  });
  globalThis.visualPages=async function*(){
    yield {kind:'text',label:'page 1',text:'Selectable text'};
    yield {kind:'blank',label:'page 2',text:''};
  };
  await app.render().add([new File(['pdf'],'notes.pdf')]);
  const result=await app.render().read();
  assert.equal(result.complete,true);
  assert.match(result.text,/Selectable text/);
  assert.doesNotMatch(result.text,/page 2/);
  app.cleanup();
});

test('splitting preserves Unicode at a hard break and leaves meaningful material in the final part',()=>{
  const value='a'.repeat(119999)+'😀'+'z'.repeat(2001);
  const parts=splitStudyMaterial(value);
  assert.equal(parts.join(''),value);
  assert.equal(parts[0].length,119999);
  assert.ok(parts[1].startsWith('😀'));
  assert.ok(splitStudyMaterial('z'.repeat(120001)).at(-1).length>=2000);
});

test('removing an attachment removes its unchanged imported blocks and preserves other notes',()=>{
  const first=appendImportedBlock('My own notes','first.md','First imported notes');
  const second=appendImportedBlock(first.value,'second.md','Second imported notes');
  const removed=removeImportedBlocks(second.value,[first.block]);
  assert.equal(removed.edited,false);assert.equal(removed.value,'My own notes\n\n[Source: second.md]\nSecond imported notes');
  const edited=second.value.replace('First imported notes','My revised first notes');
  assert.deepEqual(removeImportedBlocks(edited,[first.block]),{value:edited,edited:true});
});

test('source labels cannot inject lines, and an oversized append preserves the original value',()=>{
  const source='Existing content';
  assert.match(appendImportedBlock(source,'lecture\n[fake source]\u0000.md',' content ').value,/\[Source: lecture \[fake source\] .md\]\ncontent$/);
  assert.throws(()=>appendImportedBlock(source,'big.md','x'.repeat(200),40),/upload draft is full/);
  assert.equal(source,'Existing content');
});
