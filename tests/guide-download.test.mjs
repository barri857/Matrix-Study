import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createGuidePdf } from '../lib/guide-download.ts';

test('guide PDF retains Kazakh, Russian and maths glyphs through table pagination', async (t) => {
  t.mock.method(globalThis, 'fetch', async (path) => {
    assert.match(path, /^\/guide-fonts\/DejaVuSans(?:-Bold)?\.ttf$/);
    return new Response(await readFile(new URL(`../public${path}`, import.meta.url)));
  });
  const words = 'Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі Русский π √ ∑ ∞ ≠';
  const guide = `## ${words}\n\n| Величина | Мән |\n| --- | ---: |\n${Array.from({ length: 55 }, (_, index) => `| Step ${index + 1}: ${words} | ${index + 1} |`).join('\n')}`;
  const blob = await createGuidePdf({ title: 'Study guide', guide });
  assert.equal(blob.type, 'application/pdf');
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: false, disableFontFace: true });
  try {
    const pdf = await task.promise;
    assert.ok(pdf.numPages >= 2);
    const first = await (await pdf.getPage(1)).getTextContent();
    const last = await (await pdf.getPage(pdf.numPages)).getTextContent();
    const text = content => content.items.filter(item => 'str' in item).map(item => item.str).join('');
    assert.ok(text(first).includes(words), 'title text is searchable in all three languages');
    assert.match(text(last), /Величина.*Мән.*Step 55/, 'last page repeats the header and includes the last row');
  } finally {
    await task.destroy();
  }
});
