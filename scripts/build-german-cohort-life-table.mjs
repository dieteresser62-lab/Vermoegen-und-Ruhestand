"use strict";

// FR-75: Destatis-Kohortensterbetafel V2 (mittel) als Zieltafel je Geburtsjahrgang.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const SOURCE_PATH = path.join(PROJECT_ROOT, 'data', 'historical', 'german-cohort-life-table', 'originals',
    'destatis-cohort-life-tables-1926-2026.xlsx');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'app', 'simulator', 'german-cohort-life-table.js');
const VERIFY_ONLY = process.argv.includes('--verify-only');
const SOURCE_SHA256 = '724baa7893854da51dfb2991c5bc03174c046a34e96d6230eb08e5d579504379';
const SOURCE_URL = 'https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Sterbefaelle-Lebenserwartung/Publikationen/Downloads-Sterbefaelle/statistischer-bericht-kohortensterbetafeln-5126101269005.xlsx?__blob=publicationFile&v=3';
const FIRST_BIRTH_YEAR = 1926;
const LAST_BIRTH_YEAR = 2026;
const FIRST_RUNTIME_AGE = 18;
const LAST_OFFICIAL_AGE = 99;
const VARIANT_LABEL = 'V2 (mittel)';
// Tabellen b03/b04: qx V2; b09/b10: volle Tafel V2 (nur ex bei 65 als Prüfwert).
const QX_SHEETS = Object.freeze({ m: 'csv-12621-b03', w: 'csv-12621-b04' });
const FULL_TABLE_SHEETS = Object.freeze({ m: 'csv-12621-b09', w: 'csv-12621-b10' });
const SEX_LABELS = Object.freeze({ m: 'maennlich', w: 'weiblich' });

function fail(message, details = undefined) {
    const error = new Error(message);
    error.code = 'GERMAN_COHORT_LIFE_TABLE_SOURCE_INVALID';
    if (details !== undefined) error.details = details;
    throw error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalKeyCompare(left, right) {
    const leftInteger = /^(0|[1-9]\d*)$/.test(left);
    const rightInteger = /^(0|[1-9]\d*)$/.test(right);
    if (leftInteger && rightInteger) return Number(left) - Number(right);
    if (leftInteger !== rightInteger) return leftInteger ? -1 : 1;
    return left.localeCompare(right);
}

function canonicalize(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    return `{${Object.keys(value).sort(canonicalKeyCompare)
        .map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function sha256Canonical(value) {
    return sha256(Buffer.from(canonicalize(value), 'utf8'));
}

function decodeXmlText(value) {
    return String(value ?? '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&')
        .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)));
}

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
        if (zipBuffer.readUInt32LE(centralOffset) !== 0x02014b50) {
            fail('XLSX central-directory entry is invalid', { entryIndex, centralOffset });
        }
        const compressionMethod = zipBuffer.readUInt16LE(centralOffset + 10);
        const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
        const uncompressedSize = zipBuffer.readUInt32LE(centralOffset + 24);
        const fileNameLength = zipBuffer.readUInt16LE(centralOffset + 28);
        const extraLength = zipBuffer.readUInt16LE(centralOffset + 30);
        const commentLength = zipBuffer.readUInt16LE(centralOffset + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(centralOffset + 42);
        const fileName = zipBuffer.toString('utf8', centralOffset + 46, centralOffset + 46 + fileNameLength);
        if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            fail('XLSX local-file header is invalid', { fileName, localHeaderOffset });
        }
        const localFileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const compressedStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressed = zipBuffer.subarray(compressedStart, compressedStart + compressedSize);
        const content = compressionMethod === 0
            ? Buffer.from(compressed)
            : compressionMethod === 8
                ? zlib.inflateRawSync(compressed)
                : null;
        if (!content || content.length !== uncompressedSize) {
            fail('XLSX entry is unsupported or has an invalid size', {
                fileName,
                compressionMethod,
                expected: uncompressedSize,
                actual: content?.length ?? null
            });
        }
        entries.set(fileName.replaceAll('\\', '/'), content);
        centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
}

function columnIndexFromCellReference(reference) {
    const letters = reference.match(/^[A-Z]+/)?.[0];
    if (!letters) fail('XLSX cell reference has no column', { reference });
    let index = 0;
    for (const letter of letters) index = (index * 26) + letter.charCodeAt(0) - 64;
    return index - 1;
}

function workbookSheetPaths(entries) {
    const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8');
    const relationshipsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
    if (!workbookXml || !relationshipsXml) fail('XLSX workbook metadata is missing');
    const relationshipTargets = new Map(
        [...relationshipsXml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)].map(match => {
            const attributes = match[1];
            const id = attributes.match(/\bId="([^"]+)"/)?.[1];
            const target = attributes.match(/\bTarget="([^"]+)"/)?.[1];
            return [id, target];
        })
    );
    const paths = new Map();
    for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
        const attributes = match[1];
        const name = decodeXmlText(attributes.match(/\bname="([^"]+)"/)?.[1]);
        const relationshipId = attributes.match(/\br:id="([^"]+)"/)?.[1];
        const target = relationshipTargets.get(relationshipId);
        if (!name || !target) fail('XLSX worksheet relationship is incomplete', { name, relationshipId });
        const normalizedTarget = target.startsWith('/')
            ? target.slice(1)
            : path.posix.normalize(path.posix.join('xl', target));
        paths.set(name, normalizedTarget);
    }
    return paths;
}

function readXlsxSheetRows(entries, sheetName) {
    const sheetPath = workbookSheetPaths(entries).get(sheetName);
    const worksheetXml = entries.get(sheetPath)?.toString('utf8');
    if (!sheetPath || !worksheetXml) fail('XLSX worksheet is missing', { sheetName, sheetPath });
    const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
    const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => (
        [...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)]
            .map(textMatch => decodeXmlText(textMatch[1]))
            .join('')
    ));
    return [...worksheetXml.matchAll(/<row(?: [^>]*)?>([\s\S]*?)<\/row>/g)].map(rowMatch => {
        const row = [];
        const nonEmptyCellXml = rowMatch[1].replace(/<c\b[^>]*\/>/g, '');
        for (const cellMatch of nonEmptyCellXml.matchAll(/<c(?: ([^>]*))?>([\s\S]*?)<\/c>/g)) {
            const attributes = cellMatch[1] ?? '';
            const cellXml = cellMatch[2];
            const reference = attributes.match(/\br="([^"]+)"/)?.[1];
            if (!reference) continue;
            const type = attributes.match(/\bt="([^"]+)"/)?.[1];
            const rawValue = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
            let value = '';
            if (type === 'inlineStr') {
                value = [...cellXml.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)]
                    .map(match => decodeXmlText(match[1]))
                    .join('');
            } else if (rawValue !== undefined) {
                value = type === 's' ? sharedStrings[Number(rawValue)] : decodeXmlText(rawValue);
            }
            row[columnIndexFromCellReference(reference)] = value;
        }
        return row;
    });
}

function rowsToRecords(rows, sheetName) {
    const headers = rows[0];
    if (!headers || new Set(headers).size !== headers.length) {
        fail('XLSX worksheet headers must exist and be unique', { sheetName, headers });
    }
    return rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [
        header,
        row[index] ?? ''
    ])));
}

function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) fail(`${label} must be finite`, { value });
    return number;
}

function selectedRecords(entries, sheetName, sex) {
    const records = rowsToRecords(readXlsxSheetRows(entries, sheetName), sheetName);
    const selected = records.filter(record => record.Statistik === 'Kohortensterbetafel');
    if (selected.length !== (LAST_BIRTH_YEAR - FIRST_BIRTH_YEAR + 1) * 101) {
        fail('Destatis cohort sheet must contain 101 birth years with ages 0-99 and 100+', { sheetName, count: selected.length });
    }
    for (const record of selected) {
        if (record.Geschlecht !== SEX_LABELS[sex] || record.Variante !== VARIANT_LABEL) {
            fail('Destatis cohort sheet has an unexpected sex or variant', { sheetName, sex: record.Geschlecht, variant: record.Variante });
        }
    }
    return selected;
}

function readCohortTables(entries) {
    const qx = {};
    const officialLifeExpectancyAt65Years = {};
    for (const sex of ['m', 'w']) {
        qx[sex] = {};
        for (const record of selectedRecords(entries, QX_SHEETS[sex], sex)) {
            const birthYear = finiteNumber(record.Geburtsjahrgang, `birth year ${sex}`);
            if (record['Alter '] === '100 und mehr') {
                if (finiteNumber(record.qx, `qx ${sex} ${birthYear} 100+`) !== 1) fail('Open age group must be terminal', { sex, birthYear });
                continue;
            }
            const age = finiteNumber(record['Alter '], `age ${sex} ${birthYear}`);
            const value = finiteNumber(record.qx, `qx ${sex} ${birthYear} ${age}`);
            if (!Number.isInteger(birthYear) || birthYear < FIRST_BIRTH_YEAR || birthYear > LAST_BIRTH_YEAR
                || !Number.isInteger(age) || age < 0 || age > LAST_OFFICIAL_AGE || !(value > 0) || value >= 1) {
                fail('Destatis cohort observation is out of range', { sex, birthYear, age, value });
            }
            if (age < FIRST_RUNTIME_AGE) continue;
            (qx[sex][birthYear] ||= [])[age - FIRST_RUNTIME_AGE] = value;
        }
        for (let year = FIRST_BIRTH_YEAR; year <= LAST_BIRTH_YEAR; year += 1) {
            const row = qx[sex][year];
            if (!row || row.length !== LAST_OFFICIAL_AGE - FIRST_RUNTIME_AGE + 1 || row.some(value => !Number.isFinite(value))) {
                fail('Destatis cohort row is incomplete', { sex, year });
            }
        }
        const e65 = Array.from({ length: LAST_BIRTH_YEAR - FIRST_BIRTH_YEAR + 1 });
        for (const record of selectedRecords(entries, FULL_TABLE_SHEETS[sex], sex)) {
            if (record['Alter '] !== '65') continue;
            const birthYear = finiteNumber(record.Geburtsjahrgang, `full table birth year ${sex}`);
            if (finiteNumber(record.qx, `full table qx ${sex} ${birthYear}`) !== qx[sex][birthYear][65 - FIRST_RUNTIME_AGE]) {
                fail('Full cohort table and qx table disagree at age 65', { sex, birthYear });
            }
            e65[birthYear - FIRST_BIRTH_YEAR] = finiteNumber(record.ex, `ex ${sex} ${birthYear} 65`);
        }
        if (e65.some(value => !Number.isFinite(value))) fail('Life expectancy at 65 is incomplete', { sex });
        officialLifeExpectancyAt65Years[sex] = e65;
    }
    if (qx.m[1960][99 - FIRST_RUNTIME_AGE] !== 0.34534079486238189 || qx.w[1926][0] === undefined) {
        fail('Destatis cohort marker changed unexpectedly', { male1960Age99: qx.m[1960][99 - FIRST_RUNTIME_AGE] });
    }
    return { qx, officialLifeExpectancyAt65Years };
}

function buildArtifact() {
    const source = fs.readFileSync(SOURCE_PATH);
    if (sha256(source) !== SOURCE_SHA256) fail('Cohort source hash mismatch');
    const { qx, officialLifeExpectancyAt65Years } = readCohortTables(unzipEntries(source));
    return {
        schemaVersion: 'GermanCohortLifeTableV1',
        source: {
            fileName: path.basename(SOURCE_PATH),
            sha256: SOURCE_SHA256,
            sourceUrl: SOURCE_URL,
            sourceSeries: 'Destatis Statistischer Bericht Kohortensterbetafeln für Deutschland 1926-2026 (EVAS 12621, Artikel 5126101269005), Tabellen 12621-b03 und 12621-b04',
            publishedAt: '2026-09-16',
            retrievedAt: '2026-11-12',
            license: 'Data Licence Germany - attribution - version 2.0'
        },
        variant: {
            id: 'V2',
            label: VARIANT_LABEL,
            construction: 'Destatis: Mittel der qx der Varianten V1 (Trend 2011-2021 bis 2070) und V3 (Trend 1971-2024); 16. koordinierte Bevölkerungsvorausberechnung.'
        },
        birthYears: { first: FIRST_BIRTH_YEAR, last: LAST_BIRTH_YEAR },
        ages: { first: FIRST_RUNTIME_AGE, last: LAST_OFFICIAL_AGE, openAgeGroup: '100 und mehr = 1 in der Quelle; Laufzeit setzt den skalierten Tafelschwanz an (siehe Demografievertrag).' },
        hashes: { qxTableHash: sha256Canonical(qx) },
        officialLifeExpectancyAt65Years,
        qx
    };
}

function renderModule(artifact) {
    const { qx, officialLifeExpectancyAt65Years, ...meta } = artifact;
    const rows = sex => Object.keys(qx[sex]).map(year => `            ${year}: ${JSON.stringify(qx[sex][year])}`).join(',\n');
    return Buffer.from(`/**
 * Generated by scripts/build-german-cohort-life-table.mjs.
 * Do not edit by hand. Index 0 = Alter ${FIRST_RUNTIME_AGE}, letzter Index = Alter ${LAST_OFFICIAL_AGE}.
 */
"use strict";

function deepFreeze(value) {
    if (value === null || typeof value !== 'object') return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

export const GERMAN_COHORT_LIFE_TABLE = deepFreeze({
${JSON.stringify(meta, null, 4).slice(2, -2)},
    officialLifeExpectancyAt65Years: {
        m: ${JSON.stringify(officialLifeExpectancyAt65Years.m)},
        w: ${JSON.stringify(officialLifeExpectancyAt65Years.w)}
    },
    qx: {
        m: {
${rows('m')}
        },
        w: {
${rows('w')}
        }
    }
});
`, 'utf8');
}

function main() {
    const artifact = buildArtifact();
    const generated = renderModule(artifact);
    if (VERIFY_ONLY) {
        if (!fs.existsSync(OUTPUT_PATH)) fail('Generated cohort life table module is missing');
        const existing = fs.readFileSync(OUTPUT_PATH);
        if (!existing.equals(generated)) {
            fail('Generated cohort life table module is stale', { expectedSha256: sha256(generated), actualSha256: sha256(existing) });
        }
        process.stdout.write(`Verified German cohort life table; qx hash ${artifact.hashes.qxTableHash}\n`);
        return;
    }
    fs.writeFileSync(OUTPUT_PATH, generated);
    process.stdout.write(`Built German cohort life table; qx hash ${artifact.hashes.qxTableHash}\n`);
}

main();
