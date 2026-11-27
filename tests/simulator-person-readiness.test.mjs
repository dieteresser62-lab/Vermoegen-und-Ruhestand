import strict from 'node:assert/strict';
import { createSelectionDocument, addField } from './designsystem-selection-dom.mjs';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { updateStartPortfolioDisplay, getCommonInputs } from '../app/simulator/simulator-portfolio.js';
import { readPensionInputs } from '../app/simulator/simulator-input-pension.js';
import { readHouseholdPersonStatus, showPersonDataStatus } from '../app/shared/person-data-status.js';
import { startAutomaticBacktest } from '../app/simulator/simulator-auto-backtest.js';
import { personDataContextFor } from '../app/simulator/simulator-person-overrides.js';

const previous = { document: globalThis.document, window: globalThis.window, Date: globalThis.Date };
const NativeDate = globalThis.Date;
function documentFixture() {
    const doc = createSelectionDocument();
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};
    doc.querySelector = selector => doc.body.querySelector(selector);
    const create = doc.createElement;
    doc.createElement = tag => {
        const node = create(tag); node.append = (...children) => children.forEach(child => node.appendChild(child));
        node.focus = () => { doc.activeElement = node; }; node.showModal = () => { node.open = true; };
        node.close = () => { node.open = false; node.dispatchEvent({ type: 'close' }); }; return node;
    };
    for (const id of ['simProfileList', 'simProfileStatus', 'suiteHouseholdContext', 'p1StartAlter', 'r2StartAlter',
        'p1Geschlecht', 'r2Geschlecht', 'chkPartnerAktiv', 'simStartVermoegen', 'depotwertAlt', 'einstandAlt',
        'btButton', 'mcButton', 'displayPortfolioBreakdown', 'startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual', 'tagesgeld', 'geldmarktEtf']) addField(doc, id);
    doc.getElementById('suiteHouseholdContext').textContent = 'Haushalt wird geladen';
    return doc;
}
try {
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-10-07T12:00:00Z'])); } };
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = documentFixture();
    const { initializeSimulatorApp } = await import('../app/simulator/simulator-main-init.js');
    const startupBaselines = new Map();
    for (const live of [false, true]) for (const activeId of ['a', 'b']) {
        const person = birth => ({ profile_person_schema_version: '1', profile_geburtsdatum: birth,
            profile_geschlecht: 'm', profile_rente_monatlich: '1234.567', profile_sparer_pauschbetrag: '1000', profile_tagesgeld: '100000' });
        const a = person('1958-03-14'), b = { ...person('1961-03-14'), profile_geschlecht: 'w',
            profile_rente_monatlich: '1600', profile_rentenbeginn: '2027-07-01', profile_tagesgeld: '200000' };
        const records = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
            a: { meta: { id: 'a', name: 'Muster A', belongsToHousehold: true }, data: a },
            b: { meta: { id: 'b', name: 'Muster B', belongsToHousehold: true }, data: b }
        } }), rs_current_profile: activeId, rs_active_profile: activeId, ...(live ? (activeId === 'a' ? a : b) : {}) };
        PersistenceFacade.resetPersistenceForTests({ name: 'Startprobe', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() {} });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const doc = documentFixture(); globalThis.document = doc; globalThis.window = { addEventListener() {}, removeEventListener() {} };
        // Gegenprobe: Der gemeinsame Rechenleser hat vor der Profilübernahme noch keine Personenwerte.
        strict.throws(() => getCommonInputs(), /Personenalter fehlt/);
        await initializeSimulatorApp();
        assertEqual(window.__profileRecoveryBlocker, null, 'Vollständige Registry benötigt keine Recovery');
        assertEqual(Number(doc.getElementById('p1StartAlter').value), 67, 'Hauptperson im Planungsjahr 2026');
        assertEqual(Number(doc.getElementById('r2StartAlter').value), 64, 'Partner im Planungsjahr 2026');
        assert(doc.getElementById('suiteHouseholdContext').textContent.includes('Muster A, Muster B'), 'Haushalt wurde geladen');
        const inputs = getCommonInputs();
        assertEqual(inputs.startAlter, 67, 'Tatsächlicher gemeinsamer Leser verwendet Hauptalter');
        assertEqual(inputs.partner.startAlter, 64, 'Tatsächlicher gemeinsamer Leser verwendet Partneralter');
        assertEqual(inputs.renteMonatlich, 1234.567, 'Keine Rundung des übernommenen Rentenbetrags');
        assertEqual(inputs.partner.monatsrente, 1600, 'Partner behält seinen eigenen Rentenbetrag');
        assertEqual(inputs.partner.startInJahren, 1, 'Partner behält seinen eigenen Rentenbeginn');
        assertEqual(inputs.startVermoegen, 300000, 'Beide Vermögen werden unabhängig vom aktiven Profil kombiniert');
        const context = personDataContextFor(inputs);
        assertEqual(context.persons.find(person => person.role === 'primary').profileId, 'a', 'Erstes Haushaltsmitglied bleibt Person 1');
        assertEqual(context.persons.find(person => person.role === 'partner').profileId, 'b', 'Zweites Haushaltsmitglied bleibt Partner');
        const baseline = startupBaselines.get(live);
        if (baseline) {
            strict.deepEqual(inputs, baseline.inputs, 'Gemeinsame Backtest-/Monte-Carlo-Eingabe ist mit A oder B aktiv identisch');
            strict.deepEqual(context, baseline.context, 'Personenbeleg und Rollen sind mit A oder B aktiv identisch');
        } else startupBaselines.set(live, { inputs, context });
        let runs = 0;
        await startAutomaticBacktest(doc, { status() {}, persistenceReady: async () => {}, profileReady: async () => {},
            initializationReady: async () => {}, isBlocked: () => Boolean(window.__profileRecoveryBlocker), engineReady: () => true,
            provider: () => ({ bounds: { startYear: 1900, endYear: 2025 }, preparePeriod: async () => ({ status: 'complete' }) }),
            currentYear: () => 2026, validate: () => strict.equal(getCommonInputs().startAlter, 67), setPeriod() {}, run: () => { runs++; } });
        assertEqual(runs, 1, 'Produktiver Öffnungskoordinator erreicht den Backtest');
    }
    for (const kind of ['missing-primary', 'missing-partner', 'legacy-age', 'demo']) {
        const complete = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14' };
        const missing = { profile_person_schema_version: '1' };
        const profiles = kind === 'demo' ? { default: { meta: { id: 'default', name: 'Default' }, data: missing } } : {
            a: { meta: { id: 'a', name: 'Muster A', belongsToHousehold: true }, data: kind === 'missing-primary' ? missing : kind === 'legacy-age' ? { ...missing, profile_aktuelles_alter: '67' } : complete },
            ...(kind === 'missing-partner' ? { b: { meta: { id: 'b', name: 'Muster B', belongsToHousehold: true }, data: missing } } : {})
        };
        const current = kind === 'demo' ? 'default' : 'a';
        let backend = { rs_profiles_v1: JSON.stringify({ version: 1, profiles }), rs_current_profile: current, rs_active_profile: current };
        PersistenceFacade.resetPersistenceForTests({ name: 'Bereitschaft', async init() {}, async loadAll() { return { ...backend }; },
            async saveBatch({ upserts, deletes }) { deletes.forEach(k => delete backend[k]); upserts.forEach(([k, v]) => backend[k] = v); } });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const doc = documentFixture(); globalThis.document = doc;
        let engineCalls = 0;
        globalThis.window = { addEventListener() {}, removeEventListener() {}, EngineAPI: { simulateSingleYear() { engineCalls++; } } };
        const personBytes = JSON.stringify(backend.rs_profiles_v1);
        await initializeSimulatorApp();
        const incomplete = kind.startsWith('missing');
        assertEqual(Boolean(window.__profileRecoveryBlocker), false, kind + ': kein technischer Recoveryblocker');
        const status = readHouseholdPersonStatus();
        assertEqual(status.ready, !incomplete, kind + ': tatsächlicher Haushalt entscheidet Rechenbereitschaft');
        const read = readPensionInputs(doc);
        if (incomplete) {
            assertEqual(read.startAlter, null, 'Erwartbare Unvollständigkeit ohne Throw oder erfundenes Alter');
            assertEqual(read.personDataStatus.message, status.message, 'Rechenleser behält dieselbe Sperrbegründung');
            assert(doc.getElementById('btButton').disabled && doc.getElementById('btButton').title === status.message, 'Rechnen gesperrt mit identischem Hinweis');
            strict.throws(() => getCommonInputs(), { name: 'SimulatorValidationError' });
            showPersonDataStatus({ ready: true, persons: [] }, doc);
            assertEqual(doc.getElementById('personDataNotice'), null, 'Ein vollständig gewordener Haushalt behält keinen veralteten Hinweis');
        }
        let runs = 0, validations = 0, phase = '';
        await startAutomaticBacktest(doc, { status: value => { phase = value; }, persistenceReady: async () => {}, profileReady: async () => {},
            initializationReady: async () => {}, personStatus: () => status, isBlocked: () => false, engineReady: () => true,
            provider: () => ({ bounds: { startYear: 1900, endYear: 2025 }, preparePeriod: async () => ({ status: 'complete' }) }),
            currentYear: () => 2026, validate: () => { validations++; }, setPeriod() {}, run: () => { runs++; } });
        assertEqual(runs, incomplete ? 0 : 1, kind + ': Öffnungslauf ruhig übersprungen oder erreicht');
        assertEqual(validations, incomplete ? 0 : 1, 'Fehlende Daten werden vor strikter Validierung erkannt');
        if (incomplete) assertEqual(phase, 'skipped', 'Öffnungsversuch endet als übersprungen');
        assertEqual(engineCalls, 0, 'UI-Initialisierung startet keine Engine');
        assertEqual(window.__simulatorOpeningBacktestError, undefined, 'Keine technische Öffnungsfehlermeldung');
        assertEqual(JSON.stringify(backend.rs_profiles_v1), personBytes, 'Bereitschaft verändert keine Personenrecords');
        if (kind === 'legacy-age') assertEqual(getCommonInputs().startAlter, 67, 'Festes Altalter bleibt rechenfähig');
        if (kind === 'demo') assertEqual(read.startAlter, 65, 'Leere Erstinstallation erhält reinen Dokumentstandard ohne Geburtstag');
    }
    const deferredRecords = { rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
        a: { meta: { id: 'a', name: 'Aufgeschobene Person' }, data: { profile_aktuelles_alter: '67', sim_p1Monatsrente: '1000' } }
    } }), rs_current_profile: 'a', rs_active_profile: 'a', profile_aktuelles_alter: '67', sim_p1Monatsrente: '1000' };
    PersistenceFacade.resetPersistenceForTests({ name: 'Aufschub', async init() {}, async loadAll() { return { ...deferredRecords }; }, async saveBatch() {} });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    globalThis.document = documentFixture();
    globalThis.window = { __personMigrationDeferred: true, addEventListener() {}, removeEventListener() {} };
    await initializeSimulatorApp();
    assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), JSON.stringify(deferredRecords), 'Auch die produktive Simulatorinitialisierung hält den aufgeschobenen Bestand bytegleich');
    assertEqual(readPensionInputs(document).personDataStatus.status, 'deferred', 'Aufschub erreicht den ruhigen Rechenleser');
    assert(document.getElementById('btButton').disabled, 'Aufschub sperrt Rechnen ohne Defaults zu schreiben');
} finally { Object.assign(globalThis, previous); PersistenceFacade.resetPersistenceRuntimeForTests(); }
