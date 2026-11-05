import { readAN1Hash } from './helpers/an-1-expectations.mjs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';
import { calculateFlexRate, applyFlexShareCurve } from '../engine/planners/flex-rate-policy.mjs';
import { evaluateProtectedPortfolioWithdrawal } from '../engine/planners/minimum-flex-policy.mjs';
import { createFlexTraceCollector } from '../engine/planners/flex-trace.mjs';
import { getProtocolColumns, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { protocolActionShortText } from '../app/simulator/protocol-renderer.js';
import { helgaWernerBacktest, pensionStrongInput, unchangedFFE } from './helpers/ff-e-scenarios.mjs';

assertEqual(CONFIG.SPENDING_MODEL.FLEX_SHARE_MIN_PROTECTED_WITHDRAWAL_RATE, .02, 'FR-32: benannte Schwelle bei 2 %');
const first = EngineAPI.simulateSingleYear(pensionStrongInput, null, { includeFlexTrace: true });
assert(!first.error, 'Rentenstarker Haushalt rechnet');
assertClose(first.diagnosis.general.protectedPortfolioWithdrawalRate, .014, 1e-12, 'FR-32 behält die geschützte Quote unabhängig vom neuen FR-20-Auslöser');
assertEqual(first.newState.flexRate, 100, 'Rente deckt über 90 % des Floors: kein Bär und keine S-Kurven-Kürzung');
assertEqual(first.ui.spending.anmerkung, '', 'Ungekürzter Flex hat keine Kürzungsanmerkung');
for (const quote of [.019, .02, .020001, .045]) {
    const entries = [], trace = createFlexTraceCollector(12000);
    const context = { inflatedBedarf: { floor: 2400, flex: 12000 }, gesamtwert: 8400 / quote,
        depotwertGesamt: 8400 / quote, renteJahr: 33600, input: pensionStrongInput,
        market: { sKey: 'side_long' }, runwayMonate: 120,
        lastState: { lastEntnahmeReal: .045 * 8400 / quote, cumulativeInflationFactor: 1 } };
    const result = calculateFlexRate({ flexRate: 100, keyParams: {} }, { active: false }, context,
        (...entry) => entries.push(entry), trace);
    const stage = trace.snapshot().find(e => e.schritt === 'flex_share_curve');
    assertEqual(stage.gegriffen, quote > .02, 'Nur streng über 2 % greift die S-Kurve');
    assertEqual(stage.rateNachher, quote <= .02 ? stage.rateVorher
        : applyFlexShareCurve(stage.rateVorher, context.inflatedBedarf, () => {}, 1).rate,
    'Quote 4,5 % und knapp über 2 % behalten die bisherige Kurvenform');
    assert(Number.isFinite(result.geglätteteFlexRate), 'Leitplanken bleiben berechenbar');
}
assertEqual(evaluateProtectedPortfolioWithdrawal({ inflatedBedarf: { floor: 0 }, gesamtwert: 600000,
    renteJahr: 42000, input: pensionStrongInput }).rate, 0, 'Rentenüberschuss deckt den Mindest-Flex vor dem Depot');
let state = { initialized: true, flexRate: 50, flexRateSmoothingReference: 50, lastEntnahmeReal: 12000,
    cumulativeInflationFactor: 1, lastTotalBudget: 42000, peakRealVermoegen: 600000 };
for (const expected of [70, 90, 100]) {
    const result = EngineAPI.simulateSingleYear({ ...pensionStrongInput, depotwertAlt: 1000000 }, state);
    assertEqual(result.newState.flexRate, expected, 'FR-29/32: 50 % Rückstand in höchstens vier Erholungsjahren aufgeholt');
    state = result.newState;
}
for (const collectEntries of [false, true]) {
    const trace = createFlexTraceCollector(12000, { collectEntries });
    trace.record('flex_share_curve', 100, 45, 'Flex-Anteil');
    trace.record('guardrails', 45, 80, 'Guardrails', { gewaehlteQuelle: 'Budget-Floor' });
    trace.record('final_smoothing', 80, 70, 'Finale Glättung');
    assertEqual(trace.strongestReduction(), 'Flex-Anteil (S-Kurve)', 'Budget-Floor ersetzt den stärksten Kürzungsgrund nicht, auch ohne gespeicherten Trace');
}
const backtest = helgaWernerBacktest();
assertEqual(backtest.outcome.kind, 'completed', 'Helga/Werner: Backtest 2000–2025 vollständig');
const cutYears = backtest.rows.filter(e => e.entscheidung.kuerzungProzent >= 10).map(e => e.jahr);
assertEqual(cutYears.join(), '2002,2003,2004,2005,2008,2009', 'FR-36: sechs Jahre mit mindestens 10 % Kürzung bei 60.000 EUR Haushaltsrücklage');
for (const entry of backtest.rows) {
    const r = entry.row;
    assertClose(r.executedSaleAkt, r.vk.vkAkt, 1e-8, 'Log weist gebuchte Aktienverkäufe separat aus');
    assertClose(r.executedSaleAnl, r.vk.vkBnd, 1e-8, 'Log weist gebuchte Anleihenverkäufe separat aus');
    assert(r.wertAktienEnthaeltAnleihen, 'Legacy-Bestand kennzeichnet enthaltene Anleihen');
    if (r.vk.vkBnd > 0) {
        assert(r.aktionUndGrund.includes('Anleihen verkauft'), 'Log nennt den Anleihenverkauf');
        assert(protocolActionShortText(entry, { source: 'backtest' }).includes('Anleihen verkauft'), 'Protokoll nennt den Anleihenverkauf');
        for (const source of ['mc', 'backtest']) {
            const options = { source, strategyMode: '3_bucket_jilge', logDetailLevel: 'detailed' };
            const cols = getProtocolColumns(options);
            const value = source === 'mc' ? r : entry;
            assertEqual(readProtocolValue(cols.find(c => c.id === 'sale-bonds'), value, options), r.vk.vkBnd, 'Eigene Protokollspalte für Anleihenverkäufe');
            assertClose(readProtocolValue(cols.find(c => c.id === 'neta'), value, options), r.vk.vkAkt - r.kaufAkt, 1e-9, 'Aktienhandel enthält keine Anleihen');
            assertClose(readProtocolValue(cols.find(c => c.id === 'equity'), value, options), r.wertAktien - r.bondBucketAfter, 1e-9, 'Angezeigter Aktienbestand enthält keine Anleihen');
        }
    }
    if (r.entscheidung.kuerzungProzent <= 0) assertEqual(r.entscheidung.anmerkung, '', 'Log ohne Kürzung hat keine Anmerkung');
    else assert(!r.entscheidung.anmerkung.includes('wg. Budget-Floor'), 'Anhebung ist nie Kürzungsgrund');
}

assertEqual(createHash('sha256').update(JSON.stringify(unchangedFFE(calculateFlexRate, createFlexTraceCollector))).digest('hex'),
    readAN1Hash('abb5ea3ca10428cb4b31c82b3a4c60ab022ac36d14654f0549313ae224c725d3'),
    'Sonst bytegleich: zwölf vollständige Flex-Policy-Ergebnisse samt State, Entscheidungen und Trace vor/nach FF-E');

// Vollständige Zustands-/Aktionsobjekte der früheren FF-D-Gegenproben bleiben
// bytegleich; Texte und Diagnosen folgen den ausdrücklich geänderten Regeln.
const { unchangedFFD } = await import('./helpers/ff-d-scenarios.mjs');
const { initMcRunState, simulateOneYear } = await import('../app/simulator/simulator-engine-wrapper.js');
const { readFileSync } = await import('node:fs');
const evidence = JSON.parse(readFileSync(new URL('./fixtures/ff-e-expectation-deltas.json', import.meta.url)));
const samples = unchangedFFD({ engine: EngineAPI, initMcRunState, simulateOneYear });
for (const [key, rows] of Object.entries(samples)) {
    const value = rows.map(r => ({ input: r.input, newState: r.newState, action: r.ui.action }));
    const expected = evidence.unchangedFinancialObjects.groups[key];
    assertEqual(expected.before, expected.after, `${key}: Eingaben, Folgestates und Aktionen vor/nach FF-E bytegleich`);
    assertEqual(createHash('sha256').update(JSON.stringify(value)).digest('hex'), readAN1Hash(expected.before),
        `${key}: vollständige Finanzobjekte ohne Rundung gegen die Vorhermessung`);
}
