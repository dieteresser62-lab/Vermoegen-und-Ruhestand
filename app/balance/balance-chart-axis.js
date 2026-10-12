// @ts-check
import { UIUtils } from './balance-utils.js';

export const formatChartEuro = value => UIUtils.formatBalanceCurrency(value);

/** Reine, nach außen gerundete Verlaufsachse; Geometrie bleibt normiert. */
export function prepareChartAxis(values) {
    const finite = values.filter(Number.isFinite);
    if (!finite.length) return null;
    // Ganz-Euro-Labels benötigen mindestens 1 € Abstand. Die Normierung
    // beginnt ebenfalls bei 1, damit Subnormalwerte keine Division überlaufen.
    const scale = finite.reduce((max, value) => Math.max(max, Math.abs(value)), 1);
    const low = finite.reduce((min, value) => Math.min(min, value / scale), Infinity);
    const high = finite.reduce((max, value) => Math.max(max, value / scale), -Infinity);
    const span = high - low;
    const padding = span ? Math.max(span * .08, Math.max(Math.abs(low), Math.abs(high)) * Number.EPSILON * 4)
        : Math.max(Math.abs(low) * .02, low === 0 ? 1 : 0);
    const exponent = Math.max(0, Math.min(308, Math.floor(Math.log10(scale) + Math.log10((span + padding * 2) / 4))));
    const power = 10 ** exponent;
    const rawStep = ((span + padding * 2) / 4) / (power / scale);
    const step = (rawStep <= 1 ? 1 : rawStep <= 2 ? 2 : rawStep <= 5 ? 5 : 10) * power;
    // Am endlichen Zahlenrand ist eine äußere glatte Grenze nicht mehr
    // darstellbar. Nur dort begrenzen; alle endlichen Daten bleiben enthalten.
    const tickStep = Number.isFinite(step) ? step : power;
    const unit = tickStep / scale;
    // Nichtnegative Daten erhalten keinen negativen Rand; Indexnull wird
    // auch bei negativen Kleinwerten als +0 geführt (kein „-0 €“-Label).
    const firstIndex = (low >= 0 ? Math.max(0, Math.floor((low - padding) / unit))
        : Math.floor((low - padding) / unit)) || 0;
    const lastIndex = Math.ceil((high + padding) / unit) || 0;
    const minimum = Math.max(-Number.MAX_VALUE, firstIndex * tickStep);
    const maximum = Math.min(Number.MAX_VALUE, lastIndex * tickStep);
    const lower = minimum / scale;
    const upper = maximum / scale;
    const ticks = [];
    const count = lastIndex - firstIndex;
    for (let index = 0; index <= count; index++) {
        const value = (firstIndex + index) * tickStep;
        if (Number.isFinite(value) && value >= minimum && value <= maximum) ticks.push(value);
    }
    if (ticks[0] !== minimum) ticks.unshift(minimum);
    if (ticks[ticks.length - 1] !== maximum) ticks.push(maximum);
    const position = value => (value / scale - lower) / (upper - lower);
    return { minimum, maximum, step: tickStep, ticks, position };
}
