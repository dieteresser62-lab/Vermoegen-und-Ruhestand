/** @import * as AnalysisTypes from '../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../typcheck/rechenkern.js' */
import { createWealthFan, createWealthFanPath, recordWealthFanYear, commitWealthFanPath, mergeWealthFan,
    classifyWealthFanValue, WEALTH_FAN_CLASS_COUNT, buildWealthFanModel } from './wealth-fan-aggregation.js';

// Zusätzliche Anzeigeaggregation. Der bestehende Geldfächer bleibt bytegleich.
/** @param {number} horizon @returns Vermögensfächer mit getrennten Geld- und Immobilienanteilen. */
export function createHomeWealthFan(horizon) {
    const fan = createWealthFan(horizon);
    return { fan, ...Object.fromEntries(['moneyReal', 'moneyNominal', 'homeReal', 'homeNominal', 'homeSelfReal', 'homeSelfNominal'].map(key => [key, new Float64Array(fan.real.length)])) };
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
    for (const key of ['moneyReal', 'moneyNominal', 'homeReal', 'homeNominal', 'homeSelfReal', 'homeSelfNominal']) {
        const values = source[key] || source[key.replace('homeSelf', 'home')];
        for (let i = 0; i < target[key].length; i++) target[key][i] += values[i];
    }
    return target;
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
                let seen = 0;
                for (let bin = 0; bin < WEALTH_FAN_CLASS_COUNT; bin++) {
                    const n = counts[offset + bin];
                    seen += n;
                    if (seen > rank) {
                        const money = source[mode === 'real' ? 'moneyReal' : 'moneyNominal'][offset + bin];
                        const home = source[mode === 'real' ? 'homeReal' : 'homeNominal'][offset + bin];
                        const self = source[mode === 'real' ? 'homeSelfReal' : 'homeSelfNominal']?.[offset + bin] ?? home;
                        return money + home > 0 ? (part === 'self' ? self : money) / (money + home) : 0;
                    }
                }
                return null;
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
