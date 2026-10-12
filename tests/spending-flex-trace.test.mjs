import strictAssert from 'node:assert/strict';
import { EngineAPI, _internal_calculateModel } from '../engine/index.mjs';
import { normalizeMonteCarloJsonValue } from '../app/simulator/monte-carlo-contracts.js';
import { SpendingPlanner } from '../engine/planners/SpendingPlanner.mjs';
import { applyFlexShareCurve } from '../engine/planners/flex-rate-policy.mjs';
import { createFlexTraceCollector } from '../engine/planners/flex-trace.mjs';

const base = () => ({
    lastState: null,
    market: { sKey: 'side_long', abstandVomAthProzent: 0 },
    inflatedBedarf: { floor: 24_000, flex: 60_000 },
    runwayMonate: 60,
    profil: {},
    depotwertGesamt: 900_000,
    gesamtwert: 1_000_000,
    renteJahr: 0,
    input: {
        inflation: 0, liquidityRunwayYears: 5,
        floorBedarf: 24_000, flexBedarf: 60_000,
        minimumFlexAnnual: 0, flexBudgetAnnual: 0,
        endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100
    }
});
const previous = (flexRate = 100, alarmActive = false, peakRealVermoegen = 1_000_000) => ({
    initialized: true, flexRate, alarmActive, peakRealVermoegen,
    cumulativeInflationFactor: 1,
    lastTotalBudget: 84_000,
    lastMarketSKey: 'side_long'
});
const bear = p => { p.market = { sKey: 'bear_deep', abstandVomAthProzent: 35 }; };
const lowShare = p => {
    p.inflatedBedarf = { floor: 60_000, flex: 12_000 };
    p.input.floorBedarf = 60_000;
    p.input.flexBedarf = 12_000;
};
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-8, label);
const step = (result, key) => result.spendingResult.flexTrace.find(e => e.schritt === key);

function run(change = () => {}) {
    const source = base();
    change(source);
    const before = structuredClone(source);
    const enabledParams = structuredClone(source);
    const disabledParams = structuredClone(source);
    const enabled = SpendingPlanner.determineSpending(enabledParams);
    const disabled = SpendingPlanner.determineSpending(disabledParams, { includeFlexTrace: false });
    const { flexTrace, ...oldSpending } = enabled.spendingResult;
    strictAssert.deepEqual({ ...enabled, spendingResult: oldSpending }, disabled);
    assert(!Object.hasOwn(disabled.spendingResult, 'flexTrace'), 'Ohne Collector fehlt ausschließlich flexTrace');
    strictAssert.deepEqual(enabledParams, before);
    strictAssert.deepEqual(disabledParams, before);
    strictAssert.deepEqual(source, before);
    assert(!JSON.stringify(enabled.newState).includes('flexTrace'), 'Trace wird nicht persistiert');
    assert(!JSON.stringify(enabled.diagnosis).includes('flexTrace'), 'Bisherige Diagnose bleibt unverändert');
    assert(Object.isFrozen(flexTrace), 'Trace-Liste ist eingefroren');
    let monthly = source.inflatedBedarf.flex / 12;
    let netEffect = 0;
    for (const entry of flexTrace) {
        assert(Object.isFrozen(entry) && Object.isFrozen(entry.kennzahlen), 'Eintrag und Kennzahlen sind eingefroren');
        for (const key of ['rateVorher', 'rateNachher', 'monatsbetragVorher', 'monatsbetragNachher', 'monatswirkungEur']) {
            assert(Number.isFinite(entry[key]), `${entry.schritt}: ${key} ist endlich`);
        }
        assert(Object.values(entry.kennzahlen).every(v => v === null
            || ['string', 'boolean'].includes(typeof v) || (typeof v === 'number' && Number.isFinite(v))),
        'Kennzahlen enthalten ausschließlich kopierte endliche primitive Werte');
        assertEqual(entry.monatsbetragVorher, monthly, 'Monatswertkette ist lückenlos');
        assertEqual(entry.monatswirkungEur, entry.monatsbetragNachher - entry.monatsbetragVorher, 'Monatswirkung hat das tatsächliche Vorzeichen');
        assertEqual(entry.gegriffen, entry.monatswirkungEur !== 0, 'Nur eine wirksame Monatsänderung greift');
        monthly = entry.monatsbetragNachher;
        netEffect += entry.monatswirkungEur;
    }
    const fundedFlex = Math.max(0, enabled.spendingResult.details.endgueltigeEntnahme - source.inflatedBedarf.floor) / 12;
    assertEqual(monthly, fundedFlex, 'Trace endet beim tatsächlich finanzierten Netto-Flex');
    near(source.inflatedBedarf.flex / 12 + netEffect, fundedFlex, 'Anhebungen und Kürzungen schließen als vorzeichenbehaftete Summe');
    assertEqual(flexTrace.at(-1).rateNachher, enabled.newState.flexRate, 'Finale Rate entspricht unverändertem State');
    assertEqual(flexTrace.at(-1).kennzahlen.naechsterGlaettungsankerProzent, enabled.newState.flexRateSmoothingReference,
        'Trace nennt den tatsächlichen Glättungsanker nach Rundung beziehungsweise Notlage');
    const again = SpendingPlanner.determineSpending(structuredClone(source));
    strictAssert.deepEqual(again.spendingResult.flexTrace, flexTrace);
    assert(again.spendingResult.flexTrace !== flexTrace
        && again.spendingResult.flexTrace.every((e, i) => e !== flexTrace[i] && e.kennzahlen !== flexTrace[i].kennzahlen),
    'Aufrufe besitzen unabhängige Trace-Snapshots');
    strictAssert.throws(() => { flexTrace[0].kennzahlen.manipuliert = true; }, TypeError);
    strictAssert.throws(() => { flexTrace.push({}); }, TypeError);
    return enabled;
}

const curve = run();
assert(step(curve, 'flex_share_curve').monatswirkungEur < 0, 'S-Kurve kürzt auch außerhalb des Bärenmarkts');
assertEqual(step(curve, 'raw_target').rateNachher, 100, 'Außerhalb bear_deep gibt es keine rohe Bärenkürzung');
strictAssert.deepEqual(curve.spendingResult.flexTrace.map(e => e.schritt), [
    'raw_target', 'internal_smoothing', 'annual_change_limit', 'flex_share_curve', 'bear_cap', 'runway_cap',
    'guardrails', 'minimum_flex', 'flex_budget', 'final_smoothing', 'safety_cap', 'quantization'
]);

const capped = run(p => { bear(p); lowShare(p); });
assertEqual(step(capped, 'raw_target').rateNachher, 35, 'Tiefer Bär: bestehendes Rohziel');
assertEqual(step(capped, 'bear_cap').rateNachher, 82.5, 'Bären-Cap enthält tatsächliches Flex-Relief');
assertEqual(step(capped, 'safety_cap').kennzahlen.policyZielProzent, 82.5, 'Safety-Ziel bleibt getrennt sichtbar');
assertEqual(step(capped, 'safety_cap').kennzahlen.wirksamerCapProzent, 90, 'Safety respektiert die bestehende jährliche Abwärtsgrenze');
assert(step(capped, 'safety_cap').kennzahlen.durchAenderungsgrenzeVerschoben, 'Safety-Verschiebung wird erfasst');

const damped = run(p => {
    bear(p); lowShare(p); p.lastState = { ...previous(), lastEntnahmeReal: 22_500 };
});
near(step(damped, 'raw_target').kennzahlen.vermoegensfaktorRatio, 0.5, 'Vermögensfaktor wird tatsächlich erfasst');
near(step(damped, 'raw_target').rateNachher, 67.5, 'Vermögensdämpfung halbiert die rohe Kürzung');
near(step(damped, 'internal_smoothing').kennzahlen.effektivesAlphaRatio, 0.675, 'Effektives Alpha enthält die Vermögensdämpfung');

const recovery = run(p => {
    lowShare(p); p.market = { sKey: 'recovery_in_bear', abstandVomAthProzent: 20 }; p.runwayMonate = 36;
});
assert(step(recovery, 'guardrails').monatswirkungEur < 0, 'Recovery-Guardrail wird als tatsächliche Ratenänderung erfasst');

const runway = run(p => { lowShare(p); p.runwayMonate = 12; });
assertEqual(step(runway, 'runway_cap').rateNachher, 62.5, 'Runway-Cap enthält tatsächliches Flex-Relief');
assertEqual(step(runway, 'runway_cap').kennzahlen.deckungRatio, 0.5, 'Deckung ist ausdrücklich ein Ratio');
assertEqual(step(runway, 'runway_cap').kennzahlen.hartesMinimumMonate, 24, 'Runway-Mindestmonate kommen aus dem bestehenden Vertrag');

for (const ongoing of [false, true]) {
    const alarm = run(p => {
        bear(p); lowShare(p); p.runwayMonate = 12;
        p.lastState = previous(ongoing ? 75 : 100, ongoing);
    });
    assertEqual(step(alarm, 'alarm').kennzahlen.neuAusgeloest, !ongoing, 'Neuer und anhaltender Alarm sind unterscheidbar');
    assertEqual(step(alarm, 'alarm').rateNachher, ongoing ? 75 : 90, 'Alarm nutzt tatsächlichen Vorjahresanker');
    assert(!step(alarm, 'flex_share_curve'), 'Alarmzweig enthält keine nie durchlaufene S-Kurve');
    assertEqual(step(alarm, 'guardrails').gegriffen, false, 'Guardrails sind im Alarm ausgesetzt');
}

const minimum = run(p => {
    bear(p); p.input.minimumFlexAnnual = 30_000;
    p.input.flexBudgetAnnual = 12_000; p.input.flexBudgetYears = 5;
});
assert(step(minimum, 'minimum_flex').monatswirkungEur > 0, 'Mindest-Flex-Anhebung bleibt positiv');
assertEqual(step(minimum, 'minimum_flex').rateNachher, 50, 'Mindest-Flex-Ziel ist die tatsächlich erforderliche Rate');
assert(step(minimum, 'flex_budget').monatswirkungEur < 0, 'Nachgelagerte Budgetbegrenzung ist eine eigene Kürzung');
assertEqual(minimum.spendingResult.details.minimumFlexStatus, 'limited_by_flex_budget', 'Bestehender Mindest-Flex-Status bleibt erhalten');

const emergency = run(p => {
    bear(p); p.lastState = previous(80, false, 1_600_000); p.input.minimumFlexAnnual = 30_000;
});
assertEqual(step(emergency, 'safety_cap').rateNachher, 0, 'Schwere Notlage begrenzt Flex auf null');
assert(step(emergency, 'safety_cap').kennzahlen.schwereNotlage, 'Notlage wird ausdrücklich erfasst');
assertEqual(emergency.newState.flexRateSmoothingReference, 70, 'Separater Notlage-Glättungsanker bleibt unverändert');
assertEqual(emergency.spendingResult.details.endgueltigeEntnahme, 24_000, 'Notlage erhält den Floor');

// Hohe Vermögensdeckung: ausschließlich die Rundung wirkt, jeweils in einer anderen Monatsstufe.
for (const [floor, flex, tier, expectedAnnual] of [
    [12_000, 8_700, 50, 20_400], [24_000, 17_640, 100, 40_800], [48_000, 25_200, 250, 72_000]
]) {
    const rounded = run(p => {
        p.gesamtwert = 11_000_000; p.depotwertGesamt = 10_000_000;
        p.inflatedBedarf = { floor, flex }; p.input.floorBedarf = floor; p.input.flexBedarf = flex;
    });
    assert(rounded.spendingResult.flexTrace.slice(0, -1).every(e => !e.gegriffen), 'Ohne Policykürzung greift allein die Rundung');
    assertEqual(step(rounded, 'quantization').kennzahlen.stufeEurMonat, tier, 'Tatsächlich gewählte Rundungsstufe');
    assertEqual(rounded.spendingResult.details.endgueltigeEntnahme, expectedAnnual, 'Bestehende gerundete Auszahlung');
}

const zero = run(p => {
    p.gesamtwert = 11_000_000; p.depotwertGesamt = 10_000_000;
    p.inflatedBedarf = { floor: 25_001, flex: 0 }; p.input.floorBedarf = 25_001; p.input.flexBedarf = 0;
});
assert(zero.spendingResult.flexTrace.every(e => !e.gegriffen && e.monatswirkungEur === 0), 'Netto-Flex null erzeugt keine künstliche Kürzung');
assert(step(zero, 'quantization').kennzahlen.floorGeschuetzt, 'Rundung schützt den nicht quantisierten Floor');
assertEqual(step(zero, 'quantization').kennzahlen.abschlagEurMonat, 0, 'Rundungsabschlag nutzt den Floor-geschützten Endbetrag');
assertEqual(zero.spendingResult.details.endgueltigeEntnahme, 25_001, 'Floor bleibt exakt erhalten');

const protectedFloor = run(p => {
    p.gesamtwert = 11_000_000; p.depotwertGesamt = 10_000_000;
    p.inflatedBedarf = { floor: 25_001, flex: 1 }; p.input.floorBedarf = 25_001; p.input.flexBedarf = 1;
});
assertEqual(step(protectedFloor, 'quantization').monatsbetragNachher, 0, 'Floor-Schutz lässt nur den tatsächlich finanzierten Flex stehen');
near(step(protectedFloor, 'quantization').kennzahlen.abschlagEurMonat, 1 / 12,
    'Floor-geschützter Monatsabschlag zählt keinen verlorenen Floor');

const unlimitedRunway = run(p => {
    p.runwayMonate = Infinity;
    p.inflatedBedarf = { floor: 0, flex: 0 };
    p.input.floorBedarf = 0; p.input.flexBedarf = 0;
});
assertEqual(step(unlimitedRunway, 'runway_cap').kennzahlen.runwayMonate, null,
    'Unbegrenzte Reichweite bleibt als null JSON-fähig, ohne Policywerte zu ändern');
assertEqual(step(unlimitedRunway, 'runway_cap').kennzahlen.deckungRatio, null,
    'Unbegrenzte Deckung wird nicht als nicht endliche Exportzahl ausgegeben');

// Bestehende Engine-Aufrufer (MC, Worker, Sweep und Backtest) erfassen keine
// UI-Diagnose. Die spätere Balance-Anzeige kann sie ausdrücklich anfordern.
const engineInput = {
    depotwertAlt: 900_000, depotwertNeu: 0, goldWert: 0,
    tagesgeld: 100_000, geldmarktEtf: 0, inflation: 0,
    floorBedarf: 24_000, flexBedarf: 60_000, startAlter: 65,
    renteAktiv: false, renteMonatlich: 0, goldAktiv: false,
    risikoprofil: 'sicherheits-dynamisch', goldFloorProzent: 0,
    liquidityRunwayYears: 5, marketCapeRatio: 20
};
for (const input of [engineInput, { ...engineInput, floorBedarf: 0, flexBedarf: 0 }]) {
    const before = structuredClone(input);
    const plain = EngineAPI.simulateSingleYear(input, null);
    const traced = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace: true });
    const disabled = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace: false });
    assert(plain.ui && traced.ui && disabled.ui, 'Engine-Grenzfälle liefern ein gültiges Ergebnis');
    assert(!Object.hasOwn(plain.ui.spending, 'flexTrace'), 'Engine erzeugt standardmäßig keinen Flex-Trace');
    assert(!Object.hasOwn(disabled.ui.spending, 'flexTrace'), 'Explizit deaktivierter Engine-Trace fehlt');
    assert(Array.isArray(traced.ui.spending.flexTrace), 'Engine-Trace ist ausdrücklich zuschaltbar');
    const { flexTrace, ...spending } = traced.ui.spending;
    strictAssert.deepEqual({ ...traced, ui: { ...traced.ui, spending } }, plain);
    strictAssert.deepEqual(disabled, plain);
    strictAssert.deepEqual(_internal_calculateModel(input, null), plain);
    strictAssert.deepEqual(_internal_calculateModel(input, null, { includeFlexTrace: true }), traced);
    strictAssert.deepEqual(input, before);
    assert(!JSON.stringify(traced.newState).includes('flexTrace'), 'Auch expliziter Engine-Trace bleibt außerhalb des State');
    assert(flexTrace.every(e => Object.values(e.kennzahlen).every(v => typeof v !== 'number' || Number.isFinite(v))),
        'Engine-Trace hat auch bei Nullbedarf nur JSON-fähige Diagnosekennzahlen');
    strictAssert.deepEqual(normalizeMonteCarloJsonValue(flexTrace), JSON.parse(JSON.stringify(flexTrace)));
}

// Ein berechneter Kurven-Cap unterhalb der 0,05pp-Übernahmeschwelle wird nicht als wirksam ausgegeben.
const curveCap = step(curve, 'flex_share_curve').kennzahlen.effektiverCapProzent;
const collector = createFlexTraceCollector(60_000);
const unadopted = applyFlexShareCurve(curveCap + 0.01, { floor: 24_000, flex: 60_000 }, () => {}, 1, collector);
assertEqual(unadopted.applied, false, 'Bestehende Kurven-Übernahmeschwelle bleibt gültig');
assertEqual(collector.snapshot()[0].gegriffen, false, 'Nicht übernommener Kurven-Hilfswert kürzt im Trace nicht');
console.log('Flex-Trace: Ergebnisgleichheit, Stationen, Monatskette und unabhängige Momentaufnahmen geprüft.');
