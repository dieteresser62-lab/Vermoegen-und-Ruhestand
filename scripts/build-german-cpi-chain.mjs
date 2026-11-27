import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { HISTORICAL_END_YEAR } from './lib/historical-end-year.mjs';
import { currentTableAnnualRates, currentTableConstruction } from './lib/german-cpi-current-table.mjs';
import { GRUNDBESTAND_END_YEAR } from './lib/jahresdaten/grundbestand.mjs';
import { fortschreibungAnwenden } from './lib/jahresdaten/fortschreibung.mjs';
import * as inflationKette from './lib/jahresdaten/ketten/inflation.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const DATA_DIRECTORY = path.join(
    PROJECT_ROOT,
    'data',
    'historical',
    'german-cpi-chain'
);
const ORIGINAL_DATA_DIRECTORY = path.join(DATA_DIRECTORY, 'originals');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'app', 'simulator', 'german-cpi-chain.js');
const VERIFY_ONLY = process.argv.includes('--verify-only');
const END_YEAR = HISTORICAL_END_YEAR;
// Die Originale bauen den Grundbestand bis GRUND_END_YEAR; spätere Jahre bis END_YEAR kommen aus den Jahreslieferungen.
const GRUND_END_YEAR = GRUNDBESTAND_END_YEAR;
// Die gepinnte Langreihe (Stand 2025-06) endet 2024; alle Jahre danach bis zum Endjahr liefert die aktuelle Jahrestabelle.
const LONG_SERIES_LAST_YEAR = 2024;
const DESTATIS_ROUNDED_LEVEL_RATE_TOLERANCE_PP = 0.05;
const JST_PROXY_REFERENCE_YEAR = 1938;
const JST_PROXY_REFERENCE_LEVEL = 126;

const SOURCE_FILES = Object.freeze({
    jst: {
        filePath: path.join(
            PROJECT_ROOT,
            'data',
            'historical',
            'global-equity-research-chain',
            'originals',
            'JSTdatasetR6.xlsx'
        ),
        sha256: 'c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d',
        sourceUrl: 'https://www.macrohistory.net/app/download/9834512569/JSTdatasetR6.xlsx?t=1763503850',
        license: 'CC BY-NC-SA 4.0',
        dataAsOf: 'JST Macrohistory Database revision R6'
    },
    destatisLongSeries: {
        filePath: path.join(
            ORIGINAL_DATA_DIRECTORY,
            'destatis-vpi-lange-reihen-2025-06.xlsx'
        ),
        sha256: '8c728e44fa400d762009fa34507a34e1fee3947641d2579484d7d040763b11f4',
        sourceUrl: 'https://www.destatis.de/DE/Themen/Wirtschaft/Preise/Verbraucherpreisindex/Publikationen/Downloads-Verbraucherpreise/statistischer-bericht-verbraucherpreisindex-lange-reihen-5611103.html',
        license: 'Data Licence Germany - attribution - Version 2.0',
        dataAsOf: '2025-06'
    },
    destatisCurrent: {
        filePath: path.join(
            ORIGINAL_DATA_DIRECTORY,
            'destatis-vpi-current-2026-07-10.html'
        ),
        sha256: '82ab91a5e53db7cd74cdf4f7b4d85813e586fbd3ae0bbd3d01a6cb231b596743',
        sourceUrl: 'https://www.destatis.de/DE/Themen/Wirtschaft/Preise/Verbraucherpreisindex/Tabellen/Verbraucherpreise-12Kategorien.html',
        license: 'Data Licence Germany - attribution - Version 2.0',
        dataAsOf: '2026-07-10'
    }
});

const FOUR_PERSON_MEDIUM_INCOME =
    '4-Personen-Haushalte von Arbeitern und Angestellten mit mittlerem Einkommen';
const ALL_PRIVATE_HOUSEHOLDS = 'Alle privaten Haushalte';

function fail(message, details = undefined) {
    const error = new Error(message);
    if (details !== undefined) error.details = details;
    throw error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
    return sha256(fs.readFileSync(filePath));
}

function canonicalKeyCompare(left, right) {
    const leftIsInteger = /^(0|[1-9]\d*)$/.test(left);
    const rightIsInteger = /^(0|[1-9]\d*)$/.test(right);
    if (leftIsInteger && rightIsInteger) return Number(left) - Number(right);
    if (leftIsInteger !== rightIsInteger) return leftIsInteger ? -1 : 1;
    return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail('Cannot canonicalize a non-finite number', { value });
        return JSON.stringify(value);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    if (typeof value === 'object') {
        const keys = Object.keys(value).sort(canonicalKeyCompare);
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    }
    fail('Unsupported canonical value', { type: typeof value });
}

function sha256Canonical(value) {
    return sha256(canonicalize(value));
}

function finiteNumber(value, label) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) fail(`${label} must be finite`, { value });
    return numericValue;
}

function positiveNumber(value, label) {
    const numericValue = finiteNumber(value, label);
    if (!(numericValue > 0)) fail(`${label} must be greater than zero`, { value });
    return numericValue;
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
            fail('XLSX ZIP central-directory entry is invalid', { entryIndex, centralOffset });
        }
        const compressionMethod = zipBuffer.readUInt16LE(centralOffset + 10);
        const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
        const uncompressedSize = zipBuffer.readUInt32LE(centralOffset + 24);
        const fileNameLength = zipBuffer.readUInt16LE(centralOffset + 28);
        const extraLength = zipBuffer.readUInt16LE(centralOffset + 30);
        const commentLength = zipBuffer.readUInt16LE(centralOffset + 32);
        const localHeaderOffset = zipBuffer.readUInt32LE(centralOffset + 42);
        const fileName = zipBuffer.toString(
            'utf8',
            centralOffset + 46,
            centralOffset + 46 + fileNameLength
        );

        if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
            fail('XLSX ZIP local-file header is invalid', { fileName, localHeaderOffset });
        }
        const localFileNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
        const compressedStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
        const compressed = zipBuffer.subarray(compressedStart, compressedStart + compressedSize);
        let content;
        if (compressionMethod === 0) {
            content = Buffer.from(compressed);
        } else if (compressionMethod === 8) {
            content = zlib.inflateRawSync(compressed);
        } else {
            fail('Unsupported XLSX ZIP compression method', { fileName, compressionMethod });
        }
        if (content.length !== uncompressedSize) {
            fail('XLSX ZIP entry size mismatch', {
                fileName,
                expected: uncompressedSize,
                actual: content.length
            });
        }
        entries.set(fileName, content);
        centralOffset += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
}

function decodeXmlText(value) {
    return value
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&')
        .replace(/&#(\d+);/g, (_match, codePoint) => String.fromCodePoint(Number(codePoint)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) => (
            String.fromCodePoint(Number.parseInt(codePoint, 16))
        ));
}

function columnIndexFromCellReference(reference) {
    const letters = reference.match(/^[A-Z]+/)?.[0];
    if (!letters) fail('XLSX cell reference has no column', { reference });
    let index = 0;
    for (const letter of letters) index = (index * 26) + letter.charCodeAt(0) - 64;
    return index - 1;
}

function readXlsxSheetRows(xlsxBuffer, sheetName) {
    const entries = unzipEntries(xlsxBuffer);
    const workbookXml = entries.get('xl/workbook.xml')?.toString('utf8');
    const relationshipsXml = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8');
    if (!workbookXml || !relationshipsXml) fail('Expected XLSX workbook metadata is missing');

    const sheets = [...workbookXml.matchAll(/<sheet ([^>]*)\/>/g)].map((match) => {
        const attributes = match[1];
        return {
            name: decodeXmlText(attributes.match(/\bname="([^"]+)"/)?.[1] ?? ''),
            relationshipId: attributes.match(/\br:id="([^"]+)"/)?.[1]
        };
    });
    const sheet = sheets.find((candidate) => candidate.name === sheetName);
    if (!sheet?.relationshipId) fail('XLSX worksheet is missing', { sheetName });

    const relationships = [...relationshipsXml.matchAll(/<Relationship ([^>]*)\/>/g)].map((match) => {
        const attributes = match[1];
        return {
            id: attributes.match(/\bId="([^"]+)"/)?.[1],
            target: attributes.match(/\bTarget="([^"]+)"/)?.[1]
        };
    });
    const target = relationships.find(({ id }) => id === sheet.relationshipId)?.target;
    if (!target) fail('XLSX worksheet relationship is missing', { sheetName });
    const worksheetPath = path.posix.normalize(path.posix.join('xl', target));
    const worksheetXml = entries.get(worksheetPath)?.toString('utf8');
    if (!worksheetXml) fail('XLSX worksheet content is missing', { sheetName, worksheetPath });

    const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
    const sharedStrings = [...sharedStringsXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => (
        [...match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)]
            .map(textMatch => decodeXmlText(textMatch[1]))
            .join('')
    ));

    return [...worksheetXml.matchAll(/<row(?: [^>]*)?>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
        const row = [];
        for (const cellMatch of rowMatch[1].matchAll(/<c(?: ([^>]*))?>([\s\S]*?)<\/c>/g)) {
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
                value = type === 's'
                    ? sharedStrings[Number(rawValue)]
                    : decodeXmlText(rawValue);
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
    return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [
        header,
        row[index] ?? ''
    ])));
}

function requireUniqueRecord(records, predicate, label) {
    const matches = records.filter(predicate);
    if (matches.length !== 1) fail(`${label} must resolve to exactly one row`, {
        count: matches.length
    });
    return matches[0];
}

function destatisSelector(territory, household, year) {
    return (row) => (
        row.Statistik === 'Verbraucherpreisindex für Deutschland'
        && row.Gebiet === territory
        && row.Merkmal_1 === (
            territory === 'Deutschland'
                ? 'Verbraucherpreisindex'
                : 'Preisindex für die Lebenshaltung '
        )
        && row.Merkmal_2 === household
        && Number(row.Jahr) === year
    );
}

function destatisValue(records, territory, household, year, label) {
    const row = requireUniqueRecord(
        records,
        destatisSelector(territory, household, year),
        label
    );
    return finiteNumber(row.Wert, label);
}

function validatePublishedRate(levelRecords, rateRecords, territory, household, year) {
    const label = `Destatis ${territory} ${household} ${year}`;
    const previousLevel = positiveNumber(
        destatisValue(levelRecords, territory, household, year - 1, `${label} previous level`),
        `${label} previous level`
    );
    const currentLevel = positiveNumber(
        destatisValue(levelRecords, territory, household, year, `${label} current level`),
        `${label} current level`
    );
    const publishedRate = destatisValue(
        rateRecords,
        territory,
        household,
        year,
        `${label} published rate`
    );
    const levelDerivedRate = ((currentLevel / previousLevel) - 1) * 100;
    if (Math.abs(levelDerivedRate - publishedRate) > DESTATIS_ROUNDED_LEVEL_RATE_TOLERANCE_PP) {
        fail('Published Destatis rate is inconsistent with the rounded index levels', {
            territory,
            household,
            year,
            previousLevel,
            currentLevel,
            publishedRate,
            levelDerivedRate
        });
    }
    return publishedRate;
}

function extractCurrentDestatisValue(html, entryId, expectedCaptionText, year) {
    return inflationKette.extractCurrentDestatisValue(html, entryId, expectedCaptionText, year, fail);
}

const sourceBuffers = Object.fromEntries(Object.entries(SOURCE_FILES).map(([sourceId, source]) => [
    sourceId,
    fs.readFileSync(source.filePath)
]));
for (const [sourceId, source] of Object.entries(SOURCE_FILES)) {
    const actualHash = sha256(sourceBuffers[sourceId]);
    if (actualHash !== source.sha256) fail(`${sourceId} source hash mismatch`, {
        expected: source.sha256,
        actual: actualHash
    });
}

const jstRows = readXlsxSheetRows(sourceBuffers.jst, 'Sheet1');
const jstHeaders = jstRows[0];
const jstColumnIndex = Object.fromEntries(jstHeaders.map((header, index) => [header, index]));
for (const header of ['year', 'iso', 'cpi']) {
    if (!Number.isInteger(jstColumnIndex[header])) fail('JST original is missing a required column', {
        header
    });
}
const germanJstCpi = new Map(
    jstRows.slice(1)
        .filter((row) => row[jstColumnIndex.iso] === 'DEU')
        .map((row) => [
            Number(row[jstColumnIndex.year]),
            positiveNumber(
                row[jstColumnIndex.cpi],
                `JST German CPI ${row[jstColumnIndex.year]}`
            )
        ])
);

const levelRecords = rowsToRecords(
    readXlsxSheetRows(sourceBuffers.destatisLongSeries, 'csv-611xx-01'),
    'csv-611xx-01'
);
const rateRecords = rowsToRecords(
    readXlsxSheetRows(sourceBuffers.destatisLongSeries, 'csv-611xx-02'),
    'csv-611xx-02'
);
const currentHtml = sourceBuffers.destatisCurrent.toString('utf8');
const longSeriesLastLevel = destatisValue(
    levelRecords,
    'Deutschland',
    'Verbraucherpreisindex',
    LONG_SERIES_LAST_YEAR,
    `Destatis Germany CPI ${LONG_SERIES_LAST_YEAR} level`
);
// Jedes Folgejahr: Plausibilitätsrahmen statt fester Werte und Rate gegen die Änderung der Jahresdurchschnitte.
const currentTableRates = currentTableAnnualRates({
    longSeriesLastYear: LONG_SERIES_LAST_YEAR,
    longSeriesLastLevel,
    endYear: GRUND_END_YEAR,
    readLevel: year => extractCurrentDestatisValue(currentHtml, '236128', '2020=100', year),
    readRate: year => extractCurrentDestatisValue(currentHtml, '236130', 'Veränderungsraten zum Vorjahr in %', year),
    tolerancePp: DESTATIS_ROUNDED_LEVEL_RATE_TOLERANCE_PP,
    fail
});

const annualRates = {};
for (let year = 1925; year <= 1949; year += 1) {
    const previousLevel = positiveNumber(germanJstCpi.get(year - 1), `JST German CPI ${year - 1}`);
    const currentLevel = positiveNumber(germanJstCpi.get(year), `JST German CPI ${year}`);
    annualRates[year] = ((currentLevel / previousLevel) - 1) * 100;
}
for (let year = 1950; year <= 1962; year += 1) {
    annualRates[year] = validatePublishedRate(
        levelRecords,
        rateRecords,
        'Früheres Bundesgebiet',
        FOUR_PERSON_MEDIUM_INCOME,
        year
    );
}
for (let year = 1963; year <= 1991; year += 1) {
    annualRates[year] = validatePublishedRate(
        levelRecords,
        rateRecords,
        'Früheres Bundesgebiet',
        ALL_PRIVATE_HOUSEHOLDS,
        year
    );
}
for (let year = 1992; year <= LONG_SERIES_LAST_YEAR; year += 1) {
    annualRates[year] = validatePublishedRate(
        levelRecords,
        rateRecords,
        'Deutschland',
        'Verbraucherpreisindex',
        year
    );
}
Object.assign(annualRates, currentTableRates);

const official1948Level = positiveNumber(
    destatisValue(
        levelRecords,
        'Früheres Bundesgebiet',
        FOUR_PERSON_MEDIUM_INCOME,
        1948,
        'Destatis former West Germany medium-income household CPI 1948 level'
    ),
    'Destatis former West Germany medium-income household CPI 1948 level'
);
const official1949Level = positiveNumber(
    destatisValue(
        levelRecords,
        'Früheres Bundesgebiet',
        FOUR_PERSON_MEDIUM_INCOME,
        1949,
        'Destatis former West Germany medium-income household CPI 1949 level'
    ),
    'Destatis former West Germany medium-income household CPI 1949 level'
);
const officialAlternative1949Rate = ((official1949Level / official1948Level) - 1) * 100;
const selected1949Rate = annualRates[1949];
const jstProxyNormalizationFactor = (
    JST_PROXY_REFERENCE_LEVEL
    / positiveNumber(
        germanJstCpi.get(JST_PROXY_REFERENCE_YEAR),
        `JST German CPI ${JST_PROXY_REFERENCE_YEAR}`
    )
);
const proxyRateResolutions = [];
for (let year = 1925; year <= 1948; year += 1) {
    const previousLevel = positiveNumber(germanJstCpi.get(year - 1), `JST German CPI ${year - 1}`);
    const currentLevel = positiveNumber(germanJstCpi.get(year), `JST German CPI ${year}`);
    const normalizedCurrentLevel = currentLevel * jstProxyNormalizationFactor;
    if (Math.abs(normalizedCurrentLevel - Math.round(normalizedCurrentLevel)) > 1e-6) {
        fail('Normalized JST proxy level should retain the documented integer quantization', {
            year,
            currentLevel,
            normalizedCurrentLevel
        });
    }
    proxyRateResolutions.push(100 / normalizedCurrentLevel);
}
const normalized1949Level = germanJstCpi.get(1949) * jstProxyNormalizationFactor;
if (Math.abs(normalized1949Level - Math.round(normalized1949Level)) <= 1e-6) {
    fail('Normalized JST 1949 splice endpoint should remain the documented non-integer level');
}
proxyRateResolutions.push(100 / normalized1949Level);

if (Object.keys(annualRates).length !== GRUND_END_YEAR - 1925 + 1) fail(`German CPI chain must contain ${GRUND_END_YEAR - 1925 + 1} annual rates`, {
    count: Object.keys(annualRates).length
});
for (let year = 1925; year <= GRUND_END_YEAR; year += 1) {
    if (!Number.isFinite(annualRates[year]) || !(annualRates[year] > -100)) {
        fail('German CPI annual rate is invalid', { year, value: annualRates[year] });
    }
}

const indexLevels = {};
let indexLevel = 100;
for (let year = 1925; year <= GRUND_END_YEAR; year += 1) {
    indexLevel = inflationKette.inflationIndexstand(indexLevel, annualRates[year]);
    if (!Number.isFinite(indexLevel) || !(indexLevel > 0)) {
        fail('German CPI synthetic index level is invalid', { year, indexLevel });
    }
    indexLevels[year] = indexLevel;
}
const priceChange1936To1948Pct = ((indexLevels[1948] / indexLevels[1935]) - 1) * 100;
const cpiImpliedPurchasingPowerLoss1936To1948Pct = (
    1 - (indexLevels[1935] / indexLevels[1948])
) * 100;

const sourceMetadata = Object.fromEntries(Object.entries(SOURCE_FILES).map(([sourceId, source]) => [
    sourceId,
    {
        fileName: path.basename(source.filePath),
        sha256: source.sha256,
        sourceUrl: source.sourceUrl,
        license: source.license,
        dataAsOf: source.dataAsOf
    }
]));
const rawDataHash = sha256Canonical(Object.fromEntries(
    Object.entries(sourceMetadata).map(([sourceId, source]) => [sourceId, source.sha256])
));
const grundbestand = {
    schemaVersion: 'GermanCpiResearchChainV1',
    revision: '2026-07-29.3',
    seriesId: 'german_consumer_price_inflation',
    unit: 'percent change from prior-year annual average',
    period: { startYear: 1925, endYear: GRUND_END_YEAR },
    base: { year: 1924, syntheticLevel: 100 },
    sourceFiles: sourceMetadata,
    rawDataHash,
    annualRateHash: sha256Canonical(annualRates),
    indexLevelHash: sha256Canonical(indexLevels),
    selectionRule: 'German national consumer-price concept only; Harmonised Index of Consumer Prices (HICP/HVPI) is excluded.',
    transitionRule: 'Every transition-year rate is taken from one internally consistent source series using its prior and current annual-average levels.',
    validation: {
        publishedRateVsRoundedLevelTolerancePp: DESTATIS_ROUNDED_LEVEL_RATE_TOLERANCE_PP
    },
    proxyQualification: {
        period: { startYear: 1925, endYear: 1949 },
        levelQuantization: {
            normalization: {
                referenceYear: JST_PROXY_REFERENCE_YEAR,
                referenceLevel: JST_PROXY_REFERENCE_LEVEL,
                factor: jstProxyNormalizationFactor
            },
            exactIntegerLevelPeriod: { startYear: 1925, endYear: 1948 },
            nonIntegerSpliceEndpointYear: 1949,
            normalizedSpliceEndpointLevel: normalized1949Level,
            impliedAnnualRateResolutionPp: {
                min: Math.min(...proxyRateResolutions),
                max: Math.max(...proxyRateResolutions)
            },
            interpretation: 'JST source levels for 1925-1948 are integer-quantized; derived annual rates therefore have materially coarser resolution than the 0.1 percentage-point official rates.'
        },
        historicalDiscontinuities: [
            {
                period: { startYear: 1936, endYear: 1948 },
                event: 'National Socialist price controls and wartime price freeze',
                interpretation: 'Near-zero measured changes are not evidence of an unrestricted market-price process.'
            },
            {
                year: 1949,
                event: 'Post-currency-reform JST splice endpoint',
                selectedJstRatePct: selected1949Rate,
                officialAlternative: {
                    sourceId: 'destatisLongSeries',
                    territory: 'Former West Germany',
                    populationConcept: FOUR_PERSON_MEDIUM_INCOME,
                    priorLevel1948: official1948Level,
                    currentLevel1949: official1949Level,
                    ratePct: officialAlternative1949Rate
                },
                differencePp: selected1949Rate - officialAlternative1949Rate,
                interpretation: 'The selected rate is a proxy splice across the 1948 currency reform, not an official estimate of unrestricted German consumer-price inflation.'
            }
        ],
        monetaryAssetDiscontinuity: {
            year: 1948,
            event: 'West German currency reform and write-down of major Reichsmark cash and bank/savings balances',
            balanceConversion: {
                reichsmark: 100,
                deutscheMark: 6.5,
                nominalBalanceLossPct: 93.5,
                scope: 'major holdings of cash and bank/savings balances after the October 1948 Festkontengesetz'
            },
            cpiProxyComparison: {
                period: { startYear: 1936, endYear: 1948 },
                cumulativePriceChangePct: priceChange1936To1948Pct,
                impliedPurchasingPowerLossPct: cpiImpliedPurchasingPowerLoss1936To1948Pct
            },
            reference: {
                publisher: 'Deutsche Bundesbank',
                title: 'Währungsreform 1948',
                url: 'https://www.bundesbank.de/de/aufgaben/themen/waehrungsreform-1948-614040'
            },
            interpretation: 'The CPI proxy measures observed price-level change, not the nominal write-down of monetary assets. It must not be used as a continuous-currency deflator for Reichsmark cash or bank balances across the reform.'
        }
    },
    segments: [
        {
            startYear: 1925,
            endYear: 1949,
            evidenceClass: 'proxy',
            territory: 'Germany',
            populationConcept: 'JST historical German CPI',
            sourceId: 'jst',
            construction: 'Annual percentage change calculated from consecutive JST R6 German CPI levels.'
        },
        {
            startYear: 1950,
            endYear: 1962,
            evidenceClass: 'official',
            populationQualifier: 'proxy_population',
            territory: 'Former West Germany',
            populationConcept: FOUR_PERSON_MEDIUM_INCOME,
            sourceId: 'destatisLongSeries',
            construction: 'Published Destatis annual change; checked against consecutive annual-average levels.'
        },
        {
            startYear: 1963,
            endYear: 1991,
            evidenceClass: 'official',
            territory: 'Former West Germany',
            populationConcept: ALL_PRIVATE_HOUSEHOLDS,
            sourceId: 'destatisLongSeries',
            construction: 'Published Destatis annual change; checked against consecutive annual-average levels.'
        },
        {
            startYear: 1992,
            endYear: LONG_SERIES_LAST_YEAR,
            evidenceClass: 'official',
            territory: 'Germany',
            populationConcept: 'Verbraucherpreisindex',
            sourceId: 'destatisLongSeries',
            construction: 'Published Destatis annual change; checked against consecutive annual-average levels.'
        },
        {
            startYear: LONG_SERIES_LAST_YEAR + 1,
            endYear: GRUND_END_YEAR,
            evidenceClass: 'official',
            territory: 'Germany',
            populationConcept: 'Verbraucherpreisindex',
            sourceId: 'destatisCurrent',
            construction: currentTableConstruction(LONG_SERIES_LAST_YEAR, GRUND_END_YEAR)
        }
    ],
    annualRates,
    indexLevels
};

// Jahre nach dem Grundbestand hängt dieselbe Fortschreibung an wie `npm run jahresdaten -- <Jahr> --uebernehmen`.
const chain = fortschreibungAnwenden(inflationKette, grundbestand, { root: PROJECT_ROOT, endYear: END_YEAR });
const [[, output]] = inflationKette.schreiben(chain);

if (VERIFY_ONLY) {
    if (!fs.existsSync(OUTPUT_PATH)) fail('Generated German CPI module is missing', {
        outputPath: OUTPUT_PATH
    });
    const committedOutput = fs.readFileSync(OUTPUT_PATH, 'utf8');
    if (committedOutput !== output) fail('Generated German CPI module is stale', {
        committedSha256: sha256(committedOutput),
        reconstructedSha256: sha256(output)
    });
    console.log('Verified German CPI originals and generated module without writing files.');
} else {
    fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
    console.log(`Generated ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}`);
}
console.log(`rawDataHash=${rawDataHash}`);
console.log(`annualRateHash=${chain.annualRateHash}`);
console.log(`indexLevelHash=${chain.indexLevelHash}`);
