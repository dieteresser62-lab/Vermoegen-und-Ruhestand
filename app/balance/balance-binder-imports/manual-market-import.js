// @ts-check
import { createAnnualPeriodId, resolveAnnualTargetYear } from '../balance-annual-period.js';
import { appNow } from '../../shared/app-clock.js';
import { failMarketCsv, isRecord, cloneJson } from './validation-core.js';
import { parseIsoDateOnly, isValidManualCoverage, buildManualWindowHighEngineReference } from './market-provenance.js';
import { ANNUAL_MARKET_DATA_SCHEMA_VERSION } from '../balance-annual-marketdata.js';

function yearFromPeriodId(periodId) {
    const match = /^calendar-year:(\d{4})$/.exec(String(periodId || ''));
    if (!match) return null;
    const year = Number(match[1]);
    return createAnnualPeriodId(year) === periodId ? year : null;
}

/**
 * @param state Eingabe für die bestehende Projektion.
 * @param referenceDate Eingabe für die bestehende Projektion.
 * @returns Ergebnis der bestehenden Operation.
 */
export function resolveCurrentMarketCsvTargetYear(state = {}, referenceDate = appNow()) {
    const pendingYear = yearFromPeriodId(state?.annualPeriodMetadata?.pendingCommit?.periodId);
    if (Number.isInteger(pendingYear)) return pendingYear;
    return resolveAnnualTargetYear(referenceDate, state.annualPeriodMetadata);
}

function normalizeInstrument(value) {
    const instrument = String(value || '').trim().toUpperCase();
    if (!/^[A-Z0-9^._=-]{1,32}$/.test(instrument)) {
        failMarketCsv(
            'market_csv_instrument_invalid',
            'Das Instrument muss explizit angegeben werden und darf nur Tickerzeichen enthalten.'
        );
    }
    return instrument;
}

function normalizeSourceFileName(value) {
    const normalized = String(value || '')
        .split(/[\\/]/)
        .at(-1)
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 200);
    if (!normalized) {
        failMarketCsv('market_csv_source_missing', 'Der CSV-Dateiname fehlt als Quellenangabe.');
    }
    return normalized;
}

/**
 * Bindet einen bereits DOM-frei geparsten CSV-Payload an seinen expliziten
 * Importkontext. Die Funktion erzeugt noch keinen Storage- oder DOM-Write.
 */
/**
 * @param parsed Eingabe für die bestehende Projektion.
 * @param options2 Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
/** @param parsed Geprüfte CSV-Reihe. @param {{mode?: string, targetYear?: number, expectedAsOf?: string, instrument?: string, sourceFileName?: string, currentPeriodYear?: number, importedAt?: string}} [options] @returns Vorbereiteter CSV-Import. */
export function createManualMarketCsvImportPlan(parsed, {
    mode,
    targetYear,
    expectedAsOf,
    instrument,
    sourceFileName,
    currentPeriodYear,
    importedAt = new Date().toISOString()
} = {}) {
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.values)) {
        failMarketCsv('market_csv_payload_invalid', 'Der normalisierte Markt-CSV-Payload ist ungültig.');
    }
    if (mode !== 'current' && mode !== 'historical') {
        failMarketCsv(
            'market_csv_mode_invalid',
            'Bitte den CSV-Modus ausdrücklich als aktuell oder historisch wählen.'
        );
    }
    if (!Number.isInteger(targetYear) || !createAnnualPeriodId(targetYear)) {
        failMarketCsv('market_csv_target_period_invalid', 'Die CSV-Zielperiode muss ein gültiges vierstelliges Kalenderjahr sein.');
    }
    if (!Number.isInteger(currentPeriodYear) || !createAnnualPeriodId(currentPeriodYear)) {
        failMarketCsv('market_csv_current_period_invalid', 'Die aktuell erwartete Planperiode konnte nicht bestimmt werden.');
    }
    if (mode === 'current' && targetYear !== currentPeriodYear) {
        failMarketCsv(
            'market_csv_period_mismatch',
            `Eine aktuelle CSV muss die erwartete Planperiode ${currentPeriodYear} adressieren.`,
            { targetYear, currentPeriodYear }
        );
    }
    if (mode === 'historical' && targetYear >= currentPeriodYear) {
        failMarketCsv(
            'market_csv_historical_period_invalid',
            `Der historische Modus erfordert eine Zielperiode vor ${currentPeriodYear}.`,
            { targetYear, currentPeriodYear }
        );
    }

    const expectedDate = parseIsoDateOnly(expectedAsOf);
    if (!expectedDate || expectedDate.getUTCFullYear() !== targetYear) {
        failMarketCsv(
            'market_csv_expected_asof_invalid',
            'Der erwartete ISO-Stichtag muss vollständig sein und in der Zielperiode liegen.'
        );
    }
    if (parsed.asOf !== expectedAsOf) {
        failMarketCsv(
            'market_csv_asof_mismatch',
            `Der letzte CSV-Datenpunkt ${parsed.asOf || 'unbekannt'} stimmt nicht mit dem erwarteten Stichtag ${expectedAsOf} überein.`,
            { actualAsOf: parsed.asOf || null, expectedAsOf }
        );
    }
    if (new Date(`${parsed.asOf}T00:00:00.000Z`).getUTCFullYear() !== targetYear) {
        failMarketCsv(
            'market_csv_period_mismatch',
            `Der letzte CSV-Datenpunkt gehört nicht zur Zielperiode ${targetYear}.`
        );
    }
    if (
        !isRecord(parsed.coverage) ||
        !isValidManualCoverage(parsed.coverage, targetYear, parsed.asOf) ||
        parsed.coverage.rowCount !== parsed.rowCount
    ) {
        failMarketCsv('market_csv_coverage_invalid', 'Die CSV-Periodenabdeckung ist inkonsistent.');
    }
    if (
        !isRecord(parsed.high) ||
        parsed.high.scope !== 'windowHigh' ||
        parsed.high.verifiedAllTimeHighAvailable !== false ||
        !Number.isFinite(parsed.high.value) ||
        !parseIsoDateOnly(parsed.high.asOf)
    ) {
        failMarketCsv('market_csv_high_scope_invalid', 'Die manuelle CSV darf nur ein validiertes windowHigh liefern.');
    }
    if (typeof importedAt !== 'string' || !Number.isFinite(Date.parse(importedAt))) {
        failMarketCsv('market_csv_import_time_invalid', 'Der CSV-Importzeitpunkt ist ungültig.');
    }

    const normalizedInstrument = normalizeInstrument(instrument);
    const normalizedSourceFileName = normalizeSourceFileName(sourceFileName);
    const periodId = createAnnualPeriodId(targetYear);
    const engineReference = buildManualWindowHighEngineReference(
        parsed.values.endeVJ,
        parsed.high
    );
    const engineValues = {
        endeVJ: parsed.values.endeVJ,
        endeVJ_1: parsed.values.endeVJ_1,
        endeVJ_2: parsed.values.endeVJ_2,
        endeVJ_3: parsed.values.endeVJ_3,
        // D-13: Das Fensterhoch traegt nur als gerichtete Untergrenze. Ein
        // positiver Fensterabstand belegt mindestens diesen Drawdown; bei
        // windowHigh === aktuellem Kurs bleibt das ATH dagegen unbekannt.
        ath: engineReference.applied ? engineReference.value : 0,
        jahreSeitAth: engineReference.applied ? engineReference.yearsSince : 0
    };
    Object.entries(engineValues).forEach(([field, value]) => {
        if (!Number.isFinite(value) || value < 0) {
            failMarketCsv('market_csv_engine_values_invalid', `Das normalisierte Marktdatenfeld ${field} ist ungültig.`);
        }
    });

    return {
        schemaVersion: 1,
        mode,
        targetYear,
        expectedAsOf,
        periodId,
        engineValues,
        provenance: {
            schemaVersion: ANNUAL_MARKET_DATA_SCHEMA_VERSION,
            acquisitionMode: 'manual_csv',
            periodMode: mode,
            periodId,
            targetYear,
            price: engineValues.endeVJ,
            asOf: parsed.asOf,
            ticker: normalizedInstrument,
            instrument: normalizedInstrument,
            source: `Manuelle CSV: ${normalizedSourceFileName}`,
            sourceType: 'manual_csv',
            sourceFileName: normalizedSourceFileName,
            importedAt: new Date(importedAt).toISOString(),
            coverage: cloneJson(parsed.coverage),
            highScope: 'windowHigh',
            high: cloneJson(parsed.high),
            engineReference,
            ath: {
                value: null,
                yearsSince: null,
                evaluatedAsOf: parsed.asOf,
                lastHighAsOf: null,
                scope: 'unavailable_manual_window',
                engineAvailable: false
            }
        }
    };
}
