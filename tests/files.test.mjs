import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';

globalThis.DOMParser = DOMParser;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, '.wrangler'), { recursive: true });
const temporary = await mkdtemp(join(root, '.wrangler', 'file-test-'));
const modulePath = join(temporary, 'files.mjs');
await build({ entryPoints: [join(root, 'lib/files.ts')], outfile: modulePath, bundle: true, format: 'esm', platform: 'node', target: 'node24', external: ['jszip', 'pdfjs-dist', 'mammoth'] });
const { readStudyFile, readStudyFiles, MAX_STUDY_CHARACTERS, MAX_STUDY_FILE_BYTES } = await import(pathToFileURL(modulePath));
after(async () => { await unlink(modulePath); await rmdir(temporary); });

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
async function pptx({ external = false, declaration = '', blank = false, large = false } = {}) {
  const zip = new JSZip();
  zip.file('ppt/presentation.xml', `${declaration}<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="300" r:id="second"/><p:sldId id="256" r:id="first"/></p:sldIdLst></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="first" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="${R}/slide" Target="${external ? 'https://example.com/slide.xml' : 'slides/slide2.xml'}"${external ? ' TargetMode="External"' : ''}/></Relationships>`);
  const slide = text => `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody>${text}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', slide(blank ? '' : '<a:p><a:r><a:t>Later slide</a:t></a:r></a:p>'));
  zip.file('ppt/slides/slide2.xml', slide(large ? ' '.repeat(4 * 1024 * 1024 + 1) : blank ? '' : '<a:p><a:r><a:t>A &amp; B</a:t></a:r><a:br/><a:r><a:t>First slide</a:t></a:r></a:p>'));
  zip.file('ppt/vbaProject.bin', 'MUST NEVER RUN OR APPEAR');
  zip.file('ppt/notesSlides/notesSlide1.xml', '<notes>MUST NOT APPEAR</notes>');
  return new File([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })], 'Lecture.pptx');
}

test('multi-file batches preserve existing notes, order, filenames, and partial successes', async () => {
  const progress = [];
  const result = await readStudyFiles([new File(['One'], 'one.txt'), new File(['unsupported'], 'old.ppt'), new File(['Two'], 'two.md')], 'Original notes', p => progress.push(p.index));
  assert.equal(result.text, 'Original notes\n\n[Source: one.txt]\nOne\n\n[Source: two.md]\nTwo');
  assert.equal(result.title, 'one');
  assert.deepEqual(result.results.map(x => x.status), ['added', 'error', 'added']);
  assert.match(result.results[1].message, /Save As.*\.pptx/);
  assert.deepEqual(progress, [0, 1, 2]);
});
test('batch and file byte limits reject before extraction', async () => {
  let reads = 0;
  await assert.rejects(readStudyFiles(Array.from({ length: 21 }, () => new File(['a'], 'a.txt')), '', undefined, async () => { reads++; return 'text'; }), /20 files/);
  const result = await readStudyFiles([{ name: 'huge.txt', size: MAX_STUDY_FILE_BYTES + 1 }], '', undefined, async () => { reads++; return 'text'; });
  assert.equal(reads, 0);
  assert.equal(result.text, '');
  assert.match(result.results[0].message, /12 MB/);
});
test('combined character limit includes source labels, keeps notes, and still allows a smaller later file', async () => {
  const original = 'x'.repeat(MAX_STUDY_CHARACTERS - 65);
  const result = await readStudyFiles([new File(['y'.repeat(100)], 'big.txt'), new File(['small'], 'small.txt')], original);
  assert.equal(result.results[0].status, 'error');
  assert.match(result.results[0].message, /combined 120,000/);
  assert.equal(result.results[1].status, 'added');
  assert.ok(result.text.startsWith(original));
  assert.ok(result.text.length <= MAX_STUDY_CHARACTERS);
});
test('empty or overlong text files produce errors instead of silent truncation', async () => {
  await assert.rejects(readStudyFile(new File(['   '], 'blank.txt')), /No readable text/);
  await assert.rejects(readStudyFile(new File(['x'.repeat(MAX_STUDY_CHARACTERS + 1)], 'long.txt')), /too long/);
});
test('PPTX follows presentation order, decodes XML entities, and only extracts slide text', async () => {
  const text = await readStudyFile(await pptx());
  assert.equal(text, '[Slide 1]\nA & B\nFirst slide\n\n[Slide 2]\nLater slide');
  assert.doesNotMatch(text, /MUST/);
});
test('PPTX rejects external slides and XML entity declarations', async () => {
  await assert.rejects(readStudyFile(await pptx({ external: true })), /external slide/);
  await assert.rejects(readStudyFile(await pptx({ declaration: '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///private">]>' })), /unsupported XML declarations/);
});
test('PPTX reports image-only decks and bounds decompressed XML size', async () => {
  await assert.rejects(readStudyFile(await pptx({ blank: true })), /no selectable text/);
  await assert.rejects(readStudyFile(await pptx({ large: true })), /too much slide data/);
});
