/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { DEFAULT_EURO_MODE, euroBasisLabel } from '../euro-display.js';
import { hasTechnicalFinancialError, projectMinimumFlexDisplay, LEGACY_FLEX_RESTRICTION_LABEL } from './minimum-flex.js';
import { formatPercentage, formatCoveragePercentage, formatCoveredRuns } from '../results-formatting.js';
import { missingMoney, directMetricReason, finalMoney, otherBasisLine, formatConservativeCurrency, summaryEuro, unavailableStatus, wealthPartsDetail } from './display-values.js';
import { percentileWealthNotice } from '../../shared/wealth-display.js';

/** Reine Anzeigeprojektion vorhandener Kennzahlen; keine neue Statistik.
 *
 * @param options - Optionen des Aufrufers.
 * @returns Aus den übergebenen Daten abgeleitete Ergebnisform.
 */
export function buildMonteCarloAnswers({ results, totalRuns, failCount, moneyBasis = DEFAULT_EURO_MODE, inputs = {} }) {
    const inventory = results?.outcomeInventory;
    const current = inventory?.schemaVersion === 'MonteCarloOutcomeInventoryV1';
    const technical = hasTechnicalFinancialError(results);
    const restriction = projectMinimumFlexDisplay(results, { moneyBasis, inputs });
    const coverageAvailable = !technical && (current ? Number.isFinite(inventory.floorCoveragePct)
        : Number.isFinite(totalRuns) && totalRuns > 0 && Number.isFinite(failCount));
    const floor = buildSummaryData({ results, totalRuns, failCount })[0];
    const coverage = coverageAvailable ? floor.displayValue : '—';
    const completeLife = coverageAvailable && current && inventory.requestedRuns > 0 && inventory.all_dead === inventory.requestedRuns;
    const cutShare = !technical && Number.isFinite(results?.cutYearSharePct?.p50)
        ? formatPercentage(results.cutYearSharePct.p50) : '—';
    const maxCut = !technical && Number.isFinite(results?.kpiMaxKuerzung?.p50)
        ? formatPercentage(results.kpiMaxKuerzung.p50) : '—';
    const reason = technical ? 'Wegen technischer Fehler ist diese Antwort nicht auswertbar.' : 'Die Deckungsquote fehlt.';
    return [
        { question: 'Ist mein Grundbedarf gedeckt?', value: coverage,
            countText: coverageAvailable ? floor.countText : '',
            text: coverageAvailable ? `Dein Grundbedarf ist in diesen Läufen ${completeLife ? 'bis zum simulierten Lebensende' : 'bis zum jeweiligen Laufende'} gedeckt.` : reason,
            note: completeLife ? 'Alle Läufe bilden einen vollständigen simulierten Lebenspfad ab.'
                : current ? 'Ein Lauf kann am gewählten Zeitraumende enden. Das ist kein nachgewiesenes Lebensende.'
                    : 'Altes Ergebnis ohne vollständigen Endzustandsbeleg. Eine Deckung bis zum Lebensende ist daraus nicht nachgewiesen.' },
        { question: 'Muss ich mich einschränken?', value: !restriction.legacy
                ? restriction.value === '—' ? '—' : `${restriction.value} der Jahre`
                : cutShare === '—' ? '—' : `${cutShare} der Jahre`,
            subtitle: restriction.legacy ? LEGACY_FLEX_RESTRICTION_LABEL : 'Jahre mit bezahltem Haushalts-Flex unter Mindest-Flex',
            metrics: [
                { label: 'Typischer Jahresanteil', value: restriction.legacy ? cutShare : restriction.value, detail: 'Median je Lauf bis Laufende' },
                { label: 'Betroffene Läufe', value: restriction.legacy ? '—' : restriction.affectedRunValue, detail: restriction.legacy ? 'Keine Mindest-Flex-Messung vorhanden' : 'Mindestens ein Jahr unter Mindest-Flex' }
            ],
            text: !restriction.legacy ? restriction.text : technical ? reason : cutShare === '—'
                ? `Die Angabe zu „${LEGACY_FLEX_RESTRICTION_LABEL}“ fehlt.`
                : results.cutYearSharePct.p50 === 0
                    ? `Gut: Typisch gibt es keine Jahre „${LEGACY_FLEX_RESTRICTION_LABEL}“.`
                    : `In typisch ${cutShare} der Entnahmejahre liegt dein Flex ${LEGACY_FLEX_RESTRICTION_LABEL}.`,
            note: !restriction.legacy ? restriction.note : technical ? ''
                : maxCut === '—' ? 'Die stärkste Flex-Kürzung fehlt.' : `Stärkste Flex-Kürzung: typisch ${maxCut}.`,
            ...(restriction.desiredFlex ? { desiredFlex: restriction.desiredFlex } : {}),
            tooltip: !restriction.legacy ? restriction.tooltip
                : `${restriction.basisNote} Die alte Berechnung zählt einschließlich genau 10 % (mindestens 10 %) der abgeschlossenen Entnahmejahre. Flex-Bedarf bedeutet frei planbare Ausgaben. Beide Werte sind Mediane und können aus unterschiedlichen Läufen stammen.`,
            compactNote: true }

    ];
}

/**
 * Baut die zusammengefassten Hauptkennzahlen (Summary) für die Monte-Carlo-Ergebnisse.
 *
 * @param {Object} params - Rohdaten der Simulation.
 * @param {Object} params.results - Ergebnisobjekt der Monte-Carlo-Simulation.
 * @param {number} params.totalRuns - Anzahl der ausgeführten Läufe.
 * @param {number} params.failCount - Anzahl fehlgeschlagener Läufe.
 * @param {string} [params.moneyBasis] - Preisbasis der Anzeige.
 * @returns {Array<KpiDescriptor>} Formatierte Summary-Karten.
 */
export function buildSummaryData({ results, totalRuns, failCount, moneyBasis = DEFAULT_EURO_MODE }) {
    const safeTotalRuns = Math.max(0, Number(totalRuns) || 0);
    const safeFailCount = Math.max(0, Number(failCount) || 0);
    const outcomeInventory = results?.outcomeInventory;
    const hasOutcomeInventory = outcomeInventory?.schemaVersion === 'MonteCarloOutcomeInventoryV1';
    const floorCoveragePct = hasOutcomeInventory
        ? outcomeInventory.floorCoveragePct
        : safeTotalRuns > 0
            ? ((safeTotalRuns - safeFailCount) / safeTotalRuns) * 100
            : null;
    const requestedRuns = hasOutcomeInventory ? outcomeInventory.requestedRuns : safeTotalRuns;
    const ruinRuns = hasOutcomeInventory ? outcomeInventory.ruin : safeFailCount;
    const allDeadRuns = hasOutcomeInventory ? outcomeInventory.all_dead : 0;
    const horizonRuns = hasOutcomeInventory ? outcomeInventory.horizon_exhausted : Math.max(0, safeTotalRuns - safeFailCount);
    const technicalRuns = hasOutcomeInventory ? outcomeInventory.technical_error : 0;
    const coveredRuns = allDeadRuns + horizonRuns;
    const floorDisplay = technicalRuns > 0 ? '—' : formatCoveragePercentage(floorCoveragePct, coveredRuns, requestedRuns);
    const floorEstimate = hasOutcomeInventory ? outcomeInventory.floorCoverageEstimate : null;
    const floorInterval = floorEstimate?.confidenceInterval95;
    const floorValue = floorDisplay === '—'
        ? floorDisplay
        : floorInterval
            ? `${floorDisplay} (95%-KI ${formatPercentage(floorInterval.lowerPct)}–${formatPercentage(floorInterval.upperPct)})`
            : floorDisplay;
    const floorWarning = floorEstimate?.uncertaintyWarning?.code === 'small_sample'
        ? ` Unsicherheitswarnung: nur ${requestedRuns} Läufe; Schwelle ${floorEstimate.uncertaintyWarning.thresholdRuns}.`
        : '';
    const taxOutcomes = (moneyBasis === 'real' ? results?.euroMetrics?.real?.taxOutcomes : results?.taxOutcomes) || missingMoney;
    const taxAvailable = directMetricReason(taxOutcomes) === null
        && Number.isFinite(taxOutcomes.p50);
    const finalOutcomes = finalMoney(results, moneyBasis);
    const finalP50Available = Number.isFinite(finalOutcomes.p50);
    const successfulP50Available = directMetricReason({
        missingness: finalOutcomes.successfulMissingness,
        sampleSize: finalOutcomes.successfulCount
    }) === null && Number.isFinite(finalOutcomes.p50_successful);
    const finalP10Available = Number.isFinite(finalOutcomes.p10);
    const finalP90Available = Number.isFinite(finalOutcomes.p90);

    return /** @type {KpiDescriptor[]} */ ([
        {
            title: 'Floor-Deckung im gewählten Horizont',
            value: floorValue,
            displayRole: 'floor',
            displayValue: floorDisplay,
            countText: floorDisplay === '—' ? '' : formatCoveredRuns(coveredRuns, requestedRuns),
            intervalText: floorInterval ? `95-%-Konfidenzintervall ${formatPercentage(floorInterval.lowerPct)}–${formatPercentage(floorInterval.upperPct)}` : '95-%-Konfidenzintervall nicht verfügbar',
            description: technicalRuns > 0
                ? `Wegen ${technicalRuns} technischem/technischen Fehler(n) vorsorglich nicht ausgewiesen; die Endzustände bleiben sichtbar.`
                : `Anteil Tod plus Horizontende an ${requestedRuns} angeforderten Läufen. Das Wilson-95%-Intervall quantifiziert Simulationsfehler, nicht Modellrisiko. Horizontende ist ein zensierter, kein vollständiger Lebenszeitpfad.${floorWarning}`,
            tone: floorCoveragePct === null || floorWarning ? 'warning' : 'default'
        },
        {
            title: 'Endzustände',
            displayRole: 'outcomes',
            requestedRuns,
            outcomes: [
                { label: 'Tod', count: allDeadRuns, kind: 'death' },
                { label: 'Horizont', count: horizonRuns, kind: 'horizon' },
                { label: 'Ruin', count: ruinRuns, kind: 'ruin' },
                { label: 'Technik', count: technicalRuns, kind: 'technical' }
            ],
            value: `Ruin ${ruinRuns} · Tod ${allDeadRuns} · Horizont ${horizonRuns} · Technik ${technicalRuns}`,
            description: `Disjunkte Endzustände für ${requestedRuns} angeforderte Läufe; ihre Summe entspricht der Anzahl Läufe.`,
            tone: 'default'
        },
        {
            title: 'Median (alle)',
            priceBasis: euroBasisLabel(moneyBasis),
            otherBasisLine: otherBasisLine(finalMoney(results, moneyBasis === 'real' ? 'nominal' : 'real').p50, moneyBasis),
            value: finalP50Available ? formatConservativeCurrency(finalOutcomes.p50, 'benefit') : '—',
            displayValue: finalP50Available ? summaryEuro(finalOutcomes.p50) : '—',
            statusLine: finalP50Available ? '' : unavailableStatus(finalOutcomes, 'no_observations'),
            description: 'Typisches Endvermögen über alle finanziell auswertbaren Läufe. ' + (results?.displayWealth ? percentileWealthNotice : ''),
            moneyDetail: results?.displayWealth ? wealthPartsDetail(results.displayWealth[moneyBasis]?.parts?.p50) : '',
            tone: 'default',
            layout: 'exact-risk'
        },
        {
            title: 'Median (erfolgreiche)',
            value: successfulP50Available ? formatConservativeCurrency(finalOutcomes.p50_successful, 'benefit') : '—',
            displayValue: successfulP50Available ? summaryEuro(finalOutcomes.p50_successful) : '—',
            statusLine: successfulP50Available
                ? ''
                : unavailableStatus({
                    missingness: finalOutcomes.successfulMissingness,
                    sampleSize: finalOutcomes.successfulCount
                }, 'no_observations'),
            description: 'Median des Endvermögens aller erfolgreichen Läufe. ' + (results?.displayWealth ? percentileWealthNotice : ''),
            moneyDetail: results?.displayWealth ? wealthPartsDetail(results.displayWealth[moneyBasis]?.parts?.p50_successful) : '',
            tone: 'default',
            layout: 'exact-risk'
        },
        {
            title: '10%/90% Perzentil',
            value: finalP10Available && finalP90Available
                ? `${formatConservativeCurrency(finalOutcomes.p10, 'benefit')} / ${formatConservativeCurrency(finalOutcomes.p90, 'benefit')}`
                : '—',
            displayValue: finalP10Available && finalP90Available
                ? `${summaryEuro(finalOutcomes.p10)} / ${summaryEuro(finalOutcomes.p90)}` : '—',
            statusLine: finalP10Available && finalP90Available
                ? ''
                : unavailableStatus(finalOutcomes, 'no_observations'),
            description: 'Spannweite der Endvermögen zwischen konservativem P10 und optimistischem P90. ' + (results?.displayWealth ? percentileWealthNotice : ''),
            moneyDetail: results?.displayWealth ? `P10 ${wealthPartsDetail(results.displayWealth[moneyBasis]?.parts?.p10)} · P90 ${wealthPartsDetail(results.displayWealth[moneyBasis]?.parts?.p90)}` : '',
            tone: 'default',
            layout: 'exact-risk',
            decisionCritical: true
        },
        {
            title: 'Median Steuern',
            value: taxAvailable ? formatConservativeCurrency(taxOutcomes.p50, 'cost') : '—',
            displayValue: taxAvailable ? summaryEuro(taxOutcomes.p50) : '—',
            statusLine: taxAvailable ? '' : unavailableStatus(taxOutcomes, 'no_observations'),
            description: `Median der kumulierten Steuerzahlungen · ${euroBasisLabel(moneyBasis)}.`,
            tone: 'default',
            layout: 'exact-risk',
            decisionCritical: true
        }
    ]).map(card => ['Median (alle)', 'Median (erfolgreiche)', '10%/90% Perzentil', 'Median Steuern'].includes(card.title)
        ? { ...card, tooltip: `${card.description} ${euroBasisLabel(moneyBasis)}.` } : card);
}
