import { buildMonteCarloRunHint, renderMonteCarloRunHint, recordMonteCarloHintMeasurement, getMonteCarloHintMeasurement } from '../app/simulator/monte-carlo-run-hint.js';
import { calculateWilson95Interval } from '../app/simulator/monte-carlo-statistics.js';
import { initMonteCarloResourceControls, createMonteCarloUI } from '../app/simulator/monte-carlo-ui.js';
import { runMonteCarlo } from '../app/simulator/simulator-monte-carlo.js';
for (const runs of [99999, 100000, 999999, 1000000]) {
    const model = buildMonteCarloRunHint({ runs, years: 35 });
    assertEqual(model.visible, runs >= 100000, 'Hinweisschwelle');
    if (model.visible) {
        assertEqual(model.severe, runs >= 1000000, 'Verstärkte Millionenschwelle');
        assertEqual(model.durationMs, null, 'Ohne Messdaten keine erfundene Dauer');
        assert(renderMonteCarloRunHint(model).includes('50-%-Grundlage'), 'Unbekannter Erfolgsanteil sichtbar');
    }
}
for (const runs of [0, -1, 1000001, 100000.5, NaN, Infinity, null, '', '1e5']) assertEqual(buildMonteCarloRunHint({ runs, years: 35 }).valid, false, 'Ungültige Eingaben');
for (const ratio of [0, 0.5, 1]) {
    const model = buildMonteCarloRunHint({ runs: 100000, years: 35, successRatio: ratio });
    assertEqual(JSON.stringify(model.estimates[1].confidenceInterval95), JSON.stringify(calculateWilson95Interval(ratio * 100000, 100000)), 'Bestehender Wilsonvertrag einschließlich 0/100 %');
}
for (const years of [0, 111, NaN, Infinity, null, '']) assertEqual(buildMonteCarloRunHint({ runs: 100000, years }).valid, false, 'Ungültiger Horizont');
const doc = {};
const measurement = { completed: true, runs: 10000, years: 35, elapsedMs: 20000, comparableKey: 'same' };
recordMonteCarloHintMeasurement(doc, measurement);
recordMonteCarloHintMeasurement(doc, { ...measurement, completed: false, elapsedMs: 1 });
assertEqual(getMonteCarloHintMeasurement(doc).elapsedMs, 20000, 'Abbruch/Fehler überschreibt Messgrundlage nicht');
assertEqual(buildMonteCarloRunHint({ runs: 100000, years: 70, measurement, comparableKey: 'same' }).durationMs, 400000, 'Dauer nach Run-Jahren skalieren');
assertEqual(buildMonteCarloRunHint({ runs: 100000, years: 35, measurement, comparableKey: 'changed' }).durationMs, null, 'Unvergleichbare Eingaben geben unbekannte Dauer');
assert(renderMonteCarloRunHint(buildMonteCarloRunHint({ runs: 100000, years: 35 })).includes('übrigen Ergebnisdaten wachsen'), 'Speicheraussage nur Zusatzaggregator');

class Element {
    constructor() { this.value = ''; this.dataset = {}; this.style = {}; this.listeners = new Map(); this.disabled = false; this.checked = false; }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
    removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
    dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler(event); }
    click() { if (!this.disabled) { this.dispatchEvent(new Event('click')); this.onclick?.(); } }
    setAttribute() {} removeAttribute() {} focus() {} querySelectorAll() { return []; }
}
{
    const savedDocument = globalThis.document, savedConsole = console.error;
    const ids = ['mcAnzahl', 'mcDauer', 'mcResourceEstimate', 'mcLargeRunConfirm', 'mcLargeRunConfirmationRow',
        'mcRunHint', 'mcRunHintContent', 'mcRunHintStart', 'mcRunHintReset', 'mcButton',
        'mc-progress-bar-container', 'mc-progress-bar', 'mc-error-container', 'mc-error-message'];
    const hosts = Object.fromEntries(ids.map(id => [id, new Element()]));
    const documentRef = { getElementById: id => hosts[id] || null, addEventListener() {} };
    let controllers = 0, preparations = 0, lastPromise, release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
        globalThis.document = documentRef; console.error = () => {};
        hosts.mcAnzahl.value = '1000000'; hosts.mcDauer.value = '35';
        hosts.mcButton.onclick = () => {
            lastPromise = runMonteCarlo({ createUI: () => { controllers++; return createMonteCarloUI(); },
                prepareHistoricalData: async () => { preparations++; await gate; throw new Error('Kontrollierter Fehler'); } });
        };
        initMonteCarloResourceControls(); initMonteCarloResourceControls();
        assertEqual(hosts.mcRunHintStart.listeners.get('click').size, 1, 'Wiederholtes Rendern bindet Hinweisknopf einmal');
        assertEqual(hosts.mcAnzahl.listeners.get('input').size, 1, 'Ein Inputbinder');
        assertEqual(hosts.mcRunHintStart.textContent, 'Trotzdem rechnen', 'Millionenvariante');
        hosts.mcRunHintStart.click(); hosts.mcRunHintStart.click();
        await Promise.resolve(); await Promise.resolve();
        assertEqual(controllers, 1, 'Hinweis-Doppelklick erzeugt einen kanonischen Controller');
        assertEqual(preparations, 1, 'Derselbe kanonische Vorbereitungsweg');
        assertEqual(hosts.mcLargeRunConfirm.checked, true, 'Bewusster Hinweisklick erfüllt Großlaufbestätigung');
        assert(hosts.mcRunHintStart.disabled && hosts.mcRunHintReset.disabled, 'Beide Knöpfe während Lauf gesperrt');
        hosts.mcRunHintReset.click();
        assertEqual(hosts.mcAnzahl.value, '1000000', 'Reset während Lauf schreibt nichts');
        release(); await lastPromise;
        assert(!hosts.mcRunHintStart.disabled && !hosts.mcRunHintReset.disabled, 'Fehlerabschluss gibt Knöpfe frei');
        hosts.mcRunHintReset.click();
        assertEqual(hosts.mcAnzahl.value, '10000', 'Reset setzt nur Laufzahl');
        assertEqual(hosts.mcDauer.value, '35', 'Reset erhält Dauer');
        assertEqual(controllers, 1, 'Reset startet keinen Lauf');
        assertEqual(hosts.mcRunHint.hidden, true, 'Hinweis nach Reset verborgen');
        hosts.mcAnzahl.value = '1000001'; hosts.mcAnzahl.dispatchEvent(new Event('input'));
        hosts.mcRunHintStart.click();
        assertEqual(controllers, 1, 'Hartes Maximum unverändert');
        const documentAUI = createMonteCarloUI();
        documentAUI.beginRun();
        const foreignStart = new Element(), foreignReset = new Element();
        foreignStart.disabled = true; foreignReset.disabled = true;
        globalThis.document = { getElementById: id => id === 'mcRunHintStart' ? foreignStart : id === 'mcRunHintReset' ? foreignReset : null };
        documentAUI.finishRun();
        assert(foreignStart.disabled && foreignReset.disabled, 'UI-Abschluss schreibt nicht in Hinweise eines anderen Dokuments');
        assert(!hosts.mcRunHintStart.disabled && !hosts.mcRunHintReset.disabled, 'UI-Abschluss gehört zu seinem ursprünglichen Dokument');
    } finally { release(); globalThis.document = savedDocument; console.error = savedConsole; }
}
