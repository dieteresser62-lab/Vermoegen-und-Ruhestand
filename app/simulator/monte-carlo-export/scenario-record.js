/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */
import { requireObject, exportError } from './envelope.js';
import { SCENARIO_LOG_EXPORT_VERSION, SCENARIO_RECORD_TYPES } from './schema.js';
import { protocolAnnualTotals } from '../protocol-cashflows.js';
import { normalizeMonteCarloJsonValue } from '../monte-carlo-contracts.js';

/** @param {unknown} value */
function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** @param {ScenarioMeasurements} record
 * @param {{financiallyEvaluable:boolean;withdrawalRatesApplicable:boolean;minimumFlexApplicable:boolean}} options */
function buildScenarioMeasurementMissingness(record, {
    financiallyEvaluable,
    withdrawalRatesApplicable,
    minimumFlexApplicable
}) {
    const groups = {
        returnRatios: {
            applicable: financiallyEvaluable,
            values: [
                record.realReturnEquityRatio,
                record.realReturnGoldRatio,
                record.nominalReturnEquityRatio,
                record.nominalReturnGoldRatio
            ]
        },
        withdrawalRates: {
            applicable: withdrawalRatesApplicable,
            values: [record.realizedWithdrawalRatePct, record.preDecisionWithdrawalRatePct]
        },
        minimumFlex: {
            applicable: minimumFlexApplicable,
            values: [
                record.minimumFlexConfiguredAnnualEur,
                record.minimumFlexPolicyEffectiveAnnualEur,
                record.minimumFlexFulfilledAnnualEur
            ]
        }
    };
    return Object.fromEntries(Object.entries(groups).map(([key, group]) => {
        const observations = group.applicable
            ? group.values.filter(value => value !== null).length
            : 0;
        return [key, {
            reason: !financiallyEvaluable
                ? 'not_applicable_terminal_record'
                : !group.applicable
                    ? 'not_applicable_accumulation_year'
                    : observations === group.values.length
                        ? null
                        : 'source_value_unobserved',
            observationCount: { observations }
        }];
    }));
}

/** @param {ScenarioSourceRow} base */
function removeLegacyMinimumFlexCollision(base) {
    if (!base.entscheidung || typeof base.entscheidung !== 'object' || Array.isArray(base.entscheidung)
        || !base.entscheidung.details || typeof base.entscheidung.details !== 'object'
        || Array.isArray(base.entscheidung.details)) {
        return base;
    }
    const details = { ...base.entscheidung.details };
    delete details.minimumFlexEffectiveFinal;
    return {
        ...base,
        entscheidung: {
            ...base.entscheidung,
            details
        }
    };
}

/** @param {ScenarioSourceRow} row */
function resolveMinimumFlexPolicyValue(row) {
    return finiteOrNull(
        row.minimumFlexPolicyEffectiveAnnualEur
        ?? row.entscheidung?.details?.minimumFlexEffectiveFinal
    );
}

/** @param {ScenarioSourceRow} row
 * @param {number} index */
export function projectScenarioRecordV2(row, index) {
    requireObject(row, `records[${index}]`, SCENARIO_LOG_EXPORT_VERSION);
    if (!SCENARIO_RECORD_TYPES.has(row.recordType)) {
        throw exportError('SCENARIO_LOG_RECORD_TYPE_INVALID', `records[${index}].recordType is unsupported.`, SCENARIO_LOG_EXPORT_VERSION);
    }
    const financiallyEvaluable = row.recordType === 'financial_year';
    if (row.financiallyEvaluable !== financiallyEvaluable) {
        throw exportError('SCENARIO_LOG_FINANCIAL_APPLICABILITY_INVALID', `records[${index}].financiallyEvaluable conflicts with recordType.`, SCENARIO_LOG_EXPORT_VERSION);
    }
    const accumulationYear = financiallyEvaluable && row.Regime === 'accumulation';
    const withdrawalRatesApplicable = financiallyEvaluable && !accumulationYear;
    const minimumFlexApplicable = financiallyEvaluable && !accumulationYear;
    let base = { ...row };
    for (const field of [
        'RealReturnEquityPct',
        'RealReturnGoldPct',
        'NominalReturnEquityPct',
        'NominalReturnGoldPct',
        'entnahmequote',
        'QuoteEndPct',
        'minimumFlexAnnual',
        'minimumFlexEffectiveBefore',
        'minimumFlexEffectiveAfter',
        'minimumFlexEffectiveFinal',
        'minimumFlexPolicyEffectiveAnnualEur',
        'minimumFlexFulfilledAnnualEur',
        'financiallyEvaluable'
    ]) delete base[field];
    base = removeLegacyMinimumFlexCollision(base);
    const record = /** @type {Record<string,unknown> & ScenarioMeasurements & {recordType:string;financiallyEvaluable:boolean;measurementMissingness?:ScenarioExportRow['measurementMissingness']}} */ ({
        ...base,
        ...protocolAnnualTotals(row),
        recordType: row.recordType,
        financiallyEvaluable,
        realReturnEquityRatio: financiallyEvaluable ? finiteOrNull(row.RealReturnEquityPct) : null,
        realReturnGoldRatio: financiallyEvaluable ? finiteOrNull(row.RealReturnGoldPct) : null,
        nominalReturnEquityRatio: financiallyEvaluable ? finiteOrNull(row.NominalReturnEquityPct) : null,
        nominalReturnGoldRatio: financiallyEvaluable ? finiteOrNull(row.NominalReturnGoldPct) : null,
        realizedWithdrawalRatePct: withdrawalRatesApplicable && finiteOrNull(row.entnahmequote) !== null
            ? /** @type {number} */ (row.entnahmequote) * 100
            : null,
        preDecisionWithdrawalRatePct: withdrawalRatesApplicable ? finiteOrNull(row.QuoteEndPct) : null,
        minimumFlexConfiguredAnnualEur: minimumFlexApplicable ? finiteOrNull(row.minimumFlexAnnual) : null,
        minimumFlexPolicyEffectiveAnnualEur: minimumFlexApplicable
            ? resolveMinimumFlexPolicyValue(row)
            : null,
        minimumFlexFulfilledAnnualEur: minimumFlexApplicable
            ? finiteOrNull(row.minimumFlexFulfilledAnnualEur ?? row.minimumFlexEffectiveFinal)
            : null
    });
    record.measurementMissingness = buildScenarioMeasurementMissingness(record, {
        financiallyEvaluable,
        withdrawalRatesApplicable,
        minimumFlexApplicable
    });
    return normalizeMonteCarloJsonValue(/** @type {ScenarioExportRow} */ (record), { path: `$.records[${index}]` });
}
