/** @import * as AnalysisTypes from '../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../typcheck/rechenkern.js' */
import { createWealthFan, createWealthFanPath, recordWealthFanYear, commitWealthFanPath, mergeWealthFan,
    classifyWealthFanValue, WEALTH_FAN_CLASS_COUNT, buildWealthFanModel, wealthFanTransferables } from './wealth-fan-aggregation.js';

const SUM_KEYS = ['moneyReal', 'moneyNominal', 'homeReal', 'homeNominal', 'homeSelfReal', 'homeSelfNominal'];

// Zusätzliche Anzeigeaggregation. Der bestehende Geldfächer bleibt bytegleich.
/** @param {number} horizon @returns Vermögensfächer mit getrennten Geld- und Immobilienanteilen. */
export function createHomeWealthFan(horizon) {
    const fan = createWealthFan(horizon);
    return { fan, ...Object.fromEntries(SUM_KEYS.map(key => [key, new Float64Array(fan.real.length)])) };
}

/** NG-W (W1): Der Worker überträgt auch den Gesamtvermögensfächer, statt ihn zu kopieren.
 * @param {CoreTypes.HomeWealthFan | null | undefined} source @returns {ArrayBufferLike[]} Klassen-, Zähler- und Summenpuffer. */
export function homeWealthFanTransferables(source) {
    return source?.fan ? [...wealthFanTransferables(source.fan), ...SUM_KEYS.filter(key => source[key]?.buffer).map(key => source[key].buffer)] : [];
}

/**
 * @param target - Zielaggregat.
 * @param money - Kontext für money.
 * @param homes - Kontext für homes.
 * @param {boolean} [technical] - Kontext für technical.
 * @returns {void}
 */
export function commitHomeWealthFan(target, money, homes, technical = false) {
    if (!target) return;
    if (technical) { commitWealthFanPath(target.fan, money, true); return; }
    const path = createWealthFanPath(target.fan.horizonYears, money.nominal[0] + homes.nominal[0]);
    let lastNominal = homes.nominal[0], lastReal = homes.real[0];
    const observedSelf = {};
    for (const mode of ['real', 'nominal']) {
        const values = homes[mode === 'real' ? 'selfReal' : 'selfNominal'] || homes[mode];
        let last = values[0];
        observedSelf[mode] = Float64Array.from(values, (value, year) => {
            if (Number.isFinite(value)) last = value;
            return Number.isFinite(value) ? value : money.ruined[year] ? last : NaN;
        });
    }
    const observedHomes = { nominal: new Float64Array(money.alive.length), real: new Float64Array(money.alive.length) };
    observedHomes.nominal[0] = lastNominal; observedHomes.real[0] = lastReal;
    for (let year = 1; year < money.alive.length; year++) if (money.alive[year]) {
        if (!Number.isNaN(homes.nominal[year])) lastNominal = homes.nominal[year];
        if (!Number.isNaN(homes.real[year])) lastReal = homes.real[year];
        observedHomes.nominal[year] = Number.isFinite(homes.nominal[year]) ? homes.nominal[year] : money.ruined[year] ? lastNominal : NaN;
        observedHomes.real[year] = Number.isFinite(homes.real[year]) ? homes.real[year] : money.ruined[year] ? lastReal : NaN;
        recordWealthFanYear(path, year, money.nominal[year] + observedHomes.nominal[year], money.real[year] + observedHomes.real[year]);
    }
    commitWealthFanPath(target.fan, path);
    for (let year = 0; year < money.alive.length; year++) if (money.alive[year]) {
        for (const mode of ['real', 'nominal']) {
            const bin = classifyWealthFanValue(path[mode][year]);
            if (bin >= 0) {
                target[mode === 'real' ? 'moneyReal' : 'moneyNominal'][year * WEALTH_FAN_CLASS_COUNT + bin] += money[mode][year];
                target[mode === 'real' ? 'homeReal' : 'homeNominal'][year * WEALTH_FAN_CLASS_COUNT + bin] += observedHomes[mode][year];
                target[mode === 'real' ? 'homeSelfReal' : 'homeSelfNominal'][year * WEALTH_FAN_CLASS_COUNT + bin] += observedSelf[mode][year];
            }
        }
    }
}

/**
 * @param target - Zielaggregat.
 * @param source - Quelle des Laufbelegs.
 * @returns Ergebnis der Operation.
 */
export function mergeHomeWealthFan(target, source) {
    if (!source) return target;
    target ||= createHomeWealthFan(source.fan.horizonYears);
    mergeWealthFan(target.fan, source.fan);
    for (const key of SUM_KEYS) {
        const values = source[key] || source[key.replace('homeSelf', 'home')];
        for (let i = 0; i < target[key].length; i++) target[key][i] += values[i];
    }
    return target;
}

/** @param {ArrayLike<number>} counts @param {number} offset @param {number} rank @returns {number} Klasse am Rang einer Jahreszeile, -1 ohne Klasse. */
function classAtRank(counts, offset, rank) {
    let seen = 0;
    for (let bin = 0; bin < WEALTH_FAN_CLASS_COUNT; bin++) {
        seen += counts[offset + bin];
        if (seen > rank) return bin;
    }
    return -1;
}

/** HP-4: Kopie für das gemerkte Monte-Carlo-Ergebnis. Die Geld- und Immobiliensummen bleiben nur in den Klassen, die homeWealthFanModel
 * liest: an den Quantilrängen und je ein Beleg für selbst genutzte und vermietete Immobilien. Die Anzeige bleibt gleich, der Eintrag klein.
 * @param {CoreTypes.HomeWealthFan} source @returns {CoreTypes.HomeWealthFan} */
export function compactHomeWealthFan(source) {
    if (!source?.fan) return source;
    const compact = { ...source };
    for (const mode of ['real', 'nominal']) {
        const suffix = mode === 'real' ? 'Real' : 'Nominal', keep = new Set();
        for (const row of buildWealthFanModel(source.fan, mode).years) {
            const offset = row.year * WEALTH_FAN_CLASS_COUNT, count = row.alive - row.missing;
            for (const percent of Object.keys(row.quantiles)) {
                const rank = (count - 1) * Number(percent) / 100;
                for (const bin of [classAtRank(source.fan[mode], offset, Math.floor(rank)), classAtRank(source.fan[mode], offset, Math.ceil(rank))]) {
                    if (bin >= 0) keep.add(offset + bin);
                }
            }
        }
        const homes = source[`home${suffix}`], self = source[`homeSelf${suffix}`] || homes;
        for (const index of [self.findIndex(value => value > 0), homes.findIndex((value, i) => value - self[i] > .001)]) if (index >= 0) keep.add(index);
        for (const key of [`money${suffix}`, `home${suffix}`, `homeSelf${suffix}`]) {
            if (!source[key]) continue;
            const values = new Float64Array(source[key].length);
            for (const index of keep) values[index] = source[key][index];
            compact[key] = values;
        }
    }
    return compact;
}

/** Zusammensetzung derselben Gesamtvermögensklasse, keine Summe unabhängiger Perzentile.
 * @param {CoreTypes.HomeWealthFan | null} source @param {string} [mode] @param {CoreTypes.WealthFan | null} [moneyFan] @returns {AnalysisTypes.WealthFanModel} */
export function homeWealthFanModel(source, mode = 'real', moneyFan = null) {
    const model = buildWealthFanModel(source?.fan, mode);
    if (!model.available) return model;
    const moneyModel = buildWealthFanModel(moneyFan, mode);
    for (const row of model.years) {
        const counts = source.fan[mode], offset = row.year * WEALTH_FAN_CLASS_COUNT;
        const count = row.alive - row.missing;
        for (const [percent, quantile] of Object.entries(row.quantiles)) {
            const rank = (count - 1) * Number(percent) / 100;
            const atRank = (rank, part = 'money') => {
                const bin = classAtRank(counts, offset, rank);
                if (bin < 0) return null;
                const money = source[mode === 'real' ? 'moneyReal' : 'moneyNominal'][offset + bin];
                const home = source[mode === 'real' ? 'homeReal' : 'homeNominal'][offset + bin];
                const self = source[mode === 'real' ? 'homeSelfReal' : 'homeSelfNominal']?.[offset + bin] ?? home;
                return money + home > 0 ? (part === 'self' ? self : money) / (money + home) : 0;
            };
            const low = atRank(Math.floor(rank)), high = atRank(Math.ceil(rank));
            quantile.money = low === null || high === null || quantile.value === null ? null
                : Math.max(0, Math.min(quantile.value, quantile.value * (low + (rank % 1) * (high - low))));
            const lowSelf = atRank(Math.floor(rank), 'self'), highSelf = atRank(Math.ceil(rank), 'self');
            quantile.homeSelf = lowSelf === null || highSelf === null || quantile.money === null ? null
                : Math.max(0, Math.min(quantile.value - quantile.money, quantile.value * (lowSelf + (rank % 1) * (highSelf - lowSelf))));
        }
        row.ruined = moneyModel.years.find(item => item.year === row.year)?.ruined || 0;
    }
    const homes = source[mode === 'real' ? 'homeReal' : 'homeNominal'];
    const self = source[mode === 'real' ? 'homeSelfReal' : 'homeSelfNominal'] || homes;
    return { ...model, hasHomes: true, hasHomeSelf: self.some(value => value > 0),
        hasHomeRented: homes.some((value, index) => value - self[index] > .001) };
}
