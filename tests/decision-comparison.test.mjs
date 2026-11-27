// VG-1 Vergleich unter Monte-Carlo → Vergleich: Anzeige, gepaarte Pfade, Präfixe, Ziehverfahren, Varianten und Node-DOM.
// Zielwertsuche: decision-comparison-zielsuche.test.mjs und decision-comparison-abwaerts.test.mjs; Vorbereitung in helpers/decision-comparison-setup.mjs.
import { readFileSync } from 'node:fs';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { assert, inputs, monteCarloParams, options, strainedFloor } from './helpers/decision-comparison-setup.mjs';
import { runDecisionComparison, createDecisionVariant, comparisonIdentity, assertComparisonUnchanged, comparisonIncomeChoices, comparisonReferenceYear } from '../app/simulator/decision-comparison.js';
import { runMonteCarloSimulation } from '../app/simulator/monte-carlo-runner.js';
import { initDecisionComparison, renderDecisionResult } from '../app/simulator/decision-comparison-ui.js';
import { readDocumentPersonInputs, initializePersonOverrides } from '../app/simulator/simulator-person-overrides.js';
import { addField } from './designsystem-selection-dom.mjs';

// Anzeigeunterschiede folgen den sichtbaren Eurobeträgen, auch im Highlight.
{
    const keys = ['budgetP10', 'budgetP50', 'wealthP10', 'wealthP50'];
    const metric = value => ({ ...Object.fromEntries(keys.map(key => [key, value])), coveragePct: 100, affectedPct: 0, affectedYears: 0 });
    const synthetic = { change: { kind: 'budget', monthly: -300 }, baseline: { metrics: metric(1000.6) },
        variant: { metrics: metric(500.4) }, differences: { ...Object.fromEntries(keys.map(key => [key, -500.2])), coveragePct: 0, affectedPct: 0, affectedYears: 0 },
        params: { anzahl: 1000, standardRuns: 1000, seed: 12345 }, worsePct: 0 };
    const before = JSON.stringify(synthetic), html = renderDecisionResult(synthetic).replaceAll('\u00a0', ' ');
    assert.equal((html.match(/1\.001 €/g) || []).length, 4);
    assert.equal((html.match(/500 €/g) || []).length, 4);
    assert.equal((html.match(/−501 €/g) || []).length, 6, 'Tabelle, P50-Highlight und P10-Hinweis verwenden −501 €');
    assert.equal(JSON.stringify(synthetic), before, 'Rohdifferenzen bleiben unverändert');
}
// KL-1: Ohne Pflegelogik muss auch Person 2 nach Ausgangsruin weiter altern/sterben. FR-84: Ruin nur, wenn das Geldvermögen den
// Grundbedarf nach Renten nicht deckt; der Grundbedarf liegt deshalb über den Renten, der hohe Flex zehrt das Vermögen auf.
const rescuedWithoutCare = await runDecisionComparison({ ...options,
    inputs: { ...inputs, pflegefallLogikAktivieren: false, startFloorBedarf: strainedFloor, startFlexBedarf: 300000, minimumFlexAnnual: 60000 },
    change: { kind: 'budget', monthly: -20000 } });
assert.ok(rescuedWithoutCare.baseline.chunk.totals.failCount > rescuedWithoutCare.variant.chunk.totals.failCount);
const noCareLife = rows => rows.map(({ historicalYear, ...row }) => row);
assert.deepEqual(noCareLife(rescuedWithoutCare.baseline.diagnostics), noCareLife(rescuedWithoutCare.variant.diagnostics));
const rescuedBase = rescuedWithoutCare.baseline.chunk.pathSummaries;
const rescuedVariant = rescuedWithoutCare.variant.chunk.pathSummaries;
assert.equal(rescuedBase.outcomeCode[0], 1);
assert.notEqual(rescuedVariant.outcomeCode[0], 1);
assert.ok(rescuedVariant.minimumFlexAffectedYearCount[0] > rescuedBase.minimumFlexAffectedYearCount[0]);
const actuallyWorse = [...rescuedBase.outcomeCode].filter((code, index) => code !== 1
    && (rescuedVariant.outcomeCode[index] === 1
        || rescuedVariant.minimumFlexAffectedYearCount[index] > rescuedBase.minimumFlexAffectedYearCount[index])).length;
assert.equal(rescuedWithoutCare.worsePct, actuallyWorse / monteCarloParams.anzahl * 100,
    'Ein vermiedener Ausgangsruin zählt trotz zusätzlicher Mindest-Flex-Jahre nicht als Schaden');
const original = JSON.stringify(inputs);
const zero = await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 0 } });
assert.deepEqual(zero.baseline.metrics, zero.variant.metrics);
assert.deepEqual(zero.baseline.chunk, zero.variant.chunk);
assert.equal(zero.worsePct, 0);
assert.ok(Object.values(zero.differences).every(value => value === 0));
const normal = await runMonteCarloSimulation({ ...options, widowOptions: inputs.widowOptions });
assert.deepEqual(zero.baseline.aggregated, normal.aggregatedResults);
const budget = await runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 300 } });
// LE-1 (FR-75): Ein Lauf endet in der Variante ein Jahr früher im Ruin; dort fehlt nur das historische Marktjahr.
assert.deepEqual(noCareLife(budget.baseline.diagnostics), noCareLife(budget.variant.diagnostics));
assert.ok(budget.variant.diagnostics.every((row, index) => row.historicalYear === budget.baseline.diagnostics[index].historicalYear
    || row.historicalYear === null));
assert.equal(new Set(budget.baseline.diagnostics.map(row => row.runIndex)).size, 50);
const expenseChange = { kind: 'expense', amount: 25000, month: '2030-06' };
const beforeExpense = run => run.logDataRows.filter(row => row.jahr < 5);
assert.equal(inputs.partnership?.status, 'married');
const expense = await runDecisionComparison({ ...options, change: expenseChange });
for (let index = 0; index < 50; index++) {
    assert.deepEqual(beforeExpense(expense.variant.chunk.runMeta[index]), beforeExpense(expense.baseline.chunk.runMeta[index]));
}
// Ohne Partnerschaftsstatus fällt nach FR-94 Erbschaftsteuer an, deren Reserveziel die geplante Ausgabe schon im Todesjahr berücksichtigt.
const expenseInputs = { ...inputs };
delete expenseInputs.partnership;
const expenseWithoutStatus = await runDecisionComparison({ ...options, inputs: expenseInputs, change: expenseChange });
const { reserveTarget: targetDelta } = JSON.parse(readFileSync(new URL('./fixtures/th-1-expectation-deltas.json', import.meta.url), 'utf8'));
for (let index = 0; index < 50; index++) {
    const expected = beforeExpense(expenseWithoutStatus.baseline.chunk.runMeta[index]);
    if (index === targetDelta.runIndex) {
        const rowIndex = expected.findIndex(row => row.jahr === targetDelta.jahr);
        const row = expected[rowIndex];
        assert.equal(row?.inheritance?.funding?.reserveTarget, targetDelta.new.baseline);
        expected[rowIndex] = { ...row, inheritance: { ...row.inheritance,
            funding: { ...row.inheritance.funding, reserveTarget: targetDelta.new.variant } } };
    }
    assert.deepEqual(beforeExpense(expenseWithoutStatus.variant.chunk.runMeta[index]), expected);
}
const choice = comparisonIncomeChoices(inputs).find(entry => entry.id === 'pension:1');
const shifted = await runDecisionComparison({ ...options, change: { kind: 'income', incomeId: choice.id, months: 12 } });
// FR-73: Bei aktiver Pflege erreicht der geänderte Rentenbeginn das Liquiditätsziel schon im Vorjahr.
const oldYearIndex = Number(choice.start.slice(0, 4)) - comparisonReferenceYear(inputs);
for (let index = 0; index < 50; index++) {
    assert.deepEqual(shifted.baseline.chunk.runMeta[index].logDataRows.filter(row => row.jahr < oldYearIndex),
        shifted.variant.chunk.runMeta[index].logDataRows.filter(row => row.jahr < oldYearIndex));
}
assert.equal(JSON.stringify(inputs), original);
assert.throws(() => createDecisionVariant(inputs, { kind: 'budget', monthly: -100000 }), /Flex|flex|Bedarf/);
const identity = comparisonIdentity(options);
assert.throws(() => assertComparisonUnchanged(identity, comparisonIdentity({ ...options,
    inputs: { ...inputs, simulationPeople: [{ profileId: 'different' }] } })), /Vergleich nicht möglich.*Personen/);
let current = identity;
await assert.rejects(runDecisionComparison({ ...options, change: { kind: 'budget', monthly: 0 },
    readCurrentIdentity: () => current, onProgress: () => { current = 'changed'; } }), /Vergleich nicht möglich/);

// Ein Ruin darf die späteren Lebensziehungen nicht von der Marktfolge abhängig machen.
const ruin = await runDecisionComparison({ ...options, change: { kind: 'expense', amount: 10000000, month: '2027-01' } });
const lifeOnly = rows => rows.map(({ historicalYear, ...row }) => ({ ...row, careP1: row.p1Alive ? row.careP1 : 0, careP2: row.p2Alive ? row.careP2 : 0 }));
assert.deepEqual(lifeOnly(ruin.baseline.diagnostics), lifeOnly(ruin.variant.diagnostics));
// Die Variante kann den Ausgangsruin überleben: Marktfortsetzung und Leben bleiben getrennt.
const strained = { ...inputs, startFloorBedarf: strainedFloor, startFlexBedarf: 300000 };
const saved = await runDecisionComparison({ ...options, inputs: strained,
    change: { kind: 'budget', monthly: -20000 } });
assert.ok(saved.baseline.chunk.totals.failCount > saved.variant.chunk.totals.failCount);
assert.deepEqual(lifeOnly(saved.baseline.diagnostics), lifeOnly(saved.variant.diagnostics));
// Auch die weiteren Ziehverfahren und der ältere Gesamtstrom halten eine Nulländerung.
for (const [methode, rngMode] of [['block', 'per-run-seed'], ['stationary', 'per-run-seed'],
    ['regime_iid', 'per-run-seed'], ['regime_markov', 'legacy-stream']]) {
    const same = await runDecisionComparison({ ...options, monteCarloParams: { ...monteCarloParams, anzahl: 3, methode, rngMode },
        change: { kind: 'budget', monthly: 0 } });
    assert.deepEqual(same.baseline.chunk, same.variant.chunk);
}
const withIncome = { ...inputs, fixedIncomeReferenceYear: 2026, fixedIncome: [{ id: 'fixed', profileId: inputs.simulationPeople[0].profileId,
    art: 'sonstige', bezeichnung: 'Feste Einkunft', betragMonat: 800, ab: '2030-03', bis: '2035-12', anpassung: 'keine' }] };
const incomeVariant = createDecisionVariant(withIncome, { kind: 'income', incomeId: 'fixed:fixed', months: -6 });
assert.equal(incomeVariant.fixedIncome[0].ab, '2029-09');
assert.equal(incomeVariant.fixedIncome[0].betragMonat, 800);
assert.equal(withIncome.fixedIncome[0].ab, '2030-03');
const dated = { pensionStarts: ['2024-04', '2027-07'], referenceYear: 2026 };
assert.equal(comparisonIncomeChoices(inputs, dated)[0].start, '2024-04');
assert.deepEqual(createDecisionVariant(inputs, { kind: 'income', incomeId: 'pension:0', months: 12 }, dated), inputs);
const later = createDecisionVariant(inputs, { kind: 'income', incomeId: 'pension:0', months: 30 }, dated);
assert.equal(later.renteStartOffsetJahre, 0);
assert.equal(later.renteStartMonate, 3);
const beforePlan = createDecisionVariant(inputs, { kind: 'income', incomeId: 'pension:1', months: -30 }, dated);
assert.equal(beforePlan.partner.startInJahren, 0);
assert.equal(beforePlan.partner.renteStartMonate, 12);
assert.equal(beforePlan.partner.renteKalenderbeginn, false);
const nextPlanYear = createDecisionVariant(inputs, { kind: 'expense', amount: 1000, month: '2028-06' },
    { referenceYear: 2027 });
assert.equal(nextPlanYear.plannedExpensesReferenceYear, 2027);
assert.throws(() => assertComparisonUnchanged(comparisonIdentity({ ...options, ...dated }),
    comparisonIdentity({ ...options, ...dated, pensionStarts: ['2024-05', '2027-07'] })), /Vergleich nicht möglich/);

await measurementInputs(0, 'max-erika');

// Der Hinweis einer vorhandenen Einkunft muss beim leeren Plan verschwinden.
const doc = globalThis.document;
for (const id of ['decisionComparison', 'decisionBaseline', 'decisionIncomeHint', 'decisionRun', 'decisionCancel',
    'decisionProgress', 'decisionResult', 'decisionStatus', 'decisionRunHint', 'mcViewTabDecision']) addField(doc, id);
// Das kleine Node-DOM parst kein Options-HTML; die aktuelle Wahl wird explizit gesetzt.
Object.defineProperty(doc.getElementById('decisionIncome'), 'value', { configurable: true, writable: true, value: 'pension:0' });
initDecisionComparison(doc);
assert.match(doc.getElementById('decisionIncomeHint').textContent, /^neuer Beginn/);
const adopted = readDocumentPersonInputs(doc);
initializePersonOverrides(adopted.entries.map(entry => ({ ...entry,
    data: { ...entry.data, profile_rente_monatlich: '0' } })), adopted.entries[0].profileId, adopted.context.referenceYear, doc);
doc.getElementById('mcViewTabDecision').dispatchEvent({ type: 'click' });
assert.equal(doc.getElementById('decisionIncomeHint').textContent, 'Keine Einkunft zum Verschieben im Plan');
console.log('VG-1: Nulländerung, 50 gepaarte Markt-/Lebenspfade, Präfixe, normale Aggregate und Schutzprüfung grün.');
