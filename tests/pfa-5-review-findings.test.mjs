// FR-73 Paket 5: Gegenproben des Codex-Gutachtens zu PFA-4 (Befunde 1–4) und die Bildabnahme (Platzhalter).
// Testdatum 23.10.2026; alter Stand 54c841ad rot.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { CARE_VALUE_KEYS } from '../app/profile/profile-care.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { projectCareHint, refreshCareHints } from '../app/shared/care-hint.js';
import { syncManagerCareToday } from '../app/tranches/tranchen-manager-care.js';
import { HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
setAppTestDate('2026-10-23');

const today = (grade, form, residentialSince) => ({ grade, form, ...(residentialSince ? { residentialSince } : {}) });
const close = (a, b, label, tolerance = 1e-6) => assert(Math.abs(a - b) < tolerance, `${label}: ${a} = ${b}`);
/** Balance-Lesung ohne Writes. */
function balance(records, scope) {
    const { storage, counts } = countingStorage(records);
    const calc = buildBalanceEngineInputFromStorage({ storage, scope, referenceYear: 2026 });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Lesen schreibt nie');
    return calc;
}
const listen = (node, type, fn) => node.addEventListener(type, fn);
const metadata = { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' } };
/** Abschlussfähige Records mit offener Periode 2026 (wie in PFA-4). */
function closable(options) {
    const { records, scope } = pfa2Records(options);
    const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]); state.annualPeriodMetadata = metadata;
    records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state); records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: {} });
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) if (registry.profiles[id]) { const own = JSON.parse(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]); own.annualPeriodMetadata = metadata; registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(own); }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return { records, scope, marketData: { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2 } } };
}
/** Lohnannahme der Balance (lohnWachstum in den gespeicherten Balance-Eingaben) setzen. */
function withWage(records, percent) {
    const patch = raw => { const state = JSON.parse(raw); state.inputs.lohnWachstum = percent; return JSON.stringify(state); };
    records[CONFIG.STORAGE.LS_KEY] = patch(records[CONFIG.STORAGE.LS_KEY]);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = patch(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]);
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
}

// Befund 1: Folgejahreseinkünfte mit Fortschreibung wie im Simulator (Fall D, 2 % Inflation).
{
    const fixed = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], pensions: [1000, 0],
        sim: { profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '3' } });
    const calc = balance(fixed.records, fixed.scope);
    close(calc.inputData.careLiquidityProjection.floor, 60790.572, 'B1 Folgejahresbedarf D mit 2 % Inflation bleibt');
    close(calc.inputData.careLiquidityProjection.income, 12360, 'B1 Rente 1.000 €/Monat mit fester Anpassung 3 % → 12.360 € (nicht 12.000)');
    const engine = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
    assertEqual(engine.ui.zielLiquiditaet, 242200, 'B1 Zielliquidität 5 × (60.790,57 − 12.360) ≈ 242.200 € (nicht 244.000)');
    const cpi = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], pensions: [1000, 0], sim: { profile_rentenanpassung_art: 'cpi' } });
    close(balance(cpi.records, cpi.scope).inputData.careLiquidityProjection.income, 12240, 'B1 Rentenanpassung nach Inflation: 12.000 × 1,02 = 12.240 €');
    const wage = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], pensions: [1000, 0], sim: { profile_rentenanpassung_art: 'wage' } });
    close(balance(withWage(wage.records, 1), wage.scope).inputData.careLiquidityProjection.income, 12120, 'B1 Rentenanpassung nach Lohn mit Lohnannahme 1 %: 12.120 €');
    const income = (anpassung, extra = {}) => JSON.stringify({ schemaVersion: 1, entries: [{ id: 'job', art: 'sonstige', bezeichnung: 'Nebenjob', betragMonat: 1000, ab: null, bis: null, anpassung, ...extra }] });
    const bound = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], sim: { profile_einkuenfte_v1: income('inflation'), profile_einkuenfte_migration_v1: '1' } });
    const boundCalc = balance(bound.records, bound.scope);
    assertEqual(boundCalc.inputData.renteMonatlich, 1000, 'B1 inflationsgebundene Einkunft zählt 2026 mit 1.000 €/Monat');
    close(boundCalc.inputData.careLiquidityProjection.income, 12240, 'B1 inflationsgebundene feste Einkunft im Folgejahr 12.240 € (nicht 12.000)');
    const wageBound = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], sim: { profile_einkuenfte_v1: income('lohn'), profile_einkuenfte_migration_v1: '1' } });
    close(balance(withWage(wageBound.records, 1), wageBound.scope).inputData.careLiquidityProjection.income, 12120, 'B1 lohngebundene feste Einkunft mit Lohnannahme 1 %: 12.120 €');
    const plain = pfa2Records({ care: [null, today(4, 'residential', '2023-01')], sim: { profile_einkuenfte_v1: income('keine'), profile_einkuenfte_migration_v1: '1' } });
    close(balance(plain.records, plain.scope).inputData.careLiquidityProjection.income, 12000, 'B1 Einkunft ohne Anpassung bleibt 12.000 €');
    const allowance = pfa2Records({ care: [null, today(2, 'family')] });
    const allowanceCalc = balance(allowance.records, allowance.scope);
    assertEqual(allowanceCalc.inputData.renteMonatlich * 12, 4164, 'B1 Pflegegeld Grad 2 heute 4.164 €/Jahr');
    close(allowanceCalc.inputData.careLiquidityProjection.income, 4247.28, 'B1 Pflegegeld im Folgejahr 4.164 × 1,02 = 4.247,28 € (nicht 4.164)');
}

// Befund 3: Der eigene Wert ist im Schritt „Pflegewerte“ änderbar; der bestätigte Betrag geht in den Abschlussbatch.
{
    const KEY = CARE_VALUE_KEYS.homeCostsMonthly, werner = IDS[1];
    const { records, scope, marketData } = closable({ care: [null, { grade: 3, form: 'home-support', homeCostsMonthly: 200 }] });
    const store = annualRecordStorage(records), { doc } = createDialogFixture();
    const editor = createAnnualCareEditor({ doc, targetYear: 2026, storage: store, listen }); doc.body.append(editor.root);
    editor.setInflation(2);
    const field = doc.getElementById(`annualCare_own:${werner}`);
    assert(field && field.value === '214 €', 'B3 „Werte ändern …“ bietet je Person ein Feld mit dem fortgeschriebenen Betrag (200 → 214 €)');
    assertEqual(field.getAttribute('inputmode'), 'decimal', 'B3 Feld folgt dem Muster der übrigen Dialogfelder');
    assert(doc.querySelector('[data-annual-care-own-values]').textContent.includes('Werner 200 € → 214 €/Monat'), 'B3 Zeile zeigt den Vorschlag');
    assertEqual(JSON.stringify(editor.read().careToday), '{}', 'B3 unberührt: kein eigener Betrag im Entwurf');
    await editor.root.querySelector('[data-annual-care-edit]').fire('click');
    field.value = '220'; await field.fire('input');
    assert(!editor.read().confirmed && editor.read().dirty, 'B3 Änderung verlangt erneute Bestätigung');
    assertEqual(JSON.stringify(editor.read().careToday), JSON.stringify({ [werner]: 220 }), 'B3 Entwurf trägt den geänderten Betrag je Person');
    assert(doc.querySelector('[data-annual-care-own-values]').textContent.includes('Werner 200 € → 220 €/Monat'), 'B3 Zeile zeigt den geänderten Betrag');
    await editor.root.querySelector('[data-annual-care-confirm]').fire('click');
    assert(editor.read().confirmed, 'B3 bestätigt');
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, scope, storage: annualRecordStorage(records), now: annualTestNow });
    const changed = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, careValues: editor.accept(), careToday: editor.read().careToday, now: annualTestNow });
    assertEqual(JSON.parse(changed.records.rs_profiles_v1).profiles[werner].data[KEY], '220', 'B3 Abschlussbatch speichert 220 €/Monat (nicht nochmals fortgeschrieben)');
    assertEqual(changed.records[KEY], undefined, 'B3 Werner ist nicht die aktive Person: keine Livequelle');
    const untouched = createAnnualCareEditor({ doc, targetYear: 2026, storage: annualRecordStorage(records), listen }); doc.body.append(untouched.root);
    untouched.setInflation(2); await untouched.root.querySelector('[data-annual-care-confirm]').fire('click');
    const kept = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, adoptedPlanPatch: { floorBedarf: 36720 }, careValues: untouched.accept(), careToday: untouched.read().careToday, now: annualTestNow });
    assertEqual(JSON.parse(kept.records.rs_profiles_v1).profiles[werner].data[KEY], '214', 'B3 „Unverändert bestätigen“ schreibt die Fortschreibung 214 €/Monat');
    assertEqual(JSON.parse(records.rs_profiles_v1).profiles[werner].data[KEY], '200', 'B3 die Basis bleibt bis zum Abschluss unverändert');
    field.value = '-5'; await field.fire('input');
    assert(!doc.getElementById(`annualCare_own:${werner}_error`).hidden && editor.root.querySelector('[data-annual-care-confirm]').disabled, 'B3 ungültiger Betrag sperrt die Bestätigung');
    let error = '';
    try { prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, careToday: { [werner]: -5 }, now: annualTestNow }); } catch (e) { error = e.message; }
    assert(error.includes('ab 0'), 'B3 der Abschlussbatch weist einen ungültigen eigenen Betrag ab');
}

// Befund 4: Ohne Planrecord nennen Balance, Personenkarte und Haushalt & Plan denselben Betrag aus der gespeicherten Bedarfsbasis.
{
    // Gespeicherte Bedarfsbasis ohne Planrecord wie in der PFA-4-Probe B4 (Grundbedarf 36.000 €, Flex 12.000/6.000 €).
    const { records } = pfa2Records({ care: [null, today(3, 'home-support')], plan: { flexBedarf: 12000, minimumFlexAnnual: 6000 } });
    delete records[HOUSEHOLD_PLAN_KEY];
    const patch = raw => { const state = JSON.parse(raw); state.inputs.flexBedarf = 12000; state.inputs.minimumFlexAnnual = 6000; return JSON.stringify(state); };
    records[CONFIG.STORAGE.LS_KEY] = patch(records[CONFIG.STORAGE.LS_KEY]);
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const id of IDS) registry.profiles[id].data[CONFIG.STORAGE.LS_KEY] = patch(registry.profiles[id].data[CONFIG.STORAGE.LS_KEY]);
    records.rs_profiles_v1 = JSON.stringify(registry);
    const { storage, counts } = countingStorage(records);
    const calc = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2026 });
    assertEqual(calc.householdPlan.status, 'missing', 'B4 Vorbedingung: kein Planrecord');
    const expected = JSON.stringify([{ profileId: 'muster_werner', name: 'Werner', grade: 3, residential: false, own: false, monthly: 1500 }]);
    assertEqual(JSON.stringify(calc.careHint.persons), expected, 'B4 Balance nennt Werner 1.500 €/Monat');
    assertEqual(JSON.stringify(projectCareHint({ storage }).persons), expected, 'B4 Hinweisprojektion ohne Plan nennt denselben Betrag (nicht monthly: null)');
    const host = () => ({ hidden: true, html: '', set innerHTML(value) { this.html = value; }, get innerHTML() { return this.html; }, replaceChildren() { this.html = ''; } });
    const hosts = { profileCareHint: host(), managerPlanCareHint: host() };
    refreshCareHints({ getElementById: id => hosts[id] || null }, { storage });
    for (const [id, node] of Object.entries(hosts)) {
        const text = node.html.replace(/[\u00a0\u202f]/g, ' ');
        assert(!node.hidden && text.includes('Pflege Werner: 1.500 €/Monat (Grad 3 zu Hause, Staffel)') && !text.includes('bestätigtem Plan'), `B4 ${id} nennt 1.500 €/Monat ohne Ersatztext`);
    }
    assertEqual(counts.setItem + counts.removeItem, 0, 'B4 Hinweise lesen ohne Writes');
    const planned = pfa2Records({ care: [null, today(3, 'home-support')] });
    assertEqual(JSON.stringify(projectCareHint({ storage: countingStorage(planned.records).storage }).persons), expected, 'B4 mit Plan unverändert 1.500 €/Monat');
}

// Bildabnahme: Der Platzhalter des Feldes nennt den Staffelbetrag des heutigen Grads.
{
    const { storage } = countingStorage(pfa2Records({ care: [null, today(2, 'family')] }).records);
    const nodes = { profileCareGradeToday: { value: '2' }, profileCareHomeCostsMonthly: { placeholder: 'Staffelwert' } };
    syncManagerCareToday({ getElementById: id => nodes[id] || null }, storage);
    assertEqual(nodes.profileCareHomeCostsMonthly.placeholder, 'Staffel 500', 'Platzhalter „Staffel 500“ für Grad 2 (6.000 €/Jahr)');
    nodes.profileCareGradeToday.value = '3'; syncManagerCareToday({ getElementById: id => nodes[id] || null }, storage);
    assertEqual(nodes.profileCareHomeCostsMonthly.placeholder, 'Staffel 1.500', 'Platzhalter folgt dem Grad (Grad 3: 18.000 €/Jahr)');
}
setAppTestDate(null);
