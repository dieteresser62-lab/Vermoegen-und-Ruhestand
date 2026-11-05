/** @import {ExportBuildOptions,ExportV1,ExportV2,ExportReadOptions,ScenarioSourceRow,ScenarioExportRow,ScenarioMeasurements,ScenarioLogDocument,PersonDataContext} from '../../../typcheck/rechenkern' */
import { SCENARIO_LOG_UNIT_CONTRACT_VERSION, SCENARIO_LOG_EXPORT_VERSION, SCENARIO_RECORD_TYPES } from './schema.js';
import { exportError, requireObject, requireString } from './envelope.js';
import { freezePersonDataContext, validatePersonDataContext } from '../simulator-person-overrides.js';
import { projectScenarioRecordV2 } from './scenario-record.js';
import { deepFreezeMonteCarloContract, normalizeMonteCarloJsonValue } from '../monte-carlo-contracts.js';

function createScenarioLogUnitContractV2() {
    return {
        schemaVersion: SCENARIO_LOG_UNIT_CONTRACT_VERSION,
        ratioFields: {
            realReturnEquityRatio: 'unitless_ratio',
            realReturnGoldRatio: 'unitless_ratio',
            nominalReturnEquityRatio: 'unitless_ratio',
            nominalReturnGoldRatio: 'unitless_ratio'
        },
        percentagePointFields: {
            realizedWithdrawalRatePct: {
                numerator: 'actual_effective_annual_withdrawal',
                denominator: 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket',
                measurementTime: 'after_policy_transaction_and_actual_payout'
            },
            preDecisionWithdrawalRatePct: {
                numerator: 'preliminary_withdrawal_based_on_previous_year_flex_rate',
                denominator: 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket',
                measurementTime: 'before_transaction_and_payout',
                description: 'vorlaeufige Entnahme auf Basis der Vorjahres-Flexrate, vor Transaktions- und Auszahlungsphase; Nenner Depot ohne Liquiditaet und Health-Bucket'
            }
        },
        annualMoneyFields: {
            flex_wunsch_haushalt_nominal: 'nominal_eur_per_year_desired_household_flex',
            flex_haushalt_erfuellt: 'nominal_eur_per_year_paid_household_flex_including_pension',
            minimumFlexConfiguredAnnualEur: 'nominal_eur_per_year',
            minimumFlexPolicyEffectiveAnnualEur: 'nominal_eur_per_year_after_policy',
            minimumFlexFulfilledAnnualEur: 'nominal_eur_per_year_actual_fulfilment'
        },
        minimumFlexRestriction: {
            flag: 'flex_unter_mindestflex', comparison: 'paid_household_flex_lt_applied_positive_minimum',
            population: 'completed_decumulation_years', priceBasis: 'nominal',
            appliedMinimumField: 'minimumFlexConfiguredAnnualEur'
        },
        terminalRecordPolicy: 'financial_measurements_null_with_reason_and_observation_count'
    };
}

/** @param {ScenarioSourceRow[]} rows
 * @param {{personDataContext?:PersonDataContext|null}} options
 * @returns {ScenarioLogDocument} */
export function projectScenarioLogV2(rows, { personDataContext = null } = {}) {
    if (!Array.isArray(rows)) {
        throw exportError('SCENARIO_LOG_ROWS_INVALID', 'rows must be an array.', SCENARIO_LOG_EXPORT_VERSION);
    }
    const document = {
        schemaVersion: SCENARIO_LOG_EXPORT_VERSION,
        unitContract: createScenarioLogUnitContractV2(),
        materializationContract: {
            scope: 'single_selected_scenario_path',
            input: 'already_materialized_and_request_horizon_bounded',
            streaming: false
        },
        ...(personDataContext ? { personDataContext: freezePersonDataContext(validatePersonDataContext(personDataContext)) } : {}),
        records: rows.map(projectScenarioRecordV2)
    };
    validateScenarioLogExportV2(document);
    return deepFreezeMonteCarloContract(document);
}

/** @param {ScenarioLogDocument} document */
export function validateScenarioLogExportV2(document) {
    validatePersonDataContext(document?.personDataContext);
    requireObject(document, 'document', SCENARIO_LOG_EXPORT_VERSION);
    if (document.schemaVersion !== SCENARIO_LOG_EXPORT_VERSION) {
        throw exportError('SCENARIO_LOG_VERSION_UNSUPPORTED', `Unsupported schemaVersion ${String(document.schemaVersion)}.`, SCENARIO_LOG_EXPORT_VERSION);
    }
    const unitContract = document.unitContract;
    if (unitContract?.schemaVersion !== SCENARIO_LOG_UNIT_CONTRACT_VERSION
        || unitContract.ratioFields?.realReturnEquityRatio !== 'unitless_ratio'
        || unitContract.ratioFields?.realReturnGoldRatio !== 'unitless_ratio'
        || unitContract.ratioFields?.nominalReturnEquityRatio !== 'unitless_ratio'
        || unitContract.ratioFields?.nominalReturnGoldRatio !== 'unitless_ratio'
        || unitContract.percentagePointFields?.realizedWithdrawalRatePct?.numerator !== 'actual_effective_annual_withdrawal'
        || unitContract.percentagePointFields?.realizedWithdrawalRatePct?.denominator !== 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket'
        || unitContract.percentagePointFields?.realizedWithdrawalRatePct?.measurementTime !== 'after_policy_transaction_and_actual_payout'
        || unitContract.percentagePointFields?.preDecisionWithdrawalRatePct?.numerator !== 'preliminary_withdrawal_based_on_previous_year_flex_rate'
        || unitContract.percentagePointFields?.preDecisionWithdrawalRatePct?.denominator !== 'equity_bond_and_gold_tranches_excluding_liquidity_and_health_bucket'
        || unitContract.percentagePointFields?.preDecisionWithdrawalRatePct?.measurementTime !== 'before_transaction_and_payout'
        || unitContract.percentagePointFields?.preDecisionWithdrawalRatePct?.description !== 'vorlaeufige Entnahme auf Basis der Vorjahres-Flexrate, vor Transaktions- und Auszahlungsphase; Nenner Depot ohne Liquiditaet und Health-Bucket'
        || unitContract.annualMoneyFields?.minimumFlexConfiguredAnnualEur !== 'nominal_eur_per_year'
        || unitContract.annualMoneyFields?.minimumFlexPolicyEffectiveAnnualEur !== 'nominal_eur_per_year_after_policy'
        || unitContract.annualMoneyFields?.minimumFlexFulfilledAnnualEur !== 'nominal_eur_per_year_actual_fulfilment'
        || unitContract.terminalRecordPolicy !== 'financial_measurements_null_with_reason_and_observation_count') {
        throw exportError('SCENARIO_LOG_UNIT_CONTRACT_INVALID', 'unitContract is missing or incompatible.', SCENARIO_LOG_EXPORT_VERSION);
    }
    if (document.materializationContract?.scope !== 'single_selected_scenario_path'
        || document.materializationContract?.input !== 'already_materialized_and_request_horizon_bounded'
        || document.materializationContract?.streaming !== false) {
        throw exportError('SCENARIO_LOG_MATERIALIZATION_CONTRACT_INVALID', 'materializationContract is missing or incompatible.', SCENARIO_LOG_EXPORT_VERSION);
    }
    if (!Array.isArray(document.records)) {
        throw exportError('SCENARIO_LOG_RECORDS_INVALID', 'records must be an array.', SCENARIO_LOG_EXPORT_VERSION);
    }
    for (const [index, record] of document.records.entries()) {
        requireObject(record, `records[${index}]`, SCENARIO_LOG_EXPORT_VERSION);
        if (!SCENARIO_RECORD_TYPES.has(record.recordType)
            || record.financiallyEvaluable !== (record.recordType === 'financial_year')) {
            throw exportError('SCENARIO_LOG_RECORD_TYPE_INVALID', `records[${index}] has an invalid type or applicability.`, SCENARIO_LOG_EXPORT_VERSION);
        }
        for (const field of [
            'realReturnEquityRatio',
            'realReturnGoldRatio',
            'nominalReturnEquityRatio',
            'nominalReturnGoldRatio',
            'realizedWithdrawalRatePct',
            'preDecisionWithdrawalRatePct',
            'minimumFlexConfiguredAnnualEur',
            'minimumFlexPolicyEffectiveAnnualEur',
            'minimumFlexFulfilledAnnualEur'
        ]) {
            const value = record[field];
            if (value !== null && !Number.isFinite(value)) {
                throw exportError('SCENARIO_LOG_MEASUREMENT_INVALID', `records[${index}].${field} must be finite or null.`, SCENARIO_LOG_EXPORT_VERSION);
            }
            if (!record.financiallyEvaluable && value !== null) {
                throw exportError('SCENARIO_LOG_TERMINAL_MEASUREMENT_INVALID', `records[${index}].${field} must be null for terminal records.`, SCENARIO_LOG_EXPORT_VERSION);
            }
        }
        const measurementMissingness = requireObject(record.measurementMissingness, `records[${index}].measurementMissingness`, SCENARIO_LOG_EXPORT_VERSION);
        const accumulationYear = record.financiallyEvaluable && record.Regime === 'accumulation';
        const measurementGroups = {
            returnRatios: {
                applicable: record.financiallyEvaluable,
                values: [
                    record.realReturnEquityRatio,
                    record.realReturnGoldRatio,
                    record.nominalReturnEquityRatio,
                    record.nominalReturnGoldRatio
                ]
            },
            withdrawalRates: {
                applicable: record.financiallyEvaluable && !accumulationYear,
                values: [record.realizedWithdrawalRatePct, record.preDecisionWithdrawalRatePct]
            },
            minimumFlex: {
                applicable: record.financiallyEvaluable && !accumulationYear,
                values: [
                    record.minimumFlexConfiguredAnnualEur,
                    record.minimumFlexPolicyEffectiveAnnualEur,
                    record.minimumFlexFulfilledAnnualEur
                ]
            }
        };
        for (const [group, measurement] of Object.entries(measurementGroups)) {
            const state = requireObject(measurementMissingness[group], `records[${index}].measurementMissingness.${group}`, SCENARIO_LOG_EXPORT_VERSION);
            if (state.reason !== null) {
                requireString(state.reason, `records[${index}].measurementMissingness.${group}.reason`, SCENARIO_LOG_EXPORT_VERSION);
            }
            const count = state?.observationCount?.observations;
            if (!Number.isSafeInteger(count) || count < 0) {
                throw exportError('SCENARIO_LOG_OBSERVATION_COUNT_INVALID', `records[${index}].measurementMissingness.${group} has an invalid count.`, SCENARIO_LOG_EXPORT_VERSION);
            }
            if (!record.financiallyEvaluable
                && (state.reason !== 'not_applicable_terminal_record' || count !== 0)) {
                throw exportError('SCENARIO_LOG_TERMINAL_MISSINGNESS_INVALID', `records[${index}].measurementMissingness.${group} is inconsistent.`, SCENARIO_LOG_EXPORT_VERSION);
            }
            if (record.financiallyEvaluable && !measurement.applicable) {
                if (measurement.values.some(value => value !== null)
                    || state.reason !== 'not_applicable_accumulation_year' || count !== 0) {
                    throw exportError('SCENARIO_LOG_ACCUMULATION_MISSINGNESS_INVALID', `records[${index}].measurementMissingness.${group} is inconsistent.`, SCENARIO_LOG_EXPORT_VERSION);
                }
            } else if (record.financiallyEvaluable) {
                const expectedCount = measurement.values.filter(value => value !== null).length;
                const expectedReason = expectedCount === measurement.values.length ? null : 'source_value_unobserved';
                if (count !== expectedCount || state.reason !== expectedReason) {
                    throw exportError('SCENARIO_LOG_MISSINGNESS_INVALID', `records[${index}].measurementMissingness.${group} is inconsistent with its measurements.`, SCENARIO_LOG_EXPORT_VERSION);
                }
            }
        }
    }
    normalizeMonteCarloJsonValue(document, { path: '$.scenarioLog' });
    return document;
}
