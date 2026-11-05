import vm from 'node:vm';
import { waitForNavigationDecisionSettled, waitForSimulatorOpening, confirmSimulatorOpeningNavigation, assertExpensesMatrixBlur } from './browser-smoke.test.mjs';

// Der Import der Browserdatei erreicht weder main(), Server noch Playwright.
assertEqual(typeof waitForNavigationDecisionSettled, 'function', 'Die echte Wartehilfe ist ohne Browserstart importierbar');

// Seit Paket S1 ist das automatische Öffnungsergebnis kein Verlustgrund: Die Hilfe fragt nur den echten
// Schutzgrund ab, öffnet keinen Dialog und scheitert, wenn doch ein Backtest-Ergebnisgrund gemeldet wird.
for (const [source, resultReason, expected, fails] of [['Balance.html', false, '', false], ['Simulator.html', false, 'Grund', false],
    ['Simulator.html', true, 'Grund', true]]) {
    const events = [];
    const page = {
        async evaluate(predicate) {
            assertEqual(predicate.toString().includes('simulator-backtest'), true, 'Abfrage des echten Backtest-Ergebnisgrunds');
            events.push('Grund');
            return resultReason;
        },
        locator() { events.push('Dialog'); return { async waitFor() {}, async textContent() { return ''; }, async click() {} }; }
    };
    let failed = null;
    try { await confirmSimulatorOpeningNavigation(page, source); } catch (error) { failed = error; }
    assertEqual(events.join(','), expected, `${source}/${resultReason}: kein Dialog für das automatische Öffnungsergebnis`);
    assertEqual(Boolean(failed), fails, `${source}/${resultReason}: gemeldeter Ergebnisgrund wird als Regression erkannt`);
}

for (const state of ['pending', 'ready', 'error']) {
    const window = { __simulatorOpeningBacktestDone: state !== 'pending',
        __simulatorOpeningBacktestError: state === 'error' ? 'UI_START_FAILED' : '' };
    const context = vm.createContext({ window }); let calls = 0, result, failed;
    const options = { timeout: 250 };
    const page = { async waitForFunction(predicate, argument, passed) {
        calls++;
        assertEqual(argument, undefined, 'Simulatorbarriere hat keinen Realm-/Modulimport');
        assertEqual(passed, options, 'Timeout ist Fehlerschutz statt künstlicher Verzögerung');
        result = new vm.Script(`(${predicate.toString()})()`).runInContext(context);
    }, async evaluate(predicate) { return new vm.Script(`(${predicate.toString()})()`).runInContext(context); } };
    await waitForSimulatorOpening(page, 'Balance.html', options);
    assertEqual(calls, 0, 'Andere Suite-Seiten erhalten keine Simulatorbarriere');
    try { await waitForSimulatorOpening(page, 'Simulator.html', options); } catch (error) { failed = error; }
    assertEqual(calls, 1, 'Simulatorzustand wird vor der ursprünglichen Probe abgefragt');
    if (state === 'error') assertEqual(failed?.message, 'UI_START_FAILED', 'Simulatorbarriere verschluckt keinen technischen Startfehler');
    else assertEqual(result, state === 'ready', 'Simulatorbarriere meldet nur den freigegebenen Zustand');
}

function pageDouble({ open = false, busy = false, missingDialog = false, missingGuard = false,
    changeBeforePoll = () => {} } = {}) {
    const events = [], state = { open, busy, missingDialog, missingGuard };
    const remainingReasons = [{ phase: 'idle', result: true }, { phase: 'idle', dirty: true }];
    const guard = { isBusy: () => state.busy, reasons: () => remainingReasons };
    const window = {};
    const context = vm.createContext({ window, document: {
        getElementById: id => id === 'navigationGuardDialog' && !state.missingDialog ? { open: state.open } : null
    } });
    const probe = { events, state, guard, polls: 0, options: null, argument: null };
    probe.page = {
        async evaluate() {
            // Nur die vorgeschaltete asynchrone Modulinitialisierung nachbilden.
            events.push('initialisiert');
            if (!state.missingGuard) window.__browserSmokeNavigationGuard = guard;
        },
        async waitForFunction(predicate, argument, options) {
            probe.options = options;
            probe.argument = argument;
            context.argument = argument;
            const script = new vm.Script(`(${predicate.toString()})(argument)`);
            for (let poll = 1; poll <= 4; poll++) {
                changeBeforePoll(state, poll);
                probe.polls++;
                events.push('abgefragt');
                const result = script.runInContext(context);
                // Auch ein regressives async-Prädikat darf keinen unbehandelten Reject hinterlassen.
                if (result && typeof result.then === 'function') Promise.resolve(result).catch(() => {});
                assert(!result || typeof result.then !== 'function', 'Das tatsächliche Warteprädikat liefert kein Promise oder Thenable');
                assertEqual(typeof result, 'boolean', 'Jede Abfrage liefert synchron einen Boolean');
                if (result) return;
            }
            const error = new Error('Kontrollierte Abfragen bleiben gesperrt');
            error.name = 'TimeoutError';
            throw error;
        }
    };
    return probe;
}

for (const [label, state] of [
    ['geschlossener Dialog und beschäftigter Guard', { busy: true }],
    ['offener Dialog und freier Guard', { open: true }],
    ['fehlender Dialog', { missingDialog: true }],
    ['fehlende Guardreferenz', { missingGuard: true }]
]) {
    const probe = pageDouble(state), options = { timeout: 250, polling: 5 };
    let failure;
    try { await waitForNavigationDecisionSettled(probe.page, options); }
    catch (error) { failure = error; }
    assertEqual(failure?.name, 'TimeoutError', `${label}: keine vorzeitige Freigabe`);
    assertEqual(probe.polls, 4, `${label}: wiederholte Zustandsabfragen`);
    assertEqual(probe.events[0], 'initialisiert', `${label}: Initialisierung vor erster Abfrage`);
    assertEqual(probe.options, options, `${label}: explizite Playwright-Optionen unverändert weitergegeben`);
    assertEqual(probe.argument, undefined, `${label}: Optionen stehen im dritten Parameter`);
}

for (const condition of ['busy', 'open']) {
    const probe = pageDouble({ [condition]: true, changeBeforePoll(state, poll) {
        if (poll === 3) state[condition] = false;
    } });
    await waitForNavigationDecisionSettled(probe.page);
    assertEqual(probe.polls, 3, `${condition}: Erfolg erst nach späterem Zustandswechsel`);
    assertEqual(probe.events.join(','), 'initialisiert,abgefragt,abgefragt,abgefragt', `${condition}: Initialisierung und wiederholte synchrone Abfragen`);
    assertEqual(Object.keys(probe.options).length, 0, 'Ohne Optionen bleibt der Playwright-Standardtimeout erhalten');
    assertEqual(probe.guard.reasons().length, 2, 'Ergebnis- und Dirtygründe bleiben nach Freigabe bestehen');
}

const settled = pageDouble();
await waitForNavigationDecisionSettled(settled.page);
assertEqual(settled.polls, 1, 'Geschlossener Dialog und freier Guard erlauben sofortigen Erfolg');

// Fall B: das tatsächliche Browserprädikat erlaubt native Matrixvorfahren und verwirft fremden Fokus.
for (const kind of ['body', 'region', 'ancestor', 'negative-tabindex', 'native-ancestor', 'button', 'elsewhere', 'elsewhere-negative-tabindex', 'unfocusable', 'matrix']) {
    const matrix = { id: 'expensesTable', tabIndex: 0, dataset: {}, hasAttribute: () => true, contains: node => node === matrix };
    const body = { id: '', tagName: 'BODY', tabIndex: -1, dataset: {}, hasAttribute: () => false, contains: () => true };
    const ancestor = ['region', 'ancestor', 'negative-tabindex', 'native-ancestor', 'unfocusable'].includes(kind);
    const active = kind === 'body' ? body : kind === 'matrix' ? matrix : {
        id: kind, tagName: ['button', 'native-ancestor'].includes(kind) ? 'BUTTON' : 'SECTION',
        tabIndex: ['negative-tabindex', 'elsewhere-negative-tabindex', 'unfocusable'].includes(kind) ? -1 : 0,
        hasAttribute: name => name === 'tabindex' && ['region', 'ancestor', 'negative-tabindex', 'elsewhere-negative-tabindex'].includes(kind),
        dataset: kind === 'button' ? { action: 'import', month: '9', profile: 'a' } : {}, contains: node => ancestor && node === matrix
    };
    const context = vm.createContext({ document: { body, activeElement: active, getElementById: () => matrix } });
    let error;
    try { await assertExpensesMatrixBlur({ async evaluate(predicate) {
        return new vm.Script(`(${predicate.toString()})()`).runInContext(context);
    } }, 'Fokusprobe ' + kind); } catch (failure) { error = failure; }
    assertEqual(Boolean(error), !['body', 'region', 'ancestor', 'negative-tabindex', 'native-ancestor'].includes(kind), kind + ': präzise native Fokusgrenze');
    if (error) {
        assert(error.message.includes('"id":"' + active.id + '"'), kind + ': Fokusdiagnose nennt aktiven Knoten');
        if (kind === 'button') assert(error.message.includes('"action":"import"') && error.message.includes('"month":"9"'), 'Unzulässiger Matrixrückfokus enthält Aktionsidentität');
    }
}
