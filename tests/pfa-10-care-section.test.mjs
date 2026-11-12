// PFA-10: Pflegewerte in Personen & Vermögen › Pflege. Dieselbe Eingabe schreibt dieselben Records wie bisher im Simulator,
// Balance und Simulator Jahr 1 rechnen gleich, Außenpersonen und Spielbereich wie überall; Lesen schreibt nie. Testdatum 23.10.2026.
import { pfa2Records, countingStorage, IDS } from './helpers/pfa-2-balance.mjs';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { PersistenceFacade as P, persistenceStorage, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initializePflegeUIControls } from '../app/simulator/simulator-ui-pflege.js';
import { bindManagerCareValues, renderManagerCareValues } from '../app/tranches/tranchen-manager-care-values.js';
import { readCareFieldValues, careValuesSummaryText, carePresetValues } from '../app/shared/care-price-fields.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { initMcRunState } from '../app/simulator/simulator-engine-wrapper.js';
import { fixedCareTodayForYear } from '../app/simulator/simulator-care-today.js';
import { composeYearNeed } from '../app/simulator/simulator-survivor.js';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { captureProfileData } from '../app/profile/profile-live-storage.js';
import { readFileSync } from 'node:fs';
setAppTestDate('2026-10-23');

const GRADES = [1, 2, 3, 4, 5];
const today = (grade, form, extra = {}) => ({ grade, form, ...extra });

/** Kleinste Seite für den Bereich: die Kennungen aus depot-tranchen-manager.html, Ereignisse wie im Browser. */
function managerDocument() {
    const nodes = new Map(), listeners = {};
    const node = (id, extra = {}) => {
        const element = { id, dataset: {}, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', title: '', tagName: 'DIV', attributes: {},
            setAttribute(name, value) { this.attributes[name] = String(value); }, getAttribute(name) { return this.attributes[name] ?? null; },
            closest(selector) { return selector === '[data-care-preset]' && this.dataset.carePreset ? this
                : selector === '[data-care-person]' && this.dataset.carePerson ? this : null; },
            blur() { listeners.change?.({ target: this }); }, ...extra };
        if (id) nodes.set(id, element);
        return element;
    };
    const html = readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
    const panel = node('managerCarePanel', { addEventListener(type, fn) { listeners[type] = fn; }, querySelectorAll: selector => selector === '[data-care-form-cell]' ? cells : [] });
    const cells = [node(null), node(null)];
    for (const match of html.matchAll(/<(input|select|dl|div|p|span|strong|td)\b[^>]*\bid="(managerCare[^"]+)"[^>]*>/g)) {
        if (nodes.has(match[2])) continue;
        const field = /data-care-field="([^"]+)"/.exec(match[0])?.[1];
        node(match[2], { tagName: match[1].toUpperCase(), ...(field ? { dataset: { careField: field } } : {}) });
    }
    const presets = ['custom', 'ambulant', 'amtlich'].map(preset => node(null, { tagName: 'BUTTON', dataset: { carePreset: preset } }));
    const doc = { activeElement: null, getElementById: id => nodes.get(id) ?? null,
        querySelectorAll: selector => selector === '#managerCarePreset [data-care-preset]' ? presets : [] };
    const change = (id, value) => { const field = nodes.get(id); field.value = value; listeners.change({ target: field }); };
    return { doc, nodes, panel, presets, change, click: target => listeners.click({ target, preventDefault() {} }) };
}

/** Echter Persistenzweg mit Speicherzähler; die Aktion bedient eine Seite. */
async function run(records, action) {
    const store = new Map(Object.entries(records));
    let saves = 0;
    P.resetPersistenceForTests({ name: 'PFA-10', async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) { saves++; for (const key of deletes) store.delete(key); for (const [key, value] of upserts) store.set(key, value); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const prior = { document: globalThis.document, window: globalThis.window };
    try { await action(); await P.flush(); }
    finally { globalThis.document = prior.document; globalThis.window = prior.window; await resetPersistenceForTests(); }
    return { records: Object.fromEntries(store), saves };
}

/** Bisheriger Weg: Simulator › Annahmen mit echtem Autosave. */
const simulatorPath = steps => async () => {
    globalThis.document = simulatorDocument(); globalThis.window = { addEventListener() {}, removeEventListener() {} };
    initInputPersistence(); initializePflegeUIControls();
    for (const [id, value] of steps) {
        const field = document.getElementById(id); field.value = value;
        field.dispatchEvent(new Event(field.type === 'select-one' ? 'change' : 'input'));
    }
};
const MANAGER_IDS = { pflegeKostenDrift: 'managerCareDrift', pflegeMaxFloor: 'managerCareMaxFloor', pflegeHeimEigeneAusgaben: 'managerCareOwnExpenses', pflegeRegionalZuschlag: 'managerCareRegional' };
const managerId = id => MANAGER_IDS[id] ?? id.replace(/^pflegeStufe([1-5])Zusatz$/, 'managerCareCost$1').replace(/^pflegeStufe([1-5])Form$/, 'managerCareForm$1')
    .replace(/^pflegeStufe([1-5])FlexCut$/, 'managerCareFlex$1');
/** Neuer Weg: Personen & Vermögen › Pflege. */
const managerPath = steps => async () => {
    const page = managerDocument();
    bindManagerCareValues(page.doc);
    assert(renderManagerCareValues(page.doc), 'Bereich Pflege wird aus dem Speicher gefüllt');
    for (const [id, value] of steps) {
        if (id === 'pflegeKostenStaffelPreset') page.click(page.presets.find(button => button.dataset.carePreset === value));
        else page.change(managerId(id), value);
        await P.flush();
    }
};
// Pflegerelevante Records (Haushalt, Preisbesitzer, Profile) in fester Reihenfolge; die Schreibreihenfolge ist ohne Bedeutung.
const sorted = entries => Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
const care = records => sorted(Object.entries(records).filter(([key]) => key === 'household_care_values_v1' || key.startsWith('sim_pflege'))
    .concat(Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([id, profile]) => [id, sorted(Object.entries(profile.data).filter(([key]) => key.startsWith('sim_pflege')))])));

// 1. Gleiche Eingabe, gleiche Records: Staffel Grad 3, Kostenanstieg 3,5 %, eigene Ausgaben im Heim, übliche Form, Wechsel der Staffel.
const steps = [['pflegeStufe3Zusatz', '21000'], ['pflegeKostenDrift', '3.5'], ['pflegeHeimEigeneAusgaben', '650'], ['pflegeMaxFloor', '110000'],
    ['pflegeStufe2Form', 'home-support'], ['pflegeKostenStaffelPreset', 'ambulant'], ['pflegeKostenStaffelPreset', 'custom']];
const base = pfa2Records({ care: [null, today(3, 'home-support')] }).records;
const before = care(base);
const viaSimulator = await run(base, simulatorPath(steps));
const viaManager = await run(base, managerPath(steps));
assert(JSON.stringify(care(viaSimulator.records)) !== JSON.stringify(before), 'Simulatorweg hat die Pflegewerte geändert');
assertEqual(JSON.stringify(care(viaManager.records)), JSON.stringify(care(viaSimulator.records)), 'Pflege-Bereich schreibt dieselben Records wie der Simulator');
const stored = JSON.parse(viaManager.records.household_care_values_v1).prices;
assertEqual(`${stored.costs[3]} ${stored.driftPercent} ${stored.ownExpensesMonthly} ${stored.maximumFloor} ${stored.origin} ${stored.priceYear}`, '21000 3.5 650 110000 von Hand 2026',
    'Preisblock: Staffel Grad 3 21.000 €, Kostenanstieg 3,5 %, eigene Ausgaben 650 €, Deckel 110.000 €, von Hand, Preisstand 2026');
assertEqual(JSON.parse(viaManager.records.sim_pflegeCustomCosts).values[3], '21000', 'Wechsel weg von „Eigene Werte“ merkt die eigenen Beträge wie im Simulator');

// 2. Balance = Simulator Jahr 1 nach der Eingabe im neuen Bereich (Werner Grad 3 zu Hause, Staffel 21.000 €).
{
    const records = viaManager.records;
    const { storage, counts } = countingStorage(records);
    const balance = buildBalanceEngineInputFromStorage({ storage, scope: pfa2Records({}).scope, referenceYear: 2026 });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Balance liest ohne Schreiben');
    const registry = JSON.parse(records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    const entries = IDS.map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        inputs: buildSimulatorInputsFromProfileData(registry.profiles[profileId].data, { storage, referenceYear: 2026, planValues: plan.entry.values }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const state = initMcRunState(inputs), fixed = fixedCareTodayForYear(inputs, state, 0);
    const need = composeYearNeed({ inputs, baseFloor: state.baseFloor, household: fixed.householdContext, deathThisYear: false, careFloorAddition: fixed.careFloorAddition });
    assertEqual(balance.inputData.floorBedarf, 36000 + 21000, 'Balance: Grundbedarf 36.000 € + Staffel Grad 3 21.000 €');
    assertEqual(need.total, balance.inputData.floorBedarf, 'Balance = Simulator Jahr 1');
}

// 3. Lesen schreibt nie: Bereich füllen und Zusammenfassung des Simulators über zählenden Speicher.
{
    const { storage, counts } = countingStorage(viaManager.records);
    const page = managerDocument();
    assert(renderManagerCareValues(page.doc, { storage }), 'Bereich liest den gespeicherten Stand');
    const text = careValuesSummaryText(storage), fields = readCareFieldValues(storage);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Lesen im Bereich Pflege und in der Simulator-Zeile schreibt nie');
    assertEqual(page.nodes.get('managerCareCost3').value, '21.000', 'Staffel Grad 3 erscheint mit Tausenderpunkt');
    assertEqual(page.nodes.get('managerCareMonthly3').textContent.replace(/\s/g, ' '), '1.750 €', 'Monatsbetrag Grad 3: 21.000 € / 12');
    assertEqual(page.nodes.get('managerCareDrift').value, '3,5', 'Kostenanstieg 3,5 %');
    assertEqual(fields.pflegeStufe2Form, 'home-support', 'Übliche Form Grad 2 aus dem Speicher');
    assert(page.nodes.get('managerCareToday').innerHTML.includes('Grad 3 · zu Hause mit externer Unterstützung'), 'Pflege heute nennt Werner mit Grad und Form');
    assert(page.nodes.get('managerCareToday').innerHTML.replace(/\s/g, ' ').includes('<strong>1.750 €</strong><span class="ds-help">/Monat über die Kasse hinaus · Staffel</span>'), 'Pflege heute nennt den angesetzten Monatsbetrag als Kennzahl (UR-1)');
    assert(page.nodes.get('managerCareHeimYears').innerHTML.includes('ab 4. Heimjahr'), 'Heimjahre nach Zuschuss als Anzeige');
    assert(text.startsWith('Staffel 300 / 500 / 1.750 / 2.667 / 5.000 €/Monat, Heim 3.364 €/Monat im ersten Jahr'), `Simulator-Zeile nennt Staffel je Monat und Heim: ${text}`);
    // GU-1 (S5, FR-38): Kostenanstieg heißt überall „Inflation + x %“.
    assert(text.includes('Kostenanstieg Inflation + 3,5 %') && text.includes('Preisstand 2026'), 'Simulator-Zeile nennt Kostenanstieg und Preisstand');
}

// 4. Außenperson: Bereich zeigt und ändert ihren eigenen Preisblock wie der Simulator; der Haushalt bleibt unverändert.
{
    const records = structuredClone(base);
    const registry = JSON.parse(records.rs_profiles_v1);
    registry.profiles.muster_aussen = structuredClone(registry.profiles[IDS[1]]);
    Object.assign(registry.profiles.muster_aussen.meta, { id: 'muster_aussen', name: 'Muster außen', belongsToHousehold: false });
    records.rs_profiles_v1 = JSON.stringify(registry);
    for (const key of Object.keys(records)) if (/^(profile_|sim_pflege)/.test(key)) delete records[key];
    Object.assign(records, registry.profiles.muster_aussen.data, { rs_current_profile: 'muster_aussen', rs_active_profile: 'muster_aussen' });
    const outsideSteps = [['pflegeStufe2Zusatz', '7000'], ['pflegeKostenDrift', '4']];
    const sim = await run(records, simulatorPath(outsideSteps));
    const manager = await run(records, managerPath(outsideSteps));
    assertEqual(JSON.stringify(care(manager.records)), JSON.stringify(care(sim.records)), 'Außenperson: gleiche Records wie im Simulator');
    assertEqual(manager.records.household_care_values_v1 ?? null, records.household_care_values_v1 ?? null, 'Außenperson ändert die Pflegewerte des Haushalts nicht');
    assertEqual(JSON.parse(manager.records.sim_pflegePreise).costs[2], 7000, 'Außenperson: eigener Preisblock beim eigenen Preisbesitzer');
    const page = managerDocument();
    renderManagerCareValues(page.doc, { storage: countingStorage(manager.records).storage });
    assert(!page.nodes.get('managerCareOwner').hidden && page.nodes.get('managerCareOwner').textContent.includes('Muster außen'), 'Bereich nennt die Außenperson als Besitzerin der Werte');
}

// 5. Spielbereich: Eingaben im Bereich Pflege landen nur in der Spielkopie.
{
    const f = await playFixture('tauri', base); await f.boot();
    const real = f.realBytes();
    await P.activatePlayArea({ source: 'copy', records: await P.readRealRecords() });
    P.resetPersistenceRuntimeForTests(); await P.init(f.options);
    const prior = globalThis.document;
    try { await managerPath([['pflegeStufe3Zusatz', '24000']])(); await P.flush(); }
    finally { globalThis.document = prior; }
    assertEqual(JSON.parse(P.getItemSync('household_care_values_v1')).prices.costs[3], 24000, 'Spielkopie trägt die Eingabe');
    assertEqual(f.realBytes(), real, 'Echte Daten bleiben unverändert');
    P.resetPersistenceRuntimeForTests();
}

// 6. Ungültige Eingabe wird nicht gespeichert; der bisherige Wert bleibt.
{
    const result = await run(base, async () => {
        const page = managerDocument(); bindManagerCareValues(page.doc); renderManagerCareValues(page.doc);
        page.change('managerCareCost3', '-5'); await P.flush();
        assertEqual(page.nodes.get('managerCareCost3').value, '18.000', 'Negativer Betrag: Feld zeigt wieder den gespeicherten Wert');
        assert(page.nodes.get('managerCareStatus').textContent.includes('ab 0'), 'Hinweis nennt die Grenze');
    });
    assertEqual(JSON.stringify(care(result.records)), JSON.stringify(before), 'Ungültige Eingabe ändert nichts');
}

// 7. Simulator: Zusammenfassung und Link, keine Pflegewert-Eingabefelder mehr.
{
    const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const section = html.slice(html.indexOf('data-fieldset="pflege"'), html.indexOf('</details></section>', html.indexOf('data-fieldset="pflege"')));
    const visible = section.slice(0, section.indexOf('id="simCareValueCarrier"'));
    for (const id of ['pflegeMaxFloor', 'pflegeKostenDrift', 'pflegeHeimEigeneAusgaben', 'pflegeKostenStaffelPreset', ...GRADES.flatMap(grade => [`pflegeStufe${grade}Zusatz`, `pflegeStufe${grade}Form`])]) {
        assert(!visible.includes(`id="${id}"`), `${id} ist keine sichtbare Simulator-Eingabe mehr`);
    }
    assert(/<div id="simCareValueCarrier" class="sim-care-values-carrier" hidden>/.test(section), 'Pflegewerte liegen nur noch im verborgenen Träger der Rechnung');
    assert(visible.includes('href="depot-tranchen-manager.html#pflege"') && visible.includes('In Personen &amp; Vermögen › Pflege ändern'), 'Simulator verlinkt den Bereich Pflege');
    assert(visible.includes('id="simCareValuesText"'), 'Simulator zeigt eine Zeile mit den Pflegewerten');
    assert(!/id="simCareTodaySummary" class="[^"]*ds-readonly-value/.test(section), 'D1: Kopftext ist kein einzeiliger Einzelwert mehr');
    const css = readFileSync(new URL('../simulator.css', import.meta.url), 'utf8');
    assert(/#simCareTodaySummary \{[^}]*white-space: normal;[^}]*grid-column: 1;/.test(css), 'D1: Kopftext bricht um und steht links vom Schalter');
}

// 8. PFA-11: Regionaler Zuschlag und Flex-Level je Grad im Bereich Pflege. Gleiche Records wie im Simulator, Balance = Simulator
// Jahr 1 (Werner Grad 3 zu Hause, Staffel 18.000 € plus 12,5 % Zuschlag, Flex-Level Grad 3 40 %), Lesen schreibt nie.
{
    const flexSteps = [['pflegeRegionalZuschlag', '12.5'], ['pflegeStufe3FlexCut', '40'], ['pflegeStufe1FlexCut', '90']];
    const flexBase = pfa2Records({ care: [null, today(3, 'home-support')], plan: { flexBedarf: 12000 } }).records;
    const sim = await run(flexBase, simulatorPath(flexSteps));
    const manager = await run(flexBase, managerPath(flexSteps));
    assertEqual(sim.records.sim_pflegeRegionalZuschlag, '12.5', 'Simulatorweg speichert den Zuschlag unter sim_pflegeRegionalZuschlag');
    assertEqual(JSON.stringify(care(manager.records)), JSON.stringify(care(sim.records)), 'Zuschlag und Flex-Level: dieselben Records wie im Simulator');
    assertEqual(manager.records.household_care_values_v1, flexBase.household_care_values_v1, 'Zuschlag und Flex-Level ändern den Preisblock nicht');

    const { storage, counts } = countingStorage(manager.records);
    const balance = buildBalanceEngineInputFromStorage({ storage, scope: pfa2Records({}).scope, referenceYear: 2026 });
    const registry = JSON.parse(manager.records.rs_profiles_v1), plan = readBalanceHouseholdPlan({ storage });
    // Das aktive Profil trägt seine Live-Schlüssel wie beim Erfassen des Profils (captureProfileData).
    const profileData = profileId => profileId === manager.records.rs_current_profile
        ? { ...registry.profiles[profileId].data, ...captureProfileData(storage) } : registry.profiles[profileId].data;
    const entries = IDS.map(profileId => ({ profileId, name: registry.profiles[profileId].meta.name,
        inputs: buildSimulatorInputsFromProfileData(profileData(profileId), { storage, referenceYear: 2026, planValues: plan.entry.values }) }));
    const inputs = combineSimulatorProfiles(entries, IDS[0], { planValues: plan.entry.values }).combined;
    const state = initMcRunState(inputs), fixed = fixedCareTodayForYear(inputs, state, 0);
    const need = composeYearNeed({ inputs, baseFloor: state.baseFloor, household: fixed.householdContext, deathThisYear: false, careFloorAddition: fixed.careFloorAddition });
    assertEqual(counts.setItem + counts.removeItem, 0, 'Balance und Simulator lesen ohne Schreiben');
    assertEqual(balance.inputData.floorBedarf, 36000 + 18000 * 1.125, 'Balance: Grundbedarf 36.000 € + Staffel Grad 3 18.000 € × 1,125');
    assertEqual(need.total, balance.inputData.floorBedarf, 'Zuschlag: Balance = Simulator Jahr 1');
    assert(fixed.temporaryFlexFactor < 1, 'Flex-Level Grad 3 kürzt den Flex im Simulator');
    assertClose(balance.inputData.flexBedarf, inputs.startFlexBedarf * fixed.temporaryFlexFactor, 1e-9, 'Flex-Level: Balance = Simulator Jahr 1');

    const page = managerDocument();
    assert(renderManagerCareValues(page.doc, { storage }), 'Bereich zeigt Zuschlag und Flex-Level');
    const text = careValuesSummaryText(storage);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Lesen von Zuschlag und Flex-Level schreibt nie');
    assertEqual(`${page.nodes.get('managerCareRegional').value} ${GRADES.map(grade => page.nodes.get(`managerCareFlex${grade}`).value).join('/')}`, '12,5 90/100/40/0/0',
        'Bereich zeigt Zuschlag 12,5 % und Flex-Level 90/100/40/0/0 %');
    assert(text.includes('regionaler Zuschlag 12,5 %') && text.includes('Flex-Level 90 / 100 / 40 / 0 / 0 %'), `Simulator-Zeile nennt Zuschlag und Flex-Level: ${text}`);

    const empty = renderManagerCareValues(managerDocument().doc, { storage: countingStorage(base).storage });
    assert(empty, 'Ohne gespeicherte Werte gelten die Vorgaben');
    const defaults = careValuesSummaryText(countingStorage(base).storage);
    assert(!defaults.includes('Zuschlag') && defaults.includes('Flex-Level 100 / 100 / 50 / 0 / 0 %'), `Vorgaben ohne Zuschlag und mit Flex-Level 100/100/50/0/0: ${defaults}`);

    const invalid = await run(base, async () => {
        const view = managerDocument(); bindManagerCareValues(view.doc); renderManagerCareValues(view.doc);
        view.change('managerCareFlex3', '120'); await P.flush();
        assertEqual(view.nodes.get('managerCareFlex3').value, '50', 'Flex-Level über 100 %: Feld zeigt wieder den gespeicherten Wert');
        assert(view.nodes.get('managerCareStatus').textContent.includes('0 bis 100'), 'Hinweis nennt die Grenzen des Flex-Levels');
    });
    assertEqual(JSON.stringify(care(invalid.records)), JSON.stringify(before), 'Ungültiges Flex-Level ändert nichts');

    const outside = structuredClone(base), outsideRegistry = JSON.parse(outside.rs_profiles_v1);
    outsideRegistry.profiles.muster_aussen = structuredClone(outsideRegistry.profiles[IDS[1]]);
    Object.assign(outsideRegistry.profiles.muster_aussen.meta, { id: 'muster_aussen', name: 'Muster außen', belongsToHousehold: false });
    outside.rs_profiles_v1 = JSON.stringify(outsideRegistry);
    for (const key of Object.keys(outside)) if (/^(profile_|sim_pflege)/.test(key)) delete outside[key];
    Object.assign(outside, outsideRegistry.profiles.muster_aussen.data, { rs_current_profile: 'muster_aussen', rs_active_profile: 'muster_aussen' });
    const outsideSim = await run(outside, simulatorPath(flexSteps)), outsideManager = await run(outside, managerPath(flexSteps));
    assertEqual(JSON.stringify(care(outsideManager.records)), JSON.stringify(care(outsideSim.records)), 'Außenperson: Zuschlag und Flex-Level wie im Simulator');

    const html = readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const section = html.slice(html.indexOf('data-fieldset="pflege"'), html.indexOf('</details></section>', html.indexOf('data-fieldset="pflege"')));
    const visible = section.slice(0, section.indexOf('id="simCareValueCarrier"'));
    for (const id of ['pflegeRegionalZuschlag', ...GRADES.map(grade => `pflegeStufe${grade}FlexCut`)]) {
        assert(!visible.includes(`id="${id}"`) && section.includes(`id="${id}"`), `${id} liegt nur noch im verborgenen Träger des Simulators`);
    }
    assert(GRADES.every(grade => visible.includes(`id="pflegeStufe${grade}Mortality"`)), 'Sterblichkeit je Grad bleibt im Simulator');
}

// 9. PFA-12 Befund 1: Alte Flex-Vorgabe 75/25/10/0/0 ohne Versionsmarke. Der Bereich Pflege zeigt sie wie der Simulator als
// 100/100/50/0/0 an (Lesen schreibt nie) und speichert eine Eingabe samt wirksamer Staffel und Marke wie der Simulatorweg.
{
    const OLD = { sim_pflegeStufe1FlexCut: '75', sim_pflegeStufe2FlexCut: '25', sim_pflegeStufe3FlexCut: '10', sim_pflegeStufe4FlexCut: '0', sim_pflegeStufe5FlexCut: '0' };
    const legacy = pfa2Records({ care: [null, today(3, 'home-support')], plan: { flexBedarf: 12000, minimumFlexAnnual: 6000 }, sim: OLD }).records;
    assertEqual(legacy.sim_careFlexDefaultsVersion ?? null, null, 'Altbestand ohne Versionsmarke');
    // Flex-Schlüssel samt Marke im Live-Speicher und in jedem Profil.
    const flexKeys = [...GRADES.map(grade => `sim_pflegeStufe${grade}FlexCut`), 'sim_careFlexDefaultsVersion'];
    const flexState = records => JSON.stringify([flexKeys.map(key => records[key] ?? null),
        ...Object.values(JSON.parse(records.rs_profiles_v1).profiles).map(profile => flexKeys.map(key => profile.data[key] ?? null))]);

    const { storage, counts } = countingStorage(legacy);
    const page = managerDocument();
    assert(renderManagerCareValues(page.doc, { storage }), 'Bereich liest den Altbestand');
    const summary = careValuesSummaryText(storage);
    assertEqual(counts.setItem + counts.removeItem, 0, 'Altbestand: Lesen im Bereich Pflege schreibt nie');
    assertEqual(GRADES.map(grade => page.nodes.get(`managerCareFlex${grade}`).value).join('/'), '100/100/50/0/0', 'Alte Vorgabe erscheint wie im Simulator als 100/100/50/0/0');
    assert(summary.includes('Flex-Level 100 / 100 / 50 / 0 / 0 %'), `Simulator-Zeile nennt die wirksame Staffel: ${summary}`);

    const steps = [['pflegeStufe1FlexCut', '90']];
    const sim = await run(legacy, simulatorPath(steps));
    const manager = await run(legacy, managerPath(steps));
    assertEqual(`${GRADES.map(grade => sim.records[`sim_pflegeStufe${grade}FlexCut`]).join('/')} ${sim.records.sim_careFlexDefaultsVersion}`, '90/100/50/0/0 1',
        'Simulatorweg: 90/100/50/0/0 mit Marke 1');
    assertEqual(flexState(manager.records), flexState(sim.records), 'Bereich Pflege: Flex-Level und Marke wie im Simulatorweg');
    assertEqual(JSON.stringify(care(manager.records)), JSON.stringify(care(sim.records)), 'Bereich Pflege: übrige Pflegerecords wie im Simulatorweg');

    const balance = buildBalanceEngineInputFromStorage({ storage: countingStorage(manager.records).storage, scope: pfa2Records({}).scope, referenceYear: 2026 });
    assertEqual(balance.inputData.flexBedarf, 10500, 'Balance nach der Eingabe im Bereich: Wunsch-Flex 10.500 € (wie im Simulatorweg)');
    assertEqual(balance.inputData.minimumFlexAnnual, 5250, 'Balance nach der Eingabe im Bereich: Mindest-Flex 5.250 €');
}

// 10. PFA-12 Befund 2: Simulatorstart mit gespeicherter Vorgabe „Amtlicher Durchschnitt“ und ohne Staffel-Einzelschlüssel
// schreibt nichts; die Rechenfelder tragen trotzdem die amtlichen Beträge.
{
    const official = pfa2Records({ care: [null, today(3, 'home-support')], sim: { sim_pflegeKostenStaffelPreset: 'amtlich' } }).records;
    const registry = JSON.parse(official.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) for (const grade of GRADES) delete profile.data[`sim_pflegeStufe${grade}Zusatz`];
    official.rs_profiles_v1 = JSON.stringify(registry);
    for (const grade of GRADES) delete official[`sim_pflegeStufe${grade}Zusatz`];
    let fields = '';
    const started = await run(official, async () => {
        await simulatorPath([])();
        fields = GRADES.map(grade => document.getElementById(`pflegeStufe${grade}Zusatz`).value).join('/');
    });
    assertEqual(started.saves, 0, 'Simulatorstart mit amtlicher Staffel: keine Schreibcharge');
    assertEqual(JSON.stringify(sorted(Object.entries(started.records))), JSON.stringify(sorted(Object.entries(official))), 'Simulatorstart lässt alle Records unverändert');
    assertEqual(fields, GRADES.map(grade => String(carePresetValues('amtlich', countingStorage(official).storage)[grade])).join('/'),
        'Rechenfelder tragen die amtlichen Beträge wie bisher');
}
