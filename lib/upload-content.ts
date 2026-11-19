export type ImportedBlock={text:string;separator:string};
export const MAX_UPLOAD_DRAFT_CHARACTERS=1_200_000;
export const MAX_KIT_SOURCE_CHARACTERS=120_000;

export function appendImportedBlock(value:string,label:string,content:string,limit=MAX_UPLOAD_DRAFT_CHARACTERS){
  const text=`[Source: ${label.replace(/[\r\n\x00-\x1f]/g,' ').slice(0,240)}]\n${content.trim()}`;
  const separator=value?'\n\n':'';
  if(value.length+separator.length+text.length>limit)throw new Error('This upload draft is full. Shorten the draft or remove a file before continuing.');
  return {value:value+separator+text,block:{text,separator}};
}

export function splitStudyMaterial(value:string):string[]{
  const limit=MAX_KIT_SOURCE_CHARACTERS;
  const parts:string[]=[];
  let start=0;
  while(value.length-start>limit){
    const end=Math.min(start+limit,value.length-2000);
    const minimum=start+Math.floor(limit/2);
    const nextSource=value.lastIndexOf('\n\n[Source: ',end-2);
    const paragraph=value.lastIndexOf('\n\n',end-2);
    const line=value.lastIndexOf('\n',end-1);
    let split=nextSource>=minimum?nextSource+2:paragraph>=minimum?paragraph+2:line>=minimum?line+1:end;
    // Keep a UTF-16 surrogate pair in the same part at a hard break.
    if(split>start+1&&/[\uD800-\uDBFF]/.test(value[split-1])&&/[\uDC00-\uDFFF]/.test(value[split]))split--;
    parts.push(value.slice(start,split));
    start=split;
  }
  parts.push(value.slice(start));
  return parts;
}
export function removeImportedBlocks(value:string,blocks:ImportedBlock[]){
  let edited=false;
  for(const block of [...blocks].reverse()){
    const combined=block.separator+block.text;
    const at=value.lastIndexOf(combined);
    if(at>=0)value=value.slice(0,at)+value.slice(at+combined.length);
    else if(value.startsWith(block.text))value=value.slice(block.text.length).replace(/^\n\n/,'');
    else edited=true;
  }
  return {value,edited};
}
