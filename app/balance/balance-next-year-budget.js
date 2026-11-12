/** Lesender Folgejahresentwurf. Kein Commit, Lease, Snapshot oder Livewrite. */
import { captureAnnualRecords, annualRecordStorage, computeAnnualPlanUpdate } from './balance-annual-storage.js';
import { evaluateAnnualDraft } from './balance-annual-storage-commit.js';
import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { fixedPlannedTotal, isLegacyPlannedPosts } from './balance-planned-posts.js';
import { prepareMarketPreview, projectMarketPreview, compareMarketBudgets, unavailableBudgetComparison } from './balance-market-preview.js';
import { projectBalanceActionOrigin } from './balance-action-origin.js';
import { projectOverviewFromRecords } from '../overview/overview-model.js';
import { readDailyPrices } from '../tranches/tranchen-history-store.js';
import { readAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { parseStoredBalanceInputsFromData } from '../profile/profile-state.js';
import { resolvePlanOverviewRates } from '../simulator/simulator-plan-overview.js';
import { createManualAnnualQuote } from '../shared/annual-marketdata.js';
import { validateInflationResult, INFLATION_RESULT_METRIC } from './balance-annual-inflation.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { CONFIG } from './balance-config.js';

/** @import * as D from '../../typcheck/datenvertraege.js' */
/** @import * as I from '../../typcheck/speicher-integration.js' */
/** @typedef {ReturnType<typeof buildBalanceEngineInputFromStorage>} Calculation */
/** @typedef {ReturnType<typeof evaluateAnnualDraft>} Evaluation */
/** @typedef {{kind: string, text: string, value?: number, source?: string, asOf?: string|null,
 * year?: number|null, applied?: boolean}} Assumption */
/** @typedef {{kind: string, text: string, amount: number, effect: 'need'|'income'|'planned_flows'|'budget',
 * monthlyBudgetEffect?: number, reserveChange?: number, announcedIncomeChange?: number}} ChangeReason */

/** Der Simulator liest denselben gespeicherten Rohwert für seine Fortschreibung.
 * Ein bereits vorbereiteter Januarwert hat Vorrang, ohne einen Abruf auszulösen.
 * @param {D.StringRecords} records @param {Calculation} before @param {number} closingYear
 * @param {Date} date @param {import('../../typcheck/balance-ui.js').InflationResult} [annualInflation] */
function projectionSources(records, before, closingYear, date, annualInflation) {
    const pendingYear = closingYear < date.getFullYear();
    const stored = before.persistentState.annualMarketDataMeta?.inflation;
    const prepared = pendingYear ? annualInflation || (stored?.year === closingYear ? stored : null) : null;
    const rates = resolvePlanOverviewRates(parseStoredBalanceInputsFromData(records));
    const inflation = prepared ? validateInflationResult(prepared, closingYear) : validateInflationResult({
        rate: rates.inflation.value, year: closingYear, source: `Simulator-Fortschreibung: ${rates.inflation.origin}`,
        dataAsOf: localCalendarDate(date), fetchStatus: 'ok_projection', metric: INFLATION_RESULT_METRIC
    }, closingYear);
    const cape = before.householdPlan.entry.values.cape;
    return { inflation, cape, assumptions: /** @type {Assumption[]} */ ([
        { kind: 'inflation', text: `Inflation als Annahme: ${inflation.rate} %`, value: inflation.rate,
            source: prepared ? inflation.source : `Annahme · ${inflation.source}`, asOf: prepared ? inflation.dataAsOf : null,
            year: prepared ? closingYear : null },
        { kind: 'wealth', text: 'Gespeicherte Bestände und Bewertungen heute gelesen; keine Hochrechnung bis Dezember',
            asOf: localCalendarDate(date), source: 'Aktiver Speicherbereich' },
        { kind: 'remaining_withdrawals', text: 'Restentnahmen bis Dezember nicht abgezogen', applied: false,
            source: 'Kein eindeutiger Zahlungsstand zwischen heutigem Tagesgeld, Monatsbudgets und geplanten Posten' },
        { kind: 'cape', text: 'Zuletzt gespeicherter CAPE als Annahme', value: cape.value,
            asOf: cape.asOf, source: cape.source || 'Gespeicherter Plan; Herkunft nicht belegt' }
    ]) };
}

/** Nur Hoch und Hochalter ändern sich. Jahresverschiebung und Plan bleiben identisch.
 * @param {I.AnnualDraft} draft @param {import('./balance-market-preview.js').AnnualMarketInputs} market */
function withHigh(draft, market) {
    const copy = annualRecordStorage(draft.records);
    const state = JSON.parse(copy.getItem(CONFIG.STORAGE.LS_KEY));
    for (const key of ['ath', 'jahreSeitAth']) {
        state.inputs[key] = market[key];
        (state.balanceInputFields ||= {})[key] = { value: String(market[key]), checked: false };
    }
    copy.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    return { ...draft, records: copy.records };
}

/** Laufender Beschluss, sonst dieselbe Jahresbasis ohne Jahresfortschreibung.
 * @param {Calculation} before @param {D.RecordStorage & {records: D.StringRecords}} storage
 * @param {number} year @param {NonNullable<I.AnnualOptions['engineApi']>} engineApi @param {()=>Date} now */
function currentPlan(before, storage, year, engineApi, now) {
    const receipt = /** @type {import('../../typcheck/profile-ui.js').ReadAnnualPlan} */ (readAnnualPlanRecord)({ storage, scope: before.scope, year });
    if (receipt?.status === 'invalid') throw new Error('Der laufende Jahresplanbeleg ist beschädigt.');
    const baseline = receipt?.adopted || evaluateAnnualDraft(/** @type {I.AnnualDraft} */ ({
        status: 'current', records: storage.records, scope: before.scope, profileId: before.profileId,
        planningYear: year, values: before.householdPlan.entry.values, ageByPerson: {}
    }), { engineApi, now }).outcome;
    return { targetYear: year, source: receipt ? 'Bestätigter Jahresbeleg' : 'Gespeicherte Jahresbasis ohne Abschluss',
        floor: baseline.snapshot.plan.floorBedarf, desiredFlex: baseline.snapshot.plan.flexBedarf,
        needBeforeIndexation: before.householdPlan.entry.values.floorBedarf + before.householdPlan.entry.values.flexBedarf,
        // FR-73: Abstand des Pflegebedarfs vom Plan im laufenden Jahr; die Vorschau nennt die Änderung als eigene Ursache.
        careDeviation: before.careNeeds ? before.inputData.floorBedarf - fixedPlannedTotal(before.inputData.plannedPosts) + before.inputData.flexBedarf
            - before.careNeeds.plan.floorBedarf - before.careNeeds.plan.flexBedarf : 0,
        annualBudget: Math.round(baseline.monthlyBudget) * 12,
        annualIncome: (baseline.monthlyBudget - baseline.monthlyWithdrawal + (baseline.monthlySaving || 0)) * 12,
        plannedPosts: baseline.plannedPosts || before.inputData.plannedPosts || null,
        // FR-43: Nur feste Posten, die im Budget dieses Belegs stecken; Altbelege und Belege ohne Posten zählen 0.
        fixedInBudget: baseline.plannedPosts && !isLegacyPlannedPosts(baseline.plannedPosts) ? fixedPlannedTotal(baseline.plannedPosts) : 0 };
}

/** Beträge beschreiben verschiedene Wirkungen, keine additive Budgetzerlegung:
 * Einkommen verändert die Entnahme, offene Ausgaben die Reserve. Angekündigte
 * Einmaleinkünfte sind noch kein verfügbares Cash und mindern die Reserve nicht.
 * @param {ReturnType<typeof currentPlan>} current @param {Evaluation} next
 * @param {number} annualBudget @param {I.AnnualDraft} draft @param {number} [marketDifference] */
function changeReasons(current, next, annualBudget, draft, marketDifference = 0) {
    const unroundedNeed = draft.values.floorBedarf + draft.values.flexBedarf;
    const inflation = unroundedNeed - current.needBeforeIndexation;
    const rounding = next.values.floorBedarf + next.values.flexBedarf - unroundedNeed;
    const announcedIncome = posts => (posts?.items || [])
        .filter(item => item.kind === 'income').reduce((sum, item) => sum + item.amount, 0);
    const reserveChange = (next.inputData.plannedPosts?.reserve || 0) - (current.plannedPosts?.reserve || 0);
    const announcedIncomeChange = announcedIncome(next.inputData.plannedPosts) - announcedIncome(current.plannedPosts);
    const registry = JSON.parse(draft.baseRecords.rs_profiles_v1);
    const pensions = draft.scope.ids.flatMap(id => {
        const person = registry.profiles[id], start = person.data.profile_rentenbeginn;
        return start?.startsWith(`${draft.planningYear}-`) ? [`Rente ${person.meta.name} ab ${start.slice(5, 7)}/${draft.planningYear}`] : [];
    });
    const posts = [...new Set((next.inputData.plannedPosts?.items || []).map(item => item.label))].join(', ');
    const careNeeds = next.calculation?.careNeeds;
    // FR-43: Feste geplante Ausgaben stecken im Grundbedarf der Engine, gehören aber nicht zur Pflegeabweichung.
    const fixedNext = fixedPlannedTotal(next.inputData.plannedPosts), fixedChange = fixedNext - current.fixedInBudget;
    const care = careNeeds || current.careDeviation ? next.inputData.floorBedarf - fixedNext + next.inputData.flexBedarf
        - next.values.floorBedarf - next.values.flexBedarf - current.careDeviation : 0;
    const components = /** @type {ChangeReason[]} */ ([
        { kind: 'inflation', text: 'Inflation', amount: inflation, effect: 'need' },
        { kind: 'rounding', text: 'Rundung der Planwerte', amount: rounding, effect: 'need' },
        ...(careNeeds || current.careDeviation ? [{ kind: 'care', text: 'Pflege: Heimjahr, Staffel und Deckel im Folgejahr', amount: care, effect: 'need' }] : []),
        { kind: 'income', text: pensions.join(', ') || 'Renten und laufende Einkünfte im Folgejahr',
            amount: next.inputData.renteMonatlich * 12 - current.annualIncome, effect: 'income' },
        { kind: 'planned_posts', text: posts ? `${posts} ${draft.planningYear}` : 'Geplante Ausgaben und einmalige Einkünfte im Folgejahr',
            amount: reserveChange - announcedIncomeChange, effect: 'planned_flows', reserveChange, announcedIncomeChange },
        ...(fixedChange ? [{ kind: 'fixed_expenses', text: 'Feste geplante Ausgaben im Grundbedarf', amount: fixedChange, effect: 'need' }] : []),
        { kind: 'guardrail', text: 'Leitplanke/Budgetgedächtnis',
            amount: annualBudget - current.annualBudget - inflation - rounding - care - fixedChange - marketDifference, effect: 'budget',
            monthlyBudgetEffect: (annualBudget - current.annualBudget - inflation - rounding - care - fixedChange - marketDifference) / 12 },
        ...(marketDifference ? [{ kind: 'market', text: 'Hochreferenz im Variantenvergleich', amount: marketDifference,
            effect: 'budget', monthlyBudgetEffect: marketDifference / 12 }] : [])
    ]);
    const impact = item => Math.abs(item.monthlyBudgetEffect === undefined ? item.amount : item.monthlyBudgetEffect * 12);
    return { components, reasons: components.filter(item => Math.abs(item.amount) >= 1)
        .sort((a, b) => impact(b) - impact(a)).slice(0, 3) };
}

/** Reine Projektion mit explizitem Rechenkern; Fachdatum folgt auch im Spielbereich appNow.
 * Fehler bleiben ein eigenes Anzeigeergebnis. Aufrufer behalten ihre p25-Vorschau.
 * @param {{storage: D.RecordStorage, engineApi: NonNullable<I.AnnualOptions['engineApi']>,
 * now?: ()=>Date, annualInflation?: import('../../typcheck/balance-ui.js').InflationResult}} options */
export function projectNextYearBudget({ storage, engineApi, now = appNow, annualInflation }) {
    let closingYear = null, targetYear = null;
    try {
        const date = now();
        if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Ungültiges Projektionsdatum.');
        const clock = () => new Date(date.getTime());
        const records = captureAnnualRecords(storage), copy = annualRecordStorage(records);
        const model = projectOverviewFromRecords({ registry: JSON.parse(copy.getItem('rs_profiles_v1') || 'null'),
            activeId: copy.getItem('rs_current_profile'), liveData: records, now: date, balanceSingleFallback: true });
        if (!model.available || !['done', 'open', 'not_applicable'].includes(model.occasion?.annualState)) {
            throw new Error('Jahresstand unklar oder nicht verfügbar.');
        }
        closingYear = projectBalanceActionOrigin({ year: date.getFullYear(), occasion: model.occasion }).previewYear;
        targetYear = closingYear + 1;
        const before = buildBalanceEngineInputFromStorage({ storage: copy, referenceYear: closingYear });
        if (before.householdPlan.status !== 'valid') throw new Error('Der gespeicherte Plan fehlt.');
        const annual = before.readerInputData;
        const annualState = before.profiles.find(profile => profile.balanceState?.annualPeriodMetadata?.lastCommittedPeriod)?.balanceState
            || before.persistentState;
        const meta = annualState.annualMarketDataMeta?.ath;
        const market = prepareMarketPreview({ inputs: /** @type {import('./balance-market-preview.js').AnnualMarketInputs} */ (annual),
            dailyPrices: readDailyPrices(copy).value || null, today: localCalendarDate(date),
            yearEndDate: `${closingYear - 1}-12-31`, hasAnnualClose: Boolean(annualState.annualPeriodMetadata?.lastCommittedPeriod),
            storedHighAsOf: meta?.value === annual.ath ? meta.lastHighAsOf : null });
        if (market.unreliableReason) throw new Error(market.unreliableReason);
        const sources = projectionSources(records, before, closingYear, date, annualInflation);
        sources.assumptions.push({ kind: 'quote', text: 'Letzter gespeicherter VWCE.DE-Schluss als Vergleichskurs',
            value: market.quote.price, asOf: market.quote.asOf, source: 'Gespeicherte EUR-Schlusskurse' });
        // Die strengen Abschlussvalidatoren bleiben unverändert. Nur dieser isolierte
        // Entwurf versieht Annahmewerte mit dem künftigen Abschlussstichtag.
        // Tatsächliche Herkunft und Datierung bleiben oben in den Annahmen erhalten.
        const marketData = { inflation: sources.inflation,
            etf: { ...createManualAnnualQuote(market.quote.price, `calendar-year:${closingYear}`), source: 'Projektionsannahme' },
            cape: { capeRatio: sources.cape.value, capeAsOf: `${closingYear}-12-31`, capeSource: 'Manuelle Ergänzung',
                capeFetchStatus: 'ok_fallback_stored', capeUpdatedAt: date.toISOString() } };
        const draft = computeAnnualPlanUpdate({ targetYear: closingYear, storage: copy, marketData, now: clock });
        if (draft.status !== 'prepared') throw new Error('Das Projektionsjahr ist bereits abgeschlossen.');
        const prepared = /** @type {I.AnnualDraft} */ (draft);
        const rule = evaluateAnnualDraft(prepared, { engineApi, now: clock });
        const high = evaluateAnnualDraft(withHigh(prepared, market.highInputs), { engineApi, now: clock });
        const comparison = compareMarketBudgets(/** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (rule.modelResult),
            /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (high.modelResult));
        if (comparison.state === 'not_reliable') throw new Error(comparison.reason);
        const current = currentPlan(before, copy, closingYear, engineApi, clock);
        const variant = (evaluation, amounts, highReference) => ({ ...amounts, targetYear,
            annualIncome: evaluation.inputData.renteMonatlich * 12,
            monthlyWithdrawal: evaluation.outcome.monthlyWithdrawal, plannedPosts: evaluation.inputData.plannedPosts || null,
            ageByPerson: { ...prepared.ageByPerson },
            market: { inputs: highReference ? market.highInputs : market.ruleInputs,
                high: highReference ? market.high : market.ruleHigh, phase: evaluation.modelResult.ui.market.sKey },
            assumptions: structuredClone(sources.assumptions),
            ...changeReasons(current, evaluation, amounts.annualBudget, prepared,
                highReference ? comparison.difference?.annualBudget || 0 : 0) });
        return { state: comparison.state, reason: null, closingYear, targetYear, current,
            quote: market.quote, comparison: { ...comparison, targetYear },
            assumptions: sources.assumptions,
            marketPreview: projectMarketPreview(market, {
                stored: /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (rule.modelResult),
                rule: /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (rule.modelResult),
                high: /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (high.modelResult) }),
            displayEvaluation: { modelResult: rule.modelResult, inputData: rule.inputData, profilverbundRuns: rule.runs, careNeeds: rule.calculation.careNeeds },
            rule: variant(rule, comparison.rule, false), high: variant(high, comparison.high, true) };
    } catch (error) {
        const reason = error instanceof Error ? error.message : 'Folgejahresprojektion nicht verfügbar.';
        return { state: 'not_reliable', reason, closingYear, targetYear, current: null,
            quote: null, rule: null, high: null, assumptions: [], comparison: unavailableBudgetComparison(reason) };
    }
}
