// NK-2 Punkt 5 (FR-84 Punkte 14 bis 16, Nachtrag 5 und 9a): Einmalausgaben. Grundbedarf und Pflege gehen vor; jeder Posten ganz oder gar
// nicht, in Planreihenfolge (Datum, dann Eingabe); Kennzahl „Läufe mit entfallener Ausgabe“ in Monte Carlo und Backtest. Erfundene Beträge.
import { couple, lot, yearWithCare, plainYear, A, B } from './helpers/nk-1b-cases.mjs';
import { backtest } from './helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { buildMonteCarloAggregates } from '../app/simulator/monte-carlo-aggregates.js';
import { buildKpiDashboard } from '../app/simulator/results-metrics.js';
import { floorReliefText } from '../app/simulator/protocol-renderer.js';
import { onceExpenseItems, selectExpenseItems } from '../app/simulator/simulator-planned-expense-items.js';
import { EngineAPI } from '../engine/index.mjs';

const close = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const expense = (id, monat, betrag) => ({ id, monat, betrag, bezeichnung: id });
const withExpenses = (inputs, items) => Object.assign(inputs, { plannedExpensesReferenceYear: 2026, plannedExpenses: items });

// Planreihenfolge: Datum, dann Eingabe; ein späterer kleinerer Posten wird bezahlt, wenn ein früherer größerer entfällt.
{
    const items = onceExpenseItems({ plannedExpensesReferenceYear: 2026, plannedExpenses: [expense('Dach', '2026-07', 3000), expense('Auto', '2026-03', 8000),
        expense('Reise', '2026-07', 1000)] }, 0, 1, 12000);
    assertEqual(items.map(item => item.label).join(), 'Auto,Dach,Reise', 'Reihenfolge nach Monat, dann Eingabe');
    const pick = selectExpenseItems(items, 5000);
    assertEqual(`${pick.kept.map(item => item.label).join()} · ${pick.dropped.map(item => item.label).join()}`, 'Dach,Reise · Auto', 'Auto entfällt ganz, Dach und Reise bleiben');
}

// Verheiratet: 30.000 € Tagesgeld, Grundbedarf 12.000 €, Pflege 10.000 €, Ausgabe 10.000 €. Pflege vor Ausgabe: die Ausgabe entfällt
// ganz, keine Hilfe zur Pflege.
{
    const result = yearWithCare(withExpenses(couple({ status: 'married', cash: [30000, 0] }), [expense('Umbau', '2026-06', 10000)]), 10000);
    assertEqual(`${result.kind} · ${result.logData.geplante_ausgaben} · ${result.logData.geplante_ausgaben_gekuerzt}`, 'success · 0 · 10000', 'Pflege vor Ausgabe: Ausgabe entfällt ganz');
    assert(!result.logData.hilfe_zur_pflege, 'Pflege vor Ausgabe: keine Hilfe, die Pflege zahlt das eigene Geld');
    assert(/Geplante Ausgabe entfällt: 10\.000.*Umbau/.test(floorReliefText(result.logData, value => value.toLocaleString('de-DE', { maximumFractionDigits: 0 }))),
        'Hinweis im Jahresprotokoll mit Posten');
}

// Mehrere Posten: 25.000 € Tagesgeld, Grundbedarf 12.000 €, Auto 14.000 € im März, Reise 3.000 € im Juli. Auto entfällt, Reise wird bezahlt.
{
    const result = plainYear(withExpenses(couple({ status: 'married', cash: [25000, 0] }), [expense('Auto', '2026-03', 14000), expense('Reise', '2026-07', 3000)]));
    assertEqual(`${result.kind} · ${result.logData.geplante_ausgaben} · ${result.logData.geplante_ausgaben_gekuerzt}`, 'success · 3000 · 14000', 'Mehrere Posten: der kleinere spätere wird bezahlt');
}

// Unverheiratet, persönlicher Anteil: Reicht das Geld des Haushalts nicht für die ganze Ausgabe, entfällt sie ganz, auch wenn eine Person
// ihren Anteil zahlen könnte.
{
    const result = plainYear(withExpenses(couple({ cash: [16000, 4000], floor: 12000 }), [expense('Umbau', '2026-06', 10000)]));
    assertEqual(`${result.kind} · ${result.logData.geplante_ausgaben} · ${result.logData.geplante_ausgaben_gekuerzt}`, 'success · 0 · 10000', 'Unverheiratet: ganz oder gar nicht');
}

// Gutachten NK1C3 Befund 1: B zahlt aus 23.000 € Geldmarkt (ohne Einstand) Grundbedarf 12.000 €, eigene Pflege 1.000 € und die Ausgabe
// 10.000 €. Pflegequote 1.000 / 23.000: 263,75 € Hilfe; von der übrigen Steuer bleiben nach As 5.700 € noch 102,50 € als Schuld.
{
    const inputs = withExpenses(couple({ mode: `one_carries:${B}`, cash: [5700, 0], lots: [lot(B, 23000, 0.01)] }), [expense('Umbau', '2026-06', 10000)]);
    inputs.simulationPeople.forEach(person => { person.sparerPauschbetrag = 0; });
    const result = yearWithCare(inputs, 1000);
    assertEqual(result.kind, 'success', 'NK1C3: Erfolgsjahr');
    close(result.logData.hilfe_zur_pflege_steuer, 263.75, 'NK1C3: Hilfe nur für den Pflegeanteil 1.000 / 23.000', 0.05);
    close(result.logData.steuer_offen, 102.5, 'NK1C3: 102,50 € bleiben als Schuld', 0.05);
}

// Kennzahl: 40.000 € Tagesgeld, Grundbedarf 12.000 €, im zweiten Jahr eine Ausgabe von 50.000 €. Jeder Lauf verliert sie im Jahr 2.
{
    const inputs = withExpenses(couple({ status: 'married', cash: [40000, 0] }), [expense('Umbau', '2027-06', 50000)]);
    const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { anzahl: 4, maxDauer: 2, blockSize: 1, seed: 7, methode: 'block',
        rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 0, count: 4 } });
    assertEqual(`${chunk.totals.failCount} · ${chunk.droppedExpense?.runIndices.join()} · ${chunk.droppedExpense?.firstYears.join()}`, '0 · 0,1,2,3 · 2,2,2,2',
        'Kennzahl: alle Läufe erfolgreich, Ausgabe im Jahr 2 entfallen');
    const results = buildMonteCarloAggregates({ ...chunk, inputs, totalRuns: 4 });
    assertEqual(results.droppedExpense.runSharePct, 100, 'Kennzahl: Anteil 100 %');
    const card = buildKpiDashboard(results, inputs).detailSections.flatMap(section => section.kpis).find(kpi => kpi.title === 'Läufe mit entfallener Ausgabe');
    assert(card && /Median ab Simulationsjahr 2/.test(card.description), 'Kennzahl: Karte „Läufe mit entfallener Ausgabe“');
    const without = await runMonteCarloChunk({ inputs: { ...inputs, plannedExpenses: [] }, engine: EngineAPI, monteCarloParams: { anzahl: 4, maxDauer: 2, blockSize: 1,
        seed: 7, methode: 'block', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' }, widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 0, count: 4 } });
    assert(!('droppedExpense' in without), 'Kennzahl: ohne entfallene Ausgabe kein Feld');
    const history = backtest(inputs, 2000, 2001);
    assertEqual(`${history.summary?.droppedExpense?.firstYear} · ${history.summary?.droppedExpense?.years}`, '2001 · 1', 'Backtest: entfallene Ausgabe im zweiten Jahr');
}
