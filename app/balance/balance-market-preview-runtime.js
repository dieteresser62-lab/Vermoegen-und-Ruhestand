/** Lesender Balance-Adapter. Nur das Regelergebnis wird dargestellt; Speichern nutzt die Basis. */
import { prepareMarketPreview, projectMarketPreview, unavailableBudgetComparison } from './balance-market-preview.js';
import { projectBalanceActionOrigin } from './balance-action-origin.js';
import { projectOverviewFromRecords } from '../overview/overview-model.js';
import { readDailyPrices } from '../tranches/tranchen-history-store.js';
import { appNow, localCalendarDate } from '../shared/app-clock.js';

/** @typedef {{calculation: ReturnType<typeof import('./balance-input-storage.js').buildBalanceEngineInputFromStorage>,
 * storage: import('../../typcheck/datenvertraege.js').RecordStorage, now?: Date}} MarketPreviewContext */
/** @param {import('./balance-file-service.js').BalanceEvaluationOptions} options
 * @param {MarketPreviewContext} context
 * @param {(options: import('./balance-file-service.js').BalanceEvaluationOptions)=>import('./balance-file-service.js').BalanceEvaluation} evaluateInputs
 * @returns {import('./balance-file-service.js').BalanceEvaluation} */
export function evaluateBalanceMarketPreview(options, { calculation, storage, now }, evaluateInputs) {
    const base = evaluateInputs(options);
    const baseActions = globalThis.window?.__profilverbundActionResults;
    const baseDistribution = globalThis.window?.__profilverbundDistribution;
    /** @param {string} reason @returns {import('./balance-file-service.js').BalanceEvaluation} */
    const withoutQuote = reason => ({ ...base, persistenceEvaluation: base, previewInputData: options.inputData,
        marketPreview: { withoutQuote: true, withoutQuoteReason: reason, quote: null, yearEndDate: null, readingsEqual: true,
            comparison: unavailableBudgetComparison(reason) } });
    try {
        now ??= appNow();
        if (!Number.isFinite(now.getTime())) throw new Error('Ungültiges Datum der Marktvorschau.');
        const liveData = /** @type {import('../../typcheck/datenvertraege.js').StringRecords} */ ({});
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key) continue;
            const value = storage.getItem(key);
            if (value !== null) liveData[key] = value;
        }
        const activeId = storage.getItem('rs_current_profile');
        const model = activeId ? projectOverviewFromRecords({ registry: JSON.parse(storage.getItem('rs_profiles_v1') || 'null'),
            activeId, liveData, now, balanceSingleFallback: true }) : null;
        if (!model?.available || !['done', 'open', 'not_applicable'].includes(model.occasion?.annualState)) {
            return withoutQuote('Jahresstand unklar oder nicht verfügbar');
        }
        const origin = projectBalanceActionOrigin({ year: now.getFullYear(), scope: model.scope,
            comparison: model.planComparison, occasion: model.occasion });
        const prices = readDailyPrices(storage);
        const annualInputs = calculation.readerInputData || calculation.inputData;
        const selectedStates = /** @type {import('../../typcheck/balance-ui.js').ProfileInput[]} */ (calculation.profiles).map(profile => profile.balanceState);
        const annualState = selectedStates.find(state => state?.annualPeriodMetadata?.lastCommittedPeriod) || calculation.persistentState;
        const highMetadata = annualState.annualMarketDataMeta?.ath;
        const prepared = prepareMarketPreview({
            inputs: { endeVJ: annualInputs.endeVJ ?? 0, endeVJ_1: annualInputs.endeVJ_1 ?? 0,
                endeVJ_2: annualInputs.endeVJ_2 ?? 0, endeVJ_3: annualInputs.endeVJ_3 ?? 0,
                ath: annualInputs.ath ?? 0, jahreSeitAth: annualInputs.jahreSeitAth ?? 0 },
            dailyPrices: prices.value ?? null, today: localCalendarDate(now), yearEndDate: `${origin.previewYear - 1}-12-31`,
            hasAnnualClose: Boolean(annualState.annualPeriodMetadata?.lastCommittedPeriod),
            storedHighAsOf: highMetadata && highMetadata.value === annualInputs.ath ? highMetadata.lastHighAsOf ?? null : null
        });
        const evaluate = (/** @type {import('./balance-market-preview.js').AnnualMarketInputs} */ market, /** @type {boolean} */ publish) =>
            evaluateInputs({ ...options, publish, profileSimulationOptions: { publish }, inputData: { ...structuredClone(options.inputData), ...market } });
        const rule = prepared.withoutQuote ? base : evaluate(prepared.ruleInputs, options.publish !== false);
        // Auch bei gleichen Lesarten ein separater Engineaufruf; niemals Profilaktionen veröffentlichen.
        const high = prepared.withoutQuote ? base : evaluate(prepared.highInputs, false);
        const marketPreview = projectMarketPreview(prepared, { stored: base.modelResult, rule: rule.modelResult, high: high.modelResult });
        return { ...rule, persistenceEvaluation: base, marketPreview,
            previewInputData: prepared.withoutQuote ? options.inputData : { ...options.inputData, ...prepared.ruleInputs } };
    } catch (error) {
        if (options.publish !== false && typeof window !== 'undefined') {
            window.__profilverbundActionResults = baseActions;
            window.__profilverbundDistribution = baseDistribution;
        }
        console.error('Marktvorschau nicht verfügbar; Balance verwendet die Jahresmarktdaten:', error);
        return withoutQuote('Marktvorschau nicht verfügbar');
    }
}
