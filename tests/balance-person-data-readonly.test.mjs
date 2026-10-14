import { documentDouble } from './helpers/page-dialog-dom.mjs';
import fs from 'node:fs';
import { createProfileSyncHandlers } from '../app/balance/balance-main-profile-sync.js';
import { UIReader, initUIReader } from '../app/balance/balance-reader.js';
import { UIBinder, initUIBinder } from '../app/balance/balance-binder.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { PROFILE_STORAGE_KEYS, PROFILE_VALUE_KEYS } from '../app/profile/profile-state.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { bindProfileNavigationHandoff } from '../app/profile/profile-navigation.js';
import { createNavigationGuard } from '../app/shared/navigation-guard.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { readBalanceHouseholdPlan, stageBalancePlanPatch } from '../app/profile/household-plan.js';
import { getBalancePlanTrial } from '../app/balance/balance-plan-trial.js';
import { renderBalanceInflationSource } from '../app/balance/balance-inflation-source.js';
const previous = { document: globalThis.document, window: globalThis.window, sideEffects: UIReader.applySideEffectsFromInputs };
const html = fs.readFileSync('Balance.html', 'utf8');
const anchor = html.match(/<a\b[^>]*id="balancePersonEditLink"[^>]*>/)?.[0];
assert(anchor?.includes('depot-tranchen-manager.html#personendaten'), 'Produktiver Balance-Link führt zur zentralen Personeneingabe');
assert(anchor?.includes('data-profile-handoff-export="false"'), 'Zentraler Manager-Link verwendet den bestehenden lokalen Handoff');
try {
    for (const household of [false, true]) {
        const data = spb => ({ profile_person_schema_version: '1', profile_aktuelles_alter: '67', profile_sparer_pauschbetrag: String(spb), profile_tagesgeld: '10000',
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 10000, flexBedarf: 0 } }) });
        const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'Synthetisch A', belongsToHousehold: household }, data: data(0) }, b: { meta: { id: 'b', name: 'Synthetisch B', belongsToHousehold: household }, data: data(1500) } } };
        const records = { ...data(0), [PROFILE_STORAGE_KEYS.registry]: JSON.stringify(registry), [PROFILE_STORAGE_KEYS.current]: 'a', [PROFILE_STORAGE_KEYS.active]: 'a' };
        const writes = [];
        const backend = { name: 'balance-person-readback', async open() {}, async loadAll() { return { ...records }; }, async saveBatch({ deletes, upserts }) { writes.push(...upserts); deletes.forEach(k => delete records[k]); upserts.forEach(([k,v]) => records[k] = v); } };
        PersistenceFacade.resetPersistenceForTests(backend); await PersistenceFacade.init({ installLifecycleHooks: false });
        const listeners = {};
        const source = documentDouble().doc.createElement('p');
        const doc = { getElementById: id => id === 'balancePersonSPBSource' ? source : null, addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }, contains: () => true };
        source.ownerDocument = doc; doc.createElement = documentDouble().doc.createElement;
        const link = { isConnected: true, dataset: { profileHandoffExport: 'false' }, hasAttribute: k => k === 'data-profile-handoff', getAttribute: k => k === 'href' ? 'depot-tranchen-manager.html#personendaten' : null };
        const spb = { id: 'sparerPauschbetrag', value: '', dataset: {}, ownerDocument: doc };
        const dom = { inputs: { sparerPauschbetrag: spb }, controls: {}, outputs: {}, containers: {} };
        globalThis.document = doc; globalThis.window = { location: { href: 'http://localhost/Balance.html' }, name: '' };
        UIReader.applySideEffectsFromInputs = () => {};
        const { syncProfileDerivedInputs } = createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS });
        assert(syncProfileDerivedInputs(), 'Produktive Einzel-/Haushaltssynchronisierung erfolgreich');
        assertEqual(spb.value, household ? '1.500' : '0', 'Haushaltsaggregation und expliziter SPB 0 erhalten');
        assert(spb.disabled && spb.readOnly && spb.dataset.noPersist === 'true', 'SPB ausschließlich Anzeige');
        assertEqual(source.textContent, 'Summe aus den Profilen', 'Kurze Herkunftszeile bleibt sichtbar');
        assert(source.children[0].children[1].textContent.includes(household ? 'Haushaltsprofilen' : 'aktiven Profil'), 'Unveränderte Herkunft steht im Infofenster');
        const baseline = await backend.loadAll();
        initUIReader(dom);
        const update = () => StorageManager.saveState({ inputs: UIReader.readAllInputs() });
        initUIBinder(dom, {}, update, update);
        spb.value = '99999'; UIBinder.handleFormInput({ target: spb }); UIBinder.handleFormChange({ target: spb });
        assert(syncProfileDerivedInputs(), 'Wiederholte Synchronisierung bleibt lesend');
        bindProfileNavigationHandoff({ root: doc, win: window, guard: createNavigationGuard({ decide: async () => true }), ready: async () => true, flusher: () => PersistenceFacade.flush() });
        await listeners.click[0]({ target: { closest: () => link }, preventDefault() {} });
        await PersistenceFacade.flush();
        const after = await backend.loadAll();
        assertEqual(after[PROFILE_STORAGE_KEYS.registry], baseline[PROFILE_STORAGE_KEYS.registry], 'Direktes Backendlesen: zentrale Registry-SPB bytegleich');
        assertEqual(after.profile_sparer_pauschbetrag, '0', 'Direktes Backendlesen: Live-SPB bleibt explizit 0');
        assert(!Object.hasOwn(JSON.parse(after[CONFIG.STORAGE.LS_KEY]).inputs, 'sparerPauschbetrag'), 'Gespeicherter Balance-State hat keinen eigenen SPB');
        assert(!writes.some(([key, value]) => key === 'profile_sparer_pauschbetrag' || key.startsWith('sim_') || key === CONFIG.STORAGE.LS_KEY && Object.hasOwn(JSON.parse(value).inputs, 'sparerPauschbetrag')), 'Schreibrekorder: keine eigenen SPB-Persistenzaufrufe');
        assert(window.location.href.endsWith('#personendaten'), 'Bestätigter produktiver Handoff erreicht Personeneingabe');
        assertEqual(persistenceStorage.getItem(PROFILE_STORAGE_KEYS.active), 'a', 'Navigation erhält aktive Identität');
        assertEqual(window.name, '', 'Keine Personenalternative im Bundle-Handoff');
    }
} finally { Object.assign(globalThis, { document: previous.document, window: previous.window }); UIReader.applySideEffectsFromInputs = previous.sideEffects; PersistenceFacade.resetPersistenceRuntimeForTests(); }

// Derselbe produktive Updatekörper blockiert vor Eingabeprojektion und Engine.
{
    const { functionSource, createSelectionDocument } = await import('./designsystem-selection-dom.mjs');
    const { readBalancePersonStatus, showPersonDataStatus } = await import('../app/shared/person-data-status.js');
    const { createBlockedUpdateResult } = await import('../app/balance/balance-update-pipeline.js');
    const saved = { document: globalThis.document, window: globalThis.window };
    try {
        for (const partner of [false, true]) {
            const missing = { profile_person_schema_version: '1' }, complete = { ...missing, profile_geburtsdatum: '1958-03-14' };
            const records = { rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
                a: { meta: { id: 'a', name: 'Muster A', belongsToHousehold: true }, data: partner ? complete : missing },
                b: { meta: { id: 'b', name: 'Muster B', belongsToHousehold: partner }, data: missing }
            } }) };
            let writes = 0, engineCalls = 0, cleared = 0;
            PersistenceFacade.resetPersistenceForTests({ name: 'Balancebereitschaft', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() { writes++; } });
            await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            const doc = createSelectionDocument(), create = doc.createElement;
            doc.createElement = tag => { const n = create(tag); n.append = (...children) => children.forEach(c => n.appendChild(c)); return n; };
            globalThis.document = doc; globalThis.window = { EngineAPI: { simulateSingleYear() { engineCalls++; } } };
            const renderer = { clearError() { cleared++; }, handleError(error) { throw error; } };
            const update = new Function('refreshBalanceWealthHistory', 'refreshBalanceExpensesHistory', 'dom', 'readBalancePersonStatus',
                'showPersonDataStatus', 'createBlockedUpdateResult', 'UIRenderer', 'createUpdateFailureResult',
                functionSource('app/balance/balance-main.js', 'update') + '\nreturn update;')(
                () => {}, () => {}, {}, readBalancePersonStatus, showPersonDataStatus, createBlockedUpdateResult, renderer, error => { throw error; });
            const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
            const result = update({ mode: 'commit_period', periodId: 'calendar-year:2026' });
            assertEqual(result.reason, 'person_data_incomplete', 'Produktiver Balance-Abschluss bleibt fachlich gesperrt');
            assertEqual(engineCalls, 0, 'Keine Balance-Engine bei fehlendem Haupt-/Partnerdatum');
            assertEqual(cleared, 0, 'Vorhandene Ergebnis-/Fehleranzeige bleibt erhalten');
            assertEqual(writes, 0, 'Kein Ergebnis- oder Commitwrite bei fehlenden Daten');
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Fachliche Records bleiben bytegleich');
            assert(doc.getElementById('personDataNotice').children[0].textContent.includes(partner ? 'Muster B' : 'Muster A'), 'Balance-Hinweis nennt tatsächlich betroffene Person');
            assertEqual(doc.getElementById('personDataNotice').children[1].href, 'depot-tranchen-manager.html#personendaten', 'Balance verlinkt Ergänzungsband');
        }
    } finally { Object.assign(globalThis, saved); PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Die Auswahl bestimmt den Rechenumfang unabhängig von der geöffneten Person.
{
    const { readBalancePersonStatus, readHouseholdPersonStatus, projectParticipatingPerson } = await import('../app/shared/person-data-status.js');
    const { loadProfilverbundProfiles } = await import('../app/profile/profilverbund-balance.js');
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const saved = { document: globalThis.document, window: globalThis.window, sideEffects: UIReader.applySideEffectsFromInputs };
    try {
        const missing = { profile_person_schema_version: '1' };
        const active = { ...missing, profile_geburtsdatum: '1961-03-14', profile_sparer_pauschbetrag: '0',
            profile_rente_monatlich: '1234.567', profile_sonstige_einkuenfte: '100', profile_kirchensteuer_pct: '8' };
        const other = { ...missing, profile_geburtsdatum: '1958-03-14', profile_sparer_pauschbetrag: '1500',
            profile_rente_monatlich: '2000', profile_kirchensteuer_pct: '9' };
        for (const live of [false, true]) for (const partnerComplete of [false, true]) {
            const records = { ...(live ? active : {}), rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
                a: { meta: { id: 'a', name: 'Außenperson', belongsToHousehold: false }, data: active },
                b: { meta: { id: 'b', name: 'Haushaltsperson', belongsToHousehold: true }, data: partnerComplete ? other : missing }
            } }), [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2025' } }) };
            let writes = 0;
            PersistenceFacade.resetPersistenceForTests({ name: 'Außenprofil', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() { writes++; } });
            await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            const doc = createSelectionDocument(), create = doc.createElement;
            doc.createElement = tag => { const node = create(tag); node.append = (...children) => children.forEach(child => node.appendChild(child)); return node; };
            globalThis.document = doc; globalThis.window = { __profilverbundPersonSPB: 9999 };
            const dom = { inputs: Object.fromEntries(['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'fixedIncomeAnnual', 'kirchensteuerSatz', 'sparerPauschbetrag'].map(key => [key, addField(doc, key)])), containers: {} };
            initUIReader(dom); UIReader.applySideEffectsFromInputs = () => {};
            const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
            assertEqual(readHouseholdPersonStatus().ready, partnerComplete, 'Simulatorbereitschaft richtet sich weiterhin nur nach dem Haushalt');
            assertEqual(readBalancePersonStatus().ready, partnerComplete, 'Balance prüft das ausgewählte Mitglied B');
            if (!partnerComplete) {
                let blocked;
                try { UIReader.readAllInputs(); } catch (error) { blocked = error; }
                assert(blocked?.errors?.some(detail => detail.code === 'person_data_incomplete'), 'Fehlender Geburtstag von B sperrt den Reader');
                assert(readBalancePersonStatus().message.includes('Haushaltsperson'), 'Sperrhinweis benennt B');
                continue;
            }
            assertEqual(loadProfilverbundProfiles().map(entry => entry.profileId).join(), 'b', 'Loader liefert genau B');
            assert(createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }).syncProfileDerivedInputs(), 'Ausgewählte Person synchronisiert ihre eigenen Werte');
            assertEqual(dom.inputs.aktuellesAlter.value, '67', 'Sync zeigt Alter von B');
            assertEqual(dom.inputs.renteMonatlich.value, '2.000', 'Sync zeigt Einkommen von B');
            assertEqual(dom.inputs.kirchensteuerSatz.value, '0.09', 'Sync zeigt Kirchensteuer von B');
            assertEqual(dom.inputs.sparerPauschbetrag.value, '1.500', 'Sync zeigt SPB von B');
            const input = UIReader.readAllInputs();
            assertEqual(input.aktuellesAlter, 67, 'Reader verwendet Bs Alter');
            assertEqual(input.renteMonatlich, 2000, 'Reader verwendet Bs Einkommen');
            assertEqual(input.kirchensteuerSatz, 0.09, 'Reader verwendet Bs Kirchensteuer');
            assertEqual(input.sparerPauschbetrag, 1500, 'Reader verwendet Bs SPB ohne veralteten globalen Wert');
            assertEqual(persistenceStorage.getItem('rs_current_profile'), 'a', 'Geöffnete Identität bleibt A');
            assertEqual(writes, 0, 'Bereitschaft, Sync und Projektion bleiben schreibfrei');
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Personenzuordnung verändert keine Fachrecords');
        }
        // Fehlendes Datum der ungewählten Person sperrt B nicht.
        const records = { rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
            a: { meta: { id: 'a', name: 'Außenperson', belongsToHousehold: false }, data: missing },
            b: { meta: { id: 'b', name: 'Haushaltsperson', belongsToHousehold: true }, data: other }
        } }) };
        PersistenceFacade.resetPersistenceForTests({ name: 'Fehlendes Außenalter', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() {} });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        assert(readHouseholdPersonStatus().ready, 'Unvollständiges Außenprofil sperrt den Simulatorhaushalt nicht');
        assert(readBalancePersonStatus().ready, 'Ungewählte Person sperrt Balance nicht');
        assertEqual(UIReader.readAllInputs().renteMonatlich, 2000, 'Reader rechnet weiter mit B');
        let mismatch;
        try { projectParticipatingPerson(readHouseholdPersonStatus(), 'a'); } catch (cause) { mismatch = cause; }
        assert(mismatch, 'Explizite Einzelprojektion des Simulators bleibt identitätsgebunden');
    } finally { Object.assign(globalThis, { document: saved.document, window: saved.window }); UIReader.applySideEffectsFromInputs = saved.sideEffects; PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Kalenderwirkung durch Sync, Reader, echte Haushaltsbrücke, Engine und Summary.
{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { createProfilverbundHandlers } = await import('../app/balance/balance-main-profilverbund.js');
    const { loadProfilverbundProfiles, aggregateProfilverbundInputs, buildProfilverbundAssetSummary } = await import('../app/profile/profilverbund-balance.js');
    const { SummaryRenderer } = await import('../app/balance/balance-renderer-summary.js');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const { EngineAPI } = await import('../engine/index.mjs');
    const saved = { document: globalThis.document, window: globalThis.window, sideEffects: UIReader.applySideEffectsFromInputs };
    try {
        for (const household of [false, true]) for (const startYear of [2026, 2028]) for (const year of [2026, 2028, 2029]) for (const otherIncome of [0, 100]) {
            const data = (amount, date) => ({ profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: String(amount),
                profile_rentenbeginn: date, profile_sonstige_einkuenfte: String(otherIncome), profile_tagesgeld: '50000',
                [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 24000, flexBedarf: 12000 } }) });
            const a = data(1000, household ? '2024-07-01' : `${startYear}-07-01`), b = data(2000, `${startYear}-07-01`);
            const records = { ...a, rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
                a: { meta: { id: 'a', name: 'Muster <A&>', belongsToHousehold: household }, data: a },
                ...(household ? { b: { meta: { id: 'b', name: 'Muster <B&>', belongsToHousehold: true }, data: b } } : {})
            } }), [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: { lastCommittedPeriod: `calendar-year:${year - 1}` } }) };
            let writes = 0;
            PersistenceFacade.resetPersistenceForTests({ name: 'Kalenderrente', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() { writes++; } });
            await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            const doc = createSelectionDocument(); doc.createDocumentFragment = () => doc.createElement('div'); doc.createTextNode = text => { const node = doc.createElement('span'); node.textContent = text; return node; };
            globalThis.document = doc; globalThis.window = {};
            const fields = ['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'fixedIncomeAnnual', 'kirchensteuerSatz', 'sparerPauschbetrag', 'floorBedarf', 'flexBedarf', 'tagesgeld', 'depotwertAlt', 'costBasisAlt', 'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth', 'inflation'];
            const dom = { inputs: Object.fromEntries(fields.map(key => [key, addField(doc, key)])), containers: {}, outputs: {} };
            for (const key of ['floorBedarf', 'flexBedarf', 'tagesgeld', 'depotwertAlt', 'costBasisAlt']) dom.inputs[key].value = String({ floorBedarf: 24000, flexBedarf: 12000, tagesgeld: 50000, depotwertAlt: 500000, costBasisAlt: 350000 }[key]);
            for (const key of ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath']) dom.inputs[key].value = '100';
            initUIReader(dom); UIReader.applySideEffectsFromInputs = () => {};
            const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
            const sync = createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }).syncProfileDerivedInputs;
            assert(sync(), 'Kalenderrente: produktiver Sync erfolgreich');
            const pensionAnnual = (household ? 12000 : 0) + (year < startYear ? 0 : year === startYear ? 6 : 12) * (household ? 2000 : 1000);
            const expected = pensionAnnual + otherIncome * 12 * (household ? 2 : 1);
            assertEqual(Number(dom.inputs.fixedIncomeAnnual.value.replaceAll('.', '')), expected, 'Sync zeigt wirksames Jahreseinkommen');
            const input = UIReader.readAllInputs(), profiles = loadProfilverbundProfiles();
            if (household) {
                assertEqual(aggregateProfilverbundInputs(profiles).totalRenteJahr, expected, 'Haushaltsaggregation verwendet Jahresanteil plus sonstige Einkünfte');
                assertEqual(buildProfilverbundAssetSummary(profiles).totalRenteMonatlich, expected / 12, 'Vermögenssumme erhält Jahresdurchschnitt');
                createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'synthetic-mode' } }).updateProfilverbundGlobals(profiles, input);
                assertEqual(window.__profilverbundDistribution.totalNeed, Math.max(0, input.floorBedarf + input.flexBedarf - expected), 'Produktive Verteilung erhält den Bedarf nach Jahreseinkommen');
                if (window.__profilverbundDistribution.items.length) assertEqual(window.__profilverbundDistribution.items.reduce((sum, entry) => sum + entry.rentAnnual, 0), expected, 'Produktive Verteilung erhält Jahresanteile');
            }
            assertEqual(input.renteMonatlich, expected / 12, 'Produktiver Engineeingang erhält Jahresdurchschnitt');
            assertEqual(input.renteAktiv, expected > 0, 'Technischer Einkommensschalter erhält sonstige Einkünfte');
            const result = EngineAPI.simulateSingleYear(input, null);
            assert(result.ui?.spending, 'Echter Balance-Engineaufruf erfolgreich');
            const view = createPresentationTestDocument(), create = view.createElement;
            view.createElement = tag => { const n = create.call(view, tag); n.dataset = {}; return n; };
            globalThis.document = view;
            const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceBudgetChips', 'balanceMonthlyIncome', 'balanceAnnualBudget'].map(key => [key, view.createElement('div')]));
            const renderer = new SummaryRenderer({ outputs }); renderer.renderOverview({ ...result.ui, input }); renderer.renderOverview({ ...result.ui, input });
            const hints = outputs.balanceBudgetChips.children.filter(node => node.dataset.pensionStatus);
            assertEqual(hints.length, household ? 2 : 1, 'Wiederholrendering ersetzt Rentenhinweise');
            const hint = hints.at(-1);
            assert(hint.textContent.includes(year < startYear ? 'noch nicht im Budget' : year === startYear ? '6 von 12 Monaten' : 'Rente') && hint.textContent.includes('im Budget'), 'Summary nennt Zukunft, Teiljahr oder laufende Rente');
            if (household) assert(hint.textContent.includes('Muster <B&>') && !hint.children.length, 'Haushalt nennt richtige Person als sicheren Text');
            assertEqual(writes, 0, 'Kalenderstatus und Wiederholrendering schreiben keine Profile');
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Kalenderprojektion bewahrt alle Profilbytes');
        }
    } finally { Object.assign(globalThis, { document: saved.document, window: saved.window }); UIReader.applySideEffectsFromInputs = saved.sideEffects; PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Vollständige Altfallhinweise: Januarvorschläge sind ohne positiven Offset wirkungslos.
{
    const { SummaryRenderer } = await import('../app/balance/balance-renderer-summary.js');
    const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
    const saved = { document: globalThis.document, window: globalThis.window, Date: globalThis.Date };
    try {
        const fixedTime = saved.Date.parse('2026-10-07T12:00:00Z');
        globalThis.Date = class extends saved.Date {
            constructor(...args) { super(...(args.length ? args : [fixedTime])); }
            static now() { return fixedTime; }
        };
        globalThis.window = {};
        for (const household of [false, true]) for (const offset of [undefined, 0, 2]) for (const suggestion of [undefined, '2028-01-01']) {
            const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '1000', profile_rentenbeginn: '',
                profile_person_migration_v1: JSON.stringify({ referenceYear: 2026, renteStartOffsetJahre: offset, suggestedRentenbeginn: suggestion }) };
            const records = { ...data, rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
                a: { meta: { id: 'a', name: 'Muster <A&>', belongsToHousehold: true }, data },
                ...(household ? { b: { meta: { id: 'b', name: 'Muster <B&>', belongsToHousehold: true }, data } } : {})
            } }) };
            const backend = { name: 'Hinweisgegenprobe', async init() {}, async loadAll() { return { ...records }; },
                async saveBatch() { throw new Error('UNEXPECTED_WRITE'); } };
            const before = JSON.stringify(records);
            for (let reload = 0; reload < 2; reload++) {
                PersistenceFacade.resetPersistenceForTests(backend);
                await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
                const view = createPresentationTestDocument(), create = view.createElement;
                view.createElement = tag => { const node = create.call(view, tag); node.dataset = {}; return node; };
                globalThis.document = view;
                const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceBudgetChips'].map(key => [key, view.createElement('div')]));
                const renderer = new SummaryRenderer({ outputs });
                const ui = { input: { renteAktiv: false, renteMonatlich: 0 }, spending: { monatlicheEntnahme: 0 } };
                renderer.renderOverview(ui); renderer.renderOverview(ui);
                const hints = outputs.balanceBudgetChips.children.filter(node => node.dataset.pensionStatus);
                assertEqual(hints.length, household ? 2 : 1, 'Rendern und Reload verdoppeln keine Altfall-/Zukunftshinweise');
                hints.forEach((hint, index) => assertEqual(hint.textContent,
                    `Rente${household ? ` Muster <${index ? 'B' : 'A'}&>` : ''} ${offset > 0 ? 'ab 01.01.2028 · noch nicht im Budget' : 'läuft · im Budget'}`,
                    'Vollständiger Hinweis bei fehlendem/nullwertigem/positivem Offset bleibt exakt, auch mit bloßem Januarvorschlag'));
                await PersistenceFacade.flush();
                assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Hinweisgegenproben erhalten sämtliche gespeicherten Records');
            }
        }
    } finally {
        Object.assign(globalThis, saved); PersistenceFacade.resetPersistenceRuntimeForTests();
    }
}

// Vollständiger synthetischer Vorher-/Nachherbeleg aus dfc8311, keine Kennzahlenauswahl.
{
    const { createHash } = await import('node:crypto');
    const { EngineAPI } = await import('../engine/index.mjs');
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const saved = { document: globalThis.document, window: globalThis.window, Date: globalThis.Date, sideEffects: UIReader.applySideEffectsFromInputs };
    try {
        // Metadaten allein begrenzen das Referenzjahr nicht: personReferenceYear nutzt
        // mindestens das laufende Jahr. Daher auch die Uhr nur für diesen Beleg pinnen.
        const fixedTime = saved.Date.parse('2026-10-07T12:00:00Z');
        globalThis.Date = class extends saved.Date {
            constructor(...args) { super(...(args.length ? args : [fixedTime])); }
            static now() { return fixedTime; }
        };
for (const date of ['', '2026-01-01', '2024-07-01']) {
    const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rente_monatlich: '1234.567', profile_sonstige_einkuenfte: '100', profile_rentenbeginn: date };
    const records = { ...data, rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: { a: { meta: { id: 'a', name: 'Muster A', belongsToHousehold: false }, data } } }),
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2025' } }) };
    PersistenceFacade.resetPersistenceForTests({ name: 'Beleg', async init() {}, async loadAll() { return records; }, async saveBatch() { throw new Error('UNEXPECTED_WRITE'); } });
    await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const doc = createSelectionDocument(); globalThis.document = doc; globalThis.window = {};
    const fields = ['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'fixedIncomeAnnual', 'kirchensteuerSatz', 'sparerPauschbetrag', 'floorBedarf', 'flexBedarf', 'tagesgeld', 'depotwertAlt', 'costBasisAlt', 'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth', 'inflation'];
    const dom = { inputs: Object.fromEntries(fields.map(key => [key, addField(doc, key)])), containers: {}, outputs: {} };
    for (const [key, value] of Object.entries({ floorBedarf: 24000, flexBedarf: 12000, tagesgeld: 50000, depotwertAlt: 500000, costBasisAlt: 350000, endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100 })) dom.inputs[key].value = String(value);
    initUIReader(dom); UIReader.applySideEffectsFromInputs = () => {};
    createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS }).syncProfileDerivedInputs();
    const input = UIReader.readAllInputs(), before = JSON.stringify(input), result = EngineAPI.simulateSingleYear(input, null);
    assertEqual(input.aktuellesAlter, 67, 'Hashbeleg verwendet das feste Januaralter im Planungsjahr 2026');
    if (JSON.stringify(input) !== before || !result.ui?.spending) throw new Error('Ungültiger Beleg');
    assertEqual(JSON.stringify(input), before, 'Balanceeingaben bleiben unverändert');
    assertEqual(createHash('sha256').update(JSON.stringify(result)).digest('hex'), 'aca1022f8a2b16cd00185e015b49eba7a89fdb9dd5f5347b7d6dabbea634a035', 'Vollständige Balance-JSON-Bytes entsprechen dem vorab gesicherten Altstand: ' + (date || 'fehlender Beginn'));
}
    } finally { Object.assign(globalThis, { document: saved.document, window: saved.window, Date: saved.Date }); UIReader.applySideEffectsFromInputs = saved.sideEffects; PersistenceFacade.resetPersistenceRuntimeForTests(); }
}

// Derselbe produktive Updatekörper rechnet genau die angehakten Personen.
{
    const pipeline = await import('../app/balance/balance-update-pipeline.js');
    const { functionSource, createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { readBalancePersonStatus, showPersonDataStatus } = await import('../app/shared/person-data-status.js');
    const { createProfilverbundHandlers } = await import('../app/balance/balance-main-profilverbund.js');
    const { loadProfilverbundProfiles } = await import('../app/profile/profilverbund-balance.js');
    const { postprocessBalanceAction } = await import('../app/balance/balance-action-postprocessor.js');
    const { overviewScope } = await import('../app/overview/overview-storage.js');
    const { buildBalanceOverviewSummary } = await import('../app/overview/overview-model.js');
    const { renderSuiteHousehold } = await import('../app/shared/suite-frame.js');
    const { EngineAPI } = await import('../engine/index.mjs');
    const { UIUtils } = await import('../app/balance/balance-utils.js');
    const { setAppTestDate } = await import('../app/shared/app-clock.js');
    const saved = { document: globalThis.document, window: globalThis.window, sideEffects: UIReader.applySideEffectsFromInputs };
    try {
        setAppTestDate('2026-01-02');
        for (const selected of [[], ['b'], ['a', 'b']]) {
            const data = (birthday, income, spb, tax) => ({ profile_person_schema_version: '1', profile_geburtsdatum: birthday,
                profile_rente_monatlich: income, profile_sparer_pauschbetrag: spb, profile_kirchensteuer_pct: tax,
                profile_tagesgeld: '50000', depot_tranchen: '[]' });
            const a = data('1961-03-14', '1000', '0', '8'), b = data('1958-03-14', '2000', '1500', '9');
            const records = { ...a, rs_current_profile: 'a', rs_active_profile: 'a', rs_profiles_v1: JSON.stringify({ version: 1, profiles: {
                a: { meta: { id: 'a', name: 'Synthetisch A', belongsToHousehold: selected.includes('a') }, data: a },
                b: { meta: { id: 'b', name: 'Synthetisch B', belongsToHousehold: selected.includes('b') }, data: b }
            } }) };
            PersistenceFacade.resetPersistenceForTests({ name: 'Auswahlupdate', async init() {}, async loadAll() { return { ...records }; }, async saveBatch() {} });
            await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
            const doc = createSelectionDocument(); doc.createDocumentFragment = () => doc.createElement('div');
            globalThis.document = doc;
            const seen = [], engine = { ...EngineAPI, simulateSingleYear(input, lastState) { seen.push(structuredClone(input)); return EngineAPI.simulateSingleYear(input, lastState); } };
            globalThis.window = { EngineAPI: engine };
            const keys = ['aktuellesAlter', 'renteAktiv', 'renteMonatlich', 'fixedIncomeAnnual', 'kirchensteuerSatz', 'sparerPauschbetrag', 'floorBedarf', 'flexBedarf', 'tagesgeld', 'endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath', 'jahreSeitAth'];
            const dom = { inputs: Object.fromEntries(keys.map(key => [key, addField(doc, key)])), outputs: {}, controls: {}, containers: {} };
            dom.inputs.floorBedarf.value = '10000'; dom.inputs.flexBedarf.value = '0';
            for (const key of ['endeVJ', 'endeVJ_1', 'endeVJ_2', 'endeVJ_3', 'ath']) dom.inputs[key].value = '100';
            initUIReader(dom); UIReader.applySideEffectsFromInputs = () => {};
            const sync = createProfileSyncHandlers({ dom, PROFILE_VALUE_KEYS });
            const handlers = createProfilverbundHandlers({ dom, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' } });
            let summaryScope;
            const renderer = { clearError() {}, renderContext() {}, renderBedarfAnpassungUI() {}, render() {},
                formatDiagnosisPayload() { return null; }, renderDiagnosis() {}, handleError(error) { throw error; } };
            const deps = { ...pipeline, persistenceStorage, PROFILVERBUND_STORAGE_KEYS: { mode: 'household_withdrawal_mode' }, evaluateBalanceFileInputs, readBalanceHouseholdPlan, stageBalancePlanPatch,
                dom, UIReader, UIUtils, StorageManager, UIRenderer: renderer,
                getBalancePlanTrial, renderBalanceInflationSource,
                readBalancePersonStatus, showPersonDataStatus, loadProfilverbundProfiles,
                getCurrentProfileId: () => persistenceStorage.getItem('rs_current_profile'),
                appState: { engineHandshake: pipeline.createEngineHandshake(engine, '') },
                profileSyncHandlers: sync, profilverbundHandlers: handlers,
                refreshBalanceWealthHistory() {}, refreshBalanceExpensesHistory() {},
                postprocessBalanceAction, withGuardrailCardValues: value => value,
                ANNUAL_MARKET_DATA_META_KEY: 'annualMarketDataMeta', updateExpensesBudget() {}, overviewScope,
                buildBalanceOverviewSummary, storeOverviewSummary(summary) { summaryScope = summary.scope; return Promise.resolve(true); } };
            const update = new Function(...Object.keys(deps), functionSource('app/balance/balance-main.js', 'update') + '\nreturn update;')(...Object.values(deps));
            StorageManager.loadState(); // Bestehende technische Erstinitialisierung vor dem Rechennachweis.
            const before = JSON.stringify(PersistenceFacade.exportAllSync().records);
            const result = update({ mode: 'preview' });
            assert(result.ok, 'Produktiver Updatepfad berechnet Auswahl ' + selected.join());
            const primary = selected.join() === 'b' ? { age: 67, income: 2000, spb: 1500, tax: .09 } : { age: 64, income: selected.length === 2 ? 3000 : 1000, spb: selected.length === 2 ? 1500 : 0, tax: .08 };
            assertEqual(seen[0].aktuellesAlter, primary.age, 'Engine erhält das Alter der tatsächlichen Basisperson');
            assertEqual(seen[0].renteMonatlich, primary.income, 'Engine erhält genau das ausgewählte Einkommen');
            assertEqual(seen[0].sparerPauschbetrag, primary.spb, 'Engine erhält den ausgewählten SPB');
            assertEqual(seen[0].kirchensteuerSatz, primary.tax, 'Engine erhält die eigene Kirchensteuer');
            assertEqual(summaryScope.ids.join(), (selected.length ? selected : ['a']).join(), 'Summary bindet genau den Rechenumfang');
            const head = addField(doc, 'suiteHouseholdContext'); renderSuiteHousehold(loadProfilverbundProfiles(), doc);
            assertEqual(head.textContent, selected.length ? 'Haushalt: ' + selected.map(id => 'Synthetisch ' + id.toUpperCase()).join(', ') : 'Haushalt: Keine Auswahl', 'Kopf nennt die Auswahl unabhängig von A');
            assertEqual(persistenceStorage.getItem('rs_current_profile'), 'a', 'Update erhält geöffnete Profilidentität');
            assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), before, 'Preview schreibt keine Personen- oder Fachrecords');
        }
    } finally { setAppTestDate(null); Object.assign(globalThis, { document: saved.document, window: saved.window }); UIReader.applySideEffectsFromInputs = saved.sideEffects; PersistenceFacade.resetPersistenceRuntimeForTests(); }
}
