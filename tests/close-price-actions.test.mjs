import { createClosePriceActions } from '../app/shared/close-price-actions.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { requestOverviewMonthConfirmation } from '../app/overview/overview-month-confirmation.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { overviewPriceLabel, overviewPricesDone } from '../app/overview/overview-model.js';
import { publishStartupPriceReport, STARTUP_PRICE_SESSION_KEY } from '../app/tranches/tranchen-startup-prices.js';

const initialModel = () => ({ activeId: 'a', scope: { key: 'single:a', ids: ['a'] }, now: new Date(2027, 0, 2, 12),
    members: [{ id: 'a', name: 'Alva', count: 1 }], quoteDate: new Date(2026, 11, 30, 17).toISOString(),
    priceTranches: [{ profileId: 'a', trancheId: 'lot', asOf: new Date(2026, 11, 30, 17).getTime() / 1000 }],
    occasion: { kind: 'monthly', previousYear: 2026, previousMonth: 12 },
    expenses: { year: 2026, month: 12, complete: true, spent: 120, rows: [{ id: 'a', present: true, spent: 120, categories: { Lebensmittel: -120 } }] },
    expenseBudget: 0, summary: { monthlyWithdrawal: 500 },
    cashPeople: [{ id: 'a', name: 'Alva', value: 18000, lastDate: null, error: null }] });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
for (const entry of ['month', 'annual']) {
    const { doc } = createDialogFixture(), guard = createNavigationGuard();
    let model = initialModel(), handle, calls = 0, publications = 0, writes = 0;
    const gate = deferred();
    const actions = createClosePriceActions({ doc, guard, getModel: () => model, source: () => ({}), waitStartup: async () => {},
        publish: () => publications++, onReport: report => { model = { ...model, priceReport: report }; },
        coordinator: async ({ operation, valid, progress }) => {
            calls++; progress({ status: 'running', completed: 0, total: 1, results: [] });
            await gate.promise; operation.check(); assert(valid(), 'Aktueller Dialog besitzt weiterhin den Kursauftrag');
            operation.commit();
            return { status: 'complete', updated: 1, retrievedAt: model.now.getTime(),
                results: [{ profileId: 'a', profileName: 'Alva', trancheId: 'lot', trancheName: 'ETF', status: 'updated' }] };
        } });
    let result;
    if (entry === 'month') result = requestOverviewMonthConfirmation({ doc, model, people: model.cashPeople, priceActions: actions,
        getModel: () => model, onReady: value => { handle = value; }, onAccept: () => { writes++; return true; } });
    else {
        const annual = createAnnualCloseDialog({ document: doc, priceActions: actions, getModel: () => model, isCommitActive: () => false,
            projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
        result = annual.showAnnualPreparation({ targetYear: 2026, model, people: model.cashPeople, onReady: value => { handle = value; } });
    }
    handle.activate('cash'); const cash = doc.querySelector('[data-tagesgeld-person]'); cash.value = '19.000,123456';
    const root = handle.root;
    await doc.querySelector('[data-close-dialog-activate="prices"]').fire('click');
    doc.querySelector('[data-close-prices-details]').open = true;
    const click = doc.querySelector('[data-close-prices-refresh]').fire('click'); await tick();
    await doc.querySelector('[data-close-prices-refresh]').fire('click');
    assertEqual(calls, 1, entry + ': Doppelklick startet keinen zweiten Quoteauftrag');
    assert(root.open && handle.busy, entry + ': Fortschritt bleibt im offenen gesperrten Dialog');
    assert(dialogElements(root).some(n => n.textContent.includes('Kurse werden aktualisiert')), entry + ': Fortschritt im Kursschritt sichtbar');
    await root.fire('keydown', { key: 'Escape' }); assert(root.open, entry + ': Laufender Auftrag schützt Escape');
    gate.resolve(); await click;
    assertEqual(publications, 1, entry + ': Genau ein bestätigter Bericht');
    assert(root.open && !handle.busy && doc.querySelector('[data-close-prices-details]').open, entry + ': Ergebnis und geöffnete Details bleiben lokal');
    assertEqual(cash.value, '19.000,123456', entry + ': Kursrefresh erhält Tagesgeldentwurf bytegleich');
    assert(doc.querySelector('[data-tagesgeld-person]') === cash, entry + ': Kursrefresh erhält Feldidentität');
    const texts = dialogElements(root).map(n => n.textContent).join(' ');
    assert(texts.includes('Ältestes Kursdatum:') && texts.includes('30.12.2026') && texts.includes('Alva / ETF: gespeichert'), entry + ': Kursdatum und Einzelresultat sichtbar');
    handle.activate('expenses'); doc.querySelector('[data-close-expenses-details]').open = true;
    assert(texts.includes('Lebensmittel') && texts.includes('Summe: 120,00'), entry + ': Lokale Ausgaben enthalten Person, Kategorie und Summe');
    assertEqual(writes, 0, entry + ': Prüfen und Weiter bestätigen keinen Monatswrite');
    handle.close(false); await result;
    assert(doc.querySelector('[data-close-prices-refresh]') === null, entry + ': Dialogcleanup entfernt lokale Aktion');
}
for (const change of ['abort', 'profile', 'date', 'scope']) for (const previous of ['none', 'complete']) for (const outcome of ['return', 'throw']) {
    const { doc } = createDialogFixture();
    let model = initialModel(), handle, published = 0, result;
    const priorReport = previous === 'none' ? null : { status: 'complete', updated: 1,
        retrievedAt: new Date(2027, 0, 1, 12).getTime(), results: [{ profileId: 'a', trancheId: 'lot', status: 'updated' }] };
    model.priceReport = priorReport;
    const reports = [], label = `${change}/${previous}/${outcome}`;
    const gate = deferred(), controller = new AbortController(), guard = createNavigationGuard();
    const actions = createClosePriceActions({ guard, getModel: () => model, source: () => ({}), waitStartup: async () => {},
        onReport: report => { reports.push(report); model.priceReport = report; }, publish: () => published++, coordinator: async ({ progress }) => {
            progress({ status: 'running', completed: 0, total: 1, results: [] });
            await gate.promise;
            if (outcome === 'throw') throw new Error('Veralteter Kursauftrag');
            return { status: 'complete', updated: 1, retrievedAt: model.now.getTime(),
                results: [{ profileId: 'a', trancheId: 'lot', status: 'updated' }] };
        } });
    const dialog = requestOverviewMonthConfirmation({ doc, model, people: model.cashPeople, getModel: () => model,
        priceActions: { refresh: async options => { result = await actions.refresh({ ...options, signal: controller.signal }); return result; } },
        onReady: value => { handle = value; } });
    handle.activate('prices');
    const task = doc.querySelector('[data-close-prices-refresh]').fire('click'); await tick();
    assertEqual(model.priceReport.status, 'running', label + ': Laufender Koordinator meldet echten Fortschritt');
    if (change === 'abort') controller.abort();
    if (change === 'profile') model.activeId = 'b';
    if (change === 'date') model.now = new Date(2027, 0, 3);
    if (change === 'scope') model.scope = { key: 'other', ids: ['b'] };
    gate.resolve(); await task;
    assertEqual(result, null, label + ': Veraltete Fortsetzung liefert kein Ergebnis');
    assert(reports.at(-1) === priorReport && model.priceReport === priorReport, label + ': Seitenbericht von vor dem Start wiederhergestellt');
    assert(!overviewPriceLabel(model).includes('Kurse werden aktualisiert'), label + ': Keine liegengebliebene Fortschrittsbeschriftung');
    assert(!overviewPricesDone(model), label + ': Veralteter Auftrag bestätigt keine Kurse');
    const row = doc.querySelector('[data-close-dialog-step="prices"]');
    assert(row.dataset.visited === 'true' && row.querySelector('.close-dialog-step-pill').textContent === 'angesehen', label + ': Fortschritt bestätigt nur den angesehenen Kursschritt');
    assert(!dialogElements(handle.root).some(node => node.textContent.includes('Kurse werden aktualisiert')), label + ': Dialog verwirft Fortschrittsanzeige');
    assertEqual(published, 0, label + ': Veralteter Bericht überschreibt keinen Sitzungsstand');
    assertEqual(guard.reasons().length, 0, label + ': Auftrag gibt Guard frei');
    assert(!actions.running && !handle.busy, label + ': Auftrag und Dialog sind wieder bedienbar');
    handle.close(false); await dialog;
}
for (const change of ['abort', 'profile', 'date', 'scope']) {
    let model = initialModel(), calls = 0, published = 0;
    model.priceReport = null;
    const reports = [], startup = deferred(), controller = new AbortController();
    const actions = createClosePriceActions({ guard: createNavigationGuard(), getModel: () => model, source: () => ({}),
        waitStartup: () => startup.promise, publish: () => published++,
        onReport: report => { reports.push(report); model.priceReport = report; }, coordinator: async () => { calls++; } });
    const task = actions.refresh({ signal: controller.signal }); await tick();
    assertEqual(model.priceReport.status, 'waiting', change + ': Dialog wartet auf Sitzungsabruf');
    if (change === 'abort') controller.abort();
    if (change === 'profile') model.activeId = 'b';
    if (change === 'date') model.now = new Date(2027, 0, 3);
    if (change === 'scope') model.scope = { key: 'other', ids: ['b'] };
    startup.resolve(); assertEqual(await task, null, change + ': Schon beim Warten ungültiger Auftrag verworfen');
    assert(reports.at(-1) === null && model.priceReport === null, change + ': Auch waiting bleibt nicht im Seitenbericht');
    assert(!overviewPriceLabel(model).includes('Kurse werden aktualisiert') && !overviewPricesDone(model), change + ': Wartender Abbruch erzeugt weder Fortschritt noch Haken');
    assertEqual(calls + published, 0, change + ': Kein Koordinatorstart und keine Veröffentlichung nach Warteabbruch');
}
for (const status of ['complete', 'waiting', 'started', 'loading', 'running', 'unavailable']) {
    const model = initialModel(), startup = deferred(), records = new Map();
    const sessionStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
    const priorReport = status === 'unavailable' ? { status: 'offline', updated: 0, results: [] } : { status: 'started', results: [] };
    model.priceReport = priorReport;
    const win = status === 'unavailable' ? { get sessionStorage() { throw new Error('Sitzungsspeicher gesperrt'); } } : { sessionStorage };
    const reports = [];
    let calls = 0, published = 0;
    const actions = createClosePriceActions({ win, guard: createNavigationGuard(), getModel: () => model,
        waitStartup: () => startup.promise, onReport: report => { reports.push(report); model.priceReport = report; },
        coordinator: async () => { calls++; }, publish: () => published++ });
    const task = actions.refresh(); await tick();
    // Der unabhängige Startupbesitzer darf während der Wartezeit seinen Sitzungsbericht bestätigen.
    publishStartupPriceReport({ status, updated: 1, retrievedAt: new Date(2027, 0, 1, 12).getTime(),
        results: [{ profileId: 'a', trancheId: 'lot', status: 'updated' }] }, sessionStorage);
    const saved = sessionStorage.getItem(STARTUP_PRICE_SESSION_KEY);
    model.now = new Date(2027, 0, 3);
    startup.resolve(); assertEqual(await task, null, status + ': Veralteter wartender Dialogauftrag endet');
    assertEqual(reports.at(-1)?.status ?? null, status === 'complete' ? 'complete' : status === 'unavailable' ? 'offline' : null, status + ': Abgeschlossener Sitzungsbericht oder vorheriger Stand wird wiederhergestellt');
    assertEqual(sessionStorage.getItem(STARTUP_PRICE_SESSION_KEY), saved, status + ': Veralteter Dialogauftrag lässt Sitzungsbytes unverändert');
    assert(!overviewPriceLabel(model).includes('Kurse werden aktualisiert') && !overviewPricesDone(model), status + ': Keine veraltete Fortschrittsanzeige und kein falscher Haken');
    assertEqual(calls + published, 0, status + ': Kein veralteter Abruf oder Sitzungswrite');
}
{
    let calls = 0; const startup = deferred(), model = initialModel();
    const actions = createClosePriceActions({ guard: createNavigationGuard(), getModel: () => model, source: () => ({}),
        waitStartup: () => startup.promise, publish: () => {}, coordinator: async () => { calls++; return { status: 'offline', updated: 0, results: [] }; } });
    const task = actions.refresh(); await tick(); assertEqual(calls, 0, 'Manueller Abruf wartet auf laufenden Startupauftrag');
    startup.resolve(); await task; assertEqual(calls, 1, 'Danach genau ein wiederholbarer Dialogauftrag');
}
