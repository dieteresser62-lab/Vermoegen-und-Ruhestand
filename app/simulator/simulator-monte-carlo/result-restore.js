import {
    createMonteCarloUI, readMonteCarloParameters, prepareHistoricalDataOnce, getDataVersion, validateSimulatorInputs, getCommonInputs,
    personDataContextFor, normalizeWidowOptions, runMonteCarloLogsForIndices, displayMonteCarloResults, readDocumentPersonInputs, createProtocolPersonContext,
    beginOverviewRun, completeOverviewRun, readOverviewAssumptions, projectMonteCarloOverview, beginSimulationSummary
} from './execution-dependencies.js';
import { activeMonteCarloRun, monteCarloNavigationRegistration } from './state.js';
import { readRememberedMonteCarloResult, forgetMonteCarloResult, monteCarloFingerprint, monteCarloRowIndices, restoreMonteCarloRows, expandMonteCarloExport,
    showMonteCarloMemorySource, watchMonteCarloEdits } from './result-memory.js';

export const MONTE_CARLO_MEMORY_STALE = 'Letztes Ergebnis passt nicht mehr zu den Eingaben – bitte neu rechnen.';
// Dieselben Parameter wie beim Start einer Rechnung (execution.js).
const PARAMETER_KEYS = ['anzahl', 'maxDauer', 'blockSize', 'seed', 'methode', 'rngMode', 'startYearMode', 'startYearFilter', 'startYearHalfLife', 'excludeEstimatedHistory'];

/**
 * Liest die Eingaben wie beim Start einer Rechnung, ohne zu rechnen.
 * @param dependencies Testersatz für Eingaben und Parameter.
 * @returns Laufbasis mit Fingerabdruck.
 */
export function readMonteCarloRunBasis(dependencies = {}) {
    const inputs = (dependencies.validateInputs || validateSimulatorInputs)((dependencies.getInputs || getCommonInputs)());
    const raw = (dependencies.readParameters || readMonteCarloParameters)(inputs);
    validateSimulatorInputs(inputs, { horizonYears: raw.maxDauer });
    const monteCarloParams = Object.fromEntries(PARAMETER_KEYS.map(key => [key, raw[key]]));
    const widowOptions = normalizeWidowOptions(inputs.widowOptions);
    const useCapeSampling = dependencies.readUseCapeSampling
        ? dependencies.readUseCapeSampling() : globalThis.document?.getElementById('useCapeSampling')?.checked === true;
    const personDataContext = personDataContextFor(inputs);
    return { inputs, monteCarloParams, widowOptions, useCapeSampling, personDataContext,
        fingerprint: monteCarloFingerprint({ inputs, monteCarloParams, widowOptions, useCapeSampling, dataVersion: getDataVersion(), personDataContext }) };
}

/**
 * Zeigt das gemerkte Ergebnis wieder an, wenn die Eingaben gleich geblieben sind.
 * @param {{doc?: Document, dependencies?: object}} [options]
 * @returns {Promise<'none'|'stale'|'restored'>}
 */
export async function restoreMonteCarloResult({ doc = globalThis.document, dependencies = {} } = {}) {
    const entry = readRememberedMonteCarloResult();
    if (!entry || activeMonteCarloRun) return 'none';
    // Jeder Laufstart erhöht die Revision; auch ein sofort gescheiterter Start hat dann Vorrang.
    const revision = monteCarloNavigationRegistration()?.revision;
    const overtaken = () => Boolean(activeMonteCarloRun) || monteCarloNavigationRegistration()?.revision !== revision;
    await (dependencies.prepareHistoricalData || prepareHistoricalDataOnce)();
    if (overtaken()) return 'none';
    let basis = null;
    try { basis = readMonteCarloRunBasis(dependencies); } catch { basis = null; }
    if (!basis || basis.fingerprint !== entry.fingerprint) {
        forgetMonteCarloResult();
        showMonteCarloMemorySource(doc, MONTE_CARLO_MEMORY_STALE);
        return 'stale';
    }
    const { inputs, monteCarloParams, widowOptions, useCapeSampling } = basis;
    const logsByIndex = await (dependencies.runLogsForIndices || runMonteCarloLogsForIndices)({ inputs, widowOptions, monteCarloParams,
        useCapeSampling, runIndices: monteCarloRowIndices(entry.display), generationId: 'monte-carlo-restore', signal: null });
    // Eine inzwischen gestartete oder fertige Rechnung hat Vorrang.
    if (overtaken() || readRememberedMonteCarloResult()?.savedAt !== entry.savedAt) return 'none';
    const restored = restoreMonteCarloRows(entry.display, logsByIndex);
    // Namen wie beim Laufbeginn aus der Seite, damit eine Umbenennung nicht mit altem Namen erscheint.
    const personEntries = readDocumentPersonInputs()?.entries || [];
    const display = { ...restored, displayContext: { ...restored.displayContext, personDisplayContext: createProtocolPersonContext(inputs,
        (basis.personDataContext?.persons || []).map(person => personEntries.find(item => item.profileId === person.profileId))) } };
    // Wie beim Laufbeginn: Werkstatt-Herkunft an die Eingaben binden (schreibt nichts), damit Stress-Replay den Beleg führt.
    (dependencies.beginSimulationSummary || beginSimulationSummary)('montecarlo', inputs, { ...monteCarloParams, useCapeSampling });
    (dependencies.displayResults || displayMonteCarloResults)(display.aggregatedResults, display.anzahl, display.failCount, display.worstRun,
        {}, {}, display.pflegeTriggeredCount, inputs, display.worstRunCare, display.scenarioLogs, display.displayContext);
    (dependencies.createUI || createMonteCarloUI)().publishRunExport(expandMonteCarloExport(entry.exportDownload));
    const registration = monteCarloNavigationRegistration();
    if (registration) {
        registration.resultAvailable = true;
        registration.resultRemembered = true;
        registration.revision++;
        registration.notify();
    }
    // Übersicht und Planblatt kennen danach denselben Lauf wie die Ergebnisanzeige.
    const token = (dependencies.beginOverviewRun || beginOverviewRun)('montecarlo',
        readOverviewAssumptions('montecarlo', inputs, { ...monteCarloParams, useCapeSampling }),
        { startedAt: entry.startedAt || entry.savedAt, generationId: 'monte-carlo-restore' });
    if (token) completeOverviewRun('montecarlo', token, projectMonteCarloOverview(display.aggregatedResults, display.anzahl, display.failCount, inputs));
    const saved = new Date(entry.savedAt), time = saved.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    const when = saved.toDateString() === new Date().toDateString() ? `von ${time}`
        : `vom ${saved.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} ${time}`;
    showMonteCarloMemorySource(doc, `Ergebnis ${when} · Eingaben unverändert`);
    watchMonteCarloEdits(doc, registration);
    return 'restored';
}
