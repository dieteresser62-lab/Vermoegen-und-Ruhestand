import fs from 'node:fs';
import path from 'node:path';
import { validateSvgXml } from './svg-xml-contract.mjs';
const root = new URL('../', import.meta.url);
function discover(directory) {
    return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? discover(file) : entry.name.endsWith('.svg') ? [file] : [];
    });
}
const images = discover(new URL('assets/images/', root).pathname);
assert(images.length > 0, 'SVGs werden automatisch entdeckt');
for (const file of images) assert(validateSvgXml(fs.readFileSync(file, 'utf8')), path.basename(file) + ': XML-wohlgeformt');
const handbook = fs.readFileSync(new URL('Handbuch.html', root), 'utf8');
const embedded = [...handbook.matchAll(/<img\b[^>]*src="([^"]+\.svg)"/g)].map(match => match[1]);
assertEqual(embedded.length, 0, 'Das neue Handbuch verwendet echte App-PNGs; alle SVG-Assets werden weiter separat geprüft');
for (const src of embedded) assert(images.includes(path.resolve(new URL(src, root).pathname)), src + ': Einbindung im entdeckten Bestand');
for (const valid of ['<svg>&amp;&#37;&#x25;</svg>', '<?xml version="1.0"?><svg a="&quot;"><!-- Kommentar --><![CDATA[<&]]><g/></svg>']) {
    assert(validateSvgXml(valid), 'Gültige Entitäten, Attribute, Kommentar und CDATA');
}
for (const invalid of ['<svg>A & B</svg>', '<svg><g></svg>', '<svg a="1" a="2"/>', '<svg/><svg/>', '<svg>&unknown;</svg>', '<svg>&#0;</svg>', '<svg a="<"/>', '<svg a="1"b="2"/>', '<!DOCTYPE svg><svg/>', '<svg><!-- a--b --></svg>', '<svg><![CDATA[offen</svg>', '<svg/>Text', '<svg\u00a0a="1"/>', '<svg/>\u00a0', '<svg>]]></svg>', '<?instruction value?><svg/>']) {
    let rejected = false;
    try { validateSvgXml(invalid); } catch (error) { rejected = error instanceof SyntaxError; }
    assert(rejected, 'Syntaxfehler wird verworfen: ' + invalid);
}
