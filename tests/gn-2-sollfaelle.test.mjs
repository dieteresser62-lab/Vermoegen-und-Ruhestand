// GN-2 (FR-73 Punkt 8 geändert): Pflegekostenanstieg je Kalenderjahr, bis 2035 + 5 %, ab 2036 + 2 % über der Inflation.
import { careCostDriftFactor, resolveCareDriftSchedule, simulatorCareDriftFactor, careDriftInputPatch, careDriftLabel } from '../app/shared/care-cost-drift.js';
import { resolveCarePrices, careDriftScheduleOf, careDriftPercentForYear, projectCarePrices, projectCareValuesForYear } from '../app/shared/care-prices.js';
import { homeCareAnnualCosts } from '../app/shared/care-needs.js';
import { assertCarePrices } from '../app/shared/household-care-values.js';
import { coverageAssumptions } from '../app/simulator/simulator-assumption-lines.js';

const prices = (extra = {}) => ({ costs: { 1: 3600, 2: 6000, 3: 18000, 4: 32000, 5: 60000 }, maximumFloor: 120000, ownExpensesMonthly: 500,
    origin: 'von Hand', priceYear: 2026, ...extra });
const scheduleFor = stored => careDriftScheduleOf(resolveCarePrices({ prices: stored }, null));
const factor2045 = schedule => careCostDriftFactor(2026, 2045, schedule);

// Preisfaktor ohne Inflation, Preisstand 2026 = 1.
{
    const standard = scheduleFor(prices());
    assertEqual(JSON.stringify(standard), JSON.stringify({ firstPercent: 5, untilYear: 2035, afterPercent: 2 }), 'GN-2: ohne gespeicherten Anstieg gilt die Vorgabe');
    for (const [year, expected, label] of [[2030, 1.2155, '1,05⁴'], [2035, 1.5513, '1,05⁹'], [2036, 1.5824, '1,05⁹ × 1,02'], [2045, 1.8911, '1,05⁹ × 1,02¹⁰']]) {
        assertClose(careCostDriftFactor(2026, year, standard), expected, 1e-4, `GN-2: Preisfaktor ${year} = ${label} = ${expected}`);
    }
    assertClose(factor2045(scheduleFor(prices({ driftPercent: 3 }))), 1.7535, 1e-4, 'GN-2: eigener Wert 3 % dauerhaft: 1,03¹⁹ = 1,7535');
    assertClose(factor2045(scheduleFor(prices({ driftPercent: 5 }))), 1.8911, 1e-4, 'GN-2: gespeichert 5 % (Altbestand) wie Vorgabe');
    assertClose(factor2045(careDriftScheduleOf(resolveCarePrices({ prices: prices() }, { sim_pflegeKostenDrift: '3.5' }))), 1.8911, 1e-4,
        'GN-2: gespeichert 3,5 % (alte Vorgabe, Altbestand) wie Vorgabe');
    assertClose(factor2045(scheduleFor(prices({ driftPercent: 3.5 }))), Math.pow(1.035, 19), 1e-9,
        'GN-2: bewusst eingetragene 3,5 % (markiert, PFA-4 B6) bleiben dauerhaft');
    assertClose(factor2045(careDriftScheduleOf(resolveCarePrices(null, { sim_pflegeKostenDrift: '3.5' }))), 1.8911, 1e-4,
        'GN-2: alter sim_-Wert 3,5 % ohne Preisblock wie Vorgabe');
    assertClose(factor2045(careDriftScheduleOf(resolveCarePrices(null, { sim_pflegeKostenDrift: '4' }))), Math.pow(1.04, 19), 1e-9,
        'GN-2: alter eigener sim_-Wert 4 % gilt dauerhaft');
    const own = scheduleFor(prices({ driftPercent: 6, driftUntilYear: 2030, driftAfterPercent: 1 }));
    assertEqual(JSON.stringify(own), JSON.stringify({ firstPercent: 6, untilYear: 2030, afterPercent: 1 }), 'GN-2: gesetzter Verlauf gilt wie gespeichert');
    assertEqual(JSON.stringify(resolveCareDriftSchedule({ firstPercent: 5, afterPercent: 3 })), JSON.stringify({ firstPercent: 5, untilYear: 2035, afterPercent: 3 }),
        'GN-2: zweite Rate gesetzt, Wechseljahr fehlt → Vorgabe 2035');
    assertCarePrices(prices({ driftPercent: 5, driftUntilYear: 2035, driftAfterPercent: 2 }));
    let rejected = false; try { assertCarePrices(prices({ driftUntilYear: 2035.5 })); } catch { rejected = true; }
    assert(rejected, 'GN-2: ungültiges Wechseljahr wird abgewiesen');
    assertEqual(careDriftLabel(standard), 'Inflation + 5 % bis 2035, danach + 2 %', 'GN-2: Anzeige beider Raten');
    assertEqual(careDriftLabel({ firstPercent: 3, untilYear: 2035, afterPercent: 3 }), 'Inflation + 3 %', 'GN-2: Anzeige bei gleichen Raten');
}

// Jahresabschluss, Schritt „Pflegewerte“: × (1 + Inflation J) × (1 + Rate von J+1).
{
    const base = resolveCarePrices({ prices: prices({ costs: { 1: 10000, 2: 6000, 3: 18000, 4: 32000, 5: 60000 } }) }, null);
    const close = planningYear => projectCarePrices(base, { inflationRate: 2, driftPercent: careDriftPercentForYear(base, planningYear), priceYear: planningYear }).costs[1];
    assertEqual(close(2035), 10710, 'GN-2: Abschluss 2034 (Schritt in 2035): 10.000 × 1,02 × 1,05 = 10.710 €');
    assertEqual(close(2036), 10404, 'GN-2: Abschluss 2035 (Schritt in 2036): 10.000 × 1,02 × 1,02 = 10.404 €');
    const record = projectCareValuesForYear(null, { inflationRate: 2, driftPercent: careDriftPercentForYear(base, 2036), priceYear: 2036 });
    assert(record.prices.driftAfterPercent === undefined && record.prices.driftPercent === undefined, 'GN-2: Fortschreibung schreibt keinen unmarkierten Verlauf');
    const marked = resolveCarePrices({ prices: prices({ driftPercent: 6, driftUntilYear: 2030, driftAfterPercent: 1 }) }, null);
    const kept = projectCarePrices(marked, { inflationRate: 2, driftPercent: careDriftPercentForYear(marked, 2031), priceYear: 2031 });
    assertEqual(JSON.stringify([kept.driftPercent, kept.driftUntilYear, kept.driftAfterPercent]), '[6,2030,1]', 'GN-2: markierter Verlauf bleibt im Block');
}

// Balance-Folgejahr und Simulator: Index 0 ist das Planjahr, der Schritt nimmt die Rate des Zieljahrs.
{
    const schedule = { firstPercent: 5, untilYear: 2035, afterPercent: 2 };
    const inputs = start => ({ ...careDriftInputPatch(schedule, start), pflegeMaxFloor: 1e9, pflegeRegionalZuschlag: 0 });
    const next = start => homeCareAnnualCosts({ active: true, grade: 2 }, inputs(start), { baseFloor: 0, inflationFactor: 1, yearIndex: 1, gradeConfig: { zusatz: 10000 } }).homeCareAddition;
    assertClose(next(2035), 10200, 1e-6, 'GN-2: Planjahr 2036 (Schritt 2035 → 2036) nimmt 2 %');
    assertClose(next(2026), 10500, 1e-6, 'GN-2: Planjahr 2027 nimmt 5 %');
    assertClose(simulatorCareDriftFactor(inputs(2026), 19), 1.8911, 1e-4, 'GN-2: Simulator 2026 + 19 Jahre = 1,8911');
    assertClose(simulatorCareDriftFactor({ pflegeKostenDrift: 0.035 }, 20), Math.pow(1.035, 20), 0, 'GN-2: ohne Verlauf wie bisher (1 + Rate)^Index');
    assertEqual(JSON.stringify(careDriftInputPatch({ firstPercent: 3, untilYear: 2035, afterPercent: 3 }, 2026)), JSON.stringify({ pflegeKostenDrift: 0.03 }),
        'GN-2: gleiche Raten ergeben die bisherigen Eingaben');
    const line = coverageAssumptions({ rentAdjMode: 'cpi', pflegefallLogikAktivieren: true, ...inputs(2026) }).line;
    assert(line.includes('Pflegekosten Inflation + 5 % bis 2035, danach + 2 %'), `GN-2: „Gerechnet mit“ nennt beide Raten (${line})`);
}
