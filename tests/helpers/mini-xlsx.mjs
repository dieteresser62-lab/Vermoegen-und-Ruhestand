// Kleine XLSX-Datei für Lesertests: je Blatt Zeilen mit Textzellen, ZIP ohne Kompression.
// Ersetzt in den Jahresdaten-Tests die großen Weltbank-Arbeitsmappen; gelesen wird mit dem echten XLSX-Leser.

const CRC_TABELLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});

/** @param {Buffer} bytes */
function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (const byte of bytes) c = CRC_TABELLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** @param {Map<string, Buffer>} eintraege */
function zipOhneKompression(eintraege) {
    const lokal = [], zentral = [];
    let offset = 0;
    for (const [name, inhalt] of eintraege) {
        const namensBytes = Buffer.from(name, 'utf8');
        const crc = crc32(inhalt);
        const kopf = Buffer.alloc(30);
        kopf.writeUInt32LE(0x04034b50, 0); kopf.writeUInt16LE(20, 4); kopf.writeUInt32LE(crc, 14);
        kopf.writeUInt32LE(inhalt.length, 18); kopf.writeUInt32LE(inhalt.length, 22); kopf.writeUInt16LE(namensBytes.length, 26);
        const verzeichnis = Buffer.alloc(46);
        verzeichnis.writeUInt32LE(0x02014b50, 0); verzeichnis.writeUInt16LE(20, 4); verzeichnis.writeUInt16LE(20, 6); verzeichnis.writeUInt32LE(crc, 16);
        verzeichnis.writeUInt32LE(inhalt.length, 20); verzeichnis.writeUInt32LE(inhalt.length, 24); verzeichnis.writeUInt16LE(namensBytes.length, 28);
        verzeichnis.writeUInt32LE(offset, 42);
        lokal.push(kopf, namensBytes, inhalt);
        zentral.push(verzeichnis, namensBytes);
        offset += kopf.length + namensBytes.length + inhalt.length;
    }
    const zentralBytes = Buffer.concat(zentral);
    const ende = Buffer.alloc(22);
    ende.writeUInt32LE(0x06054b50, 0); ende.writeUInt16LE(eintraege.size, 8); ende.writeUInt16LE(eintraege.size, 10);
    ende.writeUInt32LE(zentralBytes.length, 12); ende.writeUInt32LE(offset, 16);
    return Buffer.concat([...lokal, zentralBytes, ende]);
}

const xml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const spalte = index => String.fromCharCode(65 + index);

/**
 * @param {Record<string, string[][]>} blaetter Blattname → Zeilen (höchstens 26 Spalten).
 * @returns {Buffer}
 */
export function miniXlsx(blaetter) {
    const namen = Object.keys(blaetter);
    const eintraege = new Map();
    eintraege.set('xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
        namen.map((name, index) => `<sheet name="${xml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`));
    eintraege.set('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships>${
        namen.map((_, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`));
    namen.forEach((name, index) => {
        const zeilen = blaetter[name].map((zeile, r) => `<row r="${r + 1}">${zeile.map((wert, c) => (
            wert === '' ? '' : `<c r="${spalte(c)}${r + 1}" t="inlineStr"><is><t>${xml(wert)}</t></is></c>`)).join('')}</row>`).join('');
        eintraege.set(`xl/worksheets/sheet${index + 1}.xml`, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>${zeilen}</sheetData></worksheet>`));
    });
    return zipOhneKompression(eintraege);
}
