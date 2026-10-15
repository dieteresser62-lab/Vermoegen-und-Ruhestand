import { createBalanceCloseCoordinator, createAnnualMonthSession } from '../app/balance/balance-close-coordinator.js';
import { createAnnualModalHandlers } from '../app/balance/balance-annual-modal.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { createManualAnnualQuote } from '../app/balance/balance-annual-marketdata.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turns = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const oldDoc = globalThis.document;
try {
    const { doc } = createDialogFixture(); globalThis.document = doc;
    const guard = createNavigationGuard();
    let context = { profile: 'Max', scope: 'Max+Erika', date: '2027-01-02' }, tick;
    const counts = { inflation: 0, etf: 0, cape: 0 }; let failETF = true, jobs = deferred();
    let importsBound = 0, importWaited = false;
    const modal = createAnnualModalHandlers({ getLastUpdateResults: () => null, isCommitActive: () => false, dom: { inputs: {} } });
    const imports = { bindRoot() { importsBound++; }, wait: async () => { await jobs.promise; importWaited = true; }, abort() {} };
    const values = { inflation: createManualAnnualValue('inflation', '2.5', 2026), etf: createManualAnnualQuote(160.4, 'calendar-year:2026'),
        cape: { capeRatio: 28.5, capeSource: 'Test', capeFetchStatus: 'ok_primary' } };
    const coordinator = createBalanceCloseCoordinator({ guard, readContext: () => context, getImports: () => imports,
        showPreparation: modal.showAnnualPreparation, schedule: fn => { tick = fn; return 1; }, unschedule() {},
        fetchers: Object.fromEntries(Object.keys(counts).map(type => [type, async () => { counts[type]++; if (type === 'etf' && failETF) throw new Error('Kurs fehlt'); return values[type]; }])) });
    const options = { targetYear: 2026, model: { occasion: { previousYear: 2026, previousMonth: 12 }, now: new Date(2027, 0, 2) },
        people: [{ id: 'Max', name: 'Max', value: 18000 }, { id: 'Erika', name: 'Erika', value: 12000 }],
        validatePrice: value => ({ manualPrice: createManualAnnualQuote(value, 'calendar-year:2026').price }) };
    const preparing = coordinator.prepare(options); await turns();
    const root = doc.getElementById('balanceAnnualClose');
    assertEqual(root.querySelectorAll('[data-close-dialog-step]').length, 6, 'Jahresdialog hat sechs Vorbereitungsschritte');
    const symbols = dialogElements(root).filter(node => node.className === 'close-dialog-step-symbol').map(node => node.textContent);
    assertEqual(symbols.join(','), '✓,2,–,4,5,6', 'Haken steht für angesehen; offene und unbestätigte Schritte behalten ihre Nummer');
    assert(!root.querySelector('[data-close-dialog-step="month"]') && !root.querySelector('[data-close-dialog-group]'), 'Kein siebter Schritt und keine Jahres-/Januargruppe');
    assert(!doc.getElementById('annualMonthStepConfirm'), 'Vorabzugang bietet keine schreibende Monatsbestätigung');
    assertEqual(root.querySelectorAll('[data-tagesgeld-person]').length, 2, 'Jahresendstand für jede Haushaltsperson genau einmal');
    assert(root.querySelector('[data-close-prices-details]') && root.querySelector('[data-overview-expenses-file]') === null, 'Lokale Kursdetails bleiben im Jahresdialog erreichbar; leere Mitglieder erzeugen keine fremden CSVfelder');
    assertEqual(importsBound, 1, 'Importcontroller am gemeinsamen Jahresdialog gebunden');
    assert(!guard.reasons().some(reason => reason.phase !== 'idle'), 'Vorbereitung hält keine blockierende Jahreslease');
    assert(doc.getElementById('annualConfirmBtn').disabled, 'Fehlender ETF sperrt bis Retry oder Handkurs');
    failETF = false; await doc.getElementById('annualMarketRetryBtn').fire('click');
    assertEqual(JSON.stringify(counts), JSON.stringify({ inflation: 1, etf: 2, cape: 1 }), 'Retry lädt allein den fehlgeschlagenen Datentyp');
    assert(doc.getElementById('annualConfirmBtn').disabled, 'Vorbereitete Werte allein ersetzen weder Pflichtbesuche noch Tagesgeldbestätigung');
    for (const id of ['prices', 'expenses', 'budget', 'cash', 'market']) await root.querySelector(`[data-close-dialog-next="${id}"]`).fire('click');
    assertEqual(root.querySelector('[data-close-dialog-activate="preview"]').getAttribute('aria-expanded'), 'true', 'Alle fünf Weiterknöpfe öffnen den tatsächlich nächsten Jahresschritt');
    assert(doc.getElementById('annualConfirmBtn').disabled, 'Weiter darf unbestätigtes Tagesgeld ansehen lassen, gibt aber den Hauptknopf nicht frei');
    await prepareCloseFixture(doc);
    assert(!doc.getElementById('annualConfirmBtn').disabled, 'Sechs besuchte Vorbereitungsschritte und bestätigtes Tagesgeld geben Jahresstart frei');
    const cash = root.querySelector('[data-tagesgeld-person]'); cash.value = '19.000'; await cash.fire('input');
    await root.querySelector('[data-tagesgeld-apply]').fire('click');
    assert(guard.reasons().some(reason => reason.dirty), 'Cashentwurf meldet nur Dirty-Lease');
    await doc.getElementById('annualConfirmBtn').fire('click');
    assertEqual(await coordinator.prepare(options), null, 'Doppelklick erzeugt keinen zweiten Vorbereitungsauftrag');
    let completed = false; preparing.then(() => { completed = true; }); await turns();
    assert(!completed && !importWaited, 'Jahresübergabe wartet vollständig auf Importfolgejob');
    jobs.resolve(); const prepared = await preparing;
    assert(importWaited, 'Importfolgejob vor Jahresübergabe abgeschlossen');
    for (const type of Object.keys(values)) assertEqual(JSON.stringify(prepared.preparedMarketData[type]), JSON.stringify(values[type]),
        type + ': Jahresübergabe erhält unveränderte validierte Werte und Quellen der Vorbereitung');
    assertEqual(prepared.cash.values.Max, 19000, 'Cashentwurf bleibt einmalig an Bestätigung gebunden');
    assertEqual(guard.reasons().length, 0, 'Vorbereitungsbesitzer ist vor Jahreslease freigegeben');
    modal.showUpdateResultModal({ targetYear: 2026, startTime: 1, endTime: 2, confirmed: true, errors: [] });
    assertEqual(root.querySelectorAll('[data-tagesgeld-person]').length, 0, 'Ergebnis entfernt Entwurfsfelder und verhindert doppelte IDs');
    await doc.getElementById('annualCloseBtn').fire('click');

    jobs = deferred(); jobs.resolve(); failETF = true;
    const manual = coordinator.prepare(options); await turns();
    await prepareCloseFixture(doc);
    doc.getElementById('annualHandPrice').value = '166.5'; await doc.getElementById('annualHandPrice').fire('input');
    await doc.getElementById('annualConfirmBtn').fire('click'); const hand = await manual;
    assertEqual(hand.manualPrice, 166.5, 'Handkurs wird bestätigt');
    assert(!hand.preparedMarketData.etf, 'Handkurs verwendet den bestehenden separaten manualPrice-Vertrag');
    assertEqual(JSON.stringify(hand.preparedMarketData), JSON.stringify({ inflation: values.inflation, cape: values.cape }),
        'Handkurs ersetzt ausschließlich ETF; erfolgreiche Inflation/CAPE bleiben mit Quellen erhalten');
    modal.showUpdateResultModal({ targetYear: 2026, startTime: 1, endTime: 2, errors: [] }); await doc.getElementById('annualCloseBtn').fire('click');
    for (const patch of [{ profile: 'Erika' }, { scope: 'Max' }, { date: '2027-02-01' }]) {
        const cancelled = coordinator.prepare(options); await turns(); context = { ...context, ...patch }; tick();
        assertEqual(await cancelled, null, 'Profil-, Scope- oder Datumswechsel invalidiert Entwurf');
        assert(!doc.getElementById('balanceAnnualClose'), 'Invalidierung entfernt Host und Abrufbindung');
    }
    coordinator.dispose();
{
    let context = 'initial', ready, accept, tick, closeCalls = 0;
    const late = deferred(), guard = createNavigationGuard();
    const coordinator = createBalanceCloseCoordinator({ readContext: () => context, guard,
        schedule: fn => { tick = fn; return 1; }, unschedule() {},
        fetchers: { inflation: () => late.promise },
        showPreparation: options => { ready = options; options.onReady({ close() { closeCalls++; accept(null); }, root: {}, updateMarketData() { throw new Error('LATE_RESULT_APPLIED'); } }); return new Promise(resolve => { accept = resolve; }); } });
    const pending = coordinator.prepare({ targetYear: 2026 }); context = 'changed'; tick(); late.resolve({ rate: 2.5 });
    assertEqual(await pending, null, 'Abbruch verwirft auch späten Abruf'); await turns();
    assertEqual(closeCalls, 1, 'Invalidierung schließt genau einmal');
    assert(ready.signal.aborted, 'Späte Antworten an abgebrochene Generation gebunden'); coordinator.dispose();
}
} finally { globalThis.document = oldDoc; }

// Kontrollierte Finalisierungs-/Summarybarrieren und reiner Monatsretry.
{
    const guard = createNavigationGuard(), year = deferred(), summaryGate = deferred(), write = deferred();
    const events = [];
    const scope = { kind: 'household', ids: ['Max', 'Erika'], key: 'Haushalt' };
    const people = [{ id: 'Max', name: 'Max', value: 19000, cashRaw: '19000', historyRaw: 'neu' },
        { id: 'Erika', name: 'Erika', value: 12000, cashRaw: '12000', historyRaw: null }];
    const model = { activeId: 'Max', scope, now: new Date(2027, 0, 2), members: people,
        occasion: { kind: 'monthly', annualState: 'done', month: '2026-12', previousYear: 2026, previousMonth: 12 },
        summary: { status: 'fest', year: 2027, scope, monthlyWithdrawal: 1500, monthlyBudget: 2500 } };
    const cash = { people: people.map(person => ({ ...person, cashRaw: 'alt' })), values: { Max: 19000, Erika: 12000 } };
    let writes = 0, pending = null;
    const deps = { targetYear: 2026, annualSnapshotId: 'jahr', cash, readModel: () => model, guard,
        readPending: () => pending, capturePeople: () => people,
        archive: { listSnapshots: async () => writes ? [{ id: 'monat', label: 'Monatsabschluss 2026-12' }] : [] },
        confirmSummary: async () => { events.push('summary'); await summaryGate.promise; return true; },
        store: async request => { writes++; events.push('month'); assertEqual(request.cash.people[0].cashRaw, '19000', 'Monat verwendet neue Rohbelegbindung'); await write.promise; return true; } };
    const lease = guard.register(Symbol('jahr'), { read: () => ({ phase: 'commit' }) });
    const opening = (async () => { await year.promise; lease.unregister(); events.push('finalized'); return createAnnualMonthSession(deps); })();
    await turns(); assertEqual(writes, 0, 'Vor Jahresfinalisierung kein Monatswrite');
    year.resolve(); await turns(); assertEqual(events.join(','), 'finalized,summary', 'Finalisierung und Leasefreigabe vor Summarybestätigung');
    assertEqual(writes, 0, 'Unbestätigte Summary startet keinen Monatswrite');
    summaryGate.resolve(); const session = await opening;
    assertEqual(writes, 0, 'Sitzungserzeugung allein schreibt keinen Monat; der Seitenbinder finalisiert automatisch');
    const { doc } = createDialogFixture(); const old = globalThis.document; globalThis.document = doc;
    let action = 0;
    const results = { targetYear: 2026, confirmed: true, monthSession: session, inflation: { year: 2026, rate: 2.5, source: 'Spielbereich · synthetisch' }, etf: { price: 160, source: 'Spielbereich · synthetisch' }, cape: { capeRatio: 28, capeSource: 'Spielbereich · synthetisch' }, openAction: () => { action++; } };
    const modal = createAnnualModalHandlers({ getLastUpdateResults: () => results, getModel: () => model, isCommitActive: () => false });
    modal.showAnnualContinuation({ targetYear: 2026 });
    const root = doc.getElementById('balanceAnnualClose'); modal.showUpdateResultModal(results);
    assert(doc.getElementById('balanceAnnualClose') === root && root.open, 'Jahreserfolg erhält dieselbe offene Instanz');
    assert(!root.querySelector('[data-annual-combined-result]'), 'Jahreserfolg allein erzeugt kein Monatsergebnis C');
    assertEqual(doc.getElementById('annualConfirmBtn').textContent, 'Erneut versuchen', 'Offener Monat bietet den reinen Monatsretry');
    assert(dialogElements(root).some(node => node.textContent.includes('Der Dezember-Abschluss konnte nicht gespeichert werden.')), 'Teilfehlermeldung nennt den noch offenen Monat');
    const protocol = doc.getElementById('annualResults');
    for (let click = 0; click < 2; click++) {
        await doc.getElementById('annualShowLog').fire('click');
        assert(!protocol.parent.hidden && doc.getElementById('annualResults') === protocol, 'Protokoll erhält sichtbare Ergebnisidentität ohne Neuaufbau');
        const text = dialogElements(protocol).map(node => node.textContent).join(' ');
        assert(text.includes('Inflation 2026') && text.includes('ETF-Schlusskurs') && text.includes('CAPE') && text.split('Spielbereich · synthetisch').length === 4, 'Sichtbares Protokoll enthält alle drei Jahresquellen genau einmal');
        assertEqual(writes, 0, 'Protokoll startet keine Monatsbereitstellung');
    }
    await doc.getElementById('annualCloseBtn').fire('click'); modal.handleShowUpdateLog();
    assert(dialogElements(doc.getElementById('annualResults')).some(node => node.textContent.includes('Inflation 2026')), 'Wiederöffnung zeigt tatsächliche Jahresdaten ohne weiteren Klick');
    const reopenedRoot = doc.getElementById('balanceAnnualClose');
    const saving = doc.getElementById('annualConfirmBtn').fire('click'); await turns();
    await doc.getElementById('annualConfirmBtn').fire('click');
    assertEqual(await session.save(), false, 'Doppelklick während Monatscommit abgewiesen');
    await reopenedRoot.fire('keydown', { key: 'Escape' }); assert(reopenedRoot.open, 'Escape bleibt während Monatscommit gesperrt');
    assertEqual(writes, 1, 'Genau ein Monatswriter nach dem Retryklick');
    write.resolve(); await saving;
    assertEqual(session.phase, 'done', 'Dauerhafter Monat beendet Schreibphase');
    assertEqual(guard.reasons().length, 0, 'Monatscommit gibt eigene Lease frei');
    assertEqual(reopenedRoot.querySelector('[data-annual-combined-result]').dataset.annualCombinedResult, 'C', 'Gemeinsames Ergebnis C');
    const text = dialogElements(reopenedRoot).map(node => node.textContent).join(' ');
    assert(text.includes('Tagesgeld Max') && text.includes('Tagesgeld Erika') && text.includes('19.000 €') && text.includes('12.000 €') && text.includes('Wiederherstellungspunkte für Jahr und Monat angelegt'), 'Ergebnis nennt Personen und getrennte Belege ohne technische IDs');
    await doc.getElementById('annualShowLog').fire('click'); assertEqual(writes, 1, 'Protokoll bleibt schreibfrei');
    assert(!doc.getElementById('annualShowAction') && reopenedRoot.querySelector('[data-annual-action-result]'), 'Handlungsanzeige steht unmittelbar im Ergebnis ohne Folgeknopf');
    await doc.getElementById('annualConfirmBtn').fire('click');
    assert(!reopenedRoot.open && writes === 1, 'Fertig beendet Dialog ohne Fachwrite');
    modal.showUpdateResultModal(results); await doc.getElementById('annualConfirmBtn').fire('click');
    assertEqual(writes, 1, 'Fertig bleibt nach Wiederöffnung schreibfrei');
    globalThis.document = old;
    for (const invalid of ['pending', 'recovery', 'summary', 'lease', 'cash']) {
        let blocker;
        if (invalid === 'pending') pending = {};
        if (invalid === 'recovery') model.recovery = true;
        if (invalid === 'summary') model.summary.year = 2026;
        if (invalid === 'cash') people[0].value = 1;
        if (invalid === 'lease') blocker = guard.register(Symbol('fremd'), { read: () => ({ phase: 'commit' }) });
        let rejected = false; try { await createAnnualMonthSession(deps); } catch { rejected = true; }
        assert(rejected, invalid + ': keine Monatsfreigabe'); assertEqual(writes, 1, invalid + ': kein weiterer Monatswrite');
        pending = null; model.recovery = false; model.summary.year = 2027; people[0].value = 19000; blocker?.unregister();
    }
    const stale = await createAnnualMonthSession(deps); people[0].cashRaw = 'fremd';
    assertEqual(await stale.save(), false, 'Fremde Rohbelegänderung wird vor Writer abgewiesen');
}

// Produktiver Kalenderpfad mit offenen Jahresmetadaten und bestätigtem Monatsauftrag.
{
    const { projectOverview, projectAnnualClosePreparation } = await import('../app/overview/overview-model.js');
    const { overviewScope, OVERVIEW_SUMMARY_KEY, summaryEntryKey } = await import('../app/overview/overview-storage.js');
    const { CONFIG } = await import('../app/balance/balance-config.js');
    const old = globalThis.document;
    try {
        for (const month of [0, 9]) {
            const { doc } = createDialogFixture(); globalThis.document = doc;
            const now = new Date(2027, month, 6, 12), scope = overviewScope('single', ['a']);
            const store = { version: 1, activeYear: 2026, years: {
                2026: { months: { 12: { profiles: { a: { categories: { Kosten: -100 } } } } } },
                2027: { months: { 9: { profiles: { a: { categories: { Kosten: -200 } } } } } } } };
            const metadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null };
            const data = { depot_tranchen: '[]', profile_tagesgeld: '100', balance_expenses_v1: JSON.stringify(store),
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata }),
                [OVERVIEW_SUMMARY_KEY]: JSON.stringify({ version: 1, entries: { [summaryEntryKey(2027, scope)]: {
                    year: 2027, scope, monthlyWithdrawal: 50, monthlyBudget: 220, createdAt: now.toISOString() } } }) };
            const registry = { version: 1, profiles: { a: { meta: { name: 'A' }, data } } };
            const readModel = () => projectOverview({ registry, activeId: 'a', liveData: data, now });
            const model = projectAnnualClosePreparation(readModel(), { store });
            assertEqual(model.occasion.annualState, 'open', 'Persistierte offene Jahresmetadaten bleiben fällig');
            assertEqual(model.expenses.month, month === 0 ? 12 : 9, 'Produktive Jahresvorbereitung verwendet echten Vormonat');
            assertEqual(model.expenses.spent, month === 0 ? 100 : 200, 'Produktive Monatsausgaben folgen dem Vormonat');
            assertEqual(model.annual.year, 2026, 'Jahresauswertung bleibt 2026');
            const people = [{ id: 'a', name: 'A', value: 100 }];
            const modal = createAnnualModalHandlers({ getLastUpdateResults: () => null, getModel: readModel, isCommitActive: () => false });
            const pending = modal.showAnnualPreparation({ targetYear: 2026, model, people });
            const root = doc.getElementById('balanceAnnualClose');
            assertEqual(doc.getElementById('balanceAnnualCloseTitle').textContent, `${month === 0 ? 'Dezember' : 'September'} und Jahr 2026 abschließen`, 'Produktiver Jahresdialog nennt tatsächlichen Monat und Abschlussjahr');
            assert(root.querySelector('[data-overview-expenses-file]')?.dataset.overviewExpensesFile === 'a', 'Ausgelagerter CSVzugang bleibt im produktiven Jahresdialog erhalten');
            assert(dialogElements(root).some(node => node.textContent === `Ausgaben ${month === 0 ? 'Dezember' : 'September'}`), 'Ausgabenschritt stimmt mit Dialogtitel überein');
            await doc.getElementById('annualCloseBtn').fire('click'); await pending;
            metadata.lastCommittedPeriod = 'calendar-year:2026'; data[CONFIG.STORAGE.LS_KEY] = JSON.stringify({ annualPeriodMetadata: metadata });
            const failureText = `Jahr 2026 gespeichert. Der ${month === 0 ? 'Dezember' : 'September'}-Abschluss konnte nicht gespeichert werden.`;
            modal.showUpdateResultModal({ targetYear: 2026, confirmed: true, monthError: 'Monatssitzung konnte nicht erzeugt werden.' });
            assert(dialogElements(doc.getElementById('annualResults')).some(node => node.textContent === failureText), 'Fehler vor Sitzungserzeugung nennt den tatsächlichen Abschlussmonat aus dem Modell');
            await doc.getElementById('annualCloseBtn').fire('click');
            let written, failMonth = true;
            const session = await createAnnualMonthSession({ targetYear: 2026, annualSnapshotId: 'jahr', cash: { people, values: { a: 100 } }, readModel,
                capturePeople: () => people, archive: { listSnapshots: async () => written ? [{ id: 'monat', label: `Monatsabschluss ${written.month}` }] : [] },
                store: async request => {
                    if (failMonth) throw new Error('Monatswrite fehlgeschlagen.');
                    written = structuredClone(request); return true;
                } });
            const results = { targetYear: 2026, confirmed: true, monthSession: session };
            modal.showUpdateResultModal(results);
            assertEqual(doc.getElementById('annualConfirmBtn').textContent, 'Erneut versuchen', 'Offener Monat bietet auch im produktiven Kalenderpfad nur den Monatsretry');
            assert(dialogElements(doc.getElementById('balanceAnnualClose')).some(node => node.textContent === failureText), 'Offener Monat nennt den tatsächlichen Abschlussmonat aus dem Monatsauftrag');
            assert(!doc.querySelector('[data-close-dialog-step="month"]'), 'Monatsretry hat keinen siebten Schritt');
            await doc.getElementById('annualConfirmBtn').fire('click');
            assertEqual(results.monthError, 'Monatswrite fehlgeschlagen.', 'Produktiver Kalenderpfad erreicht den fehlgeschlagenen Monatswrite');
            assert(dialogElements(doc.getElementById('balanceAnnualClose')).some(node => node.textContent === failureText), 'Fehlgeschlagener Monatswrite behält den tatsächlichen Abschlussmonat in der Teilfehlermeldung');
            assert(!doc.querySelector('[data-annual-combined-result]'), 'Fehlgeschlagener Monatswrite zeigt keinen Gesamterfolg');
            failMonth = false;
            await doc.getElementById('annualConfirmBtn').fire('click');
            assertEqual(written.month, month === 0 ? '2026-12' : '2027-09', 'Produktiver Monatsauftrag bleibt am tatsächlichen Vormonat gebunden');
            assertEqual(root.isConnected, false, 'Geschlossener Vorbereitungshost bleibt entfernt');
            const resultRoot = doc.getElementById('balanceAnnualClose');
            assert(resultRoot.querySelector('[data-close-dialog-result-month]') && resultRoot.querySelector('[data-annual-combined-result]'), 'Jahresergebnis verwendet den gemeinsamen Monatsteil C');
            await doc.getElementById('annualConfirmBtn').fire('click');
        }
    } finally { globalThis.document = old; }
}

// Ohne Monatsmodell darf die Teilfehlermeldung keinen Monat erfinden.
{
    const { doc } = createDialogFixture(), old = globalThis.document; globalThis.document = doc;
    try {
        const modal = createAnnualModalHandlers({ getModel: () => ({}), isCommitActive: () => false });
        modal.showUpdateResultModal({ targetYear: 2026, confirmed: true, monthError: 'Monatssitzung fehlt.' });
        assert(dialogElements(doc.getElementById('annualResults')).some(node => node.textContent === 'Jahr 2026 gespeichert. Der Monatsabschluss konnte nicht gespeichert werden.'), 'Fehlendes Monatsmodell zeigt einen neutralen Wortlaut');
        await doc.getElementById('annualCloseBtn').fire('click');
    } finally { globalThis.document = old; }
}

// Ergebnisveröffentlichung und echter Protokollklick teilen denselben flüchtigen Stand.
{
    const { createAnnualHandlers } = await import('../app/balance/balance-binder-annual.js');
    const { doc } = createDialogFixture(), previousDoc = globalThis.document; globalThis.document = doc;
    try {
        const button = doc.createElement('button'); button.id = 'btnJahresUpdateLog'; button.disabled = true; doc.body.append(button);
        let last = null;
        const annual = createAnnualHandlers({ dom: { inputs: {}, controls: { btnJahresUpdateLog: button } }, appState: {},
            update() {}, debouncedUpdate() {}, getLastUpdateResults: () => last, setLastUpdateResults: value => { last = value; }, getModel: () => ({}),
            navigationLifecycle: { run: async (_, execute) => execute({ commit() {} }) } });
        button.addEventListener('click', () => annual.handleShowUpdateLog());
        assertEqual(annual.publishResult({ status: 'cancelled' }), null, 'Abbruch ohne Ergebnis veröffentlicht keinen Abschluss');
        assert(button.disabled && last === null, 'Abbruch gibt keinen unbestätigten Protokollknopf frei');
        for (const [status, source] of [['already_committed', 'Erste Erfolgsquelle'], ['incomplete_recovery', 'Aktuelle Fehlerquelle'], ['already_committed', 'Neue Erfolgsquelle']]) {
            annual.publishResult({ status, results: { startTime: 1, endTime: 2,
                inflation: { year: 2026, rate: 2.5, source }, errors: status === 'incomplete_recovery' ? [{ step: 'ETF', error: 'Aktueller Abruffehler' }] : [] } });
            assertEqual(button.disabled, false, status + ': Protokollknopf freigegeben');
            await button.fire('click');
            const text = dialogElements(doc.getElementById('annualResults')).map(node => node.textContent).join(' ');
            assert(text.includes('Protokoll') && text.includes(source), 'Echter Klick zeigt ausschließlich das aktuelle Abschlussprotokoll');
            assertEqual(last.confirmed, status === 'already_committed', 'Fehlerergebnis bestätigt keinen Jahresabschluss');
            await doc.getElementById('annualCloseBtn').fire('click');
        }
    } finally { globalThis.document = previousDoc; }
}

// Echte Seitenbindung: Wiederstart ohne Dialog/Fachwrite; Statusgegenproben.
{
    const { overviewAnnualFixture, annualUntil } = await import('./overview-annual-close.test.mjs?fixture');
    const { installAnnualLocks, installBalanceStorageForm, readyAnnualFixture } = await import('./helpers/balance-storage-fixtures.mjs');
    const { UIBinder, initUIBinder, preserveUIBinderStateForTests } = await import('../app/balance/balance-binder.js');
    const { UIRenderer } = await import('../app/balance/balance-renderer.js');
    const { CONFIG } = await import('../app/balance/balance-config.js');
    const { PersistenceFacade } = await import('../app/shared/persistence-facade.js');
    const { getAppTestDate, setAppTestDate } = await import('../app/shared/app-clock.js');
    const { EngineAPI } = await import('../engine/index.mjs');
    const old = { doc: globalThis.document, win: globalThis.window, toast: UIRenderer.toast, date: getAppTestDate() };
    const restoreLocks = installAnnualLocks(), restoreBinder = preserveUIBinderStateForTests();
    let f;
    try {
        setAppTestDate('2027-01-02'); f = await overviewAnnualFixture();
        const closing = f.open(); await prepareCloseFixture(f.doc);
        await annualUntil(() => f.doc.getElementById('annualConfirmBtn') && !f.doc.getElementById('annualConfirmBtn').disabled);
        await f.doc.getElementById('annualConfirmBtn').fire('click'); await closing;
        await f.doc.getElementById('annualCloseBtn').fire('click');
        const dom = installBalanceStorageForm(JSON.parse(f.storage.getItem(CONFIG.STORAGE.LS_KEY)).inputs, readyAnnualFixture().values);
        dom.controls = { jahresabschlussBtn: f.doc.createElement('button'), btnJahresUpdate: f.doc.createElement('button'), btnJahresUpdateLog: f.doc.createElement('button') };
        dom.expenses = { yearSelect: { value: '2026' } }; dom.containers = {}; dom.outputs = {};
        f.win.EngineAPI = EngineAPI;
        initUIBinder(dom, {}, () => ({ ok: true }), () => {});
        const notices = []; UIRenderer.toast = (text, kind) => notices.push({ text, kind });
        const evidence = async () => JSON.stringify({ records: await f.persistence.readPersistedRecords(), batches: f.batches, snapshots: [...f.snapshots] });
        const before = await evidence();
        const result = await UIBinder.handleJahresabschluss();
        assertEqual(result.status, 'already_committed', 'Balancebinder erreicht echten Wiederstartstatus');
        assertEqual(JSON.stringify(notices), JSON.stringify([{ text: 'Die Jahresperiode 2026 wurde bereits abgeschlossen.', kind: 'info' }]), 'Balancebinder meldet genau einen Infoinhalt aus periodId');
        assert(!f.doc.getElementById('balanceAnnualClose')?.open, 'Balance-Wiederstart öffnet keinen Dialog');
        assertEqual(await evidence(), before, 'Balance-Wiederstart erhält Fachbytes, Batches und Snapshots');
        const handlers = preserveUIBinderStateForTests().handlers;
        const close = handlers.snapshots.handleJahresabschluss;
        try {
            for (const status of ['cancelled', 'invalid', 'not_applicable', 'incomplete_recovery', 'already_committed']) {
                notices.length = 0;
                const results = status === 'already_committed' ? { targetYear: 2026, startTime: 1, endTime: 2, errors: [] } : undefined;
                handlers.snapshots.handleJahresabschluss = async () => ({ status, periodId: 'calendar-year:2026', results });
                await UIBinder.handleJahresabschluss();
                assertEqual(notices.length, 0, status + ': kein zusätzlicher Bereits-abgeschlossen-Toast');
                const showsDialog = Boolean(results) || status === 'incomplete_recovery';
                assertEqual(Boolean(f.doc.getElementById('balanceAnnualClose')?.open), showsDialog, status + ': Ergebnis beziehungsweise ruhige Recoverymeldung wird sichtbar');
                if (showsDialog) await f.doc.getElementById('annualCloseBtn').fire('click');
                assertEqual(await evidence(), before, status + ': Bindergegenprobe erzeugt keinen Fachwrite');
            }
            notices.length = 0;
            handlers.snapshots.handleJahresabschluss = async () => ({ status: 'already_committed', periodId: 'calendar-year:2025' });
            await UIBinder.handleJahresabschluss();
            assertEqual(notices[0].text, 'Die Jahresperiode 2025 wurde bereits abgeschlossen.', 'Balancehinweis folgt periodId unabhängig vom aktuellen Jahr');
        } finally { handlers.snapshots.handleJahresabschluss = close; handlers.closeCoordinator.dispose(); }
    } finally {
        f?.close(); restoreBinder(); restoreLocks(); UIRenderer.toast = old.toast;
        globalThis.document = old.doc; globalThis.window = old.win; setAppTestDate(old.date); PersistenceFacade.resetPersistenceRuntimeForTests();
    }
}
