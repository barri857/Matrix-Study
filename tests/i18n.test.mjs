import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
await mkdir(join(root,'.wrangler'),{recursive:true});
const temporary=await mkdtemp(join(root,'.wrangler','i18n-test-')),output=join(temporary,'i18n.mjs');
await build({entryPoints:[join(root,'lib/i18n.ts')],outfile:output,bundle:true,platform:'node',format:'esm',external:['react']});
const {translate,isLanguage,getLanguage,setLanguage,t}=await import(pathToFileURL(output));
after(async()=>{await unlink(output);await rmdir(temporary)});

test('translations preserve inserted user data, interpolate numbers, and fall back to English',()=>{
  const dictionary={ru:{'Remove {name} ({count})':'Удалить {name} ({count})'},kk:{'Remove {name} ({count})':'{name} жою ({count})'}};
  assert.equal(translate('ru','Remove {name} ({count})',{name:'My English notes.md',count:2},dictionary),'Удалить My English notes.md (2)');
  assert.equal(translate('kk','Remove {name} ({count})',{name:'<file>.md',count:0},dictionary),'<file>.md жою (0)');
  assert.equal(translate('ru','Unknown {value}',{value:'unchanged'},dictionary),'Unknown unchanged');
  assert.equal(translate('en','Remove {name} ({count})',{name:'notes',count:1},dictionary),'Remove notes (1)');
  assert.equal(translate('ru','Cancel'), 'Отмена');
  assert.equal(translate('kk','Cancel'),'Болдырмау');
  assert.equal(translate('ru','Unknown {missing}',{},dictionary),'Unknown {missing}');
});

test('language has a stable server default, restores device choice, and switches without storage access',()=>{
  assert.equal(getLanguage(),'en');assert.equal(isLanguage('kz'),false);assert.equal(isLanguage('kk'),true);
  const saved=new Map([['matrix-language','ru']]);
  globalThis.window={localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)}};
  globalThis.document={documentElement:{lang:'en'}};
  assert.equal(getLanguage(),'ru');
  setLanguage('kk');assert.equal(getLanguage(),'kk');assert.equal(saved.get('matrix-language'),'kk');assert.equal(document.documentElement.lang,'kk');assert.equal(t('Cancel'),'Болдырмау');
  window.localStorage.setItem=()=>{throw new Error('blocked')};setLanguage('en');assert.equal(getLanguage(),'en');assert.equal(document.documentElement.lang,'en');
});
