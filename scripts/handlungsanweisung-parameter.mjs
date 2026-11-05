import { readerParameterRows } from './docs-reader-parameters.mjs';
import { CONFIG } from '../engine/config.mjs';
import { PLAN_DEFAULTS } from '../app/profile/household-plan.js';

export const ACTION_REFERENCE = 'docs/reference/HANDLUNGSANWEISUNG.md';
const strategy = ['liquidityBufferZonePercent', 'minCashBufferMonths', 'minRefillAmount',
    'minTradeAmountStatic', 'minTradeAmountDynamicFactor', 'cashRebalanceThreshold',
    'recoveryLiquidityTargetFactor', 'absoluteMinLiquidity', 'runwayGuardrailActivationPct', 'runwayCoverageMinPct'];
export function isActionOnlyParameter(key) {
    return strategy.some(name => key === `THRESHOLDS.STRATEGY.${name}`)
        || key.startsWith('SPENDING_MODEL.THREE_BUCKET.')
        || key.startsWith('ANTI_PSEUDO_ACCURACY.QUANTIZATION_TIERS.')
        || ['ANTI_PSEUDO_ACCURACY.HYSTERESIS_MIN_REFILL_AMOUNT', 'ANTI_PSEUDO_ACCURACY.METRIC_DISPLAY_ROUNDING'].includes(key);
}

export function actionParameterLeaves(config = CONFIG) {
    const leaves = [];
    const walk = (value, key) => {
        if (value !== null && typeof value === 'object') {
            const entries = Object.entries(value);
            if (!entries.length) leaves.push([key, value]);
            for (const [child, item] of entries) walk(item, `${key}.${child}`);
        } else leaves.push([key, value]);
    };
    for (const group of ['THRESHOLDS', 'SPENDING_MODEL', 'ANTI_PSEUDO_ACCURACY', 'PROFIL_MAP', 'REGIME_SMOOTHING']) walk(config[group], group);
    return leaves.filter(([key]) => isActionOnlyParameter(key) || key.startsWith('PROFIL_MAP.')
        || key.startsWith('REGIME_SMOOTHING.') || key === 'ANTI_PSEUDO_ACCURACY.ENABLED');
}

export function actionParameterAssignments(source, config = CONFIG) {
    const assignments = new Map();
    for (const match of source.matchAll(/<!--\s*docs:parameter\s+(\{[^\n]+\})\s*-->/g)) {
        const data = JSON.parse(match[1]);
        if (!Array.isArray(data.keys) || !data.target || !source.includes(`<a id="${data.target.slice(1)}"></a>`)) {
            throw new Error(`Parameterziel ohne Steckbrief: ${data.target}`);
        }
        for (const key of data.keys) {
            if (assignments.has(key)) throw new Error(`Parameter doppelt zugeordnet: ${key}`);
            assignments.set(key, data);
        }
    }
    const entries = actionParameterLeaves(config), keys = new Set(entries.map(([key]) => key));
    const missing = entries.filter(([key]) => !assignments.has(key)).map(([key]) => key);
    const obsolete = [...assignments.keys()].filter(key => !keys.has(key));
    if (missing.length || obsolete.length) throw new Error(`Parameterzuordnung fehlt oder ist veraltet: ${[...missing, ...obsolete].join(', ')}`);
    return assignments;
}

export function renderTechnicalActionParameterTable(source, config = CONFIG) {
    const assignments = actionParameterAssignments(source, config);
    const entries = actionParameterLeaves(config);
    const valueText = value => value === Infinity ? '∞' : `\`${JSON.stringify(value)}\``;
    return ['| Schlüssel in config.mjs | Wert | Verwendung und Steckbrief |', '| --- | --- | --- |',
        ...entries.map(([key, value]) => {
            const { target, status = 'aktiv' } = assignments.get(key);
            return `| \`${key}\` | ${valueText(value)} | ${status}; [${target.slice(1).toUpperCase()}](${target}) |`;
        })].join('\n');
}

export function renderActionParameterTable(source, config = CONFIG) {
    const assignments = actionParameterAssignments(source, config), specs = [];
    const add = (name, keys, unit = '') => specs.push([name, keys, unit]);
    const strategy = (name, suffixes, unit = '') => add(name, suffixes.map(k => `THRESHOLDS.STRATEGY.${k}`), unit);
    strategy('Brutto-Mindestpuffer', ['minCashBufferMonths'], 'Monate');
    strategy('Mindestauffüllung', ['minRefillAmount'], '€');
    strategy('Normaler Mindesthandel · Betrag / Anteil', ['minTradeAmountStatic', 'minTradeAmountDynamicFactor'], ['€', '%']);
    strategy('Cashumschichtung · Abweichung über', ['cashRebalanceThreshold'], '€');
    strategy('Absolute Mindestliquidität', ['absoluteMinLiquidity'], '€');
    strategy('Notauffüllung · Aktivierung unter / Zieldeckung', ['runwayGuardrailActivationPct', 'runwayCoverageMinPct'], '%');
    add('Drei Töpfe · Zielfaktor / Renditeauslöser / Auffüllschwelle', ['DEFAULT_BOND_TARGET_FACTOR', 'DEFAULT_DRAWDOWN_TRIGGER', 'DEFAULT_BOND_REFILL_THRESHOLD'].map(k => `SPENDING_MODEL.THREE_BUCKET.${k}`), ['', 'Prozent', 'Prozent']);
    add('Handelsrundung · Schalter', ['ANTI_PSEUDO_ACCURACY.ENABLED']);
    add('Hysterese · Bedarf unter', ['ANTI_PSEUDO_ACCURACY.HYSTERESIS_MIN_REFILL_AMOUNT'], '€');
    for (let i = 0; i < 4; i++) add(`Handelsstufe ${i + 1} · Betrag unter / Schritt`, ['limit', 'step'].map(k => `ANTI_PSEUDO_ACCURACY.QUANTIZATION_TIERS.${i}.${k}`), '€');
    const technicalOnly = actionParameterLeaves(config).filter(([key]) => {
        const { status = 'aktiv' } = assignments.get(key);
        return status.startsWith('ungenutzt');
    }).map(([key]) => key);
    const table = readerParameterRows(actionParameterLeaves(config), specs, assignments, technicalOnly);
    if (!table.includes('| Brutto-Mindestpuffer')) throw new Error('Parameteranker Brutto-Mindestpuffer fehlt.');
    return table.replace('| Brutto-Mindestpuffer', `| davon im Tagesgeld · Planwert | ${PLAN_DEFAULTS.liquidityCashMonths} Monate, höchstens Reichweite × 12 | [E2](#e2) |\n| Brutto-Mindestpuffer`);
}
