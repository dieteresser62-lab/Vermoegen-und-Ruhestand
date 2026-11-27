/** Lesender Jahresabschlussadapter: Allzeithoch und Marktlage zum Abschlusskurs (FR-89), reine Anzeige. */
import { buildBalanceEngineInputFromStorage } from './balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview, storedMarketHigh, unavailableMarketPreview } from './balance-market-preview.js';
import { highCorrectionsOf } from './balance-ath-corrections.js';
import { withAthNoiseBand } from './balance-ath-noise.js';
import { readDailyPrices, readHistoryStartDate, historyDay, mergeHistoryIntervals } from '../tranches/tranchen-history-store.js';
import { persistenceStorage } from '../shared/persistence-facade.js';
import { annualEngineLoader } from '../shared/annual-engine-loader.js';

/** @param {{targetYear: number, quote?: {price: number, asOf: string},
 * storage?: import('../../typcheck/datenvertraege.js').RecordStorage, engineLoader?: typeof annualEngineLoader}} options */
export async function projectAnnualMarketReadings({ targetYear, quote, storage = persistenceStorage, engineLoader = annualEngineLoader }) {
    if (!quote) return null;
    try {
        return await prepareAnnualMarketReadings({ targetYear, quote, storage, engineLoader });
    } catch (error) {
        console.error('Marktlage im Jahresabschluss nicht verfügbar:', error);
        return unavailableMarketPreview('Marktvorschau nicht verfügbar');
    }
}

/** @param {{targetYear: number, quote: {price: number, asOf: string},
 * storage: import('../../typcheck/datenvertraege.js').RecordStorage, engineLoader: typeof annualEngineLoader}} options */
async function prepareAnnualMarketReadings({ targetYear, quote, storage, engineLoader }) {
    const series = readDailyPrices(storage).value?.symbols['VWCE.DE'];
    const periodId = `calendar-year:${targetYear}`;
    const before = buildBalanceEngineInputFromStorage({ storage, referenceYear: targetYear });
    const alreadyCommitted = before.persistentState.annualPeriodMetadata?.lastCommittedPeriod === periodId
        || before.persistentState.balanceStateLifecycle?.lastCommittedPeriod === periodId;
    const calculation = alreadyCommitted ? buildBalanceEngineInputFromStorage({ storage, referenceYear: targetYear + 1 }) : before;
    const input = calculation.readerInputData || calculation.inputData;
    const state = calculation.profiles.find((/** @type {import("../../typcheck/balance-ui.js").ProfileInput} */ profile) => profile.balanceState?.annualPeriodMetadata?.lastCommittedPeriod)?.balanceState
        || calculation.persistentState;
    const meta = state.annualMarketDataMeta?.ath;
    const savedMarket = calculation.persistentState.annualMarketDataMeta;
    if (alreadyCommitted && savedMarket?.periodId === periodId) quote = { price: savedMarket.price, asOf: savedMarket.asOf };
    const end = historyDay(quote.asOf);
    const storedHighAsOf = meta?.value === input.ath ? meta.lastHighAsOf ?? null : null;
    const prepared = prepareMarketPreview({
        inputs: { endeVJ: input.endeVJ ?? 0, endeVJ_1: input.endeVJ_1 ?? 0, endeVJ_2: input.endeVJ_2 ?? 0,
            endeVJ_3: input.endeVJ_3 ?? 0, ath: input.ath ?? 0, jahreSeitAth: input.jahreSeitAth ?? 0 },
        dailyPrices: series ? { version: 1, symbols: { 'VWCE.DE': { ...series,
            queried: mergeHistoryIntervals([...series.queried, [end, end]]) } } } : null,
        // Der Abruf ersetzt den Stichtagskurs, wird aber kein gespeicherter Schluss.
        quoteOverride: quote,
        // Das Fachdatum ist das Abschlussjahresende, auch bei einem späteren Abruf; bis dahin zählt auch das Alter des Hochs.
        today: `${targetYear}-12-31`, ageUntil: `${targetYear}-12-31`, yearEndDate: `${targetYear - 1}-12-31`, hasAnnualClose: true,
        storedHighAsOf, corrections: highCorrectionsOf(calculation.persistentState), yearEndAsOf: state.annualMarketDataMeta?.asOf ?? null,
        historyStart: readHistoryStartDate(storage)
    });
    if (alreadyCommitted) {
        // Der gespeicherte Abschluss enthält Jahresendstände, Hoch und Alter bereits.
        prepared.marketInputs = { ...prepared.inputs };
        const stored = storedMarketHigh(prepared.inputs, storedHighAsOf, `${targetYear}-12-31`);
        prepared.high = { ...stored, source: !stored.dated ? 'stored' : stored.asOf === state.annualMarketDataMeta?.asOf ? 'year_end' : 'daily',
            splitAsOf: prepared.high.splitAsOf ?? null };
    }
    const engine = await engineLoader.load();
    // Die neuen Marktwerte ersetzen die der Rechenkopie; das Grundrauschen gilt wie bei allen Balance-Aufrufen (FR-89, Ergänzung 3).
    const result = engine.simulateSingleYear(withAthNoiseBand({ ...structuredClone(calculation.engineInput), ...prepared.marketInputs }), structuredClone(calculation.engineLastState));
    if (result.error) throw result.error;
    return projectMarketPreview(prepared, /** @type {import('../../typcheck/rechenkern.js').EngineSuccess} */ (result));
}
