import { readerParameterRows } from './docs-reader-parameters.mjs';
import { CONFIG } from '../engine/config.mjs';
import { isActionOnlyParameter } from './handlungsanweisung-parameter.mjs';
import { LIQUIDITY_RUNWAY_CONTRACT_V1, deriveLiquidityRunwayPolicy } from '../types/liquidity-runway-contract.js';

export const BUDGET_REFERENCE = 'docs/reference/JAHRESBUDGET.md';
export const PARAMETER_GROUPS = ['SPENDING_MODEL', 'THRESHOLDS', 'RECOVERY_GUARDRAILS',
    'ANTI_PSEUDO_ACCURACY', 'MARKET_VALUATION', 'CAPE_CONTINUOUS'];

// Auch Arrayelemente und Methoden gehören zum Vollständigkeitsvertrag.
export function parameterLeaves(config = CONFIG) {
    const entries = [];
    function walk(value, key) {
        if (value !== null && typeof value === 'object') {
            const children = Object.entries(value);
            if (!children.length) entries.push([key, value]);
            for (const [child, item] of children) walk(item, `${key}.${child}`);
        } else entries.push([key, value]);
    }
    for (const group of PARAMETER_GROUPS) walk(config[group], group);
    return entries.filter(([key]) => !isActionOnlyParameter(key));
}

export function parameterAssignments(source) {
    const assignments = new Map();
    for (const match of source.matchAll(/<!--\s*docs:parameter\s+(\{[^\n]+\})\s*-->/g)) {
        const data = JSON.parse(match[1]);
        if (!Array.isArray(data.keys) || !data.target) throw new Error('Parameterbeleg braucht keys und target.');
        if (data.target.startsWith('#')) {
            const stage = data.target.slice(1).toUpperCase();
            if (!/^(A[1-5]|B(?:[0-9]|1[0-3]))$/.test(stage)
                || !source.includes(`<a id="${data.target.slice(1)}"></a>\n### ${stage} `)) {
                throw new Error(`Parameterziel ohne Steckbrief: ${data.target}`);
            }
        } else if (!/^FACHKONZEPT\.md#[\wäöüß-]+$/.test(data.target)) {
            throw new Error(`Parameterziel braucht einen ausdrücklichen Referenzverweis: ${data.target}`);
        }
        for (const key of data.keys) {
            if (assignments.has(key)) throw new Error(`Parameter doppelt zugeordnet: ${key}`);
            assignments.set(key, data.target);
        }
    }
    return assignments;
}

function displayValue(value) {
    if (typeof value === 'function') return '`getCurb(athGapPercent)`';
    if (value === Infinity) return '∞';
    if (value === null) return '`null`';
    if (typeof value === 'object') return `\`${JSON.stringify(value)}\``;
    return `\`${String(value)}\``;
}

export function renderTechnicalParameterTable(source, config = CONFIG) {
    const assignments = parameterAssignments(source), entries = parameterLeaves(config);
    const keys = new Set(entries.map(([key]) => key));
    const missing = entries.filter(([key]) => !assignments.has(key)).map(([key]) => key);
    const obsolete = [...assignments.keys()].filter(key => !keys.has(key));
    if (missing.length || obsolete.length) throw new Error([
        ...missing.map(key => `Nicht zugeordnet: ${key}`),
        ...obsolete.map(key => `Nicht mehr vorhanden: ${key}`)
    ].join('\n'));
    return ['| Schlüssel in config.mjs | Wert | Stufe oder andere Referenz |', '| --- | --- | --- |',
        ...entries.map(([key, value]) => {
            const target = assignments.get(key);
            const label = target.startsWith('#') ? target.slice(1).toUpperCase() : 'Transaktionen / Anzeige';
            return `| \`${key}\` | ${displayValue(value)} | [${label}](${target}) |`;
        })].join('\n');
}

export function renderRunwayTable() {
    return ['Standardziel: ' + LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears + ' Jahre. Wählbar sind Halbjahresschritte.', '',
        '| Liquiditätsziel in Jahren | Zielmonate | Harte Mindestreichweite in Monaten |',
        '| ---: | ---: | ---: |', ...runwayRows()].join('\n');
}

function runwayRows() {
    const contract = LIQUIDITY_RUNWAY_CONTRACT_V1;
    const groups = [];
    for (let years = contract.minimumYears; years <= contract.maximumYears; years += contract.stepYears) {
        const policy = deriveLiquidityRunwayPolicy(years);
        const last = groups.at(-1);
        if (last?.minimum === policy.hardMinimumMonths) last.end = policy;
        else groups.push({ start: policy, end: policy, minimum: policy.hardMinimumMonths });
    }
    const range = (a, b) => a === b ? a.toLocaleString('de-DE') : `${a.toLocaleString('de-DE')}–${b.toLocaleString('de-DE')}`;
    return groups.map(({ start, end, minimum }) =>
        `| ${range(start.targetYears, end.targetYears)} | ${range(start.targetMonths, end.targetMonths)} | ${minimum} |`);
}

export function replaceGenerated(source, marker, content) {
    const start = `<!-- ${marker}:start -->`, end = `<!-- ${marker}:end -->`;
    const a = source.indexOf(start), b = source.indexOf(end);
    if (a < 0 || b <= a || source.indexOf(start, a + start.length) >= 0 || source.indexOf(end, b + end.length) >= 0) {
        throw new Error(`Fehlende oder doppelte Marker: ${marker}`);
    }
    return source.slice(0, a + start.length) + '\n' + content + '\n' + source.slice(b);
}

export function renderParameterTable(source, config = CONFIG) {
    // Validierung einschließlich aller technischen Blätter nicht durch die Leserprojektion ersetzen.
    renderTechnicalParameterTable(source, config);
    const p = (suffix) => `SPENDING_MODEL.${suffix}`;
    const specs = [];
    const add = (name, keys, unit = '') => specs.push([name, keys, unit]);
    const spending = (name, suffixes, unit = '') => add(name, suffixes.map(p), unit);
    spending('Glättung · Rohzielgewicht', ['FLEX_RATE_SMOOTHING_ALPHA'], '%');
    spending('Erster Anstieg · normal / zügig', ['RATE_CHANGE_MAX_UP_PP', 'RATE_CHANGE_AGILE_UP_PP'], 'Punkte');
    spending('Erste Senkung · normal / Bär / gelockert', ['RATE_CHANGE_MAX_DOWN_PP', 'RATE_CHANGE_MAX_DOWN_IN_BEAR_PP', 'RATE_CHANGE_RELAX_MAX_DOWN_PP'], 'Punkte');
    spending('Schnelle Rückkehr · Quote / Anstieg', ['RATE_CHANGE_RELAX_UP_WITHDRAWAL_RATE', 'RATE_CHANGE_RELAX_MAX_UP_PP'], ['%', 'Punkte']);
    spending('Vermögensdämpfung · sichere / volle Quote', ['WEALTH_ADJUSTED_REDUCTION.SAFE_WITHDRAWAL_RATE', 'WEALTH_ADJUSTED_REDUCTION.FULL_WITHDRAWAL_RATE'], '%');
    spending('Flex-Budget · Schalter / Jahre / Auffüllanteil', ['FLEX_BUDGET.ENABLED', 'FLEX_BUDGET.DEFAULT_MAX_YEARS', 'FLEX_BUDGET.DEFAULT_RECHARGE_FRACTION'], ['', 'Jahre', '%']);
    spending('Flex-Budget · aktive Phasen', ['FLEX_BUDGET.ACTIVE_REGIMES.0', 'FLEX_BUDGET.ACTIVE_REGIMES.1']);
    for (const [suffix, name, unit] of [['REGIME_WEIGHTS', 'Jahresverbrauch', ''], ['REGIME_CAP_MULTIPLIER', 'Deckelfaktor', ''], ['MIN_RATE_BASE_PCT', 'Mindestrate', 'Punkte'], ['MIN_RATE_FLOOR_SLOPE_PCT', 'Grundbedarfs-Steigung', 'Punkte']]) {
        spending(`Flex-Budget · ${name}, Bär / Erholung`, [`FLEX_BUDGET.${suffix}.bear_deep`, `FLEX_BUDGET.${suffix}.recovery_in_bear`], unit);
    }
    spending('S-Kurve · Wunschschutzquote', ['FLEX_SHARE_MIN_PROTECTED_WITHDRAWAL_RATE'], '%');
    spending('S-Kurve · Schalter / Stärke K / Steilheit A / Mitte B', ['FLEX_SHARE_S_CURVE.ENABLED', 'FLEX_SHARE_S_CURVE.K', 'FLEX_SHARE_S_CURVE.A', 'FLEX_SHARE_S_CURVE.B']);
    spending('Bärendeckel / Entlastung', ['FLEX_RATE_HARD_CAPS.BEAR_DEEP_MAX_RATE', 'FLEX_RATE_HARD_CAPS.FLEX_SHARE_RELIEF_MAX_PP'], 'Punkte');
    for (let i = 0; i < 3; i++) spending(`Reichweitendeckel ${i + 1} · Deckung unter / Rate`, [`FLEX_RATE_HARD_CAPS.RUNWAY_COVERAGE_CAPS.${i}.maxCoverage`, `FLEX_RATE_HARD_CAPS.RUNWAY_COVERAGE_CAPS.${i}.maxRate`], ['%', 'Punkte']);
    spending('Letzte Änderung · Anstieg / Senkung / Bär / gelockert', ['FLEX_RATE_FINAL_LIMITS.MAX_UP_PP', 'FLEX_RATE_FINAL_LIMITS.MAX_DOWN_PP', 'FLEX_RATE_FINAL_LIMITS.MAX_DOWN_IN_BEAR_PP', 'FLEX_RATE_FINAL_LIMITS.RELAX_MAX_DOWN_PP'], 'Punkte');
    spending('Dynamik · Renditeverfahren', ['DYNAMIC_FLEX.RETURN_POLICY']);
    spending('Dynamik · Inflation / sichere Anlagen / Gold', ['DYNAMIC_FLEX.LONG_TERM_INFLATION', 'DYNAMIC_FLEX.SAFE_ASSET_REAL_RETURN', 'DYNAMIC_FLEX.GOLD_REAL_RETURN'], '%');
    spending('Dynamik · Horizont von / bis', ['DYNAMIC_FLEX.MIN_HORIZON_YEARS', 'DYNAMIC_FLEX.MAX_HORIZON_YEARS'], 'Jahre');
    spending('Dynamik · Realrendite von / bis', ['DYNAMIC_FLEX.MIN_REAL_RETURN', 'DYNAMIC_FLEX.MAX_REAL_RETURN'], '%');
    spending('Dynamik · Renditeglättung', ['DYNAMIC_FLEX.EXPECTED_RETURN_SMOOTHING_ALPHA'], '%');
    spending('Go-Go · höchster Faktor', ['DYNAMIC_FLEX.MAX_GO_GO_MULTIPLIER']);
    spending('Sicherheit · Schalter / höchste Stufe', ['DYNAMIC_FLEX_SAFETY.ENABLED', 'DYNAMIC_FLEX_SAFETY.MAX_STAGE']);
    spending('Sicherheit · kritische / schwere Punktzahl', ['DYNAMIC_FLEX_SAFETY.BAD_SCORE_THRESHOLD', 'DYNAMIC_FLEX_SAFETY.SEVERE_SCORE_THRESHOLD']);
    spending('Sicherheit · kritische / stabile Jahresfolge', ['DYNAMIC_FLEX_SAFETY.ESCALATE_STREAK_YEARS', 'DYNAMIC_FLEX_SAFETY.DEESCALATE_STREAK_YEARS'], 'Jahre');
    spending('Sicherheit · starke Ratenkürzung', ['DYNAMIC_FLEX_SAFETY.HARD_CUT_PCT'], 'Punkte');
    spending('Rückkehr · Quote / Rückgang / Kürzung höchstens', ['DYNAMIC_FLEX_SAFETY.GOOD_WITHDRAWAL_RATE', 'DYNAMIC_FLEX_SAFETY.GOOD_DRAWDOWN', 'DYNAMIC_FLEX_SAFETY.GOOD_CUT_PCT'], ['%', '%', 'Punkte']);
    spending('Rückkehr · Zusatzreichweite / Rampe', ['DYNAMIC_FLEX_SAFETY.RUNWAY_HEADROOM_MONTHS', 'DYNAMIC_FLEX_SAFETY.REENTRY_RAMP_YEARS'], ['Monate', 'Jahre']);
    spending('Stufe 2 · kritischer Stress erforderlich', ['DYNAMIC_FLEX_SAFETY.STAGE2_REQUIRE_CRITICAL_STRESS']);
    spending('Stufe 2 · Bodenanteil Grundbedarf / dynamischer Vorbedarf', ['DYNAMIC_FLEX_SAFETY.STAGE2_MIN_FLEX_OF_FLOOR_RATIO', 'DYNAMIC_FLEX_SAFETY.STAGE2_MIN_FLEX_OF_PREV_DYNAMIC_RATIO'], '%');
    add('Alarm · Depotquote / realer Rückgang', ['THRESHOLDS.ALARM.withdrawalRate', 'THRESHOLDS.ALARM.realDrawdown'], '%');
    add('Vorsicht · Anhebungsquote', ['THRESHOLDS.CAUTION.withdrawalRate'], '%');
    add('Alarm · knappe Reichweite', ['THRESHOLDS.STRATEGY.runwayThinMonths'], 'Monate');
    for (let i = 0; i < 4; i++) add(`Erholung ${i + 1} · Hochabstand über / bis / Kürzung`, ['minGap', 'maxGap', 'curbPercent'].map(k => `RECOVERY_GUARDRAILS.CURB_RULES.${i}.${k}`), ['Prozent', 'Prozent', 'Punkte']);
    add('Monatsrundung · Schalter', ['ANTI_PSEUDO_ACCURACY.ENABLED']);
    for (let i = 0; i < 3; i++) add(`Monatsstufe ${i + 1} · Betrag unter / Schritt`, ['limit', 'step'].map(k => `ANTI_PSEUDO_ACCURACY.QUANTIZATION_TIERS_MONTHLY.${i}.${k}`), '€');
    add('CAPE · Ersatzwert', ['MARKET_VALUATION.DEFAULT_CAPE']);
    for (let i = 0; i < 4; i++) add(`CAPE-Stützpunkt ${i + 1} · Bewertung / Nominalrendite`, [0, 1].map(k => `MARKET_VALUATION.EXPECTED_RETURN_CAPE_POINTS.${i}.${k}`), ['', '%']);
    add('Stetiger CAPE-Pfad · Ersatz / Minimum / Maximum', ['DEFAULT_CAPE', 'MIN_CAPE', 'MAX_CAPE'].map(k => `CAPE_CONTINUOUS.${k}`));
    add('Stetiger Pfad · Portfoliorealrendite von / bis', ['MIN_REAL_RETURN', 'MAX_REAL_RETURN'].map(k => `CAPE_CONTINUOUS.${k}`), '%');
    add('Stetiger Pfad · Aktienrealrendite von / bis / Zuschlag', ['MIN_EQUITY_REAL_RETURN', 'MAX_EQUITY_REAL_RETURN', 'EQUITY_PREMIUM_ADJUSTMENT'].map(k => `CAPE_CONTINUOUS.${k}`), '%');
    add('Stetiger Pfad · sichere Realrendite', ['CAPE_CONTINUOUS.SAFE_REAL_RETURN_MODE']);
    const technicalOnly = ['SPENDING_MODEL.DYNAMIC_FLEX.FALLBACK_REAL_RETURN', 'THRESHOLDS.STRATEGY.stagflationInflation',
        'RECOVERY_GUARDRAILS.description', 'RECOVERY_GUARDRAILS.getCurb',
        ...['phase', 'monthlyMode', 'annualizationFactor', 'floorProtection'].map(k => `ANTI_PSEUDO_ACCURACY.WITHDRAWAL_ROUNDING.${k}`),
        ...['UNDERVALUED_CAPE', 'FAIR_VALUE_CAPE', 'OVERVALUED_CAPE', 'EXTREME_OVERVALUED_CAPE',
            'EXPECTED_RETURN_BY_SIGNAL.undervalued', 'EXPECTED_RETURN_BY_SIGNAL.fair', 'EXPECTED_RETURN_BY_SIGNAL.overvalued', 'EXPECTED_RETURN_BY_SIGNAL.extreme_overvalued'].map(k => `MARKET_VALUATION.${k}`)];
    for (const [name, heading] of [['Dynamik · Renditeverfahren', 'Dynamik und Sicherheit'], ['Alarm · Depotquote / realer Rückgang', 'Markt und Rundung'], ['CAPE · Ersatzwert', 'Bewertung']]) {
        specs.find(row => row[0] === name)[3] = heading;
    }
    return '#### Ratensteuerung\n\n' + readerParameterRows(parameterLeaves(config), specs, parameterAssignments(source), technicalOnly);
}
