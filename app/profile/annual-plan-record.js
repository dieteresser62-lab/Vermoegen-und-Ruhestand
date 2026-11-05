/** @import * as D from "../../typcheck/datenvertraege.js" */
/** @import * as I from "../../typcheck/speicher-integration.js" */
import { persistenceStorage } from '../shared/persistence-facade.js';
import { assertPlanScope, assertPlanValues, PLAN_FIELD_PATHS, PLAN_DEFAULTS, plain } from './household-plan.js';

export const ANNUAL_PLAN_RECORD_KEY = 'annual_plan_record_v1';
/** @param {number} year @param {D.PlanScope} scope */
export const annualPlanEntryKey = (year, scope) => JSON.stringify([year, scope.key]);
/** @param {unknown} value @returns {value is string} */
const text = value => typeof value === 'string' && Boolean(value.trim());
/** @param {unknown} value @returns {value is number} */
const finite = value => typeof value === 'number' && Number.isFinite(value);
/**
 * @param {unknown} value
 * @returns {void}
 */
function assertJson(value) {
    if (typeof value === 'number' && !finite(value) || value === undefined || typeof value === 'function') throw new Error('Jahresbeleg enthält ungültige Ergebniswerte.');
    if (value && typeof value === 'object') Object.values(value).forEach(assertJson);
}
/** Euro/Monat, Liquiditätsdeckung und Flex-Rate in Prozent wie im Balance-Ergebnis. */
/**
 * @param {D.AnnualOutcome} outcome
 * @returns {void}
 */
function assertOutcome(outcome) {
    if (!plain(outcome) || !finite(outcome.monthlyWithdrawal) || outcome.monthlyWithdrawal < 0
        || !finite(outcome.monthlyBudget) || outcome.monthlyBudget < 0
        || !finite(outcome.liquidityBefore) || outcome.liquidityBefore < 0
        || !finite(outcome.liquidityAfter) || outcome.liquidityAfter < 0
        || !finite(outcome.flexRate) || outcome.flexRate < 0 || !text(outcome.marketPhase)
        || !plain(outcome.action) || !['NONE', 'TRANSACTION'].includes(outcome.action.type)
        || !text(outcome.action.title)) throw new Error('Jahresbeleg: Ergebnis oder vollständige Handlungsanweisung fehlt.');
    if (Object.hasOwn(outcome, 'monthlySaving') && (!finite(outcome.monthlySaving) || outcome.monthlySaving < 0))
        throw new Error('Jahresbeleg: ungültiger Anlageanteil.');
    const action = outcome.action;
    const reading = outcome.snapshot?.marketReading;
    // Fehlt das Feld, galt die Jahresendregel; ein vorhandenes Feld muss vollständig und kalendergültig sein.
    if (reading !== undefined && (!reading || typeof reading !== 'object' || reading.reading !== 'year_high'
        || !finite(reading.value) || reading.value <= 0 || typeof reading.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reading.asOf)
        || !Number.isFinite(Date.parse(`${reading.asOf}T00:00:00Z`))
        || new Date(Date.parse(`${reading.asOf}T00:00:00Z`)).toISOString().slice(0, 10) !== reading.asOf))
        throw new Error('Jahresbeleg: ungültige Wahl des Jahreshochs.');
    if (action.type === 'TRANSACTION' && (!Array.isArray(action.quellen) || !plain(action.verwendungen)
        || !finite(action.steuer) || action.steuer < 0)
        || Object.hasOwn(action, 'quellen') && !Array.isArray(action.quellen)
        || Object.hasOwn(action, 'verwendungen') && !plain(action.verwendungen)) throw new Error('Jahresbeleg: unvollständige Handlungsanweisung.');
    assertJson(outcome);
    for (const source of action.quellen || []) {
        if (!plain(source) || !text(source.kind) || !finite(source.brutto) || source.brutto < 0
            || !finite(source.netto) || source.netto < 0 || !finite(source.steuer) || source.steuer < 0) throw new Error('Jahresbeleg: ungültige Handlungsquelle.');
    }
    if (Object.values(action.verwendungen || {}).some(value => !finite(value) || value < 0)) throw new Error('Jahresbeleg: ungültige Verwendung.');
}
/**
 * @param {unknown} raw
 * @returns {D.AnnualPlanRecord}
 */
export function assertAnnualPlanRecord(raw) {
    /** @type {D.AnnualPlanRecord} */
    const record = /** @type {D.AnnualPlanRecord} */ (typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (!plain(record) || record.version !== 1 || !plain(record.entries)) throw new Error('Beschädigter oder künftig versionierter Jahresbelegdatensatz.');
    for (const [key, item] of Object.entries(record.entries)) {
        if (!plain(item) || !Number.isInteger(item.year) || item.year < 1900 || item.year > 9999
            || !text(item.periodId) || ![`calendar-year:${item.year}`, `calendar-year:${item.year - 1}`].includes(item.periodId)
            || !text(item.committedAt) || !Number.isFinite(Date.parse(item.committedAt))
            || typeof item.adjusted !== 'boolean' || !Array.isArray(item.adjustedFields)
            || item.adjustedFields.some(path => !PLAN_FIELD_PATHS.includes(path))
            || new Set(item.adjustedFields).size !== item.adjustedFields.length
            || !item.adjusted && item.adjustedFields.length || item.adjusted && !item.adjustedFields.length) throw new Error('Ungültiger Jahresbeleg oder Anpassungsnachweis.');
        assertPlanScope(item.scope);
        if (key !== annualPlanEntryKey(item.year, item.scope)) throw new Error('Jahresbeleg gehört nicht zum angegebenen Jahr/Bereich.');
        assertOutcome(item.recommended); assertOutcome(item.adopted);
        const snapshot = item.adopted.snapshot;
        if (!plain(snapshot) || !finite(snapshot.inflation) || !plain(snapshot.ageByPerson)
            || Object.keys(snapshot.ageByPerson).length !== item.scope.ids.length
            || item.scope.ids.some(id => !Number.isInteger(snapshot.ageByPerson[id]) || snapshot.ageByPerson[id] < 0 || snapshot.ageByPerson[id] > 130)) throw new Error('Jahresbeleg: Momentaufnahme oder Alter zum 01.01. fehlt.');
        assertPlanValues(snapshot.plan);
    }
    return record;
}
/** Kein Schreiber in H1. Abwesenheit null, vorhandener Schaden ein Fehlerstatus. */
/**
 * @param {{year?: number, scope?: D.PlanScope, storage?: D.RecordReader}} [options]
 */
export function readAnnualPlanRecord({ year, scope, storage = persistenceStorage } = {}) {
    const raw = storage.getItem(ANNUAL_PLAN_RECORD_KEY);
    if (raw === null || raw === undefined) return null;
    try {
        if (!Number.isInteger(year)) throw new Error('Ungültiges Planjahr.');
        assertPlanScope(scope);
        const entry = assertAnnualPlanRecord(raw).entries[annualPlanEntryKey(/** @type {number} */ (year), /** @type {D.PlanScope} */ (scope))] ?? null;
        // Fehlende Tagesgeldmonate nur lesend ergänzen; alte Belegbytes bleiben erhalten.
        for (const outcome of [entry?.adopted, entry?.recommended]) if (outcome?.snapshot?.plan) {
            outcome.snapshot.plan.liquidityCashMonths ??= PLAN_DEFAULTS.liquidityCashMonths;
        }
        return entry;
    } catch (error) { return { status: 'invalid', error, raw }; }
}

/** Reine Belegbildung; bestehende Jahre/Bereiche werden weder ersetzt noch normalisiert. */
/**
 * @param {unknown} raw
 * @param {{targetYear: number, scope: D.PlanScope, committedAt: string, recommended: D.AnnualOutcomeCandidate, adopted?: D.AnnualOutcomeCandidate | null, adjustedFields?: string[]}} options
 */
export function buildAnnualPlanRecord(raw, { targetYear, scope, committedAt, recommended, adopted, adjustedFields = [] }) {
    /** @type {D.AnnualPlanRecord} */
    const record = raw == null ? { version: 1, entries: {} } : structuredClone(assertAnnualPlanRecord(raw));
    const year = targetYear + 1, key = annualPlanEntryKey(year, scope);
    if (Object.hasOwn(record.entries, key)) throw new Error('Für dieses Planungsjahr besteht bereits ein Jahresbeleg.');
    const entry = /** @type {D.AnnualPlanEntry} */ ({ year, scope: structuredClone(scope), periodId: `calendar-year:${targetYear}`, committedAt,
        recommended: structuredClone(recommended), adopted: structuredClone(adopted ?? recommended),
        adjusted: adjustedFields.length > 0, adjustedFields: [...adjustedFields] });
    record.entries[key] = entry;
    assertAnnualPlanRecord(record);
    return { raw: JSON.stringify(record), record, entry };
}
