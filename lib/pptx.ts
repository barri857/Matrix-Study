import type JSZip from 'jszip';

const PRESENTATION = new Set(['http://schemas.openxmlformats.org/presentationml/2006/main', 'http://purl.oclc.org/ooxml/presentationml/main']);
const DRAWING = new Set(['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main']);
const OFFICE_RELATIONSHIPS = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'http://purl.oclc.org/ooxml/officeDocument/relationships'];
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_XML_BYTES = 20 * 1024 * 1024;
type StreamEntry = JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> };

// Stop decompression before a compressed XML part can grow without a bound.
function readXmlEntry(entry: JSZip.JSZipObject | null, budget: { bytes: number }): Promise<string> {
  if (!entry || entry.dir) throw new Error('This PowerPoint file is missing a slide or presentation information. Save a new PPTX copy and try again.');
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let length = 0, settled = false;
    const stream = (entry as StreamEntry).internalStream('uint8array');
    stream.on('data', chunk => {
      if (settled) return;
      length += chunk.length;
      budget.bytes += chunk.length;
      if (length > MAX_XML_BYTES || budget.bytes > MAX_TOTAL_XML_BYTES) {
        settled = true; stream.pause(); chunks.length = 0;
        reject(new Error('This PowerPoint contains too much slide data. Split it into smaller presentations.')); return;
      }
      chunks.push(chunk);
    });
    stream.on('error', () => { if (!settled) { settled = true; reject(new Error('This PowerPoint file could not be opened. Save a new PPTX copy and try again.')); } });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(new TextDecoder().decode(bytes));
    });
    stream.resume();
  });
}

function parseXml(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('This PowerPoint contains unsupported XML declarations. Save a new PPTX copy and try again.');
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (!document.documentElement || document.getElementsByTagName('parsererror').length) throw new Error('This PowerPoint contains invalid slide information. Save a new PPTX copy and try again.');
  return document;
}

function slidePath(target: string): string {
  const url = new URL(target, 'https://matrix-package.invalid/ppt/presentation.xml');
  if (url.origin !== 'https://matrix-package.invalid' || url.search || url.hash) throw new Error('This PowerPoint references an unsupported external slide.');
  const path = decodeURIComponent(url.pathname).slice(1);
  if (!/^ppt\/slides\/[^/]+\.xml$/i.test(path) || path.includes('\\')) throw new Error('This PowerPoint contains an unsupported slide location.');
  return path;
}

function paragraphText(paragraph: Element): string {
  let text = '';
  function visit(node: Element) {
    if (DRAWING.has(node.namespaceURI || '')) {
      if (node.localName === 't') { text += node.textContent || ''; return; }
      if (node.localName === 'br') { text += '\n'; return; }
      if (node.localName === 'tab') { text += '\t'; return; }
    }
    for (const child of Array.from(node.childNodes)) if (child.nodeType === 1) visit(child as Element);
  }
  visit(paragraph);
  return text.trim();
}

export async function readPowerPoint(data: ArrayBuffer, maxCharacters = 120000): Promise<string> {
  const { default: JSZip } = await import('jszip');
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(data); }
  catch { throw new Error('This PowerPoint file could not be opened. Use an unencrypted .pptx file.'); }
  if (Object.keys(zip.files).length > 10000) throw new Error('This presentation contains too many parts. Split it into smaller PPTX files.');
  const budget = { bytes: 0 };
  const presentation = parseXml(await readXmlEntry(zip.file('ppt/presentation.xml'), budget));
  if (presentation.documentElement.localName !== 'presentation' || !PRESENTATION.has(presentation.documentElement.namespaceURI || '')) throw new Error('This file is not a supported PowerPoint presentation.');
  const relationships = parseXml(await readXmlEntry(zip.file('ppt/_rels/presentation.xml.rels'), budget));
  const targets = new Map<string, Element>();
  for (const relation of Array.from(relationships.getElementsByTagNameNS('*', 'Relationship'))) targets.set(relation.getAttribute('Id') || '', relation);
  const slideIds = Array.from(presentation.getElementsByTagNameNS('*', 'sldId')).filter(node => PRESENTATION.has(node.namespaceURI || ''));
  if (!slideIds.length) throw new Error('This PowerPoint has no slides.');
  if (slideIds.length > 200) throw new Error('Please split presentations longer than 200 slides.');
  const slides: string[] = [];
  let length = 0, visibleCharacters = 0;
  for (const [index, slide] of slideIds.entries()) {
    const id = OFFICE_RELATIONSHIPS.map(namespace => slide.getAttributeNS(namespace, 'id')).find(Boolean);
    const relation = id ? targets.get(id) : undefined;
    if (!relation || !/\/slide$/.test(relation.getAttribute('Type') || '') || relation.getAttribute('TargetMode') === 'External') throw new Error('This PowerPoint has an unavailable or external slide. Save a new PPTX copy and try again.');
    const document = parseXml(await readXmlEntry(zip.file(slidePath(relation.getAttribute('Target') || '')), budget));
    const lines = Array.from(document.getElementsByTagNameNS('*', 'p')).filter(node => DRAWING.has(node.namespaceURI || '')).map(paragraphText).filter(Boolean);
    const content = lines.join('\n');
    visibleCharacters += content.length;
    const section = `[Slide ${index + 1}]\n${content || '(No selectable text on this slide.)'}`;
    length += section.length + (slides.length ? 2 : 0);
    if (length > maxCharacters) throw new Error('This presentation is too long. Split it into smaller PPTX files.');
    slides.push(section);
  }
  if (!visibleCharacters) throw new Error('This PowerPoint has no selectable text. Export it with text or paste the slide notes; images are not read.');
  return slides.join('\n\n');
}
