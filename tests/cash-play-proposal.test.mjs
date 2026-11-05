import { calculateCashProposal, createCashProposals } from '../app/overview/overview-cash-proposal.js';
import { createTagesgeldFields } from '../app/shared/tagesgeld-fields.js';
import { requestOverviewMonthConfirmation, projectOverviewMonthSteps } from '../app/overview/overview-month-confirmation.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createAnnualMonthSession } from '../app/shared/annual-close-session.js';
import { createManualAnnualValue } from '../app/shared/annual-marketdata.js';
import { initializeProbelaufPage } from '../app/shared/probelauf-state.js';
import { captureCashPeople, liveCashData } from '../app/profile/profile-cash-update.js';
import { projectProfileWealthHistory } from '../app/profile/profile-wealth-history.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectOverview } from '../app/overview/overview-model.js';
import { storeMonthProvision, readMonthProvision, overviewScope, OVERVIEW_MONTH_KEY } from '../app/overview/overview-storage.js';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { importExpenses } from '../app/balance/balance-expenses-import.js';
import { EngineAPI } from '../engine/index.mjs';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';

const oldDate = getAppTestDate();
const listen = (node, type, fn) => node.addEventListener(type, fn);
const pure = { person: { id: 'max', name: 'Max Mustermann', value: 10000, confirmedDate: '2026-10-31' },
    data: { profile_rente_monatlich: '1200', profile_sonstige_einkuenfte: '300', profile_rentenbeginn: '2026-11-15' },
    end: '2026-11-30', fallbackStart: '2026-11-01', personCount: 2,
    expenses: { years: { 2026: { months: { 11: { profiles: { max: { categories: { Wohnen: -900, Erstattung: 100 } } } } } } } },
    withdrawalForYear: year => ({ value: 400, source: `laut Plan ${year}` }) };
const suggestion = calculateCashProposal(pure);
assertEqual(suggestion.value, 10708.22, 'Ausgangsstand + Rente + Einkünfte − importierte Ausgaben + 1-%-Zins, ohne Entnahme');
assert(suggestion.explanation.includes('+ Rente') && suggestion.explanation.includes('− Ausgaben') && !suggestion.explanation.includes('− Entnahmen'), 'Erklärtext nennt genau die Kontorechnung');
assertEqual(calculateCashProposal({ ...pure, withdrawalForYear: () => ({ value: 90000, source: 'erfunden' }) }).value, suggestion.value, 'Entnahmehöhe ändert den Spielwert nicht');
assertEqual(calculateCashProposal({ ...pure, withdrawalForYear: () => { throw new Error('Plan darf nicht gelesen werden'); } }).value, suggestion.value, 'F-6: Spielwert ruft die Entnahmequelle nicht mehr auf');
assertEqual(JSON.stringify(suggestion), JSON.stringify(calculateCashProposal(pure)), 'Spielwert und Herleitung sind deterministisch');
assertEqual(calculateCashProposal({ ...pure, end: '2026-11-15' }).pension, 600, 'Teilmonat und Rentenbeginnmonat werden zeitanteilig berechnet');
assertEqual(calculateCashProposal({ ...pure, data: { ...pure.data, profile_rentenbeginn: '2026-12-01' } }).pension, 0, 'Vor Rentenbeginn zählt keine Rente');
assertEqual(calculateCashProposal({ ...pure, person: { ...pure.person, confirmedDate: '2026-11-30' } }).value, 10000, 'Bestätigter Zeitraum zählt nicht erneut');
assert(calculateCashProposal({ ...pure, person: { ...pure.person, value: 0 }, data: {}, expenses: pure.expenses }).error, 'Negativer Vorschlag wird nicht still auf null begrenzt');

// F-6: beschädigter Jahresplan wird für den Spielwert nicht gelesen; aktive Einkommen kommen aus Livewerten.
{
    const records = { ...pure.data, rs_profiles_v1: JSON.stringify({ profiles: { max: { data: { profile_rente_monatlich: '9999' } } } }),
        annual_plan_record_v1: '{kaputt' };
    const reads = [];
    const proposals = createCashProposals({ people: [pure.person], model: { now: new Date(2026, 10, 30), activeId: 'max',
        scope: overviewScope('single', ['max']), members: [{ id: 'max', belongs: true }], occasion: { previousYear: 2026, previousMonth: 11 } },
        controller: { initialize() {}, state: { active: true, phase: 'active', testDate: null }, runtime: { canContinue: true } },
        storage: { getItem: key => { reads.push(key); return records[key] ?? null; } } });
    assertEqual(proposals.max.value, suggestion.value + 800, 'F-6: beschädigter Plan sperrt den Spielwert nicht; fehlende Ausgaben zählen null');
    assert(!reads.includes('annual_plan_record_v1'), 'F-6: Vorschlag liest keinen Jahresplan');
    assert(!Object.hasOwn(proposals.max, 'withdrawals'), 'F-6: Spielwert enthält keine ungenutzte Entnahme mehr');
    assertEqual(proposals.max.pension, 1200, 'Aktives Einkommen wird aus Livewerten statt der veralteten Registrykopie gelesen');
    assert(proposals.max.explanation.includes('Ausgabenkonto') && !proposals.max.explanation.includes('− Entnahmen'), 'Spielrechnung erklärt das Ausgabenkonto ohne zusätzlichen Entnahmeabzug');
    const model = { now: new Date(2026, 10, 30), summary: { year: 2026, monthlyWithdrawal: 400 },
        occasion: { previousYear: 2026, previousMonth: 10 }, planComparison: { year: 2026, recordStatus: 'valid' } };
    assert(projectOverviewMonthSteps(model).find(step => step.id === 'cash').closeAmountText.includes('laut Plan 2026'), 'F-6: lesbarer Plan behält die Monatsinformation');
    model.planComparison.recordStatus = 'invalid';
    assertEqual(projectOverviewMonthSteps(model).find(step => step.id === 'cash').closeAmountText, '', 'F-6: beschädigter Plan unterdrückt die Entnahme-Infozeile');
}

// Ein unveränderter Vorschlag bleibt auch beim gleichen Ausgangsbetrag ein Spielwert.
{
    const { doc } = createDialogFixture();
    const person = pure.person;
    const fields = createTagesgeldFields({ doc, people: [person], monthly: true, closePresentation: true,
        proposals: { max: { ...suggestion, value: person.value } } });
    doc.body.append(fields.root); fields.bind(listen);
    assert(fields.ready, 'Vorbelegter Spielwert erfüllt FR-4 auch beim gleichen Betrag');
    assertEqual(fields.read().playValues.max.source, 'spielwert', 'Gleicher Vorschlagsbetrag erhält die Spielwertherkunft');
    fields.updateProposals({ max: suggestion });
    assert(fields.ready && fields.inputs[0].value === '10.708,22', 'Unberührtes Feld folgt geändertem Vorschlag');
    fields.inputs[0].value = '9.876,54'; await fields.inputs[0].fire('input');
    assertEqual(fields.read().values.max, 9876.54, 'Eigene Eingabe bleibt möglich');
    assert(!fields.read().playValues, 'Eigene abweichende Eingabe erhält keine Erzeugerkennzeichnung');
}

try {
    for (const kind of ['tauri', 'indexeddb', 'localstorage']) {
        const seed = createMusterHaushaltRecords('2026-11-02');
        const f = await playFixture(kind, seed), realBefore = f.realBytes();
        let controller = await f.boot();
        const { doc } = createDialogFixture();
        const getModel = () => projectOverview({ registry: JSON.parse(storage.getItem('rs_profiles_v1')),
            activeId: storage.getItem('rs_current_profile'), liveData: liveCashData(storage), now: new Date(2026, 11, 2) });
        assertEqual(Object.keys(createCashProposals({ controller, model: getModel(), people: [] })).length, 0, `${kind}: echter Betrieb bietet keine Vorschläge`);
        await controller.start(() => ({ source: 'copy', testDate: '2026-12-02' }));
        await f.boot();
        controller = await initializeProbelaufPage({ doc, win: f.win });
        let model = getModel(), people = captureCashPeople({ ids: model.scope.ids, activeId: model.activeId });
        const beforeDraft = JSON.stringify(await P.readPersistedRecords());
        const proposals = createCashProposals({ doc, model, people });
        assertEqual(Object.keys(proposals).length, 2, `${kind}: echte Spielkopie liefert beide Personenvorschläge`);
        assert(Object.values(proposals).every(value => !value.error && value.explanation.includes('Zins: 1 %')), `${kind}: Vorschläge enthalten Herleitung`);
        for (const unavailable of [null, { ...controller, state: { ...controller.state, phase: 'starting' } },
            { ...controller, state: { ...controller.state, phase: 'restoring' } }, { ...controller, blocked: true },
            { ...controller, state: { ...controller.state, testDate: '2026-12-03' } }]) {
            assertEqual(Object.keys(createCashProposals({ controller: unavailable, model, people })).length, 0, `${kind}: inaktiver, alter, gesperrter oder zeitlich fremder Zustand bietet keine Vorschläge`);
        }
        assertEqual(Object.keys(createCashProposals({ controller: { ...controller, state: { ...controller.state, testDate: null } }, model, people })).length, 2, `${kind}: Stand heute mit testDate null bietet Spielvorschläge`);
        assertEqual(JSON.stringify(await P.readPersistedRecords()), beforeDraft, `${kind}: Berechnung ist schreibfrei`);
        let handle;
        const cancelled = requestOverviewMonthConfirmation({ doc, model, people, confirmDiscard: async () => true, onReady(value) { handle = value; } });
        handle.activate('cash');
        await handle.requestClose(); await cancelled;
        assertEqual(JSON.stringify(await P.readPersistedRecords()), beforeDraft, `${kind}: Abbruch nach Vorschlagsübernahme schreibt nichts`);

        let accepted;
        const job = requestOverviewMonthConfirmation({ doc, model, people, onReady(value) { handle = value; },
            onAccept: async value => { accepted = value.cash; return storeMonthProvision({ month: '2026-11', scope: model.scope, expectedProfileId: model.activeId, cash: value.cash }, { guard: null }); } });
        handle.activate('cash');
        const imported = await importExpenses({ controller, guard: null, targets: [{ profileId: people[0].id, year: 2026, month: 11,
            text: async () => 'Kategorie;Betrag\nWohnen;-750,00\n' }], confirm: async () => true });
        assertEqual(imported.status, 'saved', `${kind}: Ausgaben gelangen über den normalen Import in den Vorschlag`);
        model = getModel(); handle.update(model);
        assertEqual(doc.querySelector('[data-tagesgeld-person]').value.replaceAll('.', '').replace(',', '.'), String(createCashProposals({ doc, model, people })[people[0].id].value), `${kind}: unberührtes Feld folgt dem Importvorschlag ohne Bestätigung`);
        await prepareCloseFixture(doc);
        await doc.querySelector('[data-overview-month-accept]').fire('click');
        assertEqual(handle.root.dataset.monthResult, 'confirmed', `${kind}: Monatsdialog bestätigt den echten Store`);
        let persisted = await P.readPersistedRecords();
        const month = readMonthProvision(persisted[OVERVIEW_MONTH_KEY], '2026-11', model.scope);
        assertEqual(month.playValues[people[0].id].source, 'spielwert', `${kind}: Monatsprotokoll hält Spielwert und Herleitung fest`);
        assert(Object.values(month.playValues).every(value => value.explanation), `${kind}: Monatsprotokoll speichert die Herleitung`);
        assertEqual(month.playValues[people[0].id].expenses, 725, `${kind}: importierte Novemberausgaben zählen für die 29 Tage seit dem Ausgangsstand`);
        assertEqual(persisted.profile_tagesgeld, String(accepted.values[model.activeId]), `${kind}: normaler Cashwriter speichert angenommenen Betrag`);
        assertEqual(JSON.parse(persisted.profile_cash_history_v1).entries.at(-1).source, 'spielwert', `${kind}: Verlaufseintrag trägt Spielwertkennzeichen`);
        const registry = JSON.parse(persisted.rs_profiles_v1);
        registry.profiles[model.activeId].data = { ...registry.profiles[model.activeId].data, ...liveCashData(storage) };
        const history = projectProfileWealthHistory(registry, model.profiles, { prices: { version: 1, symbols: {} }, events: [], startDate: '2026-01-01', today: '2026-12-02', period: 'all' });
        assert(history.cashPlayValues, `${kind}: Verlaufsprojektion erhält das Spielwertkennzeichen`);
        await doc.querySelector('[data-overview-month-accept]').fire('click'); await job;
        assertEqual(f.realBytes(), realBefore, `${kind}: Berechnung, Abbruch und Monatsabschluss lassen echte Daten und Sicherungen bytegleich`);

        await controller.changeDate('2027-01-02'); await f.boot();
        const annualDoc = createDialogFixture().doc;
        controller = await initializeProbelaufPage({ doc: annualDoc, win: f.win });
        model = { ...getModel(), now: new Date(2027, 0, 2), occasion: { kind: 'annual', closingYear: 2026, previousYear: 2026, previousMonth: 12 } };
        people = captureCashPeople({ ids: model.scope.ids, activeId: model.activeId });
        let annualHandle;
        const ui = createAnnualCloseDialog({ document: annualDoc, getModel: () => model, isCommitActive: () => false,
            projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
        const annualJob = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady(value) { annualHandle = value; } });
        const marketData = Object.fromEntries([['inflation', '2'], ['etf', '130'], ['cape', '28']].map(([type, value]) => [type, createManualAnnualValue(type, value, 2026)]));
        annualHandle.updateMarketData({ values: marketData, errors: {} });
        annualHandle.activate('cash');
        await prepareCloseFixture(annualDoc);
        await annualDoc.getElementById('annualConfirmBtn').fire('click');
        const options = await annualJob;
        assert(Object.values(options.cash.playValues).every(value => value.through === '2026-12-31' && value.from === '2026-12-03'), `${kind}: Jahresvorschlag zählt nur den Rest seit dem Monatsstand`);
        // Der Jahresdienst erwartet den vom Koordinator vorbereiteten Pending-Marker.
        const state = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY));
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025',
            pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'sd1-year', phase: 'writes_started' } };
        storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state)); await P.flush();
        const committed = await commitAnnualPlanUpdate({ targetYear: 2026, marketData, engineApi: EngineAPI, cash: options.cash });
        assert(committed.results.confirmed, `${kind}: produktiver Jahreswriter bestätigt angenommene Spielwerte`);
        persisted = await P.readPersistedRecords();
        assertEqual(persisted.profile_tagesgeld, String(options.cash.values[model.activeId]), `${kind}: Jahreswerte dauerhaft bestätigt`);
        model = projectOverview({ registry: JSON.parse(persisted.rs_profiles_v1), activeId: model.activeId, liveData: persisted, now: new Date(2027, 0, 2) });
        const session = await createAnnualMonthSession({ targetYear: 2026, cash: options.cash, readModel: () => model,
            capturePeople: () => captureCashPeople({ ids: model.scope.ids, activeId: model.activeId }), guard: null });
        assertEqual(JSON.stringify(session.request.cash.playValues), JSON.stringify(options.cash.playValues), `${kind}: automatischer Dezemberteil erhält Spielwertherkunft`);
        await session.save();
        ui.showUpdateResultModal({ ...committed.results, targetYear: 2026, monthSession: session, showProtocol: true });
        const protocol = annualDoc.getElementById('annualResults');
        assert(protocol.children.some(node => node.textContent.includes('Spielwert') && node.textContent.includes('Zins: 1 %')), `${kind}: Jahresprotokoll zeigt Spielwert samt Herleitung`);
        await annualDoc.getElementById('annualConfirmBtn').fire('click');
        assertEqual(f.realBytes(), realBefore, `${kind}: Jahresabschluss und Dezemberteil lassen echte Daten und Sicherungen bytegleich`);
        await controller.end(async () => true); await f.boot();
        assertEqual(f.realBytes(), realBefore, `${kind}: Verwerfen erhält echte Rohbytes und Sicherungspunkte`);
        P.resetPersistenceForTests();
    }
} finally { P.resetPersistenceForTests(); setAppTestDate(oldDate); }
