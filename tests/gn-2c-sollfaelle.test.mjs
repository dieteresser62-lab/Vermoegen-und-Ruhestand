// GN-2c (Fable P2-1, Gemini P2-1 bis P2-3): Die Übersicht rechnet die Deckung mit derselben Rechnung wie „Deine Reserven“.
// Beispielhaushalte am 23.10.2026, Balance über den echten Renderer; „ohne Beleg“ = Jahresbeleg der Beispiele entfernt.
import { renderCard, clean, overviewModel, editRegistry, withPurchases } from './helpers/wt-1-balance-render.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { overviewPlanView } from '../app/overview/overview-renderer.js';
import { readCareInputs } from '../app/simulator/simulator-input-care.js';
import { careValuesWithPrices } from '../app/shared/care-prices.js';
import { HOUSEHOLD_CARE_VALUES_KEY } from '../app/shared/household-care-values.js';
import { validCareDriftYear, writeCareSettingField } from '../app/shared/care-price-fields.js';
import { PersistenceFacade as P, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';

const date = '2026-10-23';
const text = value => clean(value).replaceAll(' ', ' ');
async function compare(records) {
    const card = await renderCard({ ...records }, date);
    const balance = /nach Umsetzung (\S+ %)/.exec(text(card.doc.getElementById('balanceReserveCoverage')?.textContent || ''))?.[1] ?? null;
    const row = overviewPlanView(await overviewModel(records, date)).rows.find(item => item.label.startsWith('Liquidität'));
    return { balance, plan: text(row.plan), preview: text(row.preview), delta: text(row.delta) };
}

// Ohne Beleg: Vorschau = Reservekarte ohne Beleg (bisher Renate 105 %, Jan und Lena 50 %, Martin und Petra 125 %).
// GN-2d (Gemini P2-1): ohne vorherigen Besuch der Balance, also ohne gespeicherte Zusammenfassung mit Prozenten.
for (const [id, expected] of Object.entries({ renate: '108 %', 'jan-lena': '52 %', 'martin-petra': '100 %', 'max-erika': '109 %', 'helga-werner': '107 %', sophie: '100 %' })) {
    const records = createMusterHaushaltRecords(date, id);
    delete records.annual_plan_record_v1;
    const shown = await compare(records);
    assertEqual(`${shown.balance} | ${shown.preview} | ${shown.plan}`, `${expected} | ${expected} | —`, `GN-2c: ${id} ohne Beleg, Balance | Vorschau | Plan`);
}

// Mit Beleg wie ausgeliefert: Plan = Reservekarte mit Beleg. VK-3d P4: Martin und Petra 100 % (Kauf als Summe der Zeilen 122.000 €, vorher 125 %).
for (const [id, expected] of Object.entries({ 'max-erika': '109 %', renate: '105 %', 'jan-lena': '51 %', 'helga-werner': '108 %', sophie: '100 %', 'martin-petra': '100 %' })) {
    const shown = await compare(createMusterHaushaltRecords(date, id));
    assertEqual(`${shown.balance} | ${shown.plan}`, `${expected} | ${expected}`, `GN-2c: ${id} mit Beleg, Balance | Plan`);
    const delta = Number.parseInt(shown.preview, 10) - Number.parseInt(shown.plan, 10);
    assertEqual(shown.delta, `${delta > 0 ? '+' : ''}${delta} Prozentpunkte`, `GN-2d: ${id} Δ = angezeigte Vorschau − angezeigter Plan (${shown.preview} − ${shown.plan})`);
}

// Sophie mit Kauf-Beleg, Tagesgeld inzwischen gesunken: Vorschau = Reservekarte. Der Kauf des Belegs geht nicht mehr auf → Plan offen,
// nie die heutige Vorschau.
for (const [cash, expected] of [['4000', '108 %'], ['5500', '117 %']]) {
    const records = createMusterHaushaltRecords(date, 'sophie'), id = records.rs_current_profile;
    const shown = await compare(editRegistry(records, registry => { registry.profiles[id].data.profile_tagesgeld = cash; }));
    assertEqual(`${shown.balance} | ${shown.preview} | ${shown.plan}`, `${expected} | ${expected} | —`, `GN-2c: Sophie Tagesgeld ${cash} €, Balance | Vorschau | Plan`);
}

// GN-2d (Fable P2-1): Kauf-Beleg, davon 5.000 € schon gebucht. Heute rechnet die App 4.400 € statt 9.400 € → Plan „—“ (bisher 17 %).
{
    const records = createMusterHaushaltRecords(date, 'sophie');
    const shown = await compare(withPurchases(records, [{ profileId: records.rs_current_profile, amount: 5000 }]));
    assertEqual(`${shown.balance} | ${shown.preview} | ${shown.plan}`, '100 % | 100 % | —', 'GN-2d: Sophie nach 5.000 € Kauf, Balance | Vorschau | Plan');
}
{
    const shown = await compare(createMusterHaushaltRecords(date, 'renate'));
    assertEqual(`${shown.plan} | ${shown.preview} | ${shown.delta}`, '105 % | 108 % | +3 Prozentpunkte', 'GN-2d: Renate mit Beleg ohne Balance-Besuch, Δ aus den gezeigten Werten');
}

// Gemini P3-1: Ist die erste Rate im Preisblock markiert (ohne Verlauf), aktivieren `sim_`-Verlaufsfelder und ihre Simulatorfelder
// keinen Verlauf; ohne Preisblock gilt der `sim_`-Verlauf wie in `resolveCarePrices`.
{
    const record = careValuesWithPrices(null, { driftPercent: 4 }, { priceYear: 2026 });
    const marked = { ...record, prices: { ...record.prices, driftPercent: 3, driftUntilYear: undefined, driftAfterPercent: undefined } };
    const fields = { pflegeKostenDriftBis: '2030', pflegeKostenDriftDanach: '2' };
    const doc = { getElementById: id => fields[id] ? { value: fields[id] } : null, querySelector: () => null };
    const read = map => { const r = readCareInputs({ doc, storage: { getItem: key => map[key] ?? null, key: () => null, length: 0 } });
        return [r.pflegeKostenDrift, r.pflegeKostenDriftBis ?? '-', r.pflegeKostenDriftDanach ?? '-'].join(' / '); };
    const legacy = { sim_pflegeKostenDriftBis: '2030', sim_pflegeKostenDriftDanach: '2' };
    assertEqual(read({ [HOUSEHOLD_CARE_VALUES_KEY]: JSON.stringify(marked), ...legacy }), '0.03 / - / -', 'GN-2c: markierte 3 % bleiben dauerhaft (bisher 3 % bis 2030, danach 2 %)');
    assertEqual(read({ sim_pflegeKostenDrift: '4', ...legacy }), '0.05 / 2030 / 0.02', 'GN-2c: ohne Preisblock gilt der sim_-Verlauf (Resolver: 4 → 5)');
}

// Gemini P3-2: Ein ungültiges Jahr schreibt über `writeCareSettingField` keinen `sim_`-Wert.
{
    assertEqual(['2035', '', '-1', '2035,5', '2101'].map(validCareDriftYear).join(' '), 'true false false false false', 'GN-2c: Jahresprüfung');
    const store = new Map();
    P.resetPersistenceForTests({ name: 'gn-2c', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    try {
        for (const bad of ['', '-1', '1800']) writeCareSettingField('pflegeKostenDriftBis', bad);
        assertEqual(persistenceStorage.getItem('sim_pflegeKostenDriftBis'), null, 'GN-2c: ungültiges Jahr → kein sim_-Wert');
        writeCareSettingField('pflegeKostenDriftBis', '2030');
        assertEqual(persistenceStorage.getItem('sim_pflegeKostenDriftBis'), '2030', 'GN-2c: gültiges Jahr wird geschrieben');
    } finally { await resetPersistenceForTests(); }
}

// GN-2d Nachtrag 1 (Fable und Gemini P2): Beleg mit Gold- und Aktienkauf. Verglichen wird der gesamte Kauf, nicht die Hauptzeile
// „Gold kaufen“. Helga und Werner mit je 150.000 € mehr Tagesgeld, Beleg = die dazu heute gerechnete Handlung (Gold + Aktien).
{
    const { evaluateBalanceCurrentYear } = await import('../app/balance/balance-reserve-today.js');
    const { EngineAPI } = await import('../engine/index.mjs');
    const { setAppTestDate } = await import('../app/shared/app-clock.js');
    const base = () => editRegistry(createMusterHaushaltRecords(date, 'helga-werner'), registry => {
        for (const profile of Object.values(registry.profiles)) profile.data.profile_tagesgeld = String(Number(profile.data.profile_tagesgeld) + 150000); });
    const records = base();
    P.resetPersistenceForTests({ name: 'gn-2d', loadAll: async () => ({ ...records }), async saveBatch() {} });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false }); setAppTestDate(date);
    let action;
    try { action = evaluateBalanceCurrentYear({ storage: persistenceStorage, engineApi: EngineAPI, profileId: records.rs_current_profile }).action; }
    finally { await resetPersistenceForTests(); setAppTestDate(null); }
    assert(action.verwendungen.gold > 0 && action.verwendungen.aktien > 0, `GN-2d: Beleg kauft Gold und Aktien (${action.verwendungen.gold} + ${action.verwendungen.aktien})`);
    const key = 'annual_plan_record_v1';
    const patch = raw => { const data = JSON.parse(raw); for (const entry of Object.values(data.entries)) if (entry.year === 2026) {
        entry.recommended.action = structuredClone(action); entry.adopted.action = structuredClone(action); } return JSON.stringify(data); };
    const withReceipt = recordsIn => { const next = { ...recordsIn }; if (next[key]) next[key] = patch(next[key]);
        const registry = JSON.parse(next.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) if (profile.data[key]) profile.data[key] = patch(profile.data[key]);
        next.rs_profiles_v1 = JSON.stringify(registry); return next; };
    const unchanged = await compare(withReceipt(base()));
    assert(unchanged.plan !== '—' && unchanged.plan === unchanged.balance, `GN-2d: unveränderter Gold- und Aktienkauf, Plan gefüllt wie die Balance (${unchanged.balance} | ${unchanged.plan})`);
    const receipt = withReceipt(base());
    const partial = await compare(withPurchases(receipt, [{ profileId: receipt.rs_current_profile, amount: 30000 }]));
    assertEqual(`${partial.preview} | ${partial.plan}`, `${partial.balance} | —`, 'GN-2d: 30.000 € des Aktienkaufs eingetragen → Plan „—“ (bisher 93 %)');
}

// GN-2d (Fable P3-1, Gemini P3-2): Nach einem Ladefehler versucht der nächste Neuaufbau es erneut; ein werfendes `onReady` hält nichts an.
// GN-2e: gerechnet wird erst im Leerlauf und nicht während eines Seitenwechsels.
{
    const { createOverviewReserves } = await import('../app/overview/overview-reserves.js');
    const warn = console.warn; console.warn = () => {};
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
        let attempts = 0, busy = true, calculated = 0;
        const reserves = createOverviewReserves({ onReady: () => { throw new Error('Neuzeichnen scheitert'); }, isBusy: () => busy,
            schedule: task => setTimeout(task, 0),
            load: async () => { attempts += 1; if (attempts === 1) throw new Error('Engine fehlt');
                return () => { calculated += 1; return { plan: null, preview: { today: 50, after: 60 } }; }; } });
        const model = { available: true, scope: { key: 'x' }, activeId: 'a', now: new Date('2026-10-23T12:00:00Z') };
        const source = { storage: /** @type {any} */ ({}), liveData: {} };
        assertEqual(reserves.project(model, source).reserveCoverages, undefined, 'GN-2e: im Neuaufbau selbst wird nichts gerechnet');
        await tick(); await tick();
        assertEqual(attempts, 0, 'GN-2e: während eines Seitenwechsels weder Laden noch Rechnen');
        busy = false;
        await new Promise(resolve => setTimeout(resolve, 250)); await tick();
        assertEqual(`${attempts} ${reserves.project(model, source).reserveCoverages}`, '1 undefined', 'GN-2d: nach Ladefehler „—“');
        await tick(); await tick(); await tick();
        assertEqual(`${attempts} ${calculated} ${reserves.project(model, source).reserveCoverages?.preview.after}`, '2 1 60',
            'GN-2d: der nächste Neuaufbau lädt erneut, werfendes onReady ohne Folgen');
    } finally { console.warn = warn; }
}
