import fs from 'node:fs';
import { dynamicFlexPresetPatch, detectDynamicFlexPreset } from '../app/shared/dynamic-flex-presets.js';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { HOUSEHOLD_PLAN_FIELDS } from '../app/shared/household-plan-fields.js';
import { ANNUAL_PLAN_RECORD_KEY, annualPlanEntryKey } from '../app/profile/annual-plan-record.js';
import { createManagerHouseholdPlan, managerPlanPatch, managerPlanFieldValue } from '../app/tranches/tranchen-manager-household-plan.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { completedComparisonFixture } from './household-plan-comparison.test.mjs?fixture';
import { projectOverview } from '../app/overview/overview-model.js';
import { householdPlanComparisonHtml } from '../app/profile/household-plan-comparison.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';


const html = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
const paths = [...html.matchAll(/data-manager-plan-field="([^"]+)"/g)].map(match => match[1]);
assertEqual(new Set(paths).size, 25, 'Alle 25 editierbaren Planfelder haben eindeutige Pfade');
const elements = tokenizeHTML(html).elements;
const node = id => elements.find(element => element.attrs.id === id);
const planHost = node('managerHouseholdPlan'), planPanel = node('managerPlanPanel');
assert(elements.indexOf(node('managerSectionNav')) < elements.indexOf(node('managerHousehold'))
    && elements.indexOf(node('managerHousehold')) < elements.indexOf(planHost), 'Gemeinsame Ansichtsreiter stehen vor Haushaltsvermögen und Plananfang');
assert(planHost.parent === planPanel && node('managerPlanComparisonCard').parent === planPanel,
    'Planformular und Planvergleich liegen gemeinsam im Planpanel außerhalb der ersetzbaren Renderhosts');
assert(planPanel.attrs.role === 'tabpanel' && Object.hasOwn(planPanel.attrs, 'hidden'), 'Planpanel ist vor Auswahl verborgen und besitzt seine eigene Panelrolle');
const household = planScope('household', ['z', 'a']), outside = planScope('single', ['out']);
const values = structuredClone(PLAN_DEFAULTS);
values.decumulation.bondRefillThreshold = null;
for (const changes of [{ minimumFlexAnnual: 25000 }, { liquidityRunwayYears: 1.1 }, { floorBedarf: NaN },
    { 'decumulation.mode': 'future' }, { horizonMethod: 'future' }, { longevityMode: 'future' }]) {
    let failed = false; try { managerPlanPatch(values, changes); } catch { failed = true; }
    assert(failed, 'Formulargrenze weist ungültige Kombination ab: ' + Object.keys(changes));
}
assertEqual(managerPlanPatch(values, { floorBedarf: 0, dynamicFlex: false, 'decumulation.bondRefillThreshold': null }).floorBedarf, 0, 'Null, false und 0 werden nicht durch Defaults ersetzt');

function dom() {
    const { doc } = createDialogFixture();
    const host = doc.createElement('section'); host.id = 'managerHouseholdPlan'; doc.body.append(host);
    for (const id of ['managerPlanScope', 'managerPlanStatus', 'managerPlanRetry', 'managerPlanResume', 'managerPlanComparison', 'managerPlanCape', 'managerPlanCapeOrigin', 'managerPlanInflation']) {
        const node = doc.createElement('div'); node.id = id; doc.body.append(node);
    }
    const presets = doc.createElement('div'); presets.dataset.planDynamicPresetsHost = ''; host.append(presets);
    const details = doc.createElement('div'); details.dataset.planDynamicDetails = ''; host.append(details);
    doc.fields = paths.map(path => {
        const spec = HOUSEHOLD_PLAN_FIELDS.find(spec => spec.path === path);
        const row = doc.createElement('div'); row.className = 'pv-plan-field household-plan-field';
        const field = doc.createElement(spec.options ? 'select' : 'input'); field.id = 'managerPlan_' + path.replaceAll('.', '_'); field.dataset.managerPlanField = path;
        field.type = spec.checkbox ? 'checkbox' : 'text'; row.append(field);
        (spec.group === 4 && path !== 'dynamicFlex' ? details : host).append(row); return field;
    });
    return doc;
}
const waitUntil = async check => { for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); } throw new Error('Testbedingung nicht erreicht'); };
async function setup({ missing = false, corrupt = false, date = '2026-10-09', planValues = values } = {}) {
    const backend = new Map(), writes = [];
    let failWrite = false, failRollback = false, badRead = false, hold = null, lastWasPlan = false;
    const adapter = { name: 'synthetic-plan-backend', async open() {}, async loadAll() {
        const result = Object.fromEntries(backend);
        if (badRead && lastWasPlan) { badRead = false; result[HOUSEHOLD_PLAN_KEY] = 'wrong'; }
        return result;
    }, async saveBatch(batch) {
        const planWrite = batch.upserts.find(([key]) => key === HOUSEHOLD_PLAN_KEY);
        if (planWrite) {
            writes.push(planWrite[1]); lastWasPlan = true;
            if (hold) { const callback = hold; hold = null; await callback(); }
            if (failWrite || failRollback) { failWrite = false; throw new Error('Synthetischer Schreibfehler'); }
        }
        for (const key of batch.deletes) backend.delete(key);
        for (const [key, value] of batch.upserts) backend.set(key, String(value));
    } };
    P.resetPersistenceForTests(adapter); await P.init();
    const registry = { version: 1, profiles: { z: { meta: { name: 'Z', belongsToHousehold: true }, data: {} }, a: { meta: { name: 'A', belongsToHousehold: true }, data: {} }, out: { meta: { name: 'Außen', belongsToHousehold: false }, data: {} } } };
    storage.setItem('rs_profiles_v1', JSON.stringify(registry)); storage.setItem('rs_current_profile', 'z'); storage.setItem('rs_active_profile', 'z');
    const raw = buildPlanRecord(null, [{ scope: household, values: planValues }, { scope: outside, values: { ...values, floorBedarf: 9000 } }], { now: () => new Date('2026-01-01') }).raw;
    if (!missing) storage.setItem(HOUSEHOLD_PLAN_KEY, corrupt ? '{broken' : raw);
    await P.flush(); writes.length = 0;
    const doc = dom(), guard = createNavigationGuard({ decide: async () => true });
    const lifecycle = createNavigationOperationLifecycle({ guard });
    let active = 'z', timerId = 0; const timers = new Map();
    const controller = createManagerHouseholdPlan({ doc, storage, persistence: P, getProfileId: () => active,
        runOperation: execute => lifecycle.run({}, execute), now: () => new Date(date),
        schedule: fn => { const id = ++timerId; timers.set(id, () => { timers.delete(id); fn(); }); return id; }, unschedule: id => timers.delete(id) });
    guard.register('manager-plan-draft', { read: () => controller.read() });
    const input = async (path, value) => {
        const field = doc.fields.find(field => field.dataset.managerPlanField === path);
        if (field.type === 'checkbox') field.checked = value; else field.value = value;
        await field.fire('input');
    };
    return { doc, controller, guard, backend, writes, input, timers, raw,
        switchTo: id => { active = id; storage.setItem('rs_current_profile', id); storage.setItem('rs_active_profile', id); controller.discard(); controller.refresh(); },
        fail: mode => { failWrite = mode === 'write'; failRollback = mode === 'rollback'; badRead = mode === 'read'; },
        hold: fn => { hold = fn; } };
}
{
    const f = await setup();
    assertEqual(f.doc.getElementById('managerPlanScope').textContent, 'Haushalt: A + Z', 'Kanonische IDs zeigen echte Haushaltsnamen');
    assertEqual(f.writes.length, 0, 'Reines Lesen und Rendern schreibt keinen Plan');
    await f.input('floorBedarf', '13000'); await f.input('floorBedarf', '14000');
    assertEqual(f.timers.size, 1, 'Entprellung hält genau einen Timer');
    assertEqual(f.writes.length, 0, 'Vor Timerablauf kein Write');
    [...f.timers.values()][0](); await waitUntil(() => !f.controller.read().writing);
    assertEqual(f.writes.length, 1, 'Ein Batch wird genau einmal serialisiert');
    assertEqual(readBalanceHouseholdPlan({ storage, profileId: 'a' }).entry.values.floorBedarf, 14000, 'Beide Mitglieder lesen denselben Plan, keine Doppelsumme');
    assertEqual(f.doc.getElementById('managerPlanStatus').textContent, 'Gespeichert', 'Bestätigter Backendwrite zeigt Erfolg');
    let release; f.hold(() => new Promise(resolve => { release = resolve; }));
    const activeInput = f.doc.getElementById('managerPlan_floorBedarf'); activeInput.focus(); await activeInput.fire('focus');
    await f.input('floorBedarf', '15000'); const write = f.controller.flush(); await waitUntil(() => release);
    assert(!f.doc.getElementById('managerPlanStatus').textContent.includes('Gespeichert'), 'Kein Erfolg vor Backendbestätigung');
    assertEqual(await f.guard.prepare(), null, 'Guard verbietet Wechsel während Commit');
    await f.input('floorBedarf', '16000');
    assertEqual(f.doc.fields.find(field => field.dataset.managerPlanField === 'floorBedarf').value, '16000', 'Jüngere Eingabe bleibt während Write sichtbar');
    release(); assertEqual(await write, true, 'Serialisierte Warteschlange wird abgeschlossen');
    assertEqual(f.writes.length, 3, 'Jüngere Eingabe erhält genau einen weiteren Write');
    assertEqual(activeInput.value, '16000', 'Aktive Eingabe bleibt nach verzögertem Autosave ungegliedert erhalten');
    await activeInput.fire('blur'); f.doc.activeElement = null; await activeInput.fire('change');
    assertEqual(f.writes.length, 3, 'Blur nach verzögertem Autosave erzeugt keinen weiteren Write');
    assertEqual(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values.floorBedarf, 16000, 'Backend bestätigt jüngste Eingabe');
    await f.input('floorBedarf', '17000'); const oldTimer = [...f.timers.values()].at(-1);
    assertEqual(await f.controller.flush(), true, 'Vor Profilwechsel wird der Pendingwrite abgeschlossen');
    f.switchTo('out');
    assertEqual(f.doc.getElementById('managerPlanScope').textContent, 'Außen (allein gerechnet)', 'Außenperson zeigt ihren Einzelbereich');
    await f.input('floorBedarf', '9500'); const newTimer = [...f.timers.values()].at(-1);
    assert(f.controller.read().dirty, 'Neuer Außenpersonenentwurf steht vor altem Timer aus');
    assertEqual(f.timers.size, 1, 'Neuer Bereich wartet auf seinen eigenen Timer');
    oldTimer(); await waitUntil(() => !f.controller.read().writing);
    assertEqual(f.writes.length, 4, 'Alter Timer schreibt trotz neuem Entwurf nach Profilwechsel nichts');
    assert(f.controller.read().dirty, 'Alter Timer lässt den neuen Entwurf ungeschrieben');
    assertEqual(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[outside.key].values.floorBedarf, 9000, 'Backend behält Außenpersonenstand bis zum eigenen Timer');
    newTimer(); await waitUntil(() => !f.controller.read().writing);
    assertEqual(f.writes.length, 5, 'Eigener neuer Timer bestätigt genau einen Außenpersonenwrite');
    assertEqual(f.controller.read().dirty, false, 'Eigener neuer Timer schließt den Entwurf ab');
    const persisted = JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY));
    assertEqual(persisted.entries[outside.key].values.floorBedarf, 9500, 'Außenperson schreibt nur Einzelplan');
    assertEqual(persisted.entries[household.key].values.floorBedarf, 17000, 'Haushalt bleibt erhalten');
    assertEqual(persisted.entries[outside.key].values.decumulation.bondRefillThreshold, null, 'Unsichtbarer nullable Strategiewert bleibt erhalten');
    assertEqual(persisted.entries[outside.key].values.cape.value, 0, 'Lesendes CAPE bleibt unverändert');
    f.controller.dispose();
}
for (const mode of ['write', 'read', 'rollback']) {
    const f = await setup(); f.fail(mode); await f.input('floorBedarf', '13000');
    assertEqual(await f.controller.flush(), false, mode + ': Kein Erfolgsabschluss');
    assert(f.controller.read().dirty, mode + ': Wiederholungsauftrag bleibt geschützt');
    assertEqual(f.doc.fields.find(field => field.dataset.managerPlanField === 'floorBedarf').value, '12.000 €', mode + ': Formular zeigt bestätigten Stand');
    if (mode === 'rollback') {
        assert(P.hasSyncWriteBlocks(), 'Fehlgeschlagene Rücknahme blockiert weitere Writes');
        const count = f.writes.length; await f.doc.getElementById('managerPlanRetry').fire('click'); await waitUntil(() => !f.controller.read().writing);
        assertEqual(f.writes.length, count, 'Blockierter Retry schreibt nicht');
    } else assertEqual(f.backend.get(HOUSEHOLD_PLAN_KEY), f.raw, mode + ': Rücknahme bestätigt Rohbytes');
    f.controller.dispose();
}
for (const options of [{ missing: true }, { corrupt: true }]) {
    const f = await setup(options);
    assert(f.doc.fields.every(field => field.disabled), 'Unbestätigter/beschädigter Plan ist gesperrt');
    await f.input('floorBedarf', '13000'); assertEqual(f.writes.length, 0, 'Gesperrtes Formular erzeugt keinen Defaultplan');
    storage.setItem(HOUSEHOLD_PLAN_KEY, f.raw); await P.flush(); f.controller.refresh();
    assertEqual(f.doc.fields.find(field => field.dataset.managerPlanField === 'floorBedarf').value, '12.000 €', 'Spätere Bestätigung projiziert echte Werte');
    f.controller.dispose();
}

// Externer Kontextwechsel während Backendwrite wird im Postvalidate zurückgenommen.
{
    const f = await setup(); let release;
    f.hold(() => new Promise(resolve => { release = resolve; }));
    await f.input('floorBedarf', '13000'); const pending = f.controller.flush();
    await waitUntil(() => release);
    storage.setItem('rs_profiles_v1', JSON.stringify({ version: 1, profiles: { z: { meta: { name: 'Z', belongsToHousehold: true }, data: {} } } }));
    release();
    assertEqual(await pending, false, 'Scopewechsel während Write verhindert Erfolgsabschluss');
    assertEqual(f.backend.get(HOUSEHOLD_PLAN_KEY), f.raw, 'Postvalidate nimmt alten Scopewrite bytegleich zurück');
    f.controller.dispose();
}

// Derselbe Adapter im echten Manager: Vollersatz und präziser schreibfreier Fokus.
{
    const f = await setup({ planValues: { ...values, floorBedarf: 30600.254987 } });
    const field = f.doc.getElementById('managerPlan_floorBedarf');
    field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
    field.selectionStart = field.selectionEnd = 0; field.focus();
    const focusing = field.fire('focus');
    assertEqual(field.selectionStart, 0, 'Manager markiert synchron ab Anfang');
    assertEqual(field.selectionEnd, field.value.length, 'Manager markiert synchron bis Ende');
    await focusing; await field.fire('blur'); f.doc.activeElement = null;
    await field.fire('change'); await f.controller.flush();
    assertEqual(f.writes.length, 0, 'Präziser Managerfokus erzeugt keinen Write');
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), f.raw, 'Präziser Managerfokus erhält Planbytes');
    assertEqual(readBalanceHouseholdPlan({ storage }).entry.values.floorBedarf, 30600.254987, 'Manager erhält kanonische Präzision');
    field.selectionStart = field.selectionEnd = 0; field.focus(); await field.fire('focus');
    field.value = field.value.slice(0, field.selectionStart) + '20000' + field.value.slice(field.selectionEnd);
    await field.fire('input'); await field.fire('blur'); f.doc.activeElement = null;
    await f.controller.flush();
    assertEqual(readBalanceHouseholdPlan({ storage }).entry.values.floorBedarf, 20000, 'Manager ersetzt den gesamten Floor exakt durch 20000');
    f.controller.dispose();
}

// Reine Darstellung und tatsächliche Segmentwechsel im Manager.
{
    const f = await setup(), field = f.doc.getElementById('managerPlan_floorBedarf');
    const bytes = storage.getItem(HOUSEHOLD_PLAN_KEY), revisionBeforeFocus = f.controller.read().revision;
    field.focus(); await field.fire('focus');
    assertEqual(field.value, '12000', 'Fokus zeigt ungegliederte Zahl ohne Einheit');
    await field.fire('blur'); f.doc.activeElement = null;
    await field.fire('change');
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), bytes, 'Fokus/Blur/Change ohne Wertänderung erhält Planbytes');
    assertEqual(f.writes.length, 0, 'Reine Darstellung schreibt nicht');
    assertEqual(f.controller.read().revision, revisionBeforeFocus, 'Fokus/Blur ohne Dirtybatch erzeugt keine Revision');
    assertEqual(f.timers.size, 0, 'Fokus/Blur ohne Dirtybatch plant keinen Timer');
    const strategy = f.doc.querySelectorAll('[data-plan-segment]').find(node => node.dataset.planSegment === 'decumulation.mode');
    await strategy.querySelectorAll('button')[1].fire('click'); await f.controller.flush();
    assertEqual(f.writes.length, 1, 'Strategie-Segmentwechsel erzeugt genau einen Write');
    assert(!f.doc.getElementById('managerPlan_decumulation_drawdownTrigger').closest('.pv-plan-field').hidden, '3-Töpfe macht Strategieoptionen sichtbar');
    const distribution = f.doc.querySelectorAll('[data-plan-segment]').find(node => node.dataset.planSegment === 'householdWithdrawalMode');
    await distribution.querySelectorAll('button')[1].fire('click'); await f.controller.flush();
    await distribution.querySelectorAll('button')[0].fire('click'); await f.controller.flush();
    assertEqual(readBalanceHouseholdPlan({ storage, profileId: 'z' }).entry.values.householdWithdrawalMode, 'tax_optimized', 'Steueroptimiert bleibt erreichbar');
    assertEqual(f.writes.length, 3, 'Jeder tatsächliche Verteilungswechsel hat einen Write');
    await distribution.querySelectorAll('button')[0].fire('click');
    assertEqual(f.timers.size, 0, 'Aktives Segment erzeugt keinen Dirtyzustand');
    const locked = f.doc.getElementById('managerPlan_householdWithdrawalMode');
    f.controller.syncBlocked(true); assert(locked.disabled && distribution.querySelectorAll('button').every(button => button.disabled), 'Externe Sperre gilt auch für Segmentknöpfe');
    f.controller.syncBlocked(false);
    f.controller.dispose();
}
// Planjahr 2027: der tatsächliche Abschlusszeitraum kommt nur aus dem Beleg.
{
    const f = await setup({ date: '2027-01-02' });
    const outcome = { monthlyWithdrawal: 1000, monthlyBudget: 2000, liquidityBefore: 50000, liquidityAfter: 49000,
        flexRate: 100, marketPhase: 'normal', action: { type: 'NONE', title: 'Keine Umschichtung' },
        snapshot: { plan: structuredClone(values), inflation: 2, ageByPerson: { a: 70, z: 71 } } };
    const entry = { year: 2027, scope: household, periodId: 'calendar-year:2026', committedAt: '2027-01-02T00:00:00.000Z',
        adjusted: false, adjustedFields: [], recommended: outcome, adopted: outcome };
    const put = next => storage.setItem(ANNUAL_PLAN_RECORD_KEY, JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(next.year, next.scope)]: next } }));
    put(entry); f.controller.refresh();
    assertEqual(f.doc.getElementById('managerPlanInflation').textContent, 'zuletzt fortgeschrieben mit der Inflation 2026 (+2,0 %)', 'Abschluss 2026, Planjahr 2027: tatsächliches Inflationsjahr');
    put({ ...entry, periodId: 'calendar-year:2027' }); f.controller.refresh();
    assert(f.doc.getElementById('managerPlanInflation').textContent.includes('Inflation 2027 (+2,0 %)'), 'Gleichjähriger H1-Beleg folgt seiner eigenen Periodenkennung');
    const noEvidence = 'Inflationsfortschreibung noch nicht belegt';
    for (const next of [{ ...entry, periodId: 'calendar-year:2025' },
        { ...entry, scope: outside, adopted: { ...outcome, snapshot: { ...outcome.snapshot, ageByPerson: { out: 70 } } } },
        { ...entry, adopted: { ...outcome, snapshot: { ...outcome.snapshot, plan: { ...values, floorBedarf: 13000 } } } }]) {
        put(next); f.controller.refresh();
        assertEqual(f.doc.getElementById('managerPlanInflation').textContent, noEvidence, 'Ungültiger/fremder/abweichender Beleg liefert keinen geratenen Nachweis');
    }
    storage.removeItem(ANNUAL_PLAN_RECORD_KEY); f.controller.refresh();
    assertEqual(f.doc.getElementById('managerPlanInflation').textContent, noEvidence, 'Fehlender Beleg bleibt ehrlich unbelegt');
    f.controller.dispose();
}

// Eingabegrenze vor Timer, Flush und bestätigtem Backendwrite.
for (const path of HOUSEHOLD_PLAN_FIELDS.filter(spec => spec.unit === '€').map(spec => spec.path)) {
    for (const invalid of ['10000000,01', '3000033000', 'unlesbar', '-1']) {
        const f = await setup({ planValues: { ...values, flexBedarf: 10_000_000 } });
        const baseline = JSON.stringify(Object.fromEntries(f.backend));
        await f.input('minCashBufferMonths', '3'); const oldTimer = [...f.timers.values()][0];
        await f.input(path, invalid);
        const field = f.doc.getElementById('managerPlan_' + path);
        assertEqual(field.getAttribute('aria-invalid'), 'true', path + ': Feldfehler vor Autosave');
        assert(f.doc.getElementById(field.id + '_error').textContent.includes(HOUSEHOLD_PLAN_FIELDS.find(spec => spec.path === path).label), path + ': verständlicher Feldname');
        assertEqual(f.timers.size, 0, path + ': ungültige Eingabe entfernt Autosavetimer');
        oldTimer(); await waitUntil(() => !f.controller.read().writing);
        assertEqual(await f.controller.flush(), false, path + ': explizites Flush abgelehnt');
        assertEqual(f.writes.length, 0, path + ': ungültiger Betrag erzeugt keinen Write');
        assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), f.raw, path + ': Planrohstring bytegleich');
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), baseline, path + ': sämtliche Backendrecords bytegleich');
        await f.input(path, '10000000');
        assertEqual(field.getAttribute('aria-invalid'), 'false', path + ': exakte Grenze zulässig');
        [...f.timers.values()][0](); await waitUntil(() => !f.controller.read().writing);
        assertEqual(f.writes.length, 1, path + ': gültige Korrektur genau einmal per Autosave');
        assertEqual(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values[path], 10_000_000, path + ': Grenze im Backend bestätigt');
        f.controller.dispose();
    }
}
{
    const f = await setup(); let release;
    f.hold(() => new Promise(resolve => { release = resolve; }));
    await f.input('floorBedarf', '33000'); const pending = f.controller.flush(); await waitUntil(() => release);
    await f.input('floorBedarf', '3000033000'); release();
    assertEqual(await pending, false, 'Begonnener gültiger Write endet, ungültiger Folgeentwurf bleibt gesperrt');
    assertEqual(f.writes.length, 1, 'Ungültige Eingabe während Write erzeugt keinen Folgebatch');
    assertEqual(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values.floorBedarf, 33000, 'Backend bestätigt ausschließlich vorherigen gültigen Betrag');
    assertEqual(await f.controller.flush(), false, 'Erneutes Flush des ungültigen Folgeentwurfs bleibt gesperrt');
    await f.input('floorBedarf', '34000'); [...f.timers.values()][0](); await waitUntil(() => !f.controller.read().writing);
    assertEqual(f.writes.length, 2, 'Korrektur nach laufendem Write nutzt bisherigen Autosave');
    f.controller.dispose();
}
{
    const f = await setup({ planValues: { ...values, floorBedarf: 30_000_000 } });
    assert(f.doc.fields.every(field => !field.disabled), 'Gespeicherter Altbestand oberhalb der UI-Grenze bleibt lesbar');
    assertEqual(f.writes.length, 0, 'Altbestand wird nicht bereinigt');
    await f.input('minCashBufferMonths', '3'); await f.controller.flush();
    assertEqual(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values.floorBedarf, 30_000_000, 'Unbearbeiteter Altbetrag bleibt bei anderer Änderung erhalten');
    f.controller.dispose();
}

P.resetPersistenceForTests();

for (const options of [{}, { adjusted: true }, { receipt: false }, { preview: 'missing' }, { preview: 'invalid' }, { preview: 'stale' }]) {
    const f = completedComparisonFixture(options), records = new Map(Object.entries(f.records)), before = JSON.stringify([...records]);
    let writes = 0;
    const readOnly = { get length() { return records.size; }, key: index => [...records.keys()][index], getItem: key => records.get(key) ?? null,
        setItem: () => { writes++; throw new Error('Vergleich darf nicht schreiben'); } };
    const doc = dom(); let activeId = 'z';
    const controller = createManagerHouseholdPlan({ doc, storage: readOnly, getProfileId: () => activeId, now: () => f.now });
    const overview = projectOverview({ registry: f.registry, activeId, liveData: f.records, now: f.now });
    assertEqual(overview.occasion.annualState, 'done', 'Auch Managerprobe verwendet einen abgeschlossenen Jahreszustand');
    assertEqual(doc.getElementById('managerPlanComparison').innerHTML, householdPlanComparisonHtml(overview.planComparison), 'Echter Managercontroller und Startseitenmodell liefern denselben vollständigen Vergleich');
    const host = doc.getElementById('managerPlanComparison');
    if (!options.preview && options.receipt !== false) {
        assert(host.innerHTML.includes('+100') && host.innerHTML.includes('+5,0 Prozentpunkte'), 'Manager zeigt heutige Deltas nach Jahresabschluss');
        assert(host.innerHTML.includes('data-preview-status="current"'), 'Fingerprint und heutiges Rechendatum gelten auch im Manager als aktuell');
    }
    activeId = 'out'; controller.refresh();
    assert(host.innerHTML.includes('data-plan-record-status="missing"') && host.innerHTML.includes('data-preview-status="missing"'), 'Außenperson übernimmt weder Haushaltsbeleg noch Haushaltsvorschau');
    assertEqual(writes, 0, 'Lesender Vergleich startet keinen Write');
    assertEqual(JSON.stringify([...records]), before, 'Plan, Beleg und übrige Records bleiben bytegleich');
    controller.dispose();
}

for (const date of ['2026-10-15', '2026-01-01', '2027-01-02']) {
    const records = createMusterHaushaltRecords(date), before = JSON.stringify(records), doc = dom();
    const storage = { getItem: key => records[key] ?? null, key: i => Object.keys(records)[i], length: Object.keys(records).length };
    const controller = createManagerHouseholdPlan({ doc, storage, getProfileId: () => 'muster_a', now: () => new Date(`${date}T12:00:00`) });
    const year = date.slice(0, 4), comparison = doc.getElementById('managerPlanComparison').innerHTML;
    assert(comparison.includes(`Plan ${year} · festgeschrieben am 01.01.${year}`) && comparison.includes('Beispieldaten (Spielbereich)'), 'Personen & Vermögen zeigt den festen Musterplan samt Herkunft');
    assert(doc.getElementById('managerPlanInflation').textContent.includes(String(Number(year) - 1)), 'Personen & Vermögen liest das passende Abschlussjahr aus dem Musterbeleg');
    assertEqual(JSON.stringify(records), before, 'Mustervergleich im Manager bewahrt alle Records bytegleich');
    controller.dispose();
}

// Die Probe muss die Wurzel erreichen und jeden Knoten einschließlich der Wurzel prüfen.
function visibleThroughRoot(node, root) {
    for (; node; node = node.parentElement || node.parent) {
        if (node.hidden) return false;
        if (node === root) return true;
    }
    return false;
}

// Presets mit echtem Navigationsbesitz, bestätigtem Backend, Rücknahme und Retry.
function assertFocusedCorrection(doc, field, root, text, label) {
    assertEqual(field.value, text, label + ': exakter Korrekturtext');
    assert(doc.activeElement === field, label + ': unveränderter Dokumentfokus');
    assert(visibleThroughRoot(field, root), label + ': Faktor und gesamte Vorfahrenkette sichtbar');
}
function assertVisibilityProbe(field, root) {
    for (let node = field; node; node = node === root ? null : node.parentElement || node.parent) {
        node.hidden = true;
        assert(!visibleThroughRoot(field, root), 'Verborgener Knoten lässt Sichtbarkeitsprobe scheitern');
        node.hidden = false;
    }
    const parent = field.parent;
    field.parent = null;
    assert(!visibleThroughRoot(field, root), 'Abgetrennte Elternkette lässt Sichtbarkeitsprobe scheitern');
    field.parent = parent;
}

for (const matching of [false, true, 'active']) {
    const original = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen'),
        dynamicFlex: matching === 'active', goGoMultiplier: matching === 'active' ? 1.2 : matching ? 1.1 : 1.17 };
    const f = await setup({ planValues: original }), field = f.doc.getElementById('managerPlan_minimumFlexAnnual');
    const backendBefore = JSON.stringify(Object.fromEntries(f.backend));
    const localBytes = () => JSON.stringify(Object.fromEntries(Array.from({ length: storage.length }, (_, i) => {
        const key = storage.key(i); return [key, storage.getItem(key)];
    })));
    const localBefore = localBytes();
    const click = async key => {
        const button = f.doc.querySelector('[data-plan-dynamic-preset="' + key + '"]'), previous = f.doc.activeElement;
        if (previous?.tag === 'input') { await previous.fire('change'); await previous.fire('blur'); }
        button.focus(); await button.fire('focus'); await button.fire('click');
    };
    for (const [path, text, message] of [['minimumFlexAnnual', '999999', 'Mindest-Flex'], ['goGoMultiplier', 'unlesbar', 'lesbare Zahl']]) {
        const field = f.doc.getElementById('managerPlan_' + path), root = f.doc.getElementById('managerHouseholdPlan');
        if (path === 'goGoMultiplier') await click('custom');
        // Ein alter Timer darf nach der ungültigen Eingabe nicht mehr schreiben.
        await f.input('floorBedarf', '13500'); const oldTimer = [...f.timers.values()][0];
        field.focus(); await field.fire('focus'); await f.input(path, text);
        for (const key of ['off', 'konservativ', 'ausgewogen', 'offensiv', 'custom']) {
            await click(key); oldTimer();
            assertEqual(await f.controller.flush(), false, key + ': kein Commit trotz altem Timer und Flush');
            assertEqual(field.value, text, key + ': Fehlertext nach Fokusverlust unverändert');
            assertEqual(field.getAttribute('aria-invalid'), 'true', key + ': Fehlermarkierung bleibt');
            const error = f.doc.getElementById(field.id + '_error');
            assert(error.textContent.includes(message), key + ': passende Feldmeldung');
            for (const node of [field, field.parent, error]) assert(visibleThroughRoot(node, root), key + ': vollständige Fehler-Vorfahrenkette sichtbar');
            assert(!field.disabled, key + ': Fehlerfeld aktiviert'); field.focus(); await field.fire('focus');
            assert(f.doc.activeElement === field, key + ': Fehlerfeld direkt fokussierbar');
            if (path !== 'goGoMultiplier') assert(root.querySelector('[data-plan-dynamic-details]').hidden === (key !== 'custom'), key + ': externer Feldfehler öffnet keine Dynamikdetails');
            assert(f.doc.getElementById('managerPlan_dynamicFlex').parent.hidden, key + ': nativeOnly bleibt verborgen');
            assertEqual(f.writes.length, 0, key + ': keine Backendwrites');
            assertEqual(JSON.stringify(Object.fromEntries(f.backend)), backendBefore, key + ': vollständiger Backendbestand unverändert');
            assertEqual(localBytes(), localBefore, key + ': vollständiger Zwischenspeicher unverändert');
        }
        if (path === 'goGoMultiplier') {
            for (const node of [field.parent, root.querySelector('[data-plan-dynamic-details]'), root]) {
                node.hidden = true;
                assert(!visibleThroughRoot(field, root) && !visibleThroughRoot(field.parent.querySelector('.household-plan-error'), root), 'Verborgene Zeile, Details oder Wurzel lassen Sichtbarkeitsprobe scheitern');
                node.hidden = false;
            }
        }
        assert(f.controller.discard(), 'Rücknahme erhält ursprüngliche Detailwerte');
        assertEqual(field.getAttribute('aria-invalid'), 'false', 'Verwerfen entfernt Feldfehler');
        assertEqual(root.querySelector('[data-plan-dynamic-details]').hidden, detectDynamicFlexPreset(original) !== 'custom', 'Verwerfen entfernt zusätzliche Fehleröffnung');
        assertEqual(JSON.stringify(Object.fromEntries(f.backend)), backendBefore, 'Verwerfen erhält Backendbestand');
        assertEqual(localBytes(), localBefore, 'Verwerfen erhält Zwischenspeicher');
    }
    // Dieselbe Folge wie im Browser: Fehlertext korrigieren, Custom wählen, Writefehler, Retry.
    field.focus(); await field.fire('focus'); await f.input('minimumFlexAnnual', '999999'); await click('custom');
    await f.input('minimumFlexAnnual', String(original.minimumFlexAnnual)); await click('custom');
    const activated = { ...original, dynamicFlex: true };
    if (original.dynamicFlex === false) {
        f.fail('write');
        assertEqual(await f.controller.flush(), false, 'Synthetischer Backendfehler erhält Wiederholungsauftrag');
        assertEqual(f.backend.get(HOUSEHOLD_PLAN_KEY), f.raw, 'Fehler und Rücknahme erhalten bestätigte Planbytes');
        assert(!f.doc.getElementById('managerPlanRetry').hidden, 'Retry sichtbar');
        await f.doc.getElementById('managerPlanRetry').fire('click');
        assertEqual(await f.controller.flush(), true, 'Retry bestätigt vollständigen Einschaltbatch');
    } else assertEqual(await f.controller.flush(), true, 'Aktive reine Customöffnung bleibt schreibfrei');
    const committed = JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values;
    assertEqual(JSON.stringify(committed), JSON.stringify(activated), 'Bestätigter Batch erhält sämtliche Detailwerte');
    assertEqual(f.backend.get(ANNUAL_PLAN_RECORD_KEY), undefined, 'Manager erzeugt keinen Jahresbeleg');
    assertEqual(detectDynamicFlexPreset(committed), matching === true ? 'ausgewogen' : 'custom', 'Neulesen erkennt ausschließlich Fachwerte');
    assert(!f.doc.querySelector('[data-plan-dynamic-details]').hidden, 'Customabsicht überlebt echte Transaktionsrückmeldungen');
    const count = f.writes.length, revision = f.controller.read().revision;
    await click('custom'); f.controller.refresh();
    assertEqual(f.writes.length, count, 'Aktive Customöffnung und Refresh ohne zusätzliche Writes');
    assertEqual(f.controller.read().revision, revision, 'Aktive Customöffnung ohne Fachrevision');
    assertEqual(f.doc.querySelector('[data-plan-dynamic-preset="custom"]').getAttribute('aria-pressed'), 'true', 'Customabsicht nach Refresh markiert');
    f.switchTo('out');
    assertEqual(f.doc.querySelector('[data-plan-dynamic-preset="custom"]').getAttribute('aria-pressed'), String(detectDynamicFlexPreset(values) === 'custom'), 'Neuer Bereich übernimmt keine fremde Öffnungsabsicht');
    assertEqual(JSON.stringify(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values), JSON.stringify(activated), 'Scopewechsel verändert bestätigten Haushalt nicht');
    f.controller.dispose();
}

// Direkte Faktorkorrektur nach ausgeschaltetem Go-Go bestätigt erst den ganzen Batch.
for (const target of ['off', 'konservativ']) for (const confirmation of ['blur-autosave', 'focused-flush', 'outside', 'forward', 'body-only', 'backward', 'no-related']) {
    const original = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen'), dynamicFlex: false };
    const f = await setup({ planValues: original }), root = f.doc.getElementById('managerHouseholdPlan');
    const field = f.doc.getElementById('managerPlan_goGoMultiplier');
    const click = async key => {
        const previous = f.doc.activeElement;
        if (previous?.tag === 'input') { await previous.fire('change'); await previous.fire('blur'); }
        const button = root.querySelector('[data-plan-dynamic-preset="' + key + '"]');
        button.focus(); await button.fire('click');
    };
    await click('custom');
    const oldTimer = [...f.timers.values()].at(-1);
    field.focus(); await field.fire('focus'); await f.input('goGoMultiplier', 'unlesbar');
    await click(target);
    assert(visibleThroughRoot(field, root) && !field.disabled, target + ': ausgeschalteter Go-Go-Faktor direkt korrigierbar');
    assertEqual(f.doc.getElementById('managerPlan_goGoActive').checked, false, target + ': Go-Go bleibt aus');
    assert(field.getAttribute('aria-invalid') === 'true' && !root.querySelector('[data-plan-dynamic-details]').hidden, target + ': ungültiger Blur erhält Fehleröffnung');
    assertEqual(await f.controller.flush(), false, target + ': ungültiger Batch nicht bestätigt');
    assertEqual(f.writes.length, 0, target + ': keine isolierte Presetübernahme');
    assertVisibilityProbe(field, root);
    field.focus(); await field.fire('focus');
    for (const text of ['1', '1,', '1,1', '1,17']) {
        await f.input('goGoMultiplier', text);
        assertFocusedCorrection(f.doc, field, root, text, target + '/' + text);
        assertEqual(f.doc.getElementById('managerPlan_goGoActive').checked, false, text + ': Zwischenstand hält Go-Go aus');
        oldTimer();
        for (const timer of [...f.timers.values()]) timer();
        await waitUntil(() => !f.controller.read().writing);
        assertFocusedCorrection(f.doc, field, root, text, target + '/nach Timer/' + text);
        assertEqual(f.writes.length, 0, target + '/' + text + ': auch alter Timer bestätigt keinen Zwischenbatch');
        assertEqual(f.backend.get(HOUSEHOLD_PLAN_KEY), f.raw, 'Backend während Korrektur bytegleich');
        if (text === '1,') assert(f.controller.read().validation && field.getAttribute('aria-invalid') === 'true', 'Unvollständige Zahl sperrt Write');
    }
    assertEqual(f.writes.length, 0, target + ': Korrektur wartet auf Batchbestätigung');
    assertEqual(field.getAttribute('aria-invalid'), 'false', target + ': Korrektur entfernt Feldmarkierung');
    assert(f.doc.getElementById(field.id + '_error').hidden, target + ': Korrektur entfernt Feldmeldung');
    assertEqual(f.doc.getElementById('managerPlan_goGoActive').checked, false, target + ': Korrektur aktiviert Go-Go nicht');
    const expected = { ...original, ...dynamicFlexPresetPatch(target), goGoMultiplier: 1.17 };
    if (confirmation === 'focused-flush') {
        assertEqual(await f.controller.flush(), true, target + ': ausdrücklicher finaler Flush auch während Fokus möglich');
        assertFocusedCorrection(f.doc, field, root, '1,17', target + '/finaler Flush');
    }
    const revisionBeforeBlur = f.controller.read().revision;
    const internal = ['forward', 'body-only', 'backward', 'no-related'].includes(confirmation);
    const outside = confirmation === 'outside' ? f.doc.createElement('button') : root.querySelector('[data-plan-dynamic-preset="' + target + '"]');
    if (confirmation === 'outside') f.doc.body.append(outside);
    const destination = internal ? f.doc.getElementById('managerPlan_' + (confirmation === 'backward' ? 'goGoActive' : 'longevityMode')) : outside;
    if (internal) assert(root.querySelector('[data-plan-dynamic-details]').contains(destination), 'Tabziel liegt ausdrücklich innerhalb der Dynamikdetails');
    if (internal) f.doc.activeElement = f.doc.body;
    else destination.focus();
    assert(!internal || f.doc.activeElement === f.doc.body, 'Nativer Blur beginnt ausdrücklich mit body als activeElement');
    const blurring = field.fire('blur', { relatedTarget: confirmation === 'no-related' ? null : destination });
    if (internal && confirmation !== 'body-only') destination.focus();
    await blurring; await new Promise(resolve => setTimeout(resolve, 0));
    const active = f.doc.activeElement;
    assert(active !== f.doc.body && !active.disabled && visibleThroughRoot(active, confirmation === 'outside' ? f.doc.body : root), target + '/' + confirmation + ': Endfokus sichtbar und aktiviert am vorgesehenen Ziel');
    if (!internal) assert(active === outside, 'Sichtbarer Fokus außerhalb der Details bleibt erhalten');
    else if (target === 'off') assert(active === outside, 'Schließen rettet Fokus auf ausgewählten aktivierten Presetknopf');
    else if (confirmation === 'body-only') assert(active === root.querySelector('[data-plan-dynamic-preset="custom"]'), 'Verborgene Faktorzeile rettet Body-Endfokus auf sichtbaren Customknopf');
    assert(field.parent.hidden, target + ': Faktorzeile nach Blur wieder verborgen');
    assertEqual(root.querySelector('[data-plan-dynamic-details]').hidden, detectDynamicFlexPreset(expected) !== 'custom', target + ': reguläre Detailerkennung nach Blur');
    assertEqual(f.controller.read().revision, revisionBeforeBlur, 'Blur erzeugt keine Fachrevision');
    assertEqual(f.timers.size, confirmation !== 'focused-flush' ? 1 : 0, 'Blur entprellt ausschließlich vorhandenen Dirtybatch');
    for (const timer of [...f.timers.values()]) timer();
    await waitUntil(() => !f.controller.read().writing);
    assertEqual(await f.controller.flush(), true, target + ': vollständiger korrigierter Batch bestätigt');
    assertEqual(f.writes.length, 1, target + ': genau ein Fachwrite');
    assertEqual(JSON.stringify(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values), JSON.stringify(expected), target + ': Backend bestätigt alle Presetwerte samt Faktor');
    assertEqual(JSON.stringify(readBalanceHouseholdPlan({ storage, profileId: 'a' }).entry.values), JSON.stringify(expected), 'Planreader stimmt mit bestätigtem Backend überein');
    assert(f.writes.every(raw => JSON.stringify(JSON.parse(raw).entries[household.key].values) === JSON.stringify(expected)), 'Writerohstrings enthalten vollständigen Endplan mit Faktor 1.17 und keinen Zwischenwert 1');
    await click('custom');
    assertEqual(managerPlanFieldValue(field, 'goGoMultiplier'), 1.17, target + ': erneute Customöffnung erhält korrigierten Faktor');
    assertEqual(f.doc.getElementById('managerPlan_goGoActive').checked, false, target + ': Customöffnung aktiviert Go-Go nicht');
    assertEqual(await f.controller.flush(), true, target + ': Custombatch bestätigt');
    assertEqual(JSON.stringify(JSON.parse(f.backend.get(HOUSEHOLD_PLAN_KEY)).entries[household.key].values), JSON.stringify({ ...expected, dynamicFlex: true }), target + ': Custom ändert nur Aktivierung');
    f.controller.dispose();
}

// Gültige sichtbare Customdetails dürfen einen natürlichen Body-Endfokus nicht übernehmen.
for (const containerBox of [true, false]) {
    const f = await setup({ planValues: { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen'),
        longevityMode: 'buffer_years', longevityBufferYears: 3 } });
    const root = f.doc.getElementById('managerHouseholdPlan'), field = f.doc.getElementById('managerPlan_longevityBufferYears');
    const details = root.querySelector('[data-plan-dynamic-details]');
    // Ein Container muss keine eigene Layoutbox liefern; seine sichtbaren
    // Eingaben bleiben dennoch die maßgeblichen Fokusziele.
    details.getClientRects = () => containerBox ? [{}] : [];
    field.getClientRects = () => [{}];
    assert(!f.controller.read().validation && detectDynamicFlexPreset(f.controller.read().values) === 'custom', 'Gültiger individueller Managerplan ohne Fehleröffnung');
    for (const node of [field, field.parent, details]) assert(!node.disabled && visibleThroughRoot(node, root), 'Customfeld und gesamte Vorfahrenkette vor Fokus sichtbar');
    let focusCalls = 0;
    const restore = root.querySelectorAll('[data-plan-dynamic-preset]').map(button => {
        const focus = button.focus; button.focus = function(...args) { focusCalls++; return focus.apply(this, args); };
        return () => { button.focus = focus; };
    });
    const revision = f.controller.read().revision, before = JSON.stringify([...f.backend]), cached = storage.getItem(HOUSEHOLD_PLAN_KEY);
    focusCalls = 0; field.focus(); await field.fire('focus');
    f.doc.activeElement = f.doc.body; await field.fire('blur');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(f.doc.activeElement === f.doc.body, 'Sichtbares Managercustomfeld lässt Body-Endfokus unverändert');
    assertEqual(focusCalls, 0, 'Kein Managerpreset erhält programmatischen Fokus');
    for (const node of [field, field.parent, details]) assert(visibleThroughRoot(node, root), 'Managercustomdetails bleiben nach Blur sichtbar');
    assertEqual(f.controller.read().revision, revision, 'Reine Managerfokusfolge ohne Fachrevision');
    assertEqual(f.timers.size, 0, 'Reine Managerfokusfolge plant keinen Autosave');
    assertEqual(f.writes.length, 0, 'Reine Managerfokusfolge ohne Fachwrite');
    assertEqual(JSON.stringify([...f.backend]), before, 'Managerbackend nach Fokusfolge bytegleich');
    assertEqual(storage.getItem(HOUSEHOLD_PLAN_KEY), cached, 'Managercache nach Fokusfolge bytegleich');
    restore.forEach(fn => fn()); f.controller.dispose();
}

// Alte Fokuscallbacks dürfen keine neue Korrektur oder einen neuen Bereich beeinflussen.
for (const followup of ['new-correction', 'reopen', 'reset', 'scope-switch', 'dispose', 'outside-after-blur']) {
    const f = await setup({ planValues: { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('off') } });
    const root = f.doc.getElementById('managerHouseholdPlan'), field = f.doc.getElementById('managerPlan_goGoMultiplier');
    const details = root.querySelector('[data-plan-dynamic-details]');
    await root.querySelector('[data-plan-dynamic-preset="custom"]').fire('click');
    field.focus(); await field.fire('focus'); await f.input('goGoMultiplier', 'unlesbar');
    f.doc.activeElement = f.doc.body; await field.fire('blur');
    await root.querySelector('[data-plan-dynamic-preset="off"]').fire('click');
    field.focus(); await field.fire('focus'); await f.input('goGoMultiplier', '1,17');
    f.doc.activeElement = f.doc.body;
    await field.fire('blur', { relatedTarget: f.doc.getElementById('managerPlan_longevityMode') });
    assert(field.parent.hidden && details.hidden, followup + ': gültiger Blur schließt regulär');
    let expectedFocus = f.doc.body;
    if (followup === 'new-correction') {
        await f.input('goGoMultiplier', 'unlesbar'); field.focus(); await field.fire('focus');
        await f.input('goGoMultiplier', '1'); expectedFocus = field;
    } else if (followup === 'reopen') {
        // Kein Presetklick: Der alte Timer muss die aktuelle Sichtbarkeit selbst prüfen.
        await f.input('goGoActive', true); await f.input('dynamicFlex', true);
        assert(!f.controller.read().validation && visibleThroughRoot(field, root) && !details.hidden, 'Jüngerer gültiger Managerentwurf öffnet Blurfeld wieder');
    } else if (followup === 'reset') {
        f.controller.discard(); f.doc.activeElement = f.doc.body;
    } else if (followup === 'scope-switch') {
        f.switchTo('out'); f.doc.activeElement = f.doc.body;
    } else if (followup === 'dispose') {
        f.controller.dispose();
        const next = createManagerHouseholdPlan({ doc: f.doc, storage, persistence: P, getProfileId: () => 'z', runOperation: execute => execute() });
        const before = JSON.stringify(next.read());
        await new Promise(resolve => setTimeout(resolve, 0));
        assert(f.doc.activeElement === f.doc.body, 'Dispose verhindert verspäteten Zugriff auf die neue Managerbindung');
        assertEqual(JSON.stringify(next.read()), before, 'Alter Fokusabgleich verändert keinen neuen Managerzustand');
        assertEqual(f.writes.length, 0, 'Dispose und neue Bindung ohne Fachwrite');
        next.dispose(); continue;
    } else {
        expectedFocus = f.doc.createElement('button'); f.doc.body.append(expectedFocus); expectedFocus.focus();
    }
    const revision = f.controller.read().revision, hidden = details.hidden;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(f.doc.activeElement === expectedFocus, followup + ': alter Abgleich verändert den jüngeren Fokus nicht');
    assertEqual(details.hidden, hidden, followup + ': alter Abgleich verändert die jüngere Sichtbarkeit nicht');
    assertEqual(f.controller.read().revision, revision, followup + ': Abgleich ohne Fachrevision');
    assertEqual(f.writes.length, 0, followup + ': Abgleich ohne separaten Write');
    if (followup === 'new-correction') {
        assertFocusedCorrection(f.doc, field, root, '1', 'Neue Korrektur nach überholtem Blur');
        for (const timer of [...f.timers.values()]) timer();
        await waitUntil(() => !f.controller.read().writing);
        assertEqual(f.writes.length, 0, 'Neue fokussierte Korrektur schützt weiterhin vor Zwischenwrites');
    }
    if (followup === 'reset') assert(details.hidden && !f.controller.read().dirty, 'Reset bleibt beim geschlossenen bestätigten Plan');
    f.controller.dispose();
}
