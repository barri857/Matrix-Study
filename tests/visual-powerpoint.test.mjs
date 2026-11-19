import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, unlink, rmdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {DOMParser, XMLSerializer} from '@xmldom/xmldom';
import {parseZipLazyMedia, buildPresentation, materializeSlideNodes} from '@aiden0z/pptx-renderer';
import {visualPowerPointFixture, fixtureSlideXml, fixtureChartXml, fixtureNotesXml} from './helpers/visual-powerpoint-fixture.mjs';

// OOXML parser uses browser children/querySelector; rendering itself is verified in a real browser.
globalThis.DOMParser = class extends DOMParser {
  parseFromString(...args) {
    const document = super.parseFromString(...args);
    document.querySelector = selector => document.getElementsByTagName(selector)[0] || null;
    for (const element of Array.from(document.getElementsByTagName('*'))) Object.defineProperty(element, 'children', {get: () => Array.from(element.childNodes).filter(node => node.nodeType === 1)});
    return document;
  }
};
globalThis.XMLSerializer = XMLSerializer;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
await mkdir(join(root, '.wrangler'), {recursive: true});
const temporary = await mkdtemp(join(root, '.wrangler', 'pptx-visual-test-'));
const output = join(temporary, 'content.mjs');
await build({entryPoints: [join(root, 'lib/powerpoint-content.ts')], outfile: output, bundle: true, format: 'esm', platform: 'node', target: 'node24'});
const {powerPointSourceText, powerPointFeatureWarnings, resolvePowerPointPart, parsePowerPointXml} = await import(pathToFileURL(output));
after(async () => {await unlink(output); await rmdir(temporary);});

test('PPTX visual model preserves embedded image, chart and shape/connector diagram in slide order', async () => {
  const bytes = await visualPowerPointFixture();
  const files = await parseZipLazyMedia(bytes.buffer);
  const presentation = buildPresentation(files, {lazySlides: true});
  assert.equal(presentation.slides.length, 2);
  assert.equal(presentation.slides[0].slidePath, 'ppt/slides/slide1.xml');
  materializeSlideNodes(presentation, presentation.slides[0]);
  const types = presentation.slides[0].nodes.map(node => node.nodeType);
  assert.ok(types.includes('picture'));
  assert.ok(types.includes('chart'));
  assert.ok(presentation.slides[0].nodes.some(node => node.name === 'Input to output connector' || node.id === '5'));
  assert.ok(types.filter(type => type === 'shape').length >= 3);
  assert.equal(presentation.slides[0].nodes.find(node => node.nodeType === 'chart').chartPath, 'ppt/charts/chart1.xml');
  materializeSlideNodes(presentation, presentation.slides[1]);
  assert.equal(presentation.slides[1].nodes.length, 1);
  assert.equal(presentation.slides[1].nodes[0].nodeType, 'picture');
  const media = await presentation.mediaResolver.resolve('ppt/media/diagram.png');
  assert.deepEqual(Array.from(media.data.slice(0, 4)), [137, 80, 78, 71]);
  const fixtures = resolve(root, '../visual-fixtures');
  await mkdir(fixtures, {recursive: true});
  await writeFile(join(fixtures, 'Visual lecture - chart image diagram notes.pptx'), bytes);
});

test('source supplement includes chart values and real speaker notes, excluding slide-number boilerplate', () => {
  const text = powerPointSourceText(fixtureSlideXml, fixtureNotesXml, [fixtureChartXml]);
  assert.match(text, /INPUT/);
  assert.match(text, /Day 1 \| Day 2 \| Day 3 \| 42 \| 67 \| 91/);
  assert.match(text, /Speaker notes:\nSpeaker-note fact/);
  assert.doesNotMatch(text, /999/);
});

test('unsafe XML/part targets are rejected and unsupported visual features are reported', () => {
  assert.throws(() => parsePowerPointXml('<!DOCTYPE x [<!ENTITY e "hello">]><x>&e;</x>'), /unsupported XML/);
  assert.throws(() => resolvePowerPointPart('ppt/slides/slide1.xml', 'https://evil.invalid/picture.png'), /unsupported/);
  assert.throws(() => resolvePowerPointPart('ppt/slides/slide1.xml', '../../../outside.xml'), /outside/);
  assert.equal(resolvePowerPointPart('ppt/slides/slide1.xml', '../notesSlides/notesSlide1.xml'), 'ppt/notesSlides/notesSlide1.xml');
  const warnings = powerPointFeatureWarnings('<p:sld xmlns:p="urn:p"><p:timing/><p:oleObj/><p:relIds/><p:videoFile/></p:sld>', '<Relationships><Relationship TargetMode="External" Type="urn:relationships/image"/></Relationships>');
  assert.equal(warnings.length, 5);
  assert.ok(warnings.some(value => /SmartArt/.test(value)));
  assert.ok(warnings.some(value => /Linked external/.test(value)));
});
