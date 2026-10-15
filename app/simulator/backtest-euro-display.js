import { adaptBacktestResult, finite } from './log-analysis-adapters.js';
import { backtestChartSeries } from './simulator-crises.js';

export const backtestStartYear = result => result?.request?.period?.startYear ?? result?.request?.startYear;
export const backtestEuroBasis = (result, mode) => mode === 'real'
    ? `Euro von ${backtestStartYear(result) ?? 'Laufstart'}` : 'nominal';

// Derselbe protokollierte Jahresendfaktor wie im Backtest-Log-Analysator.
const realAmount = (value, factor) => {
    if (!finite(value)) return null;
    if (value === 0) return 0;
    const real = finite(factor) && factor > 0 ? value / factor : null;
    return finite(real) ? real : null;
};

/** Reine Anzeigeprojektion; Resultat, Kennzahlen- und Exportverträge bleiben unverändert. */
export function projectBacktestEuroMetrics(result) {
    const nominal = result?.metrics?.values ?? {};
    const items = adaptBacktestResult(result).rows;
    const endFactor = items.at(-1)?.yearEndPriceFactor;
    const sum = read => {
        if (!items.length) return null;
        const values = items.map(item => realAmount(read(result.rows[item.rowIndex]), item.yearEndPriceFactor));
        return values.every(finite) ? values.reduce((total, value) => total + value, 0) : null;
    };
    const gap = result?.summary?.healthBucket?.targetGap;
    return {
        nominal: { ...nominal, health_bucket_target_gap: gap },
        real: {
            ...nominal,
            wealth_start_nominal_eur: nominal.wealth_start_nominal_eur,
            wealth_end_nominal_eur: realAmount(nominal.wealth_end_nominal_eur, endFactor),
            withdrawal_total_nominal_eur: finite(nominal.withdrawal_total_nominal_eur)
                ? sum(entry => entry.entscheidung?.jahresEntnahme) : null,
            tax_total_nominal_eur: finite(nominal.tax_total_nominal_eur)
                ? sum(entry => entry.row?.steuern_gesamt) : null,
            health_bucket_end_nominal_eur: realAmount(nominal.health_bucket_end_nominal_eur, endFactor),
            health_bucket_target_gap: realAmount(gap, endFactor)
        }
    };
}

export function projectBacktestChartSeries(result, moneyBasis = 'nominal') {
    const series = backtestChartSeries(result);
    if (moneyBasis !== 'real') return series;
    const items = adaptBacktestResult(result).rows;
    return series.map((point, index) => Object.fromEntries(Object.entries(point).map(([key, value]) =>
        [key, key === 'year' ? value : realAmount(value, items[index]?.yearEndPriceFactor)])));
}
