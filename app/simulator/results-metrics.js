"use strict";

import { formatNumberWithUnit, formatPercentage, sanitizeDescription } from './results-formatting.js';
import { formatWholeEuro, formatChartEuro, formatCoveragePercentage, formatCoveredRuns } from './results-formatting.js';
import { STRESS_PRESETS } from './simulator-data.js';
import { DEFAULT_EURO_MODE, euroBasisLabel } from './euro-display.js';
import { quantile } from './simulator-utils.js';

/**
 * Beschreibt eine KPI-Karte in neutraler Datenform ohne DOM-spezifische Elemente.
 * @typedef {Object} KpiDescriptor
 * @property {string} title - Sichtbarer Titel der Kennzahl.
 * @property {string} value - Formatierter Wert, enthält ggf. Einheit.
 * @property {string} description - Kurzbeschreibung für Tooltips oder unterhalb des Werts.
 * @property {('default'|'success'|'warning'|'danger')} tone - Semantische Einstufung für farbliche Darstellung.
 * @property {string} [secondaryLabel] - Sichtbare Bezeichnung eines zweiten Exaktwerts.
 * @property {string} [secondaryValue] - Sichtbarer zweiter Exaktwert.
 * @property {string} [statusLine] - Sichtbarer stabiler Grund bei fehlender oder ungueltiger Messung.
 * @property {string} [secondaryStatusLine] - Status des zweiten Exaktwerts.
 * @property {('exact-risk')} [layout] - Layout-Hinweis fuer nicht abzuschneidende Exaktwerte.
 * @property {boolean} [decisionCritical] - Bleibt auch im einfachen Modus sichtbar.
 */

export const WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE = 'Die Auswertung bei 4,5 % bezieht sich auf die realisierte Entnahmequote. Sie ist nur eine Berichtsreferenz und keine Alarm- oder Guardrail-Schwelle.';

export const LEGACY_FLEX_RESTRICTION_LABEL = 'mehr als 10 % unter Wunsch-Flex';
const amount = value => Number.isFinite(value) && value >= 0;
const share = value => Number.isFinite(value) && value >= 0 && value <= 100;
const summaryEuro = value => Math.abs(value) >= 1e6 ? formatChartEuro(value) : formatWholeEuro(value);
export const WITHDRAWAL_CARD_TITLE = 'Entnahme aus dem Vermögen in schwachen Jahren';
const missingMoney = { missingness: 'no_observations' };
function finalMoney(results, mode) {
    if (mode !== 'real') return results?.finalOutcomes || {};
    if (results?.euroMetrics?.real?.finalOutcomes) return results.euroMetrics.real.finalOutcomes;
    const values = results?.wealthView?.realValues;
    return Array.isArray(values) && values.length ? { p10: quantile(values, 0.1), p50: quantile(values, 0.5), p90: quantile(values, 0.9) } : missingMoney;
}
function withdrawalMoney(results, mode, stress = false) {
    if (mode === 'nominal') return results?.euroMetrics?.nominal?.[stress ? 'stressWithdrawalP10' : 'withdrawalP10'] || missingMoney;
    const block = (stress ? results?.stressKPI?.realWithdrawalP10 : results?.realWithdrawalP10) || missingMoney;
    return { ...block, p10: block.realEur, p50: block.p50RealEur };
}
const otherBasisLine = (value, mode) => Number.isFinite(value)
    ? `${mode === 'nominal' ? 'in heutiger Kaufkraft' : 'nominal'} etwa ${summaryEuro(value)}`
    : `${mode === 'nominal' ? 'Heutige Kaufkraft' : 'Nominaler Gegenwert'} fehlt · bitte neu rechnen`;
export function hasTechnicalFinancialError(result) {
    return result?.outcomeInventory?.technical_error > 0 || result?.batchStatus === 'technical_error'
        || result?.financialMetricsValid === false || (result?.outcome && !['completed', 'ruin'].includes(result.outcome.kind));
}

/** Gemeinsame lesende FR-6-Projektion; nur eingefrorene Laufdaten. */
export function projectMinimumFlexDisplay(result, { backtest = false, moneyBasis = DEFAULT_EURO_MODE } = {}) {
    const block = backtest ? result?.metrics?.minimumFlexRestriction ?? result?.minimumFlexRestriction : result?.minimumFlexRestriction;
    const present = Object.hasOwn(result || {}, 'minimumFlexRestriction')
        || (backtest && Object.hasOwn(result?.metrics || {}, 'minimumFlexRestriction'));
    const technical = hasTechnicalFinancialError(result);
    const legacy = !present || block?.startMinimumFlexAnnual === 0;
    if (legacy) return { legacy: true, technical, title: LEGACY_FLEX_RESTRICTION_LABEL,
        basisNote: present ? 'Mindest-Flex war im Lauf nicht gesetzt.' : 'Älteres Ergebnis: ältere Grundlage ohne Mindest-Flex-Messung.' };
    const path = backtest ? block?.path : block;
    const pct = backtest ? path?.yearSharePct : block?.yearSharePctP50;
    const valid = !technical && block?.definitionVersion === 'MinimumFlexRestrictionV1'
        && block.priceBasis === 'nominal' && block.population === 'completed_decumulation_years'
        && block.comparison === 'paid_household_flex_lt_applied_positive_minimum'
        && amount(block.startMinimumFlexAnnual) && block.startMinimumFlexAnnual > 0
        && block.missingReason === null && path?.missingReason === null && share(pct)
        && (backtest ? Number.isInteger(path.observationCount) && path.observationCount > 0
            && Number.isInteger(path.affectedYearCount) && path.affectedYearCount >= 0
            && path.affectedYearCount <= path.observationCount
            && Math.abs(pct - path.affectedYearCount / path.observationCount * 100) < 1e-8
            : Number.isInteger(block.sampleSize) && block.sampleSize > 0 && share(block.affectedRunSharePct));
    const reason = technical ? 'Wegen technischer Fehler ist diese Antwort nicht auswertbar.'
        : 'Nicht auswertbar: vollständige Mindest-Flex-Messdaten fehlen.';
    const minimumNote = amount(block?.startMinimumFlexAnnual)
        ? `Mindest-Flex zum Laufstart: ${formatWholeEuro(block.startMinimumFlexAnnual)}; im Lauf jährlich fortgeschrieben. Vergleich mit dem jeweils angewandten Jahresbetrag.`
        : 'Der Mindest-Flex zum Laufstart fehlt; aktuelle Eingaben ersetzen keinen Laufwert.';
    const realAmounts = result?.euroMetrics?.real?.minimumFlexAmounts;
    const real = !backtest && moneyBasis === 'real';
    const paid = backtest ? path?.paidMedianNominalEur : real ? realAmounts?.paidMedianRealEurP50 : block?.paidMedianNominalEurP50;
    const desired = backtest ? path?.desiredMedianNominalEur : real ? realAmounts?.desiredMedianRealEurP50 : block?.desiredMedianNominalEurP50;
    const lowest = backtest ? path?.paidMinimumNominalEur : real ? realAmounts?.paidMinimumRealEurP50 : block?.paidMinimumNominalEurP50;
    const euros = value => valid && amount(value) ? formatWholeEuro(value) : '—';
    const basis = euroBasisLabel(real ? 'real' : 'nominal');
    const amountNote = `${backtest ? 'Nominale Jahresbeträge' : `Jahresbeträge · ${basis}`}: typisch bezahlt ${euros(paid)}, Wunsch ${euros(desired)}, schwächstes Jahr ${euros(lowest)}.${valid && ![paid, desired, lowest].every(amount) ? ' Betragsangaben fehlen; bitte neu rechnen.' : ''}`;
    const populationNote = backtest ? 'Beobachtete abgeschlossene Entnahmejahre bis Laufende.'
        : `Anteil betroffener Läufe: ${valid ? formatPercentage(block.affectedRunSharePct) : '—'} (mindestens ein Jahr unter Mindest-Flex). Mediane der Laufstatistiken, keine gepoolten Jahre; ${Number.isInteger(block?.sampleSize) ? block.sampleSize : 0} auswertbare Läufe.`;
    const paidAbovePlan = valid && amount(paid) && amount(desired) && paid > desired;
    const compactAmounts = paidAbovePlan
        ? `Typisch ${euros(paid)} · Wunsch-Flex laut Plan ${euros(desired)}`
        : `Typisch ${euros(paid)} von ${euros(desired)} Wunsch-Flex laut Plan`;
    const note = valid ? `${backtest ? 'Nominale Jahresbeträge' : `Jahresbeträge · ${basis}`} · ${compactAmounts} · schwächstes Jahr ${euros(lowest)}` : '';
    return { legacy: false, valid, title: backtest ? 'Jahre unter Mindest-Flex' : 'Anteil Jahre unter Mindest-Flex',
        value: valid ? formatPercentage(pct) : '—', count: valid && backtest ? path.affectedYearCount : null,
        affectedRunValue: valid && !backtest ? formatPercentage(block.affectedRunSharePct) : '—',
        observationCount: valid && backtest ? path.observationCount : null,
        text: !valid ? reason : pct === 0
            ? `Im typischen Lauf liegt dein Flex in keinem ausgewerteten Entnahmejahr unter deinem Mindest-Flex (zum Laufstart ${euros(block.startMinimumFlexAnnual)}).`
            : `In typisch ${formatPercentage(pct)} der Entnahmejahre liegt dein Flex unter deinem Mindest-Flex (zum Laufstart ${euros(block.startMinimumFlexAnnual)}).`,
        note, tooltip: `${minimumNote} ${populationNote} ${amountNote} Wunsch-Flex laut Plan und bezahlter Haushalts-Flex enthalten den Rentenbeitrag zum Flex. Dynamic Flex (VPW) kann mehr als den Wunsch-Flex laut Plan auszahlen. Das ist keine Garantie für alle Läufe oder die gesamte Lebenszeit.`,
        reason: valid ? '' : reason };
}

/** Reine Anzeigeprojektion vorhandener Kennzahlen; keine neue Statistik. */
export function buildMonteCarloAnswers({ results, totalRuns, failCount, moneyBasis = DEFAULT_EURO_MODE }) {
    const inventory = results?.outcomeInventory;
    const current = inventory?.schemaVersion === 'MonteCarloOutcomeInventoryV1';
    const technical = hasTechnicalFinancialError(results);
    const restriction = projectMinimumFlexDisplay(results, { moneyBasis });
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

    return [
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
            description: 'Typisches Endvermögen über alle finanziell auswertbaren Läufe.',
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
            description: 'Median des Endvermögens aller erfolgreichen Läufe.',
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
            description: 'Spannweite der Endvermögen zwischen konservativem P10 und optimistischem P90.',
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
    ].map(card => ['Median (alle)', 'Median (erfolgreiche)', '10%/90% Perzentil', 'Median Steuern'].includes(card.title)
        ? { ...card, tooltip: `${card.description} ${euroBasisLabel(moneyBasis)}.` } : card);
}

/**
 * Baut die Kern-KPI-Karten inkl. Detail-Sektionen.
 *
 * @param {Object} results - Ergebnisobjekt der Monte-Carlo-Simulation.
 * @returns {{ primary: Array<KpiDescriptor>, detailSections: Array<{title: string, kpis: Array<KpiDescriptor>}> }} Struktur für die KPI-Dashboards.
 */
export function buildKpiDashboard(results, inputs = {}, moneyBasis = DEFAULT_EURO_MODE) {
    const deQuote = Number(results?.depotErschoepfungsQuote) || 0;
    // Severity thresholds tuned for UI color coding.
    const depotTone = deQuote > 20 ? 'danger' : (deQuote > 5 ? 'warning' : 'success');

    const primary = [
        {
            title: 'Ø Lebensdauer',
            value: formatNumberWithUnit(results?.kpiLebensdauer?.mean, 'Jahre'),
            description: 'Durchschnittliche simulierte Lebensdauer über alle Läufe.',
            tone: 'default'
        },
        {
            title: 'Ruin oder Aktien/Gold ≤ 100 €',
            value: formatPercentage(deQuote),
            description: 'Anteil der Läufe mit Ruin oder einem Aktien-plus-Gold-Endbestand von höchstens 100 €. Freie Liquidität und Pflegereserve zählen nicht zur 100-€-Schwelle.',
            tone: depotTone
        },
        (() => {
            const restriction = projectMinimumFlexDisplay(results, { moneyBasis });
            return { title: restriction.title, displayRole: 'restriction', value: restriction.legacy
                ? restriction.technical ? '—' : formatPercentage(results?.cutYearSharePct?.p50) : restriction.value,
                description: restriction.legacy ? 'Anteil der Entnahmejahre mit Flex-Kürzung ab 10 %.'
                    : `${restriction.text} ${restriction.note}`,
                tooltip: restriction.legacy ? `${restriction.basisNote} Medianer Anteil abgeschlossener Dekumulationsjahre mit mindestens 10 % Wunsch-Kürzung (einschließlich genau 10 %). Stichprobe: ${Number(results?.cutYearSharePct?.sampleSize) || 0} Läufe.`
                    : restriction.tooltip,
                pairedMetrics: restriction.legacy ? undefined : [
                    { label: 'Typischer Jahresanteil', value: restriction.value },
                    { label: 'Betroffene Läufe', value: restriction.affectedRunValue }
                ],
                tone: restriction.legacy || restriction.valid ? 'default' : 'warning', layout: 'exact-risk', decisionCritical: true };
        })(),
        ...buildDecisionCriticalKpis(results, moneyBasis)
    ];

    const detailSections = [];

    detailSections.push({
        title: 'Operative Details',
        kpis: [
            {
                title: 'Max. Kürzung (Flex)',
                value: formatPercentage(results?.kpiMaxKuerzung?.p50),
                description: 'Im Median maximal aufgetretene Kürzung des Flex-Anteils in einem Jahr.',
                tone: 'default'
            },
            {
                title: 'Median-Alter: Ruin oder Aktien/Gold ≤ 100 €',
                value: formatNumberWithUnit(safeAge(results?.alterBeiErschoepfung?.p50), 'Jahre'),
                description: 'Medianes Alter beim ersten Ruin oder beim ersten Aktien-plus-Gold-Bestand von höchstens 100 € (nur entsprechend markierte Läufe).',
                tone: 'default'
            },
            {
                title: 'Median-Anteil Jahre ohne Flex',
                value: formatPercentage(results?.anteilJahreOhneFlex?.p50),
                description: 'Medianer Anteil der Jahre ohne Flex-Ausschüttung.',
                tone: 'default'
            }
        ]
    });

    const risikoKpis = buildRiskKpis(results);
    if (risikoKpis.length > 0) {
        detailSections.push({
            title: 'Risiko-Details',
            kpis: risikoKpis
        });
    }

    const tailRiskKpis = buildTailRiskKpis(results, inputs);
    if (tailRiskKpis.length > 0) {
        detailSections.push({
            title: 'Tail-Risk-Overlay',
            kpis: tailRiskKpis
        });
    }

    return {
        primary,
        drawdownKpis: buildDrawdownKpis(results?.maxDrawdowns, results?.realMaxDrawdowns),
        detailSections,
        reportingReferenceNotice: WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE
    };
}

/**
 * Bereitet die Stress-KPI-Struktur auf.
 *
 * @param {Object|null} stressKPI - Stress-KPI-Objekt aus den Simulationsergebnissen.
 * @returns {Object|null} Struktur mit formatierten KPIs oder null, falls keine Stressdaten vorliegen.
 */
export function buildStressMetrics(stressKPI, moneyBasis = DEFAULT_EURO_MODE, results = {}) {
    if (!stressKPI || !stressKPI.years || stressKPI.presetKey === 'NONE') {
        return null;
    }

    const presetLabel = STRESS_PRESETS[stressKPI.presetKey]?.label || 'Stress-Szenario';
    const realWithdrawalP10 = withdrawalMoney({ ...results, stressKPI }, moneyBasis, true);
    return {
        presetLabel,
        years: stressKPI.years,
        kpis: [
            {
                title: 'Max. Drawdown (Median, Stress)',
                value: formatPercentage(stressKPI.maxDD?.p50),
                description: `Größter Depot-Verlust während der ${stressKPI.years}-jährigen Stressphase (Median).`,
                tone: 'default'
            },
            {
                title: 'Max. Drawdown (P90, Stress)',
                value: formatPercentage(stressKPI.maxDD?.p90),
                description: '90% der Läufe hatten einen geringeren Drawdown in der Stressphase.',
                tone: 'default'
            },
            {
                title: 'Zeitanteil realisierte Entnahmequote > 4,5 % (Stress)',
                value: formatPercentage(stressKPI.timeShareAbove45?.p50),
                description: 'Medianer Anteil der Stress-Jahre mit realisierter Entnahmequote strikt größer als 4,5 %. Reine Berichtsreferenz; keine Alarm- oder Guardrail-Schwelle.',
                tone: 'warning'
            },
            {
                title: 'Kürzungsjahre >10% (Stress)',
                value: formatNumberWithUnit(stressKPI.cutYears?.p50, 'Jahre'),
                description: 'Anzahl der Jahre mit >10% Flex-Kürzung im Stressfenster (Median).',
                tone: 'warning'
            },
            {
                title: `${WITHDRAWAL_CARD_TITLE} (Stressphase)`,
                displayRole: 'withdrawal-stress',
                priceBasis: `${euroBasisLabel(moneyBasis)} / Jahr`,
                value: Number.isFinite(realWithdrawalP10?.p10)
                    ? formatConservativeCurrency(realWithdrawalP10.p10, 'benefit')
                    : '—',
                secondaryLabel: 'im typischen Lauf:',
                secondaryValue: Number.isFinite(realWithdrawalP10?.p50)
                    ? formatConservativeCurrency(realWithdrawalP10.p50, 'benefit')
                    : '—',
                statusLine: Number.isFinite(realWithdrawalP10?.p10)
                    ? ''
                    : unavailableStatus(realWithdrawalP10, 'no_observations'),
                secondaryStatusLine: Number.isFinite(realWithdrawalP10?.p50)
                    ? ''
                    : unavailableStatus(realWithdrawalP10, 'no_observations'),
                description: 'Jährliche Entnahme aus dem Vermögen in der Stressphase, ohne Renten.',
                tooltip: `Je Lauf wird das Entnahmeniveau der schwächsten 10 % der Stressjahre bestimmt. Nach einem Ruin zählen verbleibende Lebensjahre in der Stressphase mit 0 €. Die große Zahl ist das untere Zehntel dieser Laufwerte (P10); darunter steht ihr Median. ${euroBasisLabel(moneyBasis)}. Auswertbare Läufe: ${formatObservationCount(observationCount(realWithdrawalP10))}.`,
                tone: 'default',
                layout: 'exact-risk',
                decisionCritical: true
            },
            {
                title: 'Erholung nach Stress (Median)',
                value: formatNumberWithUnit(stressKPI.recoveryYears?.p50, 'Jahre'),
                description: 'Jahre bis die Entnahmerate wieder unter 3,5% fällt (Median).',
                tone: 'default'
            }
        ]
    };
}

/**
 * Bereitet die KPI-Struktur für Pflege-Risiken auf.
 *
 * @param {Object} results - Simulationsergebnisse (inkl. extraKPI.pflege).
 * @param {Object} inputs - Eingabeparameter der Simulation (inkl. Partnerdaten).
 * @returns {Object|null} Formatierte Pflege-KPI-Struktur oder null, wenn nicht aktiv.
 */
export function buildCareMetrics(results, inputs, moneyBasis = DEFAULT_EURO_MODE) {
    const sourceCare = results?.extraKPI?.pflege;
    const selectedCare = results?.euroMetrics?.[moneyBasis]?.pflege;
    const selected = (group, key) => selectedCare ? selectedCare[group]?.[key === 'realCostEurP50' ? 'additionalNeedEurP50' : key.replace('RealEur', 'Eur')]
        : moneyBasis === 'real' ? sourceCare?.[group]?.[key] : null;
    const care = sourceCare && { ...sourceCare,
        p1: { ...sourceCare.p1, realCostEurP50: selected('p1', 'realCostEurP50') },
        p2: { ...sourceCare.p2, realCostEurP50: selected('p2', 'realCostEurP50') },
        household: { ...sourceCare.household, ...Object.fromEntries(['totalAdditionalNeedRealEurP50', 'maxAnnualAdditionalNeedRealEurP50', 'endWealthWithCareRealEurP50', 'endWealthNoCareRealEurP50'].map(key => [key, selected('household', key)])) },
        comparison: { ...sourceCare.comparison, endWealthNoCareMinusCareRealEur: selected('comparison', 'endWealthNoCareMinusCareRealEur') } };
    const sourceBucket = results?.extraKPI?.healthBucket;
    const healthBucket = sourceBucket && (moneyBasis === 'nominal' ? sourceBucket
        : { ...sourceBucket, usedMedian: null, usedP90: null, endMedian: null, targetGapMedian: null, ...results?.euroMetrics?.real?.healthBucket });
    const hasCareMetrics = care && inputs?.pflegefallLogikAktivieren;
    const hasHealthBucketMetrics = healthBucket && (inputs?.healthBucketEnabled || inputs?.healthBucket?.enabled);
    if (!hasCareMetrics && !hasHealthBucketMetrics) {
        return null;
    }

    const cards = [];

    if (hasCareMetrics) {
        const p1 = care.p1 || {};
        cards.push(
            buildCareEntryCard('Pflegefall-Eintrittsquote P1', p1.entryRatePct, `P1-Eintritte: ${p1.entryRateNumerator || 0} von ${p1.entryRateDenominator || 0} angeforderten Läufen.`, '%'),
            buildCareEntryCard('Median Eintrittsalter P1', p1.entryAgeP50, `Bedingt auf beobachtete P1-Eintritte; Stichprobe: ${p1.sampleSize || 0} Läufe.`, 'Jahre'),
            buildCareEntryCard('Median Pflegejahre P1', p1.careYearsP50, `Nur P1-Pflegejahre in Läufen mit P1-Eintritt; Stichprobe: ${p1.sampleSize || 0}.`, 'Jahre'),
            buildCareEntryCard('Realer Pflege-Mehrbedarf P1 (Median)', p1.realCostEurP50, `Modellierter P1-Zusatzbedarf zu Preisen des Simulationsstarts; keine kausale Depot-Cashflow-Zurechnung. Stichprobe: ${p1.sampleSize || 0}.`, null, true)
        );
    }

    if (hasCareMetrics && inputs.partner?.aktiv) {
        const p2 = care.p2 || {};
        cards.push(
            buildCareEntryCard('Pflegefall-Eintrittsquote P2', p2.entryRatePct, `P2-Eintritte: ${p2.entryRateNumerator || 0} von ${p2.entryRateDenominator || 0} angeforderten Läufen.`, '%'),
            buildCareEntryCard('Median Eintrittsalter P2', p2.entryAgeP50, `Bedingt auf beobachtete P2-Eintritte; Stichprobe: ${p2.sampleSize || 0} Läufe.`, 'Jahre'),
            buildCareEntryCard('Median Pflegejahre P2', p2.careYearsP50, `Nur P2-Pflegejahre in Läufen mit P2-Eintritt; Stichprobe: ${p2.sampleSize || 0}.`, 'Jahre'),
            buildCareEntryCard('Realer Pflege-Mehrbedarf P2 (Median)', p2.realCostEurP50, `Modellierter P2-Zusatzbedarf zu Preisen des Simulationsstarts; keine kausale Depot-Cashflow-Zurechnung. Stichprobe: ${p2.sampleSize || 0}.`, null, true),
            buildCareEntryCard('Median Jahre beide in Pflege', care.household?.careYearsOverlapP50, `Gleichzeitige P1-/P2-Pflegejahre, einschließlich beobachteter 0; Stichprobe: ${care.household?.sampleSize || 0}.`, 'Jahre')
        );
    }

    if (hasCareMetrics) {
        cards.push(
            buildCareEntryCard('Max. jährlicher Pflege-Mehrbedarf (real)', care.household?.maxAnnualAdditionalNeedRealEurP50, 'Median des je Lauf höchsten tatsächlich modellierten jährlichen Haushalts-Zusatzbedarfs (P1 + P2), zu Preisen des Simulationsstarts.', null, true),
            buildCareEntryCard('Gesamter Pflege-Mehrbedarf (real)', care.household?.totalAdditionalNeedRealEurP50, 'Median der über Pflegejahre summierten modellierten Haushalts-Zusatzbedarfe, zu Preisen des Simulationsstarts; nicht als depotfinanzierter Betrag interpretieren.', null, true),
            buildCareEntryCard('Bedingte Shortfall-Rate', care.household?.shortfallRateWithCarePct, `Anteil der Shortfalls unter Läufen mit Pflegeeintritt; Stichprobe: ${care.household?.sampleSize || 0}.`, '%'),
            buildCareEntryCard('Shortfall-Rate (o. Pflege)', care.household?.shortfallRateWithoutCarePct, `Anteil der Shortfalls unter Läufen ohne Pflegeeintritt; Stichprobe: ${care.household?.noCareSampleSize || 0}.`, '%'),
            buildCareEntryCard('Reales Endvermögen (m. Pflege, Median)', care.household?.endWealthWithCareRealEurP50, 'Gruppenmedian der Läufe mit Pflegeeintritt, zu Preisen des Simulationsstarts.', null, true),
            buildCareEntryCard('Reales Endvermögen (o. Pflege, Median)', care.household?.endWealthNoCareRealEurP50, 'Gruppenmedian der Läufe ohne Pflegeeintritt, zu Preisen des Simulationsstarts.', null, true),
            buildCareEntryCard('Gruppenmedian-Differenz (nicht kausal)', care.comparison?.endWealthNoCareMinusCareRealEur, 'Nicht gepaarter, nicht kausaler Gruppenvergleich: Median ohne Pflege minus Median mit Pflege, zu Preisen des Simulationsstarts. Unterschiede der Gruppen, etwa Lebensdauer und Pflegeeintritt, sind nicht kontrolliert.', null, true)
        );
    }

    if (hasHealthBucketMetrics) {
        cards.push(
            buildCareEntryCard('Pflegereserve genutzt', healthBucket.usedRatePct, 'Anteil der Monte-Carlo-Läufe mit mindestens einer Entnahme aus der Pflegereserve.', '%'),
            buildCareEntryCard('Pflegereserve erschöpft', healthBucket.depletedRatePct, 'Anteil der Läufe mit aktiver Pflegereserve, in denen die Reserve am Ende aufgebraucht ist.', '%'),
            buildCareEntryCard('Median Reservenutzung', healthBucket.usedMedian, 'Typische Reservenentnahme in Läufen mit Nutzung.', null, true, 'nominal'),
            buildCareEntryCard('P90 Reservenutzung', healthBucket.usedP90, 'Hohe, aber nicht extreme Reservenentnahme über die Läufe mit Nutzung.', null, true, 'nominal'),
            buildCareEntryCard('Median Restreserve', healthBucket.endMedian, 'Typische verbleibende Pflegereserve am Laufende.', null, true, 'nominal'),
            buildCareEntryCard('Median Zieldeckung', healthBucket.coverageMedianPct, 'Typische reale Deckung relativ zum inflationsangepassten Reserveziel.', '%'),
            buildCareEntryCard('Median Ziellücke', healthBucket.targetGapMedian, 'Typische Lücke zum inflationsangepassten Reserveziel.', null, true, 'nominal')
        );
    }

    return { cards: cards.map(card => ({ ...card,
        title: card.title.replace('Realer ', '').replace('Reales ', '').replace(' (real)', ''),
        priceBasis: card.priceBasis ? euroBasisLabel(moneyBasis) : '',
        description: card.description.replaceAll('zu Preisen des Simulationsstarts', euroBasisLabel(moneyBasis))
            .replace('Typische reale Deckung', 'Typische Deckung') })) };
}

/**
 * Erstellt ein Gesamt-View-Model für die Monte-Carlo-Auswertung.
 *
 * @param {Object} params - Rohdaten und UI-Kontext.
 * @param {Object} params.results - Simulationsergebnisse.
 * @param {number} params.totalRuns - Anzahl der Läufe.
 * @param {number} params.failCount - Anzahl fehlgeschlagener Läufe.
 * @param {Object} params.inputs - Eingabeparameter der Simulation.
 * @returns {Object} Dom-neutrales View-Model für Renderer.
 */
export function prepareMonteCarloViewModel({ results, totalRuns, failCount, inputs, moneyBasis = DEFAULT_EURO_MODE }) {
    return {
        summaryCards: buildSummaryData({ results, totalRuns, failCount, moneyBasis }),
        kpiDashboard: buildKpiDashboard(results, inputs, moneyBasis),
        stressMetrics: buildStressMetrics(results?.stressKPI, moneyBasis, results),
        careMetrics: buildCareMetrics(results, inputs, moneyBasis),
        heatmapData: {
            heatmap: results?.heatmap,
            bins: results?.bins,
            totalRuns,
            extraKPI: results?.extraKPI
        },
        carThreshold: results?.realWithdrawalP10?.realEur
    };
}

/**
 * Baut die entscheidungskritischen Exaktwert-KPIs.
 * @param {Object} results - Aggregierte Monte-Carlo-Ergebnisse.
 * @returns {Array<KpiDescriptor>} KPI-Liste mit entscheidungskritischen Exaktwerten.
 */
function buildDecisionCriticalKpis(results, moneyBasis) {
    const withdrawal = withdrawalMoney(results, moneyBasis);
    const withdrawalReason = directMetricReason(withdrawal);
    const withdrawalP10Available = withdrawalReason === null && Number.isFinite(withdrawal.p10);
    const withdrawalMedianAvailable = withdrawalReason === null && Number.isFinite(withdrawal.p50);
    const lossCarry = (moneyBasis === 'real' ? results?.euroMetrics?.real?.lossCarryTaxSavings : results?.extraKPI?.lossCarryTaxSavings) || missingMoney;
    const lossCarryAvailable = directMetricReason(lossCarry) === null
        && Number.isFinite(lossCarry.perRunMean);

    return [
        {
            title: WITHDRAWAL_CARD_TITLE,
            displayRole: 'withdrawal',
            priceBasis: `${euroBasisLabel(moneyBasis)} / Jahr`,
            value: withdrawalP10Available ? formatConservativeCurrency(withdrawal.p10, 'benefit') : '—',
            otherBasisLine: otherBasisLine(withdrawalMoney(results, moneyBasis === 'real' ? 'nominal' : 'real').p10, moneyBasis),
            secondaryLabel: 'im typischen Lauf:',
            secondaryValue: withdrawalMedianAvailable ? formatConservativeCurrency(withdrawal.p50, 'benefit') : '—',
            statusLine: withdrawalP10Available ? '' : unavailableStatus(withdrawal, 'no_observations'),
            secondaryStatusLine: withdrawalMedianAvailable ? '' : unavailableStatus(withdrawal, 'no_observations'),
            description: 'Jährliche Entnahme aus dem Vermögen, ohne Renten.',
            tooltip: `Je Lauf wird ab der ersten Entnahme das Niveau der schwächsten 10 % der Jahre bestimmt. Nach einem Ruin zählen verbleibende Jahre bis Tod oder Zeitraumende mit 0 €. Die große Zahl ist das untere Zehntel dieser Laufwerte (P10 über alle Läufe). Darunter steht der Median dieser Laufwerte: im typischen Lauf. ${euroBasisLabel(moneyBasis)}. Auswertbare Läufe: ${formatObservationCount(observationCount(withdrawal))}; ausgeschlossen: ${nonNegativeInteger(withdrawal.excludedRuns)}. Kein Konfidenzintervall geschätzt.`,
            tone: 'default',
            layout: 'exact-risk',
            decisionCritical: true
        },
        {
            title: 'Ø Steuerersparnis Verlustvortrag',
            priceBasis: euroBasisLabel(moneyBasis),
            value: lossCarryAvailable ? formatConservativeCurrency(lossCarry.perRunMean, 'benefit') : '—',
            statusLine: lossCarryAvailable ? '' : unavailableStatus(lossCarry, 'no_observations'),
            description: 'Durchschnittliche Steuerersparnis pro Lauf durch Verlustvortrag.',
            tone: 'default',
            layout: 'exact-risk',
            decisionCritical: true
        }
    ];
}

/**
 * Baut nominale und reale Drawdown-KPIs paarweise aus den validierten Aggregaten.
 * Die UI rechnet weder neu noch repariert sie ungueltige Vorzeichen oder Grenzen.
 * @param {Object} nominalDrawdowns - Nominale Aggregation aus Slice 1.
 * @param {Object} realDrawdowns - Reale Aggregation aus Slice 1.
 * @returns {Array<KpiDescriptor>} Vier paarweise angeordnete Drawdown-Karten.
 */
function buildDrawdownKpis(nominalDrawdowns, realDrawdowns) {
    return [
        buildDrawdownCard(nominalDrawdowns, 'p50', 'Max. Drawdown nominal (Median)', 'Nominaler positiver Verlustbetrag vom vorherigen Depot-Hoch; gleicher Laufpfad und Zeitraum wie beim realen Drawdown.', 'default'),
        buildDrawdownCard(realDrawdowns, 'p50', 'Max. Drawdown real (Median)', 'Kaufkraftbereinigter positiver Verlustbetrag zu Preisen des Simulationsstarts; gleicher Laufpfad und Zeitraum wie beim nominalen Drawdown.', 'default'),
        buildDrawdownCard(nominalDrawdowns, 'p90', 'Max. Drawdown nominal (P90)', 'Nominaler positiver Verlustbetrag; nur 10 % der beobachteten Läufe hatten einen größeren nominalen Drawdown.', 'default'),
        buildDrawdownCard(realDrawdowns, 'p90', 'Max. Drawdown real (P90)', 'Kaufkraftbereinigter positiver Verlustbetrag zu Preisen des Simulationsstarts; nur 10 % der beobachteten Läufe hatten einen größeren realen Drawdown.', 'default')
    ];
}

/**
 * Baut Risiko-KPIs rund um Volatilität und Entnahmeraten.
 * @param {Object} results - Simulationsergebnisse.
 * @returns {Array<KpiDescriptor>} Risiko-KPIs.
 */
function buildRiskKpis(results) {
    const kpis = [];
    if (isFinite(results?.volatilities?.p50)) {
        kpis.push({
            title: 'Median Portfoliovolatilität',
            value: formatPercentage(results.volatilities.p50),
            description: 'Stichproben-Standardabweichung (N-1) der jährlichen Portfolio-Renditen; die Jahresfrequenz benötigt keine zusätzliche Annualisierung (Median über Läufe).',
            tone: 'default'
        });
    }
    {
        const timeShare = Number.isFinite(results?.extraKPI?.timeShareQuoteAbove45)
            ? (results.extraKPI.timeShareQuoteAbove45 * 100)
            : null;
        kpis.push({
            title: 'Zeitanteil realisierte Entnahmequote > 4,5 %',
            value: formatPercentage(timeShare),
            statusLine: Number.isFinite(timeShare)
                ? ''
                : 'Grund: no_observations · Beobachtungen: unbekannt Jahre',
            description: 'Anteil aller finanziell auswertbaren simulierten Dekumulationsjahre mit realisierter Entnahmequote strikt größer als 4,5 %. Reine Berichtsreferenz; keine Alarm- oder Guardrail-Schwelle.',
            tone: 'warning'
        });
        const safety = results?.extraKPI?.dynamicFlexSafety;
        if (safety && typeof safety === 'object') {
            const stage1Years = isFinite(safety.yearShareStage1plus) ? safety.yearShareStage1plus * 100 : 0;
            const stage2Years = isFinite(safety.yearShareStage2) ? safety.yearShareStage2 * 100 : 0;
            const stage2Runs = isFinite(safety.runShareStage2) ? safety.runShareStage2 * 100 : 0;
            kpis.push({
                title: 'Safety aktiv (Jahre)',
                value: formatPercentage(stage1Years),
                description: 'Anteil aller Simulationsjahre mit aktivem Dynamic-Flex-Sicherheitsmodus (Stufe 1/2).',
                tone: stage1Years > 25 ? 'warning' : 'default'
            });
            kpis.push({
                title: 'Safety Stufe 2 (Jahre)',
                value: formatPercentage(stage2Years),
                description: 'Anteil aller Simulationsjahre mit Fallback auf statischen Flex.',
                tone: stage2Years > 10 ? 'danger' : (stage2Years > 0 ? 'warning' : 'default')
            });
            kpis.push({
                title: 'Läufe mit Stufe 2',
                value: formatPercentage(stage2Runs),
                description: 'Anteil der Läufe, in denen mindestens einmal Stufe 2 erreicht wurde.',
                tone: stage2Runs > 20 ? 'danger' : (stage2Runs > 0 ? 'warning' : 'default')
            });
        }
    }
    return kpis;
}

function buildDrawdownCard(metric, quantileKey, title, description, tone) {
    const value = metric?.[quantileKey];
    const count = drawdownObservationCount(metric);
    const directReason = directMetricReason(metric);
    const valid = directReason === null
        && Number.isFinite(value)
        && value >= 0
        && value <= 100;
    let reason = directReason;
    if (!valid && reason === null) {
        if (value === null || value === undefined) {
            reason = activeMissingnessReason(metric) || 'no_observations';
        } else if (!Number.isFinite(value)) {
            reason = 'invalid_non_finite';
        } else {
            reason = 'invalid_drawdown_domain';
        }
    }
    return {
        title,
        value: valid ? formatConservativePercentagePoints(value) : '—',
        statusLine: valid ? '' : `Grund: ${reason} · Beobachtungen: ${formatObservationCount(count)} Läufe`,
        description: `${description} Prozentpunkte aus dem validierten Aggregat werden mit mindestens zwei Nachkommastellen angezeigt und bei weiterer Präzision als Verlustbetrag konservativ aufgerundet; Beobachtungen: ${formatObservationCount(count)} Läufe. Gültige Domäne: 0 bis 100 %.`,
        tone,
        layout: 'exact-risk',
        decisionCritical: true
    };
}

function directMetricReason(metric) {
    const applicability = metric?.applicability;
    if (typeof applicability === 'string' && applicability.trim()) return applicability.trim();
    if (applicability && typeof applicability === 'object' && applicability.applicable === false) {
        return typeof applicability.reason === 'string' && applicability.reason.trim()
            ? applicability.reason.trim()
            : 'not_applicable';
    }
    return typeof metric?.missingness === 'string' && metric.missingness.trim()
        ? metric.missingness.trim()
        : null;
}

function activeMissingnessReason(metric) {
    const inventories = [metric?.missingness, metric?.distribution?.missingness];
    const countsByReason = new Map();
    for (const inventory of inventories) {
        if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) continue;
        for (const [reason, count] of Object.entries(inventory)) {
            if (!Number.isFinite(count) || count <= 0) continue;
            countsByReason.set(reason, Math.max(countsByReason.get(reason) || 0, count));
        }
    }
    return [...countsByReason.entries()]
        .sort(([reasonA, countA], [reasonB, countB]) => countB - countA || reasonA.localeCompare(reasonB))[0]?.[0] || null;
}

function drawdownObservationCount(metric) {
    const candidates = [
        metric?.observationCount?.observedPaths,
        metric?.distribution?.observationCount?.observedPaths,
        metric?.distribution?.sampleSize,
        metric?.sampleSize
    ];
    const count = candidates.find(candidate => Number.isSafeInteger(candidate) && candidate >= 0);
    return count ?? null;
}

function observationCount(metric) {
    const candidates = [
        metric?.observationCount?.observedPaths,
        metric?.distribution?.observationCount?.observedPaths,
        metric?.distribution?.sampleSize,
        metric?.sampleSize
    ];
    const count = candidates.find(candidate => Number.isSafeInteger(candidate) && candidate >= 0);
    return count ?? null;
}

function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function unavailableStatus(metric, fallbackReason) {
    const reason = directMetricReason(metric) || activeMissingnessReason(metric) || fallbackReason;
    return `Grund: ${reason} · Beobachtungen: ${formatObservationCount(observationCount(metric))} Läufe`;
}

function formatObservationCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unbekannt';
}

function stabilizeScaledValue(value, scale) {
    const scaled = value * scale;
    const nearestInteger = Math.round(scaled);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
    return Math.abs(scaled - nearestInteger) <= tolerance ? nearestInteger : scaled;
}

function roundConservatively(value, fractionDigits, direction) {
    const scale = 10 ** fractionDigits;
    const scaled = stabilizeScaledValue(value, scale);
    const rounded = direction === 'cost' ? Math.ceil(scaled) : Math.floor(scaled);
    return rounded / scale;
}

function formatConservativeCurrency(value, direction) {
    if (!Number.isFinite(value)) return '—';
    return formatWholeEuro(value);
}

function formatConservativePercentagePoints(value) {
    return formatNumberWithUnit(roundConservatively(value, 2, 'cost'), '%', 2);
}

function buildTailRiskKpis(results, inputs = {}) {
    const tailRisk = results?.extraKPI?.tailRisk;
    if (!tailRisk || inputs?.tailRiskEnabled !== true) {
        return [];
    }

    const activeYearsPct = Number.isFinite(tailRisk.activeYearShare)
        ? tailRisk.activeYearShare * 100
        : 0;
    const appliedYearsPct = Number.isFinite(tailRisk.appliedYearShare)
        ? tailRisk.appliedYearShare * 100
        : 0;
    const skipCount = Number(tailRisk.skippedHistoricalCrisisYears) || 0;

    return [
        {
            title: 'Tail-Risk-Läufe aktiv',
            value: formatPercentage(tailRisk.runActiveRatePct),
            description: 'Anteil der Läufe mit mindestens einem geplanten Tail-Risk-Ereignis.',
            tone: tailRisk.runActiveRatePct > 0 ? 'warning' : 'default'
        },
        {
            title: 'Tail-Risk angewandt',
            value: formatPercentage(tailRisk.runAppliedRatePct),
            description: 'Anteil der Läufe, in denen mindestens ein Schock tatsächlich auf ein Nicht-Krisenjahr angewandt wurde.',
            tone: tailRisk.runAppliedRatePct > 0 ? 'danger' : 'default'
        },
        {
            title: 'Aktive Tail-Jahre',
            value: formatPercentage(activeYearsPct),
            description: `${tailRisk.activeYears || 0} von ${tailRisk.evaluatedYears || 0} simulierten Jahren lagen in einem Tail-Risk-Ereignisfenster.`,
            tone: activeYearsPct > 0 ? 'warning' : 'default'
        },
        {
            title: 'Applizierte Tail-Jahre',
            value: formatPercentage(appliedYearsPct),
            description: `${tailRisk.appliedYears || 0} Jahre erhielten den Return-/Inflationsschock.`,
            tone: appliedYearsPct > 0 ? 'danger' : 'default'
        },
        {
            title: 'Historische Krisen-Skips',
            value: formatNumberWithUnit(skipCount),
            description: 'Geplante Tail-Schocks, die wegen historischer Krisenjahre nicht additiv angewandt wurden.',
            tone: skipCount > 0 ? 'warning' : 'default'
        }
    ];
}

/**
 * Sicheres Handling für Alterswerte, damit 0/negativ als fehlend interpretiert wird.
 * @param {number} value - Alterswert.
 * @returns {number|null} Validierter Wert oder null.
 */
function safeAge(value) {
    const numeric = Number(value);
    if (!isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return numeric;
}

/**
 * Hilfsfunktion für Pflege-KPIs.
 * @param {string} title - Titel der Karte.
 * @param {number|null|undefined} value - Rohwert.
 * @param {string} description - Beschreibung der Kennzahl.
 * @param {string|null} unit - Einheit ("%"/"Jahre"), ansonsten null für Währung.
 * @param {boolean} isCurrency - Kennzeichnet Währungsformatierung.
 * @returns {KpiDescriptor} Formatierte Pflege-KPI.
 */
function buildCareEntryCard(title, value, description, unit = null, isCurrency = false, priceBasis = 'heutige Euro') {
    let formattedValue = '—';
    if (isCurrency) {
        formattedValue = formatWholeEuro(value);
    } else if (unit) {
        formattedValue = unit === '%'
            ? formatPercentage(value)
            : formatNumberWithUnit(value, unit);
    } else {
        formattedValue = formatNumberWithUnit(value);
    }

    return {
        title,
        value: formattedValue,
        description: sanitizeDescription(description),
        priceBasis: isCurrency ? priceBasis : '',
        tone: 'default'
    };
}
