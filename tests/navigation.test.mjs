import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, unlink, rmdir} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, '.wrangler'), {recursive: true});
const temporary = await mkdtemp(join(root, '.wrangler', 'navigation-test-'));
const output = join(temporary, 'navigation.mjs');
await build({entryPoints: [join(root, 'lib/navigation.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', target: 'node24'});
const {parseMatrixNavigation, matrixNavigationHash, matrixNavigationUrl, resolveNavigationSelection, DEFAULT_NAVIGATION, MATRIX_VIEWS} = await import(pathToFileURL(output));
after(async () => {await unlink(output); await rmdir(temporary);});

test('every Matrix page survives a URL round trip with kit and guide tab', () => {
  for (const view of MATRIX_VIEWS) {
    const route = {view, selected: 'cloud-kit_123', guideMode: 'summary'};
    assert.deepEqual(parseMatrixNavigation(matrixNavigationHash(route)), route);
  }
});
test('malformed routes, oversized IDs, duplicate parameters and unsafe path fragments are rejected', () => {
  for (const hash of ['', '#/admin', '#/guide/../../secret', '#/GUIDE', '#' + 'x'.repeat(601)]) assert.deepEqual(parseMatrixNavigation(hash), DEFAULT_NAVIGATION);
  for (const query of ['kit=%3Cscript%3E', 'kit=' + 'a'.repeat(101), 'kit=one&kit=two', 'kit=../secret', 'kit=%00']) assert.equal(parseMatrixNavigation('#/guide?' + query).selected, '');
  assert.equal(parseMatrixNavigation('#/guide?tab=summary&tab=guide').guideMode, 'guide');
  assert.equal(parseMatrixNavigation('#/guide?kit=valid-id&ignored=secret').selected, 'valid-id');
});
test('deep-linked cloud selection waits for loading then keeps the selected kit', () => {
  const route = parseMatrixNavigation('#/cards?kit=cloud-kit');
  assert.equal(resolveNavigationSelection(route, [{id: 'sample'}], false), route);
  assert.equal(resolveNavigationSelection(route, [{id: 'sample'}, {id: 'cloud-kit'}], true), route);
  assert.deepEqual(resolveNavigationSelection(route, [{id: 'different'}], true), {...route, selected: 'different'});
  assert.deepEqual(resolveNavigationSelection(route, [], true), {...route, selected: ''});
});
test('hash writes preserve share and authentication callback queries exactly', () => {
  const location = {pathname: '/', search: '?share=public-id&token=opaque%2Bvalue&code=abc&state=xyz'};
  const route = {view: 'guide', selected: 'kit', guideMode: 'guide'};
  assert.equal(matrixNavigationUrl(location, route), '/?share=public-id&token=opaque%2Bvalue&code=abc&state=xyz#/guide?kit=kit');
  assert.doesNotMatch(matrixNavigationHash(route), /token|opaque|code|share/);
});
