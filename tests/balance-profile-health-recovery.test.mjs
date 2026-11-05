import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { UIRenderer, initUIRenderer } from '../app/balance/balance-renderer.js';
import { CONFIG } from '../app/balance/balance-config.js';
import {
    DEFAULT_PROFILE_HEALTH_BUCKET, PROFILE_HEALTH_BUCKET_KEY, PROFILE_STORAGE_KEYS,
    ProfileStateLoadError, parseProfileHealthBucketFromData
} from '../app/profile/profile-state.js';
import { ProfileRecoveryError } from '../app/profile/profile-storage.js';
import { renderProfileRecovery } from '../app/profile/profile-recovery-ui.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { readBalancePersonStatus, showPersonDataStatus } from '../app/shared/person-data-status.js';
import {
    BALANCE_UPDATE_MODE, assertActiveEngineHandshake, resolveBalanceUpdateRequest,
    createBlockedUpdateResult, createUpdateFailureResult
} from '../app/balance/balance-update-pipeline.js';
import { createSelectionDocument, functionSource } from './designsystem-selection-dom.mjs';
import { getBalancePlanTrial } from '../app/balance/balance-plan-trial.js';
import strictAssert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';

const damagedRaw = '{"enabled":"maybe","initialAmount":150000}';
const validBucket = {
    ...DEFAULT_PROFILE_HEALTH_BUCKET, enabled: true, initialAmount: 180000,
    triggerMinGrade: 3, triggerMode: 'AND', coverageMode: 'floor_when_care_active', targetMode: 'nominal_fixed'
};
const balanceRaw = JSON.stringify({
    inputs: { floorBedarf: 24000, flexBedarf: 12000, minimumFlexAnnual: 6000 },
    annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2025' }
});

function profile(id, selected, bucket = JSON.stringify(validBucket), overrides = {}) {
    return { meta: { id, name: `Synthetisch ${id.toUpperCase()}`, belongsToHousehold: selected }, data: {
        profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14',
        profile_rente_monatlich: '2000', profile_sonstige_einkuenfte: '100',
        profile_sparer_pauschbetrag: '1500', profile_kirchensteuer_pct: '9', profile_tagesgeld: '50000',
        [CONFIG.STORAGE.LS_KEY]: balanceRaw,
        ...(bucket === undefined ? {} : { [PROFILE_HEALTH_BUCKET_KEY]: bucket }), ...overrides
    } };
}

// Jeder Fall verwendet echte Reader-/Persistenzmodule, aber nur synthetische Records.
async function withFixture(profiles, current, run) {
    const saved = { document: globalThis.document, window: globalThis.window };
    const records = {
        ...profiles[current]?.data,
        [PROFILE_STORAGE_KEYS.registry]: JSON.stringify({ version: 1, profiles }),
        [PROFILE_STORAGE_KEYS.current]: current, [PROFILE_STORAGE_KEYS.active]: current,
        [CONFIG.STORAGE.LS_KEY]: balanceRaw
    };
    const writes = [];
    const backend = {
        name: 'Synthetische Pflegebucket-Recovery', async open() {},
        async loadAll() { return { ...records }; },
        async saveBatch({ deletes, upserts }) {
            writes.push({ deletes: [...deletes], upserts: upserts.map(pair => [...pair]) });
            deletes.forEach(key => delete records[key]);
            upserts.forEach(([key, value]) => { records[key] = value; });
        }
    };
    try {
        PersistenceFacade.resetPersistenceForTests(backend);
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const doc = createSelectionDocument();
        globalThis.document = doc;
        globalThis.window = {};
        const inputs = Object.fromEntries(Object.entries({
            aktuellesAlter: '66', floorBedarf: '24000', flexBedarf: '12000', minimumFlexAnnual: '6000',
            renteMonatlich: '999', sparerPauschbetrag: '999', tagesgeld: '999',
            depotwertAlt: '500000', costBasisAlt: '350000',
            endeVJ: '100', endeVJ_1: '100', endeVJ_2: '100', endeVJ_3: '100', ath: '100'
        }).map(([id, value]) => [id, { value }]));
        const errorHost = doc.createElement('div');
        doc.body.appendChild(errorHost);
        const dom = { inputs, controls: {}, outputs: {}, containers: { error: errorHost } };
        initUIReader(dom);
        initUIRenderer(dom, {});
        const before = await backend.loadAll();
        await run({ dom, doc, before });
        await PersistenceFacade.flush();
        const after = await backend.loadAll();
        assertEqual(JSON.stringify(after), JSON.stringify(before), 'Backendrecords nach Flush exakt bytegleich');
        assertEqual(writes.length, 0, 'Schreibrekorder nach Flush leer');
        for (const [key, raw] of Object.entries(before)) {
            assertEqual(persistenceStorage.getItem(key), raw, `Lesepfad erhält Rohrecord ${key}`);
        }
    } finally {
        initUIReader(null);
        initUIRenderer({ inputs: {}, containers: {} }, {});
        Object.assign(globalThis, saved);
        PersistenceFacade.resetPersistenceRuntimeForTests();
    }
}

function captureError(fn) {
    try { fn(); } catch (error) { return error; }
    return null;
}

function assertRecovery(error, id, registryRaw) {
    assert(error instanceof ProfileRecoveryError,
        `Aktiver/ausgewählter Pflegebucket liefert ProfileRecoveryError (tatsächlich: ${error?.name || 'kein Fehler'}, ${error?.code || ''}: ${error?.message || ''})`);
    assertEqual(error.code, 'PROFILE_HEALTH_BUCKET_INVALID', 'Recovery behält den Parsercode');
    assertEqual(error.profileId, id, 'Recovery benennt die betroffene Profil-ID');
    assertEqual(error.storageKey, PROFILE_HEALTH_BUCKET_KEY, 'Recovery benennt den Pflegebucketrecord');
    assertEqual(error.raw, damagedRaw, 'Recovery behält den beschädigten Rohwert');
    assertEqual(error.recovery.raw, damagedRaw, 'Recoverydaten enthalten unveränderte Rohbytes');
    assertEqual(error.recovery.profileName, `Synthetisch ${id.toUpperCase()}`, 'Recoverydaten enthalten den Profilnamen');
    assertEqual(error.recovery.registryRaw, registryRaw, 'Recovery behält den Registryrohwert');
    assert(error.message.includes(`Synthetisch ${id.toUpperCase()}`) && error.message.includes('Pflegebucket'),
        'Recoverymeldung nennt Profilname und Pflegebucket');
}

async function assertBlockedUpdates({ dom, before }, id) {
    // Der produktive Updatekörper erhält kontrollierte Umgebungsabhängigkeiten.
    // Navigation/Sync bleiben neutral, damit der echte Reader den Schaden meldet.
    let readerCalls = 0, engineCalls = 0, resultWrites = 0;
    const rendered = [], logged = [];
    const engineApi = { getVersion: () => 'synthetisch', simulateSingleYear() { engineCalls++; } };
    window.EngineAPI = engineApi;
    const appState = { engineHandshake: {
        engineApi, getVersion: engineApi.getVersion, simulateSingleYear: engineApi.simulateSingleYear
    } };
    const renderer = {
        clearError() { dom.containers.error.textContent = ''; },
        handleError(error) { rendered.push(error); UIRenderer.handleError(error); }
    };
    const dependencies = {
        refreshBalanceWealthHistory() {}, refreshBalanceExpensesHistory() {}, dom, getBalancePlanTrial,
        readBalancePersonStatus, showPersonDataStatus, createBlockedUpdateResult,
        getCurrentProfileId: () => persistenceStorage.getItem(PROFILE_STORAGE_KEYS.current),
        BALANCE_UPDATE_MODE, resolveBalanceUpdateRequest, assertActiveEngineHandshake, appState, UIRenderer: renderer,
        profileSyncHandlers: { syncProfileDerivedInputs() {} },
        UIReader: {
            applyHouseholdPlanInputs: () => UIReader.applyHouseholdPlanInputs(),
            captureStorageDraft(...args) { readerCalls++; return UIReader.captureStorageDraft(...args); }
        },
        StorageManager: { loadState: () => JSON.parse(balanceRaw), saveState() { resultWrites++; } },
        persistBalanceUpdate() { resultWrites++; },
        createUpdateFailureResult, console: { error(...args) { logged.push(args); } }
    };
    const update = new Function(...Object.keys(dependencies),
        functionSource('app/balance/balance-main.js', 'update') + '\nreturn update;')(...Object.values(dependencies));
    for (const mode of ['preview', 'persist_inputs', 'commit_period']) {
        const result = update({ mode, ...(mode === 'commit_period' ? { periodId: 'calendar-year:2026' } : {}) });
        assertEqual(result.ok, false, `${mode}: Update gesperrt`);
        assertEqual(result.reason, 'validation', `${mode}: Schaden wird im Reader vor der Engine erkannt`);
        assertRecovery(result.error, id, before[PROFILE_STORAGE_KEYS.registry]);
        assertEqual(rendered.at(-1), result.error, `${mode}: Renderer erhält dasselbe Recoveryobjekt`);
        assertEqual(logged.at(-1)[0], 'Update-Fehler:', `${mode}: bestehende Konsolenmeldung bleibt erhalten`);
        assertEqual(logged.at(-1)[1], result.error, `${mode}: Konsole erhält dasselbe Recoveryobjekt`);
        assert(dom.containers.error.textContent.includes(`Synthetisch ${id.toUpperCase()}`)
            && dom.containers.error.textContent.includes('Pflegebucket'), `${mode}: echter Fehlerrenderer zeigt Profil und Bereich`);
    }
    assertEqual(readerCalls, 3, 'Jeder Updatemodus ruft den echten Reader auf');
    assertEqual(engineCalls, 0, 'Kein simulateSingleYear bei Pflegebucketchaden');
    assertEqual(resultWrites, 0, 'Keine Ergebnis-/Periodencommitwrites bei Pflegebucketchaden');
}

// Rotnachweis vor der Readerkorrektur: konkreter Parserfehler statt Recoveryklasse.
await withFixture({ a: profile('a', false, damagedRaw) }, 'a', async fixture => {
    assertEqual(readBalancePersonStatus().calculationProfileId, 'a', 'Aktives Einzelprofil ist Basisperson');
    const error = captureError(() => UIReader.readAllInputs());
    assertRecovery(error, 'a', fixture.before[PROFILE_STORAGE_KEYS.registry]);
    const statusEl = fixture.doc.createElement('div');
    const control = fixture.doc.createElement('button');
    renderProfileRecovery({ statusEl, recovery: error.recovery, controls: [control], doc: fixture.doc, win: window });
    assertEqual(control.disabled, true, 'Bestehender Recoveryrenderer sperrt die Profilbedienung');
    assert(statusEl.children[0].textContent.includes('Synthetisch A')
        && statusEl.children[0].textContent.includes('Pflegebucket'), 'Bestehender Recoveryrenderer nennt Profil und Bereich');
    const actions = statusEl.children[1].children;
    assertEqual(actions[0].dataset.profileRecoveryAction, 'export', 'Recoveryexport wird angeboten');
    assertEqual(actions[1].disabled, true, 'Reset bleibt bis zum expliziten Export gesperrt');
    await assertBlockedUpdates(fixture, 'a');
});

const healthy = profile('a', true);
const damagedPartner = profile('b', true, damagedRaw);
await withFixture({ a: healthy, b: damagedPartner }, 'a', async fixture => {
    const status = readBalancePersonStatus();
    assertEqual(status.calculationProfileId, 'a', 'Gesunde Person A bleibt Basisperson');
    assertEqual(status.entries.map(entry => entry.profileId).join(), 'a,b', 'Auswahl umfasst auch Partner B');
    assertRecovery(captureError(() => UIReader.readAllInputs()), 'b', fixture.before[PROFILE_STORAGE_KEYS.registry]);
    await assertBlockedUpdates(fixture, 'b');
});

// Derselbe Partner wird nur abgewählt; der beschädigte Bucket bleibt unverändert.
await withFixture({ a: healthy, b: { ...damagedPartner, meta: { ...damagedPartner.meta, belongsToHousehold: false } } }, 'a', () => {
    assertEqual(readBalancePersonStatus().entries.map(entry => entry.profileId).join(), 'a', 'Abgewählter Partner liegt außerhalb des Rechenumfangs');
    const inputs = UIReader.readAllInputs();
    assertEqual(inputs.tagesgeld, 50000, 'Gesundes Rechenprofil behält Tagesgeld');
    assertEqual(inputs.renteMonatlich, 2100, 'Gesundes Rechenprofil behält Einkommen');
    assertEqual(inputs.sparerPauschbetrag, 1500, 'Gesundes Rechenprofil behält SPB');
    assertEqual(JSON.stringify(inputs.healthBucket), JSON.stringify(validBucket), 'Gültiger aktivierter Bucket behält sämtliche Werte');
    assertEqual(JSON.parse(persistenceStorage.getItem(PROFILE_STORAGE_KEYS.registry)).profiles.b.data[PROFILE_HEALTH_BUCKET_KEY],
        damagedRaw, 'Abgewählter Schaden wird nicht repariert');
});

// Geöffnete Außenperson A und ausgewählte Basisperson B haben bewusst andere Werte.
await withFixture({ a: profile('a', false, JSON.stringify(validBucket), {
    profile_geburtsdatum: '1970-03-14', profile_tagesgeld: '9999', profile_rente_monatlich: '999', profile_sparer_pauschbetrag: '0'
}), b: profile('b', true) }, 'a', () => {
    assertEqual(readBalancePersonStatus().calculationProfileId, 'b', 'Auswahl bestimmt Basisperson unabhängig von geöffneter Person');
    const inputs = UIReader.readAllInputs();
    assertEqual(inputs.aktuellesAlter, 67, 'Reader projiziert das Alter der ausgewählten Person B');
    assertEqual(inputs.tagesgeld, 50000, 'Reader verwendet Bs Vermögen');
    assertEqual(inputs.renteMonatlich, 2100, 'Reader verwendet Bs Einkommen');
    assertEqual(inputs.sparerPauschbetrag, 1500, 'Reader verwendet Bs SPB');
    assertEqual(persistenceStorage.getItem(PROFILE_STORAGE_KEYS.current), 'a', 'Geöffnete Person bleibt A');
});

for (const [label, raw, expected] of [
    ['deaktiviert', JSON.stringify({ ...validBucket, enabled: false }), { ...validBucket, enabled: false }],
    ['fehlend', null, DEFAULT_PROFILE_HEALTH_BUCKET], ['leer', '', DEFAULT_PROFILE_HEALTH_BUCKET]
]) {
    const entry = profile('a', false, raw);
    if (raw === null) delete entry.data[PROFILE_HEALTH_BUCKET_KEY];
    await withFixture({ a: entry }, 'a', () => {
        assertEqual(JSON.stringify(UIReader.readAllInputs().healthBucket), JSON.stringify(expected), `${label}: bestehender Bucketvertrag erhalten`);
    });
}
await withFixture({ default: { meta: { id: 'default', name: 'Demo', belongsToHousehold: false }, data: {} } }, 'default', () => {
    assertEqual(readBalancePersonStatus().status, 'demo', 'Leeres Erstprofil bleibt Demo');
    const inputs = UIReader.readAllInputs();
    assertEqual(inputs.aktuellesAlter, 66, 'Demo verwendet weiterhin DOM-Alter');
    assertEqual(inputs.tagesgeld, 999, 'Demo verwendet weiterhin DOM-Vermögen');
    assertEqual(JSON.stringify(inputs.healthBucket), JSON.stringify(DEFAULT_PROFILE_HEALTH_BUCKET), 'Demo behält den Defaultbucket');
});
const parserError = captureError(() => parseProfileHealthBucketFromData({ [PROFILE_HEALTH_BUCKET_KEY]: damagedRaw }));
assert(parserError instanceof ProfileStateLoadError && !(parserError instanceof ProfileRecoveryError),
    'Parser außerhalb des Readers behält seinen niedrigen Fehlertyp');
assertEqual(parserError.code, 'PROFILE_HEALTH_BUCKET_INVALID', 'Parservertrag bleibt unverändert');

// Dieselbe Readerdiagnose wie im Browserfall, einschließlich seiner exakten
// Identität. Stackdarstellung ist Browsertechnik und keine andere Fachdiagnose.
const browserId = 'browser-slice13-health';
await withFixture({ [browserId]: { ...profile(browserId, true, damagedRaw),
    meta: { id: browserId, name: 'Browserprofil Pflege-Recovery', belongsToHousehold: true } } }, browserId, () => {
    const error = captureError(() => UIReader.readAllInputs());
    assert(error instanceof ProfileRecoveryError, 'Browserfixture erzeugt den echten typisierten Readerfehler');
    const classify = runInNewContext(functionSource('tests/browser-smoke.test.mjs', 'assertCareRecoveryErrors')
        + '\nassertCareRecoveryErrors;', { assert: strictAssert });
    const serialized = { name: error.name, message: error.message, code: error.code, storageKey: error.storageKey, profileId: error.profileId };
    const messages = ['[console.error] Update-Fehler: ' + error.stack];
    const details = [{ index: 0, args: ['Update-Fehler:', serialized] }];
    classify(messages, details);
    assert(true, 'Exakt derselbe Recoveryfehler wird auch mit Browserstack erkannt');
    const compoundError = captureError(() => loadProfilverbundProfiles());
    const compound = { name: compoundError.name, message: compoundError.message, code: compoundError.code,
        storageKey: compoundError.storageKey, profileId: compoundError.profileId };
    classify(['[console.error] Update-Fehler: ' + compoundError.stack], [{ index: 0, args: ['Update-Fehler:', compound] }]);
    assert(true, 'Echte Verbunddiagnose mit vollständigem Parsergrund ist ebenso exakt gebunden');
    for (const key of ['name', 'message', 'code', 'storageKey', 'profileId']) {
        strictAssert.throws(() => classify(messages, [{ index: 0, args: ['Update-Fehler:', { ...serialized, [key]: 'Synthetisch unerwartet' }] }]), /Unerwartete Recovery-Konsolenfehler/);
        assert(true, key + ': abweichende Diagnose bleibt ein Fehler');
    }
    strictAssert.throws(() => classify(['[console.error] Update-Fehler: ProfileRecoveryError: ' + error.message],
        [{ index: 0, args: ['Update-Fehler:', { ...serialized, code: 'Synthetisch unerwartet' }] }]), /Unerwartete Recovery-Konsolenfehler/);
    assert(true, 'Auch eine bisher erlaubte Textdarstellung überstimmt keinen falschen Parsercode');
    for (const changed of [[], [{ index: 1, args: details[0].args }],
        [{ index: 0, args: ['Anderer Aufrufer:', serialized] }], [{ index: 0, args: [...details[0].args, 'Weiterer Fehler'] }]]) {
        strictAssert.throws(() => classify(messages, changed), /Unerwartete Recovery-Konsolenfehler/);
        assert(true, 'Fehlende, falsche oder zusätzliche Konsolenargumente werden nicht freigegeben');
    }
    strictAssert.throws(() => classify(['[pageerror] ' + error.stack], details), /Unerwartete Recovery-Konsolenfehler/);
    strictAssert.throws(() => classify([...messages, '[console.error] Synthetischer Appfehler'], details), /Synthetischer Appfehler/);
    strictAssert.throws(() => classify(messages, [{ index: 0, captureError: 'Synthetischer Lesefehler' }]), /nicht vollständig gelesen/);
    assert(true, 'Appfehler, unbehandelte Ausnahmen und Diagnose-Lesefehler bleiben unterscheidbar');
});
