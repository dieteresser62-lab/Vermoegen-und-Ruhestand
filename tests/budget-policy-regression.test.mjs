import { SpendingPlanner } from '../engine/planners/SpendingPlanner.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';
import { deriveCAPELegacyStepReturn } from '../engine/planners/vpw-return-policy.mjs';

// Synthetische Gegenbeispiele aus den lokalen Messungen, keine Exportdaten.
function crisis(minimumFlexAnnual, overrides = {}) {
    return SpendingPlanner.determineSpending({
        lastState: { initialized: true, flexRate: 100, peakRealVermoegen: 1600000,
            cumulativeInflationFactor: 1, lastTotalBudget: 50000, lastMarketSKey: 'bear_deep' },
        market: { sKey: 'bear_deep', abstandVomAthProzent: 35 },
        inflatedBedarf: { floor: 20000, flex: 30000 }, runwayMonate: 60, profil: {},
        depotwertGesamt: 900000, gesamtwert: 1000000, renteJahr: 0,
        input: { floorBedarf: 20000, flexBedarf: 30000, minimumFlexAnnual, inflation: 0,
            liquidityRunwayYears: 5, flexBudgetAnnual: 0, endeVJ: 65, endeVJ_1: 90, endeVJ_2: 100 },
        ...overrides
    });
}
for (const minimum of [14000, 16000]) {
    const result = crisis(minimum);
    assertEqual(result.spendingResult.details.endgueltigeEntnahme, 34800,
        'FR-20: höherer Mindest-Flex erzeugt keinen Sprung der Notlagenzahlung');
    assertEqual(result.spendingResult.details.severeFlexEmergencyActive, true, 'Tatsächliche Entnahme löst Notlage aus');
}
const affordable = crisis(16000, {
    lastState: { initialized: true, flexRate: 20, peakRealVermoegen: 1600000,
        cumulativeInflationFactor: 1, lastTotalBudget: 22000, lastMarketSKey: 'bear_deep' }
});
assert(affordable.spendingResult.details.protectedPortfolioWithdrawalRate > .035, 'Geschützte Quote darf FR-20 nicht auslösen');
assert(affordable.spendingResult.details.plannedPortfolioWithdrawalRate < .035, 'Krisengegenprobe bleibt unter 3,5 %');
assertEqual(affordable.spendingResult.details.severeFlexEmergencyActive, false, 'Tragbare tatsächliche Entnahme löst keine Notlage aus');

for (const [cape, nominal] of [[1, .08], ...CONFIG.MARKET_VALUATION.EXPECTED_RETURN_CAPE_POINTS, [90, .04]]) {
    const low = deriveCAPELegacyStepReturn({ capeRatio: cape, inflation: 2, equityWeightPct: 60 });
    const high = deriveCAPELegacyStepReturn({ capeRatio: cape, inflation: 8, equityWeightPct: 60 });
    assertClose(low.expectedReturnCape, nominal, 1e-12, 'FR-33: lineare Rendite trifft Stützpunkt oder konstantes Ende');
    assertEqual(low.expectedRealReturnRaw, high.expectedRealReturnRaw, 'FR-33: Jahresinflation verändert die erwartete Realrendite nicht');
}
const input = { depotwertAlt: 1000000, depotwertNeu: 0, tagesgeld: 200000, geldmarktEtf: 0,
    floorBedarf: 24000, flexBedarf: 120000, minimumFlexAnnual: 0, inflation: 2,
    renteAktiv: false, goldAktiv: false, dynamicFlex: true, horizonYears: 30,
    aktuellesAlter: 65, liquidityRunwayYears: 5, endeVJ: 100, endeVJ_1: 100,
    endeVJ_2: 100, ath: 100, jahreSeitAth: 0, risikoprofil: 'sicherheits-dynamisch' };
for (const cape of [30, 35]) {
    const before = EngineAPI.simulateSingleYear({ ...input, capeRatio: cape - .01 }, null, { includeFlexTrace: true });
    const after = EngineAPI.simulateSingleYear({ ...input, capeRatio: cape }, null, { includeFlexTrace: true });
    assert(!before.error && !after.error, 'CAPE-Grenzfälle sind berechenbar');
    const step = after.ui.spending.flexTrace.find(entry => entry.schritt === 'quantization').kennzahlen.stufeEurMonat;
    assert(Math.abs(after.ui.spending.monatlicheEntnahme - before.ui.spending.monatlicheEntnahme) <= step,
        'CAPE 29,99/30 und 34,99/35 unterscheiden sich höchstens um eine Rundungsstufe');
    assertClose(before.ui.vpw.expectedRealReturnRaw - after.ui.vpw.expectedRealReturnRaw,
        .00002 * after.ui.vpw.equityWeight, 1e-12, 'Renditekurve bleibt an alten Klassengrenzen stetig');
}

for (const inflation of [0, 2]) {
    let state = { initialized: true, flexRate: 60, alarmActive: false,
        peakRealVermoegen: 500000, cumulativeInflationFactor: 1 };
    const payments = [], anchors = [];
    for (let year = 0; year < 12; year++) {
        const factor = (1 + inflation / 100) ** year;
        const result = SpendingPlanner.determineSpending({
            lastState: { ...state, cumulativeInflationFactor: factor },
            market: { sKey: 'side_long', abstandVomAthProzent: 0 },
            inflatedBedarf: { floor: 24000 * factor, flex: 6000 * factor }, runwayMonate: 120,
            profil: { minRunwayMonths: 24, isDynamic: true }, depotwertGesamt: 500000 * factor,
            gesamtwert: 500000 * factor, renteJahr: 0,
            input: { inflation, liquidityRunwayYears: 5, floorBedarf: 24000 * factor,
                flexBedarf: 6000 * factor, minimumFlexAnnual: 0, endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100 }
        });
        state = result.newState;
        payments.push(result.spendingResult.details.endgueltigeEntnahme);
        anchors.push(state.flexRateSmoothingReference);
        assert(state.flexRateSmoothingReference >= state.flexRate, 'FR-34: Abrundung senkt den gespeicherten Anker nicht');
    }
    assert(payments[4] > payments[0], 'FR-34: kleine Anhebungen überwinden die Rundungsstufe');
    assert(payments.at(-1) / (1 + inflation / 100) ** 11 > payments[0], 'Reale Auszahlung steigt auch bei Inflation');
    assert(anchors.at(-1) > 98, 'Glättungsanker nähert sich der unveränderten S-Kurven-Grenze');
    if (inflation === 0) assertEqual(payments.at(-1), 28800, 'Enge Fassung: S-Kurve und Abrundung bleiben wirksam; kein Aufrunden auf Wunsch-Flex');
}

// Nur der ausgegebene Grund ändert sich; die Vorsicht wirkt weiterhin über die Floor-Sperre.
function displayReason({ depot = 900000, floor = 24000, flex = 60000 } = {}) {
    return SpendingPlanner.determineSpending({ lastState: null,
        market: { sKey: 'peak_hot', abstandVomAthProzent: 0 },
        inflatedBedarf: { floor, flex }, runwayMonate: 60, profil: {},
        depotwertGesamt: depot, gesamtwert: depot + 100000, renteJahr: 0,
        input: { floorBedarf: floor, flexBedarf: flex, minimumFlexAnnual: 0, inflation: 0,
            liquidityRunwayYears: 5, endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100 } });
}
const blocked = displayReason();
assert(blocked.diagnosis.guardrails.find(g => g.name === 'Vorsicht beim Budget-Floor')?.details.budgetFloorBlocked,
    'Gegenprobe: Vorsicht verhindert eine sonst mögliche Floor-Anhebung');
assertEqual(blocked.spendingResult.kuerzungQuelle, 'Guardrail (Vorsicht)', 'NR-1: gesperrter Floor mit Rückgang zum Vorjahr nennt Vorsicht auch bei Gleichstand');
assert(blocked.spendingResult.anmerkung.includes(blocked.spendingResult.kuerzungQuelle), 'Klartext nennt denselben stärksten Grund');
const unblocked = displayReason({ depot: 3000000 });
assert(!unblocked.diagnosis.guardrails.some(g => g.details?.budgetFloorBlocked), 'Gegenprobe ohne Floor-Sperre');
assert(unblocked.spendingResult.kuerzungQuelle !== 'Guardrail (Vorsicht)', 'Keine Vorsichtsmeldung ohne verhinderten Floor');
const noCut = displayReason({ depot: 3000000, floor: 24000, flex: 6000 });
assertEqual(noCut.spendingResult.kuerzungQuelle, 'keine Kürzung', 'Interner Grund Profil wird verständlich ausgegeben');
