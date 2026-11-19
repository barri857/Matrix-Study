const DRAWING_NAMESPACES = new Set([
  'http://schemas.openxmlformats.org/drawingml/2006/main',
  'http://purl.oclc.org/ooxml/drawingml/main',
]);

export function parsePowerPointXml(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('This PowerPoint contains unsupported XML declarations. Save a new PPTX copy and try again.');
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (!document.documentElement || document.getElementsByTagName('parsererror').length) throw new Error('This PowerPoint contains invalid slide information. Save a new PPTX copy and try again.');
  return document;
}

function paragraphs(xml: string): string {
  const document = parsePowerPointXml(xml);
  return Array.from(document.getElementsByTagNameNS('*', 'p'))
    .filter(element => DRAWING_NAMESPACES.has(element.namespaceURI || ''))
    .map(paragraph => {
      let result = '';
      function visit(node: Node) {
        if (node.nodeType === 1) {
          const element = node as Element;
          if (element.localName === 't') { result += element.textContent || ''; return; }
          if (element.localName === 'br') { result += '\n'; return; }
          if (element.localName === 'tab') { result += '\t'; return; }
        }
        for (const child of Array.from(node.childNodes)) visit(child);
      }
      visit(paragraph);
      return result.trim();
    }).filter(Boolean).join('\n');
}

/** Source text supplements the actual slide image; it is never used as a fake slide preview. */
export function powerPointSourceText(slideXml: string, notesXml?: string, charts: string[] = [], diagrams: string[] = []): string {
  const sections = [paragraphs(slideXml)];
  for (const diagram of diagrams) {
    const text = paragraphs(diagram);
    if (text) sections.push(`Diagram labels:\n${text}`);
  }
  for (const chart of charts) {
    const document = parsePowerPointXml(chart);
    const values = Array.from(document.getElementsByTagNameNS('*', 'v')).map(element => element.textContent?.trim()).filter(Boolean);
    if (values.length) sections.push(`Chart source labels and cached values (interpret their relationships from the slide image):\n${values.join(' | ')}`);
  }
  if (notesXml) {
    // Slide number placeholders repeat boilerplate and are not speaker notes.
    const document = parsePowerPointXml(notesXml);
    for (const shape of Array.from(document.getElementsByTagNameNS('*', 'sp'))) {
      const type = shape.getElementsByTagNameNS('*', 'ph')[0]?.getAttribute('type');
      if (type && ['sldNum', 'dt', 'hdr', 'ftr', 'sldImg'].includes(type)) shape.parentNode?.removeChild(shape);
    }
    const text = paragraphs(new XMLSerializer().serializeToString(document));
    if (text) sections.push(`Speaker notes:\n${text}`);
  }
  const result = sections.filter(Boolean).join('\n\n');
  if (result.length > 120000) throw new Error('A slide contains too much text and chart data. Split this presentation into smaller files.');
  return result;
}

export function powerPointFeatureWarnings(xml: string, relationshipXml = ''): string[] {
  const document = parsePowerPointXml(xml);
  const names = new Set(Array.from(document.getElementsByTagName('*')).map(element => element.localName));
  const warnings: string[] = [];
  if (names.has('oleObj') || names.has('control') || names.has('contentPart')) warnings.push('Embedded documents, controls or unsupported objects may show only a preview. Export to PDF to include their visible appearance reliably.');
  if (names.has('audioFile') || names.has('videoFile') || names.has('media') || names.has('wavAudioFile')) warnings.push('Audio and video are not transcribed; only their visible poster or slide image is read.');
  if (names.has('timing') || names.has('transition')) warnings.push('Animations and transitions are read as a static slide, without playback.');
  if (names.has('relIds')) warnings.push('SmartArt uses the diagram preview saved in the PowerPoint file. Export to PDF if that preview is missing or incomplete.');
  if (names.has('sp3d') || names.has('scene3d') || names.has('model3d')) warnings.push('Some 3D effects and models may differ from PowerPoint. Export to PDF for a faithful static view.');
  for (const graphic of Array.from(document.getElementsByTagNameNS('*', 'graphicData'))) {
    const uri = graphic.getAttribute('uri') || '';
    if (!/\/(chart|table|diagram)$/.test(uri)) warnings.push('A drawing uses an unsupported format and may be absent. Export to PDF to include its visible appearance.');
  }
  if (relationshipXml) {
    const relationships = parsePowerPointXml(relationshipXml);
    const blocked = Array.from(relationships.getElementsByTagNameNS('*', 'Relationship')).some(element =>
      element.getAttribute('TargetMode')?.toLowerCase() === 'external' && !element.getAttribute('Type')?.endsWith('/hyperlink'));
    if (blocked) warnings.push('Linked external media is blocked. Embed it in PowerPoint or export to PDF to include it.');
  }
  return warnings;
}

export function resolvePowerPointPart(from: string, target: string): string {
  const url = new URL(target, `https://matrix-pptx.invalid/${from}`);
  if (url.origin !== 'https://matrix-pptx.invalid' || url.search || url.hash || target.includes('\\')) throw new Error('This PowerPoint references an unsupported document part.');
  const path = decodeURIComponent(url.pathname).slice(1);
  if (!path.startsWith('ppt/') || path.includes('\\')) throw new Error('This PowerPoint references a document part outside the presentation.');
  return path;
}
