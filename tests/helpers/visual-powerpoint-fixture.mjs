import JSZip from 'jszip';
import { deflateSync } from 'node:zlib';

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const label = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([label, bytes])));
  return Buffer.concat([size, label, bytes, crc]);
}
function diagramPng() {
  const width = 320, height = 180, rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = x > 20 && x < 110 && y > 45 && y < 135;
    const right = x > 210 && x < 300 && y > 45 && y < 135;
    const arrow = x > 115 && x < 202 && Math.abs(y - 90) < (x > 175 ? (202 - x) : 5);
    const color = left ? [14, 165, 233] : right ? [249, 115, 22] : arrow ? [30, 41, 59] : [248, 250, 252];
    const start = y * (width * 3 + 1) + 1 + x * 3;
    rows.set(color, start);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const transform = (x, y, width, height) => `<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>`;
function shape(id, text, x, y, width, height, fill = 'F1F5F9', font = 2400) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${text}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${transform(x, y, width, height)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="${font}"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill><a:latin typeface="Arial"/></a:rPr><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
}
function slide(body) {
  return `<p:sld xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
const image = `<p:pic><p:nvPicPr><p:cNvPr id="8" name="Embedded process diagram" descr="Blue square points to orange square"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${transform(700000, 3600000, 3900000, 2200000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const connector = `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Input to output connector"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>${transform(2300000, 2600000, 1100000, 0)}<a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="38100"><a:solidFill><a:srgbClr val="334155"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`;
const chartFrame = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Practice accuracy chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="5600000" y="1800000"/><a:ext cx="5700000" cy="3900000"/></p:xfrm><a:graphic><a:graphicData uri="${C}"><c:chart xmlns:c="${C}" r:id="chart"/></a:graphicData></a:graphic></p:graphicFrame>`;
export const fixtureSlideXml = slide(shape(2, 'Matrix visual import fixture', 500000, 350000, 11200000, 900000, 'FFFFFF', 3200) + shape(3, 'INPUT', 700000, 2100000, 1600000, 1000000, 'BAE6FD') + shape(4, 'OUTPUT', 3400000, 2100000, 1600000, 1000000, 'FED7AA') + connector + image + chartFrame);
export const fixtureNotesXml = `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Speaker-note fact: practice accuracy rises from 42 to 91 percent.</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>999</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
export const fixtureChartXml = `<c:chartSpace xmlns:c="${C}" xmlns:a="${A}" xmlns:r="${R}"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Practice accuracy</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>Accuracy</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="6366F1"/></a:solidFill></c:spPr><c:cat><c:strLit><c:ptCount val="3"/><c:pt idx="0"><c:v>Day 1</c:v></c:pt><c:pt idx="1"><c:v>Day 2</c:v></c:pt><c:pt idx="2"><c:v>Day 3</c:v></c:pt></c:strLit></c:cat><c:val><c:numLit><c:formatCode>0</c:formatCode><c:ptCount val="3"/><c:pt idx="0"><c:v>42</c:v></c:pt><c:pt idx="1"><c:v>67</c:v></c:pt><c:pt idx="2"><c:v>91</c:v></c:pt></c:numLit></c:val></c:ser><c:axId val="123"/><c:axId val="456"/></c:barChart><c:catAx><c:axId val="123"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="456"/></c:catAx><c:valAx><c:axId val="456"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/><c:max val="100"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="123"/></c:valAx></c:plotArea><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`;

export async function visualPowerPointFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${PKG}"><Relationship Id="main" Type="${R}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="256" r:id="first"/><p:sldId id="257" r:id="second"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="${PKG}"><Relationship Id="first" Type="${R}/slide" Target="slides/slide1.xml"/><Relationship Id="second" Type="${R}/slide" Target="slides/slide2.xml"/></Relationships>`);
  zip.file('ppt/slides/slide1.xml', fixtureSlideXml);
  zip.file('ppt/slides/slide2.xml', slide(image));
  zip.file('ppt/slides/_rels/slide1.xml.rels', `<Relationships xmlns="${PKG}"><Relationship Id="image" Type="${R}/image" Target="../media/diagram.png"/><Relationship Id="chart" Type="${R}/chart" Target="../charts/chart1.xml"/><Relationship Id="notes" Type="${R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file('ppt/slides/_rels/slide2.xml.rels', `<Relationships xmlns="${PKG}"><Relationship Id="image" Type="${R}/image" Target="../media/diagram.png"/></Relationships>`);
  zip.file('ppt/charts/chart1.xml', fixtureChartXml);
  zip.file('ppt/notesSlides/notesSlide1.xml', fixtureNotesXml);
  zip.file('ppt/media/diagram.png', diagramPng());
  return zip.generateAsync({type: 'uint8array', compression: 'DEFLATE'});
}
