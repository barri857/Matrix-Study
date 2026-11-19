import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, '.wrangler'), { recursive: true });
const temporary = await mkdtemp(join(root, '.wrangler', 'visual-test-'));
const output = join(temporary, 'visual.mjs');
await build({ entryPoints: [join(root, 'lib/visual-documents.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', target: 'node24', plugins: [{
  name: 'local-pdf-fixture', setup(build) {
    build.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: 'pdf-fixture', namespace: 'fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const GlobalWorkerOptions={}; export const AnnotationMode={ENABLE:1}; export function getDocument(options){ return globalThis.pdfFixture(options); }', loader: 'js' }));
  },
}] });
const { renderVisualDocument, visualDimensions, MAX_VISUAL_FILE_BYTES, MAX_VISUAL_IMAGE_BYTES } = await import(pathToFileURL(output));
after(async () => { await unlink(output); await rmdir(temporary); });

let canvases = [], operations = [], closedImages = 0;
globalThis.document = { createElement(name) {
  assert.equal(name, 'canvas');
  const surface = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {}, fillStyle: '' }), toBlob(done, type, quality) {
    operations.push({ type, quality });
    done(new Blob([new Uint8Array(surface.oversize ? MAX_VISUAL_IMAGE_BYTES + 1 : 42)], { type }));
  } };
  canvases.push(surface); return surface;
} };
const imageFile = () => new File([new Uint8Array([137, 80, 78, 71])], 'diagram.png');
function reset() { canvases = []; operations = []; closedImages = 0; }

test('visual dimensions bound extreme aspect ratios and reject invalid pages', () => {
  assert.deepEqual(visualDimensions(8000, 6000), { width: 2000, height: 1500 });
  assert.deepEqual(visualDimensions(3, 80000), { width: 1, height: 2000 });
  assert.throws(() => visualDimensions(0, 20), /dimensions/);
  assert.throws(() => visualDimensions(Infinity, 20), /dimensions/);
});

test('images honor EXIF orientation, normalize to bounded bytes, and release bitmap/canvas before yielding', async () => {
  reset();
  globalThis.createImageBitmap = async (_file, options) => {
    assert.equal(options.imageOrientation, 'from-image');
    return { width: 6000, height: 4000, close() { closedImages++; } };
  };
  const result = await renderVisualDocument(imageFile()).next();
  assert.equal(result.value.mimeType, 'image/png');
  assert.equal(result.value.width, 2000);
  assert.equal(result.value.height, 1333);
  assert.equal(result.value.text, '');
  assert.ok(Buffer.from(result.value.data, 'base64').length <= MAX_VISUAL_IMAGE_BYTES);
  assert.equal(closedImages, 1);
  assert.equal(canvases[0].width, 0);
  assert.equal(canvases[0].height, 0);
});

test('GIF imports identify first-frame-only coverage', async () => {
  reset();
  globalThis.createImageBitmap = async () => ({ width: 200, height: 100, close() {} });
  const { value } = await renderVisualDocument(new File(['GIF89a'], 'lesson.gif')).next();
  assert.match(value.label, /first frame/);
  assert.match(value.warnings[0], /first GIF frame/);
});

test('empty/oversized/unsupported input and cancellation reject before decoding', async () => {
  let reads = 0;
  globalThis.createImageBitmap = async () => { reads++; throw new Error('must not decode'); };
  await assert.rejects(renderVisualDocument(new File([], 'empty.png')).next(), /empty/);
  await assert.rejects(renderVisualDocument({ name: 'large.png', size: MAX_VISUAL_FILE_BYTES + 1 }).next(), /12 MB/);
  await assert.rejects(renderVisualDocument(new File(['text'], 'program.exe')).next(), /Visual reading supports/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderVisualDocument(imageFile(), { signal: controller.signal }).next(), error => error.name === 'AbortError');
  assert.equal(reads, 0);
});

function installPdf({ count = 3, blockRender = false } = {}) {
  let destroyed = 0, cleaned = 0, cancelled = 0, renderReject;
  const pages = [];
  globalThis.pdfFixture = options => {
    assert.equal(options.cMapUrl, '/pdf-support/cmaps/');
    assert.equal(options.wasmUrl, '/pdf-support/wasm/');
    assert.equal(options.stopAtErrors, true);
    return { promise: Promise.resolve({ numPages: count, async getPage(index) {
      pages.push(index);
      return {
        getViewport({ scale }) { return { width: 600 * scale, height: 400 * scale }; },
        render() { return { promise: blockRender ? new Promise((_, reject) => { renderReject = reject; }) : Promise.resolve(), cancel() { cancelled++; renderReject?.(new Error('cancelled')); } }; },
        async getTextContent() { return { items: index === 2 ? [] : [{ str: `Page ${index}`, hasEOL: true }] }; },
        cleanup() { cleaned++; },
      };
    } }), async destroy() { destroyed++; } };
  };
  return { get destroyed() { return destroyed; }, get cleaned() { return cleaned; }, get cancelled() { return cancelled; }, pages };
}

test('PDF rendering yields every page, accepts scanned pages, and frees page surfaces before the next page', async () => {
  reset();
  const stats = installPdf();
  const reader = renderVisualDocument(new File(['%PDF-1.7'], 'lecture.pdf'));
  const first = await reader.next();
  assert.match(first.value.label, /page 1 of 3/);
  assert.equal(first.value.text, 'Page 1');
  assert.deepEqual(stats.pages, [1]);
  assert.equal(canvases[0].width, 0);
  const second = await reader.next();
  assert.equal(second.value.text, '');
  assert.ok(second.value.data.length > 0);
  const third = await reader.next();
  assert.match(third.value.label, /page 3 of 3/);
  assert.equal((await reader.next()).done, true);
  assert.equal(stats.cleaned, 3);
  assert.equal(stats.destroyed, 1);
});

test('PDF page limits reject before partial import; closing the iterator releases the PDF', async () => {
  reset();
  let stats = installPdf({ count: 201 });
  await assert.rejects(renderVisualDocument(new File(['%PDF'], 'huge.pdf')).next(), /longer than 200/);
  assert.deepEqual(stats.pages, []);
  assert.equal(stats.destroyed, 1);
  stats = installPdf({ count: 4 });
  const reader = renderVisualDocument(new File(['%PDF'], 'normal.pdf'));
  await reader.next(); await reader.return();
  assert.deepEqual(stats.pages, [1]);
  assert.equal(stats.destroyed, 1);
});

test('cancelling a PDF render interrupts it and releases all local resources', async () => {
  reset();
  const stats = installPdf({ blockRender: true });
  const controller = new AbortController();
  const reader = renderVisualDocument(new File(['%PDF'], 'cancel.pdf'), { signal: controller.signal });
  const pending = reader.next();
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.ok(stats.cancelled >= 1);
  assert.equal(stats.destroyed, 1);
  assert.equal(stats.cleaned, 1);
  assert.equal(canvases[0].width, 0);
});
