import nodeAssert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measurementInputs, hash } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { readPartnership, hasTestament, inheritsHomeAndTax, inheritancePreview, PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { BMF_LIFETIME_USE_2026 } from '../app/shared/bmf-lifetime-use-2026.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { renderManagerPartnership, bindManagerPartnership } from '../app/tranches/tranchen-manager-partnership.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { normalizeFullPersistenceBackup, importFullPersistenceBackup, FULL_BACKUP_TYPE, FULL_BACKUP_APP_ID, FULL_BACKUP_SCHEMA_VERSION } from '../app/shared/persistence-backup.js';
import { applyUnmarriedInheritance } from '../app/simulator/simulator-inheritance.js';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';

const selected = n => !process.env.AR1B_CASE || process.env.AR1B_CASE === String(n);
const rule = { minimum: 200000, minimumStand: '2026-10', maximumPercent: 50, home: 'residence', residenceTax: 'annual' };
const legacy = { schemaVersion: 1, status: 'unmarried', inheritance: { a: 33 }, homeAndTaxInheritance: { a: true }, testament: { a: rule } };
const close = (a, b) => nodeAssert.ok(Math.abs(a - b) < .001, `${a} ≠ ${b}`);
const preview = (p, homes = true) => inheritancePreview(600000, homes ? 600000 : 0, p.inheritance.a,
    { cash: 600000, partnerAge: 70, partnerGender: 'm', homeAndTax: inheritsHomeAndTax(p, 'a', homes),
        ...(hasTestament(p, 'a', homes) ? { testament: p.testament.a } : {}), selfUsedHome: homes ? 600000 : 0 });
function editorFixture(records, homes = [{ nutzung: 'selbst', wert: 600000 }]) {
    const nodes = Object.fromEntries(['managerPartnership', 'managerPartnershipStatus', 'managerPartnershipRetry', 'managerInheritance', 'managerPartnershipMarried',
        'managerPartnershipToggle', 'managerPartnershipBody', 'managerPartnershipSummary', 'managerPartnershipAction'].map(id => [id,
        { textContent: '', innerHTML: '', listeners: {}, setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; }, querySelectorAll() { return []; } }]));
    const doc = { getElementById: id => nodes[id] || null, querySelectorAll() { return []; }, addEventListener() {} };
    const projection = { profiles: ['a', 'b'].map((id, index) => ({ id, name: id, valid: true, belongs: true, assets: 600000,
        values: { alter: 70, geschlecht: 'm', tagesgeld: 600000, immobilien: index ? [] : homes } })) };
    renderManagerPartnership(doc, projection);
    const editor = bindManagerPartnership(doc, { runOperation: execute => execute({ check() {}, commit() {} }) });
    const toggle = async checked => {
        const checkbox = { checked, dataset: { inheritanceHome: 'a' } };
        nodes.managerPartnership.listeners.change({ target: { closest: selector => selector === '[data-inheritance-home]' ? checkbox : null } });
        nodeAssert.ok(await editor.flush());
        return readPartnership(records[PARTNERSHIP_KEY]);
    };
    const editRule = async () => {
        const fields = Object.fromEntries(Object.entries({ minimum: '200000', minimumStand: '10/2026', maximumPercent: '50', home: 'money' })
            .map(([name, value]) => [name, { value, dataset: { testament: name }, setAttribute() {} }]));
        const section = { dataset: { testamentPerson: 'a' }, querySelector(selector) {
            return selector === '[data-testament-error]' ? { textContent: '' } : fields[/data-testament="(\w+)"/.exec(selector)?.[1]] || null;
        }, querySelectorAll() { return Object.values(fields); } };
        fields.minimum.closest = selector => selector === '[data-testament-person]' ? section : null;
        nodes.managerPartnership.querySelector = selector => selector === '[data-inheritance-preview="a"]' ? { innerHTML: '' } : null;
        nodes.managerPartnership.listeners.change({ target: { closest: selector => selector === '[data-testament]' ? fields.minimum : null } });
        nodeAssert.ok(await editor.flush());
        return readPartnership(records[PARTNERSHIP_KEY]);
    };
    return { nodes, doc, projection, toggle, editRule };
}
async function useRecords(records) {
    P.resetPersistenceForTests({ async loadAll() { return records; }, async saveBatch({ upserts, deletes }) {
        for (const key of deletes) delete records[key]; for (const [key, value] of upserts) records[key] = value;
    } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
if (selected(1)) {
    const migrated = readPartnership(JSON.stringify(legacy));
    nodeAssert.equal(migrated.activeInheritanceRule?.a, 'testament');
    nodeAssert.equal(hasTestament(migrated, 'a'), true);
    nodeAssert.equal(inheritsHomeAndTax(migrated, 'a'), false);
    const result = preview(migrated);
    close(result.inherited, 200000); close(result.tax, 54000); close(result.residenceTax.annualTax, 7200);
    nodeAssert.equal(JSON.stringify(readPartnership(JSON.stringify(migrated))), JSON.stringify(migrated));
    const records = { [PARTNERSHIP_KEY]: JSON.stringify(legacy) };
    await useRecords(records);
    const ui = editorFixture(records);
    nodeAssert.ok(!ui.nodes.managerInheritance.innerHTML.includes('data-testament-person="a" disabled'));
    const enabled = await ui.toggle(true);
    nodeAssert.equal(enabled.activeInheritanceRule.a, 'home-and-tax');
    nodeAssert.equal(hasTestament(enabled, 'a'), false);
    close(preview(enabled).home, 600000);
    nodeAssert.deepEqual(enabled.testament.a, rule);
    nodeAssert.ok(ui.nodes.managerInheritance.innerHTML.includes('data-testament-person="a" disabled'));
    nodeAssert.equal((await ui.toggle(false)).activeInheritanceRule.a, 'testament');
    nodeAssert.throws(() => readPartnership({ ...legacy, activeInheritanceRule: { a: 'unknown' } }));
    const backupRecords = createMusterHaushaltRecords('2026-10-23', 'martin-petra', 'testament');
    backupRecords[PARTNERSHIP_KEY] = JSON.stringify(legacy);
    const backup = { backupType: FULL_BACKUP_TYPE, app: FULL_BACKUP_APP_ID, schemaVersion: FULL_BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-10-23T12:00:00.000Z', recordCount: Object.keys(backupRecords).length, records: backupRecords };
    const normalized = normalizeFullPersistenceBackup(backup);
    nodeAssert.equal(normalized.ok, true);
    nodeAssert.equal(JSON.parse(normalized.backup.records[PARTNERSHIP_KEY]).activeInheritanceRule.a, 'testament');
    const storageFor = records => ({ records, get length() { return Object.keys(this.records).length; }, key(i) { return Object.keys(this.records)[i] ?? null; },
        getItem(key) { return this.records[key] ?? null; }, setItem(key, value) { this.records[key] = String(value); }, removeItem(key) { delete this.records[key]; } });
    const target = storageFor({});
    nodeAssert.equal(importProfilesBundle(exportProfilesBundle({ storage: storageFor(backupRecords) }), { storage: target }).ok, true);
    nodeAssert.equal(JSON.parse(target.getItem(PARTNERSHIP_KEY)).activeInheritanceRule.a, 'testament');
    await useRecords({});
    const imported = await importFullPersistenceBackup(backup, { preparedRecovery: { recoverySnapshotId: 'synthetic-prepared', previousRecords: {} } });
    nodeAssert.equal(imported.ok, true, imported.message);
    nodeAssert.equal(readPartnership(P.getItemSync(PARTNERSHIP_KEY)).activeInheritanceRule.a, 'testament');
}
if (selected(2)) {
    const explicit = { ...legacy, inheritance: { a: 0 }, activeInheritanceRule: { a: 'home-and-tax' } };
    const result = preview(explicit, false);
    close(result.inherited, 200000); close(result.tax, 54000);
    nodeAssert.equal(inheritsHomeAndTax(explicit, 'a', false), false);
    nodeAssert.equal(inheritsHomeAndTax(explicit, 'a', true), true);
    const records = { [PARTNERSHIP_KEY]: JSON.stringify(explicit) };
    await useRecords(records);
    const ui = editorFixture(records, []);
    nodeAssert.ok(!ui.nodes.managerInheritance.innerHTML.includes('data-testament-person="a" disabled'));
    nodeAssert.ok(ui.nodes.managerInheritance.innerHTML.includes('54.000'));
    ui.projection.profiles[0].values.immobilien = [{ nutzung: 'selbst', wert: 600000 }];
    renderManagerPartnership(ui.doc, ui.projection);
    nodeAssert.ok(ui.nodes.managerInheritance.innerHTML.includes('data-testament-person="a" disabled'));
    nodeAssert.equal(readPartnership(records[PARTNERSHIP_KEY]).activeInheritanceRule.a, 'home-and-tax');
    const emptyRecords = { [PARTNERSHIP_KEY]: JSON.stringify({ ...legacy, testament: undefined }) };
    await useRecords(emptyRecords);
    const emptyUi = editorFixture(emptyRecords, []);
    const edited = await emptyUi.editRule();
    nodeAssert.equal(edited.activeInheritanceRule.a, 'home-and-tax');
    close(preview({ ...edited, inheritance: { a: 0 } }, false).inherited, 200000);
    nodeAssert.equal(inheritsHomeAndTax(edited, 'a', true), true);
    const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    inputs.home = [];
    inputs.partnership.homeAndTaxInheritance = { muster_martin: true };
    inputs.partnership.activeInheritanceRule = { muster_martin: 'home-and-tax' };
    const other = structuredClone(inputs); delete other.partnership.homeAndTaxInheritance; delete other.partnership.activeInheritanceRule;
    const run = value => simulateOneYear(initMcRunState(value), value, { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        0, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
    nodeAssert.equal(hash(run(inputs)), hash(run(other)));
}
if (selected(3)) {
    const base = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    for (const saving of [true, false]) for (const tax of ['immediate', 'annual']) {
        const inputs = structuredClone(base), deadId = 'muster_petra';
        inputs.startAlter = 70; inputs.geschlecht = 'm';
        inputs.partnership.testament = { [deadId]: { home: 'residence', residenceTax: tax } };
        inputs.partnership.inheritance[deadId] = 100;
        inputs.home = [{ id: 'haus', profileId: deadId, nutzung: 'selbst', wert: 600000, stand: '2026-10' }];
        inputs.pflegeGradeConfigs[3].careForm = 'residential';
        inputs.fixedIncome = [];
        if (saving) { inputs.accumulationPhase = { enabled: true, sparrate: 0 }; inputs.transitionYear = 5; }
        const care = { active: true, grade: 3 };
        const run = household => {
            const state = initMcRunState(inputs);
            Object.assign(state, { baseFloor: 0, baseFlex: 0, baseMinimumFlexAnnual: 0, currentAnnualPension: 0, currentAnnualPension2: 0 });
            Object.assign(state.portfolio, { depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [],
                healthBucketCashOwners: [], healthBucketCashAmount: 0, healthBucketGeldmarkt: 0 });
            for (const account of state.portfolio.personAccounts) account.tagesgeld = 100000;
            syncPersonalLiquidity(state.portfolio);
            return simulateOneYear(state, inputs,
                { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0 }, 0, care, 0, household, 1, EngineAPI);
        };
        const result = run({ p1Alive: true, p2Alive: false });
        nodeAssert.equal(result.kind, 'success');
        nodeAssert.equal(result.logData.inheritance.residenceCapital, 0);
        nodeAssert.ok(!result.newState.portfolio.residenceTax);
        nodeAssert.equal(hash(result), hash(run({ p1Alive: true, p2Alive: false, care: { p1: care } })));
        close(result.logData.inheritance.inherited, 100000);
        close(result.logData.inheritance.tax, 24000);
    }
}
if (selected(4)) {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/bmf-lifetime-use-2026.json', import.meta.url)));
    nodeAssert.equal(fixture.rows.length, 101);
    for (const [age, male, female] of fixture.rows) {
        nodeAssert.equal(BMF_LIFETIME_USE_2026.m[age], male, `Männer ${age}`);
        nodeAssert.equal(BMF_LIFETIME_USE_2026.w[age], female, `Frauen ${age}`);
    }
}
if (selected(5)) {
    const base = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
    for (const mode of [undefined, 'money', 'life-estate', 'residence']) {
        const inputs = structuredClone(base);
        inputs.partnership = { schemaVersion: 1, status: 'married', inheritance: {}, marriedInheritance: { muster_martin: 100 },
            ...(mode ? { testament: { muster_martin: { home: mode, maximumPercent: 100 } } } : {}) };
        inputs.home = [600000, 300000].map((wert, id) => ({ id, profileId: 'muster_martin', wert, stand: '2026-10', nutzung: 'selbst' }));
        const portfolio = initMcRunState(inputs).portfolio;
        Object.assign(portfolio, { depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [],
            healthBucketCashOwners: [], healthBucketCashAmount: 0, healthBucketGeldmarkt: 0 });
        for (const account of portfolio.personAccounts) account.tagesgeld = account.profileId === 'muster_martin' ? 500000 : 100000;
        syncPersonalLiquidity(portfolio);
        const result = applyUnmarriedInheritance({ portfolio, inputs, inflationFactor: 1,
            transition: { deathThisYear: true, survivor: { deceasedProfileId: 'muster_martin', survivorProfileId: 'muster_petra' } },
            pension: { rente1BruttoEigen: 0, rente2BruttoEigen: 0 }, personalInterest: { items: [] }, actionResult: { steuer: 0 } });
        if (mode !== 'residence') close(result.erbschaftsteuer, 33000);
        else nodeAssert.ok(result.inheritance.residenceCapital > 0);
        const records = { [PARTNERSHIP_KEY]: JSON.stringify({ ...inputs.partnership, marriedInheritance: { a: 100 },
            ...(mode ? { testament: { a: { home: mode, maximumPercent: 100 } } } : {}) }) };
        await useRecords(records);
        const ui = editorFixture(records, inputs.home);
        // Die Vorschau verwendet 500.000 € Geld wie die unabhängige Nachlassprobe.
        ui.projection.profiles[0].assets = 500000;
        renderManagerPartnership(ui.doc, ui.projection);
        if (mode !== 'residence') nodeAssert.ok(ui.nodes.managerInheritance.innerHTML.includes('33.000'));
        if (mode !== 'residence') nodeAssert.ok(ui.nodes.managerInheritance.innerHTML.includes('bei mehreren selbst genutzten Immobilien die wertvollste'));
        if (mode !== 'residence') nodeAssert.ok(renderProtocolTable([{ jahr: 1, ...result }], { source: 'mc', inputs })
            .includes('bei mehreren selbst genutzten Immobilien die wertvollste'));
    }
}
assert(true, 'AR-1b: ausgeführte Gegenproben bestanden');
