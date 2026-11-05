import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { createInflationHandlers } from '../app/balance/balance-annual-inflation.js';
import { createMarketdataHandlers } from '../app/balance/balance-annual-marketdata.js';
import { createAnnualOrchestrator } from './helpers/balance-legacy-annual-handlers.mjs';
import { loadProfilverbundProfiles, aggregateProfilverbundInputs } from '../app/profile/profilverbund-balance.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { StorageManager } from '../app/balance/balance-storage.js';
import { UIRenderer } from '../app/balance/balance-renderer.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';

const old = { date: getAppTestDate(), timeout: globalThis.setTimeout, fetch: globalThis.fetch, toast: UIRenderer.toast,
    error: UIRenderer.handleActionError, clear: UIRenderer.clearActionError };
try {
    setAppTestDate('2027-01-02'); globalThis.setTimeout = fn => { fn(); return 0; };
    UIRenderer.toast = () => {}; UIRenderer.clearActionError = () => {}; UIRenderer.handleActionError = error => { throw error; };
    for (const [fallback, alreadyApplied] of [[false, false], [true, false], [false, true]]) {
        const person = (name, birth, start, pension) => ({ meta: { id: name, name, belongsToHousehold: true }, data: {
            profile_person_schema_version: '1', profile_geburtsdatum: birth, profile_aktuelles_alter: '67',
            profile_rentenbeginn: start, profile_rente_monatlich: String(pension), profile_tagesgeld: '50000',
            depot_tranchen: '[]', [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 10000, flexBedarf: 5000 } })
        } });
        const registry = { version: 1, profiles: { Max: person('Max', fallback ? '' : '1958-03-14', '2027-07-01', 1600), Erika: person('Erika', '1960-01-01', '2020-01-01', 1200),
            extern: { ...person('extern', '1970-01-01', '', 9000), meta: { id: 'extern', name: 'Außenprofil', belongsToHousehold: false } } } };
        const state = { inputs: { floorBedarf: 10000.49, flexBedarf: 5555.51 }, lastState: { cumulativeInflationFactor: 1 },
            ...(alreadyApplied ? { lastInflationAppliedAtYear: 2027 } : {}),
            annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-snapshot', phase: 'writes_started' } } };
        let batches = 0;
        const records = { rs_current_profile: 'Max', rs_active_profile: 'Max', rs_profiles_v1: JSON.stringify(registry),
            ...registry.profiles.Max.data, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) };
        PersistenceFacade.resetPersistenceForTests({ name: 'annual-preview', async open() {}, async loadAll() { return records; },
            async saveBatch() { batches++; } }); await PersistenceFacade.init({ installLifecycleHooks: false });
        const inputs = Object.fromEntries(Object.entries({ floorBedarf: '10.000,49', flexBedarf: '5.555,51', minimumFlexAnnual: '1.111,11',
            flexBudgetAnnual: '5.555,51', flexBudgetRecharge: '2.222,22', aktuellesAlter: '67', inflation: '2.5', endeVJ: '120', endeVJ_1: '110', endeVJ_2: '100', endeVJ_3: '90', ath: '150', jahreSeitAth: '1', marketCapeRatio: '28', capeRatio: '28' }).map(([id, value]) => [id, { value }]));
        const dom = { inputs, controls: { btnJahresUpdate: { innerHTML: 'Jahresupdate' } } };
        let network = 0; globalThis.fetch = () => { network++; throw new Error('UNEXPECTED_NETWORK'); };
        const lifecycle = { run: async (options, execute) => execute({ controller: new AbortController(), check() {}, commit() {} }) };
        const inflation = createInflationHandlers({ dom, update: () => ({ ok: true }), debouncedUpdate() {}, navigationLifecycle: lifecycle });
        const market = createMarketdataHandlers({ dom, debouncedUpdate() {}, applyAnnualInflation: inflation.applyAnnualInflation, navigationLifecycle: lifecycle });
        const bytes = JSON.stringify(PersistenceFacade.exportAllSync().records), form = JSON.stringify(inputs);
        const packageData = { inflation: await inflation.prepareInflation({ targetYear: 2026 }),
            etf: await market.prepareETF({ targetYear: 2026 }), cape: await market.prepareCape({ targetYear: 2026 }) };
        const preview = projectAnnualPreview({ targetYear: 2026, inputs, inflation: packageData.inflation });
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), bytes, 'Alle Vorabrufe und Vorschau erhalten Speicherbytes inklusive Registry');
        assertEqual(JSON.stringify(inputs), form, 'Vorbereitung erhält alle Formularwerte');
        assertEqual(batches, 0, 'Kein Vorbereitungswrite erreicht den Backendadapter');
        assertEqual(preview.people.length, 2, 'Vorschau enthält Max und Erika, kein Außenprofil');
        const { doc } = createDialogFixture();
        const dialog = createAnnualCloseDialog({ document: doc, projectPreview: () => preview, isCommitActive: () => false });
        let binding;
        const pending = dialog.showAnnualPreparation({ targetYear: 2026, onReady: handle => { binding = handle; } });
        binding.activate('preview');
        const previewStep = binding.root.querySelector('[data-close-dialog-step="preview"]');
        const previewText = dialogElements(previewStep).map(node => node.textContent).join(' ');
        for (const row of preview.people) assert(previewText.includes(`${row.startAlter}\u00a0Jahre am 01.01.2027`), `${row.name}: Schritt 6 kennzeichnet das Planungsalter mit Stichtag und Jahr`);
        assertEqual(JSON.stringify(PersistenceFacade.exportAllSync().records), bytes, 'Schritt-6-Anzeige erhält alle Speicherbytes');
        await binding.requestClose(); await pending;
        const orchestrator = createAnnualOrchestrator({ dom, debouncedUpdate() {}, navigationLifecycle: lifecycle,
            handleFetchInflation: inflation.handleFetchInflation, handleNachrueckenMitETF: market.handleNachrueckenMitETF,
            handleFetchCapeAuto: market.handleFetchCapeAuto, setLastUpdateResults() {}, showUpdateResultModal() {} });
        const applied = await orchestrator.handleJahresUpdate({ nested: true, referenceYear: 2027, personAgeAfter: fallback ? 67 : 68, preparedMarketData: packageData });
        assert(applied.ok, 'Realer Jahresorchestrator mit vorbereiteten Daten erfolgreich');
        const household = loadProfilverbundProfiles();
        const actual = aggregateProfilverbundInputs(household, { floorBedarf: UIUtils.parseCurrency(inputs.floorBedarf.value), flexBedarf: UIUtils.parseCurrency(inputs.flexBedarf.value) });
        for (const row of preview.people) {
            const real = household.find(person => person.profileId === row.id);
            assertEqual(row.startAlter, real.inputs.aktuellesAlter, `${row.name}: Vorschaualter entspricht Haushaltsleser nach Jahrespfad`);
            assertEqual(row.budgetPensionMonthly, real.inputs.renteMonatlich, `${row.name}: Rentenbezugsgröße entspricht Haushaltsleser`);
        }
        assertEqual(preview.needs.find(need => need.id === 'floorBedarf').after, actual.totalFloor, 'Floor nach Rundung entspricht echtem Jahres-/Haushaltspfad');
        assertEqual(preview.needs.find(need => need.id === 'flexBedarf').after, actual.totalFlex, 'Flex nach Rundung entspricht echtem Jahres-/Haushaltspfad');
        assertEqual(persistenceStorage.getItem('profile_aktuelles_alter'), '67', 'Jahresprojektion schreibt kein Personenalter');
        assertEqual(persistenceStorage.getItem('profile_geburtsdatum'), fallback ? '' : '1958-03-14', 'Geburtsdatum bleibt bytegleich');
        assertEqual(network, 0, 'Vorbereitung und Jahresanwendung im Spielbereich ohne Netz');
        assertEqual(applied.results.inflation.rate, packageData.inflation.rate, 'Genau vorbereitete Inflationsrate angewendet');
        assertEqual(applied.results.etf.price, Math.round(packageData.etf.price), 'Genau vorbereiteter ETF-Kurs angewendet');
        assertEqual(applied.results.cape.capeRatio, packageData.cape.capeRatio, 'Genau vorbereiteter CAPE angewendet');
    }
} finally {
    globalThis.setTimeout = old.timeout; globalThis.fetch = old.fetch; setAppTestDate(old.date);
    UIRenderer.toast = old.toast; UIRenderer.handleActionError = old.error; UIRenderer.clearActionError = old.clear;
    PersistenceFacade.resetPersistenceRuntimeForTests();
}
