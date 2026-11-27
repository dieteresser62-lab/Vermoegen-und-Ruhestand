/**
 * Liest ein Tabellenblatt einer XLSX-Datei als Zeilen mit Zellwerten (Text, wie in der Datei).
 * Gleiche Leseregeln wie der Leser im Gold-Bauskript; hier für die Lieferung aus den Originalen.
 */
import path from 'node:path';
import zlib from 'node:zlib';

function fail(message, details = undefined) {
    const error = new Error(`${message}${details ? ` ${JSON.stringify(details)}` : ''}`);
    throw error;
}

/** @param {Buffer} zipBuffer @returns {Map<string, Buffer>} */
function unzipEntries(zipBuffer) {
    const minimumEocdOffset = Math.max(0, zipBuffer.length - 65557);
    let eocdOffset = -1;
    for (let offset = zipBuffer.length - 22; offset >= minimumEocdOffset; offset -= 1) {
        if (zipBuffer.readUInt32LE(offset) === 0x06054b50) {
            eocdOffset = offset;
            break;
        }
    }
    if (eocdOffset < 0) fail('XLSX ZIP end-of-central-directory record is missing');
    const entryCount = zipBuffer.readUInt16LE(eocdOffset + 10);
    let centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    const entries = new Map();
    for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
        if (zipBuffer.readUInt32LE(centralOffset) !== 0x02014b50) fail('XLSX ZIP central-directory entry is invalid', { entryIndex });
        const compressionMethod = zipBuffer.readUInt16LE(centralOffset + 10);
        const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
        const uncompressedSize = zipBuffer.readUInt32LE(centralOffset + 24);
        const fileNameLength = zipBuffer.readUInt16LE(centralOffset + 28);
        const extraLength = zipBuffer.readUInt16LE(centralOffset + 30);
        const commentLength = zipBuffer.readUInt16LE(centralOffset + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(centralOffset + 42);
        const fileName = zipBuffer.toString('utf8', centralOffset + 46, centralOffset + 46 + fileNameLength);
        if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) fail('XLSX ZIP local-file header is invalid', { fileName });
        const compressedStart = localHeaderOffset + 30 + zipBuffer.readUInt16LE(localHeaderOffset + 26) + zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const compressed = zipBuffer.subarray(compressedStart, compressedStart + compressedSize);
        const content = compressionMethod === 0 ? Buffer.from(compressed)
            : compressionMethod === 8 ? zlib.inflateRawSync(compressed) : fail('Unsupported XLSX ZIP compression method', { fileName });
        if (content.length !== uncompressedSize) fail('XLSX ZIP entry size mismatch', { fileName });
        entries.set(fileName, content);
        centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
}

/** @param {string} value */
function decodeXmlText(value) {
    return value
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&')
        .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)));
}

/** @param {string} reference */
function columnIndex(reference) {
    const letters = reference.match(/^[A-Z]+/)?.[0];
    if (!letters) fail('XLSX cell reference has no column', { reference });
    let index = 0;
    for (const letter of letters) index = (index * 26) + letter.charCodeAt(0) - 64;
    return index - 1;
}

/**
 * @param {Buffer} xlsxBuffer @param {string} sheetName
 * @returns {string[][]} Zeilen; fehlende Zellen bleiben leer.
 */
export function readXlsxSheetRows(xlsxBuffer, sheetName) {
    const entries = unzipEntries(xlsxBuffer);
    const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8');
    const relationshipsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
    if (!workbookXml || !relationshipsXml) fail('Expected XLSX workbook metadata is missing');
    const sheet = [...workbookXml.matchAll(/<sheet ([^>]*)\/>/g)].map(match => ({
        name: decodeXmlText(match[1].match(/\bname="([^"]+)"/)?.[1] ?? ''),
        relationshipId: match[1].match(/\br:id="([^"]+)"/)?.[1]
    })).find(candidate => candidate.name === sheetName);
    if (!sheet?.relationshipId) fail('XLSX worksheet is missing', { sheetName });
    const target = [...relationshipsXml.matchAll(/<Relationship ([^>]*)\/>/g)]
        .map(match => ({ id: match[1].match(/\bId="([^"]+)"/)?.[1], target: match[1].match(/\bTarget="([^"]+)"/)?.[1] }))
        .find(({ id }) => id === sheet.relationshipId)?.target;
    if (!target) fail('XLSX worksheet relationship is missing', { sheetName });
    const worksheetXml = entries.get(path.posix.normalize(path.posix.join('xl', target)))?.toString('utf8');
    if (!worksheetXml) fail('XLSX worksheet content is missing', { sheetName });
    const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
    const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => (
        [...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map(textMatch => decodeXmlText(textMatch[1])).join('')
    ));
    return [...worksheetXml.matchAll(/<row(?: [^>]*)?>([\s\S]*?)<\/row>/g)].map(rowMatch => {
        const row = [];
        for (const cellMatch of rowMatch[1].matchAll(/<c(?: ([^>]*))?>([\s\S]*?)<\/c>/g)) {
            const attributes = cellMatch[1] ?? '';
            const reference = attributes.match(/\br="([^"]+)"/)?.[1];
            if (!reference) continue;
            const type = attributes.match(/\bt="([^"]+)"/)?.[1];
            const rawValue = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1];
            let value = '';
            if (type === 'inlineStr') {
                value = [...cellMatch[2].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map(match => decodeXmlText(match[1])).join('');
            } else if (rawValue !== undefined) {
                value = type === 's' ? sharedStrings[Number(rawValue)] : decodeXmlText(rawValue);
            }
            row[columnIndex(reference)] = value;
        }
        return row;
    });
}
