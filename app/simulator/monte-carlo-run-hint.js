import { buildBinaryProportionEstimate } from './monte-carlo-statistics.js';
import { escapeProtocolHtml as escape } from './protocol-renderer.js';

const integer = value => typeof value === 'number' ? value : typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim()) ? Number(value) : NaN;
const format = value => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(value);
export function buildMonteCarloRunHint({ runs, years, measurement = null, comparableKey = null, successRatio = null } = {}) {
    runs = integer(runs); years = integer(years);
    const valid = Number.isSafeInteger(runs) && runs >= 1 && runs <= 1000000
        && Number.isSafeInteger(years) && years >= 1 && years <= 110;
    if (!valid || runs < 100000) return { visible: false, valid };
    const ratioKnown = typeof successRatio === 'number' && Number.isFinite(successRatio) && successRatio >= 0 && successRatio <= 1;
    const ratio = ratioKnown ? successRatio : 0.5;
    const estimates = [10000, runs].map(trials => buildBinaryProportionEstimate({ successes: Math.round(ratio * trials), trials }));
    const durationKnown = measurement?.completed === true && measurement.comparableKey === comparableKey
        && Number.isFinite(measurement.elapsedMs) && measurement.elapsedMs > 0
        && Number.isSafeInteger(measurement.runs) && measurement.runs > 0
        && Number.isSafeInteger(measurement.years) && measurement.years > 0;
    const durationMs = durationKnown ? measurement.elapsedMs * runs * years / (measurement.runs * measurement.years) : null;
    return { visible: true, valid: true, runs, years, severe: runs >= 1000000, ratioKnown, estimates,
        durationMs: Number.isFinite(durationMs) ? durationMs : null };
}

export function renderMonteCarloRunHint(model) {
    if (!model.visible) return '';
    const duration = model.durationMs === null ? 'Die Dauer ist noch nicht abschätzbar.'
        : `Geschätzte Dauer: etwa ${format(Math.max(1, Math.round(model.durationMs / 1000)))} Sekunden (aus dem letzten vergleichbaren erfolgreichen Lauf).`;
    const interval = estimate => {
        const ci = estimate.confidenceInterval95;
        return `${ci.lowerPct.toLocaleString('de-DE', { maximumFractionDigits: 3 })}–${ci.upperPct.toLocaleString('de-DE', { maximumFractionDigits: 3 })} %`;
    };
    return `<strong>${model.severe ? 'Sehr viele Läufe' : 'Viele Läufe'}: ${escape(duration)}</strong><p>Voraussichtliches 95-%-Wilsonintervall der Floor-Deckung: bei 10.000 Läufen ${interval(model.estimates[0])}, bei ${format(model.runs)} Läufen ${interval(model.estimates[1])}. ${model.ratioKnown ? 'Grundlage: Erfolgsanteil des letzten vergleichbaren Laufs.' : 'Erfolgsanteil unbekannt; konservative 50-%-Grundlage.'} Das beschreibt Simulationsfehler, nicht Modellrisiko.</p><p>Der Zusatzspeicher des Vermögensfächers bleibt bei gleichem Horizont und gleicher Workerzahl konstant. Die übrigen Ergebnisdaten wachsen mit der Laufzahl. Empfehlung: höchstens 100.000 Läufe.</p>`;
}

/** Nur flüchtige Messgrundlage; keine Profil-/Session-/Exportwrites. */
const measurements = new WeakMap();
export function recordMonteCarloHintMeasurement(doc, measurement) {
    if (doc && measurement?.completed === true && Number.isFinite(measurement.elapsedMs) && measurement.elapsedMs > 0) measurements.set(doc, { ...measurement });
}
export function getMonteCarloHintMeasurement(doc) { return measurements.get(doc) || null; }
export function monteCarloHintComparableKey(inputs, parameters, workerConfig, useCapeSampling) {
    const { anzahl, maxDauer, ...sampling } = parameters;
    return JSON.stringify({ inputs, sampling, workerConfig, useCapeSampling });
}
