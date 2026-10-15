import { createEuroPathTracker, recordEuroFinancialYear, recordEuroZeroWithdrawal, finalizeEuroPath, buildEuroAggregates } from '../app/simulator/mc-euro-metrics.js';
import { createMonteCarloPathSummaryV1, recordMonteCarloPathSummaryV1, MONTE_CARLO_MISSINGNESS_CODE as codes } from '../app/simulator/monte-carlo-chunk-result.js';
import { prepareMonteCarloViewModel, buildMonteCarloAnswers, WITHDRAWAL_CARD_TITLE } from '../app/simulator/results-metrics.js';
import { buildMinimumFlexRestriction } from '../app/simulator/minimum-flex-metrics.js';
import { getEuroMode, setEuroMode, resetEuroMode, bindEuroMode } from '../app/simulator/euro-display.js';
import { readFileSync } from 'node:fs';
import { renderProtocolTable, renderProtocolSummary } from '../app/simulator/protocol-renderer.js';
import { buildScenarioAnalysisView } from '../app/simulator/scenario-log-analysis.js';

// 100 % bekannte Jahresinflation: Anfangsfaktoren 1/2/4, Endfaktoren 2/4/8.
const tracker = createEuroPathTracker(3);
const rows = [100, 300, 1000].map((entnahme, index) => ({ jahr: index + 1, recordType: 'financial_year',
    financiallyEvaluable: true, inflation_factor_cum: 2 ** index, inflation: 100,
    entnahme_effektiv: entnahme, jahresentnahme_real: entnahme / 2 ** index,
    entscheidung: { jahresEntnahme: entnahme, kuerzungProzent: 0 }, Regime: 'NORMAL',
    flex_haushalt_erfuellt: [80, 120, 160][index], flex_wunsch_haushalt_nominal: [100, 200, 400][index], minimumFlexAnnual: 200,
    taxSavedByLossCarry: [1, 4, 12][index], steuern_gesamt: [10, 40, 120][index],
    health_bucket_used: [2, 8, 24][index], health_bucket_end: 64, health_bucket_target_gap: 32,
    portfolio_total_end: [900, 950, 1000][index], Person1Alive: 1 }));
for (const [index, row] of rows.entries()) recordEuroFinancialYear(tracker, row, row.steuern_gesamt, index, 2 ** (index + 1));
const measured = finalizeEuroPath(tracker);
assertEqual(measured.taxPaidRealEur, 60, 'Jahressteuern werden einzeln mit 1/2/4 deflationiert');
assertEqual(measured.taxSavedRealEur, 6, 'Steuerersparnis wird jährlich deflationiert');
assertEqual(measured.healthBucketUsedRealEur, 12, 'Reservenutzung ist die Summe realer Jahreszahlungen');
assertEqual(measured.healthBucketEndRealEur, 8, 'Restreserve verwendet den Jahresendfaktor 8');
assertEqual(measured.healthBucketTargetGapRealEur, 4, 'Ziellücke verwendet den Jahresendfaktor 8');
assertEqual(measured.minimumFlexPaidMedianRealEur, 60, 'Bezahlter Flex wird vor der Medianbildung jährlich deflationiert');
assertEqual(measured.minimumFlexDesiredMedianRealEur, 100, 'Realer Wunsch-Flex bleibt bei passender Fortschreibung konstant');
assertEqual(measured.minimumFlexPaidMinimumRealEur, 40, 'Schwächstes Jahr wird auf realer Jahresserie bestimmt');
assertEqual(measured.withdrawalP10NominalEur, 140, 'Nominales Lauf-P10 aus 100/300/1000');
assertEqual(measured.stressWithdrawalP10NominalEur, 140, 'Stressfenster hat eine eigene nominale Jahresserie');
const ruined = createEuroPathTracker(3);
recordEuroFinancialYear(ruined, rows[0], 10, 0, 2);
recordEuroZeroWithdrawal(ruined, 1); recordEuroZeroWithdrawal(ruined, 2);
assertEqual(finalizeEuroPath(ruined).withdrawalP10NominalEur, 0, 'Ruinjahre zählen auch nominal als Null');
assertEqual(finalizeEuroPath(ruined).stressWithdrawalP10NominalEur, 0, 'Ruinjahre zählen im Stressfenster als Null');

const paths = createMonteCarloPathSummaryV1(2);
for (let index = 0; index < 2; index++) recordMonteCarloPathSummaryV1({ ...paths,
    localIndex: index, globalRunIndex: index, outcomeCode: 3,
    finalValueNominalEur: index ? 600 : 1000, finalValueRealEur: index ? 300 : 125,
    euroMetrics: measured, realWithdrawalP10RealEur: 110, realWithdrawalObservationCount: 3,
    minimumFlexRestriction: { completedYearCount: 3, observationCount: 3, affectedYearCount: 3,
        yearSharePct: 100, affected: true, paidMedianNominalEur: 120, desiredMedianNominalEur: 200, paidMinimumNominalEur: 80, missingReason: null },
    p1CareEntryAge: 80, careEverActive: true, p1CareYears: 3,
    p1CareAdditionalNeedNominalEur: 1700, totalCareAdditionalNeedNominalEur: 1700, maxAnnualCareAdditionalNeedNominalEur: 1200,
    p1CareAdditionalNeedRealEur: 600, totalCareAdditionalNeedRealEur: 600, maxAnnualCareAdditionalNeedRealEur: 300,
    healthBucketEnabled: true, healthBucketUsedEur: 34 });
paths.pathMissingness.stressRealWithdrawalP10RealEur.fill(codes.OBSERVED);
const euroMetrics = buildEuroAggregates(paths.pathSummaries, paths.pathMissingness, 2, codes);
assertEqual(euroMetrics.real.finalOutcomes.p50, 212.5, 'Realer Median aus den realen Pfadendwerten 125/300');
assertEqual(euroMetrics.real.finalOutcomes.p10, 142.5, 'Reales P10 entsteht unabhängig vom nominalen Rang');
assertEqual(euroMetrics.nominal.pflege.p1.additionalNeedEurP50, 1700, 'Pflegebedarf ist auch nominal verfügbar');
assertEqual(euroMetrics.real.pflege.p1.additionalNeedEurP50, 600, 'Realer Pflegebedarf bleibt getrennt');
const minimum = buildMinimumFlexRestriction([{ completedYearCount: 3, observationCount: 3, affectedYearCount: 3,
    yearSharePct: 100, affected: true, paidMedianNominalEur: 120, desiredMedianNominalEur: 200, paidMinimumNominalEur: 80, missingReason: null }], 200);
const result = { euroMetrics, finalOutcomes: { p10: 640, p50: 800, p90: 960, p50_successful: 800, successfulCount: 2 },
    taxOutcomes: { p50: 170 }, realWithdrawalP10: { realEur: 110, p50RealEur: 120, sampleSize: 2 },
    minimumFlexRestriction: minimum, cutYearSharePct: { p50: 0 },
    extraKPI: { lossCarryTaxSavings: { perRunMean: 17 }, healthBucket: { usedMedian: 34, usedP90: 34, endMedian: 64, targetGapMedian: 32 },
        pflege: { p1: { sampleSize: 2 }, household: {}, comparison: {} } },
    stressKPI: { presetKey: 'SYNTHETIC', years: 3, realWithdrawalP10: { realEur: 110, p50RealEur: 120, sampleSize: 2 } } };
const inputs = { pflegefallLogikAktivieren: true, healthBucketEnabled: true };
const before = JSON.stringify(result);
const view = mode => prepareMonteCarloViewModel({ results: result, totalRuns: 2, failCount: 0, inputs, moneyBasis: mode });
const nominal = view('nominal'), real = view('real');
assertEqual(nominal.summaryCards.filter(card => card.otherBasisLine).length, 1, 'Nur der Endvermögensmedian erhält einen Gegenwert');
assertEqual(nominal.kpiDashboard.primary.filter(card => card.otherBasisLine).length, 1, 'Nur die Hauptentnahmekarte erhält einen Gegenwert');
for (const title of ['Median (alle)', 'Median (erfolgreiche)', '10%/90% Perzentil', 'Median Steuern']) {
    assert(nominal.summaryCards.find(card => card.title === title).value !== real.summaryCards.find(card => card.title === title).value, `${title} folgt der Euro-Basis`);
}
for (const title of [WITHDRAWAL_CARD_TITLE, 'Ø Steuerersparnis Verlustvortrag']) {
    assert(nominal.kpiDashboard.primary.find(card => card.title === title).value !== real.kpiDashboard.primary.find(card => card.title === title).value, `${title} folgt der Euro-Basis`);
}
for (const title of ['Pflege-Mehrbedarf P1 (Median)', 'Max. jährlicher Pflege-Mehrbedarf', 'Gesamter Pflege-Mehrbedarf', 'Median Reservenutzung', 'P90 Reservenutzung', 'Median Restreserve', 'Median Ziellücke']) {
    assert(nominal.careMetrics.cards.find(card => card.title === title).value !== real.careMetrics.cards.find(card => card.title === title).value, `${title} folgt der Euro-Basis`);
}
assert(nominal.stressMetrics.kpis[4].value !== real.stressMetrics.kpis[4].value, 'Stressentnahme folgt der Euro-Basis');
assertEqual(nominal.stressMetrics.kpis[4].value, '140 €', 'Stresskarte zeigt das unabhängig aggregierte nominale P10');
assertEqual(JSON.stringify(nominal.kpiDashboard.drawdownKpis), JSON.stringify(real.kpiDashboard.drawdownKpis), 'Drawdown-Prozente ändern sich nicht');
assertEqual(nominal.summaryCards[0].value, real.summaryCards[0].value, 'Deckungsanteil bleibt gleich');
assert(nominal.summaryCards[2].otherBasisLine.includes('213') && real.summaryCards[2].otherBasisLine.includes('800'), 'Endvermögen zeigt darunter die jeweils andere Basis');
const withdrawal = nominal.kpiDashboard.primary.find(card => card.displayRole === 'withdrawal');
assert(withdrawal.description.includes('ohne Renten') && withdrawal.secondaryLabel === 'im typischen Lauf:', 'Entnahmekarte erklärt Bezug und typischen Lauf');
assert(withdrawal.tooltip.includes('0 €') && withdrawal.tooltip.includes('schwächsten 10 %'), 'Herleitung erklärt schwache Jahre und Ruin');
assertEqual(JSON.stringify(result), before, 'Umschalten verändert keine Ergebnisdaten');
const nominalAnswers = buildMonteCarloAnswers({ results: result, totalRuns: 2, failCount: 0, moneyBasis: 'nominal' });
const realAnswers = buildMonteCarloAnswers({ results: result, totalRuns: 2, failCount: 0, moneyBasis: 'real' });
assert(nominalAnswers[1].note.includes('120') && realAnswers[1].note.includes('60'), 'Einschränkungsantwort schaltet die Jahresbeträge um');
assertEqual(nominalAnswers[1].metrics[0].value, realAnswers[1].metrics[0].value, 'FR-6-Anteil bleibt unverändert');

const legacy = { ...result }; delete legacy.euroMetrics;
const oldNominal = prepareMonteCarloViewModel({ results: legacy, totalRuns: 2, failCount: 0, inputs });
const oldReal = prepareMonteCarloViewModel({ results: legacy, totalRuns: 2, failCount: 0, inputs, moneyBasis: 'real' });
assertEqual(oldNominal.summaryCards[2].value, '800 €', 'Altes Ergebnis zeigt vorhandenen nominalen Median');
assertEqual(oldNominal.kpiDashboard.primary.find(card => card.displayRole === 'withdrawal').value, '—', 'Fehlendes nominales Lauf-P10 wird nicht geraten');
assertEqual(oldReal.summaryCards[5].value, '—', 'Fehlende reale Steuersumme bleibt unbekannt');
assertEqual(oldReal.kpiDashboard.primary.find(card => card.displayRole === 'withdrawal').value, '110 €', 'Altes reales Lauf-P10 bleibt nutzbar');

const table = mode => renderProtocolTable(rows, { source: 'mc', moneyBasis: mode, logDetailLevel: 'detailed' });
assert(table('nominal').includes('1.000 €') && table('real').includes('250 €'), 'Jahresprotokoll schaltet auch die Entnahme um');
assert(table('real').includes('125 €'), 'Jahresendbestand im Protokoll verwendet Endfaktor 8');
assert(!renderProtocolSummary(rows, { moneyBasis: 'real', endWealth: null }).includes('Endvermögen'),
    'Fehlender realer Endwert wird im Protokollkopf nicht durch nominales Geld ersetzt');
const realSummary = renderProtocolSummary(rows, { moneyBasis: 'real' });
assert(realSummary.includes('Endvermögen 125 € · heutige Euro') && !realSummary.includes('nominale Euro'),
    'Protokollkopf ohne vorgegebenen Endwert projiziert Betrag und Basis aus demselben Jahresbeleg');
assert(!renderProtocolSummary([{ ...rows.at(-1), inflation: null }], { moneyBasis: 'real' }).includes('Endvermögen'),
    'Protokollkopf erfindet bei fehlender Inflation keinen realen Endwert');
const scenario = { key: 'p50', failed: false, endVermoegen: 1000, logDataRows: rows };
const points = mode => { const v = buildScenarioAnalysisView(scenario, { moneyBasis: mode, initialWealth: 1000 }); return [...v.cards, ...v.more]; };
assert(points('nominal').find(point => point.type === 'minimum_real_year_end_wealth').valueText.includes('1.000'), 'Pfadkarte zeigt nominalen Stand am Kaufkraft-Tief');
assert(points('real').find(point => point.type === 'minimum_real_year_end_wealth').valueText.includes('125'), 'Pfadkarte zeigt reale Kaufkraft desselben Tiefjahrs');

const doc = {}, buttons = ['real', 'nominal'].map(mode => ({ getAttribute: () => mode, setAttribute(_key, value) { this.pressed = value; } }));
const host = { querySelectorAll: () => buttons, addEventListener(_type, fn) { this.click = fn; }, removeEventListener() {} };
let updates = [];
assertEqual(getEuroMode(doc), 'nominal', 'Sitzung startet nominal');
const dispose = bindEuroMode(doc, host, mode => updates.push(mode));
setEuroMode('real', doc);
assertEqual(buttons[0].pressed, 'true', 'Gemeinsamer Baustein zeigt die aktive Basis');
dispose();
const disposeAgain = bindEuroMode(doc, host, mode => updates.push(mode));
assertEqual(updates.at(-1), 'real', 'Erneutes Binden erhält die Sitzungswahl');
resetEuroMode(doc);
assertEqual(getEuroMode(doc), 'nominal', 'Ein neuer Lauf setzt die gemeinsame Wahl auf Nominal zurück');
assertEqual(buttons[1].pressed, 'true', 'Rücksetzen aktualisiert auch den sichtbaren Knopf');
assertEqual(getEuroMode({}), 'nominal', 'Ein neues Dokument startet wieder nominal');
disposeAgain();

const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
const infos = [];
for (const prefix of ['mc', 'backtest']) {
    const segment = html.match(new RegExp(`<div id="${prefix}WealthMode"[^>]*>(.*?)</div>`))[1];
    const options = [...segment.matchAll(/data-wealth-mode="([^"]+)" aria-pressed="([^"]+)">([^<]+)</g)];
    assertEqual(options.map(match => match[1]).join(','), 'nominal,real', prefix + ': Nominal steht links');
    assertEqual(options.map(match => match[2]).join(','), 'true,false', prefix + ': HTML startet ohne Real-Aufblitzen nominal');
    assertEqual(options.map(match => match[3]).join('/'), 'Nominal · Kontowert/Real · heutige Kaufkraft', prefix + ': verständliche Beschriftungen');
    infos.push(html.match(new RegExp(`<span id="${prefix}EuroInfo" class="ds-info-pop" role="tooltip">(.*?)</span>`))[1]);
}
assertEqual(infos[0], infos[1], 'Beide Reiter erklären Nominal und Real mit demselben Info-Baustein');
assert(infos[0].includes('100.000 €') && infos[0].includes('67.000 €') && infos[0].includes('Prozente, Jahre und Anzahlen'), 'Info erklärt Kaufkraft an einem Beispiel und unveränderte Einheiten');
assert(html.indexOf('id="backtestWealthMode"') < html.indexOf('class="sim-backtest-grid"'), 'Backtest-Schalter steht sichtbar oberhalb der Ergebnisse');
assert(!html.includes('id="backtestEuroHint"'), 'Langer Hinweis neben dem Schalter entfällt');
