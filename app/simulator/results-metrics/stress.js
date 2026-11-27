/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { DEFAULT_EURO_MODE, euroBasisLabel } from '../euro-display.js';
import { STRESS_PRESETS } from '../simulator-data.js';
import { withdrawalMoney, WITHDRAWAL_CARD_TITLE, formatConservativeCurrency, unavailableStatus, formatObservationCount, observationCount } from './display-values.js';
import { formatPercentage, formatNumberWithUnit, formatCoveredRuns } from '../results-formatting.js';

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
                title: 'Max. Rückgang (Median, Stress)',
                value: formatPercentage(stressKPI.maxDD?.p50),
                description: `Größter Depot-Verlust während der ${stressKPI.years}-jährigen Stressphase (Median). Ist das Vermögen in der Stressphase aufgebraucht, zählt der Lauf mit 100 %.`,
                tone: 'default'
            },
            {
                title: 'Max. Rückgang (P90, Stress)',
                value: formatPercentage(stressKPI.maxDD?.p90),
                description: '90% der Läufe hatten einen geringeren Rückgang in der Stressphase.',
                tone: 'default'
            },
            {
                title: 'Zeitanteil realisierte Entnahmequote > 4,5 % (Stress)',
                value: formatPercentage(stressKPI.timeShareAbove45?.p50),
                description: 'Medianer Anteil der Stress-Jahre mit realisierter Entnahmequote strikt größer als 4,5 %. Reine Berichtsreferenz; keine Alarm- oder Leitplanken-Schwelle.',
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
                tooltip: `Je Lauf wird das Entnahmeniveau der schwächsten 10 % der Stressjahre bestimmt. Ist das Vermögen aufgebraucht, zählen die verbleibenden Lebensjahre in der Stressphase mit 0 €. Die große Zahl ist das untere Zehntel dieser Laufwerte (P10); darunter steht ihr Median. ${euroBasisLabel(moneyBasis)}. Auswertbare Läufe: ${formatObservationCount(observationCount(realWithdrawalP10))}.`,
                tone: 'default',
                layout: 'exact-risk',
                decisionCritical: true
            },
            buildRecoveryKpi(stressKPI.recoveryYears)
        ]
    };
}

/** NG-W (W4): Läufe ohne Erholung erscheinen getrennt und nicht als Erholungsdauer.
 * @param {{p50?: number|null, recoveredCount?: number, noRecoveryCount?: number}} [recovery]
 * @returns {KpiDescriptor} */
function buildRecoveryKpi(recovery = {}) {
    const recovered = recovery.recoveredCount, missing = recovery.noRecoveryCount;
    const counted = Number.isInteger(recovered) && Number.isInteger(missing) && recovered + missing > 0;
    if (!counted) {
        return { title: 'Erholung nach Stress (Median)', value: formatNumberWithUnit(recovery.p50, 'Jahre'),
            description: 'Jahre bis die Entnahmerate wieder unter 3,5% fällt (Median).', tone: 'default' };
    }
    return {
        title: 'Erholung nach Stress (Median)',
        value: recovered > 0 ? formatNumberWithUnit(recovery.p50, 'Jahre') : 'keine Erholung',
        secondaryLabel: 'keine Erholung:',
        secondaryValue: formatPercentage(missing / (recovered + missing) * 100),
        secondaryStatusLine: formatCoveredRuns(missing, recovered + missing),
        description: 'Jahre, bis die Entnahmerate wieder unter 3,5 % fällt; Median der erholten Läufe.',
        tooltip: 'Erholt ist ein Lauf, wenn die Entnahmerate nach der Stressphase wieder unter 3,5 % fällt. Ist vorher das Vermögen aufgebraucht, sterben alle Personen oder endet der Horizont, zählt er unter „keine Erholung“ und nicht in den Median.',
        tone: 'default'
    };
}
