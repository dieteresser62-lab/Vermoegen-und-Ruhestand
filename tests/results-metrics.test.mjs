import {
    buildCareMetrics,
    buildKpiDashboard,
    buildStressMetrics,
    buildSummaryData,
    buildMonteCarloAnswers,
    prepareMonteCarloViewModel,
    WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE
} from '../app/simulator/results-metrics.js';
import { buildMonteCarloOutcomeInventoryV1 } from '../app/simulator/monte-carlo-chunk-result.js';

console.log('--- Results Metrics UI Contract Tests ---');

// P16: feste Anzeigeorakel auf bestehenden Werten, ohne neue Rechnung.
const answerFixture = (outcomes = { requestedRuns: 100, ruin: 4, all_dead: 40, horizon_exhausted: 56, technical_error: 0 }) => ({
    results: { outcomeInventory: buildMonteCarloOutcomeInventoryV1(outcomes),
        cutYearSharePct: { p50: 12, thresholdPct: 10, sampleSize: 100 }, kpiMaxKuerzung: { p50: 18 } }, totalRuns: outcomes.requestedRuns, failCount: outcomes.ruin
});
const answerInput = answerFixture();
const answerBytes = JSON.stringify(answerInput);
const answers = buildMonteCarloAnswers(answerInput);
assertEqual(answers[0].question, 'Ist mein Grundbedarf gedeckt?', 'Erste Kernfrage wortgetreu');
assertEqual(answers[1].question, 'Muss ich mich einschränken?', 'Zweite Kernfrage wortgetreu');
assertEqual(answers[0].value, '96,0 %', 'Antwort verwendet unveränderte 96-%-Deckung');
assertEqual(answers[1].value, '12,0 % der Jahre', 'Antwort verwendet unveränderten kanonischen p50-Anteil der Kürzungsjahre');
assert(answers[1].note.includes('18,0 %') && answers[1].text.includes('mehr als 10 % unter Wunsch-Flex') && answers[1].tooltip.includes('einschließlich genau 10 %'), 'Antwort erklärt 18-%-Maximalkürzung und 10-%-Jahresschwelle');
assert(answers[1].tooltip.includes('abgeschlossenen Entnahmejahre') && answers[1].tooltip.includes('frei planbare Ausgaben')
    && answers[1].tooltip.includes('Mediane') && answers[1].tooltip.includes('unterschiedlichen Läufen'), 'Anteil, Flex-Bedarf und getrennte Mediane bleiben verständlich');
assert(answers[0].note.includes('kein nachgewiesenes Lebensende'), 'Zeitraumende belegt kein Lebensende');
assertEqual(JSON.stringify(answerInput), answerBytes, 'Antwortprojektion verändert keine Ergebniswerte');
for (const [runs, ruin, expected, count] of [
    [10000, 1, '> 99,9\u00a0%', '9.999 von 10.000 Läufen'],
    [10000, 0, '100,0\u00a0%', '10.000 von 10.000 Läufen'],
    [100, 4, '96,0\u00a0%', '96 von 100 Läufen'],
    [10000, 10, '99,9\u00a0%', '9.990 von 10.000 Läufen'],
    [1, 1, '0,0\u00a0%', '0 von 1 Läufen']
]) {
    const input = answerFixture({ requestedRuns: runs, ruin, all_dead: 0, horizon_exhausted: runs - ruin, technical_error: 0 });
    const answer = buildMonteCarloAnswers(input)[0];
    const summary = buildSummaryData(input)[0];
    assertEqual(answer.value, expected, 'Deckung verschweigt keinen Ruinfall durch Rundung');
    assertEqual(answer.countText, count, 'Deckung zeigt erfolgreichen Zähler und gesamten Nenner');
    assertEqual(summary.displayValue, answer.value, 'Zusammenfassung und Kernantwort haben dieselbe Deckung');
    assertEqual(summary.countText, count, 'Zusammenfassung verwendet dieselben Laufzahlen');
}
const deathAnswers = buildMonteCarloAnswers(answerFixture({ requestedRuns: 100, ruin: 0, all_dead: 100, horizon_exhausted: 0, technical_error: 0 }));
assert(deathAnswers[0].text.includes('bis zum simulierten Lebensende'), 'Vollständiger Todpfad wird als simuliertes Lebensende bezeichnet');
const horizonAnswers = buildMonteCarloAnswers(answerFixture({ requestedRuns: 100, ruin: 0, all_dead: 0, horizon_exhausted: 100, technical_error: 0 }));
assert(!horizonAnswers[0].text.includes('bis zum simulierten Lebensende') && horizonAnswers[0].note.includes('Zeitraumende'), 'Reiner Zeitraumendpfad behauptet kein Lebensende');
const zeroInput = answerFixture(); zeroInput.results.cutYearSharePct.p50 = 0; zeroInput.results.kpiMaxKuerzung.p50 = 0;
const zeroAnswers = buildMonteCarloAnswers(zeroInput);
assertEqual(zeroAnswers[1].value, '0,0 % der Jahre', 'Echter Null-Anteil der Kürzungsjahre bleibt Null');
assert(zeroAnswers[1].text.includes('keine Jahre') && zeroAnswers[1].note.includes('0,0 %'), 'Null bedeutet nur keine Kürzung ab 10 %, nicht fehlende Daten');
const legacyInput = { results: { cutYearSharePct: { p50: 12, thresholdPct: 10, sampleSize: 100 }, kpiMaxKuerzung: { p50: 18 } }, totalRuns: 100, failCount: 4 };
const legacyAnswers = buildMonteCarloAnswers(legacyInput);
assertEqual(buildMonteCarloAnswers(legacyInput)[0].value, '96,0 %', 'Legacy verwendet vorhandenen Deckungsfallback');
assert(buildMonteCarloAnswers(legacyInput)[0].note.includes('Altes Ergebnis'), 'Legacy ohne Endzustandsbeleg bleibt gekennzeichnet');
const removedAliasInput = { results: { kpiKuerzungsjahre: { p50: 4 }, kpiMaxKuerzung: { p50: 18 } }, totalRuns: 100, failCount: 4 };
assertEqual(buildMonteCarloAnswers(removedAliasInput)[1].value, '—', 'Entfernter absoluter Jahresalias liefert keinen kanonischen Anteil oder Fallback');
const conflictingAliasInput = answerFixture(); conflictingAliasInput.results.kpiKuerzungsjahre = { p50: 99 };
assertEqual(buildMonteCarloAnswers(conflictingAliasInput)[1].value, '12,0 % der Jahre', 'Kanonischer Anteil bleibt unabhängig vom alten absoluten Jahreszähler');
const missingMaxInput = answerFixture(); missingMaxInput.results.kpiMaxKuerzung.p50 = null;
assert(buildMonteCarloAnswers(missingMaxInput)[1].value === '12,0 % der Jahre'
    && buildMonteCarloAnswers(missingMaxInput)[1].note.includes('fehlt'), 'Fehlende stärkste Kürzung entfernt keinen vorhandenen Anteil');
const missingShareInput = answerFixture(); missingShareInput.results.cutYearSharePct.p50 = null;
assert(buildMonteCarloAnswers(missingShareInput)[1].value === '—'
    && buildMonteCarloAnswers(missingShareInput)[1].note.includes('18,0 %'), 'Nicht auswertbarer Anteil bleibt fehlend bei vorhandener stärkster Kürzung');
const technicalAnswers = buildMonteCarloAnswers(answerFixture({ requestedRuns: 100, ruin: 4, all_dead: 40, horizon_exhausted: 55, technical_error: 1 }));
assert(technicalAnswers.every(answer => answer.value === '—' && answer.text.includes('technischer Fehler')), 'Technischer Fehler liefert keine verlässliche Zahlenantwort');
for (const missing of [undefined, null, NaN, Infinity, '0']) {
    const input = answerFixture(); input.results.cutYearSharePct.p50 = missing; input.results.kpiMaxKuerzung.p50 = missing;
    const result = buildMonteCarloAnswers(input);
    assert(result[1].value === '—' && result[1].text.includes('fehlt') && result[1].note.includes('fehlt'), 'Fehlende oder nicht numerische Kennzahlen werden nie Null');
    input.results.outcomeInventory.floorCoveragePct = missing;
    assertEqual(buildMonteCarloAnswers(input)[0].value, '—', 'Fehlende Deckung wird nicht durch Legacyfallback ersetzt');
}
for (const input of [{ results: {} }, { results: {}, totalRuns: 0, failCount: 0 }, { results: {}, totalRuns: 100 }]) {
    assert(buildMonteCarloAnswers(input).every(answer => answer.value === '—'), 'Leere Antwortdaten erfinden keine Zahlen');
}
for (const pair of [answers, deathAnswers, horizonAnswers, zeroAnswers, legacyAnswers, technicalAnswers, buildMonteCarloAnswers({ results: {} })]) {
    assert(!/Ruin|Quantil/i.test(JSON.stringify(pair)), 'Sichtbare Kernantworten bleiben verständlich');
}

const outcomeSummary = buildSummaryData({
    results: {
        outcomeInventory: {
            schemaVersion: 'MonteCarloOutcomeInventoryV1',
            requestedRuns: 4,
            ruin: 1,
            all_dead: 1,
            horizon_exhausted: 1,
            technical_error: 1,
            floorCoveragePct: null
        }
    },
    totalRuns: 4,
    failCount: 1
});
assertEqual(outcomeSummary[0].title, 'Floor-Deckung im gewählten Horizont', 'Summary should use the reviewed floor-coverage label');
assertEqual(outcomeSummary[0].value, '—', 'Technical path should suppress floor coverage in the UI');
assert(outcomeSummary[1].value.includes('Ruin 1') && outcomeSummary[1].value.includes('Technik 1'), 'Summary should keep the terminal outcome inventory visible');

const uncertainSummary = buildSummaryData({
    results: {
        outcomeInventory: buildMonteCarloOutcomeInventoryV1({
            requestedRuns: 4,
            ruin: 1,
            all_dead: 1,
            horizon_exhausted: 2,
            technical_error: 0
        })
    },
    totalRuns: 4,
    failCount: 1
});
assert(uncertainSummary[0].value.includes('95%-KI'), 'Floor-coverage card should show the Wilson interval');
assert(uncertainSummary[0].description.includes('Simulationsfehler, nicht Modellrisiko'), 'Floor-coverage tooltip should state the interval interpretation limit');
assert(uncertainSummary[0].description.includes('Unsicherheitswarnung'), 'Small batches should show a visible uncertainty warning');
assertEqual(uncertainSummary[0].tone, 'warning', 'Small-sample floor coverage should not be styled as precise success');

const exactTaxSummary = buildSummaryData({
    results: { taxOutcomes: { p50: 12345678.9 } },
    totalRuns: 1,
    failCount: 0
});
const exactTaxCard = exactTaxSummary.find(card => card.title === 'Median Steuern');
assertEqual(exactTaxCard?.value, '12.345.678,90 €', 'Tax cost median remains cent-exact for its tooltip');
assertEqual(exactTaxCard?.displayValue, '12,3 Mio. €', 'Large secondary amounts use the same rounding as diagram summaries');
assert(exactTaxCard?.decisionCritical === true, 'Tax cost median should remain visible in simple mode');

const conservativeSummary = buildSummaryData({
    results: {
        finalOutcomes: {
            p10: 55000.009,
            p50: 487501.009,
            p50_successful: 212500.009,
            p90: 490000.009,
            distribution: { sampleSize: 4 },
            successfulCount: 3,
            successfulMissingness: null
        },
        taxOutcomes: { p50: 12.341 }
    },
    totalRuns: 4,
    failCount: 0
});
assertEqual(conservativeSummary.find(card => card.title === 'Median (alle)')?.value, '487.501,00 €', 'All-run median should avoid coarse 25,000-euro rounding and conservatively floor benefit cents');
assertEqual(conservativeSummary.find(card => card.title === 'Median (erfolgreiche)')?.value, '212.500,00 €', 'Successful median should avoid optimistic coarse rounding');
assertEqual(conservativeSummary.find(card => card.title === '10%/90% Perzentil')?.value, '55.000,00 € / 490.000,00 €', 'P10/P90 benefit values should remain cent-precise and never round upward');
assertEqual(conservativeSummary.find(card => card.title === 'Median Steuern')?.value, '12,35 €', 'Tax cost should conservatively ceil fractions beyond a cent');
assertEqual(conservativeSummary.find(card => card.title === 'Median (alle)')?.displayValue, '487.501 €', 'Secondary amounts below a million show whole euros');
assertEqual(conservativeSummary.find(card => card.title === '10%/90% Perzentil')?.displayValue, '55.000 € / 490.000 €', 'Both percentiles use whole euros without changing exact values');

const missingTaxCard = buildSummaryData({
    results: { taxOutcomes: { p50: '123.45', applicability: { applicable: false, reason: 'not_applicable' } } },
    totalRuns: 1,
    failCount: 0
}).find(card => card.title === 'Median Steuern');
assertEqual(missingTaxCard?.value, '—', 'Tax median should reject non-numeric or inapplicable aggregate values instead of coercing them');
assert(missingTaxCard?.statusLine.includes('not_applicable') && missingTaxCard.statusLine.includes('Beobachtungen: unbekannt'), 'Missing tax median should expose stable reason without inventing an observation count');

const dashboard = buildKpiDashboard({
    depotErschoepfungsQuote: 12.34,
    alterBeiErschoepfung: { p50: 81 }
});

const depletionKpi = dashboard.primary.find(kpi => kpi.title.includes('Aktien/Gold'));
assert(Boolean(depletionKpi), 'Dashboard should expose the precise ruin/depot-rest KPI');
assert(
    depletionKpi.title === 'Ruin oder Aktien/Gold ≤ 100 €',
    'Primary KPI title should name ruin, the asset subset and the threshold'
);
assert(depletionKpi.value === '12,3\u00a0%', 'Primary KPI should keep the existing percentage formatting');
assert(depletionKpi.tone === 'warning', 'Primary KPI should keep the existing warning threshold');
assert(depletionKpi.description.includes('Ruin') && !depletionKpi.description.includes('isRuin'), 'Erklärung benennt Ruin ohne Programmschlüssel');
assert(
    depletionKpi.description.includes('Aktien-plus-Gold-Endbestand von höchstens 100 €'),
    'Description should name the asset subset and threshold'
);
assert(
    depletionKpi.description.includes('Freie Liquidität') && depletionKpi.description.includes('Pflegereserve'),
    'Description should name holdings excluded from the 100-euro threshold'
);
assert(
    !depletionKpi.description.includes('vollständig aufgebraucht'),
    'Description should not claim complete wealth depletion'
);

const operativeDetails = dashboard.detailSections.find(section => section.title === 'Operative Details');
const depletionAgeKpi = operativeDetails?.kpis.find(kpi => kpi.title.includes('Aktien/Gold'));
assert(Boolean(depletionAgeKpi), 'Operative details should expose the matching age KPI');
assert(
    depletionAgeKpi.title === 'Median-Alter: Ruin oder Aktien/Gold ≤ 100 €',
    'Age KPI title should use the same precise trigger wording'
);
assert(depletionAgeKpi.value === '81,0\u00a0Jahre', 'Age KPI should keep the existing value formatting');
assert(depletionAgeKpi.description.includes('Ruin') && !depletionAgeKpi.description.includes('isRuin'), 'Age KPI should name the technical ruin trigger');
assert(
    depletionAgeKpi.description.includes('Aktien-plus-Gold-Bestand von höchstens 100 €'),
    'Age KPI should name the matching asset subset and threshold'
);

assert(
    buildKpiDashboard({ depotErschoepfungsQuote: 5 }).primary[1].tone === 'success',
    'Depletion tone should remain successful through five percent'
);
assert(
    buildKpiDashboard({ depotErschoepfungsQuote: 20 }).primary[1].tone === 'warning',
    'Depletion tone should remain warning through twenty percent'
);
assert(
    buildKpiDashboard({ depotErschoepfungsQuote: 20.01 }).primary[1].tone === 'danger',
    'Depletion tone should remain dangerous above twenty percent'
);

const cutDashboard = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    cutYearSharePct: { p50: 50, sampleSize: 4, excludedRuns: 1 }
});
const cutKpi = cutDashboard.primary.find(kpi => kpi.title.includes('mehr als 10 % unter Wunsch-Flex'));
assert(cutKpi?.title === 'mehr als 10 % unter Wunsch-Flex', 'Cut-share title should use the inclusive ten-percent threshold');
assert(cutKpi?.value === '50,0\u00a0%', 'Observed cut share should render as percent');
assert(cutKpi?.tooltip.includes('abgeschlossener Dekumulationsjahre'), 'Cut-share tooltip should name the denominator population');
assert(cutKpi?.tooltip.includes('Stichprobe: 4 Läufe'), 'Cut-share tooltip should expose sample size');

const emptyCutKpi = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    cutYearSharePct: { p50: null, sampleSize: 0, excludedRuns: 2 }
}).primary.find(kpi => kpi.title.includes('mehr als 10 % unter Wunsch-Flex'));
assert(emptyCutKpi?.value === '—', 'Missing cut-share distribution should render as an em dash, not zero or NaN');

const volatilityKpi = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    volatilities: { p50: 14.142 }
}).detailSections.flatMap(section => section.kpis).find(kpi => kpi.title.includes('Portfoliovolatilität'));
assert(volatilityKpi?.description.includes('(N-1)'), 'Volatility tooltip should document sample standard deviation');
assert(volatilityKpi?.description.includes('keine zusätzliche Annualisierung'), 'Volatility tooltip should document annual frequency semantics');

const withdrawalDashboard = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    maxDrawdowns: {
        p50: 34.25,
        p90: 48.125,
        distribution: { sampleSize: 8, missingness: { technical_error: 0 } }
    },
    realMaxDrawdowns: {
        p50: 35.5,
        p90: 51.75,
        distribution: { sampleSize: 8, missingness: { technical_error: 0 } },
        missingness: { missing_inflation: 0, no_observations: 0, technical_error: 0 },
        observationCount: { observedPaths: 8, pathPointsAvailable: 160 }
    },
    realWithdrawalP10: {
        realEur: 12345.67,
        p50RealEur: 19876.54,
        sampleSize: 8,
        excludedRuns: 0,
        missingness: { died_before_first_obligation: 0, technical_error: 0 }
    },
    extraKPI: {
        timeShareQuoteAbove45: 0.0125,
        lossCarryTaxSavings: { perRunMean: 331.01 }
    }
});
const withdrawalKpi = withdrawalDashboard.primary
    .find(kpi => kpi.title === 'Reale Depotentnahme P10');
assertEqual(withdrawalKpi.value, '12.345,67 €', 'Run-based real withdrawal P10 should be cent-exact instead of coarsely rounded');
assertEqual(withdrawalKpi.secondaryValue, '19.876,54 €', 'Median of run-P10 withdrawals should be a second visible cent-exact value');
assert(withdrawalKpi.description.includes('Beobachtete Läufe: 8'), 'Withdrawal P10 description should expose evaluable run count');
assert(withdrawalKpi.description.includes('Kein Quantil-Konfidenzintervall'), 'Withdrawal P10 tooltip should not imply an unimplemented interval');
assert(withdrawalKpi.layout === 'exact-risk' && withdrawalKpi.decisionCritical === true, 'Withdrawal exact values should use the non-clipping primary-card layout');

const lossCarryKpi = withdrawalDashboard.primary.find(kpi => kpi.title === 'Ø Steuerersparnis Verlustvortrag');
assertEqual(lossCarryKpi?.value, '331,01 €', 'Positive small loss-carry savings must remain visible instead of rounding to zero');

const inapplicableDecisionDashboard = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    realWithdrawalP10: {
        realEur: 12345.67,
        p50RealEur: 19876.54,
        sampleSize: 8,
        applicability: { applicable: false, reason: 'not_applicable' }
    },
    extraKPI: {
        lossCarryTaxSavings: {
            perRunMean: 331.01,
            applicability: { applicable: false, reason: 'not_applicable' }
        }
    }
});
const inapplicableWithdrawal = inapplicableDecisionDashboard.primary.find(kpi => kpi.title === 'Reale Depotentnahme P10');
const inapplicableLossCarry = inapplicableDecisionDashboard.primary.find(kpi => kpi.title === 'Ø Steuerersparnis Verlustvortrag');
assertEqual(inapplicableWithdrawal?.value, '—', 'Applicability reason should suppress a finite withdrawal P10 value');
assertEqual(inapplicableWithdrawal?.secondaryValue, '—', 'Applicability reason should suppress a finite withdrawal median value');
assert(inapplicableWithdrawal?.statusLine.includes('not_applicable') && inapplicableWithdrawal.statusLine.includes('Beobachtungen: 8'), 'Inapplicable withdrawal should expose stable reason and observation count');
assertEqual(inapplicableLossCarry?.value, '—', 'Applicability reason should suppress a finite loss-carry value');
assert(inapplicableLossCarry?.statusLine.includes('not_applicable') && inapplicableLossCarry.statusLine.includes('Beobachtungen: unbekannt'), 'Inapplicable loss-carry value should not invent an observation count');

const conservativelyRoundedDecisionDashboard = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    realWithdrawalP10: {
        realEur: 12345.679,
        p50RealEur: 19876.549,
        sampleSize: 8,
        excludedRuns: 0
    },
    extraKPI: { lossCarryTaxSavings: { perRunMean: 331.019 } }
});
assertEqual(conservativelyRoundedDecisionDashboard.primary.find(kpi => kpi.title === 'Reale Depotentnahme P10')?.value, '12.345,67 €', 'Withdrawal benefit should conservatively floor fractions beyond a cent');
assertEqual(conservativelyRoundedDecisionDashboard.primary.find(kpi => kpi.title === 'Reale Depotentnahme P10')?.secondaryValue, '19.876,54 €', 'Run-P10 median benefit should conservatively floor fractions beyond a cent');
assertEqual(conservativelyRoundedDecisionDashboard.primary.find(kpi => kpi.title === 'Ø Steuerersparnis Verlustvortrag')?.value, '331,01 €', 'Loss-carry benefit should conservatively floor fractions beyond a cent');

const nominalMedianDrawdown = withdrawalDashboard.drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown nominal (Median)');
const realMedianDrawdown = withdrawalDashboard.drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown real (Median)');
assertEqual(nominalMedianDrawdown?.value, '34,25\u00a0%', 'Nominal drawdown should expose at least two decimals from the aggregate');
assertEqual(realMedianDrawdown?.value, '35,50\u00a0%', 'Real drawdown should expose at least two decimals from the aggregate');
assert(nominalMedianDrawdown?.description.includes('Nominaler') && realMedianDrawdown?.description.includes('Preisen des Simulationsstarts'), 'Drawdown cards should visibly distinguish nominal and real price bases');
assert(withdrawalDashboard.drawdownKpis.indexOf(realMedianDrawdown) === withdrawalDashboard.drawdownKpis.indexOf(nominalMedianDrawdown) + 1, 'Nominal and real median drawdowns should be adjacent in the dedicated pair grid');

const withdrawalRateKpi = withdrawalDashboard.detailSections
    .flatMap(section => section.kpis)
    .find(kpi => kpi.title.includes('Entnahmequote'));
assert(withdrawalRateKpi?.title.includes('realisierte Entnahmequote > 4,5 %'), 'Result KPI should name the realized withdrawal-rate basis and strict operator');
assert(withdrawalRateKpi?.description.includes('Berichtsreferenz') && withdrawalRateKpi.description.includes('keine Alarm- oder Guardrail-Schwelle'), 'Result KPI should state the reporting-only role');
assertEqual(withdrawalDashboard.reportingReferenceNotice, WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE, 'Dashboard should provide an always-visible reporting-role notice');

for (const [input, expected] of [[0, '0,00\u00a0%'], [34.25, '34,25\u00a0%'], [100, '100,00\u00a0%']]) {
    const card = buildKpiDashboard({
        depotErschoepfungsQuote: 0,
        maxDrawdowns: { p50: input, p90: input, distribution: { sampleSize: 1 } },
        realMaxDrawdowns: { p50: input, p90: input, distribution: { sampleSize: 1 }, observationCount: { observedPaths: 1 } }
    }).drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown nominal (Median)');
    assertEqual(card?.value, expected, `Drawdown domain value ${input} should remain valid without recomputation`);
}

const conservativelyRoundedDrawdown = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    maxDrawdowns: { p50: 34.2549, p90: 34.2549, distribution: { sampleSize: 1 } }
}).drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown nominal (Median)');
assertEqual(conservativelyRoundedDrawdown?.value, '34,26\u00a0%', 'Drawdown loss should conservatively ceil precision beyond two decimals');

for (const input of [-0.01, -34.25, 100.01, Number.POSITIVE_INFINITY, Number.NaN]) {
    const card = buildKpiDashboard({
        depotErschoepfungsQuote: 0,
        maxDrawdowns: { p50: input, p90: input, distribution: { sampleSize: 1 } }
    }).drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown nominal (Median)');
    assertEqual(card?.value, '—', `Invalid drawdown ${String(input)} should fail closed instead of being repaired`);
    assert(card?.statusLine.includes(Number.isFinite(input) ? 'invalid_drawdown_domain' : 'invalid_non_finite'), 'Invalid drawdown should expose a stable reason');
}

const missingRealDrawdown = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    realMaxDrawdowns: {
        p50: null,
        p90: null,
        distribution: { sampleSize: 0, missingness: { missing_inflation: 2 } },
        missingness: { missing_inflation: 2 },
        observationCount: { observedPaths: 0 }
    }
}).drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown real (Median)');
assertEqual(missingRealDrawdown?.value, '—', 'Missing real drawdown should never become numeric zero');
assert(missingRealDrawdown?.statusLine.includes('missing_inflation') && missingRealDrawdown.statusLine.includes('Beobachtungen: 0'), 'Missing real drawdown should expose stable reason and observation count');

const dominantMissingnessDrawdown = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    realMaxDrawdowns: {
        p50: null,
        p90: null,
        distribution: { sampleSize: 0, missingness: { missing_inflation: 1, technical_error: 999 } },
        observationCount: { observedPaths: 0 }
    }
}).drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown real (Median)');
assert(dominantMissingnessDrawdown?.statusLine.includes('Grund: technical_error'), 'Missingness status should report the dominant counted reason rather than object insertion order');

const inapplicableDrawdown = buildKpiDashboard({
    depotErschoepfungsQuote: 0,
    maxDrawdowns: {
        p50: 34.25,
        p90: 48.125,
        applicability: { applicable: false, reason: 'not_applicable' },
        distribution: { sampleSize: 8 }
    }
}).drawdownKpis.find(kpi => kpi.title === 'Max. Drawdown nominal (Median)');
assertEqual(inapplicableDrawdown?.value, '—', 'Applicability reason should suppress even an otherwise finite drawdown value');
assert(inapplicableDrawdown?.statusLine.includes('not_applicable') && inapplicableDrawdown.statusLine.includes('Beobachtungen: 8'), 'Inapplicable drawdown should expose stable reason and observation count');

const unknownWithdrawalRateKpi = dashboard.detailSections
    .flatMap(section => section.kpis)
    .find(kpi => kpi.title.includes('Entnahmequote'));
assertEqual(unknownWithdrawalRateKpi?.value, '—', 'Missing withdrawal-rate reporting KPI should render as unavailable');
assert(unknownWithdrawalRateKpi?.statusLine.includes('Beobachtungen: unbekannt Jahre'), 'Missing withdrawal-rate reporting KPI should not invent zero observed years');

const canonicalWithdrawalView = prepareMonteCarloViewModel({
    results: {
        realWithdrawalP10: { realEur: 12000 },
        extraKPI: { consumptionAtRiskP10Real: 99999 }
    },
    totalRuns: 1,
    failCount: 0,
    inputs: {}
});
assertEqual(canonicalWithdrawalView.carThreshold, 12000, 'scenario threshold uses the canonical real-withdrawal KPI');
const removedAliasView = prepareMonteCarloViewModel({
    results: { extraKPI: { consumptionAtRiskP10Real: 99999 } },
    totalRuns: 1,
    failCount: 0,
    inputs: {}
});
assertEqual(removedAliasView.carThreshold, undefined, 'UI no longer reads the removed consumption-at-risk alias');

const stressMetrics = buildStressMetrics({
    presetKey: 'GREAT_DEPRESSION_29_33',
    years: 5,
    maxDD: { p50: 10, p90: 20 },
    timeShareAbove45: { p50: 40 },
    cutYears: { p50: 2 },
    realWithdrawalP10: { realEur: 7123.45, p50RealEur: 9456.78, sampleSize: 7 },
    recoveryYears: { p50: 3 }
});
const stressWithdrawal = stressMetrics.kpis.find(kpi => kpi.title === 'Reale Depotentnahme P10 (Stress)');
assertEqual(stressWithdrawal.value, '7.123,45 €', 'Stress withdrawal P10 should use the canonical across-run P10 field cent-exactly');
assert(stressWithdrawal.description.includes('Stichprobe: 7 Läufe'), 'Stress withdrawal tooltip should expose sample size');
assertEqual(stressWithdrawal.secondaryValue, '9.456,78 €', 'Stress median run-P10 should remain separately and visibly cent-exact');
const stressRate = stressMetrics.kpis.find(kpi => kpi.title.includes('Entnahmequote'));
assert(stressRate?.title.includes('> 4,5 %') && stressRate.description.includes('Berichtsreferenz'), 'Stress KPI should retain strict realized-rate and reporting-role copy');

const careMetrics = buildCareMetrics({
    extraKPI: {
        pflege: {
            p1: {
                entryRatePct: 25,
                entryRateNumerator: 1,
                entryRateDenominator: 4,
                entryAgeP50: 72,
                careYearsP50: 3,
                realCostEurP50: 12000,
                sampleSize: 1
            },
            p2: {
                entryRatePct: 0,
                entryRateNumerator: 0,
                entryRateDenominator: 4,
                entryAgeP50: null,
                careYearsP50: null,
                realCostEurP50: null,
                sampleSize: 0,
                missingness: 'no_observations'
            },
            household: {
                careYearsOverlapP50: 0,
                maxAnnualAdditionalNeedRealEurP50: 12000,
                totalAdditionalNeedRealEurP50: 30000,
                shortfallRateWithCarePct: 0,
                shortfallRateWithoutCarePct: 10,
                endWealthWithCareRealEurP50: 700000,
                endWealthNoCareRealEurP50: 800000,
                sampleSize: 1,
                noCareSampleSize: 3
            },
            comparison: {
                endWealthNoCareMinusCareRealEur: 100000,
                method: 'unpaired_group_median_difference'
            }
        }
    }
}, {
    pflegefallLogikAktivieren: true,
    partner: { aktiv: true }
});
const careCard = title => careMetrics.cards.find(card => card.title === title);
assert(careCard('Pflegefall-Eintrittsquote P1')?.value === '25,0\u00a0%', 'P1 entry rate should render as a percentage');
assert(careCard('Median Eintrittsalter P2')?.value === '—', 'Empty P2 entry-age distribution should render as an em dash');
assert(careCard('Median Pflegejahre P2')?.value === '—', 'Empty P2 care-years distribution should render as an em dash');
assert(careCard('Realer Pflege-Mehrbedarf P2 (Median)')?.value === '—', 'Empty P2 real-cost distribution should render as an em dash');
assert(careCard('Median Jahre beide in Pflege')?.value === '0,0\u00a0Jahre', 'Observed zero simultaneous-care years should remain distinguishable from missingness');
assert(careCard('Max. jährlicher Pflege-Mehrbedarf (real)')?.description.includes('P1 + P2'), 'Annual household care need should document the summed persons');
assert(!careMetrics.cards.some(card => card.title.includes('Depot')), 'Care KPI cards must not claim a depot-financed care amount');
assert(careCard('Gruppenmedian-Differenz (nicht kausal)')?.value.includes('100.000'), 'Care comparison should use no-care minus care sign convention');
assert(careCard('Gruppenmedian-Differenz (nicht kausal)')?.description.includes('nicht kausaler'), 'Care comparison should disclose the unpaired non-causal method visibly');

console.log('--- Results Metrics UI Contract Tests Completed ---');

for (const floorCoveragePct of [0, 1, 50, 100]) {
    const inventory = buildMonteCarloOutcomeInventoryV1({ requestedRuns: 1000, ruin: 1000 - floorCoveragePct * 10, all_dead: 0, horizon_exhausted: floorCoveragePct * 10, technical_error: 0 });
    const floor = buildSummaryData({ results: { outcomeInventory: inventory }, totalRuns: 1000, failCount: inventory.ruin })[0];
    assertEqual(floor.tone, 'default', `Unbewertete Floor-Deckung ${floorCoveragePct} % bleibt neutral`);
    assert(floor.value.includes('95%-KI') && !floor.description.includes('Unsicherheitswarnung'), 'Wilson-Intervall bleibt vollständig ohne erfundene Warnschwelle');
    const legacy = buildSummaryData({ results: {}, totalRuns: 1000, failCount: inventory.ruin })[0];
    assertEqual(legacy.tone, 'default', 'Bestehender Ergebnis-Fallback bleibt neutral und berechnet identisch');
}
assertEqual(outcomeSummary[0].tone, 'warning', 'Technischer Fehler bleibt fail-closed mit Warnung');
assert(uncertainSummary[0].description.endsWith('Unsicherheitswarnung: nur 4 Läufe; Schwelle 1000.'), 'Vorhandener small_sample-Grund bleibt wörtlich erhalten');

// R8 bewertet diese Exaktwerte nicht; Warnschwellen anderer Karten bleiben erhalten.
for (const value of [0, 12.345, null, NaN, Infinity, -1]) {
    const results = { realWithdrawalP10: { realEur: value, p50RealEur: value, sampleSize: 8 },
        maxDrawdowns: { p50: value, p90: value, sampleSize: 8 }, realMaxDrawdowns: { p50: value, p90: value, sampleSize: 8 } };
    const before = JSON.stringify(results), dashboard = buildKpiDashboard(results);
    const withdrawal = dashboard.primary.find(card => card.title === 'Reale Depotentnahme P10');
    for (const card of [withdrawal, ...dashboard.drawdownKpis]) assertEqual(card.tone, 'default', 'Entnahme/Drawdown ist unabhängig vom Wert neutral');
    const stress = buildStressMetrics({ presetKey: 'SYNTHETIC', years: 4, maxDD: results.maxDrawdowns, realWithdrawalP10: results.realWithdrawalP10 });
    for (const title of ['Max. Drawdown (Median, Stress)', 'Max. Drawdown (P90, Stress)', 'Reale Depotentnahme P10 (Stress)']) assertEqual(stress.kpis.find(card => card.title === title).tone, 'default', 'Gleichartige Stresskarte ist neutral');
    assertEqual(stress.kpis.find(card => card.title.includes('Entnahmequote')).tone, 'warning', 'Bestehende Stresswarnung außerhalb R8 bleibt erhalten');
    assertEqual(JSON.stringify(results), before, 'R8-Töne ändern keine Rohwerte');
}
for (const [perRunMean, reason, expected] of [[0, null, 'default'], [.00001, null, 'default'], [-1, null, 'default'], [null, null, 'default'], [NaN, null, 'default'], [1, 'technical_error', 'default']]) {
    const card = buildKpiDashboard({ extraKPI: { lossCarryTaxSavings: { perRunMean, sampleSize: 8, applicability: { applicable: reason === null, reason } } } }).primary.find(card => card.title === 'Ø Steuerersparnis Verlustvortrag');
    assertEqual(card.tone, expected, 'Steuerersparnis bleibt unabhängig vom Vorzeichen eine ruhige Kennzahl');
}

// Neue Gruppierung projiziert ausschließlich vorhandene Floor-/Endzustandswerte.
for (const counts of [
    { requestedRuns: 0, ruin: 0, all_dead: 0, horizon_exhausted: 0, technical_error: 0 },
    { requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 2, technical_error: 0 },
    { requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 1, technical_error: 1 }
]) {
    const inventory = buildMonteCarloOutcomeInventoryV1(counts);
    const before = JSON.stringify(inventory);
    const summary = buildSummaryData({ results: { outcomeInventory: inventory }, totalRuns: counts.requestedRuns, failCount: counts.ruin });
    assertEqual(summary[0].displayValue, inventory.floorCoveragePct === null ? '—' : `${inventory.floorCoveragePct.toFixed(1).replace('.', ',')} %`, 'Floorzahl bleibt identisch zum vorhandenen Inventar; keine erfundene Deckung');
    const interval = inventory.floorCoverageEstimate?.confidenceInterval95;
    if (interval) {
        assert(summary[0].intervalText.includes(interval.lowerPct.toFixed(1).replace('.', ',')) && summary[0].intervalText.includes(interval.upperPct.toFixed(1).replace('.', ',')), 'Separates Intervall erhält beide bestehenden Grenzen');
    }
    assertEqual(JSON.stringify(summary[1].outcomes.map(outcome => outcome.count)), JSON.stringify([counts.all_dead, counts.horizon_exhausted, counts.ruin, counts.technical_error]), 'Endzustandsbalken verwendet echte Anzahlen in Referenzreihenfolge');
    assertEqual(JSON.stringify(inventory), before, 'Gruppierung verändert das Outcome-Inventar nicht');
}
for (const [value, expected] of [[0, '0 €'], [12345.678, '12.346 €'], [12345678.9, '12.345.679 €'], [null, '—'], [NaN, '—']]) {
    const result = { extraKPI: { pflege: { p1: { realCostEurP50: value } } } };
    const before = JSON.stringify(result);
    const cards = buildCareMetrics(result, { pflegefallLogikAktivieren: true }).cards;
    assertEqual(cards.find(card => card.title === 'Realer Pflege-Mehrbedarf P1 (Median)').value, expected, 'Ungebundene Pflegekarte zeigt volle ganze Euro, Null oder Fehlwert');
    assertEqual(JSON.stringify(result), before, 'Ganz-Euro-Anzeige verändert keinen Rohbetrag');
}
