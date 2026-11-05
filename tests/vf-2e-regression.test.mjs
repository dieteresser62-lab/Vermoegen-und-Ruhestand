import { readFileSync } from 'node:fs';
import { MemoryWebStorage } from './helpers/persistence-area-backends.mjs';
import { careSettingsStorage, readProfileCareSettings } from '../app/shared/care-profile-settings.js';
import { careTodayFromStorage, careTodayFromRecord, normalizeCareToday } from '../app/profile/profile-care.js';
import { careSettingsFromRecord, normalizeCareForm, careFormForPerson, careAllowanceAnnual } from '../app/shared/care-benefits.js';
import { migrateStoredCareForms, showCareFormsMigrationNotice } from '../app/profile/profile-care-migration.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { homeRentForYear, sellHomesForEmergency } from '../app/simulator/simulator-home-sale.js';
import { probelaufDomainChecksum } from '../app/shared/probelauf-records.js';
import { TransactionEngine } from '../engine/transactions/TransactionEngine.mjs';
import { finalizeThreeBucketAction } from '../engine/transactions/three-bucket-logic.mjs';
import { netPersonalAction, netActionEntries, sumPersonalActions, threeBucketActionTrades } from '../engine/transactions/net-action.mjs';
import { summarizeBalanceAction, summarizeThreeBucketAction } from '../app/balance/balance-action-summary.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { protocolActionShortText, renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { buildBacktestColumnDefinitions } from '../app/simulator/simulator-main-helpers.js';
import { analyzeMonteCarloScenario } from '../app/simulator/log-analysis-events.js';
import { describeLogAnalysisEvent } from '../app/simulator/log-analysis-texts.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { beginPersonalTaxYear, personalCashInvestmentProfiles, attributeSimulatorAction } from '../app/simulator/simulator-personal-tax.js';
import { combineSimulatorProfiles, buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { EngineAPI } from '../engine/index.mjs';
import { settleTaxYear } from '../engine/tax-settlement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { inputs as replayInputs } from './extended/parity-replay-fixture.mjs';

const store = new MemoryWebStorage();
const registry = { version: 1, profiles: {
    a: { meta: { belongsToHousehold: true }, data: { sim_pflegeKostenStaffelPreset: 'custom', sim_pflegeStufe3Form: 'family' } },
    b: { meta: { belongsToHousehold: true }, data: { profile_care_grade_today: '3', sim_pflegeStufe3Form: 'residential' } },
    c: { meta: { belongsToHousehold: false }, data: { sim_pflegeKostenStaffelPreset: 'custom', profile_care_grade_today: '2', profile_care_form_today: 'family' } }
} };
store.setItem('rs_profiles_v1', JSON.stringify(registry)); store.setItem('rs_current_profile', 'b');
store.setItem('profile_care_grade_today', '3'); store.setItem('sim_pflegeStufe3Form', 'residential');
assertEqual(readProfileCareSettings(store, 'c').preset, 'custom', '1 Außenperson verwendet eigene Einstellungen');
assertEqual(careTodayFromStorage(store).form, 'family', '2 Personenkarte löst fehlende Form mit der Hauptstaffel auf');
const records = createMusterHaushaltRecords('2026-10-23', 'max-erika');
const people = Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([profileId, p], i) => ({ profileId,
    data: { ...p.data, ...(i === 0 ? { sim_pflegeStufe3Form: 'family' } : { profile_care_grade_today: '3', profile_care_form_today: '' }) } }));
const combined = combineSimulatorProfiles(people.map(p => ({ ...p, inputs: buildSimulatorInputsFromProfileData(p.data, { referenceYear: 2026 }) })), people[0].profileId, { planValues: null }).combined;
assertEqual(combined.partner.careToday.form, 'family', '2 Simulator verwendet für Person 2 denselben Rückfall');
const withoutRecords = combineSimulatorProfiles(people.map(p => ({ profileId: p.profileId, inputs: buildSimulatorInputsFromProfileData(p.data, { referenceYear: 2026 }) })), people[0].profileId, { planValues: null }).combined;
assertEqual(withoutRecords.partner.careToday.form, 'family', '2 Direkter Profilmerge ohne doppelte Records verwendet dieselbe Staffel');
const source = careSettingsStorage(store); source.setItem('sim_pflegeStufe3Form', 'home-support');
assertEqual(JSON.parse(store.getItem('rs_profiles_v1')).profiles.a.data.sim_pflegeStufe3Form, 'home-support', '3 Simulator schreibt Pflegeeinstellungen ins Hauptprofil');
assertEqual(store.getItem('sim_pflegeStufe3Form'), 'residential', '3 Pflegeeinstellungen werden nicht auf die aktive Person 2 geschrieben');
store.setItem('rs_profiles_v1', '{kaputt');
assert(!migrateStoredCareForms(store).changed, '4 Defekte Registry bleibt der Recovery vorbehalten');
store.setItem('rs_profiles_v1', JSON.stringify(registry)); store.removeItem('rs_current_profile'); store.setItem('rs_active_profile', 'b');
assert(migrateStoredCareForms(store).changed, '4 Migration erkennt auch rs_active_profile');
const shown = [], doc = { createElement: () => ({}), body: { prepend: p => shown.push(p) } };
assert(showCareFormsMigrationNotice(doc, store), '4 Hinweis meldet die nötige dauerhafte Speicherung');
const durable = new MemoryWebStorage(Object.fromEntries(store.records));
showCareFormsMigrationNotice(doc, durable);
assertEqual(shown.length, 1, '4 Nach Speichern und Neustart erscheint der Hinweis genau einmal');
assertEqual(normalizeCareToday({ grade: 0, form: 'family' }).form, undefined, '5 Keiner ignoriert gespeicherte Form');
assertEqual(careTodayFromRecord({ profile_care_grade_today: '0', profile_care_form_today: 'external' }).form, undefined, '5 Auch externe Altform bei keinem Grad wird ignoriert');
for (const grade of [1, 2, 3, 4, 5]) assertEqual(normalizeCareForm('unbekannt', grade), normalizeCareForm(null, grade), '6 Unbekannte Form fällt auf Grad-Vorgabe');
assertEqual(careAllowanceAnnual({ grade: 2, careForm: 'unbekannt' }), 347 * 12, '6 Auch die Geldableitung normalisiert unbekannte Formen');
// Punkt 7 prüft care-forms.test.mjs über beide produktiven Importe und echten Neustart.
const official = { pflegeKostenStaffelPreset: 'amtlich', careToday: { grade: 4, form: 'family' }, pflegeGradeConfigs: { 4: { careForm: 'home-support' } } };
assertEqual(careFormForPerson({ ...official, careToday: null }, 4, 0), 'residential', '8 Amtlich ignoriert ausgeblendete Formen');
assertEqual(careFormForPerson(official, 4, 0), 'family', '8 Bekannte heutige Form bleibt eine persönliche Wohnsituation');
const rentPortfolio = { homeRent: { amount: 12000, inflationFactor: 1 } };
const household = { p1Alive: true, p2Alive: false, care: { p1: { active: true, grade: 4 }, p2: { active: false } } };
assertEqual(homeRentForYear(rentPortfolio, { partner: { aktiv: true } }, household, 1, { survivor: { deathYearIndex: 2 } }, 2), 6000, '9 Miete im Todesjahr einer zu Hause lebenden Person zählt halb');
assertEqual(homeRentForYear(rentPortfolio, { partner: { aktiv: true } }, household, 1, { survivor: { deathYearIndex: 2 } }, 3), 0, '9 Folgejahr ohne zu Hause lebende Person hat keine Miete');
assertEqual(probelaufDomainChecksum({ household_care_forms_notice_v1: 'pending' }), probelaufDomainChecksum({ household_care_forms_notice_v1: 'shown' }), '10 Hinweis ist keine Nutzeränderung');
// 11: Der vorhandene Eingangs-Guard macht den von Flash behaupteten Zugriff unerreichbar.
const directSource = readFileSync(new URL('../app/simulator/simulator-engine-direct/year-entry.js', import.meta.url), 'utf8');
assert(directSource.indexOf('if (!inputs.home?.some') < directSource.indexOf('const availableHomes = inputs.home.filter'), '11 Fehlende Immobilien werden vor filter abgefangen');
assert(directSource.includes('let count = alreadySold + 1'), '12 Wiederholung beginnt nach den bereits verkauften Immobilien');
const events = analyzeMonteCarloScenario({ characteristic: [{ key: 'p50', failed: true, logDataRows: [{ jahr: 1, recordType: 'terminal_ruin', financiallyEvaluable: false, ruin_reason: 'Gesamtvermögen (-500) < Floor (10000)' }] }] }, 'p50');
assert(events.events.some(e => e.type === 'ruin' && e.evidence?.reasonCode === 'wealth_below_floor'), '13 Negatives Vermögen erhält den fachlichen Ruingrund');
const ruin = describeLogAnalysisEvent({ type: 'ruin', source: 'monte_carlo', year: 1, evidence: { causeAvailable: true, reason: 'Steuer im Haushalt ungedeckt' } });
assert(JSON.stringify(ruin).includes('Steuer') && !JSON.stringify(ruin).includes('weil steuer'), '14 Substantiv im Ruingrund bleibt groß');
const renderer = new ActionRenderer({ outputs: {} }); renderer.profileActionResults = [{ profileId: 'a', action: { quellen: [{ kind: 'liquiditaet', brutto: 1 }] }, input: { tagesgeld: 7 } }, { profileId: 'b', action: {}, input: { tagesgeld: 9 } }];
const previousWindow = globalThis.window;
globalThis.window = { __profilverbundProfileSummaries: [{ profileId: 'a', tagesgeld: 7 }, { profileId: 'b', tagesgeld: 9 }] };
assertEqual(renderer._playExecutionEntries({}, {}, {}, 0, { to: 'Geldmarkt-ETF', amount: 8 })[0].input.tagesgeld, 7, '15 Cashumschichtung verwendet instanzeigene Eingaben');
globalThis.window = previousWindow;
assert(readFileSync(new URL('../css/personen-vermoegen.css', import.meta.url), 'utf8').includes('white-space: nowrap'), '16 Pflegebeschriftung bleibt einzeilig');
assert(readFileSync(new URL('../simulator.css', import.meta.url), 'utf8').includes('min-width: 360px'), '17 Pflegeformen erhalten den benötigten Platz');
const homesSource = readFileSync(new URL('../app/tranches/tranchen-manager-immobilien.js', import.meta.url), 'utf8');
assert(!homesSource.includes('Verkauf im Simulator:'), '18 Immobilienkopf enthält nur Betrag und Vermögenshinweis');
const lots = [{ schemaVersion: 2, taxExempt: false, trancheId: 'eq', type: 'aktien_neu', category: 'equity', marketValue: 300000, costBasis: 100000, tqf: .3, purchaseDate: '2020-01-01' },
    { schemaVersion: 2, taxExempt: false, trancheId: 'bd', type: 'anleihe', category: 'bonds', marketValue: 20000, costBasis: 20000, tqf: 0, purchaseDate: '2020-01-01' }];
const input = { floorBedarf: 12000, flexBedarf: 8000, renteAktiv: false, renteMonatlich: 0, depotwertAlt: 0, depotwertNeu: 300000, goldWert: 0, goldAktiv: false,
    sparerPauschbetrag: 0, kirchensteuerSatz: 0, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 10, liquidityRunwayYears: 5, detailledTranches: lots,
    decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: -15 } };
const action = TransactionEngine.determineAction({ aktuelleLiquiditaet: 0, depotwertGesamt: 320000, zielLiquiditaet: 100000,
    market: { sKey: 'recovery_in_bear', szenarioText: 'Erholung' }, spending: { monatlicheEntnahme: 2000 }, minGold: 0, profil: {}, input });
const finish = (pending, tranches = lots, extra = {}) => finalizeThreeBucketAction({ detailedTranches: tranches, engineInput: { ...input, ...extra },
    market: { sKey: 'recovery_in_bear' }, pendingAction: pending, realReturnEq: .05, annualWithdrawalTarget: 20000,
    currentBondValuation: tranches.filter(t => t.category === 'bonds').reduce((s, t) => s + t.marketValue, 0) });
const protectedResult = finish(action);
assert(protectedResult.updatedAction.bondPayoutProtection && protectedResult.threeBucketState.bondRefillNet === 0, '19 Auch Puffer-Schutz wird aus Anleihen ohne Rückfüllung bezahlt');
const emptyResult = finish(action, lots.slice(0, 1));
assert(!emptyResult.updatedAction.bondPayoutProtection && emptyResult.threeBucketState.bondRefillNet > 0, '20 Leerer Anleihentopf hinterlässt keine Auszahlungssperre');
const good = TransactionEngine.determineAction({ aktuelleLiquiditaet: 0, depotwertGesamt: 320000, zielLiquiditaet: 100000,
    market: { sKey: 'side_long', szenarioText: 'Seitwärts' }, spending: { monatlicheEntnahme: 2000 }, minGold: 0, profil: {}, input });
assert(good.quellen.some(q => q.category === 'bonds' && q.brutto > 0), 'VF-2f Reguläre Auszahlung nutzt auch im guten Jahr den Anleihentopf');
// Eine ausbleibende reguläre Aktion erzwingt den persönlichen Auszahlungsweg.
const payoutInputs = { ...structuredClone(replayInputs), dynamicFlex: false, simulationSourceProfileId: 'a',
    simulationPeople: [{ profileId: 'a', tagesgeld: 0, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 }],
    goldStrategyDiagnostics: undefined, startVermoegen: 400000, depotwertAlt: 0, einstandAlt: 0,
    tagesgeld: 0, geldmarktEtf: 0, startFloorBedarf: 12000, startFlexBedarf: 0, minimumFlexAnnual: 0,
    renteMonatlich: 0, partner: { aktiv: false }, startSPB: 0, decumulation: input.decumulation,
    detailledTranches: lots.map(lot => ({ ...lot, sourceProfileId: 'a',
        ...(lot.category === 'bonds' ? { marketValue: 100000, costBasis: 100000 } : {}) })) };
const payoutEngine = { ...EngineAPI, simulateSingleYear(...args) {
    const result = EngineAPI.simulateSingleYear(...args);
    result.ui.action = { type: 'NONE', quellen: [], verwendungen: {}, steuer: 0, nettoErlös: 0,
        taxRawAggregate: { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 },
        taxSettlement: settleTaxYear({ rawAggregate: { sumRealizedGainSigned: 0, sumTaxableAfterTqfSigned: 0 },
            sparerPauschbetrag: 0, kirchensteuerSatz: 0 }).details };
    return result;
} };
const payoutYear = simulateOneYear(initMcRunState(payoutInputs, 100), payoutInputs,
    { jahr: 2000, rendite: 0, bond_return: 0, gold_eur_perf: 0, zinssatz: 0, inflation: 0, lohn: 0 },
    0, null, 0, null, 1, payoutEngine);
assertEqual(payoutYear.kind, 'success', 'VF-2f Simulator finanziert die persönliche Auszahlung');
assert(payoutYear.logData.vk.vkBnd > 0, 'VF-2f Persönlicher Simulatorweg verkauft Anleihen');
assert(payoutYear.logData.vk.vkAkt <= 1000.01, 'VF-2f Aktienverkauf bleibt auf den bestehenden Monatspuffer begrenzt');
const goldRebalance = finish({ type: 'TRANSACTION', quellen: [{ trancheId: 'gold', kind: 'gold', category: 'gold', brutto: 10000, netto: 10000, steuer: 0 }], nettoErlös: 10000, steuer: 0, verwendungen: { aktien: 10000 } }, [...lots, { ...lots[0], trancheId: 'gold', type: 'gold', category: 'gold', marketValue: 10000, costBasis: 10000, tqf: 0 }]);
assert(goldRebalance.updatedAction.verwendungen.bonds > 0, '22a Goldüberband füllt vor dem Aktienkauf die Anleihenlücke');
const idle = { type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0 };
assert(finish(idle, lots.slice(0, 1), { decumulation: { ...input.decumulation, bondRefillThreshold: 100 } }).threeBucketState.bondRefillNet > 0, '22b Auch Schwelle 100 füllt den vollständig geleerten Topf');
assertEqual(finish(idle, [{ ...lots[0], marketValue: 10000, costBasis: 10000 }]).threeBucketState.bondRefillNet, 0, '22c Bestehender Schutz eines Jahresbedarfs bleibt erhalten');
const portfolio = initializePortfolio({ tagesgeld: 520, geldmarktEtf: 0, simulationSourceProfileId: 'a', simulationPeople: ['a', 'b'].map(profileId => ({ profileId, tagesgeld: 260, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 })), tranches: [] });
beginPersonalTaxYear(portfolio);
const capacities = personalCashInvestmentProfiles(portfolio, {}, [], { minimum: 500, isSavingsYear: true });
assert(capacities.every(p => p.capacity === 0), '22 Mindestanlage gilt für jede Person, auch wenn die Haushaltssumme 500 überschreitet');
const net = netPersonalAction({ type: 'TRANSACTION', nettoErlös: 17000, steuer: 300, quellen: [{ kind: 'anleihe', brutto: 15000, netto: 14700, steuer: 300 }, { kind: 'liquiditaet', brutto: 2300, netto: 2300, steuer: 0 }], verwendungen: { bonds: 17000 } });
assertEqual(net.verwendungen.bonds, 2000, '23 Verrechneter Kauf wird auch so gebucht');
assertEqual(net.steuer, 0, '23 Entfallener Verkauf verursacht keine Steuer');
assert(!sumPersonalActions({ bondPayoutProtection: true }, [{ action: net }]).bondPayoutProtection, '20 Nach vollständiger Verrechnung bleibt kein leeres Schutzmerkmal');
assertEqual(net.quellen[0].brutto, 2000, '23 Liquiditätsquelle entspricht dem Nettokauf');
assertEqual(summarizeBalanceAction({}, { quellen: [{ kind: 'liquiditaet', brutto: 1000 }], verwendungen: { bonds: 995, liquiditaet: 5 } }).extraTransfer, 0, '23 Cashrundungsrest erfindet keine Tagesgeldumschichtung');
assertEqual(summarizeThreeBucketAction([], { verb: 'Umschichten', amount: 1000, purpose: 'alt' }).purpose, '', '23 Reiner Transfer hat keinen Wertpapierzweck');
const trades = threeBucketActionTrades([{ name: 'Max', action: { quellen: [{ kind: 'anleihe', brutto: 1000 }] } }, { name: 'Erika', action: { verwendungen: { bonds: 1000 } } }]);
const text = protocolActionShortText({ threeBucketTrades: trades }, { strategyMode: '3_bucket_jilge' });
assert(text.includes('Max: Anleihen verkaufen') && text.includes('Erika: Anleihen kaufen'), '23 Protokoll verrechnet verschiedene Personen nicht gegeneinander');
const row = { jahr: 2026, row: { vk: { vkBnd: 10000 }, bondRefillNet: 12000, bondRefillGross: 13000 } };
const columns = buildBacktestColumnDefinitions('normal', { strategyMode: '3_bucket_jilge' });
const bond = columns.find(c => c.header === 'Handl.Bd');
assert(bond && bond.extractor(row) === -2000 && bond.cellClass(row) === 'backtest-trade-buy', '23 Backtest und CSV lesen den Nettohandel aus demselben Extractor');

const taxNet = netActionEntries([{ input: { sparerPauschbetrag: 1000, kirchensteuerSatz: 0 }, action: {
    type: 'TRANSACTION', steuer: 527.5, nettoErlös: 14472.5,
    quellen: [{ kind: 'aktien_neu', brutto: 15000, netto: 14472.5, steuer: 527.5, realizedGainSigned: 3000, taxableAfterTqfSigned: 3000 }],
    verwendungen: { aktien: 13000, liquiditaet: 1472.5 }, taxSettlement: { lossCarryStart: 0 } } }])[0].action;
assertEqual(taxNet.steuer, 0, '23 Nach Teilverrechnung deckt der Pauschbetrag den Restgewinn; keine proportionale Altsteuer');
assertClose(taxNet.verwendungen.liquiditaet, 2000, .01, '23 Steuererstattung erhöht den richtigen Nettoerlös');
