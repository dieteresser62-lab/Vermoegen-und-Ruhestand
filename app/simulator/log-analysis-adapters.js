import { isMinimumFlexFinancialYear } from './minimum-flex-metrics.js';

export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const amount = value => finite(value) && value >= 0 ? value : null;
export const adjacent = (left, right) => !!left && !!right && Number.isInteger(left.year)
    && right.year === left.year + 1 && right.rowIndex === left.rowIndex + 1;

function normalizeRows(entries) {
    let inflationComplete = true;
    return (Array.isArray(entries) ? entries : []).map((entry, rowIndex) => {
        const row = entry && Object.hasOwn(entry, 'row') ? entry.row : entry;
        const valid = !!row && typeof row === 'object' && !Array.isArray(row);
        const financial = valid && isMinimumFlexFinancialYear(row);
        const inflationPct = entry?.inflationVJ ?? row?.inflation;
        const startFactor = row?.inflation_factor_cum;
        if (financial && (!finite(inflationPct) || inflationPct <= -100
            || !finite(startFactor) || startFactor <= 0)) inflationComplete = false;
        const factor = financial && inflationComplete ? startFactor * (1 + inflationPct / 100) : null;
        const yearEndPriceFactor = finite(factor) && factor > 0 ? factor : null;
        const nominalWealthEur = financial ? amount(row.portfolio_total_end) : null;
        const real = nominalWealthEur !== null && yearEndPriceFactor !== null
            ? nominalWealthEur / yearEndPriceFactor : null;
        return {
            row: valid ? row : {}, rowIndex, financial,
            year: Number.isInteger(entry?.jahr) ? entry.jahr : null,
            historicalYear: Number.isInteger(entry?.histJahr) ? entry.histJahr : null,
            recordType: valid ? row.recordType ?? (row.Regime === 'BANKRUPT' ? 'terminal_ruin'
                : financial ? 'financial_year' : 'not_evaluable') : 'missing_row',
            inflationPct: finite(inflationPct) ? inflationPct : null,
            yearEndPriceFactor, nominalWealthEur, realWealthEur: finite(real) ? real : null
        };
    });
}

function context(kind, entries, metadata, options) {
    const moneyBasis = options.moneyBasis ?? 'nominal';
    if (!['nominal', 'real'].includes(moneyBasis)) throw new TypeError('moneyBasis must be nominal or real');
    const persons = options.personDisplayContext?.persons ?? options.personDataContext?.persons ?? [];
    return {
        kind, moneyBasis, rows: normalizeRows(entries), ...metadata,
        // Ausschließlich der vom Aufrufer übergebene Laufkontext, keine aktuellen Profile lesen.
        personNames: [0, 1].map(index => typeof persons[index]?.name === 'string'
            && persons[index].name.trim() ? persons[index].name.trim() : `Person ${index + 1}`),
        hasPartner: options.hasPartner ?? metadata.hasPartner ?? false
    };
}

/** Übergabe von window.globalBacktestData.result (oder seines enthaltenden Laufbelegs). */
export function adaptBacktestResult(data, options = {}) {
    const result = data?.result ?? data;
    return context('backtest', result?.rows, {
        available: Array.isArray(result?.rows),
        initialWealthEur: amount(result?.portfolioStart),
        terminalWealthNominalEur: amount(result?.portfolioEnd),
        outcome: result?.outcome ? { ...result.outcome } : null,
        period: result?.request?.period ? { ...result.request.period } : null,
        hasPartner: result?.request?.inputs?.partner?.aktiv === true,
        sourceIdentity: null
    }, { personDisplayContext: data?.personDisplayContext, personDataContext: data?.personDataContext, ...options });
}

/** Ein vorhandener Pfad; Endwertrang und Quelllauf bleiben beim Euro-Wechsel gleich. */
export function adaptScenarioLog(scenario, options = {}) {
    const rows = Array.isArray(scenario?.logDataRows) ? scenario.logDataRows : null;
    const terminal = rows?.find(row => row?.recordType === 'terminal_ruin' || row?.recordType === 'terminal_death');
    return context('monte_carlo', rows, {
        available: Array.isArray(rows),
        initialWealthEur: amount(options.initialWealth),
        terminalWealthNominalEur: amount(scenario?.endVermoegen),
        outcome: terminal?.recordType === 'terminal_ruin' || scenario?.failed === true
            ? { kind: 'ruin', ruinYear: terminal?.recordType === 'terminal_ruin' ? terminal.jahr : null }
            : terminal?.recordType === 'terminal_death' ? { kind: 'all_dead' }
                : scenario?.failed === false ? { kind: 'no_ruin' } : null,
        period: null,
        sourceIdentity: scenario?.sourceIdentity ? { ...scenario.sourceIdentity } : null,
        scenarioKey: scenario?.key ?? null,
        hasPartner: options.inputs?.partner?.aktiv ?? rows?.some(row => row?.Person2Alive === 0 || row?.Person2Alive === 1)
    }, options);
}

/** Auswahlkennungen wie in buildScenarioEntries: char_p50 oder rand_<key>. */
export function adaptMonteCarloScenario(logs, selection, options = {}) {
    const entries = [
        ...(logs?.characteristic ?? []).map(scenario => ({ id: `char_${scenario.key}`, scenario })),
        ...(logs?.random ?? []).map(scenario => ({ id: `rand_${scenario.key}`, scenario }))
    ];
    const matches = entries.filter(entry => entry.id === selection || entry.scenario.key === selection);
    // Bei fehlender oder mehrdeutiger Auswahl keinen anderen Pfad unterschieben.
    return adaptScenarioLog(matches.length === 1 ? matches[0].scenario : null, options);
}

export function moneyValue(nominalEur, item, moneyBasis, { yearStart = false } = {}) {
    const nominal = amount(nominalEur);
    const factor = yearStart ? item?.row?.inflation_factor_cum : item?.yearEndPriceFactor;
    const real = nominal !== null && finite(factor) && factor > 0 ? nominal / factor : null;
    return { nominalEur: nominal, realEur: finite(real) ? real : null, moneyBasis,
        valueEur: moneyBasis === 'real' ? finite(real) ? real : null : nominal };
}
