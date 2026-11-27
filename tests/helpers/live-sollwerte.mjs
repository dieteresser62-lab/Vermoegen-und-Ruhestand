/**
 * Rechenbare Ergebnis-Schnappschüsse für den ausgelieferten Live-Stand (JD-2a, Nachtrag 2, Befund 5).
 *
 * Fünf Ergebnisse über den ganzen Datenstand, ohne Grundbestandssicht: echte finanzielle Backtests 2000 bis Endjahr
 * (einschließlich eines angehängten Jahres) für Max/Erika und Renate, Monte Carlo mit 40 Pfaden und Saat 12345 für
 * beide sowie Monte Carlo mit CAPE-Ziehung für Max/Erika. Dazu die Kennung des Stands (Endjahr, Revision, Inhaltshash,
 * Manifesthash). `npm run jahresdaten:sollwerte` schreibt sie nach tests/fixtures/live-sollwerte.json; die
 * eingefrorenen Grundbestands-Belege bleiben daneben bestehen.
 */
import { backtest, hash, measurementInputs, parameters } from './ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../../engine/index.mjs';
import { HISTORICAL_DATA_MANIFEST, HISTORICAL_DATENSTAND } from '../../app/simulator/simulator-data.js';
import { canonicalizeHistoricalContractValue, sha256Hex } from '../../app/simulator/historical-backtest-contract.js';

export const LIVE_TESTDATUM = '2026-10-28';
export const LIVE_STARTJAHR = 2000;
const PFADE = 40;
const zweiStellen = value => Math.round(value * 100) / 100;

/** Kennung des ausgelieferten Stands. */
export function liveDatenstand() {
    return {
        endYear: HISTORICAL_DATENSTAND.endYear,
        revision: HISTORICAL_DATENSTAND.revision,
        contentHash: HISTORICAL_DATENSTAND.contentHash,
        manifestHash: sha256Hex(canonicalizeHistoricalContractValue(HISTORICAL_DATA_MANIFEST))
    };
}

async function monteCarlo(inputs, useCapeSampling) {
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: PFADE },
        widowOptions: inputs.widowOptions, useCapeSampling, runRange: { start: 0, count: PFADE } });
    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed') throw new Error('Monte Carlo nicht vollständig auswertbar');
    return { pfade: PFADE, saat: parameters.seed, capeZiehung: useCapeSampling, sha256: hash(chunk) };
}

/** @returns {Promise<{beschreibung: string, testdatum: string, datenstand: ReturnType<typeof liveDatenstand>, ergebnisse: Record<string, any>}>} */
export async function liveSollwerte() {
    const endYear = HISTORICAL_DATENSTAND.endYear;
    const ergebnisse = {};
    for (const id of ['max-erika', 'renate']) {
        const inputs = await measurementInputs(0, id, LIVE_TESTDATUM);
        const historisch = backtest(inputs, LIVE_STARTJAHR, endYear);
        if (historisch.outcome.kind !== 'completed') throw new Error(`Backtest ${id} nicht vollständig`);
        ergebnisse[`backtest-${id}`] = {
            zeitraum: [LIVE_STARTJAHR, endYear],
            letztesJahr: historisch.lastCompletedYear,
            zeilen: historisch.rows.length,
            endvermoegen: zweiStellen(historisch.summary.endWealth),
            entnahmen: zweiStellen(historisch.summary.totalWithdrawal),
            steuern: zweiStellen(historisch.summary.totalTaxes),
            sha256: hash({ rows: historisch.rows, outcome: historisch.outcome })
        };
        ergebnisse[`monteCarlo-${id}`] = await monteCarlo(inputs, false);
        if (id === 'max-erika') ergebnisse['monteCarlo-cape-max-erika'] = await monteCarlo(inputs, true);
    }
    return {
        beschreibung: 'Ergebnis-Schnappschüsse des Live-Stands (Backtests bis zum Endjahr, Monte Carlo); neu erzeugt mit npm run jahresdaten:sollwerte',
        testdatum: LIVE_TESTDATUM,
        datenstand: liveDatenstand(),
        ergebnisse
    };
}
