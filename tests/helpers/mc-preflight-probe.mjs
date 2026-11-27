// Startet die Monte-Carlo-Einstiege mit dem geladenen Datenstand und meldet das Ergebnis als JSON-Zeile:
// Worker-Init (mc-worker.js) und die gemeinsame Vorprüfung aller MC-Starts (prepareHistoricalDataOnce).
const messages = [];
globalThis.self = { postMessage: message => messages.push(message) };
const { getDataVersion, prepareHistoricalDataOnce } = await import('../../app/simulator/simulator-engine-helpers.js');
const { HISTORICAL_DATENSTAND } = await import('../../app/simulator/simulator-data.js');
await import('../../workers/mc-worker.js');
await globalThis.self.onmessage({ data: { type: 'init', jobId: 'probe', generationId: 1, scenarioKey: 'probe',
    compiledScenario: {}, dataVersion: getDataVersion() } });
const result = { stand: { endYear: HISTORICAL_DATENSTAND.endYear, contentHash: HISTORICAL_DATENSTAND.contentHash },
    worker: messages.map(message => ({ type: message.type, message: message.message ?? null })) };
try {
    prepareHistoricalDataOnce();
    result.preflight = { ok: true };
} catch (error) {
    result.preflight = { ok: false, code: error.code, causeCode: error.cause?.code ?? null, message: error.message };
}
console.log(JSON.stringify(result));
