// @ts-check
import { isRecord, failImport } from './validation-core.js';
import { MANUAL_WINDOW_HIGH_ENGINE_POLICY, ANNUAL_MARKET_READINGS } from './schema.js';
import { ANNUAL_MARKET_DATA_SCHEMA_VERSION } from '../balance-annual-marketdata.js';
import { createAnnualPeriodId } from '../balance-annual-period.js';

export function parseIsoDateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    return date;
}

export function isValidManualCoverage(coverage, targetYear, asOf) {
    if (!isRecord(coverage)) return false;
    const start = parseIsoDateOnly(coverage.start);
    const end = parseIsoDateOnly(coverage.end);
    if (
        !start ||
        !end ||
        start.getTime() > end.getTime() ||
        coverage.end !== asOf ||
        !Number.isInteger(coverage.rowCount) ||
        coverage.rowCount < 4 ||
        !Array.isArray(coverage.calendarYears)
    ) {
        return false;
    }
    const years = coverage.calendarYears;
    if (
        years.length < 4 ||
        years.some((year, index) => (
            !Number.isInteger(year) ||
            year < 1900 ||
            year > 9999 ||
            (index > 0 && year <= years[index - 1])
        ))
    ) {
        return false;
    }
    return [targetYear - 3, targetYear - 2, targetYear - 1, targetYear]
        .every(year => years.includes(year));
}

export function buildManualWindowHighEngineReference(price, high) {
    const applied = (
        typeof price === 'number' &&
        Number.isFinite(price) &&
        typeof high?.value === 'number' &&
        Number.isFinite(high.value) &&
        high.value > price
    );
    return {
        policy: MANUAL_WINDOW_HIGH_ENGINE_POLICY,
        sourceScope: 'windowHigh',
        applied,
        value: applied ? high.value : null,
        yearsSince: applied ? high.yearsSince : null
    };
}

export function validateAnnualMarketDataMeta(meta) {
    if (meta === undefined) return;
    if (!isRecord(meta) || meta.schemaVersion !== ANNUAL_MARKET_DATA_SCHEMA_VERSION) {
        failImport('invalid_market_provenance', 'Die Marktdaten-Provenienz besitzt kein unterstütztes Schema.');
    }
    const periodId = createAnnualPeriodId(meta.targetYear);
    if (!periodId || meta.periodId !== periodId) {
        failImport('invalid_market_provenance', 'Zieljahr und Perioden-ID der Marktdaten-Provenienz widersprechen sich.');
    }
    const asOf = parseIsoDateOnly(meta.asOf);
    if (!asOf || asOf.getUTCFullYear() !== meta.targetYear) {
        failImport('invalid_market_provenance', 'Der Marktdaten-Stichtag passt nicht zur Zielperiode.');
    }
    if (
        typeof meta.price !== 'number' ||
        !Number.isFinite(meta.price) ||
        meta.price < 0 ||
        typeof meta.source !== 'string' ||
        meta.source.trim() === '' ||
        typeof (meta.instrument || meta.ticker) !== 'string' ||
        String(meta.instrument || meta.ticker).trim() === ''
    ) {
        failImport('invalid_market_provenance', 'Preis, Quelle oder Instrument der Marktdaten-Provenienz sind ungültig.');
    }
    if (meta.sourceType === 'manual_csv') {
        const expectedEngineReference = buildManualWindowHighEngineReference(meta.price, meta.high);
        if (
            meta.acquisitionMode !== 'manual_csv' ||
            !['current', 'historical'].includes(meta.periodMode) ||
            typeof meta.sourceFileName !== 'string' ||
            meta.sourceFileName.trim() === ''
        ) {
            failImport('invalid_market_provenance', 'Modus oder Quelle der CSV-Provenienz ist ungültig.');
        }
        if (!isValidManualCoverage(meta.coverage, meta.targetYear, meta.asOf)) {
            failImport('invalid_market_provenance', 'Die CSV-Periodenabdeckung ist ungültig.');
        }
        if (
            meta.highScope !== 'windowHigh' ||
            meta.high?.scope !== 'windowHigh' ||
            meta.high?.verifiedAllTimeHighAvailable !== false ||
            typeof meta.high?.value !== 'number' ||
            !Number.isFinite(meta.high.value) ||
            meta.high.value <= 0 ||
            !parseIsoDateOnly(meta.high?.asOf) ||
            meta.high.asOf < meta.coverage.start ||
            meta.high.asOf > meta.coverage.end ||
            !Number.isInteger(meta.high?.yearsSince) ||
            meta.high.yearsSince < 0 ||
            meta.ath?.value !== null ||
            meta.ath?.yearsSince !== null ||
            meta.ath?.evaluatedAsOf !== meta.asOf ||
            meta.ath?.lastHighAsOf !== null ||
            meta.ath?.scope !== 'unavailable_manual_window' ||
            meta.ath?.engineAvailable !== false ||
            meta.engineReference?.policy !== MANUAL_WINDOW_HIGH_ENGINE_POLICY ||
            meta.engineReference?.sourceScope !== 'windowHigh' ||
            meta.engineReference?.applied !== expectedEngineReference.applied ||
            meta.engineReference?.value !== expectedEngineReference.value ||
            meta.engineReference?.yearsSince !== expectedEngineReference.yearsSince
        ) {
            failImport(
                'invalid_market_provenance',
                'Eine manuelle CSV darf ohne Vollhistoriennachweis nur windowHigh als konservative ATH-Untergrenze verwenden.'
            );
        }
        if (typeof meta.importedAt !== 'string' || !Number.isFinite(Date.parse(meta.importedAt))) {
            failImport('invalid_market_provenance', 'Der CSV-Importzeitpunkt ist ungültig.');
        }
    }
    if (meta.ath?.reading !== undefined && !ANNUAL_MARKET_READINGS.includes(meta.ath.reading)) {
        failImport('invalid_market_provenance', 'Die Lesart des Hochs ist ungültig.');
    }
    if (meta.ath?.reading === 'year_high' && (meta.sourceType === 'manual_csv'
        || !Number.isFinite(meta.ath.value) || meta.ath.value <= meta.price
        || !Number.isFinite(meta.ath.yearsSince) || meta.ath.yearsSince <= 0
        || !parseIsoDateOnly(meta.ath.lastHighAsOf) || meta.ath.lastHighAsOf < `${meta.targetYear - 1}-12-31`
        || meta.ath.lastHighAsOf >= meta.asOf || meta.ath.evaluatedAsOf !== meta.asOf)) {
        failImport('invalid_market_provenance', 'Das gewählte Jahreshoch oder seine Datierung ist ungültig.');
    }
}
