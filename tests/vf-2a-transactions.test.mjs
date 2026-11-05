import { TransactionEngine } from '../engine/transactions/TransactionEngine.mjs';
import { finalizeThreeBucketAction } from '../engine/transactions/three-bucket-logic.mjs';
import { protocolActionShortText, protocolActionExplanation, renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { threeBucketActionTrades } from '../app/balance/balance-action-summary.js';
import { measurementInputs, backtest, parameters } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';

const input = { floorBedarf: 12000, renteAktiv: false, sparerPauschbetrag: 0,
    decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: -15 } };
const lots = [{ schemaVersion: 2, purchaseDate: '2020-01-01', taxExempt: false, trancheId: 'eq', type: 'aktien_neu', category: 'equity', marketValue: 300000, costBasis: 100000, tqf: .3 },
    { schemaVersion: 2, purchaseDate: '2020-01-01', taxExempt: false, trancheId: 'bd', type: 'anleihe', category: 'bonds', marketValue: 20000, costBasis: 20000, tqf: 0 }];
const finalize = (pendingAction, sKey, realReturnEq) => finalizeThreeBucketAction({ engineInput: input,
    detailedTranches: lots, pendingAction, market: { sKey }, realReturnEq, annualWithdrawalTarget: 20000, currentBondValuation: 20000 });
const payout = { type: 'TRANSACTION', nettoErlös: 10000, steuer: 0,
    quellen: [{ trancheId: 'bd', kind: 'anleihe', category: 'bonds', brutto: 10000, netto: 10000, steuer: 0 }],
    verwendungen: { liquiditaet: 10000 }, taxRawAggregate: { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 } };
for (const regime of ['bear_deep', 'recovery_in_bear']) {
    const result = finalize(payout, regime, .05);
    assertEqual(result.threeBucketState.bondRefillGross, 0, `${regime}: +5 % über dem Auslöser erlaubt keine Aktienauffüllung`);
    assertEqual(result.updatedAction.quellen.length, 1, `${regime}: nur der Auszahlungsverkauf bleibt`);
    assertEqual(result.updatedAction.quellen[0].kind, 'anleihe', `${regime}: Aktien bleiben geschont`);
}
const investment = { type: 'TRANSACTION', nettoErlös: 200000, steuer: 0,
    quellen: [{ kind: 'liquiditaet', brutto: 200000, netto: 200000, steuer: 0 }],
    verwendungen: { aktien: 150000, gold: 50000, liquiditaet: 0 } };
for (const [regime, ret] of [['peak_stable', .1], ['bear_deep', -.2]]) {
    const result = finalize(investment, regime, ret);
    assertClose(result.updatedAction.verwendungen.bonds, 80000, .01, 'Tagesgeld füllt zuerst die Anleihenlücke');
    assertClose(result.updatedAction.verwendungen.gold, 50000, .01, 'Der Rest bedient weiter das Goldziel');
    assertClose(result.updatedAction.verwendungen.aktien, 70000, .01, 'Nur der Rest nach Anleihen und Gold kauft Aktien');
    assert(result.updatedAction.quellen.every(row => row.kind === 'liquiditaet'), 'Kein Aktienverkauf im Aktienkaufjahr, auch beim Ansparen im Bärenmarkt');
    assertClose(result.threeBucketState.bondRefillNet, 80000, .01, 'Anleihenkauf aus Tagesgeld wird vollständig protokolliert');
    assertClose(result.threeBucketState.bondBucketAfter, 100000, .01, 'Zielbestand ist mit Tagesgeld finanziert');
}
const options = { strategyMode: '3_bucket_jilge', inputs: {} };
const row = { jahr: 1, vk: { vkAkt: 20000, vkBnd: 10000, vkGld: 0 }, kaufAkt: 5000,
    bondRefillNet: 12000, bondRefillGross: 13000, aktionUndGrund: 'Auszahlung und Auffüllung' };
const before = JSON.stringify(row);
const text = protocolActionShortText(row, options);
assert(text.includes('Aktien verkaufen') && !text.includes('Aktien kaufen'), 'Handlung enthält nur den Aktiensaldo');
assert(text.includes('Anleihen kaufen') && !text.includes('Anleihen verkaufen'), 'Handlung enthält nur den Anleihensaldo');
assert(text.includes('15.000') && text.includes('2.000'), 'Handlung nennt die tatsächlich auszuführenden Nettobeträge je Klasse');
assert(protocolActionExplanation(row, options).includes('Entnahme aus Anleihen'), 'ⓘ erklärt die gegenläufigen Bewegungen');
assertEqual(JSON.stringify(row), before, 'Anzeige verändert weder Rohfelder noch Exportdaten');
const html = renderProtocolTable([row], options);
assert(html.includes('2.000') && html.includes('Entnahme aus Anleihen'), 'Tabellenspalte und ⓘ verwenden denselben Anleihenkauf');

// VF-2g: Der Personensaldo ergänzt die Begründung, auch bei Unverheirateten.
for (const source of ['mc', 'backtest']) for (const populated of [false, true]) {
    const raw = { ...row, threeBucketTrades: populated
        ? [{ profile: 'Max', label: 'Aktien', net: 12345 }, { profile: 'Erika', label: 'Anleihen', net: -2000 }] : [],
        personalPayoutSales: [{ name: 'Max', share: .6 }, { name: 'Erika', share: .4 }] };
    const entry = source === 'mc' ? raw : { jahr: 2026, row: raw };
    const opts = { ...options, source }, before = JSON.stringify(entry);
    const explanation = protocolActionExplanation(entry, opts);
    assert(explanation.startsWith('Entnahme und Auffüllung'), `${source}: ursprüngliche Begründung bleibt erhalten`);
    assert(explanation.includes('Entnahme aus Anleihen, Anleihentopf aus Aktien wieder aufgefüllt'), `${source}: ⓘ erklärt weiter die Bewegungen`);
    assert(explanation.includes('Nicht verheiratet: Jede Person zahlt ihren Anteil (Max 60 %, Erika 40 %)'), `${source}: persönliche Auszahlungsbegründung bleibt erhalten`);
    if (populated) {
        assert(explanation.replaceAll('\u00a0', ' ').includes('Saldo je Person: Max: Aktien verkaufen 12.345 € · Erika: Anleihen kaufen 2.000 €'), `${source}: ⓘ hängt die Verkäufe und Käufe je Person an`);
    } else {
        const withoutTrades = { ...raw, threeBucketTrades: undefined };
        assertEqual(explanation, protocolActionExplanation(source === 'mc' ? withoutTrades : { jahr: 2026, row: withoutTrades }, opts), `${source}: leere Handelsliste lässt den Erklärtext unverändert`);
    }
    assertEqual(JSON.stringify(entry), before, `${source}: ⓘ verändert keine Rohdaten`);
}
const trades = threeBucketActionTrades([{ name: 'Max', action: { quellen: [
    { kind: 'aktien_neu', brutto: 20000 }, { kind: 'anleihe', brutto: 10000 }],
    verwendungen: { aktien: 5000, bonds: 12000 } } }]);
assertEqual(JSON.stringify(trades.map(row => [row.label, row.net])), JSON.stringify([['Aktien', 15000], ['Anleihen', -2000]]),
    'Balance verwendet denselben Saldo');
const owners = threeBucketActionTrades([{ name: 'Max', action: { quellen: [{ kind: 'aktien_neu', brutto: 10000 }] } },
    { name: 'Erika', action: { verwendungen: { aktien: 10000 } } }]);
assertEqual(owners.length, 2, 'Handel verschiedener Eigentümer wird nicht gegeneinander verrechnet');

// Synthetischer Seitenweg wie im Befund, keine Nutzerdaten.
const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23');
const year = { jahr: 2026, rendite: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0 };
let state = initMcRunState(inputs), explained = false;
for (let index = 0; index < 6; index++) {
    if (index === 1) {
        state.portfolio.personAccounts[0].tagesgeld = 0;
        state.portfolio.personAccounts[1].tagesgeld = 200000;
        syncPersonalLiquidity(state.portfolio);
    }
    const result = simulateOneYear(state, inputs, { ...year, jahr: 2026 + index }, index, null, 0,
        { p1Alive: true, p2Alive: true }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Unverheiratetes Paar bleibt jährlich berechenbar');
    if (index === 0) {
        assert(result.logData.kaufAkt > 0, 'Jahr 1 legt den verbleibenden Überschuss an');
        assertClose(result.logData.vk.vkGes, 0, .01, 'Jahr 1 braucht nach persönlicher Reservierung keinen Verkauf');
        assertClose(result.logData.portfolio_flow_delta, 0, .03, 'Persönliche Reserve erhält die Jahresbilanz');
    }
    if (result.logData.personalPayoutSales?.length) {
        const opts = { inputs }, action = protocolActionShortText(result.logData, opts);
        for (const person of result.logData.personalPayoutSales) assert(action.includes(`${person.name} verkauft`), 'Spätere persönliche Verkäufe nennen die Person');
        assert(protocolActionExplanation(result.logData, opts).includes('%'), 'ⓘ nennt den Vermögensanteil');
        explained = true;
    }
    state = result.newState;
}
assert(explained, 'Auch die spätere FR-48-Verkaufsanzeige wurde tatsächlich durchlaufen');

// Erholung ohne Auszahlung aus Anleihen darf den Topf wieder aufbauen.
{
    const idle = { type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0 };
    const result = finalize(idle, 'recovery_in_bear', .05);
    assert(result.threeBucketState.bondRefillNet > 0, 'Erholung ohne Auszahlung: Aktienauffüllung erlaubt');
    const protectedAction = { ...payout, title: 'Absichtlich anderer Titel', bondPayoutProtection: true };
    const protectedResult = finalize(protectedAction, 'recovery_in_bear', .05);
    assertEqual(protectedResult.threeBucketState.bondRefillGross, 0, 'Expliziter Bären-Auszahlungsauftrag verhindert Auffüllung unabhängig vom Titel');
    const badYear = finalize(idle, 'peak_stable', -.16);
    assertEqual(badYear.threeBucketState.bondRefillGross, 0, 'Rendite unter minus 15 Prozent sperrt weiter');
    const netBuyHtml = renderProtocolTable([row], { ...options, columns: [{ id: 'handl-bd', format: 'money', align: 'right', cellClass: () => 'backtest-trade-sale' }], formatValue: () => 'VERALTET' });
    assert(netBuyHtml.includes('VERALTET'), 'Anleihenspalte verwendet wie alle Geldspalten den übergebenen Formatter');
    const personal = { ...row, vk: { vkAkt: 20000, vkBnd: 0, vkGld: 0 }, kaufAkt: 20000, bondRefillNet: 0, bondRefillGross: 0,
        personalPayoutSales: [{ name: 'Martin', gross: 20000, sources: [{ kind: 'aktien_neu', brutto: 20000 }] }] };
    const text = protocolActionShortText(personal, options);
    assert(text.includes('Martin verkauft') && text.includes('Aktien kaufen'), 'Persönlicher Auszahlungsverkauf wird nicht gegen den Kauf der anderen Person verrechnet');
}

{
    const engineInput = { ...input, flexBedarf: 8000, renteMonatlich: 0, depotwertAlt: 0, depotwertNeu: 300000,
        goldWert: 0, goldAktiv: false, tagesgeld: 40000, geldmarktEtf: 0, kirchensteuerSatz: 0,
        liquidityRunwayYears: 5, maxBearRefillPctOfEq: 10, maxSkimPctOfEq: 10, detailledTranches: lots };
    const market = { sKey: 'recovery_in_bear', szenarioText: 'Erholung', abstandVomAthProzent: 12 };
    const action = TransactionEngine.determineAction({ aktuelleLiquiditaet: 40000, depotwertGesamt: 320000,
        zielLiquiditaet: 100000, market, spending: { monatlicheEntnahme: 2000 }, minGold: 0, profil: {}, input: engineInput });
    assert(action.title.includes('Runway-Notfüllung (Bär)') && action.bondPayoutProtection === true, 'Produktiver Bären-Guardrail setzt das ausdrückliche Aktionsmerkmal');
    const result = finalize(action, market.sKey, .05);
    assertEqual(result.threeBucketState.bondRefillGross, 0, 'Echte Runway-Notfüllung im Bär ohne nachfolgenden Aktienauffüllungsverkauf');
    assert(result.updatedAction.quellen.every(source => source.kind === 'anleihe'), 'Bären-Notfüllung wird aus dem Anleihentopf gedeckt');
}

// Echte 3-Töpfe-Logzeilen aus demselben Seitenweg wie Renates Grundfall.
{
    const inputs = await measurementInputs(0, 'renate', '2026-10-23');
    assertEqual(inputs.decumulation.mode, '3_bucket_jilge', 'Renate Grundfall verwendet drei Töpfe');
    const count = 4;
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI,
        monteCarloParams: { ...parameters, anzahl: count, seed: 12345 },
        widowOptions: inputs.widowOptions, useCapeSampling: false,
        runRange: { start: 0, count }, logIndices: [0, 1, 2, 3] });
    assertEqual(chunk.technicalInventory.technicalError, 0, 'Renates Monte Carlo läuft ohne technische Fehler');
    assertEqual(chunk.runMeta.length, count, 'Alle vier Szenarien liefern echte Logs');
    const historical = backtest(inputs, 2000, 2025);
    assertEqual(historical.outcome.kind, 'completed', 'Renates Backtest 2000–2025 läuft vollständig');
    assertEqual(historical.rows.length, 26, 'Backtest liefert alle 26 Jahreszeilen');
    const logs = [...chunk.runMeta.map(run => ({ source: 'mc', rows: run.logDataRows })),
        { source: 'backtest', rows: historical.rows }];
    for (const { source, rows } of logs) {
        assert(rows.some(row => (row.row ?? row).threeBucketTrades?.length), `${source}: echte Logzeilen enthalten Personensalden`);
        const before = JSON.stringify(rows);
        for (const moneyBasis of ['nominal', 'real']) for (const logDetailLevel of ['normal', 'detailed']) {
            const opts = { source, inputs, strategyMode: inputs.decumulation.mode, moneyBasis, logDetailLevel };
            const table = renderProtocolTable(rows, opts);
            assert(table.includes('Handlung und vollständige Begründung') && table.includes('Saldo je Person:'), `${source}/${moneyBasis}/${logDetailLevel}: echte Jahreszeilen bauen die Tabelle samt Handlungs-ⓘ`);
            assert(table.includes('Anleihentopf'), `${source}/${moneyBasis}/${logDetailLevel}: Erklärung der Topfbewegung bleibt lesbar`);
        }
        assertEqual(JSON.stringify(rows), before, `${source}: Rendern erhält sämtliche Ergebnisbytes`);
    }
}
