import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { bootstrapProfileContext, PROFILE_LIVE_BASE_KEY, saveCurrentProfileFromLocalStorage } from '../app/profile/profile-storage.js';
import { commitTrancheReconciliation } from '../app/tranches/tranche-reconciliation.js';
import { inheritancePreview, inheritanceTaxRate } from '../app/profile/household-partnership.js';

const selected = process.env.PA1_N;
const identity = data => JSON.stringify(Object.entries(data).sort(([a], [b]) => a.localeCompare(b)));
async function boot(data) {
    const registry = { version: 1, profiles: { a: { meta: { id: 'a', name: 'Max' }, data },
        b: { meta: { id: 'b', name: 'Erika' }, data: {} } } };
    const records = new Map(Object.entries({ rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'a', rs_active_profile: 'a', ...data }));
    P.resetPersistenceForTests({ name: 'PA-1 synthetic', async loadAll() { return Object.fromEntries(records); },
        async saveBatch({ upserts, deletes }) { deletes.forEach(key => records.delete(key)); upserts.forEach(([key, value]) => records.set(key, value)); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    return records;
}
try {
    if (!selected || selected === '1') {
        const lot = { schemaVersion: 1, trancheId: 'pa1-lot', name: 'Probe', isin: '', ticker: 'TEST.DE',
            shares: 10, purchasePrice: 80, currentPrice: 120, purchaseDate: '2020-01-02', category: 'equity', type: 'aktien_neu', tqf: .3, notes: '' };
        await boot({ depot_tranchen: JSON.stringify([lot]), sim_mcSeed: 'alt' });
        bootstrapProfileContext();
        await commitTrancheReconciliation({ profileId: 'a', action: { actionId: 'pa1-sale', profileId: 'a', trancheId: lot.trancheId,
            executedAt: '2026-10-23', sharesSold: 4, grossProceeds: 480, fees: 0 } });
        const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
        assertEqual(JSON.parse(storage.getItem(PROFILE_LIVE_BASE_KEY)).data, identity(registry.profiles.a.data), 'N1: echter Abgleich führt Ladebasis bis zur finalen Vermögenslos-Kopie mit');
        storage.setItem('sim_mcSeed', 'nach Abgleich'); await P.flush();
        assertEqual(bootstrapProfileContext({ preserveNewerLiveProfileData: true }).action, 'saved', 'N1: Absturzfenster nach Abgleich erhält neue Eingabe');
        assertEqual(storage.getItem('sim_mcSeed'), 'nach Abgleich', 'N1: neuere Liveeingabe bleibt erhalten');
    }
    if (!selected || selected === '2') {
        for (const status of ['married', 'unmarried']) for (const options of [{}, { testament: { home: 'residence', residenceTax: 'annual' }, partnerAge: 90 }, { homeAndTax: true }]) {
            const preview = inheritancePreview(0, 1000, 100, { ...options, status, selfUsedHome: 1000, exemptHome: 1000 });
            assertEqual(preview.tax, 0, 'N2: Vorschauerwerb ist steuerfrei');
            assertEqual(preview.rate, 0, 'N2: steuerfreie Vorschau zeigt Satz null in jedem Zweig');
        }
    }
    if (!selected || selected === '3') {
        await boot({ profile_rente_monatlich: '0', sim_mcSeed: 'gespeichert' });
        bootstrapProfileContext(); storage.setItem('sim_mcSeed', 'Live'); saveCurrentProfileFromLocalStorage();
        storage.setItem('sim_mcSeed', 'neuer');
        const getItem = storage.getItem, warn = console.warn, notes = [];
        let failed = false;
        storage.getItem = key => { if (key === 'sim_mcSeed' && !failed) { failed = true; throw new Error('Synthetischer beschädigter Livezugriff'); } return getItem(key); };
        console.warn = (...args) => notes.push(args.map(String).join(' '));
        try {
            assertEqual(bootstrapProfileContext({ preserveNewerLiveProfileData: true }).action, 'loaded', 'N3: nicht lesbarer Livevergleich fällt auf gespeicherten Stand zurück');
            assertEqual(storage.getItem('sim_mcSeed'), 'Live', 'N3: gespeicherter Stand wird geladen');
            assert(notes.some(note => note.includes('Live') && note.includes('gespeichert')), 'N3: Rückfall wird ohne Datenwerte protokolliert');
        } finally { storage.getItem = getItem; console.warn = warn; }
    }
    if (!selected || selected === '4') {
        const warn = console.warn, notes = []; console.warn = (...args) => notes.push(args.map(String).join(' '));
        try {
            for (const status of ['married', 'unmarried']) assertEqual(inheritanceTaxRate(NaN, status), 0, 'N4: NaN ergibt Steuersatz null');
            assertEqual(notes.length, 2, 'N4: ungültiger steuerpflichtiger Erwerb wird protokolliert');
        } finally { console.warn = warn; }
    }
} finally { P.resetPersistenceRuntimeForTests(); }
