import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { createBalanceCloseCoordinator } from '../app/balance/balance-close-coordinator.js';
import { createAnnualModalHandlers } from '../app/balance/balance-annual-modal.js';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { bindOverviewMonthClose, projectOverviewFromRecords } from '../app/overview/overview-main.js';
import { bindOverviewExampleExpenses, createOverviewExpensesWealthCapture } from '../app/overview/overview-example-expenses.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { getPageNavigationGuard } from '../app/shared/navigation-guard-dialog.js';
import { createProbelaufController } from '../app/shared/probelauf-state.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { bindProfileNavigationHandoff } from '../app/profile/profile-navigation.js';
import { EXAMPLE_EXPENSES_ICON_HTML } from '../app/shared/designsystem-icons.js';

function checkExampleButtons(root, month) {
    const one = root.querySelector('[data-overview-example-target="muster_a"]');
    const all = root.querySelector('[data-overview-example="all"]');
    const file = root.querySelector('[data-overview-expenses-file="muster_a"]');
    assert(one.parent && one.parent === file.parent, 'Dateifeld und Beispielknopf stehen im gemeinsamen Zeilencontainer');
    assertEqual(file.parent.className, 'close-dialog-file-row', 'Monats- und Jahresdialog nutzen dieselbe Importzeile');
    assert(one.className.includes('ds-icon-button') && one.children[0].innerHTML === EXAMPLE_EXPENSES_ICON_HTML, 'Dialogeinzelaktion ist kompakt mit gemeinsamem Kopiersymbol');
    assertEqual(one.title, `Beispielausgaben einspielen · ${month} 2026 · Max`, 'Dialogbeispiel nennt tatsächlichen Monat und Person');
    assertEqual(one.getAttribute('aria-label'), one.title, 'Dialogeinzelaktion hat vollständigen Bezeichner');
    assert(all.children[0].innerHTML === EXAMPLE_EXPENSES_ICON_HTML && all.children[1].textContent === 'Beispiele für alle', 'Dialogsammelknopf trägt dasselbe Symbol und kurzen Text');
    assertEqual(all.title, `Beispielausgaben einspielen · ${month} 2026 · alle Personen`, 'Dialogsammeltooltip benennt den vollständigen Umfang');
}

export const deferredImport = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
export async function boundedImport(job) {
    let timer;
    try { return await Promise.race([job, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Dialogimport ohne Abschluss')), 4000); })]); }
    finally { clearTimeout(timer); }
}
/** Dauerhafter Backendadapter; Import, Vorschau, Erfassung und Monatsstore sind produktiv. */
export async function overviewImportFixture({ quoteAge = 0, single = false, unselected = false, noLots = false, synthetic = false, probelauf = false, failWealth = null, referenceDate = '2026-10-08', onRefresh = () => {} } = {}) {
    const oldDate = getAppTestDate(), oldDoc = Object.getOwnPropertyDescriptor(globalThis, 'document'), oldWin = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const f = createDialogFixture(), doc = f.doc, win = { document: doc, location: { href: 'http://localhost/index.html?probelauf=1' } };
    doc.defaultView = win; globalThis.document = doc; globalThis.window = win;
    setAppTestDate(referenceDate);
    const seeded = createMusterHaushaltRecords('2026-09-01'), registry = JSON.parse(seeded.rs_profiles_v1);
    const time = new Date(`${referenceDate}T12:00:00`).getTime() / 1000;
    for (const profile of Object.values(registry.profiles)) {
        let lots = JSON.parse(profile.data.depot_tranchen);
        lots.forEach(lot => { lot.asOf = quoteAge === null ? null : time - quoteAge; });
        if (noLots || synthetic) lots = [];
        if (single || unselected) profile.meta.belongsToHousehold = !unselected && profile.meta.id === 'muster_a';
        if (noLots) {
            const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
            Object.assign(state.inputs, { depotwertAlt: 0, depotwertNeu: 0, geldmarktEtf: 0 }); profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        }
        if (synthetic) delete profile.data.depot_tranchen;
        else profile.data.depot_tranchen = JSON.stringify(lots);
    }
    // Außenprofil als Sentinel unabhängig vom Rechenumfang.
    registry.profiles.outside = { meta: { id: 'outside', name: 'Außen', belongsToHousehold: false }, data: { sentinel: 'unverändert' } };
    const records = { ...seeded, ...registry.profiles.muster_a.data, rs_profiles_v1: JSON.stringify(registry) };
    if (synthetic) delete records.depot_tranchen;
    const backend = new Map(Object.entries(records)), snapshots = new Map(), batches = [];
    let failure = failWealth, hold = null, corruptRead = false;
    const adapter = { name: 'Dialogimport-Backend', async open() {}, async loadAll() { const result = Object.fromEntries(backend); if (corruptRead) { corruptRead = false; delete result[CONFIG.STORAGE.LS_KEY]; } return result; },
        async readAll() { return Object.fromEntries(backend); },
        async saveBatch({ upserts, deletes }) {
            const wealth = upserts.some(([key, raw]) => key === CONFIG.STORAGE.LS_KEY && raw.includes('manual:2026-10-08'));
            if (wealth && hold) { hold.entered.resolve(); await hold.release.promise; }
            if (wealth && failure === 'write') { failure = null; throw new Error('Erfassungswrite fehlgeschlagen'); }
            deletes.forEach(key => backend.delete(key)); upserts.forEach(([key, value]) => backend.set(key, value)); batches.push(structuredClone(upserts));
            if (wealth && failure === 'readback') { failure = null; corruptRead = true; }
        }, async listSnapshots() { return [...snapshots.values()]; }, async readSnapshot(id) { return structuredClone(snapshots.get(id)); },
        async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); }, async deleteSnapshot(id) { snapshots.delete(id); } };
    P.resetPersistenceForTests(adapter); await P.init({ window: win, installLifecycleHooks: false, installTauriCloseHook: false });
    for (const id of ['overviewFocus', 'overviewFocusTitle', 'overviewMonthStatus', 'suiteNavigationStatus', 'navigationGuardDialog',
        'navigationGuardTitle', 'navigationGuardDescription', 'navigationGuardStay', 'navigationGuardLeave']) {
        const node = doc.createElement(id.includes('Dialog') ? 'dialog' : 'div'); node.id = id; doc.body.append(node);
    }
    const guard = getPageNavigationGuard(doc, win);
    let controller = createProbelaufController({ doc, win, guard, demoLoader: null, reload() {}, restoreReload() {} }); await controller.initialize(); setAppTestDate(referenceDate);
    if (probelauf) {
        await controller.start(() => ({ source: 'copy', testDate: referenceDate })); guard.revokeNative();
        P.resetPersistenceForTests(adapter); await P.init({ window: win, installLifecycleHooks: false, installTauriCloseHook: false });
        controller = createProbelaufController({ doc, win, guard, demoLoader: null, reload() {}, restoreReload() {} }); await controller.initialize();
    }
    let model, imports, months;
    const refresh = () => {
        const liveData = Object.fromEntries(Array.from({ length: storage.length }, (_, i) => [storage.key(i), storage.getItem(storage.key(i))]));
        let projected = projectOverviewFromRecords({ registry: JSON.parse(storage.getItem('rs_profiles_v1')), activeId: storage.getItem('rs_current_profile'), liveData, now: new Date(`${referenceDate}T12:00:00`) });
        // Der Dialogauftrag stammt vom produktiven Projektor, nicht von einer zweiten Speicherregel.
        model = imports.projectModel(months.projectModel(projected));
        const focus = doc.getElementById('overviewFocus');
        focus.children.slice().forEach(child => child.remove());
        const button = doc.createElement('button'); button.dataset.overviewMonth = ''; button.dataset.overviewMonthConfirm = ''; focus.append(button);
        months.syncButtons(); imports.syncButtons(); onRefresh();
    };
    months = bindOverviewMonthClose({ doc, win, getModel: () => model, refresh, getImports: () => imports });
    const capture = createOverviewExpensesWealthCapture({ doc, win, refresh, report: text => imports.reportWealth(text),
        ...(failure === 'preview' ? { profiles: () => { throw new Error('Vorschauquelle nicht lesbar'); } } : {}) });
    imports = bindOverviewExampleExpenses({ doc, win, controller, getModel: () => model, refresh, wealthCapture: capture }); refresh();
    let monthJob;
    return { ...f, win, guard, backend, batches, snapshots, capture, imports, controller, storage, get model() { return model; }, refresh,
        async open() { monthJob = doc.querySelector('[data-overview-month]').fire('click'); assert(doc.getElementById('overviewMonthConfirmation')?.open, 'Produktiver Binder öffnet geführten Dialog: ' + JSON.stringify(model.occasion)); },
        preview: () => doc.getElementById('expensesImportPreview'),
        async csv({ id = 'muster_a', text = async () => 'Kategorie;Betrag\nLebensmittel;-120,50\n', accept = true } = {}) {
            await doc.querySelector('[data-close-dialog-activate="expenses"]')?.fire('click');
            const field = doc.querySelector(`[data-overview-expenses-file="${id}"]`); field.files = [{ text }]; field.value = 'same.csv';
            const job = field.fire('change');
            await this.waitPreview(job); assertEqual(field.value, '', 'Dateifeld wird für gleiche Auswahl zurückgesetzt');
            await doc.querySelector(accept ? '[data-expenses-preview-accept]' : '[data-expenses-preview-cancel]').fire('click'); await boundedImport(job);
        },
        async waitPreview(job) {
            // DOM-Doppel ohne Browser: begrenzte Microtask-/Timerfortsetzung bis echtes showModal.
            for (let count = 0; count < 100 && !this.preview()?.open; count++) await new Promise(resolve => setTimeout(resolve, 1));
            if (!this.preview()?.open) { await boundedImport(job); throw new Error('Produktvorschau nicht geöffnet'); }
        },
        async dismiss() {
            await doc.getElementById('overviewMonthConfirmation')?.fire('cancel');
            if (doc.getElementById('navigationGuardDialog').open) await doc.getElementById('navigationGuardLeave').fire('click');
            await boundedImport(monthJob);
        },
        async restart() {
            P.resetPersistenceForTests(adapter); await P.init({ window: win, installLifecycleHooks: false, installTauriCloseHook: false }); refresh();
        },
        holdWealth() { hold = { entered: deferredImport(), release: deferredImport() }; return hold; },
        get failure() { return failure; }, set failure(value) { failure = value; },
        async close() {
            hold?.release.resolve(); imports.abort();
            const dialog = doc.getElementById('overviewMonthConfirmation'); if (dialog?.open) await dialog.fire('cancel');
            if (doc.getElementById('navigationGuardDialog').open) await doc.getElementById('navigationGuardLeave').fire('click');
            await boundedImport(imports.wait()); if (monthJob) await boundedImport(monthJob);
            P.resetPersistenceForTests(); setAppTestDate(oldDate);
            if (oldDoc) Object.defineProperty(globalThis, 'document', oldDoc); else delete globalThis.document;
            if (oldWin) Object.defineProperty(globalThis, 'window', oldWin); else delete globalThis.window;
        } };
}

for (const accept of [false, true]) {
    const f = await overviewImportFixture({ single: accept });
    try {
        await f.open(); const before = JSON.stringify(Object.fromEntries(f.backend));
        const cash = f.doc.querySelector('[data-tagesgeld-person]'); cash.value = '18.000,125'; await cash.fire('input');
        await f.csv({ accept });
        assertEqual(cash.value, '18.000,125', 'Importrefresh erhält existierenden Cashentwurf');
        if (!accept) assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Vorschauabbruch erhält alle dauerhaften Bytes');
        else {
            const expenses = JSON.parse(f.backend.get('balance_expenses_v1'));
            assertEqual(f.doc.querySelector('[data-close-dialog-activate="budget"]').getAttribute('aria-expanded'), 'true', 'Auch ein einzelner Personenimport öffnet unmittelbar Budget');
            assertEqual(f.doc.querySelector('[data-close-dialog-step="cash"]').dataset.visited, 'false', 'Import überspringt und besucht kein Tagesgeld');
            assertEqual(expenses.years[2026].months[9].profiles.muster_a.categories.Lebensmittel, -120.5, 'CSV bestätigt richtiges Personenziel und Abschlussmonat dauerhaft');
            assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Ausgaben importiert.'), 'CSV-Erfolg bleibt getrennt vom Folgekanal');
            const state = JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY));
            assertEqual(state.wealthHistory.entries.filter(entry => entry.asOf === '2026-10-08').length, 1, 'Produktiver CSV-Folgejob erzeugt genau einen Tagespunkt');
        }
        assert(f.doc.activeElement === f.doc.querySelector(accept ? '[data-close-dialog-activate="expenses"]' : '[data-overview-expenses-file="muster_a"]'),
            accept ? 'Importabschluss fokussiert den sichtbaren Ausgabenschritt statt eines eingeklappten Dateifelds' : 'Vorschauabbruch fokussiert das aktuelle sichtbare Dateifeld');
    } finally { await f.close(); }
    assertEqual(f.guard.reasons().length, 0, 'Alle Import- und Monatsleases enden sauber');
}

for (const change of ['profile', 'scope', 'date']) {
    const f = await overviewImportFixture();
    try {
        await f.open();
        assertEqual(f.doc.querySelectorAll('[data-overview-example]').length, 0, 'URL allein zeigt im echten Dialog keine Beispiele');
        const before = f.backend.get('balance_expenses_v1'), field = f.doc.querySelector('[data-overview-expenses-file="muster_a"]');
        field.files = [{ text: async () => 'Kategorie;Betrag\nTest;-100\n' }];
        const job = field.fire('change'); await f.waitPreview(job);
        const preview = f.preview();
        assertEqual(f.backend.get('balance_expenses_v1'), before, 'Echte offene Vorschau hat noch keinen Fachwrite');
        if (change === 'profile') { storage.setItem('rs_current_profile', 'muster_b'); storage.setItem('rs_active_profile', 'muster_b'); }
        if (change === 'scope') { const registry = JSON.parse(storage.getItem('rs_profiles_v1')); registry.profiles.muster_b.meta.belongsToHousehold = false; storage.setItem('rs_profiles_v1', JSON.stringify(registry)); }
        if (change === 'date') setAppTestDate('2026-10-09');
        if (change !== 'date') f.refresh();
        else f.imports.projectModel({ ...f.model, now: new Date(2026, 9, 9, 12) });
        await boundedImport(job); await preview.querySelector('[data-expenses-preview-accept]').fire('click');
        assertEqual(f.backend.get('balance_expenses_v1'), before, 'Verspätete Vorschauzustimmung nach Kontextwechsel schreibt keine fremden Ausgaben: ' + change);
    } finally { await f.close(); }
}

{
    const f = await overviewImportFixture();
    try {
        await f.open();
        const dialog = f.doc.getElementById('overviewMonthConfirmation');
        let exports = 0, flushes = 0;
        bindProfileNavigationHandoff({ root: dialog, win: f.win, guard: f.guard, ready: () => true,
            exporter: () => { exports++; return true; }, flusher: () => { flushes++; return P.flush(); } });
        const cash = f.doc.querySelector('[data-tagesgeld-person]'); cash.value = '19.000'; await cash.fire('input');
        const details = dialog.querySelector('[data-close-prices-details]'); details.open = true;
        const expenses = dialog.querySelector('[data-close-expenses-details]'); expenses.open = true;
        f.refresh();
        assert(dialog.open && cash.value === '19.000', 'Lokale Details erhalten offenen Dialog und Cashentwurf');
        assert(dialog.querySelector('[data-close-prices-details]').open && dialog.querySelector('[data-close-expenses-details]').open, 'Modellrefresh erhält geöffnete lokale Details');
        assertEqual(exports + flushes, 0, 'Detailansichten erzeugen weder Handoff noch Flush');
        assertEqual(f.win.location.href, 'http://localhost/index.html?probelauf=1', 'Lokale Details verlassen das Dokument nicht');
        assert(!dialog.querySelector('a[href="#kursdetails"]') && !dialog.querySelector('a[href="depot-tranchen-manager.html"]'), 'Prüfschritte benutzen keine externe Detailnavigation');

    } finally { await f.close(); }
}

{
    const f = await overviewImportFixture({ single: true });
    try {
        await f.open();
        const cash = f.doc.querySelector('[data-tagesgeld-person]'); cash.value = '19000'; await cash.fire('input');
        await f.csv();
        const imported = Object.fromEntries(f.backend);
        await f.dismiss();
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), JSON.stringify(imported), 'Verwerfen entfernt ausschließlich den Cashentwurf, nicht CSV oder Vermögenspunkt');
        assertEqual(f.backend.get('overview_month_provision_v1'), imported.overview_month_provision_v1, 'Verwerfen schreibt keinen Monatshaken');
        await f.restart(); await f.open();
        assertEqual(f.doc.querySelector('[data-tagesgeld-person]').value, '18.000', 'Wiederöffnung nach Backendneustart folgt bestätigter Cashquelle');
        assert(f.model.expenses.complete && f.model.expenses.spent === 120.5, 'CSV-Ausgaben bleiben nach Wiederöffnung und Backendneustart vollständig');
        assertEqual(f.backend.get(CONFIG.STORAGE.LS_KEY), imported[CONFIG.STORAGE.LS_KEY], 'Bestätigter Vermögenspunkt bleibt nach Neustart bytegleich');
    } finally { await f.close(); }
}
{
    const f = await overviewImportFixture();
    try {
        await f.open(); const before = JSON.stringify(Object.fromEntries(f.backend)), text = deferredImport();
        const field = f.doc.querySelector('[data-overview-expenses-file="muster_a"]'); field.files = [{ text: () => text.promise }];
        const job = field.fire('change');
        await f.dismiss(); text.resolve('Kategorie;Betrag\nVerspätet;-200\n'); await boundedImport(job);
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Dialogschluss während Dateitextwartung verhindert jeden verspäteten Importwrite');
        assertEqual(f.guard.reasons().length, 0, 'Dateiwartungsabbruch beendet alle Guardbesitzer ohne Kreiswarten');
    } finally { await f.close(); }
}

// Derselbe echte Import- und Folgejob während der schreibfreien Jahresvorbereitung.
for (const failWealth of [null, 'preview']) {
    const f = await overviewImportFixture({ referenceDate: '2027-01-02', failWealth });
    let coordinator;
    try {
        assertEqual(f.model.occasion.annualState, 'open', 'Echte Haushaltsprojektion hat offenes Vorjahr');
        const modal = createAnnualModalHandlers({ getLastUpdateResults: () => null, getModel: () => f.model, isCommitActive: () => false });
        coordinator = createBalanceCloseCoordinator({ readContext: () => [f.model.activeId, f.model.scope.key, f.model.now.toDateString()],
            getImports: () => f.imports, guard: f.guard, showPreparation: modal.showAnnualPreparation,
            fetchers: { inflation: async () => ({ rate: 2.5, source: 'Test' }), etf: async () => ({ price: 160, source: 'Test' }),
                cape: async () => ({ capeRatio: 28, capeSource: 'Test', capeFetchStatus: 'ok_primary' }) } });
        const preparing = coordinator.prepare({ targetYear: 2026, model: f.model, getModel: () => f.model,
            people: captureCashPeople({ storage, ids: f.model.scope.ids, activeId: f.model.activeId }) });
        const root = f.doc.getElementById('balanceAnnualClose');
        const cash = root.querySelector('[data-tagesgeld-person]'); cash.value = '19.000'; await cash.fire('input');
        assert(!f.guard.reasons().some(reason => reason.phase === 'preparing'), 'Jahresvorbereitung blockiert den echten CSV-Folgejob nicht');
        await f.csv();
        assert(JSON.parse(f.backend.get('balance_expenses_v1')).years[2026].months[12].profiles.muster_a.categories.Lebensmittel === -120.5,
            'Echter CSV-Import bestätigt Dezember während Jahresvorbereitung');
        assertEqual(cash.value, '19.000', 'Importrefresh erhält Jahresend-Cashentwurf');
        assert(root.open, 'Import und Folgejob lassen gemeinsamen Jahresdialog offen');
        assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Ausgaben importiert.'), 'CSV-Erfolg bleibt vom Folgefehler getrennt');
        if (failWealth) assert(f.doc.getElementById('overviewExpensesWealthStatus').textContent.includes('Vermögensstand nicht bestätigt'), 'Echter Folgefehler in eigenem Kanal');
        else assert(JSON.parse(f.backend.get(CONFIG.STORAGE.LS_KEY)).wealthHistory.entries.some(entry => entry.id === 'manual:2027-01-02'), 'Echter CSV-Folgejob bestätigt Vermögenspunkt ohne Eigenblockade');
        assertEqual(f.snapshots.size, 0, 'Lesende Jahresvorbereitung und CSV-Folgepunkt erzeugen keinen Jahres-Snapshot');
        root.querySelector('[data-tagesgeld-person]').value = '18.000'; await cash.fire('input');
        await f.doc.getElementById('annualCloseBtn').fire('click');
        assertEqual(await preparing, null, 'Jahresentwurf endet ohne Jahreswrite');
        assertEqual(f.guard.reasons().length, 0, 'Import und Jahresvorbereitung geben sämtliche Besitzer frei');
    } finally { coordinator?.dispose(); await f.close(); }
}

// Einzel- und Alle-Beispiele bleiben über den produktiven Jahresdialog erreichbar.
for (const target of ['muster_a', 'all']) {
    let coordinator;
    const f = await overviewImportFixture({ probelauf: true, synthetic: true, referenceDate: '2027-01-02', onRefresh: () => coordinator?.refresh() });
    try {
        // Balance liefert dem Adapter ein unprojiziertes Seitenmodell. Der
        // Vorbereitungsauftrag besitzt dagegen den echten Import-/Probelaufkontext.
        const modal = createAnnualModalHandlers({ getLastUpdateResults: () => null,
            getModel: () => { const { exampleExpensesAllowed, ...base } = f.model; return base; },
            priceActions: { refresh: async ({ progress }) => { progress(); } }, isCommitActive: () => false });
        coordinator = createBalanceCloseCoordinator({ readContext: () => [f.model.activeId, f.model.scope.key, f.model.now.toDateString()],
            getImports: () => f.imports, guard: f.guard, showPreparation: modal.showAnnualPreparation,
            fetchers: { inflation: async () => ({ rate: 2.5 }), etf: async () => ({ price: 160 }), cape: async () => ({ capeRatio: 28 }) } });
        const pending = coordinator.prepare({ targetYear: 2026, model: f.model, getModel: () => f.model });
        const root = f.doc.getElementById('balanceAnnualClose');
        const beforeQuotes = JSON.stringify(Object.fromEntries(f.backend));
        await root.querySelector('[data-close-prices-refresh]').fire('click');
        await root.querySelector('[data-close-dialog-activate="expenses"]').fire('click');
        assertEqual(root.querySelector('[data-close-dialog-activate="expenses"]').getAttribute('aria-expanded'), 'true', 'Jahresschritt 2 öffnet die erhaltenen Beispielzugänge');
        const find = () => root.querySelector(target === 'all' ? '[data-overview-example="all"]' : `[data-overview-example-target="${target}"]`);
        assert(find() && root.querySelector('[data-overview-expenses-file="muster_a"]'), 'Personenbeispiel, Alle-Knopf und CSV bleiben im aktiven Probelauf erreichbar');
        checkExampleButtons(root, 'Dezember');
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), beforeQuotes, 'Reine Kursanzeige schreibt keine Abschluss- oder Ausgabenrecords');
        for (const accept of [false, true]) {
            const before = JSON.stringify(Object.fromEntries(f.backend));
            const job = find().fire('click'); await f.waitPreview(job);
            assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Beispielvorschau im Jahresdialog schreibt noch nichts');
            await f.doc.querySelector(accept ? '[data-expenses-preview-accept]' : '[data-expenses-preview-cancel]').fire('click'); await boundedImport(job);
            if (!accept) assertEqual(JSON.stringify(Object.fromEntries(f.backend)), before, 'Beispielabbruch im Jahresdialog erhält sämtliche Backendbytes');
        }
        const store = JSON.parse(f.backend.get('balance_expenses_v1'));
        assert(store.years[2026].months[12].profiles.muster_a.source === 'probelauf-example', 'Bestätigtes Jahresbeispiel verwendet bestehenden Dienst und Dezemberziel');
        if (target === 'all') assert(store.years[2026].months[12].profiles.muster_b.source === 'probelauf-example', 'Alle-Jahresbeispiel bestätigt dieselben Haushaltsziele');
        else assert(!store.years[2026].months[12].profiles.muster_b, 'Einzelbeispiel schreibt keine fremde Person');
        assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Beispielausgaben importiert.'), 'Erfolg bleibt in den dialoglokalen Ausgaben sichtbar');
        assertEqual(root.querySelector(`[data-close-dialog-activate="${target === 'all' ? 'budget' : 'expenses'}"]`).getAttribute('aria-expanded'), 'true', 'Beispiel folgt derselben Teil-/Vollimportführung');
        if (target !== 'all') assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Es fehlt noch:'), 'Teilbeispiel nennt die fehlende Person');
        if (target !== 'all') {
            const job = root.querySelector('[data-overview-example-target="muster_b"]').fire('click');
            await f.waitPreview(job); await f.doc.querySelector('[data-expenses-preview-accept]').fire('click'); await boundedImport(job);
            assertEqual(root.querySelector('[data-close-dialog-activate="budget"]').getAttribute('aria-expanded'), 'true', 'Zweites Jahresbeispiel öffnet Budget trotz unvollständiger zwölf Monate');
        }
        assert(root.open && f.snapshots.size === 1, 'Beispielimport hält Jahresdialog offen und erzeugt keinen Jahressnapshot neben dem Probelaufbeleg');
        await f.doc.getElementById('annualCloseBtn').fire('click'); await pending;
    } finally { coordinator?.dispose(); await f.close(); }
}

// Derselbe Beispielimport über den echten Monatsdialog: einzeln und für alle.
for (const all of [false, true]) {
    const f = await overviewImportFixture({ probelauf: true, synthetic: true });
    try {
        await f.open();
        const root = f.doc.getElementById('overviewMonthConfirmation');
        await root.querySelector('[data-close-dialog-activate="expenses"]').fire('click');
        checkExampleButtons(root, 'September');
        const importExample = async selector => {
            const job = root.querySelector(selector).fire('click'); await f.waitPreview(job);
            await f.doc.querySelector('[data-expenses-preview-accept]').fire('click'); await boundedImport(job);
        };
        await importExample(all ? '[data-overview-example="all"]' : '[data-overview-example-target="muster_a"]');
        if (!all) {
            assertEqual(root.querySelector('[data-close-dialog-activate="expenses"]').getAttribute('aria-expanded'), 'true', 'Erstes Monatsbeispiel hält Ausgaben geöffnet');
            assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Es fehlt noch:'), 'Monatsbeispiel nennt fehlende Person');
            await importExample('[data-overview-example-target="muster_b"]');
        }
        assertEqual(root.querySelector('[data-close-dialog-activate="budget"]').getAttribute('aria-expanded'), 'true', 'Vollständiges Monatsbeispiel öffnet Budget');
        assert(root.querySelector('[data-overview-month-accept]').disabled, 'Beispiel gibt ohne Cashbestätigung keinen Monatsknopf frei');
        await f.dismiss();
    } finally { await f.close(); }
}

// Produktiver CSVbinder: beide Personen, Monats-/Jahresdialog und Knopfbesitz.
for (const annual of [false, true]) {
    let coordinator;
    const f = await overviewImportFixture({ referenceDate: annual ? '2027-01-02' : '2026-10-08', onRefresh: () => coordinator?.refresh() });
    let preparing;
    try {
        if (annual) {
            const modal = createAnnualModalHandlers({ getModel: () => f.model, isCommitActive: () => f.guard.reasons().some(reason => reason.phase === 'commit') });
            coordinator = createBalanceCloseCoordinator({ readContext: () => [f.model.activeId, f.model.scope.key], getImports: () => f.imports,
                guard: f.guard, showPreparation: modal.showAnnualPreparation,
                fetchers: Object.fromEntries([['inflation', '2.5'], ['etf', '160'], ['cape', '28']].map(([type, value]) => [type, async () => createManualAnnualValue(type, value, 2026)])) });
            preparing = coordinator.prepare({ targetYear: 2026, model: f.model, getModel: () => f.model,
                people: captureCashPeople({ storage, ids: f.model.scope.ids, activeId: f.model.activeId }) });
        } else await f.open();
        const root = f.doc.getElementById(annual ? 'balanceAnnualClose' : 'overviewMonthConfirmation');
        const accept = () => annual ? f.doc.getElementById('annualConfirmBtn') : root.querySelector('[data-overview-month-accept]');
        f.imports.syncButtons(); assert(accept().disabled, 'Importbinder respektiert unbesuchte Schritte und unbestätigtes Tagesgeld');
        await f.csv();
        assertEqual(root.querySelector('[data-close-dialog-activate="expenses"]').getAttribute('aria-expanded'), 'true', 'Person 1 hält den Ausgabenschritt geöffnet');
        assert(root.querySelector('[data-overview-expenses-file="muster_b"]'), 'Fehlende Person hat weiterhin ein Importfeld');
        assert(f.doc.getElementById('overviewExampleExpensesStatus').textContent.includes('Es fehlt noch: ' + f.model.members.find(p => p.id === 'muster_b').name), 'Importstatus nennt die fehlende Person');
        const bytes = JSON.stringify(Object.fromEntries(f.backend));
        await root.querySelector('[data-close-dialog-activate="budget"]').fire('click');
        assert(dialogElements(root.querySelector('[data-close-dialog-step="budget"]')).some(node => node.textContent?.includes('Ausgaben bisher: 120,50')), 'Budget zeigt den vorhandenen Teilbetrag');
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), bytes, 'Teilbetrag und Besuche schreiben keine Finanzdaten');
        f.imports.syncButtons(); assert(accept().disabled, 'Teilimport gibt den Hauptknopf nicht eigenständig frei');
        await f.csv({ id: 'muster_b' });
        assertEqual(root.querySelector('[data-close-dialog-activate="budget"]').getAttribute('aria-expanded'), 'true', 'Person 2 öffnet automatisch Budget');
        assertEqual(f.model.expenses.spent, 241, 'Vollständige Summe bleibt unverändert');
        await prepareCloseFixture(f.doc);
        f.imports.syncButtons(); assert(!accept().disabled, 'Alle Besuche und bestätigtes Tagesgeld geben den Hauptknopf frei');
        const commit = f.guard.register(Symbol('fremder-commit'), { read: () => ({ phase: 'commit' }) });
        f.refresh(); f.imports.syncButtons(); assert(accept().disabled, 'Aktiver Commit hält auch nach Refresh und syncButtons gesperrt');
        commit.unregister(); f.refresh(); f.imports.syncButtons(); assert(!accept().disabled, 'Commitende prüft die Dialogfreigabe erneut');
        const waiting = deferredImport();
        await root.querySelector('[data-close-dialog-activate="expenses"]').fire('click');
        const field = root.querySelector('[data-overview-expenses-file="muster_a"]'); field.files = [{ text: () => waiting.promise }];
        const importJob = field.fire('change'); f.imports.syncButtons();
        assert(accept().disabled, 'Laufender Import sperrt auch den zuvor freigegebenen Hauptknopf');
        waiting.resolve('Kategorie;Betrag\nLebensmittel;-120,50\n'); await f.waitPreview(importJob);
        await f.doc.querySelector('[data-expenses-preview-cancel]').fire('click'); await boundedImport(importJob);
        f.imports.syncButtons(); assert(!accept().disabled, 'Nach Importende prüft der Dialog erneut seine vollständige Bereitschaft');
        const texts = dialogElements(root).map(node => node.textContent || '').join(' ');
        assertEqual(texts.split('Alles bereit –').length - 1, 1, 'Bereitmeldung steht genau einmal über dem Hauptknopf');
        assert(!root.querySelector(`[data-close-dialog-next="${annual ? 'preview' : 'cash'}"]`), 'Letzter Vorbereitungsschritt ohne Weiter');
        if (annual) { await f.doc.getElementById('annualCloseBtn').fire('click'); await preparing; }
        else await f.dismiss();
    } finally { coordinator?.dispose(); await f.close(); }
}
