import { createPlanTrial, registerPlanTrial, registeredPlanTrial, planTrialPatch,
    bindPlanTrialContext, planTrialContextFor } from '../app/shared/plan-trial.js';
import { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, buildPlanRecord, planScope,
    readHouseholdPlan, patchHouseholdPlan } from '../app/profile/household-plan.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';

const scope = planScope('single', ['testperson']);
let backend = { [HOUSEHOLD_PLAN_KEY]: buildPlanRecord(null, [{ scope, values: PLAN_DEFAULTS }]).raw };
let writes = 0, patches = [];
let local = { rebalancingBand: 25 };
const makeTrial = () => createPlanTrial({
    readPlan: () => ({ ...readHouseholdPlan({ scope }), scope }),
    writePlan: async options => { patches.push(options.patch); return patchHouseholdPlan(options); },
    readLocal: () => local, projectLocal: values => { local = values; }
});
try {
    P.resetPersistenceForTests({ name: 'Gemeinsamer Planversuch', async init() {},
        async loadAll() { return { ...backend }; },
        async saveBatch({ upserts, deletes }) {
            writes++;
            deletes.forEach(key => delete backend[key]);
            upserts.forEach(([key, value]) => { backend[key] = value; });
        } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const trial = makeTrial(), doc = {};
    assertEqual(registeredPlanTrial(doc), null, 'Kein Besitzer ohne ausdrückliche Registrierung');
    registerPlanTrial(doc, trial);
    assert(registeredPlanTrial(doc) === trial, 'Dokument verwendet den ausdrücklich registrierten Besitzer');
    const baseline = JSON.stringify(backend);
    trial.start(); trial.update({ flexBedarf: 35000, decumulation: { bondTargetFactor: 8 } });
    local.rebalancingBand = 35; trial.updateLocal(local);
    assert(trial.read().differences.some(item => item.local && item.path === 'rebalancingBand'),
        'Zusätzlicher Profilwert gehört zum selben flüchtigen Versuch');
    assertEqual(JSON.stringify(planTrialPatch(trial.read().differences)),
        JSON.stringify({ flexBedarf: 35000, decumulation: { bondTargetFactor: 8 } }),
        'Patch enthält ausschließlich Planpfade, keine zusätzlichen Profilwerte');
    await P.flush();
    assertEqual(JSON.stringify(backend), baseline, 'Start und Änderungen bleiben speicherfrei');
    const reload = makeTrial();
    assert(!reload.read().active && reload.values().flexBedarf === PLAN_DEFAULTS.flexBedarf,
        'Neue Seiteninstanz beginnt beim gespeicherten Plan ohne Versuch');
    trial.reset();
    assertEqual(local.rebalancingBand, 25, 'Rückkehr setzt auch zusätzliche lokale Werte zurück');
    assertEqual(writes, 0, 'Start, Änderung, Rückkehr und neue Instanz schreiben nichts');
    trial.start(); trial.update({ flexBedarf: 35000, decumulation: { bondTargetFactor: 8 } });
    const cancelled = await trial.adopt(async () => null);
    assert(cancelled.status === 'cancelled' && trial.read().active, 'Auswahlabbruch hält den Versuch');
    assertEqual(writes, 0, 'Auswahlabbruch schreibt nichts');
    const saved = await trial.adopt(async () => ['decumulation.bondTargetFactor']);
    assert(saved.status === 'saved' && !trial.read().active, 'Bestätigte Teilübernahme beendet den Versuch');
    assertEqual(JSON.stringify(patches), JSON.stringify([{ decumulation: { bondTargetFactor: 8 } }]),
        'Bestehender Planbesitzer erhält genau den ausgewählten Patch');
    const values = readHouseholdPlan({ scope }).entry.values;
    assert(values.flexBedarf === PLAN_DEFAULTS.flexBedarf && values.decumulation.bondTargetFactor === 8,
        'Gespeicherter Gesamtplan enthält nur die ausgewählte Änderung');
    assertEqual(writes, 1, 'Teilübernahme schreibt genau einmal in das Backend');

    // Beide Versuchswerte passen zusammen; die isolierte Mindest-Flex-Auswahl nicht.
    trial.start(); trial.update({ flexBedarf: 40000, minimumFlexAnnual: 30000 });
    const beforeInvalid = JSON.stringify(backend);
    let error;
    try { await trial.adopt(async () => ['minimumFlexAnnual']); } catch (caught) { error = caught; }
    assert(error?.message.includes('Mindest-Flex') && trial.read().active,
        'Ungültige Teilkombination meldet Mindest-Flex und hält den Entwurf');
    assertEqual(JSON.stringify(backend), beforeInvalid, 'Ungültige Auswahl verändert keine Planbytes');
    assertEqual(writes, 1, 'Ungültige Auswahl ruft keinen Backendwrite auf');
    await trial.adopt(async () => []);
    assert(!trial.read().active && writes === 1, 'Alles im Plan belassen beendet den Versuch ohne Write');

    trial.start(); trial.update({ floorBedarf: 18000 });
    error = null;
    try { await trial.adopt(async () => ['rebalancingBand']); } catch (caught) { error = caught; }
    assert(error && writes === 1 && trial.read().active, 'Unbekannte Auswahl kann keinen Planpatch erzeugen');
    const inputs = {};
    bindPlanTrialContext(inputs, { scope, deviationApplied: true });
    assert(planTrialContextFor(inputs).deviationApplied && planTrialContextFor({}) === null,
        'Laufeingabekontext gehört zur konkreten Eingabeinstanz');

    const marketValues = { ...structuredClone(PLAN_DEFAULTS),
        cape: { value: 23, asOf: '2026-10-09', source: 'Synthetischer Marktbeleg' } };
    let marketWrites = 0;
    const marketTrial = createPlanTrial({ readPlan: () => ({ status: 'valid', scope, entry: { values: marketValues } }),
        writePlan: async () => { marketWrites++; } });
    marketTrial.start(); marketTrial.update({ cape: { value: 31 } });
    error = null;
    try { await marketTrial.adopt(async () => ['cape.value']); } catch (caught) { error = caught; }
    assert(error?.message.includes('CAPE-Quelle') && marketWrites === 0,
        'Ausgewählter Versuchs-CAPE darf keinen alten Marktbeleg behalten');
    const marketSaved = await marketTrial.adopt(async () => ['cape.value', 'cape.asOf', 'cape.source']);
    assert(marketSaved.status === 'saved' && marketWrites === 1,
        'CAPE samt entfallender Herkunft ist ausdrücklich auswählbar');
} finally { P.resetPersistenceForTests(); }
