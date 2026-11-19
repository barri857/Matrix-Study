import type JSZip from 'jszip';
import type { PptxFiles } from '@aiden0z/pptx-renderer';
import type { EChartsType, EChartsOption } from 'echarts';
import { parsePowerPointXml, powerPointFeatureWarnings, powerPointSourceText, resolvePowerPointPart } from './powerpoint-content';

export interface PowerPointVisualPage {
  data: string;
  mimeType: 'image/jpeg';
  label: string;
  text: string;
  width: number;
  height: number;
  warnings?: string[];
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ZIP_LIMITS = {
  maxEntries: 4000,
  maxEntryUncompressedBytes: 16 * 1024 * 1024,
  maxTotalUncompressedBytes: 96 * 1024 * 1024,
  maxMediaBytes: 72 * 1024 * 1024,
  maxConcurrency: 2,
};
type StreamEntry = JSZip.JSZipObject & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> };

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Upload cancelled.', 'AbortError');
}

function bounded<T>(promise: Promise<T>, signal?: AbortSignal, timeout = 45000): Promise<T> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const fail = () => { cleanup(); reject(new DOMException('Upload cancelled.', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('This PowerPoint slide took too long to render. Export the presentation to PDF and upload that file.')); }, timeout);
    function cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', fail); }
    signal?.addEventListener('abort', fail, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function readNotes(entry: JSZip.JSZipObject | null, budget: {bytes: number}, signal?: AbortSignal): Promise<string> {
  if (!entry || entry.dir) throw new Error('A PowerPoint speaker-notes part is missing. Save a new PPTX copy and try again.');
  return new Promise((resolve, reject) => {
    const stream = (entry as StreamEntry).internalStream('uint8array');
    const chunks: Uint8Array[] = [];
    let length = 0, finished = false;
    function stop(error: Error) {
      if (finished) return;
      finished = true; stream.pause(); chunks.length = 0;
      signal?.removeEventListener('abort', cancel); reject(error);
    }
    const cancel = () => stop(new DOMException('Upload cancelled.', 'AbortError'));
    signal?.addEventListener('abort', cancel, {once: true});
    stream.on('data', chunk => {
      if (finished) return;
      length += chunk.length; budget.bytes += chunk.length;
      if (length > 4 * 1024 * 1024 || budget.bytes > 20 * 1024 * 1024) { stop(new Error('This PowerPoint contains too much speaker-notes data. Split it into smaller files.')); return; }
      chunks.push(chunk);
    });
    stream.on('error', () => stop(new Error('PowerPoint speaker notes could not be read. Save a new PPTX copy and try again.')));
    stream.on('end', () => {
      if (finished) return;
      finished = true; signal?.removeEventListener('abort', cancel);
      const data = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      resolve(new TextDecoder().decode(data));
    });
    if (signal?.aborted) cancel(); else stream.resume();
  });
}

function validatePackageXml(files: PptxFiles) {
  const pieces: string[] = [files.presentation, files.presentationRels, files.contentTypes];
  for (const value of Object.values(files)) {
    if (value instanceof Map) for (const xml of value.values()) if (typeof xml === 'string') pieces.push(xml);
  }
  if (files.tableStyles) pieces.push(files.tableStyles);
  for (const xml of pieces) {
    if (xml.length > 4 * 1024 * 1024) throw new Error('A PowerPoint part is too large to read safely. Split the presentation into smaller files.');
    parsePowerPointXml(xml);
  }
}

export async function preparePowerPointImage(image: HTMLImageElement): Promise<string | undefined> {
  let source = image.getAttribute('src');
  while (source) {
    if (!/^(blob:|data:)/i.test(source)) {
      image.removeAttribute('src');
      return 'An external image was blocked.';
    }
    try {
      await image.decode();
    } catch {
      if (source === image.getAttribute('src')) {
        return 'An image on this slide could not be decoded. Export to PDF to preserve it.';
      }
    }
    // The renderer can replace an image with its color-adjusted version on load.
    // Decode may reject when that happens, so wait for the replacement as well.
    const current = image.getAttribute('src');
    if (current === source) return;
    source = current;
  }
}

function encodeJpeg(canvas: HTMLCanvasElement): {data: string; width: number; height: number} {
  let current = canvas;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const quality of [0.88, 0.77, 0.65]) {
      const data = current.toDataURL('image/jpeg', quality).split(',')[1];
      if (data && Math.ceil(data.length * 3 / 4) <= MAX_IMAGE_BYTES) {
        const result = {data, width: current.width, height: current.height};
        if (current !== canvas) { current.width = 1; current.height = 1; }
        return result;
      }
    }
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(current.width * 0.78));
    smaller.height = Math.max(1, Math.round(current.height * 0.78));
    const context = smaller.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this slide image.');
    context.drawImage(current, 0, 0, smaller.width, smaller.height);
    if (current !== canvas) { current.width = 1; current.height = 1; }
    current = smaller;
  }
  if (current !== canvas) { current.width = 1; current.height = 1; }
  throw new Error('This slide is too detailed to fit the image limit. Export the presentation to PDF and try again.');
}

/** Render actual PowerPoint slide geometry and media, one slide at a time. */
export async function* renderPowerPointVisuals(file: File, options: {signal?: AbortSignal} = {}): AsyncGenerator<PowerPointVisualPage> {
  const {signal} = options;
  aborted(signal);
  if (file.size > 12 * 1024 * 1024) throw new Error('PowerPoint uploads can be up to 12 MB each.');
  const [{parseZipLazyMedia, buildPresentation, renderSlide}, {toCanvas}, {default: JSZip}] = await Promise.all([
    import('@aiden0z/pptx-renderer'), import('html-to-image'), import('jszip'),
  ]);
  const bytes = await bounded(file.arrayBuffer(), signal);
  let files: PptxFiles;
  try { files = await bounded(parseZipLazyMedia(bytes, ZIP_LIMITS), signal); }
  catch (error) {
    if (signal?.aborted) aborted(signal);
    throw new Error(`This PowerPoint could not be opened within the upload limits. Use an unencrypted PPTX or export it to PDF. ${error instanceof Error && /limit|size|entries/i.test(error.message) ? 'The presentation contains too much expanded data.' : ''}`.trim());
  }
  validatePackageXml(files);
  const presentation = buildPresentation(files, {lazySlides: true});
  if (!presentation.slides.length) throw new Error('This PowerPoint has no readable slides.');
  const declaredSlides = parsePowerPointXml(files.presentation).getElementsByTagNameNS('*', 'sldId').length;
  if (declaredSlides !== presentation.slides.length) throw new Error('Some slides are missing from this PowerPoint. Save a new PPTX copy or export it to PDF.');
  if (presentation.slides.length > 200) throw new Error('Visual PowerPoint reading supports up to 200 slides per file. Split this presentation into smaller files.');
  if (![presentation.width, presentation.height].every(value => Number.isFinite(value) && value >= 40 && value <= 8192)) throw new Error('This PowerPoint has unsupported slide dimensions. Export it to a standard-size PDF.');
  const zip = await bounded(JSZip.loadAsync(bytes), signal);
  const notesBudget = {bytes: 0};
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.inert = true;
  Object.assign(host.style, {position: 'fixed', left: '-20000px', top: '0', width: `${presentation.width}px`, height: `${presentation.height}px`, pointerEvents: 'none', overflow: 'hidden', background: '#fff', colorScheme: 'light', zIndex: '-1'});
  document.body.appendChild(host);
  try {
    for (let index = 0; index < presentation.slides.length; index++) {
      aborted(signal);
      const slide = presentation.slides[index];
      const sourceXml = files.slides.get(slide.slidePath) || slide.sourceXml || '';
      if (!sourceXml) throw new Error(`Slide ${index + 1} has no readable slide information.`);
      const relPath = slide.slidePath.replace(/\/([^/]+)$/, '/_rels/$1.rels');
      const relXml = files.slideRels.get(relPath) || '';
      const warnings = powerPointFeatureWarnings(sourceXml, relXml);
      if (index === 0) warnings.unshift('PowerPoint slides are rendered in your browser. Fonts and some advanced layouts may differ; export to PDF when exact appearance matters.');
      const layoutPath = presentation.slideToLayout.get(index);
      const masterPath = layoutPath && presentation.layoutToMaster.get(layoutPath);
      for (const [partPath, partXml, partRels] of [
        [layoutPath, layoutPath && files.slideLayouts.get(layoutPath), layoutPath && presentation.layouts.get(layoutPath)?.rels],
        [masterPath, masterPath && files.slideMasters.get(masterPath), masterPath && presentation.masters.get(masterPath)?.rels],
      ] as const) {
        if (!partPath || !partXml) continue;
        const relatedPath = partPath.replace(/\/([^/]+)$/, '/_rels/$1.rels');
        const relatedXml = files.slideLayoutRels.get(relatedPath) || files.slideMasterRels.get(relatedPath) || '';
        warnings.push(...powerPointFeatureWarnings(partXml, relatedXml));
        if (partRels && [...partRels.values()].some(relation => /\.(emf|wmf)$/i.test(relation.target))) warnings.push('A legacy vector image in the slide layout may use a saved preview. Export to PDF if this slide loses diagram detail.');
      }
      let notesXml: string | undefined;
      const chartXml: string[] = [], diagramXml: string[] = [];
      for (const relationship of slide.rels.values()) {
        if (relationship.targetMode?.toLowerCase() === 'external') continue;
        const path = resolvePowerPointPart(slide.slidePath, relationship.target);
        if (relationship.type.endsWith('/notesSlide')) notesXml = await readNotes(zip.file(path), notesBudget, signal);
        if (relationship.type.endsWith('/chart') && files.charts.has(path)) chartXml.push(files.charts.get(path)!);
        if (/diagramDrawing$/i.test(relationship.type) && files.diagramDrawings.has(path)) diagramXml.push(files.diagramDrawings.get(path)!);
        if (/\.(emf|wmf)$/i.test(path)) warnings.push('A legacy vector image may use a saved bitmap preview. Export to PDF if this slide loses diagram detail.');
      }
      const text = powerPointSourceText(sourceXml, notesXml, chartXml, diagramXml);
      const charts = new Set<EChartsType>();
      const handle = renderSlide(presentation, slide, {
        externalMedia: 'block',
        chartInstances: charts,
        // This build deliberately does not fetch a CDN PDF.js runtime for legacy EMF fallbacks.
        pdfjs: false,
        onNodeError: () => warnings.push('An object on this slide could not be rendered. Export to PDF to include its visible appearance.'),
        onNavigate: () => {},
      });
      let canvas: HTMLCanvasElement | undefined;
      let result: PowerPointVisualPage | undefined;
      try {
        host.replaceChildren(handle.element);
        await bounded(handle.ready, signal);
        // The slide renderer starts ECharts with entrance animations enabled.
        // Its ready promise signals initialization, not animation completion;
        // capturing then produces axes with zero-height bars. Re-render the
        // complete chart without animation/progressive drawing before capture.
        for (const chart of charts) {
          if (chart.isDisposed()) continue;
          const option = chart.getOption() as EChartsOption;
          option.animation = false;
          const series = option.series;
          for (const entry of Array.isArray(series) ? series : series ? [series] : []) {
            Object.assign(entry, {animation: false, animationDuration: 0, animationDurationUpdate: 0, progressive: 0});
          }
          chart.setOption(option, {notMerge: true, lazyUpdate: false, silent: true});
          chart.resize({silent: true, animation: {duration: 0}});
          chart.getZr().flush();
        }
        const imageWarnings = await bounded(Promise.all(
          Array.from(handle.element.querySelectorAll('img'), preparePowerPointImage),
        ), signal);
        for (const warning of imageWarnings) if (warning) warnings.push(warning);
        // No document-supplied hyperlink should survive into the capture DOM.
        for (const link of handle.element.querySelectorAll('a')) link.removeAttribute('href');
        // EOT fonts are loaded as FontFace objects, which foreignObject captures cannot embed.
        // Use their original family names so the browser can select an installed equivalent.
        if (presentation.embeddedFontFamilies?.size) for (const element of handle.element.querySelectorAll<HTMLElement>('*')) {
          for (const [family, renderFamily] of presentation.embeddedFontFamilies) {
            if (element.style.fontFamily.includes(renderFamily)) element.style.fontFamily = element.style.fontFamily.replaceAll(renderFamily, family);
          }
        }
        const scale = Math.min(2200 / Math.max(presentation.width, presentation.height), 3);
        canvas = await bounded(toCanvas(handle.element, {
          pixelRatio: 1, backgroundColor: '#ffffff',
          width: presentation.width, height: presentation.height,
          canvasWidth: Math.max(1, Math.round(presentation.width * scale)),
          canvasHeight: Math.max(1, Math.round(presentation.height * scale)),
          // Never let capture inspect/download unrelated page stylesheet fonts.
          skipFonts: true,
          filter: node => !['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'AUDIO', 'VIDEO'].includes(node.nodeName),
        }), signal);
        aborted(signal);
        const image = encodeJpeg(canvas);
        result = { ...image, mimeType: 'image/jpeg', label: `${file.name} — slide ${index + 1}${slide.hidden ? ' (hidden slide)' : ''}`, text, warnings: [...new Set(warnings)] };
      } finally {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        handle.dispose(); host.replaceChildren();
      }
      yield result;
    }
  } finally {
    host.remove();
  }
}
