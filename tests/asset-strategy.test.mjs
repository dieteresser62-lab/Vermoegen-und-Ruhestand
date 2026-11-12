import { readGU1References } from './helpers/gu-1-expectations.mjs';
// LE-1 (FR-75) und KO-2 (Ergänzung FR-76) in einem Leser; Paare, die beide ändern, sind für den vereinten Stand gemessen.
import { readLE1KO2References } from './helpers/le-1-ko-2-expectations.mjs';
import { readQSCReferences } from './helpers/qs-c-expectations.mjs';
import { withoutExampleNeeds } from './helpers/ff-3-expectations.mjs';
import { readVF2EReferences } from './helpers/vf-2e-expectations.mjs';
const readMU1Hash = value => readQSCReferences(readVF2EReferences(previousMU1Hash(value)));
import { readMU1Hash as previousMU1Hash } from './helpers/mu-1-expectations.mjs';
import { readAS1Hash } from './helpers/as-1-expectations.mjs';
import { createHash } from 'node:crypto';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE } from '../app/demo/muster-haushalte.js';
import { readAssetStrategyWarnings, enableAssetStrategy } from '../app/profile/asset-strategy.js';
import { readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { assetStrategyWarningHtml, renderAssetStrategyWarnings, bindAssetStrategyWarnings } from '../app/shared/asset-strategy-warnings.js';
import { buildTranchenTableHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { normalizeTranches } from '../app/tranches/tranchen-manager-state.js';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createNavigationGuard, createNavigationOperationLifecycle } from '../app/shared/navigation-guard.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { readGA2References } from './helpers/ga-2-expectations.mjs';

// Vollständige Records vor AG-1, einschließlich Jahresbeleg, am festen Musterdatum.
const unchanged = {
    'max-erika': readQSCReferences('806a0fafecd0a200bd820be5d7a1283ace0a195b4e7cafbac0e944834b7c2b8e'),
    'jan-lena': 'f600165cc76c0cfef66fda34eaa08ccfac7a7ddd7528f48b8d744a40b2454b9d',
    sophie: 'bb74733d9ae3779c6e4cb66eab62c9acf67178ca13e6f8b8719c9b3940ee20f3',
    'helga-werner': '3e88a41ef206df21be218eaa89bdd9f2a292b40ed1526caa5c25caed72026f7d'
};
for (const household of MUSTER_HAUSHALTE) {
    const records = createMusterHaushaltRecords('2026-10-23', household.id);
    assertEqual(readAssetStrategyWarnings({ storage: { getItem: key => records[key] ?? null } }).length, 0,
        `${household.name}: kein Muster zeigt eine Strategie-Warnung`);
    const previous = withoutExampleNeeds(records);
    if (household.id === 'sophie') {
        assertEqual(createHash('sha256').update(JSON.stringify(previous)).digest('hex'), readLE1KO2References(readGU1References(readGA2References(readQSCReferences('f58d6113cca7a6e395800ee6e26215edc1864644206696034cd447c1b09d97d8')))),
            'Sophie: vollständige Records mit Personenzuordnung im Jahresbeleg');
        const receipt = JSON.parse(previous.annual_plan_record_v1);
        for (const entry of Object.values(receipt.entries)) for (const outcome of [entry.recommended, entry.adopted])
            for (const source of outcome.action.quellen || []) { delete source.sourceProfileId; delete source.sourceProfileName; }
        previous.annual_plan_record_v1 = JSON.stringify(receipt);
    }
    if (unchanged[household.id]) assertEqual(createHash('sha256').update(JSON.stringify(previous)).digest('hex'), readLE1KO2References(readGU1References(readGA2References(readQSCReferences(readMU1Hash(readAS1Hash(unchanged[household.id])))))),
        `${household.name}: vollständige Musterrecords mit belegter FR-57-Anlage`);
}

function conflictingRecords(household = 'renate') {
    const records = createMusterHaushaltRecords('2026-10-23', household);
    const plan = JSON.parse(records.household_plan_v1);
    for (const entry of Object.values(plan.entries)) Object.assign(entry.values.decumulation,
        { mode: 'standard', bondTargetFactor: 9, drawdownTrigger: 25, bondRefillThreshold: 7 });
    records.household_plan_v1 = JSON.stringify(plan);
    const registry = JSON.parse(records.rs_profiles_v1);
    const template = JSON.parse(createMusterHaushaltRecords('2026-10-23', 'helga-werner').depot_tranchen).find(lot => lot.category === 'gold');
    for (const [id, profile] of Object.entries(registry.profiles)) {
        const tranches = JSON.parse(profile.data.depot_tranchen);
        if (!tranches.some(lot => lot.category === 'gold')) tranches.push({ ...template, trancheId: 'gold-test-' + id });
        profile.data.depot_tranchen = JSON.stringify(tranches);
        profile.data.profile_gold_aktiv = 'false';
        if (id === records.rs_current_profile) {
            records.depot_tranchen = profile.data.depot_tranchen;
            records.profile_gold_aktiv = 'false';
        }
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
}

async function setup(records) {
    const backend = new Map(Object.entries(records)); let writes = 0, fail = false;
    P.resetPersistenceForTests({ name: 'synthetic-asset-strategy', async init() {}, async loadAll() { return Object.fromEntries(backend); },
        async saveBatch(batch) {
            writes++;
            if (fail) { fail = false; throw new Error('Synthetischer Schreibfehler'); }
            for (const key of batch.deletes) backend.delete(key);
            for (const [key, value] of batch.upserts) backend.set(key, value);
        } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const { doc } = createDialogFixture();
    const host = doc.createElement('div'); doc.body.appendChild(host);
    const lifecycle = createNavigationOperationLifecycle({ guard: createNavigationGuard() });
    const refresh = () => renderAssetStrategyWarnings(host, readAssetStrategyWarnings());
    const enable = warning => lifecycle.run({}, navigationOperation => enableAssetStrategy({ ...warning, navigationOperation }));
    bindAssetStrategyWarnings({ doc, enable, refresh });
    refresh();
    const click = async warning => {
        // Die wirklichen Rendererattribute speisen den DOM-Klick und den Produktwriter.
        const attrs = tokenizeHTML(assetStrategyWarningHtml(warning)).elements.find(node => node.tag === 'button').attrs;
        const button = doc.createElement('button');
        for (const [key, value] of Object.entries(attrs)) button.setAttribute(key, value);
        host.appendChild(button); await button.fire('click'); button.remove();
    };
    return { host, refresh, click, backend, writes: () => writes, fail: () => { fail = true; } };
}

try {
    const records = conflictingRecords(), f = await setup(records);
    let warnings = readAssetStrategyWarnings();
    assertEqual(warnings.length, 2, 'Anleihen unter Standard und Gold ohne Allokation warnen gleichzeitig');
    assertEqual(f.writes(), 0, 'Lesen und Anzeigen schalten nichts still um');
    const id = records.rs_current_profile;
    const table = buildTranchenTableHtml(normalizeTranches(JSON.parse(records.depot_tranchen)), { profileId: id, strategyWarnings: warnings });
    assert(table.includes('Für Anleihen braucht die Rechnung die Strategie 3 Töpfe.') && table.includes('Für Gold braucht die Rechnung die Gold-Allokation.'),
        'Beide Warnungen stehen direkt bei den gespeicherten Tranchen');
    const beforeGold = Object.fromEntries(Object.entries(records).filter(([key]) => key.startsWith('profile_gold_')));
    await f.click(warnings.find(warning => warning.kind === 'bonds'));
    const plan = readBalanceHouseholdPlan().entry.values;
    assertEqual(JSON.stringify(plan.decumulation), JSON.stringify({ mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null }),
        'Klick aktiviert 3 Töpfe mit Zielfaktor 5 und Auslöser 15 %');
    assertEqual(plan.floorBedarf, 24000, 'Aktivierung erhält den übrigen Plan');
    assert(!f.host.innerHTML.includes('Für Anleihen'), 'Nach bestätigtem Einschalten verschwindet die Anleihenwarnung');
    for (const [key, value] of Object.entries(beforeGold)) assertEqual(storage.getItem(key), value, 'Strategiewahl erhält Goldvorgabe ' + key);
    await f.click(readAssetStrategyWarnings().find(warning => warning.kind === 'gold'));
    assertEqual(storage.getItem('profile_gold_aktiv'), 'true', 'Gold-Klick aktiviert die persönliche Gold-Allokation');
    for (const [key, value] of Object.entries({ profile_gold_ziel_pct: '7.5', profile_gold_floor_pct: '1', profile_gold_rebal_band: '25', profile_gold_steuerfrei: 'false' }))
        assertEqual(storage.getItem(key), value, 'Gold-Klick ersetzt das bisherige Nullziel durch die normale Vorgabe ' + key);
    assertEqual(JSON.parse(f.backend.get('rs_profiles_v1')).profiles[id].data.profile_gold_aktiv, 'true', 'Gold ist auch im dauerhaft bestätigten Profil aktiv');
    const profile = JSON.parse(f.backend.get('rs_profiles_v1')).profiles[id];
    const inputs = buildSimulatorInputsFromProfileData(profile.data, { referenceYear: 2026, planValues: plan });
    assert(combineSimulatorProfiles([{ profileId: id, name: profile.meta.name, data: profile.data, inputs }], id, { planValues: plan }).combined.goldAktiv,
        'Auch der Simulator übernimmt Gold nach Einschalten aus einem bisherigen Nullziel');
    assert(f.host.hidden, 'Nach beiden Klicks verschwinden sämtliche Warnungen');

    const removed = await setup(conflictingRecords());
    storage.setItem('depot_tranchen', '[]'); removed.refresh();
    assert(removed.host.hidden, 'Ohne Anleihen und Gold verschwinden die Warnungen');
    assertEqual(storage.getItem('profile_gold_aktiv'), 'false', 'Entfernen der Tranchen verändert keine Strategie');

    const householdRecords = conflictingRecords('helga-werner'), household = await setup(householdRecords);
    const partner = readAssetStrategyWarnings().find(warning => warning.kind === 'gold' && warning.profileId !== householdRecords.rs_current_profile);
    await household.click(partner);
    assertEqual(storage.getItem('profile_gold_aktiv'), 'false', 'Partner-Klick lässt Goldwahl der geöffneten Person unverändert');
    assert(!readAssetStrategyWarnings().some(warning => warning.kind === 'gold' && warning.profileId === partner.profileId), 'Goldwarnung des Partners verschwindet');
    const partnerData = JSON.parse(storage.getItem('rs_profiles_v1')).profiles[partner.profileId].data;
    assert(partnerData.profile_gold_ziel_pct === '20' && partnerData.profile_gold_floor_pct === '10' && partnerData.profile_gold_rebal_band === '20',
        'Gold-Klick erhält ein vorhandenes positives Ziel mit Floor und Band');
    const before = storage.getItem('household_plan_v1');
    household.fail();
    let failed = false;
    try { await createNavigationOperationLifecycle({ guard: createNavigationGuard() }).run({}, navigationOperation => enableAssetStrategy({ ...readAssetStrategyWarnings().find(warning => warning.kind === 'bonds'), navigationOperation })); }
    catch { failed = true; }
    assert(failed && storage.getItem('household_plan_v1') === before, 'Fehlgeschlagene Aktivierung erhält den bestätigten Plan und die Warnung');
} finally { P.resetPersistenceRuntimeForTests(); }
