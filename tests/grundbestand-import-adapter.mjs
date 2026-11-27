// JD-2a, Nachtrag 2, Befund 6: Loader-Hook (node:module register) für genau zwei historische Belegtests.
// Ihre Quelltexte sind bytegenau in den Slice-15/16-Belegen festgeschrieben und vergleichen HISTORICAL_DATA und
// HISTORICAL_DATA_MANIFEST mit dem validierten Stand 1925–2025. Der Testläufer registriert diesen Hook nur für sie;
// er leitet ihren Import von simulator-data.js auf die Grundbestandssicht um. Ohne angehängtes Jahr ist die Sicht der
// Live-Stand. Den ausgelieferten Stand prüft jahresdaten-live-stand.test.mjs.
const ZIELE = Object.freeze(['backtest-data-validation-slice-14.test.mjs', 'backtest-data-validation-slice-15.test.mjs']);
const ADAPTER = new URL('./helpers/grundbestand-simulator-data.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
    if (specifier === '../app/simulator/simulator-data.js' && ZIELE.some(name => context.parentURL?.endsWith(`/tests/${name}`))) {
        return { url: ADAPTER, shortCircuit: true };
    }
    return nextResolve(specifier, context);
}
