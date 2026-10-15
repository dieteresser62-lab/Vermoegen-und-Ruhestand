import fs from 'node:fs';
import { startAutomaticBacktest, startSimulatorDocument, createSimulatorInitialization, automaticBacktestPeriod, nextPaintFrame } from '../app/simulator/simulator-auto-backtest.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
for (const readyState of ['loading', 'interactive', 'complete']) {
    let domReady;
    let starts = 0;
    const doc = { readyState, addEventListener: (event, callback, options) => {
        assertEqual(event, 'DOMContentLoaded', 'Dokumentstart wartet ausschließlich auf DOM-Bereitschaft');
        assert(options.once, 'Bereitschaftslistener wird nur einmal ausgeführt');
        domReady = callback;
    } };
    const start = startSimulatorDocument(doc, () => { starts++; return 'initialized'; });
    assert(startSimulatorDocument(doc, () => { throw new Error('Doppelstart'); }) === start, `${readyState}: auch UI-Initialisierung ist dokumentbezogen Singleflight`);
    await tick();
    if (readyState === 'loading') {
        assertEqual(starts, 0, 'Keine UI-Initialisierung vor dem vorhandenen DOM');
        domReady();
    }
    assertEqual(await start, 'initialized', `${readyState}: Start funktioniert auch nach bereits erfolgtem load`);
    assertEqual(starts, 1, `${readyState}: genau ein dokumentbezogener Start`);
}
{
    const doc = { readyState: 'complete' }, other = { readyState: 'complete' };
    const gate = deferred(); let starts = 0;
    const failed = startSimulatorDocument(doc, async () => { starts++; await gate.promise; throw new Error('UI_START_FAILED'); });
    const observed = failed.catch(error => error);
    assertEqual(startSimulatorDocument(doc, () => { starts++; }), failed, 'Paralleler UI-Start teilt auch offenen Fehlerpfad');
    const independent = startSimulatorDocument(other, () => { starts++; return true; });
    assertEqual(await independent, true, 'Zweites Simulatordokument startet unabhängig');
    gate.resolve();
    assertEqual((await observed).message, 'UI_START_FAILED', 'UI-Startfehler bleibt am Dokumentpromise beobachtbar');
    assertEqual(starts, 2, 'Je Dokument genau eine UI-Initialisierung, auch bei Fehler');
}
function fixture(overrides = {}) {
    const events = [];
    const provider = { bounds: { startYear: 1929, endYear: 2024 }, preparePeriod: period => {
        events.push(['data', period.startYear, period.endYear]); return { status: 'complete' };
    } };
    const d = { persistenceReady: async () => {}, profileReady: async () => {}, initializationReady: async () => {},
        isBlocked: () => false, engineReady: () => true, provider: () => provider, currentYear: () => 2026,
        validate: () => events.push('validated'), status: phase => events.push(phase),
        setPeriod: period => events.push(period), frame: async () => events.push('paint'),
        run: async options => { await options.beforeRun(); events.push(['run', options]); return 'result'; }, ...overrides };
    return { d, events, provider };
}

assert(fs.readFileSync(new URL('../app/simulator/simulator-main.js', import.meta.url), 'utf8').includes('await initialization.settle()'),
    'Echter Dokumentabschluss verwendet den geprüften Initialisierungshelfer');
for (const scenario of ['Profilbereitschaft', 'Persistenzbereitschaft', 'Recovery', 'Validierung', 'UI-Startfehler']) {
    const error = Object.assign(new Error(scenario), scenario === 'Validierung' ? { name: 'SimulatorValidationError' } : {});
    let uiStarts = 0;
    const profileReady = scenario === 'Profilbereitschaft' ? Promise.reject(error) : Promise.resolve();
    const persistenceReady = scenario === 'Persistenzbereitschaft' ? Promise.reject(error) : Promise.resolve();
    const isBlocked = () => scenario === 'Recovery';
    const initialization = createSimulatorInitialization({ profileReady, persistenceReady, isBlocked,
        initialize: () => { uiStarts++; throw error; } });
    const { d, events } = fixture({ profileReady: () => profileReady, persistenceReady: () => persistenceReady,
        initializationReady: () => initialization.initialized, isBlocked });
    const win = {};
    d.status = (phase, failure) => {
        events.push(phase);
        if (phase === 'technical_error') win.__simulatorOpeningBacktestError = failure?.message;
    };
    await startSimulatorDocument({ readyState: 'complete' }, async () => {
        await startAutomaticBacktest({}, d);
        await initialization.settle();
        win.__simulatorOpeningBacktestDone = true;
    }).catch(failure => d.status('technical_error', failure));
    const technical = scenario === 'UI-Startfehler';
    assertEqual(events.at(-1), technical ? 'technical_error' : scenario === 'Validierung' ? 'invalid' : 'blocked',
        `${scenario}: Dokumentabschluss erhält die passende Aussage`);
    assertEqual(win.__simulatorOpeningBacktestError, technical ? scenario : undefined,
        `${scenario}: nur echter UI-Startfehler erreicht die Browserfehlerbarriere`);
    assertEqual(win.__simulatorOpeningBacktestDone, technical ? undefined : true,
        `${scenario}: UI-Startfehler wird nicht als erfolgreicher Abschluss bestätigt`);
    assertEqual(uiStarts, scenario.endsWith('bereitschaft') ? 0 : 1, `${scenario}: kein UI-Start vor Bereitschaft`);
    assert(!events.some(event => Array.isArray(event) && event[0] === 'run'), `${scenario}: keine Rechnung`);
}

for (const stage of ['persistenceReady', 'profileReady', 'initializationReady']) {
    const gate = deferred();
    const { d, events } = fixture({ [stage]: () => gate.promise });
    const doc = {};
    const opened = startAutomaticBacktest(doc, d);
    assert(startAutomaticBacktest(doc, d) === opened, `${stage}: Dokumentinitialisierung teilt dasselbe Promise`);
    await tick();
    assert(!events.includes('validated') && !events.some(event => Array.isArray(event) && event[0] === 'run'), `${stage}: kein Lauf vor Bereitschaft`);
    gate.resolve(); await opened;
    assertEqual(events.filter(event => Array.isArray(event) && event[0] === 'run').length, 1, `${stage}: genau ein Öffnungslauf`);
    const run = events.find(event => Array.isArray(event) && event[0] === 'run')[1];
    assert(run.focus === false, 'Automatischer Pfad stiehlt keinen Fokus');
    assert(events.indexOf('paint') < events.findIndex(event => Array.isArray(event) && event[0] === 'run'), 'Gezeichneter Frame liegt vor synchronem Runner');
}
for (const [label, overrides, expected] of [
    ['Recovery', { isBlocked: () => true }, 'blocked'],
    ['Engine', { engineReady: () => false }, 'technical_error'],
    ['fehlende Daten', { provider: () => ({ bounds: { startYear: 1929, endYear: 2025 }, preparePeriod: () => ({ status: 'incomplete' }) }) }, 'missing'],
    ['ungültige Eingaben', { validate: () => { throw Object.assign(new Error('Mindest-Flex'), { name: 'SimulatorValidationError' }); } }, 'invalid']
]) {
    const { d, events } = fixture(overrides);
    await startAutomaticBacktest({}, d);
    assert(events.includes(expected), `${label}: sichtbarer Sperrzustand`);
    assert(!events.some(event => Array.isArray(event) && event[0] === 'run'), `${label}: keine Rechnung`);
}
const { provider } = fixture();
const period = automaticBacktestPeriod(provider, 2026);
assertEqual(period.endYear, 2024, 'Endjahr kommt aus verfügbaren Daten');
assertEqual(JSON.stringify(period.missingYears), '[2025]', 'Vorjahreslücke wird offengelegt');
assertEqual(automaticBacktestPeriod({ bounds: { endYear: 2030 } }, 2026).endYear, 2025, 'Zukünftige Daten überschreiten das Vorjahr nicht');
const oldRaf = globalThis.requestAnimationFrame;
const frames = [];
globalThis.requestAnimationFrame = callback => frames.push(callback);
try {
    let complete = false;
    const painted = nextPaintFrame().then(() => { complete = true; });
    await tick(); assert(!complete, 'Microtasks ersetzen keinen Browserframe');
    frames.shift()(); await tick(); assert(!complete, 'Erster rAF zeichnet vor dem zweiten Callback');
    frames.shift()(); await painted; assert(complete, 'Zweiter Frame gibt synchronen Lauf frei');
} finally { globalThis.requestAnimationFrame = oldRaf; }

// Fachliche Uhr ändert ausschließlich die UI-Periodenwahl, keine Datenjahresgrenze.
{
    const { setAppTestDate } = await import('../app/shared/app-clock.js');
    try {
        setAppTestDate('2028-01-01');
        const period = automaticBacktestPeriod({ bounds: { endYear: 2025 } });
        assertEqual(period.endYear, 2025, 'Spielbereich erweitert historische Daten nicht');
        assertEqual(JSON.stringify(period.missingYears), '[2026,2027]', 'UI-Vorjahr stammt aus virtueller Uhr');
    } finally { setAppTestDate(null); }
}
