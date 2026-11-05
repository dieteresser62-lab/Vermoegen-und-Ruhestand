import fs from 'node:fs';
import { PLANNED_EXPENSES_KEY, plannedExpenseErrors, assertPlannedExpensesRecord, readPlannedExpenses, savePlannedExpenses } from '../app/profile/household-planned-expenses.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, planScope, buildPlanRecord } from '../app/profile/household-plan.js';
import { INCOME_KEY, writeIncome } from '../app/profile/profile-income.js';
import { isProfileScopedKey } from '../app/profile/profile-key-policy.js';
import { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { buildFullPersistenceBackup, importFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { summarizeProbelaufChanges, buildProbelaufTransferRecords } from '../app/shared/probelauf-records.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { createManagerPlannedExpenses } from '../app/tranches/tranchen-manager-planned-expenses.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { buildPlanOverview, renderPlanOverview } from '../app/simulator/simulator-plan-overview.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { getCommonInputs } from '../app/simulator/simulator-portfolio-inputs.js';
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';

const same = (a, b, label) => assertEqual(JSON.stringify(a), JSON.stringify(b), label);
const scope = planScope('household', ['muster_a', 'muster_b']);
const outside = planScope('single', ['out']);
const fixed = { id: 'kredit', bezeichnung: 'Kredit', betragMonat: 450, ab: '2026-10', bis: '2027-03', anpassung: 'keine' };
const once = { id: 'auto', bezeichnung: 'Auto', monat: '2028-04', betrag: 35000 };
const record = items => JSON.stringify({ version: 1, entries: { [scope.key]: { scope, items } } });
const raw = record([fixed, once]);
async function boot(records) {
    const backend = new Map(Object.entries(records)), snapshots = new Map();
    P.resetPersistenceForTests({ name: 'expense-test', async loadAll() { return Object.fromEntries(backend); },
        async saveBatch({ upserts, deletes }) { for (const key of deletes) backend.delete(key); for (const [key, value] of upserts) backend.set(key, value); },
        async listSnapshots() { return [...snapshots.values()].map(({ records, ...meta }) => meta); },
        async readSnapshot(id) { return snapshots.get(id); }, async writeSnapshot(snapshot) { snapshots.set(snapshot.id, structuredClone(snapshot)); return true; }, async deleteSnapshot(id) { return snapshots.delete(id); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false }); return backend;
}

try {
    setAppTestDate('2026-10-21');
    assert(isAllowedPersistenceImportKey(PLANNED_EXPENSES_KEY) && isAllowedSnapshotCaptureKey(PLANNED_EXPENSES_KEY), 'Haushaltsausgaben gehören zu Sicherung, Import und Wiederherstellung');
    assert(!isProfileScopedKey(PLANNED_EXPENSES_KEY), 'Profilwechsel kopiert keine Haushaltsausgaben in Personenrecords');
    for (const patch of [{ betragMonat: 0 }, { betragMonat: Infinity }, { bis: '2026-01' }, { ab: '2026-13' }, { anpassung: 'lohn' }]) assert(plannedExpenseErrors([{ ...fixed, ...patch }]).length > 0, 'Ungültige feste Ausgabe wird zurückgewiesen');
    assert(plannedExpenseErrors([fixed, fixed]).length > 0, 'Doppelte Kennungen werden zurückgewiesen');
    for (const bad of ['{', JSON.stringify({ version: 2, entries: {} }), record([{ ...once, monat: null }])]) {
        let failed = false; try { assertPlannedExpensesRecord(bad); } catch { failed = true; }
        assert(failed, 'Beschädigter Bestand wird nicht als leere Liste behandelt');
    }
    const source = createMusterHaushaltRecords('2026-10-16');
    source[PLANNED_EXPENSES_KEY] = raw;
    assert(validatePersistenceDomainRecords(source).ok, 'Vollsicherung akzeptiert die gültige Haushaltsliste');
    assert(!validatePersistenceDomainRecords({ ...source, [PLANNED_EXPENSES_KEY]: record([{ ...once, betrag: -1 }]) }).ok, 'Vollsicherung weist ungültige Ausgaben vor dem Schreiben zurück');
    const backend = await boot(source);
    same(readPlannedExpenses(), [fixed, once], 'Ausgewählter Haushalt liest seine Liste');
    const bytes = storage.getItem(PLANNED_EXPENSES_KEY);
    storage.setItem('rs_current_profile', 'muster_b'); storage.setItem('rs_active_profile', 'muster_b');
    same(readPlannedExpenses(), [fixed, once], 'Andere Person desselben Haushalts liest dieselben Ausgaben');
    assertEqual(storage.getItem(PLANNED_EXPENSES_KEY), bytes, 'Profilwechsel erhält Haushaltsrohbytes');
    await savePlannedExpenses({ scope: outside, items: [{ ...once, id: 'aussen', betrag: 5000 }] });
    same(readPlannedExpenses({ scope }), [fixed, once], 'Außenbereich überschreibt den Haushalt nicht');
    assertEqual(readPlannedExpenses({ scope: outside })[0].betrag, 5000, 'Einzelplan bleibt unabhängig');
    assertEqual(readPlannedExpenses({ scope: outside })[0].priceYear, 2026, 'Neue Beträge speichern das Eingabejahr als Preisbasis');
    setAppTestDate('2027-10-21');
    await savePlannedExpenses({ scope: outside, items: [{ ...once, id: 'aussen', betrag: 5000, bezeichnung: 'Umbenannt' }] });
    assertEqual(readPlannedExpenses({ scope: outside })[0].priceYear, 2026, 'Umbenennen erhält die gespeicherte Preisbasis');
    await savePlannedExpenses({ scope: outside, items: [{ ...once, id: 'aussen', betrag: 6000 }] });
    assertEqual(readPlannedExpenses({ scope: outside })[0].priceYear, 2027, 'Betragsänderung setzt die Preisbasis auf das neue Eingabejahr');
    setAppTestDate('2026-10-21');
    await P.flush();
    assertEqual(backend.get(PLANNED_EXPENSES_KEY), storage.getItem(PLANNED_EXPENSES_KEY), 'Write wird im Backend bestätigt');
    const backup = JSON.parse(JSON.stringify(buildFullPersistenceBackup()));
    await boot({});
    setAppTestDate(null);
    const restored = await importFullPersistenceBackup(backup);
    assert(restored.ok, 'Vollsicherung mit geplanten Ausgaben wird importiert: ' + (restored.message || ''));
    assertEqual(storage.getItem(PLANNED_EXPENSES_KEY), backup.records[PLANNED_EXPENSES_KEY], 'Import erhält alle Bereiche und Einträge bytegleich');
    const changed = { ...source, [PLANNED_EXPENSES_KEY]: record([{ ...fixed, betragMonat: 500 }, once]) };
    const context = { registry: JSON.parse(source.rs_profiles_v1), activeId: source.rs_current_profile, scope };
    assert(sourceFingerprint({ ...context, liveData: source, kind: 'montecarlo' }) !== sourceFingerprint({ ...context, liveData: changed, kind: 'montecarlo' }), 'Geänderte Ausgaben machen die gespeicherte Simulation auf der Übersicht veraltet');
    assert(sourceFingerprint({ ...context, liveData: source, kind: 'balance' }) !== sourceFingerprint({ ...context, liveData: changed, kind: 'balance' }), 'Balance-Vorschau wird nach Änderung geplanter Ausgaben veraltet');
    const comparison = summarizeProbelaufChanges(source, changed);
    assert(comparison.groups.some(group => group.rows.some(row => row.label.includes('Geplante Ausgaben') && row.after.includes('500'))), 'Spielbereich zeigt geänderte Ausgaben verständlich an');
    assertEqual(buildProbelaufTransferRecords(source, changed)[PLANNED_EXPENSES_KEY], changed[PLANNED_EXPENSES_KEY], 'Ausgaben werden als Fachbestand aus dem Spielbereich übernommen');
    const f = await playFixture('tauri', source);
    let controller = await f.boot(); const real = f.realBytes();
    await controller.start(() => ({ source: 'copy', testDate: null })); controller = await f.boot();
    same(readPlannedExpenses({ scope }), [fixed, once], 'Spielkopie enthält die Haushaltsausgaben');
    await savePlannedExpenses({ scope, items: [once] });
    assertEqual(f.realBytes(), real, 'Ausgaben im Spielbereich verändern keine Echtdaten');
    await controller.end(() => true);

    setAppTestDate('2026-10-21');
    const records = createMusterHaushaltRecords('2026-10-16'); records[PLANNED_EXPENSES_KEY] = record([{ ...fixed, ab: null, bis: null }, once]);
    const plan = JSON.parse(records[HOUSEHOLD_PLAN_KEY]); plan.entries[outside.key] = { scope: outside, updatedAt: new Date().toISOString(), values: structuredClone(PLAN_DEFAULTS) };
    records[HOUSEHOLD_PLAN_KEY] = JSON.stringify(plan);
    const registry = JSON.parse(records.rs_profiles_v1); registry.profiles.out = { meta: { name: 'Außen', belongsToHousehold: false }, data: {} }; records.rs_profiles_v1 = JSON.stringify(registry);
    await boot(records);
    const { doc } = createDialogFixture();
    const create = doc.createElement;
    doc.createElement = tag => { const node = create(tag); node.replaceChildren = (...children) => { [...node.children].forEach(child => child.remove()); node.append(...children); }; return node; };
    const host = doc.createElement('section'); host.id = 'managerPlannedExpenses'; doc.body.append(host);
    for (const id of ['managerFixedExpenseRows', 'managerOneTimeExpenseRows', 'managerFixedExpenseAdd', 'managerOneTimeExpenseAdd', 'managerExpenseStatus', 'managerExpenseRetry', 'managerExpenseFixed', 'managerExpenseFixedNext', 'managerExpenseOnce', 'managerExpenseNext']) {
        const node = doc.createElement(id.includes('Add') || id.includes('Retry') ? 'button' : 'div'); node.id = id;
        if (node.tag === 'button') node.dataset.expenseAction = 'add'; host.append(node);
    }
    let active = 'muster_a'; const timers = new Map(); let timerId = 0;
    const editor = createManagerPlannedExpenses({ doc, storage, getProfileId: () => active,
        runOperation: execute => execute({ check() {}, commit() {} }),
        schedule: fn => { const id = ++timerId; timers.set(id, fn); return id; }, unschedule: id => timers.delete(id) });
    const saved = storage.getItem(PLANNED_EXPENSES_KEY);
    editor.refresh(); assertEqual(storage.getItem(PLANNED_EXPENSES_KEY), saved, 'Rendern und Wiederlesen schreiben keine Ausgaben');
    for (const key of ['ab', 'bis']) {
        const open = doc.getElementById(`expense-0-${key}`);
        assertEqual(open.placeholder, '—', 'Gespeicherte offene Ausgabegrenze zeigt einen Strich');
        await open.fire('focus'); assertEqual(open.placeholder, 'MM.JJJJ', 'Bearbeitung zeigt das Monatsformat');
        await open.fire('blur'); assertEqual(open.placeholder, '—', 'Offene Ausgabegrenze zeigt nach Verlassen wieder den Strich');
        assertEqual(open.value, '', 'Die offene Ausgabegrenze bleibt leer');
    }
    same(readPlannedExpenses({ scope }).map(item => [item.ab ?? null, item.bis ?? null]), [[null, null], [null, null]], 'Offene Grenzen bleiben unverändert gespeichert');
    const field = doc.getElementById('expense-0-betragMonat'); field.value = '500,50'; await field.fire('input');
    assertEqual(await editor.flush(), true, 'Dezimale Monatsausgabe wird gespeichert');
    assertEqual(readPlannedExpenses({ scope })[0].betragMonat, 500.5, 'Deutsches Zahlenformat erreicht den Datenvertrag');
    await doc.getElementById('expense-0-anpassung').children[1].fire('click'); await editor.flush();
    assertEqual(readPlannedExpenses({ scope })[0].anpassung, 'inflation', 'Segment Inflation bestätigt die Ausgabenanpassung');
    field.value = '-3'; await field.fire('input');
    assertEqual(await editor.flush(), false, 'Ungültiger Entwurf bleibt ungespeichert');
    assertEqual(readPlannedExpenses({ scope })[0].betragMonat, 500.5, 'Ungültige Eingabe erhält den bestätigten Datenbestand');
    field.value = '600'; await field.fire('input'); const oldTimer = [...timers.values()].at(-1);
    await editor.flush(); editor.discard(); active = 'out'; editor.refresh();
    await doc.getElementById('managerOneTimeExpenseAdd').fire('click');
    const month = doc.getElementById('expense-0-monat'); month.value = '10.2026'; await month.fire('input');
    const amount = doc.getElementById('expense-0-betrag'); amount.value = '800'; await amount.fire('input');
    oldTimer(); await Promise.resolve(); assert(editor.read().dirty, 'Alter Timer schreibt nach Profilwechsel keinen neuen Entwurf');
    await editor.flush(); assertEqual(readPlannedExpenses({ scope: outside })[0].betrag, 800, 'Editor schreibt nur den aktuellen Planbereich');
    assertEqual(readPlannedExpenses({ scope })[0].betragMonat, 600, 'Editor erhält den vorherigen Haushalt');
    editor.dispose();

    const person = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-01-01', profile_geschlecht: 'w', profile_rentenbeginn: '2028-07-01', profile_rente_monatlich: '1000',
        profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '0', profile_tagesgeld: '200000', sim_simStartVermoegen: '200000',
        [INCOME_KEY]: writeIncome([{ id: 'gehalt', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: 4000, ab: null, bis: '2028-06', anpassung: 'lohn' }, { id: 'einmalig', monat: '2027-08', betrag: 5000, bezeichnung: 'Rückzahlung' }]) };
    const entries = [{ profileId: 'max', name: 'Max', data: person, inputs: buildSimulatorInputsFromProfileData(person, { referenceYear: 2026, planValues: null }) }];
    const input = { ...combineSimulatorProfiles(entries, 'max', { planValues: null }).combined, startFloorBedarf: 22000, startFlexBedarf: 8000,
        plannedExpenses: [fixed, once], plannedExpensesReferenceYear: 2026 };
    const view = buildPlanOverview({ inputs: input, entries, referenceYear: 2026, inflationPct: 2, wagePct: 3 });
    assertEqual(view.rows.length, 4, 'Planübersicht endet im Jahr nach dem letzten Eintrag');
    assertEqual(view.groups.find(group => group.pension).label, 'Max · Rente', 'Übersicht trennt Person und Einkunftsart');
    const first = view.rows[0], salary = view.groups.findIndex(group => !group.pension), pension = view.groups.findIndex(group => group.pension);
    assertEqual(first.incomes[salary], 48000, 'Planübersicht zählt feste Einkünfte im ersten Jahr ohne Anpassung');
    assertEqual(first.result, 48000 - 30000 - 1350, 'Planübersicht zeigt das Ansparjahr nach Bedarf und großen Ausgaben');
    assertEqual(view.rows[1].oneTime, 5000, 'Einmalige Einkünfte bleiben nominal und erscheinen im richtigen Jahr');
    assertClose(view.rows[2].incomes[salary], 24000 * 1.03 ** 2, 1e-6, 'Übersicht zeigt Monatsanteil und Lohnfortschreibung');
    assertEqual(view.rows[2].incomes[pension], 6000, 'Rente beginnt im Juli mit einem halben Jahr');
    assertClose(view.rows[2].expenses, 35000 * 1.02 ** 2, 1e-6, 'Übersicht zeigt einmalige Ausgaben in nominalen Preisen');
    assert(view.rows[3].result < 0, 'Nach dem Gehalt zeigt die Übersicht ein Entnahmejahr');
    const long = buildPlanOverview({ inputs: { ...input, plannedExpenses: [{ ...once, monat: '2051-01' }] }, entries, referenceYear: 2026 });
    assertEqual(long.rows.length, 15, 'Planübersicht bleibt auf 15 Jahreszeilen begrenzt');

    await measurementInputs();
    await savePlannedExpenses({ scope, items: [fixed, once] });
    same(getCommonInputs().plannedExpenses, [fixed, once].map(item => ({ ...item, priceYear: 2026, priceFactor: 1 })), 'Realer Simulator-Seitenweg übernimmt die Haushaltsliste genau einmal');
    assertEqual(getCommonInputs().plannedExpensesReferenceYear, 2026, 'Seitenweg bindet Ausgaben ans Planjahr');
    const simDoc = globalThis.document;
    const tableHost = simDoc.createElement('div'); tableHost.id = 'simPlanOverviewTable'; simDoc.body.appendChild(tableHost);
    const replace = tableHost.replaceChildren.bind(tableHost);
    tableHost.replaceChildren = (...nodes) => { replace(); nodes.forEach(node => tableHost.appendChild(node)); };
    const rates = simDoc.createElement('p'); rates.id = 'simPlanOverviewRates'; simDoc.body.appendChild(rates);
    const beforeRender = storage.getItem(PLANNED_EXPENSES_KEY);
    renderPlanOverview();
    const table = tableHost.children[0];
    assertEqual(table?.tagName, 'TABLE', 'Produktiver Übersichtsrenderer erzeugt die Jahrestabelle');
    assert(table.children[0].children[0].children.some(cell => cell.textContent === 'Geplante Ausgaben'), 'Gerenderte Tabelle enthält die Ausgabenspalte');
    assert(table.children[1].children[0].children.at(-1).children[0].textContent.startsWith('aus Vermögen −'), 'Gerenderter Plansaldo zeigt das Vorzeichen und den Text aus Vermögen');
    assert(rates.textContent.includes('Inflation'), 'Übersicht nennt die verwendeten Fortschreibungsraten');
    assertEqual(storage.getItem(PLANNED_EXPENSES_KEY), beforeRender, 'Reine Tabellenprojektion schreibt keine Fachwerte');
    const html = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    assert(html.indexOf('id="managerPlannedExpenses"') > html.indexOf('id="managerPlan_floorBedarf"') && html.indexOf('id="managerPlannedExpenses"') < html.indexOf('id="managerPlanMore"'), 'Ausgabenkarte steht direkt unter Bedarf pro Jahr');
} finally { setAppTestDate(null); P.resetPersistenceRuntimeForTests(); }
