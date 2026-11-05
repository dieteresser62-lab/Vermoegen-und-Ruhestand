/** @import * as AnalysisTypes from '../../typcheck/simulator-analysis.js' */
/** Wunsch-Flex ab heute auf dem 50-Euro-Raster, alle Stufen auf VG-1-Ziehungen. */
import { createDecisionComparisonSession, completeDecisionComparison } from './decision-comparison.js';

export const TARGET_BUDGET_STEP = 50;
export const TARGET_BUDGET_MAXIMUM = 1000000;

/**
 * @param metrics - Kontext für metrics.
 * @param goals - Kontext für goals.
 * @returns {boolean}
 */
export function targetBudgetMeetsGoals(metrics, goals) {
    return Number.isFinite(metrics.coveragePct) && Number.isFinite(metrics.affectedPct)
        && metrics.coveragePct >= goals.coveragePct && metrics.affectedPct <= goals.affectedPct;
}

/** Volle Endprobe: abwärts einklammern und den bestätigten Betrag im 50-Euro-Raster eingrenzen.
 * @param {{session: ReturnType<typeof import('./decision-comparison.js').createDecisionComparisonSession>; baseline: object;
 * monthly: number; lowerMonthly: number; goals: {coveragePct: number; affectedPct: number};
 * onProgress?: AnalysisTypes.ComparisonProgress}} options
 * @returns {Promise<object>} */
export async function runTargetBudgetVerification({ session, baseline, monthly, lowerMonthly, goals, onProgress = () => {} }) {
    const runs = session.params.standardRuns;
    const attempts = [];
    let calls = 0;
    const run = async (plan, record = false) => {
        session.check();
        const call = calls++;
        const amount = plan.startFlexBedarf / 12;
        const comparison = record ? 'Endprobe · Ausgangsplan'
            : `Endprobe · Stufe ${attempts.length + 1} · ${amount.toLocaleString('de-DE')} €`;
        // Die Zahl voller Proben ist offen; der Fortschritt nähert sich monoton 99 %.
        const report = (pct, detail = {}) => onProgress(80 + 19 * (1 - 1 / (1 + call + pct / 90)),
            { ...detail, phase: 'verification', comparison,
                completedRuns: detail.completedRuns || 0, totalRuns: runs,
                verificationPlan: record ? 'baseline' : 'candidate', monthly: amount });
        report(0);
        session.check();
        return session.run(plan, { record, fullRuns: true, onProgress: report });
    };
    const fullBaseline = session.params.anzahl === runs ? baseline : await run(session.baselineInputs, true);
    const evaluate = async amount => {
        const plan = { ...structuredClone(session.baselineInputs), startFlexBedarf: amount * 12 };
        const variant = await run(plan);
        session.check();
        attempts.push({ monthly: amount, metrics: variant.metrics });
        return variant;
    };
    const finish = (amount, variant, status, previous) => ({
        baseline: fullBaseline, variant, monthly: amount, previous,
        finalVerification: { status, runs, searchMonthly: monthly, attempts }
    });
    let low = monthly, high = monthly;
    let best = await evaluate(monthly);
    if (targetBudgetMeetsGoals(best.metrics, goals)) return finish(monthly, best, 'confirmed');
    let previous = attempts.at(-1);
    for (let distance = TARGET_BUDGET_STEP; low > lowerMonthly; distance *= 2) {
        low = Math.max(lowerMonthly, low - distance);
        best = await evaluate(low);
        if (targetBudgetMeetsGoals(best.metrics, goals)) break;
        high = low;
        previous = attempts.at(-1);
    }
    if (!targetBudgetMeetsGoals(best.metrics, goals)) return finish(low, best, 'unconfirmed');
    while (high - low > TARGET_BUDGET_STEP) {
        const middle = Math.floor((low + high) / 2 / TARGET_BUDGET_STEP) * TARGET_BUDGET_STEP;
        const candidate = await evaluate(middle);
        if (targetBudgetMeetsGoals(candidate.metrics, goals)) { low = middle; best = candidate; }
        else { high = middle; previous = attempts.at(-1); }
    }
    return finish(low, best, 'confirmed', previous);
}

/**
 * @param options - Optionen des Aufrufers.
 * @returns Ergebnis der Operation.
 */
export async function runTargetBudgetSearch(options) {
    const { goals, onProgress = () => {}, maximumMonthly = TARGET_BUDGET_MAXIMUM } = options;
    if (!goals || ![goals.coveragePct, goals.affectedPct].every(value => Number.isFinite(value) && value >= 0 && value <= 100))
        throw new Error('Bitte beide Zielgrenzen zwischen 0 und 100 % eingeben.');
    const session = createDecisionComparisonSession({ ...options, isolateReplays: true });
    try {
        const { baselineInputs, params, identity } = session;
        const step = TARGET_BUDGET_STEP;
        const currentMonthly = baselineInputs.startFlexBedarf / 12;
        const lowerMonthly = Math.ceil((Number(baselineInputs.minimumFlexAnnual) || 0) / 12 / step) * step;
        const startMonthly = Math.max(lowerMonthly, Math.floor(currentMonthly / step) * step);
        const maximum = Math.ceil(Math.max(maximumMonthly, lowerMonthly, currentMonthly) / step) * step;
        if (!Number.isFinite(maximum)) throw new Error('Die Suchobergrenze muss endlich sein.');
        const downwardStep = Math.max(250, currentMonthly * .05);
        // Oberer Aufwand beider Richtungen; Fortschritt bleibt beim Klammern monoton.
        const estimatedSteps = 2 + Math.max(Math.ceil((currentMonthly - lowerMonthly) / downwardStep),
            Math.ceil(Math.log2(Math.max(1, (maximum - currentMonthly) / 250))) + 1)
            + Math.ceil(Math.log2(Math.max(1, maximum / step)));
        let evaluations = 0;
        const progress = (monthly, stage) => {
            const searchStep = evaluations + 1;
            const comparison = `Stufe ${searchStep} · ${monthly.toLocaleString('de-DE')} € Wunsch-Flex/Monat · ${stage}`;
            const report = (pct, detail = {}) => onProgress(Math.min(79, (evaluations + pct / 90) / estimatedSteps * 80),
                { ...detail, comparison, searchStep, monthly });
            report(0);
            return report;
        };
        const baseline = await session.run(baselineInputs, { record: true, onProgress: progress(currentMonthly, 'heutiger Plan') });
        evaluations++;
        const observations = [{ monthly: currentMonthly, metrics: baseline.metrics }];
        const evaluate = async (monthly, stage) => {
            session.check();
            const plan = { ...structuredClone(baselineInputs), startFlexBedarf: monthly * 12 };
            const result = await session.run(plan, { onProgress: progress(monthly, stage) });
            evaluations++;
            observations.push({ monthly, metrics: result.metrics });
            return result;
        };
        const finish = data => {
            session.check();
            const finalRuns = data.finalVerification?.runs ?? params.anzahl;
            onProgress(100, { comparison: 'Zielwertsuche fertig', completedRuns: finalRuns, totalRuns: finalRuns });
            session.check();
            return { ...data, goals: structuredClone(goals), lowerMonthly, currentMonthly,
                currentMetrics: baseline.metrics, floorMonthly: baselineInputs.startFloorBedarf / 12,
                maximumMonthly: maximum, evaluations, observations, params, identity };
        };
        const start = startMonthly === currentMonthly ? baseline : await evaluate(startMonthly, 'Rasterstart');
        let low = startMonthly, high = startMonthly, best = start, next = start;
        if (targetBudgetMeetsGoals(start.metrics, goals)) {
            for (let distance = 250; high < maximum; distance *= 2) {
                high = Math.min(maximum, Math.ceil((startMonthly + distance) / step) * step);
                next = await evaluate(high, 'nach oben');
                if (!targetBudgetMeetsGoals(next.metrics, goals)) break;
                low = high; best = next;
            }
        } else {
            for (let distance = downwardStep; low > lowerMonthly; distance += downwardStep) {
                low = Math.max(lowerMonthly, Math.floor((startMonthly - distance) / step) * step);
                best = await evaluate(low, 'nach unten');
                if (targetBudgetMeetsGoals(best.metrics, goals)) break;
                high = low; next = best;
            }
            if (!targetBudgetMeetsGoals(best.metrics, goals))
                return finish({ status: 'unreachable', lowerMetrics: best.metrics });
        }
        while (high - low > step) {
            const middle = Math.floor((low + high) / 2 / step) * step;
            const candidate = await evaluate(middle, 'eingrenzen');
            if (targetBudgetMeetsGoals(candidate.metrics, goals)) { low = middle; best = candidate; }
            else { high = middle; next = candidate; }
        }
        const verified = await runTargetBudgetVerification({ session, baseline, monthly: low, lowerMonthly, goals, onProgress });
        const atUpperBound = verified.monthly === maximum;
        return finish({ status: 'found', monthly: verified.monthly, atUpperBound,
            nextMonthly: verified.previous?.monthly ?? (atUpperBound ? null : high),
            nextMetrics: verified.previous?.metrics ?? (atUpperBound ? null : next.metrics),
            nextRuns: verified.previous ? params.standardRuns : params.anzahl,
            finalVerification: verified.finalVerification,
            comparison: completeDecisionComparison({ baseline: verified.baseline, variant: verified.variant,
                params: { ...params, anzahl: params.standardRuns }, identity,
                change: { kind: 'budget', monthly: verified.monthly - currentMonthly } }) });
    } finally {
        session.dispose();
    }
}
