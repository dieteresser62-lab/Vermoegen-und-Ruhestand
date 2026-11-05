/** Lesender Jahresabschlussadapter; Hochreferenz und Abrufkurs bleiben reine Anzeige. */
import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview, unavailableBudgetComparison } from './balance-market-preview.js';
import { readDailyPrices, historyDay, mergeHistoryIntervals } from '../tranches/tranchen-history-store.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { annualEngineLoader } from '../shared/annual-engine-loader.js';
import { computeAnnualPlanUpdate } from './balance-annual-storage.js';
import { evaluateAnnualDraft } from './balance-annual-storage-commit.js';

/** @param {{targetYear: number, quote?: {price: number, asOf: string},
 * storage?: import('../../typcheck/datenvertraege.js').RecordStorage,
 * engineLoader?: typeof annualEngineLoader, marketData?: import('../../typcheck/balance-ui.js').ComputeAnnualOptions['marketData'],
 * cash?: import('../../typcheck/speicher-integration.js').Cash, careValues?: unknown}} options */
export async function projectAnnualMarketReadings({ targetYear, quote, marketData, cash, careValues, storage = persistenceStorage, engineLoader = annualEngineLoader }) {
    if (!quote) return null;
    try {
        return await prepareAnnualMarketReadings({ targetYear, quote, marketData, cash, careValues, storage, engineLoader });
    } catch (error) {
        console.error('Jahresabschlussvergleich nicht verfügbar:', error);
        const reason = 'Marktvorschau nicht verfügbar';
        return { withoutQuote: /** @type {const} */ (true), withoutQuoteReason: reason, quote: null,
            yearEndDate: null, readingsEqual: /** @type {const} */ (true), comparison: unavailableBudgetComparison(reason) };
    }
}

/** @param {{targetYear: number, quote: {price: number, asOf: string},
 * storage: import('../../typcheck/datenvertraege.js').RecordStorage,
 * engineLoader: typeof annualEngineLoader, marketData?: import('../../typcheck/balance-ui.js').ComputeAnnualOptions['marketData'],
 * cash?: import('../../typcheck/speicher-integration.js').Cash, careValues?: unknown}} options */
async function prepareAnnualMarketReadings({ targetYear, quote, marketData, cash, careValues, storage, engineLoader }) {
    const series = readDailyPrices(storage).value?.symbols['VWCE.DE'];
    const end = historyDay(quote.asOf);
    const calculation = buildBalanceEngineInputFromStorage({ storage, referenceYear: targetYear });
    const input = calculation.readerInputData || calculation.inputData;
    const state = calculation.profiles.find((/** @type {import("../../typcheck/balance-ui.js").ProfileInput} */ profile) => profile.balanceState?.annualPeriodMetadata?.lastCommittedPeriod)?.balanceState
        || calculation.persistentState;
    const meta = state.annualMarketDataMeta?.ath;
    const prepared = prepareMarketPreview({
        inputs: { endeVJ: input.endeVJ ?? 0, endeVJ_1: input.endeVJ_1 ?? 0, endeVJ_2: input.endeVJ_2 ?? 0,
            endeVJ_3: input.endeVJ_3 ?? 0, ath: input.ath ?? 0, jahreSeitAth: input.jahreSeitAth ?? 0 },
        dailyPrices: series ? { version: 1, symbols: { 'VWCE.DE': { ...series,
            queried: mergeHistoryIntervals([...series.queried, [end, end]]) } } } : null,
        // Der Abruf ersetzt den Vergleichskurs, wird aber kein gespeicherter Schluss.
        quoteOverride: quote,
        // Das Fachdatum ist das Abschlussjahresende, auch bei einem späteren Abruf.
        today: `${targetYear}-12-31`, yearEndDate: `${targetYear - 1}-12-31`, hasAnnualClose: true,
        storedHighAsOf: meta?.value === input.ath ? meta.lastHighAsOf ?? null : null
    });
    const engine = await engineLoader.load();
    const run = (/** @type {import('./balance-market-preview.js').AnnualMarketInputs} */ market) => {
        const result = engine.simulateSingleYear({ ...structuredClone(calculation.engineInput), ...market }, structuredClone(calculation.engineLastState));
        if (result.error) throw result.error;
        return /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (result);
    };
    const stored = run(prepared.inputs);
    const yearHigh = prepared.high.value > prepared.ruleInputs.ath && prepared.high.asOf
        ? { value: prepared.high.value, asOf: prepared.high.asOf } : undefined;
    // Wie beim Speichern zählt das Alter des Hochs bis zum 31.12., auch solange Inflation oder CAPE noch fehlen.
    if (yearHigh) prepared.highInputs.jahreSeitAth = (Date.parse(`${targetYear}-12-31`) - Date.parse(yearHigh.asOf)) / 86400000 / 365.2425;
    if (marketData?.inflation && marketData?.cape && marketData?.etf) {
        const evaluate = (/** @type {import('../../typcheck/datenvertraege.js').YearHighChoice|undefined} */ choice) => {
            const draft = computeAnnualPlanUpdate({ targetYear, marketData, yearHigh: choice, storage });
            return /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (evaluateAnnualDraft(
                /** @type {import('../../typcheck/speicher-integration.js').AnnualDraft} */ (draft), { engineApi: engine, cash, careValues }).modelResult);
        };
        return projectMarketPreview(prepared, { stored, rule: evaluate(undefined), high: evaluate(yearHigh) });
    }
    return projectMarketPreview(prepared, { stored, rule: prepared.withoutQuote ? stored : run(prepared.ruleInputs),
        high: prepared.withoutQuote ? stored : run(prepared.highInputs) });
}
