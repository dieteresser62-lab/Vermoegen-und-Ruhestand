import { deriveMinimumFlexPath, buildMinimumFlexRestriction } from '../app/simulator/minimum-flex-metrics.js';
import { buildMonteCarloAnswers, buildKpiDashboard, projectMinimumFlexDisplay } from '../app/simulator/results-metrics.js';
import { projectMonteCarloOverview, projectBacktestOverview } from '../app/simulator/simulator-result-overview.js';
import { renderMonteCarloAnswers } from '../app/simulator/results-renderers.js';
import { tokenizeHTML, matchesSelector } from './funktionsinventar-contract.mjs';
import { projectScenarioLogV2, serializeScenarioLogExportV2, serializeScenarioLogCsvV2, readScenarioLogExport } from '../app/simulator/monte-carlo-export.js';
import { buildSimulationSummary } from '../app/simulator/simulator-overview-summary.js';
import { assertSimulationRecord, simulationEntryKey } from '../app/overview/overview-simulation-summary.js';

const row = (paid, minimum = 30000) => ({ recordType: 'financial_year', financiallyEvaluable: true,
    minimumFlexAnnual: minimum, flex_haushalt_erfuellt: paid, flex_wunsch_haushalt_nominal: 45000,
    flex_unter_mindestflex: minimum > 0 && paid < minimum });
const rows = [row(40000), row(28000), row(35000)];
const path = deriveMinimumFlexPath(rows);
const block = buildMinimumFlexRestriction([path, deriveMinimumFlexPath([row(30000), row(30000)])], 30000);
const results = { minimumFlexRestriction: block, cutYearSharePct: { p50: 99 },
    kpiMaxKuerzung: { p50: 40 }, outcomeInventory: { schemaVersion: 'MonteCarloOutcomeInventoryV1',
        requestedRuns: 2, technical_error: 0, floorCoveragePct: 100, ruin: 0, all_dead: 0, horizon_exhausted: 2 } };
const before = JSON.stringify(results);
const answer = buildMonteCarloAnswers({ results, totalRuns: 2, failCount: 0 })[1];
assertEqual(answer.value, '16,7 % der Jahre', 'FR-6 zeigt Laufmedian 16,7 %, keine gepoolten 20 % oder alte 99 %');
assertEqual(answer.metrics[0].value, '16,7 %', 'Jahresanteil steht im ersten gleichwertigen Wertfeld');
assertEqual(answer.metrics[1].value, '50,0 %', 'Betroffene Läufe stehen im zweiten gleichwertigen Wertfeld');
assert(answer.subtitle.includes('unter Mindest-Flex'), 'Kernfrage wird sichtbar auf Mindest-Flex eingegrenzt');
for (const text of ['30.000', 'jährlich fortgeschrieben', '50,0', '32.500', '45.000', '29.000', 'Nominale Jahresbeträge'])
    assert(answer.tooltip.includes(text), 'Eingefrorene Erklärung enthält ' + text);
assert(answer.text.includes('dein Flex unter deinem Mindest-Flex'), 'Wunsch-Kürzung ersetzt keine Mindest-Unterschreitung');
assertEqual(answer.text, 'In typisch 16,7 % der Entnahmejahre liegt dein Flex unter deinem Mindest-Flex von 30.000 €.', 'Positive Mindest-Flex-Antwort bleibt genau ein Satz');
assertEqual(answer.note, 'Nominale Jahresbeträge · Typisch 32.500 € von 45.000 € Wunsch-Flex laut Plan · schwächstes Jahr 29.000 €', 'Kurze Notiz enthält Geldbasis, Planbezug und Beträge');
assertEqual(JSON.stringify(projectMonteCarloOverview(results, 2, 0).answers[1]), JSON.stringify(answer), 'Übersicht und MC-Details nutzen identische FR-6-Antwort');
const card = buildKpiDashboard(results, { minimumFlexAnnual: 99999 }).primary[2];
assertEqual(card.value, '16,7 %', 'Detailkennzahl bleibt beim Laufwert nach Eingabeänderung');
assert(card.description.includes('30.000') && !card.description.includes('99.999'), 'Detailerklärung nutzt eingefrorenen Startwert');
const host = { innerHTML: '' }; renderMonteCarloAnswers(host, [answer], true);
function checkAnswerInfo(output, explanation) {
    const tree = tokenizeHTML(output.innerHTML);
    const button = tree.elements.find(node => matchesSelector({ elements: [node] }, '.sim-card-heading > .ds-info > .ds-info-button'));
    assert(button?.attrs['aria-controls'] && button.parent.parent.children[0].tag === 'h2', 'Mindest-Flex-Info steht im selben Kartenkopf rechts neben der Frage');
    const popup = tree.elements.find(node => node.attrs.id === button?.attrs['aria-controls']);
    assert(popup?.attrs.role === 'tooltip' && output.innerHTML.includes(explanation), 'Mindest-Flex-Info enthält die vollständige passende Methodik');
    assert(!tree.elements.some(node => ['section', 'h2'].includes(node.tag) && Object.hasOwn(node.attrs, 'title')), 'Mindest-Flex-Karte und Frage haben keinen kartenweiten Titeltooltip');
}
checkAnswerInfo(host, answer.tooltip);
for (const text of ['Mediane der Laufstatistiken', 'keine gepoolten Jahre', '2 auswertbare Läufe', 'jeweils angewandten Jahresbetrag'])
    assert(host.innerHTML.includes(text), 'Mindest-Flex-Info bewahrt die Laufmethodik: ' + text);
assert(host.innerHTML.includes('Annahmen seitdem geändert') && host.innerHTML.includes('32.500'), 'Renderer erhält Zahl, Erklärung und Annahmenstatus');
assertEqual(JSON.stringify(results), before, 'Anzeige mutiert keine Laufdaten');
const zero = { ...results, minimumFlexRestriction: buildMinimumFlexRestriction([deriveMinimumFlexPath([row(30000)])], 30000) };
const zeroAnswer = buildMonteCarloAnswers({ results: zero })[1];
assertEqual(zeroAnswer.value, '0,0 % der Jahre', 'Keine Unterschreitung trotz Wunsch-Kürzung');
const mixedZero = { ...results, minimumFlexRestriction: { ...block, yearSharePctP50: 0, affectedRunSharePct: 35.5 } };
const mixedAnswer = buildMonteCarloAnswers({ results: mixedZero })[1];
const mixedHost = { innerHTML: '' }; renderMonteCarloAnswers(mixedHost, [mixedAnswer]);
const mixedTree = tokenizeHTML(mixedHost.innerHTML);
const pairValues = mixedTree.elements.filter(node => node.attrs.class === 'sim-answer-metric-value');
assertEqual(pairValues.length, 2, 'Typische Jahre und betroffene Läufe verwenden dieselbe Darstellung');
assert(mixedHost.innerHTML.includes('0,0 %') && mixedHost.innerHTML.includes('35,5 %') && mixedHost.innerHTML.includes('Mindestens ein Jahr unter Mindest-Flex'), 'Nullmedian und betroffene Läufe sind gleichzeitig sichtbar');
assert(!mixedAnswer.text.includes('Gut:'), 'Nullmedian mit betroffenen Läufen erhält keine pauschale positive Botschaft');
assert(zeroAnswer.text.includes('Im typischen Lauf') && zeroAnswer.tooltip.includes('keine Garantie') && zeroAnswer.text.includes('keinem ausgewerteten Entnahmejahr'), '0 % bleibt auf den typischen Lauf und beobachtete Jahre begrenzt');
assertEqual(zeroAnswer.text, 'Im typischen Lauf liegt dein Flex in keinem ausgewerteten Entnahmejahr unter deinem Mindest-Flex von 30.000 €.', 'Null-Antwort bleibt genau ein Satz mit eingefrorenem Mindestbetrag');
for (const legacy of [{ cutYearSharePct: { p50: 12 } }, { ...results, minimumFlexRestriction: { ...block, startMinimumFlexAnnual: 0 } }]) {
    const old = buildMonteCarloAnswers({ results: legacy })[1];
    assert(old.text.includes('mehr als 10 % unter Wunsch-Flex') && old.tooltip.includes('einschließlich genau 10 %'), 'Legacy und Mindestwert 0 behalten beschriftete inklusive Altgrenze');
    const oldHost = { innerHTML: '' }; renderMonteCarloAnswers(oldHost, [old]);
    checkAnswerInfo(oldHost, old.tooltip);
}
assertEqual(buildMonteCarloAnswers({ results: {} })[1].value, '—', 'Legacy ohne Zahl erfindet keinen Anteil');
for (const change of [{ startMinimumFlexAnnual: null }, { missingReason: 'no_evaluable_runs' },
    { yearSharePctP50: NaN }, { affectedRunSharePct: -1 }, { yearSharePctP50: 101 }, { sampleSize: 0 }]) {
    const invalid = { ...results, minimumFlexRestriction: { ...block, ...change } };
    const output = buildMonteCarloAnswers({ results: invalid })[1];
    assertEqual(output.value, '—', 'Ungültiger neuer Block fällt nicht auf 99 % Legacy zurück');
    assert(output.text.includes('Nicht auswertbar'), 'Fehlende Messdaten sind verständlich erklärt');
    assert(!/undefined|NaN|null/.test(JSON.stringify(output)), 'Keine technischen Platzhalter sichtbar');
    const invalidHost = { innerHTML: '' }; renderMonteCarloAnswers(invalidHost, [output]);
    checkAnswerInfo(invalidHost, output.tooltip);
    assert(invalidHost.innerHTML.includes(output.text + ' ' + output.tooltip), 'Nicht auswertbare Mindest-Flex-Info erklärt den fehlenden Messwert');
}
for (const change of [{ batchStatus: 'technical_error' }, { financialMetricsValid: false },
    { outcomeInventory: { ...results.outcomeInventory, technical_error: 1 } }]) {
    assert(buildMonteCarloAnswers({ results: { ...results, ...change } }).every(item => item.value === '—'), 'Technische Invalidierung sperrt beide Finanzantworten');
}
const historicalBlock = { ...buildMinimumFlexRestriction([path], 30000), path };
const historical = { outcome: { kind: 'completed' }, minimumFlexRestriction: historicalBlock,
    metrics: { minimumFlexRestriction: historicalBlock, values: { flex_reduction_years_gte_10_pct: null },
        flexBasisContract: { consistent: false, observed: ['static_input', 'effective_vpw_plus_pension_surplus'] } } };
const projected = projectBacktestOverview(historical);
assertEqual(projected.restriction.title, 'Jahre unter Mindest-Flex', 'Backtest benennt FR-6');
assertEqual(projected.restriction.value, '33,3 %', 'Backtest zeigt 33,3 %');
assertEqual(projected.restriction.count, 1, 'Backtest hat ein betroffenes Jahr');
assertEqual(projected.restriction.observationCount, 3, 'Backtest Nenner ist drei');
assertEqual(projected.cutMissingReason, '', 'Dynamic-Flex-/Safety-Wechsel erzeugt keinen Altfehlgrund');
for (const text of ['35.000', '45.000', '28.000']) assert(projected.restriction.note.includes(text), 'Backtest enthält nominalen Betrag ' + text);
for (const kind of ['technical_error', 'incomplete'])
    assertEqual(projectMinimumFlexDisplay({ ...historical, outcome: { kind } }, { backtest: true }).value, '—', 'Unvollständiger Backtest liefert keine Zahl');
const scenario = projectScenarioLogV2(rows);
const read = readScenarioLogExport(serializeScenarioLogExportV2(scenario)).document;
assertEqual(read.records[1].minimumFlexConfiguredAnnualEur, 30000, 'Szenario erhält angewandten Mindestbetrag über bestehendes Exportmapping');
assertEqual(read.records[1].flex_haushalt_erfuellt, 28000, 'Szenario erhält tatsächlich bezahlten Haushalts-Flex');
assertEqual(read.records[1].flex_wunsch_haushalt_nominal, 45000, 'Szenario erhält Wunsch-Flex');
assertEqual(read.records[1].flex_unter_mindestflex, true, 'Szenario erhält Jahresmerkmal');
const csv = serializeScenarioLogCsvV2(scenario);
for (const name of ['flex_wunsch_haushalt_nominal', 'flex_haushalt_erfuellt', 'flex_unter_mindestflex', 'minimumFlexConfiguredAnnualEur'])
    assert(csv.split('\n')[0].includes(name), 'Szenario-CSV erhält ' + name);
assert(scenario.unitContract.annualMoneyFields.flex_haushalt_erfuellt.includes('nominal'), 'Szenariobeträge sind ausdrücklich nominal');
const scope = { kind: 'single', ids: ['a'], key: JSON.stringify(['single', ['a']]) };
const context = { kind: 'montecarlo', scope, fingerprintVersion: 2, sourceFingerprint: 'a'.repeat(64), runFingerprint: 'b'.repeat(64), deviationApplied: false };
const summary = buildSimulationSummary(context, results);
assertEqual(summary.metrics.minimumFlexYearSharePct, block.yearSharePctP50, 'MC-Beleg speichert vorhandenen Laufmedian');
assertEqual(summary.metrics.flexPaidMedianNominalEur, 32500, 'MC-Beleg speichert nominalen Betrag');
const raw = item => ({ version: 1, entries: { [simulationEntryKey(scope, item.kind)]: item } });
assertSimulationRecord(raw(summary));
const old = buildSimulationSummary(context, { ...results, minimumFlexRestriction: undefined, cutYearSharePct: {} });
assert(!Object.hasOwn(old.metrics, 'legacyFlexCutYearSharePct'), 'Fehlende Legacy-Zahl wird nicht als Null gespeichert');
for (const value of ['3', -1, Infinity]) {
    const invalid = structuredClone(summary); invalid.metrics.minimumFlexYearSharePct = value;
    let rejected = false; try { assertSimulationRecord(raw(invalid)); } catch { rejected = true; }
    assert(rejected, 'Strenge Importgrenze weist ungültige optionale Werte ab');
}

for (const blockValue of [null, undefined]) {
    const output = buildMonteCarloAnswers({ results: { ...results, minimumFlexRestriction: blockValue } })[1];
    assertEqual(output.value, '—', 'Vorhandener leerer neuer Block fällt nicht still auf Legacy zurück');
    assert(!/undefined|NaN|null/.test(JSON.stringify(output)), 'Leerer neuer Block zeigt keine technischen Platzhalter');
}
const missingAmounts = buildMonteCarloAnswers({ results: { ...results, minimumFlexRestriction: { ...block, paidMedianNominalEurP50: null } } })[1];
assert(missingAmounts.note.includes('Typisch —') && missingAmounts.tooltip.includes('Betragsangaben fehlen'), 'Fehlender Betrag bleibt sichtbar ohne erfundenen Nullbetrag');
const abovePlan = buildMonteCarloAnswers({ results: { ...results, minimumFlexRestriction: { ...block, paidMedianNominalEurP50: 168613, desiredMedianNominalEurP50: 64611 } } })[1];
assert(abovePlan.note.includes('Wunsch-Flex laut Plan') && !abovePlan.note.includes(' von ') && abovePlan.tooltip.includes('Dynamic Flex (VPW)'), 'Auszahlung oberhalb des Plans wird ohne widersprüchlichen Von-Vergleich erklärt');
assert(host.innerHTML.includes('sim-flex-note') && host.innerHTML.includes('role="tooltip">Mindest-Flex zum Laufstart:'), 'Methodik bleibt im Titeltooltip und die sichtbare Notiz nutzt den kompakten Hinweisstil');
