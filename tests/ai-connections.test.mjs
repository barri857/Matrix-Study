import test, {after, beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, unlink, rmdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, '.wrangler'), {recursive: true});
const temporary = await mkdtemp(join(root, '.wrangler', 'connections-test-'));
const output = join(temporary, 'connections.mjs');
await build({entryPoints: [join(root, 'lib/ai-connections.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', target: 'node24'});
const {loadAIConnection, keepAIConnectionInTab, saveAIConnection, forgetAIConnection} = await import(pathToFileURL(output));
after(async () => {await unlink(output); await rmdir(temporary);});
class MemoryStorage {
  data = new Map();
  getItem(key) {return this.data.get(key) ?? null;}
  setItem(key, value) {this.data.set(key, String(value));}
  removeItem(key) {this.data.delete(key);}
}
const gemini = {provider: 'gemini', model: 'gemini-4-hydrogen', apiKey: 'test-key-Gemini-only', remember: false};
const openai = {provider: 'openai', model: 'gpt-6-luna', apiKey: 'test-key-OpenAI-only', remember: false};
beforeEach(() => {
  Object.defineProperty(globalThis, 'sessionStorage', {value: new MemoryStorage(), configurable: true, writable: true});
  Object.defineProperty(globalThis, 'localStorage', {value: new MemoryStorage(), configurable: true, writable: true});
});

test('legacy single-provider key survives migration and switching providers', () => {
  sessionStorage.setItem('matrix-api', JSON.stringify(gemini));
  assert.deepEqual(loadAIConnection(), gemini);
  keepAIConnectionInTab(openai);
  assert.deepEqual(loadAIConnection(), openai);
  assert.deepEqual(loadAIConnection('gemini'), gemini);
  assert.deepEqual(loadAIConnection('openai'), openai);
});
test('new tabs get only remembered keys; sessions keep independent active providers', () => {
  saveAIConnection({...gemini, remember: true});
  keepAIConnectionInTab(openai);
  const firstTab = sessionStorage;
  globalThis.sessionStorage = new MemoryStorage();
  assert.deepEqual(loadAIConnection(), {...gemini, remember: true});
  assert.equal(loadAIConnection('openai'), null);
  keepAIConnectionInTab({...gemini, remember: true});
  globalThis.sessionStorage = firstTab;
  assert.deepEqual(loadAIConnection(), openai);
});
test('disabling Remember removes persistent copies but keeps current tab key', () => {
  saveAIConnection({...gemini, remember: true});
  keepAIConnectionInTab(gemini);
  assert.deepEqual(loadAIConnection(), gemini);
  assert.ok(!JSON.stringify([...localStorage.data]).includes(gemini.apiKey));
  globalThis.sessionStorage = new MemoryStorage();
  assert.equal(loadAIConnection('gemini'), null);
});
test('disconnect cannot resurrect from legacy records, profiles or another tab session', () => {
  saveAIConnection({...gemini, remember: true});
  const firstTab = sessionStorage;
  globalThis.sessionStorage = new MemoryStorage();
  keepAIConnectionInTab({...gemini, remember: true});
  const staleTab = sessionStorage;
  globalThis.sessionStorage = firstTab;
  forgetAIConnection('gemini');
  assert.equal(loadAIConnection('gemini'), null);
  keepAIConnectionInTab({...gemini, apiKey: '', remember: false});
  keepAIConnectionInTab(openai);
  assert.equal(loadAIConnection('gemini').apiKey, '');
  globalThis.sessionStorage = staleTab;
  assert.equal(loadAIConnection(), null);
  assert.equal(loadAIConnection('gemini'), null);
  globalThis.sessionStorage = new MemoryStorage();
  assert.equal(loadAIConnection('gemini'), null);
});
test('disconnecting one provider preserves others and permits explicit reconnect', () => {
  saveAIConnection({...gemini, remember: true});
  saveAIConnection({...openai, remember: true});
  forgetAIConnection('gemini');
  assert.deepEqual(loadAIConnection('openai'), {...openai, remember: true});
  saveAIConnection({...gemini, apiKey: 'new-test-key', remember: true});
  assert.equal(loadAIConnection('gemini').apiKey, 'new-test-key');
});
test('malformed records do not hide valid remembered keys or restore invalid providers', () => {
  localStorage.setItem('matrix-api', JSON.stringify({...gemini, remember: true}));
  sessionStorage.setItem('matrix-api', '{bad json');
  sessionStorage.setItem('matrix-api-profiles', JSON.stringify({gemini: {...openai}, constructor: {...gemini, provider: 'constructor'}}));
  assert.deepEqual(loadAIConnection('gemini'), {...gemini, remember: true});
  assert.deepEqual(loadAIConnection(), {...gemini, remember: true});
  assert.equal(loadAIConnection('constructor'), null);
  assert.throws(() => keepAIConnectionInTab({...gemini, apiKey: 'key\r\nInjected'}), /not valid/);
});
test('blocked session storage still allows reading remembered connections', () => {
  saveAIConnection({...gemini, remember: true});
  Object.defineProperty(globalThis, 'sessionStorage', {get() {throw new Error('blocked');}, configurable: true});
  assert.deepEqual(loadAIConnection(), {...gemini, remember: true});
  assert.deepEqual(loadAIConnection('gemini'), {...gemini, remember: true});
});
