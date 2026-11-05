import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { settleTaxYear } from '../engine/tax-settlement.mjs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState } from '../app/simulator/simulator-engine-helpers.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { beginPersonalTaxYear, recordPersonalDisposal, settlePersonalTaxYear, payPersonalExtraCost } from '../app/simulator/simulator-personal-tax.js';
import { syncPersonalLiquidity, personalProfiles, personalWithdrawalPlan } from '../app/simulator/simulator-personal-accounts.js';
import { reconcileWithdrawalLiquidity } from '../app/profile/profilverbund-balance.js';
import { attributeHouseholdAction, reconcileAttributedThreeBucketState } from '../app/profile/profilverbund-action-attribution.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { analyzeScenario } from '../app/simulator/log-analysis-events.js';
const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const close = (a, b, message) => assertClose(a, b, 1e-7, message);
const equity = (profileId, value = 10000, cost = value / 2) => ({ schemaVersion: 2, trancheId: `equity-${profileId}`, sourceProfileId: profileId,
    type: 'aktien_neu', category: 'equity', marketValue: value, costBasis: cost, tqf: .3, taxExempt: false,
    shares: value / 100, currentPrice: 100, purchasePrice: 100 * cost / value, purchaseDate: '2020-01-01' });
const account = (profileId, tagesgeld = 0, spb = 0) => ({ profileId, tagesgeld, sparerPauschbetrag: spb,
    kirchensteuerSatz: 0, taxState: { lossCarry: 0 } });
function portfolio() {
    return { personAccounts: [account('a')], simulationSourceProfileId: 'a', depotTranchesAktien: [],
        depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [] };
}
function inputsFor() {
    const inputs = structuredClone(fixture);
    Object.assign(inputs, { home: [], startFloorBedarf: 24000, startFlexBedarf: 0, minimumFlexAnnual: 0, dynamicFlex: false,
        renteMonatlich: 0, rente1: 0, rente2: 0, detailledTranches: [], fixedIncome: [], tagesgeld: 200000, geldmarktEtf: 0,
        startVermoegen: 200000, accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 3,
        partnership: { status: 'unmarried', inheritance: { muster_a: 0 } }, healthBucket: { enabled: false } });
    Object.assign(inputs.partner, { brutto: 0, monatsrente: 0 });
    inputs.simulationPeople.forEach(person => Object.assign(person, { tagesgeld: 100000, geldmarktEtf: 0, sparerPauschbetrag: 0 }));
    return inputs;
}
// B1: Tagesgeld und vorhandenes Geldmarktguthaben vor anderem Depot.
for (const cashAlreadyRaised of [false, true]) {
    const p = portfolio();
    p.depotTranchesGeldmarkt = [{ trancheId: 'mm', sourceProfileId: 'a', marketValue: 10000, costBasis: 5000,
        type: 'geldmarkt', category: 'money_market', tqf: 0 }];
    p.depotTranchesAktien = [equity('a')];
    syncPersonalLiquidity(p); beginPersonalTaxYear(p);
    const payment = payPersonalExtraCost(p, 'a', 1000, { items: [] }, { steuer: 0 }, { cashAlreadyRaised });
    close(p.depotTranchesAktien[0].marketValue, 10000, 'B1: keine Aktien verkauft, solange Geldmarkt reicht');
    close(payment.extraTax, 1000 * .131875 / (1 - .131875), 'B1: Geldmarkt-Folgesteuer vollständig berechnet');
    close(payment.shortfall, 0, 'B1: Zahlung und Folgesteuer gedeckt');
}
// B2: Partnerfreibetrag und Verlustausgleich bleiben im abgeschlossenen Sterbejahr gültig.
for (const loss of [false, true]) {
    const p = portfolio(); p.personAccounts = [account('a', 10000, loss ? 0 : 1000), account('b', 0, loss ? 0 : 1000)];
    syncPersonalLiquidity(p); const book = beginPersonalTaxYear(p);
    recordPersonalDisposal(p, { sourceProfileId: 'a', tqf: 0 }, 1500, 0);
    if (loss) recordPersonalDisposal(p, { sourceProfileId: 'b', tqf: 0 }, 1000, 3000);
    const action = {};
    settlePersonalTaxYear({ portfolio: p, book, personalInterest: { items: [] }, actionResult: action,
        regularSaleScale: 0, forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false, inputs: { jointAssessment: true } });
    p.personAccounts = p.personAccounts.slice(0, 1);
    const paid = payPersonalExtraCost(p, 'a', 1000, { items: [] }, action);
    close(paid.extraTax, 0, 'B2: Zusammenveranlagung bleibt auch nach Kontenübertrag erhalten');
    close(action.steuer, 0, 'B2: keine nachträgliche Einzelsteuer');
    assert(action.personalAnnualTaxes.every(tax => tax.details.jointAssessment === true), 'B2: beide Jahressteuerbelege gemeinsam abgerechnet');
}
// B11: Tod in der Ansparphase überträgt oder entfernt den Nachlass im selben Jahr.
for (const status of ['unmarried', 'married']) {
    const inputs = inputsFor(); inputs.partnership = status === 'unmarried' ? inputs.partnership : { status };
    const death = { p1Alive: false, p2Alive: true };
    const first = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, death, 1, EngineAPI);
    assertEqual(first.kind, 'success', 'B11: Anspar-Todesjahr auswertbar');
    close(first.logData.abgang_erben, status === 'unmarried' ? 100000 : 0, 'B11: Nachlassquote im selben Jahr angewandt');
    assertEqual(first.newState.portfolio.personAccounts.length, 1, 'B11: nur überlebendes Konto bleibt');
    assertEqual(first.newState.survivor.deathYearIndex, 0, 'B11: Todesjahr fortgeschrieben');
    close(first.logData.portfolio_flow_delta, 0, 'B11: Nachlass im Vermögensfluss erklärt');
    const next = simulateOneYear(first.newState, inputs, year, 1, null, 0, death, 1, EngineAPI);
    assertEqual(next.logData.SurvivorDeathYear, false, 'B11: kein zweiter Nachlass im Folgejahr');
    assertEqual(next.logData.inheritance, undefined, 'B11: keine wiederholte Nachlasszahlung');
}
// B12: Ein Adapter ohne reguläre Auffüllung lässt den vorhandenen Pflegeengpass sichtbar.
{
    const inputs = inputsFor();
    Object.assign(inputs, { accumulationPhase: { enabled: false }, tagesgeld: 40000, startVermoegen: 140000,
        plannedExpensesReferenceYear: 2026, plannedExpenses: [{ id: 'auto', bezeichnung: 'Auto', monat: '2026-04', betrag: 10000 }],
        healthBucket: { enabled: true, initialAmount: 20000, triggerMinGrade: 4, triggerMode: 'OR', coverageMode: 'care_additional_floor_only' } });
    inputs.partner.aktiv = false; inputs.simulationPeople = inputs.simulationPeople.slice(0, 1);
    inputs.simulationPeople[0].tagesgeld = 40000;
    inputs.detailledTranches = [equity('muster_a', 100000)];
    const state = initMcRunState(inputs), p = state.portfolio;
    p.personAccounts[0].tagesgeld = 40000;
    Object.assign(p, { healthBucketConfig: inputs.healthBucket, healthBucketCashAmount: 20000, healthBucketGeldmarkt: 20000,
        healthBucketCashOwners: [{ profileId: 'muster_a', amount: 20000 }], healthBucketTranches: [] });
    syncPersonalLiquidity(p);
    const zero = settleTaxYear({});
    const adapter = { ...EngineAPI, simulateSingleYear(input, lastState) {
        const result = EngineAPI.simulateSingleYear(input, lastState);
        result.ui.action = { ...result.ui.action, type: 'NONE', quellen: [], verwendungen: {}, steuer: 0, nettoErlös: 0,
            taxRawAggregate: { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 }, taxSettlement: zero.details };
        result.newState.taxState = zero.taxStateNext; return result;
    } };
    const result = simulateOneYear(state, inputs, year, 0, null, 12000,
        { p1Alive: true, p2Alive: false, care: { p1: { active: true, grade: 4, zusatzFloorZiel: 12000 } } }, 1, adapter);
    assertEqual(result.kind, 'success', 'B12: geplante Ausgabe und laufender Bedarf gedeckt');
    close(result.logData.health_bucket_used, 9000, 'B12: Reserve deckt den Engpass einschließlich gebundener Liquidität');
    close(result.logData.executedSaleEq, 0, 'B12: kein unnötiger Aktienverkauf');
    close(result.logData.portfolio_flow_delta, 0, 'B12: Reservefreigabe und Ausgabe genau einmal verbucht');
}
// B8: Persönliche Steuer kürzt einen nicht vollständig finanzierbaren Anleihenkauf.
{
    const profiles = ['a', 'b'].map(profileId => ({ profileId, hasExplicitTrancheOverride: true,
        inputs: { tagesgeld: 0, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 },
        tranches: profileId === 'a' ? [equity('a', 1000, 0)] : [] }));
    const action = { type: 'TRANSACTION', steuer: 0, nettoErlös: 1000, verwendungen: { bonds: 800, liquiditaet: 200 },
        quellen: [{ kind: 'aktien_neu', category: 'equity', sourceProfileId: 'a', trancheId: 'a:equity-a',
            brutto: 1000, netto: 1000, steuer: 0, realizedGainSigned: 1000, taxableAfterTqfSigned: 700, tqf: .3 }],
        transactionDiagnostics: { potentialTrade: { netAmount: 1000, liquidityUse: 200, goldUse: 0, equityUse: 0 } } };
    const threeBucket = { is3Bucket: true, isBadYear: false, bondBucketBefore: 0, bondRefillNet: 800, bondRefillGross: 800,
        bondRefillTax: 0, unmetLiquidity: 0, bondSaleAmount: 0, bondBucketAfter: 800 };
    const result = attributeHouseholdAction({ profiles, householdAction: action });
    const state = reconcileAttributedThreeBucketState(threeBucket, action, result.finalAction);
    close(state.bondRefillNet, result.finalAction.verwendungen.bonds, 'B8: Anleihennetto folgt der endgültigen Aktion');
    close(state.bondRefillGross - state.bondRefillTax, state.bondRefillNet, 'B8: Brutto, Steuer und Netto sind ausgeglichen');
    close(result.finalAction.transactionDiagnostics.potentialTrade.netAmount, result.finalAction.nettoErlös, 'B8: Transaktionsdiagnose nachgeführt');
    const runs = evaluateStoredAnnualHousehold({}, profiles, null, { withdrawalMode: 'tax_optimized', engineApi: {
        simulateSingleYear() { return { ui: { action: structuredClone(action), spending: { monatlicheEntnahme: 0 }, threeBucket: structuredClone(threeBucket) }, newState: {} }; }
    } });
    close(runs.threeBucketDiagnosis.bondRefillNet, runs.finalAction.verwendungen.bonds, 'B8: Balance verwendet endgültigen Dreitopfstand');
    assertEqual(runs.householdResult.diagnosis.transactionDiagnostics, runs.finalAction.transactionDiagnostics, 'B8: Balance-Diagnose und Aktion identisch');
}
// B9: Auszahlung verwendet die Bestände nach Verkäufen/Käufen und vor der Zahlung.
for (const mode of ['proportional', 'runway_first']) {
    const inputs = inputsFor(); Object.assign(inputs, { accumulationPhase: { enabled: false }, householdWithdrawalMode: mode });
    inputs.simulationPeople[0].tagesgeld = 0; inputs.detailledTranches = [equity('muster_a', 100000, 100000)];
    inputs.tagesgeld = 100000;
    const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, { p1Alive: true, p2Alive: true }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'B9: Auszahlung erfolgreich');
    const p = structuredClone(result.newState.portfolio), paid = result.logData.personalPayout;
    paid.items.forEach(item => { p.personAccounts.find(person => person.profileId === item.profileId).tagesgeld += item.amount; });
    syncPersonalLiquidity(p);
    const expected = reconcileWithdrawalLiquidity(personalWithdrawalPlan(personalProfiles(p, inputs), paid.total, mode), p.personAccounts);
    paid.items.forEach(item => close(item.planned, expected.items.find(row => row.profileId === item.profileId).withdrawalAmount,
        `B9/${mode}: aktuelle Bestände bestimmen Auszahlungsanteil`));
}
// B10: Derselbe ergänzte Cashtransfer in Haushaltskarte, Personenzeilen und Spielausführung.
for (const buy of [true, false]) {
    const renderer = new ActionRenderer({});
    const entries = ['a', 'b'].map((profileId, index) => ({ profileId, input: { tagesgeld: 50000, geldmarktEtf: 50000,
        detailledTranches: [{ trancheId: 'mm', type: 'geldmarkt', category: 'money_market', marketValue: 50000,
            costBasis: 50000, purchaseDate: '2026-01-01', tqf: 0, taxExempt: false }] },
        targetLiquidity: (buy ? 40000 : 61000) * 5,
        spending: { monatlicheEntnahme: 1000 }, action: { type: 'TRANSACTION', nettoErlös: 1000, steuer: 0,
            quellen: [{ kind: 'aktien_neu', brutto: 1000, netto: 1000, sourceProfileId: profileId }], verwendungen: { liquiditaet: 1000 } } }));
    const before = JSON.stringify(entries);
    const transfer = { from: buy ? 'Tagesgeld' : 'Geldmarkt-ETF', to: buy ? 'Geldmarkt-ETF' : 'Tagesgeld', amount: 20000 };
    renderer.profileActionResults = renderer._integrateProfileCashRebalance(entries, transfer);
    close(renderer._materialProfileActions().reduce((sum, entry) => sum + entry.action.nettoErlös, 0), 22000, 'B10: Transfer in persönlichen Nettosummen enthalten');
    close(renderer.profileActionResults.reduce((sum, entry) => sum + (entry.action.verwendungen[buy ? 'geldmarkt' : 'liquiditaet'] || 0), 0),
        buy ? 20000 : 22000, 'B10: persönliche Verwendungen enthalten den gesamten Transfer');
    assertEqual(JSON.stringify(entries), before, 'B10: Engineprofile bleiben unverändert, wiederholte Anzeige addiert nichts doppelt');
    close(renderer._playExecutionEntries({}, {}, {}, 0, transfer).reduce((sum, entry) => sum + entry.action.nettoErlös, 0), 22000, 'B10: Spielausführung erhält dieselben ergänzten Aktionen');
}
// MC-Ruingrund und Eurobasis: vorhandener Inflationsbeleg statt Terminalnullen.
for (const moneyBasis of ['nominal', 'real']) for (const fallback of [false, true]) {
    const row = { jahr: 11, recordType: 'terminal_ruin', financiallyEvaluable: false, inflation_factor_cum: 2,
        ...(fallback ? { aktionUndGrund: '>>> RUIN <<< Gesamtvermögen (74988) < Floor (124270)' }
            : { ruin_reason: 'Gesamtvermögen (74988) < Floor (124270)' }) };
    const event = analyzeScenario({ failed: true, logDataRows: [row] }, { moneyBasis }).events.find(event => event.type === 'ruin');
    assert(event.evidence.causeAvailable, 'MC: Ruingrund aus Terminalzeile verfügbar');
    assert(event.text.includes(moneyBasis === 'real' ? '37.494' : '74.988') && event.text.includes('Grundbedarf'), 'MC: alltagssprachlicher Grund in gewählter Eurobasis');
}

// Vollständige Ergebnisbytes unbetroffener Fälle stammen aus der Vorhermessung.
{
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const evidence = JSON.parse(readFileSync(new URL('./fixtures/vf-2b-measurement.json', import.meta.url)));
    const inputs = structuredClone(fixture);
    Object.assign(inputs, { home: [], startFloorBedarf: 24000, startFlexBedarf: 0, minimumFlexAnnual: 0, dynamicFlex: false,
        renteMonatlich: 0, rente1: 0, rente2: 0, detailledTranches: [], fixedIncome: [], tagesgeld: 40000, geldmarktEtf: 0,
        startVermoegen: 40000, healthBucket: { enabled: false } });
    Object.assign(inputs.partner, { aktiv: true, brutto: 0, monatsrente: 0 });
    inputs.simulationPeople.forEach(person => Object.assign(person, { tagesgeld: 20000, geldmarktEtf: 0, sparerPauschbetrag: 0 }));
    const quiet = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, { p1Alive: true, p2Alive: true }, 1, EngineAPI);
    const single = structuredClone(inputs); single.partner.aktiv = false; single.simulationPeople = single.simulationPeople.slice(0, 1);
    single.simulationPeople[0].tagesgeld = 0;
    Object.assign(single, { startFloorBedarf: 20000, tagesgeld: 0, startVermoegen: 0, homeReferenceYear: 2026,
        home: [{ id: 'haus', profileId: single.simulationPeople[0].profileId, wert: 300000, stand: '2026-10', nutzung: 'selbst' }] });
    const sale = simulateOneYear(initMcRunState(single), single, year, 0, null, 0, { p1Alive: true, p2Alive: false }, 1, EngineAPI);
    // Historische Referenz erhalten; nur das neue Anzeigefeld aus VF-2l ausnehmen.
    const hash = value => createHash('sha256').update(JSON.stringify(value, (key, item) => ['immobilien_wert_end', 'immobilien_selbst_end', 'immobilien_vermietet_end', 'displayWealth'].includes(key) || key.includes('displayHomeValue') ? undefined : item)).digest('hex');
    assertEqual(quiet.kind, 'success', 'Unbetroffener Paarfall ohne Immobilien und Tod erfolgreich');
    assertEqual(hash(quiet), readQSCReferences(evidence.unchangedCompleteYears[0].noHomeNoDeath), 'Unbetroffener Paarfall: vollständige Ausgabe bytegleich');
    assertEqual(hash(sale), readQSCReferences(evidence.unchangedCompleteYears[0].singleHome), 'Einzelimmobilie: Notverkauf ohne Immobilien-Anzeigefeld bytegleich');
}

// Nachlasssteuer im Ansparjahr kann denselben Einzelverkauf vor Ruin benötigen.
{
    const inputs = inputsFor();
    Object.assign(inputs, { tagesgeld: 0, startVermoegen: 0, homeReferenceYear: 2026,
        partnership: { status: 'unmarried', inheritance: { muster_a: 100 } },
        home: [{ id: 'wohnung', profileId: 'muster_b', wert: 100000, stand: '2026-10', nutzung: 'vermietet' },
            { id: 'haus', profileId: 'muster_a', wert: 300000, stand: '2026-10', nutzung: 'selbst' }] });
    inputs.simulationPeople.forEach(person => { person.tagesgeld = 0; });
    const result = simulateOneYear(initMcRunState(inputs), inputs, year, 0, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Ansparjahr: Notverkauf deckt Nachlasssteuer');
    assertEqual(result.logData.immobilienverkauf_personen.length, 1, 'Ansparjahr: zweiter Verkauf für Steuer nicht nötig');
    assertEqual(result.logData.immobilienverkauf_personen[0].homeId, 'haus', 'Ansparjahr: Eigentum der verstorbenen Person zuerst');
    assert(result.logData.erbschaftsteuer > 0, 'Ansparjahr: Steuer tatsächlich im Todesjahr bezahlt');
    close(result.logData.portfolio_flow_delta, 0, 'Ansparjahr: Steuer und Nachlass ohne doppelten Vermögensfluss');
}
