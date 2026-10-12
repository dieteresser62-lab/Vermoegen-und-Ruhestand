import { CONFIG } from '../app/balance/balance-config.js';
import { OVERVIEW_SIMULATION_KEY, FINGERPRINT_VERSION, sourceFingerprint, projectSimulationSummaries, assertSimulationRecord, fingerprint, simulationEntryKey } from '../app/overview/overview-simulation-summary.js';
import { overviewScope, storeSimulationSummary } from '../app/overview/overview-storage.js';
import { buildSimulationSummary } from '../app/simulator/simulator-overview-summary.js';
import { validatePersistenceDomainRecords, buildFullPersistenceBackup, normalizeFullPersistenceBackup } from '../app/shared/persistence-backup.js';
import { isAllowedSnapshotCaptureKey, isAllowedPersistenceImportKey } from '../app/shared/persistence-key-policy.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../app/profile/profile-state.js';
const data = { profile_tagesgeld: '100', depot_tranchen: '[]', [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 20, flexBedarf: 10 } }),
    sim_dynamicFlex: 'false', sim_pflegefallLogikAktivieren: 'false', sim_mcAnzahl: '10' };
const registry = { version: 1, profiles: { a: { meta: { name: 'A', belongsToHousehold: true }, data: { ...data } },
    b: { meta: { name: 'B', belongsToHousehold: true }, data: { ...data, profile_tagesgeld: '200' } } } };
const scope = overviewScope('household', ['b', 'a']);
const ctx = { registry, activeId: 'a', liveData: { ...data }, scope, kind: 'montecarlo' };
const source = sourceFingerprint(ctx);
assert(/^[a-f0-9]{64}$/.test(source), 'Quellenbasis ist kanonischer SHA-256');
const reversed = value => Object.fromEntries(Object.entries(value).reverse());
assertEqual(sourceFingerprint({ ...ctx, liveData: reversed(data), registry: { ...registry, profiles: reversed(registry.profiles) } }), source, 'Schlüsselreihenfolge/Reload ändern Fingerabdruck nicht');
const renamed = structuredClone(registry); renamed.profiles.a.meta.name = '<img onerror=bad>';
assertEqual(sourceFingerprint({ ...ctx, registry: renamed }), source, 'Profilname ändert Gültigkeit nicht');
for (const changes of [{ sim_mcWorkerCount: '99' }, { sim_dynamicFlexShowAdvanced: 'true' }, { sim_pflegeMaxFloor: '9000' }, { sim_horizonYears: '70' }, { logDetailLevel: 'full' }])
    assertEqual(sourceFingerprint({ ...ctx, liveData: { ...data, ...changes } }), source, 'Dormante oder technische Annahme bleibt ausgeschlossen: ' + Object.keys(changes)[0]);
for (const changes of [{ profile_tagesgeld: '200' }, { sim_mcAnzahl: '20' }, { sim_pflegefallLogikAktivieren: 'true' },
    { [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 21, flexBedarf: 10 } }) }]) {
    assert(sourceFingerprint({ ...ctx, liveData: { ...data, ...changes } }) !== source, 'Wirksame Änderung macht Ergebnis veraltet: ' + Object.keys(changes)[0]);
}
const btSource = sourceFingerprint({ ...ctx, kind: 'backtest' });
assertEqual(sourceFingerprint({ ...ctx, kind: 'backtest', liveData: { ...data, sim_mcAnzahl: '20' } }), btSource, 'MC-Einstellungen machen Backtest nicht veraltet');
const balanceSource = sourceFingerprint({ ...ctx, kind: 'balance' });
assertEqual(sourceFingerprint({ ...ctx, kind: 'balance', liveData: { ...data, sim_pflegefallLogikAktivieren: 'true' } }), balanceSource, 'Simulatorpflege verändert Balance-Schrittgrundlage nicht');
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...data, depot_tranchen: '{kaputt' } }), null, 'Beschädigte Quellen liefern keine aktuelle Ausgangsbasis');
const context = { kind: 'montecarlo', scope, sourceFingerprint: source, runFingerprint: fingerprint({ synthetic: true }), fingerprintVersion: FINGERPRINT_VERSION, deviationApplied: false };
const completedAt = new Date('2026-10-06T12:00:00Z');
const population = [0, 0, 10, 100];
const result = { outcomeInventory: { schemaVersion: 'MonteCarloOutcomeInventoryV1', requestedRuns: 4, ruin: 1, all_dead: 1, horizon_exhausted: 2, technical_error: 0, floorCoveragePct: 75 },
    finalOutcomes: { distribution: { values: population } } };
const summary = buildSimulationSummary(context, result, { requestedRuns: 4, completedAt });
assertEqual(summary.metrics.median, 5, 'Median der kompletten Population einschließlich Ruin und erfolgreicher Nullendwerte');
assertEqual(summary.metrics.p5, 0, 'Unabhängiges P5-Orakel einschließlich Nullwerte');
assertEqual(summary.metrics.covered, 3, 'Erfolg folgt all_dead plus horizon_exhausted');
assertEqual(summary.metrics.successPct, 75, 'Erfolgsanteil stammt unverändert aus Outcomeinventar');
assertEqual(population.join(','), '0,0,10,100', 'Quantilbildung mutiert Rohpopulation nicht');
const missing = buildSimulationSummary(context, { ...result, finalOutcomes: { distribution: { values: [1, 2] } } });
assertEqual(missing.metrics.median, null, 'Fehlende Endbeobachtungen erfinden keinen Median');
assertEqual(buildSimulationSummary(context, { ...result, batchStatus: 'technical_error' }), null, 'Technischer Batch ersetzt keinen Erfolg');
assertEqual(buildSimulationSummary(context, { ...result, outcomeInventory: { ...result.outcomeInventory, horizon_exhausted: 1 } }), null, 'Unvollständiges Outcomeinventar ersetzt keinen Erfolg');
const backtest = buildSimulationSummary({ ...context, kind: 'backtest', sourceFingerprint: btSource }, { request: { startYear: 2000, endYear: 2005 }, outcome: { kind: 'ruin' }, ruinYear: 2003, metrics: { values: { wealth_end_real_eur: 12.5 } } }, { completedAt });
assertEqual(backtest.metrics.endWealthReal, 12.5, 'Backtest verwendet kanonisches reales Endvermögen');
assertEqual(backtest.metrics.failureYear, 2003, 'Finanzieller Ruin wird als abgeschlossenes Ergebnis gespeichert');
assertEqual(buildSimulationSummary({ ...context, kind: 'backtest' }, { outcome: { kind: 'incomplete' } }), null, 'Incomplete ist kein Backtesterfolg');
const workshop = { variantOrder: ['baseline', 'v1', 'v2'], variants: [{ variantId: 'baseline', label: 'Baseline' }, { variantId: 'v1', label: 'Erste', terminalStatus: 'ruin', summary: { finalValueRealEur: 0 } }, { variantId: 'v2', label: '<img onerror=bad>', terminalStatus: 'horizon_exhausted', summary: { finalValueRealEur: 20 } }], pairwise: [{ variantId: 'v1', comparable: true }, { variantId: 'v2', comparable: true }] };
assert(buildSimulationSummary({ ...context, kind: 'workshop' }, workshop).statement.includes('<img onerror=bad>'), 'Variantenname bleibt Text und wird erst bei Ausgabe escaped');
assert(buildSimulationSummary({ ...context, kind: 'workshop' }, workshop, { preferredVariantId: 'v1' }).statement.includes('Erste'), 'Zuletzt bearbeitete erfolgreiche Alternative hat Vorrang');
assertEqual(buildSimulationSummary({ ...context, kind: 'workshop' }, { variantOrder: ['baseline'], variants: workshop.variants, pairwise: [] }), null, 'Baseline-only ist kein Vergleichserfolg');
const encoded = item => JSON.stringify({ version: 1, entries: { [simulationEntryKey(scope, item.kind)]: item } });
const raw = encoded(summary);
assertSimulationRecord(raw);
const storedRegistry = structuredClone(registry); for (const profile of Object.values(storedRegistry.profiles)) profile.data[OVERVIEW_SIMULATION_KEY] = raw;
let projected = projectSimulationSummaries({ ...ctx, registry: storedRegistry, liveData: { ...data, [OVERVIEW_SIMULATION_KEY]: raw } });
assertEqual(projected.montecarlo.entry.metrics.runs, 4, 'Haushalt liest Ergebnis einmal ohne Addition');
assertEqual(projected.montecarlo.stale, false, 'Identische Quellen sind aktuell');
projected = projectSimulationSummaries({ ...ctx, registry: storedRegistry, liveData: { ...data, profile_tagesgeld: '101', [OVERVIEW_SIMULATION_KEY]: raw } });
assertEqual(projected.montecarlo.stale, true, 'Nachträgliche Bestandsänderung ist veraltet');
assert(isAllowedSnapshotCaptureKey(OVERVIEW_SIMULATION_KEY) && isAllowedPersistenceImportKey(OVERVIEW_SIMULATION_KEY) && PROFILE_SCOPED_FIXED_KEYS.includes(OVERVIEW_SIMULATION_KEY), 'Neuer fester Schlüssel gehört in beide Sicherungskataloge');
function storageFixture(reg = registry) {
    const map = new Map([['rs_current_profile', 'a'], ['rs_active_profile', 'a'], ['rs_profiles_v1', JSON.stringify(reg)], ...Object.entries(data)]);
    return { map, storage: { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), key: i => [...map.keys()][i] ?? null, get length() { return map.size; } } };
}
const deps = storage => ({ storage, flush: async () => true, guard: null, isBlocked: () => false, expectedProfileId: 'a' });
{
    const { storage, map } = storageFixture();
    assertEqual(await storeSimulationSummary(summary, deps(storage)), true, 'Haushaltssummary wird dauerhaft bestätigt');
    assertEqual(JSON.parse(map.get('rs_profiles_v1')).profiles.b.data[OVERVIEW_SIMULATION_KEY], map.get(OVERVIEW_SIMULATION_KEY), 'Identischer Haushaltswert in Mitglied und Livebestand');
    const stateBefore = map.get(CONFIG.STORAGE.LS_KEY);
    await storeSimulationSummary(backtest, deps(storage));
    assertEqual(Object.keys(JSON.parse(map.get(OVERVIEW_SIMULATION_KEY)).entries).length, 2, 'Je Art ein kompakter letzter Eintrag');
    assertEqual(map.get(CONFIG.STORAGE.LS_KEY), stateBefore, 'Ergebnisablage verändert keinen Fachstate');
    const backup = buildFullPersistenceBackup({ storage });
    assertEqual(normalizeFullPersistenceBackup(backup).ok, true, 'Vollbackup-Roundtrip bleibt lesbar');
}
for (const failure of ['flush', 'switch', 'membership', 'newer']) {
    const { storage, map } = storageFixture(storedRegistry); map.set(OVERVIEW_SIMULATION_KEY, raw);
    const candidate = { ...summary, completedAt: '2026-10-07T12:00:00Z' };
    let flushes = 0;
    const newer = { ...summary, completedAt: '2026-10-08T12:00:00Z' };
    const options = { ...deps(storage), flush: async () => {
        if (++flushes !== 2) return true;
        if (failure === 'switch') map.set('rs_current_profile', 'b');
        if (failure === 'membership') { const current = JSON.parse(map.get('rs_profiles_v1')); current.profiles.b.meta.belongsToHousehold = false; map.set('rs_profiles_v1', JSON.stringify(current)); }
        if (failure === 'newer') { map.set(OVERVIEW_SIMULATION_KEY, encoded(newer)); const current = JSON.parse(map.get('rs_profiles_v1')); for (const profile of Object.values(current.profiles)) profile.data[OVERVIEW_SIMULATION_KEY] = encoded(newer); map.set('rs_profiles_v1', JSON.stringify(current)); }
        return false;
    } };
    let failed = false; try { await storeSimulationSummary(candidate, options); } catch { failed = true; }
    assert(failed, failure + ': kein dauerhaft bestätigter Kandidat');
    assertEqual(JSON.parse(map.get(OVERVIEW_SIMULATION_KEY)).entries[simulationEntryKey(scope, 'montecarlo')].completedAt, failure === 'newer' ? newer.completedAt : summary.completedAt, failure + ': bedingter Rollback bewahrt vorherige beziehungsweise fremde neuere Werte');
}
{
    const { storage, map } = storageFixture(); map.set('rs_current_profile', 'b');
    assertEqual(await storeSimulationSummary(summary, deps(storage)), false, 'Falsche Identität vor dem Write abgewiesen');
    map.set('rs_current_profile', 'a'); const changed = structuredClone(registry); changed.profiles.b.meta.belongsToHousehold = false; map.set('rs_profiles_v1', JSON.stringify(changed));
    assertEqual(await storeSimulationSummary(summary, deps(storage)), false, 'Falsche Mitgliedschaft vor dem Write abgewiesen');
    assertEqual(map.has(OVERVIEW_SIMULATION_KEY), false, 'Abgewiesener Kontext schreibt nichts');
}
{
    const { storage, map } = storageFixture(storedRegistry);
    const records = Object.fromEntries(map);
    assertEqual(validatePersistenceDomainRecords(records).ok, true, 'Neue gültige Records werden vor Import akzeptiert');
    const invalid = structuredClone(storedRegistry); invalid.profiles.b.data[OVERVIEW_SIMULATION_KEY] = raw.replace('"median":5', '"median":"kaputt"');
    assertEqual(validatePersistenceDomainRecords({ ...records, rs_profiles_v1: JSON.stringify(invalid) }).ok, false, 'Ungültiger Record in inaktivem Profil wird vor Importwrites abgewiesen');
    for (const profile of Object.values(invalid.profiles)) delete profile.data[OVERVIEW_SIMULATION_KEY];
    assertEqual(validatePersistenceDomainRecords({ ...records, rs_profiles_v1: JSON.stringify(invalid) }).ok, true, 'Alte Backups ohne neuen Schlüssel bleiben lesbar');
}

const capeData = { ...data, sim_useCapeSampling: 'true', sim_mcStartYearMode: 'FILTER', sim_mcStartYearFilter: '1940-1960', sim_mcStartYearHalfLife: '10' };
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...capeData, sim_mcStartYearMode: 'RECENCY', sim_mcStartYearFilter: '2000', sim_mcStartYearHalfLife: '20' } }), sourceFingerprint({ ...ctx, liveData: capeData }), 'Dormante Startjahroptionen bei CAPE-Sampling ändern Gültigkeit nicht');
const careData = { ...data, sim_pflegefallLogikAktivieren: 'true', sim_pflegeKostenDrift: '2' };
assert(sourceFingerprint({ ...ctx, liveData: { ...careData, sim_pflegeKostenDrift: '3' } }) !== sourceFingerprint({ ...ctx, liveData: careData }), 'Wirksame Pflegekostendrift macht MC veraltet');
const longevityData = { ...data, sim_dynamicFlex: 'true', sim_longevityMode: 'relative_horizon_buffer', sim_longevityRelativePct: '.05' };
assert(sourceFingerprint({ ...ctx, liveData: { ...longevityData, sim_longevityRelativePct: '.1' } }) !== sourceFingerprint({ ...ctx, liveData: longevityData }), 'Wirksamer relativer Langlebigkeitspuffer bleibt Fingerprintbestandteil');
const quoteData = { ...data, depot_tranchen: JSON.stringify([{ trancheId: 'q', shares: 2, currentPrice: 10, name: 'Alt' }]) };
assert(sourceFingerprint({ ...ctx, liveData: { ...quoteData, depot_tranchen: JSON.stringify([{ trancheId: 'q', shares: 2, currentPrice: 11, name: 'Alt' }]) } }) !== sourceFingerprint({ ...ctx, liveData: quoteData }), 'Wirksame Quote verändert Ausgangsbasis');
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...quoteData, depot_tranchen: JSON.stringify([{ trancheId: 'q', shares: 2, currentPrice: 10, name: 'Neu', asOf: 1791280740 }]) } }), sourceFingerprint({ ...ctx, liveData: quoteData }), 'Tranchenname und gleicher Kurs mit neuem Abrufzeitpunkt sind technische Metadaten');
const taxData = { ...data, profile_kirchensteuer_pct: '8' };
assert(sourceFingerprint({ ...ctx, liveData: { ...taxData, profile_kirchensteuer_pct: '9' } }) !== sourceFingerprint({ ...ctx, liveData: taxData }), 'Wirksame Personensteuerannahme macht Ergebnis veraltet');
const needs = { schemaVersion: 1, mode: 'override', source: 'manual', overriddenFields: ['startFloorBedarf'], values: { startFloorBedarf: '100' } };
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...data, household_simulator_needs_v1: JSON.stringify(needs) } }), sourceFingerprint({ ...ctx, liveData: { ...data, household_simulator_needs_v1: JSON.stringify({ ...needs, source: 'legacy_single', updatedAt: 'anderer Zeitpunkt' }) } }), 'Haushaltsbedarf hasht effektive Werte statt Migrations-/Sicherungsmetadaten');
const { captureCurrentRecords, buildSnapshot, validateSnapshot } = await import('../app/shared/snapshot-archive.js');
const capture = captureCurrentRecords({ keys: [OVERVIEW_SIMULATION_KEY, 'overview_last_full_backup_v1'], getItem: key => key === OVERVIEW_SIMULATION_KEY ? raw : '2026-10-06T12:00:00Z' });
const snapshot = buildSnapshot({ id: 'synthetic-overview-snapshot', records: capture, activeProfileId: 'a', createdAt: '2026-10-06T12:00:00Z' });
assertEqual(validateSnapshot(JSON.parse(JSON.stringify(snapshot))).records[OVERVIEW_SIMULATION_KEY], raw, 'Tatsächlicher Snapshotcapture und serialisierter Snapshot erhalten Summarybytes');
assertEqual(Object.hasOwn(snapshot.records, 'overview_last_full_backup_v1'), false, 'Fachlicher Snapshot ersetzt keinen globalen Vollsicherungszeitpunkt');

// Aktive Drei-Töpfeparameter und der globale bereichsbezogene Plan.
const { PLAN_DEFAULTS, HOUSEHOLD_PLAN_KEY, buildPlanRecord } = await import('../app/profile/household-plan.js');
for (const strategy of ['standard', '3_bucket_jilge']) {
    const base = { ...data, sim_entnahmeStrategie: strategy, sim_bondTargetFactor: '5', sim_drawdownTrigger: '15', sim_bondRefillThreshold: '10' };
    const baseFp = sourceFingerprint({ ...ctx, liveData: base });
    for (const [field, value] of [['bondTargetFactor', '6'], ['drawdownTrigger', '16'], ['bondRefillThreshold', '11']]) {
        const changed = sourceFingerprint({ ...ctx, liveData: { ...base, [`sim_${field}`]: value } });
        assertEqual(changed !== baseFp, strategy === '3_bucket_jilge', 'Drei-Töpfeparameter nur bei aktiver Strategie wirksam: ' + field);
    }
}
const plan = buildPlanRecord(null, [{ scope, values: structuredClone(PLAN_DEFAULTS) }], { now: () => new Date('2026-10-09') });
const plannedData = { ...data, [HOUSEHOLD_PLAN_KEY]: plan.raw };
const planFp = sourceFingerprint({ ...ctx, liveData: plannedData });
const timestamp = structuredClone(plan.record); timestamp.entries[scope.key].updatedAt = '2027-01-01T00:00:00Z';
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...plannedData, [HOUSEHOLD_PLAN_KEY]: JSON.stringify(timestamp) } }), planFp, 'Bloßer Zeitstempelwechsel macht Ergebnis nicht veraltet');
const capeLabel = structuredClone(plan.record); capeLabel.entries[scope.key].values.cape.source = 'synthetische Quelle';
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...plannedData, [HOUSEHOLD_PLAN_KEY]: JSON.stringify(capeLabel) } }), planFp, 'CAPE-Quellenlabel ist kein Rechenparameter');
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...plannedData, sim_startFloorBedarf: '999', household_withdrawal_mode: 'runway_first', household_simulator_needs_v1: '{kaputt', [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 99999, flexBedarf: 2 } }) } }), planFp, 'Veraltete Altplanquellen beeinflussen bestätigten Bereich nicht');
const changedPlan = structuredClone(plan.record); changedPlan.entries[scope.key].values.floorBedarf++;
assert(sourceFingerprint({ ...ctx, liveData: { ...plannedData, [HOUSEHOLD_PLAN_KEY]: JSON.stringify(changedPlan) } }) !== planFp, 'Wirksame Planänderung macht Ergebnis veraltet');
const other = overviewScope('single', ['outside']);
const otherPlan = buildPlanRecord(plan.raw, [{ scope: other, values: { ...structuredClone(PLAN_DEFAULTS), floorBedarf: 999 } }]);
assertEqual(sourceFingerprint({ ...ctx, liveData: { ...plannedData, [HOUSEHOLD_PLAN_KEY]: otherPlan.raw } }), planFp, 'Anderer Planbereich macht Haushalt nicht veraltet');
for (const field of ['bondTargetFactor', 'drawdownTrigger', 'bondRefillThreshold']) {
    const activePlan = structuredClone(plan.record); activePlan.entries[scope.key].values.decumulation.mode = '3_bucket_jilge'; activePlan.entries[scope.key].values.decumulation.bondRefillThreshold = 10;
    const before = sourceFingerprint({ ...ctx, liveData: { ...plannedData, [HOUSEHOLD_PLAN_KEY]: JSON.stringify(activePlan) } });
    activePlan.entries[scope.key].values.decumulation[field]++;
    assert(sourceFingerprint({ ...ctx, liveData: { ...plannedData, [HOUSEHOLD_PLAN_KEY]: JSON.stringify(activePlan) } }) !== before, 'Gemeinsamer aktiver Drei-Töpfeparameter wirkt: ' + field);
}

// Die vorhandene Einzelanzeige verwendet single auch für einen Ein-Personen-Haushalt.
const loneRegistry = { version: 1, profiles: { a: registry.profiles.a } };
const loneScope = overviewScope('single', ['a']);
const lonePlan = buildPlanRecord(null, [{ scope: overviewScope('household', ['a']), values: structuredClone(PLAN_DEFAULTS) }]);
const loneData = { ...data, [HOUSEHOLD_PLAN_KEY]: lonePlan.raw };
const loneContext = { ...ctx, registry: loneRegistry, scope: loneScope, liveData: loneData, kind: 'balance' };
const loneFp = sourceFingerprint(loneContext);
assert(/^[a-f0-9]{64}$/.test(loneFp), 'Ein-Personen-Haushalt hat gültige Planquelle');
assertEqual(sourceFingerprint({ ...loneContext, liveData: { ...loneData, [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: { floorBedarf: 9999, flexBedarf: 1 } }) } }), loneFp, 'Einzelanzeige ignoriert ebenfalls veraltete Planwertkopien');
const loneChanged = structuredClone(lonePlan.record);
loneChanged.entries[overviewScope('household', ['a']).key].values.flexBedarf++;
assert(sourceFingerprint({ ...loneContext, liveData: { ...loneData, [HOUSEHOLD_PLAN_KEY]: JSON.stringify(loneChanged) } }) !== loneFp, 'Wirksamer Einzelhaushaltsplan macht Balanceanzeige veraltet');
