// MC-3 (Nutzer 16.11.2026): Beispielhaushalte im Spielbereich rechnen vorbelegt mit 2.000 Läufen, alles andere mit 10.000; eine gespeicherte
// Eingabe bleibt. Das Ausgaben-ⓘ nennt eine entfallene Einmalausgabe in ihrer Zeile mit dem bezahlten Betrag und darunter eingerückt
// „geplant“ und „davon entfällt“ (OP-1 Punkt 4). Nur Beispielhaushalte und erfundene Beträge.
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { initializeProbelaufPage } from '../app/shared/probelauf-state.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { monteCarloDefaultRuns, documentMonteCarloDefaultRuns } from '../app/simulator/monte-carlo-run-default.js';
import { buildMonteCarloRunHint, renderMonteCarloRunHint } from '../app/simulator/monte-carlo-run-hint.js';
import { calculateWilson95Interval } from '../app/simulator/monte-carlo-statistics.js';
import { initMonteCarloResourceControls } from '../app/simulator/monte-carlo-ui.js';
import { protocolCashflowBreakdown } from '../app/simulator/protocol-cashflows.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { couple, plainYear } from './helpers/nk-1b-cases.mjs';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { simulatorDocument } from './simulator-page-fixture.mjs';

// Vorgabe nur mit Quelle „demo“; „Kopie meiner Daten“ und eigene Daten bleiben bei 10.000.
assertEqual([monteCarloDefaultRuns('demo'), monteCarloDefaultRuns('copy'), monteCarloDefaultRuns(undefined)].join('/'), '2000/10000/10000',
    'Vorgabe 2.000 nur im Beispielhaushalt');
const controller = (source, phase = 'active') => () => source === null ? undefined : { state: { source, phase } };
assertEqual(['demo', 'copy', null].map(source => documentMonteCarloDefaultRuns({}, controller(source))).join('/'), '2000/10000/10000',
    'Seite liest die Quelle aus dem bestätigten Spielbereich');
assertEqual(documentMonteCarloDefaultRuns({}, controller('demo', 'starting')), 10000, 'Ein unvollständiger Spielbereich liefert die normale Vorgabe');

// Formularweg mit Beispielhaushalt: leer → Vorgabe ohne Speichern; gespeicherte Zahl (auch 10.000) bleibt.
const previous = { window: globalThis.window, document: globalThis.document };
try {
    for (const [stored, runsDefault, expected, label] of [[null, 2000, '2000', 'Beispielhaushalt ohne Eingabe'],
        ['10000', 2000, '10000', 'Beispielhaushalt mit gespeicherter 10.000'], ['3000', 2000, '3000', 'Beispielhaushalt mit eigener Zahl'],
        [null, 10000, '10000', 'Kopie meiner Daten ohne Eingabe']]) {
        const records = createMusterHaushaltRecords('2026-10-16', 'max-erika');
        if (stored !== null) records.sim_mcAnzahl = stored;
        PersistenceFacade.resetPersistenceForTests({ name: 'MC-3', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() {} });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        globalThis.document = simulatorDocument();
        globalThis.window = { addEventListener() {}, removeEventListener() {} };
        initInputPersistence({ monteCarloDefaultRuns: runsDefault });
        assertEqual(document.getElementById('mcAnzahl').value, expected, `${label}: Laufzahl im Feld`);
        assertEqual(PersistenceFacade.getItemSync('sim_mcAnzahl'), stored, `${label}: gespeicherter Wert unverändert`);
    }
} finally { globalThis.window = previous.window; globalThis.document = previous.document; }

// Hinweis „viele Läufe“: Vergleichsintervall und Beschriftung kommen aus derselben Vorgabe, bei gleicher Erfolgsannahme.
for (const defaultRuns of [2000, 10000]) {
    const model = buildMonteCarloRunHint({ runs: 100000, years: 35, successRatio: 0.9, defaultRuns });
    assertEqual(JSON.stringify(model.estimates[0].confidenceInterval95), JSON.stringify(calculateWilson95Interval(0.9 * defaultRuns, defaultRuns)),
        `Vergleichsintervall bei ${defaultRuns} Läufen`);
    assertEqual(JSON.stringify(model.estimates[1].confidenceInterval95), JSON.stringify(calculateWilson95Interval(90000, 100000)),
        `Intervall der gewählten Laufzahl unabhängig von der Vorgabe (${defaultRuns})`);
    assert(renderMonteCarloRunHint(model).includes(`bei ${defaultRuns.toLocaleString('de-DE')} Läufen `), `Beschriftung nennt ${defaultRuns} Läufe`);
}
assertEqual(buildMonteCarloRunHint({ runs: 100000, years: 35 }).defaultRuns, 10000, 'Ohne Angabe bleibt die Vergleichsbasis 10.000');

// Zurück-Knopf je Fall: Text und gesetzte Zahl.
class Element {
    constructor() { this.value = ''; this.dataset = {}; this.style = {}; this.listeners = new Map(); this.disabled = false; this.checked = false; this.textContent = ''; }
    addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(handler); }
    dispatchEvent(event) { for (const handler of this.listeners.get(event.type) || []) handler(event); }
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
{
    const savedDocument = globalThis.document;
    try {
        const fixture = await playFixture();
        const initial = await fixture.boot();
        await initial.start(async () => ({ source: 'demo', householdId: 'max-erika', testDate: '2026-10-16' }));
        await fixture.boot();
        for (const [defaultRuns, text, value] of [[2000, 'Auf 2.000 Läufe zurück', '2000'], [10000, 'Auf 10.000 Läufe zurück', '10000']]) {
            const hosts = Object.fromEntries(['mcAnzahl', 'mcDauer', 'mcResourceEstimate', 'mcRunHint', 'mcRunHintContent', 'mcRunHintStart',
                'mcRunHintReset', 'mcButton'].map(id => [id, new Element()]));
            globalThis.document = { getElementById: id => hosts[id] || null, addEventListener() {} };
            hosts.mcAnzahl.value = '100000'; hosts.mcDauer.value = '35';
            const pageController = defaultRuns === 2000
                ? await initializeProbelaufPage({ doc: globalThis.document, win: fixture.win }) : null;
            initMonteCarloResourceControls();
            assertEqual(hosts.mcRunHintReset.textContent, text, `Knopftext bei Vorgabe ${defaultRuns}`);
            assert(hosts.mcRunHintContent.innerHTML.includes(`bei ${defaultRuns.toLocaleString('de-DE')} Läufen `), `Hinweis vergleicht mit ${defaultRuns}`);
            hosts.mcRunHintReset.click();
            assertEqual(hosts.mcAnzahl.value, value, `Zurück setzt ${value}`);
            assertEqual(hosts.mcRunHint.hidden, true, `Hinweis nach Zurück verborgen (${defaultRuns})`);
            const estimate = hosts.mcResourceEstimate.textContent;
            hosts.mcAnzahl.value = '';
            hosts.mcAnzahl.dispatchEvent(new Event('input'));
            assertEqual(hosts.mcResourceEstimate.textContent, estimate, 'Leeres Feld hat dieselbe Kostenschätzung wie die eingetragene Vorgabe');
            if (pageController) {
                pageController.invalidate();
                assertEqual(documentMonteCarloDefaultRuns(globalThis.document), 10000, 'Nach Sperre liefert der Seitenkoordinator die normale Vorgabe');
            }
        }
    } finally { globalThis.document = savedDocument; PersistenceFacade.resetPersistenceForTests(); }
}

// Ausgaben-ⓘ eines Jahres mit entfallener Einmalausgabe (Engine-Lauf wie NK-3 „Ohne Heim“): Nach dem Grundbedarf bleiben 8.000 €.
// Die Brille (März, 2.000 €) wird bezahlt, der Umbau (Juni, 10.000 €) entfällt ganz.
{
    const inputs = Object.assign(couple({ cash: [16000, 4000], floor: 12000 }), { plannedExpensesReferenceYear: 2026, plannedExpenses: [
        { id: 'brille', monat: '2026-03', betrag: 2000, bezeichnung: 'Brille' },
        { id: 'umbau', monat: '2026-06', betrag: 10000, bezeichnung: 'Umbau' }] });
    const log = plainYear(inputs).logData;
    assertEqual(`${log.geplante_ausgaben} · ${log.geplante_ausgaben_gekuerzt}`, '2000 · 10000', 'Lauf: Brille bezahlt, Umbau entfällt');
    const entry = { ...log, jahr: 1, inflation_factor_cum: 1, inflation: 0 };
    const options = { source: 'mc', inputs, moneyBasis: 'nominal', logDetailLevel: 'normal', rows: [entry] };
    const breakdown = protocolCashflowBreakdown(entry, options);
    // OP-1 (Punkt 4): Die Zeile des entfallenen Postens zeigt den bezahlten Betrag (0 €), darunter eingerückt „geplant“ und „davon entfällt“.
    const planned = breakdown.expenses.filter(item => /Geplante Ausgabe|geplant|entfällt/.test(item.label));
    assertEqual(planned.map(item => `${item.label}:${item.amount}${item.detail ? ':eingerückt' : ''}`).join('|'),
        'Geplante Ausgaben (Brille):2000|Geplante Ausgaben (Umbau):0|geplant:10000:eingerückt|davon entfällt:-10000:eingerückt',
        'OP-1 Punkt 4: entfallener Posten mit 0 €, darunter eingerückt geplant und davon entfällt');
    assertEqual(breakdown.expenses.filter(item => !item.detail).reduce((sum, item) => sum + item.amount, 0), breakdown.totals.ausgaben_gesamt,
        'Zeilen ergeben unverändert die Summe');
    assertEqual(breakdown.withdrawal, (log.entscheidung?.jahresEntnahme || 0) + 2000, '„davon aus dem Vermögen bezahlt“ unverändert: nur der bezahlte Posten');
    const html = renderProtocolTable([entry], { ...options, columns: getProtocolColumns(options) });
    assert(html.includes('<span class="protocol-cashflow-line protocol-cashflow-detail"><span>davon entfällt</span>')
        && /<span class="protocol-cashflow-line"><span>Geplante Ausgaben \(Umbau\)<\/span><span>0\s€<\/span>/.test(html),
        'OP-1 Punkt 4: ⓘ zeigt „davon entfällt“ eingerückt wie „davon Hilfe zur Pflege“, der Posten bleibt mit 0 € stehen');
    // Ohne Namen und ohne Liste der Posten: Der Posten heißt „Geplante Ausgabe“ (500.000 €, entfällt ganz).
    const unnamed = protocolCashflowBreakdown({ ...entry, geplante_ausgaben: 0, geplante_ausgaben_gekuerzt: 500000, geplante_ausgaben_entfallen: undefined },
        { ...options, inputs: { ...inputs, plannedExpenses: [{ id: 'gross', monat: '2026-06', betrag: 500000, bezeichnung: '' }] } });
    assertEqual(unnamed.expenses.filter(item => /Geplante Ausgabe|geplant|entfällt/.test(item.label)).map(item => `${item.label}:${item.amount}${item.detail ? ':eingerückt' : ''}`).join('|'),
        'Geplante Ausgabe:0|geplant:500000:eingerückt|davon entfällt:-500000:eingerückt', 'OP-1 Punkt 4: Posten ohne Namen heißt „Geplante Ausgabe“');
    // OP-1 Nachtrag 3: Zuordnung je Posten (P2-2) und keine Ausnahme für Rundungsreste (P3-1).
    const rowsOf = (planned, override) => {
        const result = protocolCashflowBreakdown({ ...entry, geplante_ausgaben_entfallen: undefined, ...override },
            { ...options, inputs: { ...inputs, plannedExpenses: planned.map(([betrag, bezeichnung], index) => ({ id: `p${index}`, monat: '2026-06', betrag, bezeichnung })) } });
        const sum = result.expenses.filter(item => !item.detail).reduce((total, item) => total + item.amount, 0);
        assert(Math.abs(sum - result.totals.ausgaben_gesamt) < 0.5, 'OP-1 Nachtrag 3: nicht eingerückte Zeilen ergeben die Summe (bis auf ausgeblendete Reste unter 0,50 €)');
        assert(result.expenses.every(item => item.detail || !/Geplante Ausgabe/.test(item.label) || item.amount >= 0 || item.label === 'Geplante Ausgaben'),
            'OP-1 P2-2: nie ein negativer bezahlter Betrag in einer Postenzeile');
        return result.expenses.filter(item => /Geplante Ausgabe|geplant|entfällt/.test(item.label)).map(item => `${item.label}:${item.amount}`).join('|');
    };
    assertEqual(rowsOf([[300, ''], [500, '']], { geplante_ausgaben: 300, geplante_ausgaben_gekuerzt: 500 }),
        'Geplante Ausgaben:300|Geplante Ausgabe:0|geplant:500|davon entfällt:-500', 'OP-1 P2-2: zwei Posten ohne Namen (300 und 500), nur 500 entfällt');
    assertEqual(rowsOf([[300, 'Reise'], [500, 'Reise']], { geplante_ausgaben: 300, geplante_ausgaben_gekuerzt: 500, geplante_ausgaben_entfallen: [{ label: 'Reise', amount: 500 }] }),
        'Geplante Ausgaben (Reise):300|Geplante Ausgaben (Reise):0|geplant:500|davon entfällt:-500', 'OP-1 P2-2: zwei gleichnamige Posten, nur 500 entfällt');
    assertEqual(rowsOf([[300, ''], [500, '']], { geplante_ausgaben: 0, geplante_ausgaben_gekuerzt: 800 }),
        'Geplante Ausgabe:0|geplant:300|davon entfällt:-300|Geplante Ausgabe:0|geplant:500|davon entfällt:-500', 'OP-1 P2-2: entfallene Summe ohne Liste verteilt sich auf beide Posten');
    assertEqual(rowsOf([[300, '']], { geplante_ausgaben: 299.7, geplante_ausgaben_gekuerzt: 0.3 }),
        'Geplante Ausgaben:300', 'OP-1 P3-1: Rundungsrest 0,30 € zeigt kein „geplant“ und kein „davon entfällt“');
}
