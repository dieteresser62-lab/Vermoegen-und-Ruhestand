// GN-2b: Nachschritt zu GN-1 und GN-2 (Prüfkette, Gutachten Gemini und Fable).
import { readFileSync } from 'node:fs';
import { pfa2Records } from './helpers/pfa-2-balance.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { PersistenceFacade as P, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { bindManagerCareValues, renderManagerCareValues } from '../app/tranches/tranchen-manager-care-values.js';
import { resolveCarePrices, careDriftScheduleOf, careValuesWithPrices } from '../app/shared/care-prices.js';
import { readCareValues } from '../app/shared/household-care-values.js';
import { careSettingsStorage, sharesHouseholdCareValues } from '../app/shared/care-profile-settings.js';
import { careCostDriftFactor } from '../app/shared/care-cost-drift.js';
import { carePriceValue } from '../app/shared/care-price-fields.js';
import { displayedWithdrawal } from '../app/shared/display-rounding.js';
import { displayedReserveView } from '../app/balance/balance-reserves.js';
import { overviewPlanView } from '../app/overview/overview-renderer.js';
import { overviewModel } from './helpers/wt-1-balance-render.mjs';
import { householdPlanComparisonHtml, roundedHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { coverageAssumptions } from '../app/simulator/simulator-assumption-lines.js';

const schedule = prices => careDriftScheduleOf(prices);
const factor2045 = prices => careCostDriftFactor(2026, 2045, schedule(prices));

// Punkt 2 / Fable P2-2: Ändert der Nutzer eine Angabe, wird der ganze wirksame Verlauf geschrieben.
{
    const record = careValuesWithPrices(null, { driftPercent: 4 }, { priceYear: 2026 });
    assertEqual(JSON.stringify([record.prices.driftPercent, record.prices.driftUntilYear, record.prices.driftAfterPercent]), '[4,2035,2]',
        'GN-2b: Vorgabe, nur erste Rate 4 % → gespeichert 4 / 2035 / 2');
    assertClose(factor2045(resolveCarePrices(record, null)), 1.7350, 1e-4, 'GN-2b: Faktor 2045 = 1,04⁹ × 1,02¹⁰ = 1,7350 (bisher 1,04¹⁹ = 2,1068)');
    const legacy = resolveCarePrices({ prices: { ...record.prices, driftPercent: 3.5, driftUntilYear: undefined, driftAfterPercent: undefined } }, null);
    assertEqual(['pflegeKostenDrift', 'pflegeKostenDriftBis', 'pflegeKostenDriftDanach'].map(id => carePriceValue(id, legacy)).join(' / '), '3.5 / 2035 / 3.5',
        'GN-2b: bewusst eingetragene 3,5 % (vor GN-2) zeigen „3,5 bis 2035, danach 3,5“');
    // Fable P3-7: markierte erste Rate → keine sim_-Verlaufsfelder.
    const mixed = resolveCarePrices({ prices: { ...record.prices, driftPercent: 3, driftUntilYear: undefined, driftAfterPercent: undefined } },
        { sim_pflegeKostenDriftBis: '2030', sim_pflegeKostenDriftDanach: '2' });
    assertClose(factor2045(mixed), 1.7535, 1e-4, 'GN-2b: markierte 3 % ohne Verlauf bleiben dauerhaft, sim_-Verlauf zählt nicht');
}

// Punkt 3: gespeicherte 5 %, markiert oder nicht, ohne Folgewert → Stufe.
{
    const base = careValuesWithPrices(null, {}, { priceYear: 2026 });
    assertClose(factor2045(resolveCarePrices({ prices: { ...base.prices, driftPercent: 5 } }, null)), 1.8911, 1e-4, 'GN-2b: markierte 5 % → Stufe');
    assertClose(factor2045(resolveCarePrices(null, { sim_pflegeKostenDrift: '5' }, { shared: false })), 1.8911, 1e-4, 'GN-2b: unmarkierte 5 % → Stufe');
}

// Punkt 4 (Gemini 3): ohne Planzeilen dieselbe Deckung in Reservekarte und Übersicht, ganze Prozent.
{
    const view = { before: { tagesgeld: 34000, geldmarkt: 0, liquidity: 34000 }, after: null, targets: [], target: 34400 };
    assertEqual(Math.round(displayedReserveView(view, null).coverage.today), 97, 'GN-2b: Reservekarte 34.000 € zu 35.000 € → 97 %');
    // GN-2c: Die Übersicht nimmt dieselbe Rechnung (`displayedReserveView`) für beide Spalten.
    const shown = displayedReserveView(view, null).coverage;
    const table = roundedHouseholdPlanComparison({ rows: [{ label: 'Liquidität (Rechenergebnis nachher)', plan: '98,8 %', preview: '98,8 %', delta: '0,0 Prozentpunkte' }] },
        { planCoverage: shown.after ?? shown.today, previewCoverage: shown.after ?? shown.today }); // ohne Handlung: nachher = heute
    assertEqual(table.rows[0].plan.replace(/ /g, ' '), '97 %', 'GN-2b: Tabelle zeigt 97 %');
    const open = roundedHouseholdPlanComparison({ rows: [{ label: 'Liquidität (Rechenergebnis nachher)', plan: '0,0 %', preview: '98,8 %', delta: '98,8 Prozentpunkte' }] },
        { planCoverage: null, previewCoverage: shown.today });
    assertEqual(open.rows.map(row => `${row.plan} | ${row.preview} | ${row.delta}`).join('').replace(/[\u00a0\u202f]/g, ' '), '— | 97 % | —',
        'GN-2c: ohne Deckung aus angezeigten Beträgen keine Dezimalprozente, Δ nur aus zwei gezeigten Werten');
}

// Punkt 5 (Gemini 4): Plan 2.950 € / Rente 1.400 € und heute 2.960 € / Rente 1.400 € sehen gleich aus → keine Zusatzzeile.
assertEqual(displayedWithdrawal(1550, 2950), displayedWithdrawal(1560, 2960), 'GN-2b: Plan- und heutige Entnahme beide 1.500 € angezeigt');

// Fable P2-1: sichtbare Tabelle der Übersicht, Text wie in der Balance.
{
    const date = '2026-10-23', expected = { 'max-erika': '109 %', renate: '105 %', 'jan-lena': '51 %', 'helga-werner': '108 %', sophie: '100 %', 'martin-petra': '100 %' };
    for (const [id, coverage] of Object.entries(expected)) {
        const records = createMusterHaushaltRecords(date, id);
        const model = await overviewModel(records, date);
        const html = householdPlanComparisonHtml(overviewPlanView(model)).replace(/ /g, ' ');
        const row = /Liquidität[^<]*<\/th>\s*<td[^>]*>([^<]*)</.exec(html)?.[1] ?? html.match(/Liquidität.{0,200}/s)?.[0];
        assert(html.includes(`>${coverage}<`), `GN-2b: Übersicht ${id} zeigt ${coverage} wie die Balance (${row})`);
    }
    const records = createMusterHaushaltRecords(date, 'renate');
    const model = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, liveData: records, now: new Date(`${date}T12:00:00Z`) });
    assert(householdPlanComparisonHtml(overviewPlanView(model)).replace(/ /g, ' ').includes('>1.400 €<'), 'GN-2b: Renate Monatsbetrag 1.400 € = 2.800 − 1.400 (bisher 1.450 €)');
}

// Fable P3-3: Dauer aus den Laufparametern; Pflegekosten auch bei Pflegegrad heute ohne Pflegelogik.
{
    const inputs = { rentAdjMode: 'cpi', startAlter: 70, partner: { aktiv: false }, pflegeKostenDrift: 0.05, pflegeKostenDriftBis: 2035, pflegeKostenDriftDanach: 0.02,
        careToday: { grade: 2 } };
    const own = coverageAssumptions(inputs, null, { durationYears: 30 }).line, auto = coverageAssumptions(inputs, null, { durationYears: 40 }).line;
    assert(own.includes('Simulation über 30 Jahre') && auto.includes('Simulation bis Alter 110 der jüngsten Person'), `GN-2b: Dauer aus den Laufparametern (${own})`);
    assert(own.includes('Pflegekosten Inflation + 5 % bis 2035, danach + 2 %'), 'GN-2b: Pflegekosten auch bei Pflegegrad heute ohne Pflegelogik');
}

// Punkt 6 und Fable P2-2 im Reiter Pflege (echte Bindung): Jahr prüfen, ganzen Verlauf schreiben, Feld mit Fokus zeigt den wirksamen Wert.
{
    setAppTestDate('2026-10-23');
    function managerDocument() {
        const nodes = new Map(), listeners = {};
        const node = (id, extra = {}) => { const element = { id, dataset: {}, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', title: '', tagName: 'DIV', attributes: {},
            setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
            closest(selector) { return selector === '[data-care-preset]' && this.dataset.carePreset ? this : selector === '[data-care-person]' && this.dataset.carePerson ? this : null; }, ...extra };
        if (id) nodes.set(id, element); return element; };
        const html = readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
        const cells = [node(null), node(null)];
        node('managerCarePanel', { addEventListener(type, fn) { listeners[type] = fn; }, querySelectorAll: selector => selector === '[data-care-form-cell]' ? cells : [] });
        for (const match of html.matchAll(/<(input|select|dl|div|p|span|strong|td)\b[^>]*\bid="(managerCare[^"]+)"[^>]*>/g)) {
            if (nodes.has(match[2])) continue;
            const field = /data-care-field="([^"]+)"/.exec(match[0])?.[1];
            node(match[2], { tagName: match[1].toUpperCase(), ...(field ? { dataset: { careField: field } } : {}) });
        }
        const presets = ['custom', 'ambulant', 'amtlich'].map(preset => node(null, { tagName: 'BUTTON', dataset: { carePreset: preset } }));
        const doc = { activeElement: null, getElementById: id => nodes.get(id) ?? null, querySelectorAll: selector => selector === '#managerCarePreset [data-care-preset]' ? presets : [] };
        return { doc, nodes, change: (id, value) => { const field = nodes.get(id); field.value = value; listeners.change({ target: field }); } };
    }
    const { records } = pfa2Records({});
    const store = new Map(Object.entries(records));
    P.resetPersistenceForTests({ name: 'gn-2b', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    try {
        const page = managerDocument(); bindManagerCareValues(page.doc); renderManagerCareValues(page.doc);
        const settle = async () => { await P.flush(); for (let i = 0; i < 20; i++) await Promise.resolve(); };
        const effective = () => resolveCarePrices(readCareValues(persistenceStorage), careSettingsStorage(persistenceStorage), { shared: sharesHouseholdCareValues(persistenceStorage) });
        const fields = () => ['managerCareDrift', 'managerCareDriftUntil', 'managerCareDriftAfter'].map(id => page.nodes.get(id).value).join(' / ');
        // GN-2c (Gemini P3-2): auch leer und negativ mit der Jahresmeldung, nicht „Betrag ab 0“.
        for (const bad of ['2035,5', '1800', '2101', '', '-1']) {
            page.change('managerCareDriftUntil', bad); await settle();
            assert(/^Nicht gespeichert: Bitte ein ganzes Jahr von 2026 bis 2100/.test(page.nodes.get('managerCareStatus').textContent), `GN-2b: Jahr „${bad}“ wird nicht gespeichert, Jahresmeldung`);
            assertEqual(careSettingsStorage(persistenceStorage).getItem('sim_pflegeKostenDriftBis'), null, `GN-2b: Jahr ${bad} schreibt keinen sim_-Wert`);
        }
        page.change('managerCareDrift', '4'); page.doc.activeElement = page.nodes.get('managerCareDriftAfter'); await settle();
        assertEqual(fields(), '4 / 2035 / 2', 'GN-2b: Felder nach erster Rate 4 % (Fokus im Feld „danach“)');
        assertClose(careCostDriftFactor(2026, 2045, careDriftScheduleOf(effective())), 1.7350, 1e-4, 'GN-2b: gerechnet wird, was die Felder zeigen (1,7350)');
        page.doc.activeElement = null;
        page.change('managerCareDriftUntil', '2030'); await settle();
        assertEqual(JSON.stringify(careDriftScheduleOf(effective())), JSON.stringify({ firstPercent: 4, untilYear: 2030, afterPercent: 2 }), 'GN-2b: gültiges Jahr 2030 gespeichert');
    } finally { await resetPersistenceForTests(); setAppTestDate(null); }
}
