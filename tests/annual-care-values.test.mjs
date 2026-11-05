import { readMD2References } from './helpers/md-2-expectations.mjs';
import { readQSCReferences as readBeforeMD2References } from './helpers/qs-c-expectations.mjs';
const readQSCReferences = value => readMD2References(readBeforeMD2References(value));
import { readVF2BReferences } from './helpers/vf-2b-expectations.mjs';
import { readGL1References } from './helpers/gl-1-expectations.mjs';
import { readAS1References } from './helpers/as-1-expectations.mjs';
import { readEP1References } from './helpers/ep-1-expectations.mjs';
import { readRNG1Hash, readRNG1References } from './helpers/rng-1-expectations.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import fs from 'node:fs/promises';
import { careValueControls } from './helpers/care-values-controls.mjs';
import { HOUSEHOLD_CARE_VALUES_KEY as KEY, DEFAULT_CARE_VALUES, parseCareValues, readCareValues, officialCareCosts, careValuesInputPatch } from '../app/shared/household-care-values.js';
import { createAnnualCareEditor } from '../app/shared/annual-care-editor.js';
import { annualNeedsComparison } from '../app/shared/annual-needs-review.js';
import { createAnnualPlanEditor, evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { readyAnnualFixture, annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
import { EngineAPI } from '../engine/index.mjs';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { isAllowedSnapshotCaptureKey, isProbelaufRecordKey } from '../app/shared/persistence-key-policy.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { PersistenceFacade as P, resetPersistenceForTests } from '../app/shared/persistence-facade.js';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { overviewScope } from '../app/overview/overview-storage.js';

const control = JSON.parse(await fs.readFile(new URL('./fixtures/care-values-default-controls.json', import.meta.url)));
assertEqual(JSON.stringify(await careValueControls(undefined, careValuesInputPatch(parseCareValues(JSON.stringify(DEFAULT_CARE_VALUES))))), JSON.stringify(readQSCReferences(readVF2BReferences(readGL1References(readAS1References(readEP1References(readRNG1References(control))))))),
    'Vorgaben: vollständige MC-, Backtest- und Paritätsbytes mit belegten FR-51-/FR-57-Folgen');
assertEqual(JSON.stringify(officialCareCosts()), JSON.stringify({ 1: 200, 2: 2300, 3: 7100, 4: 15000, 5: 18900 }), 'Amtliche Vorgabestaffel bytegleich');

const fixture = readyAnnualFixture(), storage = annualRecordStorage(fixture.records);
const custom = structuredClone(DEFAULT_CARE_VALUES);
custom.allowance.values[2] = 500; custom.allowance.origin = 'von Hand'; custom.allowance.asOf = custom.allowance.validFrom = '2027-01'; custom.residential.monthly = 4000;
storage.setItem(KEY, JSON.stringify(custom));
const registry = JSON.parse(storage.getItem('rs_profiles_v1')), id = storage.getItem('rs_current_profile');
const data = { ...registry.profiles[id].data, profile_care_grade_today: '2', sim_pflegeKostenStaffelPreset: 'custom' };
const inputs = buildSimulatorInputsFromProfileData(data, { referenceYear: 2027, storage });
assertEqual(inputs.careValues.allowance.values[2], 500, 'Profilreader übernimmt gespeichertes Pflegegeld in Worker-Payload');
const income = calculateFixedIncomeForYear({ inputs: { ...inputs, fixedIncome: [] }, state: {}, yearIndex: 0, inflationFactor: 1.02,
    household: { p1Alive: true, p2Alive: false }, deathThisYear: false, care: { p1: { active: true, grade: 2 } } });
assertClose(income.pflegegeld, 500 * 12 * 1.02, 1e-8, 'Geändertes Pflegegeld wirkt mit bestehender Inflation im Simulator');
const official = buildSimulatorInputsFromProfileData({ ...data, sim_pflegeKostenStaffelPreset: 'amtlich' }, { referenceYear: 2027, storage });
assertEqual(official.pflegeGradeConfigs[5].zusatz, officialCareCosts(custom)[5], 'Geänderter Heim-Eigenanteil ändert amtliche Staffel im Rechenpfad');
assert(official.pflegeGradeConfigs[5].zusatz !== 18900, 'Neue Staffel unterscheidet sich von Vorgabe');
storage.setItem('profile_care_grade_today', '2'); storage.setItem('sim_pflegeKostenStaffelPreset', 'custom');
const oldBalance = buildBalanceEngineInputFromStorage({ storage: annualRecordStorage({ ...storage.records, [KEY]: JSON.stringify(DEFAULT_CARE_VALUES) }), referenceYear: 2027 });
const newBalance = buildBalanceEngineInputFromStorage({ storage, referenceYear: 2027 });
assertClose(newBalance.inputData.renteMonatlich - oldBalance.inputData.renteMonatlich, 153, 1e-8, 'Balance verwendet denselben gespeicherten Pflegegeldbetrag');
const backupStorage = annualRecordStorage({ ...createMusterHaushaltRecords('2026-10-20'), [KEY]: JSON.stringify(custom) });
const context = { registry: JSON.parse(backupStorage.getItem('rs_profiles_v1')), activeId: backupStorage.getItem('rs_current_profile'),
    scope: overviewScope('household', ['muster_a', 'muster_b']), kind: 'montecarlo' };
const signature = raw => sourceFingerprint({ ...context, liveData: { ...backupStorage.records, [KEY]: raw } });
assert(signature(JSON.stringify(custom)) !== null && signature(JSON.stringify(custom)) !== signature(JSON.stringify(DEFAULT_CARE_VALUES)), 'Eigene Pflegewerte entwerten alte Simulationszusammenfassungen');
assertEqual(signature(JSON.stringify(DEFAULT_CARE_VALUES)), signature(undefined), 'Bestätigung der Vorgaben ändert keinen Quellfingerabdruck');
assert(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage: backupStorage })).ok, 'Vollsicherung mit Pflegewerten importierbar');
assertEqual(normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage: backupStorage })).backup.records[KEY], storage.getItem(KEY), 'Vollsicherung bewahrt Pflegewerte bytegleich');
const target = annualRecordStorage(fixture.records);
assert(importProfilesBundle(exportProfilesBundle({ storage: backupStorage }), { storage: target }).ok, 'Profilbundle importiert gemeinsame Pflegewerte');
assertEqual(target.getItem(KEY), storage.getItem(KEY), 'Profilbundle bewahrt Pflegewerte bytegleich');
assert(!validatePersistenceDomainRecords({ ...backupStorage.records, [KEY]: JSON.stringify({ ...custom, residential: { ...custom.residential, monthly: -1 } }) }).ok, 'Import weist ungültige Pflegewerte ab');
assert(isAllowedSnapshotCaptureKey(KEY) && isProbelaufRecordKey(KEY), 'Pflegewerte gehören zu Wiederherstellungspunkt und Spielbereich');

// Tatsächliche Bereichskopie und Rückkehr: nur synthetische Daten.
const play = await playFixture('tauri', backupStorage.records);
let controller = await play.boot();
try {
    await controller.start(() => ({ source: 'copy', testDate: '2027-01-02' })); controller = await play.boot();
    assertEqual(P.getItemSync(KEY), JSON.stringify(custom), 'Spielbereich übernimmt Pflegewerte');
    P.setItemSync(KEY, JSON.stringify(DEFAULT_CARE_VALUES)); await P.flush();
    await controller.end(() => true); await play.boot();
    assertEqual(P.getItemSync(KEY), JSON.stringify(custom), 'Spielbereichende erhält echten Pflegewertbestand');
} finally { await resetPersistenceForTests(); }

const listen = (node, type, fn) => node.addEventListener(type, fn);
for (const name of ['Einzelprofil', undefined]) {
    const sample = readyAnnualFixture(name), store = annualRecordStorage(sample.records), before = JSON.stringify(store.records), { doc } = createDialogFixture();
    const care = createAnnualCareEditor({ doc, targetYear: 2026, storage: store, listen }); doc.body.append(care.root);
    assert(!care.read().confirmed, 'Pflegeschritt beginnt auch bei Vorgaben offen');
    await care.root.querySelector('[data-annual-care-confirm]').fire('click');
    assert(care.read().confirmed && care.accept().confirmedForYear === 2027, 'Unverändert bestätigen erledigt Pflegeschritt für das Folgejahr');
    assertEqual(JSON.stringify(store.records), before, 'Bestätigen schreibt keinen Fachrecord');
    await care.root.querySelector('[data-annual-care-edit]').fire('click');
    const field = doc.getElementById('annualCare_2'); field.value = '510'; await field.fire('input');
    assert(!care.read().confirmed, 'Änderung verlangt erneute Bestätigung');
    doc.getElementById('annualCare_from').value = '01.2027';
    await care.root.querySelector('[data-annual-care-confirm]').fire('click');
    const accepted = care.accept();
    assertEqual(accepted.allowance.values[2], 510, 'Eigenes Pflegegeld übernommen');
    assertEqual(accepted.allowance.origin, 'von Hand', 'Geänderte Beträge erhalten manuelle Herkunft');
    assert(care.root.querySelector('.annual-care-heading').children[1].textContent.includes('von Hand'), 'Pflegeentwurf zeigt die geänderte Herkunft direkt am Stand');
    assertEqual(accepted.allowance.validFrom, '2027-01', 'Gültig ab wird gespeichert');
    const state = JSON.parse(store.getItem(CONFIG.STORAGE.LS_KEY));
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'test-before', phase: 'writes_started' };
    const commitStore = annualRecordStorage({ ...store.records, [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) });
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: annualTestMarketData, storage: commitStore, now: annualTestNow });
    const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, careValues: accepted, now: annualTestNow });
    assertEqual(readCareValues(annualRecordStorage(prepared.records)).allowance.values[2], 510, 'Jahresbatch enthält bestätigte Pflegewerte');
    assertEqual(JSON.stringify(store.records), before, 'Berechnung des Jahresbatches erhält Livebestand');
    field.value = '-1'; await field.fire('input');
    assert(!care.read().confirmed && care.root.querySelector('[data-annual-care-confirm]').disabled, 'Ungültige Pflegewerte sperren Bestätigung');
}

// Echte Enginevorschau und dieselben direkt sichtbaren Geldfelder wie im Dialog.
const sample = readyAnnualFixture(), store = annualRecordStorage(sample.records);
const values = JSON.parse(store.getItem(HOUSEHOLD_PLAN_KEY)).entries[sample.scope.key].values;
store.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(store.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: sample.scope, values: { ...values, floorBedarf: 30000, flexBedarf: 30000, minimumFlexAnnual: 7500 } }]).raw);
const before = JSON.stringify(store.records), { doc } = createDialogFixture();
const preview = () => projectAnnualPreview({ targetYear: 2026, inflation: { rate: 2.5 }, storage: store });
const evaluate = patch => evaluateAnnualPlanPreview({ targetYear: 2026, marketData: { ...annualTestMarketData, inflation: { ...annualTestMarketData.inflation, rate: 2.5 } }, storage: store, adoptedPlanPatch: patch, now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
const initial = await evaluate();
const editor = createAnnualPlanEditor({ doc, listen, getPreview: preview, getAnnualExpenses: () => ({ complete: true, total: 60467.5 }), evaluate }); doc.body.append(editor.root); await editor.setBase(initial.values);
const minimum = doc.getElementById('annualPlan_minimumFlexAnnual');
assertEqual(minimum.value, '8.000 €', 'Mindest-Flex wird auf volle Tausender aufgerundet');
assertEqual(editor.accept(), undefined, 'Vorausgewählte Tausendervorschläge gehören ohne Anpassungspatch zum Jahresbeschluss');
const flex = doc.getElementById('annualPlan_flexBedarf');
assert(!editor.root.querySelector('[data-annual-needs-review]').hidden && !flex.parent.hidden, 'Bedarfsfelder direkt sichtbar');
flex.value = '32.000'; await flex.fire('input');
for (let i = 0; i < 100 && editor.read().pending; i++) await new Promise(resolve => setTimeout(resolve, 1));
assertEqual(editor.accept().flexBedarf, 32000, 'Eigener Bedarf wird zum beschlossenen Planpatch');
assert(editor.root.querySelector('[data-annual-plan-panel]').hidden, 'Eigener Bedarf öffnet die übrigen Planwerte nicht');
await editor.root.querySelector('[data-annual-need-suggestion="flexBedarf:plan"]').fire('click');
for (let i = 0; i < 100 && editor.read().pending; i++) await new Promise(resolve => setTimeout(resolve, 1));
assertEqual(editor.accept(), undefined, 'Planvorschlag ersetzt eigenen Wert durch Empfehlung ohne Anpassungspatch');
assertEqual(editor.read().values.flexBedarf, 31000, 'Hochrechnung bleibt die Inflationsprojektion und übernimmt keine Ist-Ausgaben');
const complete = annualNeedsComparison(preview(), { complete: true, total: 60467.5 });
assertClose(complete.difference, 467.5, 1e-8, 'Abweichung aus Jahresausgaben minus Grundbedarf und Flex');
assertClose(complete.percent, 467.5 / 60000 * 100, 1e-8, 'Prozentabweichung bezieht sich auf Bedarf J');
for (const annual of [undefined, { complete: false, total: 50000 }]) {
    const comparison = annualNeedsComparison(preview(), annual);
    assert(comparison.expenses === null && comparison.difference === null && comparison.percent === null, 'Fehlende Monatsabschlüsse ergeben weder Ist-Wert noch Abweichung');
}
assertEqual(JSON.stringify(store.records), before, 'Bedarfsprüfung und Übernahme schreiben keine Livewerte');
editor.dispose();
