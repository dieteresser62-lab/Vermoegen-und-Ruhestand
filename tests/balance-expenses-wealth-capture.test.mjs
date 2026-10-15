import {
    EXPENSES_WEALTH_QUOTE_MAX_AGE_MS, readExpensesWealthQuoteEvidence,
    evaluateExpensesWealthQuoteFreshness, createExpensesWealthCaptureController
} from '../app/balance/balance-expenses-wealth-capture.js';
import { createBalanceWealthHistoryService, createManualWealthHistoryController } from '../app/balance/balance-wealth-history.js';
import { createAnnualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PROFILE_STORAGE_KEYS as KEYS, PROFILE_TRANCHES_KEY } from '../app/profile/profile-state.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { storeOverviewSummary, overviewScope } from '../app/overview/overview-storage.js';

const TIME = new Date('2026-10-03T12:00:00.000Z');
const SECONDS = TIME.getTime() / 1000;
const STATE = CONFIG.STORAGE.LS_KEY;
const source = { tagesgeld: 500, geldmarktEtf: 100, depotwertAlt: 200, depotwertNeu: 300 };
const lot = (category, value, asOf = SECONDS) => ({ category, type: category === 'money_market' ? 'geldmarkt' : category === 'gold' ? 'gold' : 'aktien_neu',
    shares: value / 100, currentPrice: 100, marketValue: value, asOf });
const input = (lots = [lot('equity', 500), lot('money_market', 100)]) => ({ ...source, detailledTranches: lots });
const fresh = (data, time = TIME) => evaluateExpensesWealthQuoteFreshness(readExpensesWealthQuoteEvidence(data), time);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

assertEqual(EXPENSES_WEALTH_QUOTE_MAX_AGE_MS, 604800000, 'Benannte Frischegrenze in Millisekunden');
for (const [offset, status] of [[604800, 'fresh'], [604801, 'old'], [-1, 'unknown']]) {
    assertEqual(fresh(input([lot('equity', 500, SECONDS - offset), lot('money_market', 100)])).status,
        status, `Grenze ${offset} Sekunden`);
}
for (const asOf of [undefined, null, NaN, '2026-10-03', 0, -1, 1.5, 9e15]) {
    const lots = [lot('equity', 500), lot('money_market', 100)];
    lots[0].asOf = asOf;
    assertEqual(fresh(input(lots)).status, 'unknown', `Ungültiger oder fehlender Zeitpunkt ${asOf}`);
}
assertEqual(fresh(input([lot('equity', 500, SECONDS - 10), lot('money_market', 100, SECONDS - 20)])).oldest,
    (SECONDS - 20) * 1000, 'Ältester belegter Kurs bestimmt die Meldung');
assertEqual(fresh({ ...source, detailledTranches: [] }).status, 'unknown', 'Positive ETF-Aggregate ohne Nachweis bleiben unbekannt');
assertEqual(fresh(input([{ ...lot('equity', 500), syntheticProfileFallback: true }, lot('money_market', 100)])).status,
    'unknown', 'Synthetischer Bestand ist kein Kursnachweis');
assertEqual(fresh(input([{ ...lot('equity', 500), marketValue: 400 }, lot('money_market', 200)])).status,
    'unknown', 'Bewertungsbetrag und Preis müssen zusammenpassen');
assertEqual(fresh({ tagesgeld: 500, detailledTranches: [lot('gold', 100)] }).status, 'none', 'Tagesgeld und Gold brauchen keinen ETF-Nachweis');
assertEqual(fresh({ ...source, depotwertNeu: 400, geldmarktEtf: 0, detailledTranches: [lot('equity', 500), lot('money_market', 100)] }).status,
    'unknown', 'Gleiche Gesamtsumme ersetzt keine vollständige ETF-Komponentenzuordnung');
assertEqual(fresh({ ...input([lot('equity', 500, null), lot('money_market', 100)]),
    annualMarketDataMeta: { asOf: SECONDS }, updatedAt: TIME.toISOString(), purchaseDate: '2026-10-03' }).status,
    'unknown', 'Strategie-ETF-Datum, Profiländerung und Kaufdatum geben keine Freigabe');

for (const depotwertNeu of [0, 100]) {
    assertEqual(fresh({ depotwertNeu, detailledTranches: [{ category: 'bonds', type: 'anleihe', marketValue: 100 }] }).status,
        'none', 'Separate Anleihen brauchen in beiden bestehenden Projektionen kein ETF-Kursdatum');
}

function fixture() {
    const annual = createAnnualWealthHistoryEntry(source, 2026);
    const state = { inputs: { ...source, saved: true }, lastState: { sentinel: 42 },
        wealthHistory: { schemaVersion: 1, entries: [annual] } };
    const foreign = { meta: { id: 'b', updatedAt: TIME.toISOString() }, data: { untouched: 'foreign',
        profile_tagesgeld: '0', [STATE]: JSON.stringify({ inputs: { tagesgeld: 0, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0 } }) } };
    const records = new Map([
        [STATE, JSON.stringify(state)], ['profile_tagesgeld', '500'], [KEYS.current, 'a'], [KEYS.active, 'a'],
        [KEYS.registry, JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a' }, data: { [STATE]: JSON.stringify(state) } }, b: foreign } })],
        ['balance_expenses_v1', '{"version":1,"years":{"2025":{"months":{"1":{"profiles":{"a":{},"b":{}}},"2":{"profiles":{"a":{}}}}}}']
    ]);
    const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
    const faults = {};
    let writes = 0, previews = 0, attempts = 0;
    const persistence = {
        async flush() { if (faults.flush) await faults.flush(); },
        async replaceRecordsTransactional(next, options) {
            if (faults.write) throw new Error('Schreibfehler');
            if (faults.replace) await faults.replace();
            Object.keys(next).forEach(key => options.allowKey(key));
            const previous = new Map(records);
            Object.entries(next).forEach(([key, value]) => records.set(key, value));
            try { options.postValidate(faults.readback ? {} : next); }
            catch (error) { records.clear(); previous.forEach((value, key) => records.set(key, value)); throw error; }
            writes++;
        }
    };
    const guard = createNavigationGuard();
    const service = createBalanceWealthHistoryService({ storage, persistence, guard,
        loadState: () => JSON.parse(records.get(STATE)), loadRegistry: () => JSON.parse(records.get(KEYS.registry)) });
    const capture = service.captureManual;
    service.captureManual = options => { attempts++; return capture(options); };
    let currentInput = input(), clock = new Date(TIME);
    const messages = [], errors = [], cleared = [];
    const update = options => {
        previews++;
        assertEqual(options.mode, 'preview', 'Erfassung fordert ausschließlich PREVIEW an');
        if (faults.preview) throw new Error('Vorschaufehler');
        const previewInput = currentInput;
        return { ok: true, inputData: previewInput, validateWealthHistorySource: () => {
            if (currentInput !== previewInput) throw new Error('Formulareingaben verändert');
        }, ...(faults.overview ? { overviewPersistence: faults.overview(options) } : {}) };
    };
    let refreshes = 0;
    const controller = createExpensesWealthCaptureController({ service, storage, update,
        now: () => clock, refresh: () => { refreshes++; if (faults.refresh) throw new Error('Renderfehler'); },
        toast: (text, type) => { if (faults.toast) throw new Error('Toastfehler'); messages.push({ text, type }); },
        reportError: (error, scope) => errors.push({ text: error.message, scope }), clearError: scope => cleared.push(scope) });
    return { controller, service, storage, persistence, guard, records, faults, messages, errors, cleared, foreign, annual,
        setInput: data => { currentInput = data; }, setTime: time => { clock = time; }, update,
        history: () => JSON.parse(records.get(STATE)).wealthHistory.entries,
        counts: () => ({ writes, previews, attempts, refreshes }) };
}

console.log('Regression Befund 1: automatischer Controller mit echtem PREVIEW-Übersichtswriter');
{
    const env = fixture(), gate = deferred(), entered = deferred();
    env.faults.overview = ({ navigationOperation } = {}) => storeOverviewSummary({ year: 2026, scope: overviewScope('single', ['a']),
        monthlyWithdrawal: 100, monthlyBudget: 200, createdAt: TIME.toISOString() }, {
        expectedProfileId: 'a', storage: env.storage, guard: env.guard, navigationOperation,
        flush: async () => { entered.resolve(); await gate.promise; return true; }
    });
    const imported = env.records.get('balance_expenses_v1');
    const pending = env.controller.afterImport();
    await entered.promise;
    assertEqual(env.counts().writes, 0, 'Offene Übersicht startet keinen automatischen Verlaufwrite');
    gate.resolve();
    assertEqual((await pending).status, 'saved', 'Bestätigter Import erfasst nach eigenem Übersichtswriter');
    assertEqual(env.counts().writes, 1, 'Ein bestätigter Verlaufwrite pro Import');
    assertEqual(env.records.get('balance_expenses_v1'), imported, 'Separat bestätigter Import bleibt erhalten');
    assertEqual(env.guard.reasons().length, 0, 'Keine offenen Guardgründe');
}

for (const trigger of ['manual', 'automatic'])
for (const change of ['profile', 'household', 'tranches', 'state', 'live-person', 'form', 'foreign-commit', 'navigation', 'flush-false', 'flush-throw', 'pending-annual']) {
    const env = fixture(), gate = deferred(), entered = deferred();
    env.faults.overview = ({ navigationOperation } = {}) => storeOverviewSummary({ year: 2026, scope: overviewScope('single', ['a']),
        monthlyWithdrawal: 100, monthlyBudget: 200, createdAt: TIME.toISOString() }, {
        expectedProfileId: 'a', storage: env.storage, guard: env.guard, navigationOperation, flush: async () => {
            entered.resolve(); await gate.promise;
            if (change === 'flush-throw') throw new Error('Übersichtsflush fehlgeschlagen');
            return change !== 'flush-false';
        }
    });
    const status = { textContent: '' }, button = { disabled: false };
    const manual = createManualWealthHistoryController({ service: env.service, update: env.update, status, button,
        now: () => TIME, refresh: () => {} });
    const capture = () => trigger === 'manual' ? manual.capture() : env.controller.afterImport();
    const pending = capture(); await entered.promise;
    if (change === 'profile') { env.records.set(KEYS.current, 'b'); env.records.set(KEYS.active, 'b'); }
    if (change === 'household') {
        const registry = JSON.parse(env.records.get(KEYS.registry)); registry.profiles.b.meta.belongsToHousehold = false;
        env.records.set(KEYS.registry, JSON.stringify(registry));
    }
    if (change === 'tranches') env.records.set(PROFILE_TRANCHES_KEY, '[]');
    if (change === 'live-person') env.records.set('profile_tagesgeld', '0');
    if (change === 'form') env.setInput({ ...input(), tagesgeld: 0 });
    if (change === 'state' || change === 'pending-annual') {
        const state = JSON.parse(env.records.get(STATE));
        if (change === 'state') state.inputs.changed = true;
        else state.annualPeriodMetadata = { pendingCommit: { periodId: 'calendar-year:2026' } };
        env.records.set(STATE, JSON.stringify(state));
    }
    if (change === 'foreign-commit') {
        const registration = env.guard.register(Symbol('fremder Commit'), { read: () => ({ phase: 'commit' }) });
        // Auch ein vor Ende des Übersichtswriters beendeter Commit entwertet die Vorschau.
        registration.unregister();
    }
    const navigation = change === 'navigation' ? await env.guard.prepare({ owners: [] }) : null;
    gate.resolve();
    const outcome = await pending;
    assertEqual(outcome.status, 'failed', `${trigger}/${change}: wartende Vorschau wird nicht erfasst`);
    assertEqual(env.counts().writes, 0, `${trigger}/${change}: kein veralteter Verlaufwrite`);
    assertEqual(env.history().length, 1, `${trigger}/${change}: Jahresstand bleibt erhalten`);
    if (trigger === 'automatic') assert(env.errors[0].text.startsWith('Ausgaben importiert;'), `${change}: Import und Erfassungsfehler bleiben getrennt`);
    else assertEqual(button.disabled, false, `${change}: manueller Knopf nach Fehler wieder bedienbar`);
    if (navigation) env.guard.end(navigation);
    assertEqual(env.guard.reasons().length, 0, `${trigger}/${change}: alle Gründe freigegeben`);
    if (change.startsWith('flush-')) {
        delete env.faults.overview;
        assertEqual((await capture()).status, 'saved', `${trigger}/${change}: bewusster Retry ist möglich`);
        assertEqual(env.history().length, 2, `${trigger}/${change}: Retry ergänzt genau einen Eintrag`);
    }
}

for (const trigger of ['manual', 'automatic']) {
    const env = fixture();
    // update() fängt einen Übersichtsschreibfehler ab und liefert genau dieses
    // Ergebnis. Auch ein erfülltes Promise mit false ist keine Bestätigung.
    env.faults.overview = () => Promise.resolve(false);
    const manual = createManualWealthHistoryController({ service: env.service, update: env.update, refresh: () => {} });
    const outcome = await (trigger === 'manual' ? manual.capture() : env.controller.afterImport());
    assertEqual(outcome.status, 'failed', `${trigger}: abgefangener Übersichtsschreibfehler bleibt fehlgeschlagen`);
    assertEqual(env.counts().writes, 0, `${trigger}: overviewPersistence false startet keinen Folgewrite`);
    assertEqual(env.guard.reasons().length, 0, `${trigger}: false-Ergebnis hinterlässt keine Gründe`);
}

{
    const env = fixture();
    const expenses = env.records.get('balance_expenses_v1');
    assertEqual((await env.controller.afterImport()).status, 'saved', 'Mehrmonats-/Mehrprofilvorgang sichert genau einmal');
    assertEqual(JSON.stringify(env.counts()), JSON.stringify({ writes: 1, previews: 1, attempts: 1, refreshes: 1 }), 'Ein Versuch für den gesamten Vorgang');
    const saved = env.history().find(e => e.reason === 'manual');
    assertEqual(saved.id, 'manual:2026-10-03', 'Importtag statt Ausgabenmonat');
    assertEqual(saved.periodId, null, 'Unterjährige Erfassung ohne Perioden-ID');
    assertEqual(saved.total, 1100, 'Dieselben Vermögenskomponenten wie manuell');
    env.setInput({ ...input(), tagesgeld: 999 });
    await env.controller.afterImport();
    assertEqual(env.history().length, 2, 'Import am gleichen Tag ersetzt unterjährigen Stand');
    assertEqual(env.history().find(e => e.reason === 'manual').tagesgeld, 999, 'Ersetzung verwendet frische Vorschau');
    env.setTime(new Date('2026-10-04T12:00:00Z'));
    await env.controller.afterImport();
    assertEqual(env.history().length, 3, 'Anderer Importtag ergänzt');
    assertEqual(JSON.stringify(env.history().find(e => e.reason === 'annual_close')), JSON.stringify(env.annual), 'Jahresstand unverändert');
    const stored = JSON.parse(env.records.get(STATE));
    assertEqual(stored.lastState.sentinel, 42, 'PREVIEW verändert keinen Periodenstate');
    const registry = JSON.parse(env.records.get(KEYS.registry));
    assertEqual(registry.profiles.a.data[STATE], env.records.get(STATE), 'Live-State und aktive Registrykopie nach Readback identisch');
    assertEqual(JSON.stringify(registry.profiles.b), JSON.stringify(env.foreign), 'Fremdprofil bleibt unverändert');
    assertEqual(env.records.get('balance_expenses_v1'), expenses, 'Ausgabenformat und Importdaten bleiben unverändert');
    assertEqual(env.messages[0].text, 'Vermögensstand gesichert (Kurse vom 03.10.2026).', 'Exakter Erfolgstext');
    assertEqual(env.messages[0].type, true, 'Erfolg verwendet boolesche Toast-API');
    const manual = createManualWealthHistoryController({ service: env.service, update: env.update,
        now: () => new Date('2026-10-04T12:00:00Z'), refresh: () => {} });
    const before = JSON.stringify(env.history());
    await manual.capture();
    assertEqual(JSON.stringify(env.history()), before, 'Manueller Pfad erzeugt dieselben Komponenten und Tagesersetzung');
}
for (const fault of ['toast', 'refresh']) {
    const env = fixture(); env.faults[fault] = true;
    assertEqual((await env.controller.afterImport()).status, 'saved', `${fault}: Darstellungsfehler widerruft keinen bestätigten Stand`);
    assertEqual(env.history().length, 2, `${fault}: bestätigte Historie bleibt gespeichert`);
    assertEqual(env.errors.length, 0, `${fault}: kein falscher Persistenzfehler`);
}
for (const status of ['old', 'unknown']) {
    const env = fixture();
    env.setInput(input([lot('equity', 500, status === 'old' ? SECONDS - 604801 : null), lot('money_market', 100)]));
    assertEqual((await env.controller.afterImport()).status, status, 'Gate verhindert Sicherung');
    assertEqual(env.counts().attempts, 0, 'Hinweis ohne Captureversuch');
    assertEqual(env.counts().writes, 0, 'Hinweis ohne Verlaufwrite');
    const detail = status === 'old' ? 'Kurse vom 26.09.2026 sind älter als 7 Tage.' : 'Kursdatum unbekannt.';
    assertEqual(env.messages[0].text, `Vermögensstand nicht gesichert: ${detail} Kurse im Profil-Assets-Manager aktualisieren und danach in Personen & Vermögen „Stand jetzt erfassen“.`, 'Exakter Hinweistext');
    assertEqual(env.messages[0].type, 'info', 'Hinweis verwendet info');
}
{
    const env = fixture();
    env.setInput({ tagesgeld: 123, depotwertAlt: 0, depotwertNeu: 0, geldmarktEtf: 0 });
    await env.controller.afterImport();
    assertEqual(env.messages[0].text, 'Vermögensstand gesichert (keine kursabhängigen Bestände).', 'Ohne ETF direkte Sicherung');
}
for (const fault of ['preview', 'write', 'readback']) {
    const env = fixture();
    env.faults[fault] = true;
    const before = env.records.get(STATE);
    assertEqual((await env.controller.afterImport()).status, 'failed', `${fault}: Sicherung fehlgeschlagen`);
    assertEqual(env.records.get(STATE), before, `${fault}: ausschließlich bestätigte Historie bleibt`);
    assertEqual(env.errors[0].scope, 'expenses-wealth', `${fault}: eigener Ausgabenaktionsfehler`);
    assert(env.errors[0].text.startsWith('Ausgaben importiert; Vermögensstand nicht bestätigt:'), 'Importbestätigung bleibt im Fehlerkontext');
    assertEqual(env.messages.length, 0, 'Unbestätigter Write ohne Erfolgstoast');
    assertEqual(JSON.stringify(env.cleared), '["expenses-wealth"]', 'Nur eigener Fehler wird bereinigt');
}
{
    const env = fixture();
    const state = JSON.parse(env.records.get(STATE));
    state.annualPeriodMetadata = { pendingCommit: { periodId: 'calendar-year:2026' } };
    env.records.set(STATE, JSON.stringify(state));
    await env.controller.afterImport();
    assertEqual(env.counts().attempts, 0, 'Recovery-Sperre ohne Sicherungsversuch');
    const hold = deferred();
    const running = env.service.runAnnual(() => hold.promise);
    await env.controller.afterImport();
    assertEqual(env.counts().attempts, 0, 'Laufender Jahresabschluss ohne Sicherungsversuch');
    hold.resolve(); await running;
}
{
    const env = fixture(), entered = deferred(), release = deferred();
    let first = true;
    env.faults.flush = async () => { if (first) { first = false; entered.resolve(); await release.promise; } };
    const previousTZ = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    try {
        env.setTime(new Date('2026-10-03T22:30:00Z'));
        const a = env.controller.afterImport();
        const b = env.controller.afterImport();
        await entered.promise;
        env.setTime(new Date('2026-10-04T23:30:00Z'));
        release.resolve(); await Promise.all([a, b]);
        assertEqual(env.counts().attempts, 2, 'Zwei schnelle Imports werden je einmal bearbeitet');
        assertEqual(env.counts().writes, 2, 'Kein Import geht durch in_flight verloren');
        assertEqual(env.history().find(e => e.reason === 'manual').asOf, '2026-10-04', 'Lokaler Importtag bleibt über Mitternacht festgehalten');
    } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
}
for (const change of ['profile', 'tranches', 'foreign', 'period']) {
    const env = fixture(), entered = deferred(), release = deferred();
    env.faults.flush = async () => { entered.resolve(); await release.promise; };
    const operation = env.controller.afterImport();
    await entered.promise;
    if (change === 'profile') { env.records.set(KEYS.current, 'b'); env.records.set(KEYS.active, 'b'); }
    if (change === 'tranches') env.records.set(PROFILE_TRANCHES_KEY, '[]');
    if (change === 'foreign') {
        const registry = JSON.parse(env.records.get(KEYS.registry));
        registry.profiles.b.data.changed = 'true';
        env.records.set(KEYS.registry, JSON.stringify(registry));
    }
    if (change === 'period') {
        const state = JSON.parse(env.records.get(STATE)); state.lastState.sentinel = 99;
        env.records.set(STATE, JSON.stringify(state));
    }
    release.resolve();
    assertEqual((await operation).status, 'failed', `${change}: Quellenwechsel während Flush erkannt`);
    assertEqual(env.counts().writes, 0, `${change}: keine fremden oder veralteten Werte gespeichert`);
}
{
    const env = fixture(), entered = deferred(), release = deferred();
    let first = true;
    env.faults.flush = async () => { if (first) { first = false; entered.resolve(); await release.promise; } };
    const manual = createManualWealthHistoryController({ service: env.service, update: env.update,
        now: () => new Date('2026-10-02T12:00:00Z'), refresh: () => {} });
    const manualCapture = manual.capture(); await entered.promise;
    const automatic = env.controller.afterImport();
    release.resolve(); await Promise.all([manualCapture, automatic]);
    assertEqual(env.history().length, 3, 'Konkurrenz mit manuellem Stand verliert keinen Eintrag');
    assertEqual(env.errors.length, 0, 'Reine konkurrierende Historiewrites sind erlaubt');
}
console.log('Automatische Erfassung: Frische, Transaktion, Konkurrenz und Meldungen geprüft.');
