import { CONFIG } from '../balance/balance-config.js';
import { appNow } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { SnapshotArchive, SNAPSHOT_KINDS } from '../shared/snapshot-archive.js';
import { isAllowedSnapshotCaptureKey } from '../shared/persistence-key-policy.js';
import { createNavigationOperationLifecycle } from '../shared/navigation-guard.js';
import { resolveLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';
import { readHouseholdSimulatorNeedsState } from '../simulator/simulator-household-needs-persistence.js';
import { HOUSEHOLD_PLAN_KEY, PLAN_DEFAULTS, PLAN_FIELD_PATHS, assertPlanValues, assertHouseholdPlanRecord,
    buildPlanRecord, canonicalPlan, planScope, plain } from './household-plan.js';

const own = (value, key) => Object.hasOwn(value || {}, key);
export function getPlanField(values, path) { return path.split('.').reduce((value, key) => value?.[key], values); }
export function setPlanField(values, path, value) {
    const keys = path.split('.'), last = keys.pop();
    const host = keys.reduce((item, key) => item[key], values); host[last] = value;
}
function parseState(data) {
    const raw = data?.[CONFIG.STORAGE.LS_KEY];
    if (raw == null) return { value: {}, status: 'missing' };
    try { const value = JSON.parse(raw); if (!plain(value)) throw new Error(); return { value, status: 'present' }; }
    catch { return { value: {}, status: 'unreadable' }; }
}
const missing = (origin = '') => ({ status: 'missing', origin });
function normalizeField(raw, path, origin) {
    try {
        let value = raw;
        if (raw === undefined) return missing(origin);
        const fallback = getPlanField(PLAN_DEFAULTS, path);
        if (typeof fallback === 'number' || path === 'decumulation.bondRefillThreshold') {
            if (raw === null && path === 'decumulation.bondRefillThreshold') value = null;
            else {
                if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()))) throw new Error();
                value = typeof raw === 'number' ? raw : Number(raw.replace(',', '.'));
            }
        } else if (typeof fallback === 'boolean') {
            if (typeof raw === 'boolean') value = raw;
            else if (['true', '1', 'false', '0'].includes(raw)) value = ['true', '1'].includes(raw);
            else throw new Error();
        } else if (path === 'decumulation.mode') {
            value = typeof raw === 'string' ? raw.trim().toLowerCase() : raw;
            if (['dynamic_flex', 'vpw', 'guardrails', 'fixed_real', 'none'].includes(value)) value = 'standard';
        }
        const probe = structuredClone(PLAN_DEFAULTS);
        setPlanField(probe, path, value);
        if (path === 'minimumFlexAnnual') probe.flexBedarf = Math.max(probe.flexBedarf, value);
        assertPlanValues(probe);
        return { status: 'present', value, origin };
    } catch { return { status: 'unreadable', origin, warning: `${path}: gespeicherter Wert ist unlesbar oder ungültig.` }; }
}
function fromInputs(inputs, path, origin) {
    const aliases = path === 'cape.value' ? ['marketCapeRatio', 'capeRatio']
        : path === 'decumulation.mode' ? ['entnahmeStrategie'] : [path];
    if (path === 'liquidityRunwayYears') {
        const legacy = { ...inputs };
        if (!own(legacy, 'runwayTargetMonths') && own(legacy, 'runwayTargetM')) legacy.runwayTargetMonths = legacy.runwayTargetM;
        if (!own(legacy, 'runwayMinMonths') && own(legacy, 'runwayMinM')) legacy.runwayMinMonths = legacy.runwayMinM;
        if (!['liquidityRunwayYears', 'runwayTargetMonths', 'runwayMinMonths'].some(key => own(legacy, key))) return missing(origin);
        return normalizeField(resolveLiquidityRunwayYears(legacy).years, path, origin);
    }
    const direct = getPlanField(inputs, path);
    if (direct !== undefined) return normalizeField(direct, path, origin);
    for (const key of aliases) if (own(inputs, key)) return normalizeField(inputs[key], path, `${origin}.${key}`);
    if (path.startsWith('decumulation.') && own(inputs, path.split('.')[1])) return normalizeField(inputs[path.split('.')[1]], path, origin);
    return missing(origin);
}
function balanceSource(state, path, id) {
    if (state.status === 'unreadable') return { status: 'unreadable', origin: `${id}.Balance`, warning: 'Balance-Rohrecord ist nicht lesbar.' };
    const value = state.value;
    if (path.startsWith('cape.')) {
        const key = { 'cape.value': 'capeRatio', 'cape.asOf': 'capeAsOf', 'cape.source': 'capeSource' }[path];
        if (own(value.capeMeta, key)) return normalizeField(value.capeMeta[key], path, `${id}.capeMeta.${key}`);
        const annual = value.annualMarketDataMeta?.cape;
        if (own(annual, key) || own(annual, path.split('.')[1])) return normalizeField(annual[key] ?? annual[path.split('.')[1]], path, `${id}.annualMarketDataMeta.cape`);
    }
    const shared = fromInputs(value.profilverbundHouseholdInputs || {}, path, `${id}.profilverbundHouseholdInputs`);
    return shared.status !== 'missing' ? shared : fromInputs(value.inputs || {}, path, `${id}.inputs`);
}
function simulatorSource(data, state, path, id) {
    const names = { floorBedarf: 'startFloorBedarf', flexBedarf: 'startFlexBedarf', 'cape.value': 'marketCapeRatio', 'decumulation.mode': 'entnahmeStrategie' };
    const key = `sim_${names[path] || path.split('.').at(-1)}`;
    // Bedarf wird bereits im bisherigen Mitgliedsreader aus Balance bevorzugt.
    if (['floorBedarf', 'flexBedarf', 'minimumFlexAnnual'].includes(path)) {
        const member = fromInputs(state.value.inputs || {}, path, `${id}.inputs`);
        if (member.status === 'present') return member;
    }
    if (path === 'liquidityRunwayYears') {
        const inputs = {};
        for (const name of ['liquidityRunwayYears', 'runwayTargetMonths', 'runwayMinMonths']) if (own(data, `sim_${name}`)) inputs[name] = data[`sim_${name}`];
        return fromInputs(inputs, path, `${id}.Simulator`);
    }
    if (own(data, key)) return normalizeField(data[key], path, `${id}.${key}`);
    if (path.startsWith('cape.') && path !== 'cape.value') return missing(`${id}.Simulator`);
    if (path.startsWith('decumulation.') && own(data, 'decumulation')) {
        let strategy = data.decumulation;
        try { if (typeof strategy === 'string') strategy = JSON.parse(strategy); }
        catch { return { status: 'unreadable', origin: `${id}.decumulation` }; }
        if (getPlanField({ decumulation: strategy }, path) !== undefined) return normalizeField(getPlanField({ decumulation: strategy }, path), path, `${id}.decumulation`);
    }
    // Nur ausdrücklich gespeicherte Fallbackwerte; keine Readerdefaults.
    if (['flexBudgetAnnual', 'flexBudgetYears', 'flexBudgetRecharge', 'cape.value'].includes(path)) return fromInputs(state.value.inputs || {}, path, `${id}.inputs`);
    return missing(`${id}.Simulator`);
}
/** Inventar aus festen bekannten Schlüsseln; niemals UIdefaults oder Summen vergleichen. */
export function analyzeHouseholdPlanMigration(records) {
    const registry = JSON.parse(records.rs_profiles_v1 || 'null');
    if (!plain(registry?.profiles)) throw new Error('Profilbestand für die Planumstellung fehlt.');
    const activeId = records.rs_active_profile || records.rs_current_profile;
    const ids = Object.keys(registry.profiles);
    const members = ids.filter(id => registry.profiles[id].meta.belongsToHousehold !== false);
    const scopes = [...(members.length ? [planScope('household', members)] : []), ...ids.filter(id => !members.includes(id)).map(id => planScope('single', [id]))];
    const existing = records[HOUSEHOLD_PLAN_KEY] == null ? { version: 1, entries: {} } : assertHouseholdPlanRecord(records[HOUSEHOLD_PLAN_KEY]);
    const override = readHouseholdSimulatorNeedsState({ getItem: key => records[key] ?? null });
    const analyses = [];
    for (const scope of scopes) {
        if (existing.entries[scope.key]) continue;
        // Eine eindeutige frühere Haushaltsquelle darf eine neue Mitgliedschaft begleiten.
        const predecessors = scope.kind === 'household' ? Object.values(existing.entries).filter(entry => entry.scope.kind === 'household'
            && entry.scope.ids.some(id => scope.ids.includes(id))) : [];
        if (predecessors.length && new Set(predecessors.map(entry => canonicalPlan(entry.values))).size === 1) {
            analyses.push({ scope, sourceId: members[0], fields: [], values: structuredClone(predecessors[0].values), conflicts: [], warnings: [] }); continue;
        }
        const ordered = scope.kind === 'household' ? members : scope.ids;
        const sourceId = ordered[0];
        const dataFor = id => id === activeId ? { ...registry.profiles[id].data, ...Object.fromEntries(Object.entries(records).filter(([key]) => key !== 'rs_profiles_v1')) } : registry.profiles[id].data;
        const data = dataFor(sourceId), state = parseState(data);
        // Diese Metadaten liegen ausdrücklich global; fremde Personeninputs bleiben ausgeschlossen.
        if (scope.kind === 'household') {
            const live = parseState(records).value;
            for (const key of ['capeMeta', 'annualMarketDataMeta']) if (own(live, key)) state.value[key] = live[key];
        }
        const values = structuredClone(PLAN_DEFAULTS), fields = [], warnings = [];
        for (const path of PLAN_FIELD_PATHS) {
            let balance = balanceSource(state, path, sourceId);
            let simulator = simulatorSource(data, state, path, sourceId);
            if (simulator.status === 'missing' && ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual'].includes(path)) {
                for (const id of ordered.slice(1)) {
                    const other = dataFor(id), found = simulatorSource(other, parseState(other), path, id);
                    if (found.status === 'present') { simulator = found; break; }
                }
            }
            const overrideName = { floorBedarf: 'startFloorBedarf', flexBedarf: 'startFlexBedarf', minimumFlexAnnual: 'minimumFlexAnnual' }[path];
            if (scope.kind === 'household' && override.status === 'valid' && override.overriddenFields.includes(overrideName)) simulator = normalizeField(override.values[overrideName], path, 'household_simulator_needs_v1');
            if (path === 'householdWithdrawalMode' && scope.kind === 'household' && own(records, 'household_withdrawal_mode')) {
                balance = normalizeField(records.household_withdrawal_mode, path, 'household_withdrawal_mode'); simulator = missing();
            }
            for (const source of [balance, simulator]) if (source.status === 'unreadable') warnings.push(source.warning || `${path}: ${source.origin} ist unlesbar.`);
            const conflict = balance.status === 'present' && simulator.status === 'present' && canonicalPlan(balance.value) !== canonicalPlan(simulator.value);
            const selected = balance.status === 'present' ? balance.value : simulator.status === 'present' ? simulator.value : getPlanField(PLAN_DEFAULTS, path);
            setPlanField(values, path, selected);
            fields.push({ path, balance, simulator, conflict, selected });
        }
        if (scope.kind === 'household' && override.warning) warnings.push(override.warning);
        const coupledFields = values.minimumFlexAnnual > values.flexBedarf ? ['flexBedarf', 'minimumFlexAnnual'] : [];
        analyses.push({ scope, sourceId, values, fields, conflicts: fields.filter(field => field.conflict), warnings, coupledFields });
    }
    return { analyses, activeId, existing };
}
export function chooseMigrationValues(analysis, selections = {}) {
    const values = structuredClone(analysis.values);
    const corrections = selections.corrections || {};
    if (!plain(corrections) || Object.keys(corrections).some(path => !analysis.coupledFields?.includes(path))) throw new Error('Ungültige Korrektur gekoppelter Planwerte.');
    for (const field of analysis.conflicts) {
        if (own(corrections, field.path)) continue;
        const selection = selections[field.path] || 'balance';
        if (!['balance', 'simulator'].includes(selection)) throw new Error('Ungültige Quellenauswahl.');
        setPlanField(values, field.path, field[selection].value);
    }
    for (const [path, value] of Object.entries(corrections)) setPlanField(values, path, value);
    assertPlanValues(values);
    return values;
}
/** Kopien und Muster: derselbe Normalisierer, ausschließlich im geschützten Rohbestand. */
export function addDirectHouseholdPlans(records, { now = appNow } = {}) {
    const result = { ...records };
    if (!records.rs_profiles_v1) return result;
    const analyzed = analyzeHouseholdPlanMigration(records);
    // Keine stillen Ersatzwerte und kein Teilplan: Die geschützte Kopie bleibt
    // startfähig und klärt diese Altwerte beim nächsten Seitenstart im Dialog.
    if (analyzed.analyses.some(analysis => analysis.coupledFields?.length)) return result;
    const next = buildPlanRecord(records[HOUSEHOLD_PLAN_KEY], analyzed.analyses.map(analysis => ({ scope: analysis.scope, values: chooseMigrationValues(analysis) })), { now });
    if (next.changed) result[HOUSEHOLD_PLAN_KEY] = next.raw;
    return result;
}
const flights = new WeakMap();
/** Vorflush → bytegleicher Archivreadback → optimistisch geschützter Planwrite. */
export function migrateHouseholdPlans({ storage = persistenceStorage, persistence = PersistenceFacade, archive = SnapshotArchive,
    choose, guard = null, now = appNow, isBlocked = () => PersistenceFacade.hasSyncWriteBlocks() || Boolean(globalThis.window?.__profileRecoveryBlocker) } = {}) {
    if (flights.has(storage)) return flights.get(storage);
    const capture = () => Object.fromEntries(Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(isAllowedSnapshotCaptureKey).map(key => [key, storage.getItem(key)]));
    const job = createNavigationOperationLifecycle({ guard, message: 'Planungsdaten werden zusammengeführt – bitte warten.' }).run({}, async operation => {
        const before = capture(), identity = canonicalPlan(before);
        const check = () => { operation.check(); if (isBlocked() || canonicalPlan(capture()) !== identity) throw new Error('Quellen oder Profilbereich haben sich geändert. Bitte erneut starten.'); };
        check();
        const analyzed = analyzeHouseholdPlanMigration(before);
        if (!analyzed.analyses.length) return { status: 'unchanged' };
        const entries = [];
        for (const analysis of analyzed.analyses) {
            let selections = {};
            if (analysis.conflicts.length || analysis.coupledFields?.length) {
                if (!choose) return { status: 'deferred' };
                selections = await choose(analysis, { signal: operation.controller.signal });
                check(); if (selections === null) return { status: 'deferred' };
            }
            entries.push({ scope: analysis.scope, values: chooseMigrationValues(analysis, selections) });
        }
        if (await persistence.flush({ navigationOperation: operation }) === false) throw new Error('PERSISTENCE_FLUSH_FAILED');
        check();
        const persisted = await persistence.readPersistedRecords(isAllowedSnapshotCaptureKey);
        check(); if (canonicalPlan(persisted) !== identity) throw new Error('Ausgangsbestand ist nicht dauerhaft bestätigt.');
        const snapshot = await archive.createSnapshot({ label: 'Vor Umstellung Haushalt & Plan', kind: SNAPSHOT_KINDS.householdPlanMigrationRecovery,
            activeProfileId: analyzed.activeId, records: before, createdAt: now().toISOString() }, { storage: persistence, navigationOperation: operation, guard });
        check();
        const verified = await archive.readSnapshot(snapshot.id, { storage: persistence });
        check(); if (canonicalPlan(verified) !== canonicalPlan(snapshot) || canonicalPlan(verified.records) !== identity) throw new Error('Wiederherstellungspunkt wurde nicht bytegleich bestätigt.');
        const next = buildPlanRecord(before[HOUSEHOLD_PLAN_KEY], entries, { now });
        let writing = false, rollingBack = false;
        const transaction = { ...operation, check() {
            operation.check();
            const current = capture();
            if (rollingBack) {
                // Der Rollback betrifft ausschließlich unseren Planwrite. Ein inzwischen
                // gewechselter Profilkontext darf die Rücknahme nicht verhindern;
                // ein fremder neuer Plan darf dagegen niemals zurückgesetzt werden.
                if (current[HOUSEHOLD_PLAN_KEY] !== next.raw && current[HOUSEHOLD_PLAN_KEY] !== before[HOUSEHOLD_PLAN_KEY]) throw new Error('Planumstellung: fremder Planwrite verhindert Rücknahme.');
                return;
            }
            if (writing && current[HOUSEHOLD_PLAN_KEY] === next.raw) {
                if (before[HOUSEHOLD_PLAN_KEY] === undefined) delete current[HOUSEHOLD_PLAN_KEY]; else current[HOUSEHOLD_PLAN_KEY] = before[HOUSEHOLD_PLAN_KEY];
            }
            if (canonicalPlan(current) !== identity || isBlocked()) {
                rollingBack = writing;
                throw new Error('Planumstellung: Kontext geändert.');
            }
        }, commit() { this.check(); writing = true; operation.commit(); } };
        try {
            await persistence.replaceRecordsTransactional({ [HOUSEHOLD_PLAN_KEY]: next.raw }, { probelaufDomainWrite: true, navigationOperation: transaction,
                allowKey: key => key === HOUSEHOLD_PLAN_KEY, expectedRecords: before[HOUSEHOLD_PLAN_KEY] === undefined ? {} : { [HOUSEHOLD_PLAN_KEY]: before[HOUSEHOLD_PLAN_KEY] },
                postValidate: actual => { transaction.check(); assertHouseholdPlanRecord(actual[HOUSEHOLD_PLAN_KEY]); } });
        } catch (error) {
            if (error.code === 'rollback_failed') persistence.blockSyncWrites?.([...Object.keys(before), HOUSEHOLD_PLAN_KEY],
                'Planumstellung und Rücknahme unbestätigt. Bitte neu laden und den Punkt „Vor Umstellung Haushalt & Plan“ wiederherstellen.', { predicate: isAllowedSnapshotCaptureKey });
            throw error;
        }
        return { status: 'migrated', snapshotId: snapshot.id };
    });
    flights.set(storage, job);
    return job.finally(() => flights.delete(storage));
}
