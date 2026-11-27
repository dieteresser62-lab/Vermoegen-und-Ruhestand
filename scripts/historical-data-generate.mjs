#!/usr/bin/env node
/**
 * Module: Historical Data Generate
 * Purpose: Erzeugt aus den sechs Ketten-Ausgaben (app/simulator/*-chain.js, gebaut aus den
 *          Originalen unter data/historical/) zwei Laufzeitmodule:
 *          - app/simulator/historical-data-records.js: HISTORICAL_DATA, ein Eintrag je Jahr
 *          - app/simulator/historical-datenstand.js: Zeitraum, Revision, Inhaltshash,
 *            Regimezählung und die Inventar-Hashes, die vom Datenumfang abhängen
 *          Außerdem trägt es das Endjahr in Simulator.html ein (Maximum des Schiebers „Startjahr ab“,
 *          Vorgabe des Backtest-Endjahrs), damit kein Bereichsfeld beim Laden ohne Maximum klemmt.
 *          Startjahr, Endjahr und Revision liest das Skript aus dem bestehenden Datenstand; die
 *          Datenübernahme (npm run jahresdaten -- <Jahr> --uebernehmen) setzt Endjahr und Revision
 *          mit --endjahr und --revision. Je Kette hält der Datenstand die angehängten Jahreslieferungen
 *          mit SHA-256 fest (`lieferungen`); `rawDataHash` bleibt der Hash über die Originale.
 *          Die Schleife über die Jahre läuft hier, nicht zur Laufzeit. Fehlt einer Kette ein
 *          Jahr bis zum Endjahr, bricht das Skript ab; spätere Jahre bleiben mit Hinweis außen vor.
 * Usage: node scripts/historical-data-generate.mjs [--verify-only] [--endjahr <Jahr>] [--revision <Revision>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { computeHistoricalDatasetHash } from '../app/simulator/historical-backtest-contract.js';
import { computeSimulationDataValueHash } from '../app/simulator/simulation-data-inventory.js';
import { buildRegimeClassificationThresholds, deriveHistoricalAnnualData, REGIME_CLASSIFICATION_THRESHOLDS } from '../app/simulator/simulator-data.js';
import {
    buildMonteCarloParameterLimits,
    MONTE_CARLO_RNG_MODES,
    MONTE_CARLO_SAMPLING_METHODS,
    MONTE_CARLO_START_YEAR_MODES
} from '../app/simulator/monte-carlo-parameters.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = 'scripts/historical-data-generate.mjs';
export const DATENSTAND_PATH = 'app/simulator/historical-datenstand.js';
export const RECORDS_PATH = 'app/simulator/historical-data-records.js';
export const SIMULATOR_HTML_PATH = 'Simulator.html';
/** Jahresattribute in Simulator.html, die dem Endjahr des Datenstands folgen. */
const SIMULATOR_YEAR_ATTRIBUTES = Object.freeze([
    Object.freeze({ label: 'Maximum des Schiebers „Startjahr ab“', pattern: /(<input type="range" id="mcStartYearFilter" min="\d{4}" max=")(\d{4})(")/ }),
    Object.freeze({ label: 'Vorgabe des Backtest-Endjahrs', pattern: /(id="simEndJahr" value=")(\d{4})(")/ })
]);
export const DATENSTAND_SCHEMA_VERSION = 'HistoricalDatenstandV1';

/** Die sechs Ketten in der Feldreihenfolge der Jahressätze; `chain` nennt das Kettenobjekt mit dem Rohdaten-Hash. */
export const HISTORICAL_CHAIN_SERIES = Object.freeze([
    Object.freeze({ seriesId: 'global_equity_research_index', label: 'Aktien', module: 'global-equity-research-chain.js',
        exportName: 'GLOBAL_EQUITY_RESEARCH_INDEX_LEVELS', chain: 'GLOBAL_EQUITY_RESEARCH_CHAIN' }),
    Object.freeze({ seriesId: 'inflation_de', label: 'Inflation', module: 'german-cpi-chain.js',
        exportName: 'GERMAN_CPI_INFLATION_RATES', chain: 'GERMAN_CPI_RESEARCH_CHAIN' }),
    Object.freeze({ seriesId: 'zinssatz_de', label: 'Geldmarkt', module: 'german-cash-money-market-chain.js',
        exportName: 'GERMAN_CASH_MONEY_MARKET_ANNUAL_RETURNS', chain: 'GERMAN_CASH_MONEY_MARKET_CHAIN' }),
    Object.freeze({ seriesId: 'lohn_de', label: 'Lohn', module: 'german-gross-wage-growth-chain.js',
        exportName: 'GERMAN_GROSS_WAGE_GROWTH_PCT', chain: 'GERMAN_GROSS_WAGE_GROWTH_CHAIN' }),
    Object.freeze({ seriesId: 'gold_eur_perf', label: 'Gold', module: 'gold-german-investor-chain.js',
        exportName: 'GOLD_GERMAN_INVESTOR_ANNUAL_RETURNS', chain: 'GOLD_GERMAN_INVESTOR_CHAIN' }),
    Object.freeze({ seriesId: 'cape', label: 'CAPE', module: 'us-shiller-cape-chain.js',
        exportName: 'US_SHILLER_CAPE_BY_RETURN_YEAR', chain: 'US_SHILLER_CAPE_CHAIN' })
]);
/** Die Aktienkette liefert zusätzlich die Jahresrendite, aus der Laufzeit und Regimezählung rechnen. */
export const EQUITY_RETURN_SERIES = Object.freeze({ label: 'Aktien (Jahresrendite)', module: 'global-equity-research-chain.js',
    exportName: 'GLOBAL_EQUITY_RESEARCH_ANNUAL_RETURNS' });

export class HistoricalDataGenerationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HistoricalDataGenerationError';
        this.code = 'HISTORICAL_DATA_GENERATION_FAILED';
    }
}

/**
 * Liest die Ketten-Ausgaben aus app/simulator.
 * @param {string} [root] Projektwurzel.
 * @returns {Promise<{series: Record<string, {values: Record<string, number>, rawDataHash: string,
 *   lieferungen: {jahr: number, sha256: string}[]}>, equityReturns: Record<string, number>}>}
 */
export async function loadHistoricalChains(root = ROOT) {
    const load = file => import(pathToFileURL(path.join(root, 'app/simulator', file)).href);
    const series = {};
    for (const spec of HISTORICAL_CHAIN_SERIES) {
        const module = await load(spec.module);
        const chain = module[spec.chain];
        const lieferungen = (chain?.fortschreibung?.lieferungen ?? []).map(({ jahr, sha256 }) => ({ jahr, sha256 }));
        series[spec.seriesId] = { values: module[spec.exportName], rawDataHash: chain?.rawDataHash ?? chain?.hashes?.rawDataHash, lieferungen };
    }
    const equityReturns = (await load(EQUITY_RETURN_SERIES.module))[EQUITY_RETURN_SERIES.exportName];
    return { series, equityReturns };
}

function requireYearRange(startYear, endYear) {
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear > endYear) {
        throw new HistoricalDataGenerationError(`Datenstand: Start- und Endjahr müssen ganze Jahre sein (${startYear}–${endYear}).`);
    }
}

function checkChain(values, { label, exportName }, startYear, endYear, notes) {
    if (!values || typeof values !== 'object') {
        throw new HistoricalDataGenerationError(`Kette ${label} (${exportName}) fehlt.`);
    }
    for (let year = startYear; year <= endYear; year++) {
        if (!Number.isFinite(values[year])) {
            throw new HistoricalDataGenerationError(`Kette ${label} (${exportName}) liefert für ${year} keinen Wert; der Datenstand reicht bis ${endYear}.`);
        }
    }
    const later = Object.keys(values).map(Number).filter(year => Number.isInteger(year) && year > endYear).sort((a, b) => a - b);
    if (later.length) {
        notes.push(`Hinweis: Kette ${label} (${exportName}) liefert ${later.join(', ')}; diese Jahre bleiben unberücksichtigt, bis der Datenstand sein Endjahr ${endYear} anhebt.`);
    }
}

/**
 * Baut die Jahressätze aus den Ketten; bricht ab, wenn ein Wert bis zum Endjahr fehlt.
 * @param {Awaited<ReturnType<typeof loadHistoricalChains>>} chains
 * @param {{startYear: number, endYear: number}} period
 * @returns {{records: Record<string, Record<string, number>>, notes: string[]}}
 */
export function buildHistoricalRecords(chains, { startYear, endYear }) {
    requireYearRange(startYear, endYear);
    const notes = [];
    for (const spec of HISTORICAL_CHAIN_SERIES) checkChain(chains.series?.[spec.seriesId]?.values, spec, startYear, endYear, notes);
    checkChain(chains.equityReturns, EQUITY_RETURN_SERIES, startYear, endYear, notes);
    const records = {};
    for (let year = startYear; year <= endYear; year++) {
        records[year] = Object.fromEntries(HISTORICAL_CHAIN_SERIES.map(spec => [spec.seriesId, chains.series[spec.seriesId].values[year]]));
    }
    return { records, notes };
}

/**
 * Rechnet den Datenstand zu den Jahressätzen: Inhaltshash, Regimezählung und Inventar-Hashes.
 * @param {{records: Record<string, Record<string, number>>, chains: Awaited<ReturnType<typeof loadHistoricalChains>>,
 *   startYear: number, endYear: number, revision: string}} input
 */
export function buildHistoricalDatenstand({ records, chains, startYear, endYear, revision }) {
    requireYearRange(startYear, endYear);
    if (typeof revision !== 'string' || revision.trim() === '') {
        throw new HistoricalDataGenerationError('Datenstand: Die Revision fehlt.');
    }
    const derived = deriveHistoricalAnnualData(records, chains.equityReturns);
    const labels = REGIME_CLASSIFICATION_THRESHOLDS.labels;
    const regimeDistribution = { observationCount: derived.annualData.length,
        ...Object.fromEntries(labels.map(label => [label, derived.regimeData[label].length])) };
    const seriesHashes = {};
    for (const { seriesId } of HISTORICAL_CHAIN_SERIES) {
        const rawDataHash = chains.series[seriesId].rawDataHash;
        if (typeof rawDataHash !== 'string' || !/^[a-f0-9]{64}$/.test(rawDataHash)) {
            throw new HistoricalDataGenerationError(`Kette ${seriesId}: Der Rohdaten-Hash fehlt.`);
        }
        const projection = Object.fromEntries(Object.entries(records).map(([year, row]) => [year, row[seriesId]]));
        const lieferungen = (chains.series[seriesId].lieferungen ?? []).filter(({ jahr }) => jahr >= startYear && jahr <= endYear);
        seriesHashes[seriesId] = { rawDataHash, embeddedValueHash: computeSimulationDataValueHash(projection), lieferungen };
    }
    const policyHashes = {
        regime_classification_thresholds: computeSimulationDataValueHash(buildRegimeClassificationThresholds({ regimeDistribution })),
        regime_transition_matrix: computeSimulationDataValueHash(derived.regimeTransitions),
        monte_carlo_defaults: computeSimulationDataValueHash({
            limits: buildMonteCarloParameterLimits({ startYear, endYear }),
            samplingMethods: MONTE_CARLO_SAMPLING_METHODS,
            rngModes: MONTE_CARLO_RNG_MODES,
            startYearModes: MONTE_CARLO_START_YEAR_MODES
        })
    };
    return {
        schemaVersion: DATENSTAND_SCHEMA_VERSION,
        startYear,
        endYear,
        revision,
        contentHash: computeHistoricalDatasetHash(records),
        regimeDistribution,
        seriesHashes,
        policyHashes
    };
}

function frozenLiteral(value, depth = 0) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const indent = '    '.repeat(depth + 1), closing = '    '.repeat(depth);
    if (Array.isArray(value)) {
        if (!value.length) return 'Object.freeze([])';
        return `Object.freeze([\n${value.map(child => `${indent}${frozenLiteral(child, depth + 1)}`).join(',\n')}\n${closing}])`;
    }
    const entries = Object.entries(value).map(([key, child]) =>
        `${indent}${/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key)}: ${frozenLiteral(child, depth + 1)}`);
    return `Object.freeze({\n${entries.join(',\n')}\n${closing}})`;
}

/** @param {ReturnType<typeof buildHistoricalDatenstand>} datenstand @returns {string} */
export function renderDatenstandModule(datenstand) {
    return `/**
 * Erzeugt von ${GENERATOR} – nicht von Hand ändern.
 *
 * Datenstand der historischen Reihen ${datenstand.startYear}–${datenstand.endYear}: Zeitraum, Revision, Inhaltshash von
 * HISTORICAL_DATA, geprüfte Regimezählung und die Inventar-Hashes, die vom Datenumfang abhängen.
 * Endjahr und Revision bestimmt die Datenübernahme; alle übrigen Werte rechnet der Generator.
 */
export default ${frozenLiteral(datenstand)};
`;
}

/** @param {{startYear: number, endYear: number}} period @returns {string} */
export function renderHistoricalRecordsModule({ startYear, endYear }) {
    requireYearRange(startYear, endYear);
    const imports = HISTORICAL_CHAIN_SERIES.map(spec => `import { ${spec.exportName} } from './${spec.module}';`).join('\n');
    const rows = [];
    for (let year = startYear; year <= endYear; year++) {
        rows.push(`  ${year}: { ${HISTORICAL_CHAIN_SERIES.map(spec => `${spec.seriesId}: ${spec.exportName}[${year}]`).join(', ')} }`);
    }
    return `/**
 * Erzeugt von ${GENERATOR} – nicht von Hand ändern.
 *
 * Historische Jahressätze ${startYear}–${endYear} aus den sechs Ketten-Ausgaben, ein Eintrag je Jahr.
 * Zeitraum und Inhaltshash stehen im Datenstand (historical-datenstand.js).
 */
"use strict";

${imports}

export const HISTORICAL_DATA = {
${rows.join(',\n')}
};
`;
}

/**
 * Trägt das Endjahr in die Jahresattribute von Simulator.html ein; jedes Attribut muss genau einmal vorkommen.
 * @param {string} html @param {{endYear: number}} period @returns {string}
 */
export function renderSimulatorHtmlYears(html, { endYear }) {
    let output = html;
    for (const { label, pattern } of SIMULATOR_YEAR_ATTRIBUTES) {
        const count = (output.match(new RegExp(pattern.source, 'g')) || []).length;
        if (count !== 1) throw new HistoricalDataGenerationError(`${SIMULATOR_HTML_PATH}: ${label} kommt ${count}-mal statt einmal vor.`);
        output = output.replace(pattern, `$1${endYear}$3`);
    }
    return output;
}

/**
 * Erzeugt Jahressätze, Datenstand und beide Modultexte; mit `simulatorHtml` auch die Jahresattribute der Simulatorseite.
 * @param {{chains: Awaited<ReturnType<typeof loadHistoricalChains>>, startYear: number, endYear: number, revision: string, simulatorHtml?: string}} input
 */
export function generateHistoricalData({ chains, startYear, endYear, revision, simulatorHtml }) {
    const { records, notes } = buildHistoricalRecords(chains, { startYear, endYear });
    const datenstand = buildHistoricalDatenstand({ records, chains, startYear, endYear, revision });
    return {
        records,
        datenstand,
        notes,
        files: {
            [DATENSTAND_PATH]: renderDatenstandModule(datenstand),
            [RECORDS_PATH]: renderHistoricalRecordsModule({ startYear, endYear }),
            ...(typeof simulatorHtml === 'string' ? { [SIMULATOR_HTML_PATH]: renderSimulatorHtmlYears(simulatorHtml, { endYear }) } : {})
        }
    };
}

/**
 * Liest den bestehenden Datenstand und erzeugt daraus die Module neu; Endjahr und Revision lassen sich setzen.
 * @param {string} [root] Projektwurzel.
 * @param {{endYear?: number, revision?: string}} [settings] Neues Endjahr bzw. neue Revision (Datenübernahme).
 */
export async function generateFromRepository(root = ROOT, settings = {}) {
    const { default: current } = await import(pathToFileURL(path.join(root, DATENSTAND_PATH)).href);
    const chains = await loadHistoricalChains(root);
    const simulatorHtml = readFileSync(path.join(root, SIMULATOR_HTML_PATH), 'utf8');
    return generateHistoricalData({ chains, startYear: current.startYear, endYear: settings.endYear ?? current.endYear,
        revision: settings.revision ?? current.revision, simulatorHtml });
}

/** @param {string[]} args @returns {{endYear?: number, revision?: string}} */
export function parseGeneratorSettings(args) {
    const settings = {};
    const value = flag => {
        const index = args.indexOf(flag);
        if (index < 0) return undefined;
        const next = args[index + 1];
        if (next === undefined || next.startsWith('--')) throw new HistoricalDataGenerationError(`${flag} braucht einen Wert.`);
        return next;
    };
    const endYear = value('--endjahr');
    const revision = value('--revision');
    if (endYear !== undefined) {
        if (!/^\d{4}$/.test(endYear)) throw new HistoricalDataGenerationError(`--endjahr ${endYear} ist kein Jahr.`);
        settings.endYear = Number(endYear);
    }
    if (revision !== undefined) settings.revision = revision;
    return settings;
}

async function main() {
    const verifyOnly = process.argv.includes('--verify-only');
    const result = await generateFromRepository(ROOT, parseGeneratorSettings(process.argv.slice(2)));
    for (const note of result.notes) console.log(note);
    const changed = Object.entries(result.files).filter(([file, text]) => {
        try { return readFileSync(path.join(ROOT, file), 'utf8') !== text; } catch { return true; }
    });
    const { startYear, endYear, revision, contentHash } = result.datenstand;
    if (verifyOnly) {
        if (changed.length) {
            console.error(`Nicht aktuell: ${changed.map(([file]) => file).join(', ')}. Bitte node ${GENERATOR} ausführen.`);
            process.exitCode = 1;
            return;
        }
        console.log(`Geprüft: historische Daten ${startYear}–${endYear}, Revision ${revision}, Inhaltshash ${contentHash}`);
        return;
    }
    for (const [file, text] of changed) writeFileSync(path.join(ROOT, file), text);
    console.log(`${changed.length ? `Geschrieben: ${changed.map(([file]) => file).join(', ')}` : 'Unverändert'}; historische Daten ${startYear}–${endYear}, Revision ${revision}, Inhaltshash ${contentHash}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(error instanceof HistoricalDataGenerationError ? `Abbruch: ${error.message}` : error);
        process.exitCode = 1;
    });
}
