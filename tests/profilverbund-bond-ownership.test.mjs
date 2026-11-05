import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { buyPlannedBonds } from '../app/simulator/simulator-bond-refill.js';
import { ntInputs } from './helpers/nt-1a-fixture.mjs';
import { parameters } from './helpers/ek-1b-measurement.mjs';
import { runFixture } from './extended/parity-replay-fixture.mjs';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';

const people = ['a', 'b'].map(profileId => ({ profileId, name: `Person ${profileId.toUpperCase()}`,
    hasExplicitTrancheOverride: true, inputs: { depotwertNeu: 100000, tagesgeld: 0,
        geldmarktEtf: 0, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, liquidityRunwayYears: 5 },
    tranches: profileId === 'a' ? [{ trancheId: 'anleihen-a', category: 'bonds', type: 'anleihe',
        marketValue: 50000, costBasis: 40000, tqf: 0 }] : [] }));
// Geplante Person B besitzt keine Anleihen. Steuer-Rohdaten sind vorhanden,
// aber eine Quelle ohne konkrete Tranche darf keinen Bestand erfinden.
const action = { type: 'TRANSACTION', verwendungen: { liquiditaet: 9000 }, quellen: [{
    sourceProfileId: 'b', kind: 'anleihe', category: 'bonds', brutto: 10000,
    realizedGainSigned: 2000, taxableAfterTqfSigned: 2000
}] };
for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    const before = JSON.stringify({ people, action });
    const result = attributeHouseholdAction({ profiles: people, householdAction: action, mode });
    assert(result.finalAction.quellen.length > 0, `${mode}: Anleihenverkauf findet statt`);
    assert(result.finalAction.quellen.every(source => source.sourceProfileId === 'a'
        && source.category === 'bonds' && source.tqf === 0), `${mode}: nur tatsächlicher Anleihenbesitzer A verkauft`);
    assertClose(result.finalAction.nettoErlös, 9000, .01, `${mode}: bestehende Netto-Verwendung erfüllt`);
    assertEqual(JSON.stringify({ people, action }), before, `${mode}: Eingaben unverändert`);
}
for (const invalid of ['no-lot', 'invalid-tqf']) {
    const profiles = structuredClone(people);
    if (invalid === 'no-lot') profiles[0].tranches = [];
    else delete profiles[0].tranches[0].tqf;
    let message = '';
    try { attributeHouseholdAction({ profiles, householdAction: action }); } catch (error) { message = error.message; }
    assert(message.includes('Datenfehler') && message.includes('Person') && message.includes('Anleihen'), `${invalid}: echter Datenfehler nennt Person und Anlageklasse`);
    assert(message.includes(invalid === 'no-lot' ? 'Person B' : 'Person A'), `${invalid}: passende Person genannt`);
    assert(!/manuell|bestätig|eingeben/i.test(message), `${invalid}: keine unmögliche Eingabe verlangt`);
}
// Gold behält die vom konkreten Lot stammende Person, ohne Sonderzuordnung.
const goldPeople = structuredClone(people);
goldPeople[0].tranches[0] = { ...goldPeople[0].tranches[0], category: 'gold', type: 'gold', taxExempt: true };
const gold = attributeHouseholdAction({ profiles: goldPeople, householdAction: { ...action,
    quellen: [{ ...action.quellen[0], sourceProfileId: 'a', kind: 'gold', category: 'gold' }] } });
assert(gold.finalAction.quellen.every(source => source.sourceProfileId === 'a' && source.category === 'gold'), 'Gold bleibt beim tatsächlichen Besitzer');

const auto = { depotTranchesAktien: [], simulationSourceProfileId: 'a' };
buyPlannedBonds(auto, 50000);
assertEqual(auto.depotTranchesAktien[0].tqf, 0, 'Neu aufgefüllte Anleihentranche trägt die vorgeschriebene Teilfreistellung 0');

const inputs = await ntInputs('helga-werner', { singleBondOwner: true });
assertEqual([...new Set(inputs.detailledTranches.filter(lot => lot.category === 'bonds').map(lot => lot.sourceProfileId))].join(),
    'muster_helga', 'Synthetisches Paar: nur Person A besitzt anfangs Anleihen');
let sales = 0;
// Ohne Auffüllung kann B auch später keine Anleihen erwerben; so lässt sich
// die Verkaufszuordnung über den ganzen historischen Pfad prüfen.
const noRefill = { ...inputs, decumulation: { ...inputs.decumulation, bondTargetFactor: 0 } };
const historical = runFixture({ input: noRefill, selectedPeriod: { startYear: 2000, endYear: 2025 },
    simulate(...args) {
        const result = simulateOneYear(...args);
        const sources = result.ui?.action?.quellen?.filter(source => source.category === 'bonds') || [];
        sales += sources.length;
        assert(sources.every(source => source.sourceProfileId === 'muster_helga'), 'Backtest: jeder Anleihenverkauf gehört Person A');
        return result;
    } });
assertEqual(historical.outcome.kind, 'completed', 'Ein Anleihenbesitzer: Backtest 2000–2025 läuft durch');
assertEqual(historical.rows.length, 26, 'Alle 26 historischen Jahre gerechnet');
assert(sales > 0, 'Backtest hat echte Anleihenverkäufe geprüft');
// Der gemeldete Musterfall einschließlich Auffüllung prüft neu erzeugte Lots.
const withRefill = runFixture({ input: inputs, selectedPeriod: { startYear: 2000, endYear: 2025 } });
assertEqual(withRefill.outcome.kind, 'completed', 'Auch mit späterer Auffüllung bei beiden Personen kein technischer Abbruch');
const mc = await runMonteCarloChunk({ inputs, engine: EngineAPI,
    monteCarloParams: { ...parameters, anzahl: 200 }, widowOptions: inputs.widowOptions,
    useCapeSampling: false, runRange: { start: 0, count: 200 }, logIndices: Array.from({ length: 200 }, (_, i) => i) });
assertEqual(mc.technicalInventory.technicalError, 0, 'Ein Anleihenbesitzer: 200 MC-Läufe ohne technischen Fehler');
assertEqual(mc.technicalInventory.financiallyEvaluable, 200, 'Alle 200 Pfade finanziell auswertbar');
assert(mc.runMeta.some(run => run.logDataRows.some(row => row.vk?.vkBnd > 0)), 'MC-Gegenprobe enthält tatsächlich Anleihenverkäufe');
