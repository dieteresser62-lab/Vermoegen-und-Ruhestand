/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */
import { validateScenarioLogExportV2 } from './scenario-log.js';
import { canonicalizeHistoricalContractValue } from '../historical-backtest-contract.js';
import { personDataCsvFields } from '../simulator-person-overrides.js';
import { protocolAnnualTotals } from '../protocol-cashflows.js';
import { normalizeSource, exportError } from './envelope.js';
import { SCENARIO_LOG_EXPORT_VERSION, SCENARIO_V1_WARNING_CODES } from './schema.js';
import { deepFreezeMonteCarloContract } from '../monte-carlo-contracts.js';

/** @param {ScenarioLogDocument} document */
export function serializeScenarioLogExportV2(document) {
    validateScenarioLogExportV2(document);
    return JSON.stringify(JSON.parse(canonicalizeHistoricalContractValue(document)), null, 2);
}

/** @param {unknown} value */
function csvCellV2(value) {
    let text;
    if (value === null || value === undefined) text = '';
    else if (typeof value === 'object') text = canonicalizeHistoricalContractValue(value);
    else text = String(value);
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** @param {ScenarioLogDocument} document */
export function serializeScenarioLogCsvV2(document) {
    validateScenarioLogExportV2(document);
    const rows = /** @type {Record<string,unknown>[]} */ (document.records.map(record => ({
        ...Object.fromEntries(Object.entries(record).filter(([key]) => !['einnahmen_gesamt', 'ausgaben_gesamt'].includes(key))),
        ...(typeof record.aktionUndGrund === 'string' ? { aktionUndGrund: record.aktionUndGrund.replaceAll('Bonds Auffüllen', 'Anleihen auffüllen') } : {}),
        ...personDataCsvFields(document.personDataContext),
        scenarioLogSchemaVersion: document.schemaVersion,
        unitContractVersion: document.unitContract.schemaVersion
    })));
    const hasHomes = document.records.some(record => Object.hasOwn(record, 'immobilien_wert_end'));
    const headers = [...new Set([...rows.flatMap(row => Object.keys(row)), ...Object.keys(personDataCsvFields(document.personDataContext))])]
        .filter(key => !['immobilien_wert_end', 'immobilien_selbst_end', 'immobilien_vermietet_end'].includes(key)).sort();
    headers.push('Einnahmen', 'Ausgaben');
    if (hasHomes) headers.push('Immobilien', 'Gesamtvermögen');
    rows.forEach((row, index) => {
        const record = document.records[index], totals = protocolAnnualTotals(record);
        row.Einnahmen = record.einnahmen_gesamt ?? totals.einnahmen_gesamt;
        row.Ausgaben = record.ausgaben_gesamt ?? totals.ausgaben_gesamt;
        if (hasHomes) {
            row.Immobilien = record.immobilien_wert_end;
            row.Gesamtvermögen = Number.isFinite(record.portfolio_total_end) && Number.isFinite(record.immobilien_wert_end)
                ? record.portfolio_total_end + record.immobilien_wert_end : null;
        }
    });
    return [
        headers.map(csvCellV2).join(';'),
        ...rows.map(row => headers.map(header => csvCellV2(row[header])).join(';'))
    ].join('\r\n');
}

/** @param {string|ScenarioLogDocument|Record<string,unknown>[]} source */
export function readScenarioLogExport(source) {
    const parsed = normalizeSource(source, 'SCENARIO_LOG_JSON_INVALID', SCENARIO_LOG_EXPORT_VERSION);
    if (Array.isArray(parsed)) {
        return deepFreezeMonteCarloContract({
            document: {
                schemaVersion: 'ScenarioLogV1Unversioned',
                records: parsed
            },
            compatibilityWarnings: SCENARIO_V1_WARNING_CODES.map(code => ({ code }))
        });
    }
    if (parsed?.schemaVersion === SCENARIO_LOG_EXPORT_VERSION) {
        validateScenarioLogExportV2(parsed);
        return deepFreezeMonteCarloContract({ document: parsed, compatibilityWarnings: [] });
    }
    throw exportError('SCENARIO_LOG_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(/** @type {{schemaVersion?:unknown}} */ (parsed)?.schemaVersion)}.`, SCENARIO_LOG_EXPORT_VERSION);
}
