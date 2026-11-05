/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { formatChartEuro, formatWholeEuro, formatNumberWithUnit } from '../results-formatting.js';
import { quantile } from '../simulator-utils.js';

export const WITHDRAWAL_CARD_TITLE = 'Entnahme aus dem Vermögen in schwachen Jahren';

export const wealthPartsDetail = parts => parts ? `davon Geldvermögen ${summaryEuro(parts.money)} · Immobilien ${summaryEuro(parts.homes)}` : '';

export const summaryEuro = value => Math.abs(value) >= 1e6 ? formatChartEuro(value) : formatWholeEuro(value);

export const missingMoney = { missingness: 'no_observations' };

export function finalMoney(results, mode) {
    if (results?.displayWealth?.[mode]) return { ...results.finalOutcomes, ...results.displayWealth[mode] };
    if (mode !== 'real') return results?.finalOutcomes || {};
    if (results?.euroMetrics?.real?.finalOutcomes) return results.euroMetrics.real.finalOutcomes;
    const values = results?.wealthView?.realValues;
    return Array.isArray(values) && values.length ? { p10: quantile(values, 0.1), p50: quantile(values, 0.5), p90: quantile(values, 0.9) } : missingMoney;
}

export function withdrawalMoney(results, mode, stress = false) {
    if (mode === 'nominal') return results?.euroMetrics?.nominal?.[stress ? 'stressWithdrawalP10' : 'withdrawalP10'] || missingMoney;
    const block = (stress ? results?.stressKPI?.realWithdrawalP10 : results?.realWithdrawalP10) || missingMoney;
    return { ...block, p10: block.realEur, p50: block.p50RealEur };
}

export const otherBasisLine = (value, mode) => Number.isFinite(value)
    ? `${mode === 'nominal' ? 'in heutiger Kaufkraft' : 'nominal'} etwa ${summaryEuro(value)}`
    : `${mode === 'nominal' ? 'Heutige Kaufkraft' : 'Nominaler Gegenwert'} fehlt · bitte neu rechnen`;

export function directMetricReason(metric) {
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

export function activeMissingnessReason(metric) {
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

export function drawdownObservationCount(metric) {
    const candidates = [
        metric?.observationCount?.observedPaths,
        metric?.distribution?.observationCount?.observedPaths,
        metric?.distribution?.sampleSize,
        metric?.sampleSize
    ];
    const count = candidates.find(candidate => Number.isSafeInteger(candidate) && candidate >= 0);
    return count ?? null;
}

export function observationCount(metric) {
    const candidates = [
        metric?.observationCount?.observedPaths,
        metric?.distribution?.observationCount?.observedPaths,
        metric?.distribution?.sampleSize,
        metric?.sampleSize
    ];
    const count = candidates.find(candidate => Number.isSafeInteger(candidate) && candidate >= 0);
    return count ?? null;
}

export function nonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function unavailableStatus(metric, fallbackReason) {
    const reason = directMetricReason(metric) || activeMissingnessReason(metric) || fallbackReason;
    return `Grund: ${reason} · Beobachtungen: ${formatObservationCount(observationCount(metric))} Läufe`;
}

export function formatObservationCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : 'unbekannt';
}

function stabilizeScaledValue(value, scale) {
    const scaled = value * scale;
    const nearestInteger = Math.round(scaled);
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8;
    return Math.abs(scaled - nearestInteger) <= tolerance ? nearestInteger : scaled;
}

export function roundConservatively(value, fractionDigits, direction) {
    const scale = 10 ** fractionDigits;
    const scaled = stabilizeScaledValue(value, scale);
    const rounded = direction === 'cost' ? Math.ceil(scaled) : Math.floor(scaled);
    return rounded / scale;
}

export function formatConservativeCurrency(value, direction) {
    if (!Number.isFinite(value)) return '—';
    return formatWholeEuro(value);
}

