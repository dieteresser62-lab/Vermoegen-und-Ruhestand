import { readFileSync } from 'node:fs';
import { inputs as fixture } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { survivorLiquidityTarget } from '../app/simulator/simulator-survivor.js';
import { calculateHouseholdPensionForYear } from '../app/simulator/simulator-household-pension.js';
import { nextFixedIncomeWageFactor } from '../app/simulator/simulator-fixed-income.js';
import { EngineAPI } from '../engine/index.mjs';

const year = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };
const household = { p1Alive: false, p2Alive: true };
function inputsForCase() {
    const inputs = { ...structuredClone(fixture), dynamicFlex: false, goldAktiv: false,
        startFloorBedarf: 40000, startFlexBedarf: 20000, minimumFlexAnnual: 0,
        survivorFloorPercent: 75, survivorFlexPercent: 50, survivorMinimumFlexPercent: 50,
        renteMonatlich: 0, rentAdjPct: 0,
        partner: { ...structuredClone(fixture.partner), monatsrente: 0, brutto: 0, startInJahren: 0 },
        partnership: { status: 'unmarried', inheritance: { muster_a: 100, muster_b: 100 } } };
    for (const lot of inputs.detailledTranches) {
        lot.marketValue *= 8; lot.costBasis *= 8; lot.shares *= 8;
    }
    for (const person of inputs.simulationPeople) person.tagesgeld = 200000;
    inputs.tagesgeld = 400000;
    return inputs;
}
function compareNextYear(label, inputs, expected, data = year, context = household) {
    const state = initMcRunState(inputs);
    const pension = calculateHouseholdPensionForYear({ inputs, yearIndex: 0, ...context,
        currentAnnualPension: state.currentAnnualPension, currentAnnualPension2: state.currentAnnualPension2,
        deathThisYear: true });
    const target = survivorLiquidityTarget({ state, portfolio: state.portfolio, inputs, household: context,
        transition: { survivor: { deceasedProfileId: context.p1Alive ? 'muster_b' : 'muster_a',
            survivorProfileId: context.p1Alive ? 'muster_a' : 'muster_b', deathYearIndex: 0 } },
        yearIndex: 0, inflationFactor: 1 + data.inflation / 100, marketData: {}, pension,
        fixedIncomeWageFactor: inputs.fixedIncome?.length ? nextFixedIncomeWageFactor(inputs, state, data) : undefined });
    const death = simulateOneYear(state, inputs, data, 0, null, 0, context, 1, EngineAPI);
    assertEqual(death.kind, 'success', `${label}: Todesjahr rechnet`);
    const next = simulateOneYear(death.newState, inputs, year, 1, null, 0, context, 1, EngineAPI);
    assertEqual(next.kind, 'success', `${label}: Folgejahr rechnet`);
    assertClose(target, expected, .01, `${label}: Gegenrechnung des Reserveziels`);
    assertClose(target, next.logData.zielLiquiditaet, .01, `${label}: Reserveziel entspricht Engine-Auffüllziel des Folgejahrs`);
    if (death.logData.inheritance?.funding) assertClose(death.logData.inheritance.funding.reserveTarget, target, .01,
        `${label}: Steuerzahlung verwendet das projizierte Ziel`);
    return { target, death, next };
}
for (const [label, start, months, adjustment, expected] of [
    ['T1 Rentenbeginn im Folgejahr mit sechs Monaten', 1, 6, 0, 155000],
    ['T2 laufende Rente mit Anpassung', 0, 12, 2, 108200],
    ['T3 laufende Rente ohne Anpassung', 0, 12, 0, 110000],
    ['T4 Rentenbeginn im Folgejahr', 1, 12, 0, 110000]
]) {
    const inputs = inputsForCase();
    Object.assign(inputs.partner, { monatsrente: 1500, brutto: 18000, startInJahren: start, renteStartMonate: months });
    inputs.rentAdjPct = adjustment;
    compareNextYear(label, inputs, expected);
}
{
    const inputs = inputsForCase();
    inputs.renteMonatlich = 1500;
    inputs.renteStartOffsetJahre = 1;
    inputs.renteStartMonate = 12;
    compareNextYear('T4 Gegenrichtung mit Rentenbeginn der ersten Person', inputs, 110000, year,
        { p1Alive: true, p2Alive: false });
}
for (const [label, ab, bis, expected] of [
    ['T5 Einkunft endet im Todesjahr', null, '2026-12', 200000],
    ['Einkunft beginnt im Folgejahr', '2027-01', null, 140000]
]) {
    const inputs = inputsForCase();
    inputs.fixedIncomeReferenceYear = 2026;
    inputs.fixedIncome = [{ id: 'synthetisch', profileId: 'muster_b', art: 'sonstige', bezeichnung: 'Einkunft',
        betragMonat: 1000, ab, bis, anpassung: 'keine' }];
    const result = compareNextYear(label, inputs, expected);
    if (bis) {
        assert(result.death.logData.liqEnd < result.target, 'B4 unter dem Ziel vorhandene Reserve bleibt im Todesjahr darunter');
    }
}
{
    const inputs = inputsForCase();
    inputs.fixedIncomeReferenceYear = 2026;
    inputs.fixedIncome = [{ id: 'lohn', profileId: 'muster_b', art: 'sonstige', bezeichnung: 'Lohn',
        betragMonat: 1000, ab: null, bis: null, anpassung: 'lohn' }];
    compareNextYear('Lohnfaktor des Folgejahrs', inputs, 138800, { ...year, lohn: 2 });
    compareNextYear('Nominalschutz des Lohnfaktors', inputs, 140000, { ...year, lohn: -5 });
}
{
    const inputs = inputsForCase();
    inputs.partnership.status = 'married';
    inputs.renteMonatlich = 2000;
    inputs.rentAdjPct = 2;
    compareNextYear('T7 Hinterbliebenenrente mit Anpassung', inputs, 132700, year,
        { ...household, widowBenefits: { p2FromP1: true, p2FromP1Percent: .55 } });
}
compareNextYear('B2 Preise des Folgejahrs bei drei Prozent Inflation', inputsForCase(), 206000, { ...year, inflation: 3 });
{
    const inputs = inputsForCase();
    inputs.plannedExpensesReferenceYear = 2026;
    inputs.plannedExpenses = [
        { id: 'alt', bezeichnung: 'Schon bezahlt', monat: '2026-12', betrag: 50000 },
        { id: 'neu', bezeichnung: 'Einmalig', monat: '2027-08', betrag: 9000 },
        { id: 'laufend', bezeichnung: 'Laufend', betragMonat: 500, ab: '2027-07', bis: '2028-06', anpassung: 'keine' }
    ];
    compareNextYear('B5 geplante Ausgaben nur im Folgejahr', inputs, 212000);
}
{
    const inputs = inputsForCase();
    inputs.dynamicFlex = true;
    const state = initMcRunState(inputs);
    const pension = calculateHouseholdPensionForYear({ inputs, yearIndex: 0, ...household });
    const target = survivorLiquidityTarget({ state, portfolio: state.portfolio, inputs, household,
        transition: { survivor: {} }, yearIndex: 0, inflationFactor: 1, marketData: {}, pension });
    assertEqual(target, 200000, 'B5 Dynamic Flex bleibt als dokumentierte Grenze außerhalb der Reserveprojektion');
    const death = simulateOneYear(state, inputs, year, 0, null, 0, household, 1, EngineAPI);
    const next = simulateOneYear(death.newState, inputs, year, 1, null, 0, household, 1, EngineAPI);
    assert(next.logData.zielLiquiditaet > target, 'B5 die höhere geplante Auszahlung erhöht erst das Engineziel des Folgejahrs');
}
for (const [label, context, hasPartner, expected] of [
    ['ohne aktiven Partner', { p1Alive: true, p2Alive: false }, false, 300000],
    ['beide leben', { p1Alive: true, p2Alive: true }, true, 300000],
    ['beide verstorben', { p1Alive: false, p2Alive: false }, true, 200000]
]) {
    const inputs = inputsForCase();
    inputs.partner.aktiv = hasPartner;
    const state = initMcRunState(inputs);
    const pension = calculateHouseholdPensionForYear({ inputs, yearIndex: 0, ...context });
    const target = survivorLiquidityTarget({ state, portfolio: state.portfolio, inputs, household: context,
        transition: { survivor: {} }, yearIndex: 0, inflationFactor: 1, marketData: {}, pension });
    assertEqual(target, expected, `B6 null-Flexfaktoren: ${label}`);
}
{
    const inventory = JSON.parse(readFileSync(new URL('../docs/design/funktionsinventar.json', import.meta.url)));
    const reasons = JSON.stringify(inventory);
    assert(reasons.includes('Immobilien und Gesamtvermögen ergänzen das Geldvermögen in Tabelle und CSV.'),
        'B7 bisherige Begründung zu Immobilien, Tabelle und CSV bleibt erhalten');
    assert(reasons.includes('Tabelle und CSV. Zahlungsherkunft.'), 'B7 neue Zahlungsherkunft ergänzt die bisherige Begründung');
}
