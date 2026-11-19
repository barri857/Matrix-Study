export type ImportedBlock={text:string;separator:string};
export function appendImportedBlock(value:string,label:string,content:string,limit=120000){
  const text=`[Source: ${label.replace(/[\r\n\x00-\x1f]/g,' ').slice(0,240)}]\n${content.trim()}`;
  const separator=value?'\n\n':'';
  if(value.length+separator.length+text.length>limit)throw new Error('This kit reached its 120,000-character limit. Split the remaining files into another kit; already-read material has been kept.');
  return {value:value+separator+text,block:{text,separator}};
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
