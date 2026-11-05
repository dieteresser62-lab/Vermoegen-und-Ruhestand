/** Eine flüchtige Änderung, zwei mit aufgezeichneten Ziehungen gepaarte Rechnungen. */
import { buildMonteCarloAggregates, attachMonteCarloBatchOutcome } from './monte-carlo-runner.js';
import { normalizeMonteCarloParametersV1 } from './monte-carlo-parameters.js';
import { validateSimulatorInputs } from './simulator-input-validation.js';
import { quantile } from './simulator-utils.js';
import { createDecisionComparisonPool } from './decision-comparison-pool.js';
import { getDataVersion } from './simulator-engine-wrapper.js';
import { personReferenceYear } from '../profile/profile-person-data.js';

const clone = value => structuredClone(value);
const q = (values, p = .5) => values.length ? quantile(values, p) : null;
const monthValid = value => /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const monthIndex = value => Number(value.slice(0, 4)) * 12 + Number(value.slice(5)) - 1;
const monthFromIndex = value => `${Math.floor(value / 12)}-${String(value % 12 + 1).padStart(2, '0')}`;
const fail = message => { throw new Error(`Vergleich nicht möglich: ${message}`); };

/**
 * @param inputs - Eingaben des Laufes.
 * @returns Ergebnis der Operation.
 */
export function comparisonReferenceYear(inputs) {
    return inputs.referenceYear ?? inputs.fixedIncomeReferenceYear ?? inputs.plannedExpensesReferenceYear ?? personReferenceYear(null);
}
/**
 * @param inputs - Eingaben des Laufes.
 * @param [options] - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function comparisonIncomeChoices(inputs, { pensionStarts = [], referenceYear = comparisonReferenceYear(inputs) } = {}) {
    const year = referenceYear;
    const pensionMonth = (offset, months) => `${year + (Number(offset) || 0)}-${String(13 - (months ?? 12)).padStart(2, '0')}`;
    const people = inputs.simulationPeople || [];
    return [
        ...(inputs.renteMonatlich > 0 ? [{ id: 'pension:0', label: `Rente ${people[0]?.name || 'Person 1'}`,
            start: monthValid(pensionStarts[0]) ? pensionStarts[0] : pensionMonth(inputs.renteStartOffsetJahre, inputs.renteStartMonate) }] : []),
        ...(inputs.partner?.aktiv && inputs.partner.monatsrente > 0 ? [{ id: 'pension:1', label: `Rente ${people[1]?.name || 'Person 2'}`,
            start: monthValid(pensionStarts[1]) ? pensionStarts[1] : pensionMonth(inputs.partner.startInJahren, inputs.partner.renteStartMonate) }] : []),
        ...(inputs.fixedIncome || []).map(entry => ({ id: `fixed:${entry.id}`,
            label: `${entry.bezeichnung} · ${people.find(person => person.profileId === entry.profileId)?.name || 'Einkunft'}`,
            start: entry.ab || `${inputs.fixedIncomeReferenceYear}-01`, end: entry.bis }))
    ];
}

/**
 * @param inputs - Eingaben des Laufes.
 * @param change - Kontext für change.
 * @param [context] - Kontext der Auswertung.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createDecisionVariant(inputs, change, context = {}) {
    const variant = clone(inputs), year = context.referenceYear ?? comparisonReferenceYear(inputs);
    if (!Number.isInteger(year)) fail('Das Bezugsjahr des Plans fehlt.');
    if (change?.kind === 'budget') {
        if (!Number.isFinite(change.monthly)) fail('Bitte einen Betrag pro Monat eingeben.');
        variant.startFlexBedarf += change.monthly * 12;
        // Mindest-Flex bleibt unverändert und wird regulär validiert, niemals begrenzt.
    } else if (change?.kind === 'expense') {
        if (!(Number.isFinite(change.amount) && change.amount > 0) || !monthValid(change.month)
            || change.month < `${year}-01`) fail('Bitte Betrag und einen Monat ab dem Planbeginn eingeben.');
        const ids = new Set((variant.plannedExpenses || []).map(entry => entry.id));
        let id = 'decision-comparison';
        while (ids.has(id)) id += '-extra';
        variant.plannedExpenses = [...(variant.plannedExpenses || []), {
            id, bezeichnung: 'Einmalige Ausgabe im Vergleich', betrag: change.amount, monat: change.month, priceYear: year
        }];
        variant.plannedExpensesReferenceYear = year;
    } else if (change?.kind === 'income') {
        if (!Number.isSafeInteger(change.months)) fail('Die Verschiebung muss ganze Monate betragen.');
        const choice = comparisonIncomeChoices(inputs, context).find(entry => entry.id === change.incomeId);
        if (!choice || !monthValid(choice.start)) fail('Bitte eine vorhandene Einkunft wählen.');
        const shifted = monthFromIndex(monthIndex(choice.start) + change.months);
        if (!monthValid(shifted) || choice.end && shifted > choice.end)
            fail('Der neue Beginn muss ein gültiger Monat vor dem Ende der Einkunft sein.');
        if (change.months === 0) return variant;
        if (change.incomeId.startsWith('fixed:')) {
            variant.fixedIncome.find(entry => `fixed:${entry.id}` === change.incomeId).ab = shifted;
        } else {
            // Bereits laufende Renten behalten ihre Jahresbasis. Ein verschobener
            // historischer Beginn kann weiterhin vor dem simulierten Plan liegen.
            if (shifted < `${year}-01` && choice.start < `${year}-01`) return variant;
            const offset = Math.max(0, Number(shifted.slice(0, 4)) - year);
            const months = shifted < `${year}-01` ? 12 : 13 - Number(shifted.slice(5));
            const calendarStart = shifted >= `${year}-01`;
            if (change.incomeId === 'pension:0') Object.assign(variant, {
                renteStartOffsetJahre: offset, renteStartMonate: months, renteKalenderbeginn: calendarStart
            });
            else Object.assign(variant.partner, { startInJahren: offset, renteStartMonate: months, renteKalenderbeginn: calendarStart });
        }
    } else fail('Bitte eine der drei Änderungen wählen.');
    validateSimulatorInputs(variant);
    return variant;
}

/** Vollständige Eingaben statt einer fehleranfälligen Auswahl einzelner Schutzfelder.
 *
 * @param options - Optionen des Aufrufers.
 * @returns {string}
 */
export function comparisonIdentity({ inputs, monteCarloParams, useCapeSampling,
    pensionStarts = [], referenceYear = comparisonReferenceYear(inputs) }) {
    return JSON.stringify({ inputs, monteCarloParams: normalizeMonteCarloParametersV1(monteCarloParams, { inputs }),
        useCapeSampling, pensionStarts, referenceYear, dataVersion: getDataVersion() });
}
/**
 * @param expected - Kontext für expected.
 * @param actual - Kontext für actual.
 * @returns {void}
 */
export function assertComparisonUnchanged(expected, actual) {
    if (expected !== actual) fail('Personen, Plan oder Monte-Carlo-Einstellungen wurden geändert. Bitte neu rechnen.');
}

/**
 * @param aggregated - Kontext für aggregated.
 * @param chunk - Kontext für chunk.
 * @param budgets - Kontext für budgets.
 * @returns Ergebnis der Operation.
 */
export function comparisonMetrics(aggregated, chunk, budgets) {
    const summary = chunk.pathSummaries, missing = chunk.pathMissingness;
    const affected = Array.from(summary.minimumFlexAffectedYearCount)
        .filter((count, index) => count > 0 && missing.minimumFlexRestriction[index] === 1);
    const perPathBudgets = budgets.map(values => q(values)).filter(Number.isFinite);
    return {
        coveragePct: aggregated.outcomeInventory.floorCoveragePct,
        affectedPct: aggregated.minimumFlexRestriction.affectedRunSharePct,
        affectedYears: affected.length ? q(affected) : aggregated.minimumFlexRestriction.sampleSize > 0 ? 0 : null,
        budgetP10: q(perPathBudgets, .1), budgetP50: q(perPathBudgets),
        wealthP10: aggregated.euroMetrics.real.finalOutcomes.p10,
        wealthP50: aggregated.euroMetrics.real.finalOutcomes.p50
    };
}

/**
 * @param standardRuns - Kontext für standardRuns.
 * @returns {number}
 */
export function decisionComparisonRunCount(standardRuns) {
    return Math.min(standardRuns, Math.max(500, Math.ceil(standardRuns / 1000) * 100));
}

/** Gemeinsame VG-1-Aufzeichnung für einen oder mehrere flüchtige Vergleichspläne.
 *
 * @param options - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function createDecisionComparisonSession({ inputs, monteCarloParams, useCapeSampling = false,
    readCurrentIdentity, signal, engine = null, workerConfig = {}, diagnosticRuns = 0, captureLogs = false,
    pensionStarts = [], referenceYear = comparisonReferenceYear(inputs), isolateReplays = false }) {
    const baselineInputs = clone(inputs);
    const standardParams = normalizeMonteCarloParametersV1(monteCarloParams, { inputs: baselineInputs });
    const params = { ...standardParams, anzahl: decisionComparisonRunCount(standardParams.anzahl), standardRuns: standardParams.anzahl };
    validateSimulatorInputs(baselineInputs, { horizonYears: params.maxDauer });
    const incomeContext = { pensionStarts: clone(pensionStarts), referenceYear };
    const identity = comparisonIdentity({ inputs: baselineInputs, monteCarloParams: standardParams, useCapeSampling, ...incomeContext });
    const check = () => {
        if (signal?.aborted) throw signal.reason || new DOMException('Rechnung abgebrochen.', 'AbortError');
        if (readCurrentIdentity) assertComparisonUnchanged(identity, readCurrentIdentity());
    };
    const tapes = new Map(), continuationYears = new Map();
    const pool = createDecisionComparisonPool({ engine, workerConfig, signal, check });
    const run = async (plan, { record = false, fullRuns = false, onProgress = () => {} } = {}) => {
        check();
        const runParams = fullRuns ? { ...params, anzahl: params.standardRuns } : params;
        validateSimulatorInputs(plan, { horizonYears: runParams.maxDauer });
        const result = await pool.run({ inputs: plan, params: runParams, useCapeSampling,
            record, tapes: !record && isolateReplays ? clone(tapes) : tapes, continuationYears,
            diagnosticRuns, captureLogs }, { onProgress });
        const { chunk, budgets, diagnostics } = result;
        if (record || !isolateReplays) {
            for (const [index, tape] of result.tapes) tapes.set(index, tape);
            for (const [index, years] of result.continuationYears) continuationYears.set(index, years);
        }
        check();
        if (!chunk.financialMetricsValid) fail(chunk.technicalInventory.errors[0]?.message || 'Technischer Fehler in einem Lauf.');
        const aggregated = attachMonteCarloBatchOutcome(buildMonteCarloAggregates({ inputs: plan,
            totalRuns: runParams.anzahl, ...chunk }), chunk.technicalInventory);
        return { metrics: comparisonMetrics(aggregated, chunk, budgets), aggregated, chunk, budgets, diagnostics };
    };
    return { baselineInputs, params, incomeContext, identity, check, run, dispose: pool.dispose };
}

/**
 * @param options - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export async function runDecisionComparison(options) {
    const { change, onProgress = () => {} } = options;
    const session = createDecisionComparisonSession(options);
    try {
        const { baselineInputs, params, incomeContext, identity, check } = session;
        const variantInputs = createDecisionVariant(baselineInputs, change, incomeContext);
        validateSimulatorInputs(variantInputs, { horizonYears: params.maxDauer });
        const plans = [];
        for (const [index, plan] of [baselineInputs, variantInputs].entries()) {
            plans.push(await session.run(plan, { record: index === 0, onProgress: (pct, detail) => {
                onProgress(index * 50 + pct / 90 * 50, { ...detail,
                    comparison: index === 0 ? 'Ausgangsplan' : 'Mit Änderung' });
            } }));
        }
        check();
        onProgress(100, { comparison: 'Vergleich fertig', completedRuns: params.anzahl, totalRuns: params.anzahl });
        return completeDecisionComparison({ baseline: plans[0], variant: plans[1], change, params, identity });
    } finally {
        session.dispose();
    }
}

/**
 * @param options - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export function completeDecisionComparison({ baseline, variant, change, params, identity }) {
    const worse = Array.from(baseline.chunk.pathSummaries.outcomeCode).filter((outcome, index) =>
        outcome !== 1 && (variant.chunk.pathSummaries.outcomeCode[index] === 1
        || variant.chunk.pathSummaries.minimumFlexAffectedYearCount[index] > baseline.chunk.pathSummaries.minimumFlexAffectedYearCount[index])).length;
    const differences = Object.fromEntries(Object.keys(baseline.metrics).map(key => [key,
        baseline.metrics[key] === null || variant.metrics[key] === null ? null : variant.metrics[key] - baseline.metrics[key]]));
    return { baseline, variant, differences, worsePct: worse / params.anzahl * 100, change: clone(change), params, identity };
}
