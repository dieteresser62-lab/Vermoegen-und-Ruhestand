import { PersistenceFacade as P, persistenceStorage } from '../app/shared/persistence-facade.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { careSettingsStorage } from '../app/shared/care-profile-settings.js';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initializePflegeUIControls, PFLEGE_CUSTOM_COSTS_KEY } from '../app/simulator/simulator-ui-pflege.js';
import { protocolActionShortText, protocolActionExplanation } from '../app/simulator/protocol-renderer.js';
import { translateProtocolText, getProtocolColumns } from '../app/simulator/protocol-columns.js';
import { buildAccessibleBacktestTableHtml } from '../app/simulator/historical-backtest-ui.js';
import { buildBacktestColumnDefinitions, formatColumnValue } from '../app/simulator/simulator-main-helpers.js';
import { serializeHistoricalBacktestCsv } from '../app/simulator/historical-backtest-export.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { loadProfileAssetValues, saveProfileAssetValues } from '../app/profile/profile-asset-values.js';
import { balanceIncomeDetails } from '../app/balance/balance-monthly-flow.js';
import { displayDiagnosisText } from '../app/balance/balance-diagnosis-transaction.js';

const plain = text => text.replaceAll('\u00a0', ' ');
const prior = { document: globalThis.document, window: globalThis.window };
async function restart(records) {
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'VF-2h roundtrip', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    globalThis.document = simulatorDocument();
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initializePflegeUIControls();
    return { select: document.getElementById('pflegeKostenStaffelPreset'),
        costs: [1, 2, 3, 4, 5].map(grade => document.getElementById(`pflegeStufe${grade}Zusatz`)) };
}
const selectPreset = (ui, value) => { ui.select.value = value; ui.select.dispatchEvent(new Event('change')); };
try {
    let ui = await restart({ sim_pflegeKostenStaffelPreset: 'custom' });
    const custom = ['1234', '5678', '9012', '34567', '89123'];
    ui.costs.forEach((field, index) => { field.value = custom[index]; field.dispatchEvent(new Event('input')); });
    assertEqual(persistenceStorage.getItem(PFLEGE_CUSTOM_COSTS_KEY), null, 'Altdaten ohne Merker bleiben bis zum Wechsel erhalten');
    for (const preset of ['amtlich', 'ambulant']) {
        selectPreset(ui, preset);
        assertEqual(Object.values(JSON.parse(persistenceStorage.getItem(PFLEGE_CUSTOM_COSTS_KEY)).values).join('/'), custom.join('/'), 'Eigene Kosten liegen markiert im Simulator-Speicherweg (PFA-4 B7)');
        await P.flush();
        // Ein neues Dokument und ein neu gestartetes Backend lesen nur bestätigte Speicherbytes.
        ui = await restart(await P.readPersistedRecords());
        selectPreset(ui, 'custom');
        assertEqual(ui.costs.map(field => field.value).join('/'), custom.join('/'), `${preset}: Neustart stellt alle fünf Eingaben wieder her`);
    }
    selectPreset(ui, 'ambulant'); await P.flush();
    const backup = normalizeFullPersistenceBackup(JSON.parse(JSON.stringify(buildFullPersistenceBackup())));
    assert(backup.ok, 'Vollsicherung lässt sich über den produktiven Importparser lesen');
    ui = await restart(backup.backup.records); selectPreset(ui, 'custom');
    assertEqual(ui.costs.map(field => field.value).join('/'), custom.join('/'), 'Sicherung/Import nimmt die eigenen Kosten mit');

    const row = { aktionUndGrund: 'Runway-Notfüllung (neutral) (Cap aktiv) / Verkauf für die Auszahlung 6601.43 €',
        vk: { vkAkt: 13083.43, vkGes: 13083.43 }, inflation_factor_cum: 2, inflation: 25 };
    const bytes = JSON.stringify(row);
    for (const source of ['mc', 'backtest']) for (const moneyBasis of ['nominal', 'real']) {
        const entry = source === 'mc' ? row : { jahr: 2001, row, inflationVJ: 25 };
        const opts = { source, moneyBasis };
        const factor = moneyBasis === 'nominal' ? 1 : source === 'mc' ? 2 : 2.5;
        const euro = value => `${Math.round(value / factor).toLocaleString('de-DE')} €`;
        const short = plain(protocolActionShortText(entry, opts)), info = plain(protocolActionExplanation(entry, opts));
        assertEqual(short, `Aktien verkauft ${euro(13083.43)} · davon ${euro(6601.43)} für die Entnahme dieses Jahres`, `${source}/${moneyBasis}: Gesamtverkauf und Teilbetrag getrennt`);
        assert(info.includes(`Liquidität aufgefüllt (begrenzt): ${euro(6482)}`) && info.includes(`Zusätzlich für die Entnahme verkauft: ${euro(6601.43)}`), `${source}/${moneyBasis}: beide Teile in derselben Eurobasis`);
        assert(!/Runway|Cap aktiv|Auszahlung|6601\.43/.test(info), 'Handlungs-Info ohne Rohbegriffe und Rohzahl');
    }
    const person = { ...row, aktionUndGrund: 'Profilverbund-Transaktionen / Verkauf für die Auszahlung 6601.43 € / Rebal.(A+)',
        personalPayoutSales: [{ name: 'Martin', gross: 6601.43, share: .82 }] };
    const info = plain(protocolActionExplanation(person, { moneyBasis: 'real' }));
    assert(info.includes('Verkäufe und Käufe je Person') && info.includes('Martin verkauft 3.301 € für den eigenen Anteil an den Ausgaben'), 'Unverheirateten-Info benennt Person und Ausgabenanteil');
    assert(!/Profilverbund|Auszahlung|Rebal/.test(info), 'Personen-Info ohne technische Rohtexte');
    assertEqual(displayDiagnosisText('Profilverbund-Transaktionen'), 'Verkäufe und Käufe je Person', 'Balance übersetzt dieselbe Handlung');
    for (const raw of ['Runway-Notfüllung (neutral) (Cap aktiv)', 'Umschichtung: Aktien in Anleihen (3-Bucket)', 'Opportunistisches Rebalancing (Skim & Fill)', 'Bärenmarkt-Auffüllung (Drip)']) {
        assert(!/Runway|neutral|Cap aktiv|3-Bucket|Rebalancing|Drip|Skim/.test(translateProtocolText(raw)), 'Weitere Handlungs-Rohtexte sind übersetzt');
    }
    assertEqual(JSON.stringify(row), bytes, 'Textprojektion lässt sämtliche Quellbytes gleich');

    const inputs = await measurementInputs(0, 'renate', '2026-10-23');
    const result = backtest(inputs), before = JSON.stringify(result);
    const csv = serializeHistoricalBacktestCsv(result, { runIdentity: 'vf2h' }).split('\n').map(line => line.split(';'));
    const index = key => csv[0].indexOf(key);
    const stocks = ['equity', 'bond_bucket', 'gold', 'cash'].map(key => index(`portfolio_${key}_end_nominal_eur`));
    assert(stocks.every(index => index >= 0), 'Echter Download enthält vier getrennte Vermögenstöpfe');
    for (const line of csv.slice(1)) {
        const total = stocks.reduce((sum, index) => sum + Number(line[index]), 0);
        assert(Math.abs(total - Number(line[index('portfolio_total_end_nominal_eur')])) < .000001, 'CSV: Aktien + Anleihen + Gold + Liquidität = Gesamtvermögen');
    }
    // Derselbe Summenvertrag gilt mit gebundener Pflegereserve.
    const careResult = structuredClone(result);
    for (const entry of careResult.rows) { entry.row.health_bucket_end = 10000; entry.row.portfolio_total_end += 10000; }
    const careCsv = serializeHistoricalBacktestCsv(careResult, { runIdentity: 'vf2h-care' }).split('\n').map(line => line.split(';'));
    const careIndex = key => careCsv[0].indexOf(key);
    assert(careCsv.slice(1).some(line => Number(line[careIndex('health_bucket_end_nominal_eur')]) > 0), 'Summenprobe umfasst eine synthetisch gebundene Pflegereserve');
    for (const line of careCsv.slice(1)) {
        const total = ['equity', 'bond_bucket', 'gold', 'cash'].reduce((sum, key) => sum + Number(line[careIndex(`portfolio_${key}_end_nominal_eur`)]), 0);
        assert(Math.abs(total - Number(line[careIndex('portfolio_total_end_nominal_eur')])) < .011, 'CSV mit Pflegereserve: vier Anlageklassen ergeben das Gesamtvermögen');
        assert(Number(line[careIndex('portfolio_cash_end_nominal_eur')]) >= Number(line[careIndex('health_bucket_end_nominal_eur')]), 'Pflegereserve wird als Anteil der Liquidität ausgewiesen');
    }
    const options = { source: 'backtest', strategyMode: '3_bucket_jilge', rows: result.rows, moneyBasis: 'nominal' };
    const columns = buildBacktestColumnDefinitions('normal', { ...options, display: true });
    const table = buildAccessibleBacktestTableHtml(result.rows, columns, formatColumnValue, options);
    assert(table.includes('Handlung und vollständige Begründung'), 'Echter Backtest zeigt das Handlungs-Info');
    const equity = getProtocolColumns(options).find(column => column.id === 'neta');
    for (const entry of result.rows) {
        const net = (entry.row.vk?.vkAkt || 0) - (entry.row.kaufAkt || 0);
        assertEqual(equity.extractor(entry), net, 'Backtest-Aktienhandel enthält ausschließlich Aktien');
        assertEqual(protocolActionShortText(entry, options), protocolActionShortText(entry.row, { ...options, source: 'mc' }), 'Backtest und MC zeigen denselben Saldo je Klasse');
    }
    assertEqual(JSON.stringify(result), before, 'Anzeige und echter CSV-Export lassen Backtestbytes gleich');

    const records = createMusterHaushaltRecords('2026-10-23', 'helga-werner', 'haus-pg3');
    const profiles = Object.values(JSON.parse(records.rs_profiles_v1).profiles);
    const werner = profiles.find(profile => profile.meta.name === 'Werner');
    const store = new Map(Object.entries(werner.data));
    const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
    const status = () => ({ ready: true, referenceYear: 2026, entries: [{ name: 'Werner', profileId: werner.meta.id, data: Object.fromEntries(store) }] });
    const label = () => balanceIncomeDetails(status()).find(item => item.amount === 1900).label;
    assertEqual(label(), 'Rente Werner', 'Beispielrente heißt vor dem Speichern Rente Werner');
    const values = loadProfileAssetValues(storage); values.careToday = { ...values.careToday, form: 'home-support' };
    saveProfileAssetValues(values, storage)
    assertEqual(label(), 'Rente Werner', 'Pflegeform speichern erhält dieselbe Rentenbezeichnung');
    saveProfileAssetValues({ ...values, renteBezeichnung: 'Meine Rente' }, storage);
    assertEqual(label(), 'Meine Rente Werner', 'Eigene Rentenbezeichnung bleibt erhalten');

    const registryRecords = createMusterHaushaltRecords('2026-10-23', 'helga-werner');
    await restart(registryRecords);
    const registry = JSON.parse(registryRecords.rs_profiles_v1), ids = Object.keys(registry.profiles);
    persistenceStorage.setItem('rs_current_profile', ids[1]);
    careSettingsStorage(persistenceStorage).setItem(PFLEGE_CUSTOM_COSTS_KEY, JSON.stringify({ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5' }));
    assertEqual(JSON.parse(persistenceStorage.getItem('rs_profiles_v1')).profiles[ids[0]].data[PFLEGE_CUSTOM_COSTS_KEY], '{"1":"1","2":"2","3":"3","4":"4","5":"5"}', 'Auch beim zweiten Haushaltsmitglied liegt der Merker bei der gemeinsamen Pflegeannahme');
} finally {
    globalThis.document = prior.document; globalThis.window = prior.window; P.resetPersistenceForTests();
}
