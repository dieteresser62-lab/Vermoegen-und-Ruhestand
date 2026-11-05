/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { DEFAULT_EURO_MODE, euroBasisLabel } from '../euro-display.js';
import { formatNumberWithUnit, formatPercentage } from '../results-formatting.js';
import { projectMinimumFlexDisplay } from './minimum-flex.js';
import { buildSummaryData } from './summary.js';
import { buildStressMetrics } from './stress.js';
import { buildCareMetrics } from './care.js';
import { withdrawalMoney, directMetricReason, missingMoney, WITHDRAWAL_CARD_TITLE, formatConservativeCurrency, otherBasisLine, unavailableStatus, formatObservationCount, observationCount, nonNegativeInteger, drawdownObservationCount, activeMissingnessReason, roundConservatively } from './display-values.js';

export const WITHDRAWAL_RATE_REPORTING_REFERENCE_NOTICE = 'Die Auswertung bei 4,5 % bezieht sich auf die realisierte Entnahmequote. Sie ist nur eine Berichtsreferenz und keine Alarm- oder Guardrail-Schwelle.';

/**
 * Baut die Kern-KPI-Karten inkl. Detail-Sektionen.
 *
 * @param {Object} results - Ergebnisobjekt der Monte-Carlo-Simulation.
 * @returns {AnalysisTypes.KpiDashboard} Struktur für die KPI-Dashboards.

 *
 * @param [inputs] - Eingaben des Laufes.
 * @param {string} [moneyBasis] - Preisbasis der Anzeige.
 */
export function buildKpiDashboard(results, inputs = {}, moneyBasis = DEFAULT_EURO_MODE) {
    const deQuote = Number(results?.depotErschoepfungsQuote) || 0;
    // Severity thresholds tuned for UI color coding.
    const depotTone = deQuote > 20 ? 'danger' : (deQuote > 5 ? 'warning' : 'success');

    /** @type {KpiDescriptor[]} */
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

    /** @type {{title: string; kpis: KpiDescriptor[]}[]} */
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
 * Erstellt ein Gesamt-View-Model für die Monte-Carlo-Auswertung.
 *
 * @param {Object} params - Rohdaten und UI-Kontext.
 * @param {Object} params.results - Simulationsergebnisse.
 * @param {number} params.totalRuns - Anzahl der Läufe.
 * @param {number} params.failCount - Anzahl fehlgeschlagener Läufe.
 * @param {string} [params.moneyBasis] - Preisbasis der Anzeige.
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
    /** @type {KpiDescriptor[]} */
    const kpis = [];
    if (isFinite(results?.volatilities?.p50)) {
        kpis.push({
            title: 'Median Volatilität Geldvermögen',
            value: formatPercentage(results.volatilities.p50),
            description: 'Stichproben-Standardabweichung (N-1) der jährlichen Renditen des Geldvermögens; die Jahresfrequenz benötigt keine zusätzliche Annualisierung (Median über Läufe).',
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

/** @param {object} metric @param {string} quantileKey @param {string} title @param {string} description @param {KpiDescriptor['tone']} tone @returns {KpiDescriptor} */
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

/** @param {object} results @param {object} inputs @returns {KpiDescriptor[]} */
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

function formatConservativePercentagePoints(value) {
    return formatNumberWithUnit(roundConservatively(value, 2, 'cost'), '%', 2);
}
