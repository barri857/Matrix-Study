import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retainIndependentAssets } from '../scripts/retain-independent-assets.mjs';

const name = 'lib-BJBn5UOf.js';
const previous = JSON.stringify({ version: 1, releases: [[name], ['index-previous.js'], ['index-archived.js']] });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'matrix-retained-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'assets', 'index-newbuild.js'), 'export const newReader = true;');
  return directory;
}

test('a clean deploy retains the previous three published asset sets under the original URLs', async t => {
  const directory = await fixture(t);
  const requested = [];
  const fetcher = async url => {
    assert.equal(url.origin, 'https://matrix.example');
    requested.push(url.pathname);
    if (url.pathname === '/asset-releases.json') return new Response(previous, { headers: { 'Content-Type': 'application/json' } });
    return new Response('export const docxReader = true;', { headers: { 'Content-Type': 'text/javascript' } });
  };
  const options = { directory, origin: 'https://matrix.example', fetcher };
  assert.deepEqual(await retainIndependentAssets(options), { retainedFiles: 3, builds: 4 });
  assert.deepEqual(requested, ['/asset-releases.json', '/assets/lib-BJBn5UOf.js', '/assets/index-previous.js', '/assets/index-archived.js']);
  assert.match(await readFile(join(directory, 'assets', name), 'utf8'), /docxReader/);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'asset-releases.json'), 'utf8')).releases,
    [['index-newbuild.js'], [name], ['index-previous.js'], ['index-archived.js']]);
  assert.deepEqual(await retainIndependentAssets(options), { retainedFiles: 3, builds: 4 });
});

test('a previous JavaScript URL returning SPA HTML cannot be published as an asset', async t => {
  const directory = await fixture(t);
  const fetcher = async url => url.pathname === '/asset-releases.json'
    ? new Response(previous, { headers: { 'Content-Type': 'application/json' } })
    : new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(retainIndependentAssets({ directory, origin: 'https://matrix.example', fetcher }),
    /lib-BJBn5UOf.js could not be retrieved as JavaScript/);
});
