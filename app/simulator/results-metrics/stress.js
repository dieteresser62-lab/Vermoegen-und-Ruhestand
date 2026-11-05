/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { DEFAULT_EURO_MODE, euroBasisLabel } from '../euro-display.js';
import { STRESS_PRESETS } from '../simulator-data.js';
import { withdrawalMoney, WITHDRAWAL_CARD_TITLE, formatConservativeCurrency, unavailableStatus, formatObservationCount, observationCount } from './display-values.js';
import { formatPercentage, formatNumberWithUnit } from '../results-formatting.js';

/**
 * Bereitet die Stress-KPI-Struktur auf.
 *
 * @param {Object|null} stressKPI - Stress-KPI-Objekt aus den Simulationsergebnissen.
 * @returns {Object|null} Struktur mit formatierten KPIs oder null, falls keine Stressdaten vorliegen.

 *
 * @param {string} [moneyBasis] - Preisbasis der Anzeige.
 * @param [results] - Aggregierte Laufdaten.
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
