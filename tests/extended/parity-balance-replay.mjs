import assert from 'node:assert/strict';
import { CONFIG } from '../../app/balance/balance-config.js';
import { createReadonlyParityStorage, serializeParityBalanceLot } from '../../app/balance/parity-balance-records.js';
import { buildParityBalanceReplayYear, evaluateParityBalanceReplayYear } from '../../app/balance/parity-balance-replay.js';
import { buildBalanceEngineInputFromStorage } from '../../app/balance/balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from '../../app/balance/balance-main-profilverbund.js';
import { createParityReplayCollector } from '../../app/simulator/parity-replay-collector.js';
import { sealParityReplayLog, restoreParityReplayValue } from '../../app/simulator/parity-replay-contract.js';
import { projectPerson } from '../../app/profile/profile-person-data.js';
import { buildPlanRecord, planScope } from '../../app/profile/household-plan.js';
import { EngineAPI } from '../../engine/index.mjs';
import { inputs, records, recordBytes, runFixture, source } from './parity-replay-fixture.mjs';

export function testParityBalanceReplay() {
    let checks = 0;
    const equal = (a, b, message) => { assert.deepStrictEqual(a, b, message); checks++; };
    const ok = (value, message) => { assert.ok(value, message); checks++; };
    const throws = (fn, message) => { assert.throws(fn, message); checks++; };
    const collector = createParityReplayCollector({ initialRecords: records, source });
    runFixture({ collector });
    const log = JSON.parse(JSON.stringify(collector.toLog()));
    const logBytes = JSON.stringify(log);
    const stateKey = CONFIG.STORAGE.LS_KEY;
    const initialRegistry = JSON.parse(records.rs_profiles_v1);
    const inputBytes = JSON.stringify(inputs);
    const mutate = fn => { const copy = JSON.parse(logBytes); fn(copy); return sealParityReplayLog(copy); };

    // Tripwires cover all ambient persistence and network access. The only input is the log.
    const ambient = ['localStorage', 'indexedDB', 'fetch', 'window', 'document'];
    const descriptors = Object.fromEntries(ambient.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    try {
        for (const key of ambient) Object.defineProperty(globalThis, key, { configurable: true,
            get() { throw new Error(`AMBIENT_ACCESS:${key}`); } });
        for (const year of log.years) {
            const replay = evaluateParityBalanceReplayYear(log, year.yearIndex, { engineApi: EngineAPI, expectedSource: source });
            ok(replay.calculation && replay.householdResult, JSON.stringify(replay.issues));
            equal(replay.replayable, false, 'partielle Rechnung ist keine vollständige Parität');
            equal(replay.comparisonEligible, false);
            equal(replay.logicalPlanningYear, 2026 + year.yearIndex);
            equal(replay.historicalYear, 2000 + year.yearIndex);
            const { storage, calculation } = replay;
            equal(calculation, buildBalanceEngineInputFromStorage({ storage, referenceYear: year.logicalPlanningYear }), 'echter Reader unverändert');
            const direct = evaluateStoredAnnualHousehold(calculation.inputData, calculation.profiles, calculation.engineLastState,
                { engineApi: EngineAPI, withdrawalMode: calculation.householdPlan.entry.values.householdWithdrawalMode });
            equal(replay.runs, direct, 'echter Haushaltspfad samt Personenattribution');
            equal(replay.householdResult, direct.householdResult);
            equal(replay.runs.distribution.mode, 'tax_optimized');
            const snapshot = storage.toRecords();
            const privateRegistry = JSON.parse(snapshot.rs_profiles_v1);
            equal(snapshot.profile_rente_monatlich, privateRegistry.profiles[snapshot.rs_current_profile].data.profile_rente_monatlich,
                'private Livefelder spiegeln den ausgewählten Profilrecord');
            for (const profile of calculation.profiles) {
                const id = profile.profileId, data = privateRegistry.profiles[id].data;
                const person = projectPerson(data, year.logicalPlanningYear);
                equal(data.profile_rentenbeginn, initialRegistry.profiles[id].data.profile_rentenbeginn, 'kein künstlicher Januar-Rentenbeginn');
                equal(data.profile_geburtsdatum, initialRegistry.profiles[id].data.profile_geburtsdatum);
                equal(profile.inputs.aktuellesAlter, person.startAlter);
                equal(profile.inputs.renteMonatlich, person.monateImJahr === 12 ? person.renteMonatlich : person.renteImJahr / 12);
                equal(Number(data.profile_tagesgeld), year.cashAndLots.cashOwnership.persons.find(person => person.profileId === id).tagesgeld,
                    'belegtes fortgeschriebenes Personenkonto');
                equal(JSON.parse(data[stateKey]).lastState, { ...JSON.parse(initialRegistry.profiles[id].data[stateKey]).lastState,
                    taxState: year.cashAndLots.cashOwnership.persons.find(person => person.profileId === id).taxState },
                    'persönlicher fortgeschriebener Steuerzustand statt Haushaltspool');
                ok(!replay.issues.some(issue => issue.path === `persons.${id}.cash`), 'aktuelle Cashherkunft belegt');
            }
            const originalLots = year.cashAndLots.lots;
            const actualLots = calculation.engineInput.detailledTranches;
            equal(actualLots.length, originalLots.length);
            for (const lot of originalLots) {
                const actual = actualLots.find(item => item.trancheId === lot.trancheId && item.sourceProfileId === lot.sourceProfileId);
                ok(actual, 'Lot-ID einschließlich Besitzer erhalten');
                for (const key of ['type', 'category', 'shares', 'tqf', 'taxExempt', 'purchaseDate']) equal(actual[key], lot[key], `Lot ${key}`);
                ok(Math.abs(actual.marketValue - lot.marketValue) < 1e-8, 'aktueller Wert aus Stücken und umgerechnetem Kurs');
                ok(Math.abs(actual.costBasis - lot.costBasis) < 1e-8, 'Kostenbasis bleibt erhalten');
            }
            for (const method of ['setItem', 'removeItem', 'clear']) throws(() => storage[method]('rs_profiles_v1', '{}'), /PARITY_READ_ONLY_STORAGE/);
            const before = storage.getItem(stateKey);
            snapshot[stateKey] = '{}';
            equal(storage.getItem(stateKey), before, 'exportierte Records sind unabhängige Kopien');
            throws(() => { storage.setItem = () => {}; }, TypeError);
            equal([...new Set(replay.issues.filter(issue => issue.status === 'FACHLICH_OFFEN' && issue.question).map(issue => issue.question))],
                []);
            ok(!replay.issues.some(issue => issue.question === 7), 'FR-14 ist entschieden');
            if (year.yearIndex > 0) {
                equal(replay.resetEvidence.balance.resetApplied, false, 'FR-12: normaler Jahreswechsel erhält die Historie');
                equal(replay.resetEvidence.balance.after, restoreParityReplayValue(year.engineLastState));
                equal(replay.resetEvidence.balance.removedFields, []);
                equal(replay.resetEvidence.simulator.previousEngineInput, restoreParityReplayValue(log.years[year.yearIndex - 1].engineInput));
                equal(calculation.history.persistentState.inputs.floorBedarf, year.simulatorStateBefore.baseFloor,
                    'FR-12: automatische Vorjahresindexierung verschiebt die Resetevidenz');
            }
        }
    } finally {
        for (const key of ambient) {
            if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
            else delete globalThis[key];
        }
    }
    const second = buildParityBalanceReplayYear(log, 1);
    equal(second.calculation.profiles.find(profile => profile.profileId === 'muster_b').inputs.renteMonatlich, 820,
        'Balance leitet sechs Bezugsmonate selbst aus dem tatsächlichen Rentenbeginn ab');
    ok(Math.abs(second.calculation.engineInput.renteMonatlich * 12 - log.years[1].effectiveAnnualPensions.pensionAnnual) < 0.01,
        'FR-11: Nettorenten stimmen mit der Kalenderprojektion überein');
    equal(second.calculation.inputData.tagesgeld, log.years[1].cashAndLots.componentCash.tagesgeld, 'fortgeschriebenes persönliches Cash');
    ok(Math.abs(second.calculation.inputData.tagesgeld + second.calculation.inputData.geldmarktEtf - log.years[1].cashAndLots.pooledLiquidity) < 1e-8);

    const changed = mutate(copy => {
        copy.years[0].expectedDecision.newState.lastTotalBudget = 42;
        copy.years[0].engineInput.horizonYears = 7;
        copy.years[0].horizonContext.horizonYears = 7;
        copy.years[0].assumptions.horizonYears = 7;
    });
    const original = evaluateParityBalanceReplayYear(log, 0, { engineApi: EngineAPI });
    const independent = evaluateParityBalanceReplayYear(changed, 0, { engineApi: EngineAPI });
    equal(independent.householdResult, original.householdResult, 'Entscheidungswerte und Runnerhorizont ersetzen keine Balance-Ableitung');
    equal(independent.calculation.engineInput.horizonYears, 30);
    const liveIncome = buildParityBalanceReplayYear(mutate(copy => { copy.initialRecords.profile_sonstige_einkuenfte = '7'; }), 0);
    equal(liveIncome.calculation.inputData.renteMonatlich, original.calculation.inputData.renteMonatlich + 7,
        'native Liveprojektion und Balance-Zusatzeinkommen bleiben erhalten');

    const isolated = mutate(copy => { copy.years = [copy.years[1]]; });
    equal(buildParityBalanceReplayYear(isolated, 1).calculation, second.calculation,
        'Einzeljahr braucht nur seine protokollierte Vorgeschichte');
    for (const mode of ['proportional', 'runway_first']) {
        const replay = evaluateParityBalanceReplayYear(mutate(copy => { copy.years[0].assumptions.householdWithdrawalMode = mode; }), 0, { engineApi: EngineAPI });
        ok(replay.householdResult);
        equal(replay.runs.distribution.mode, mode, 'Haushalt & Plan bestimmt echte Personenverteilung');
    }

    const ownTaxes = mutate(copy => {
        const registry = JSON.parse(copy.initialRecords.rs_profiles_v1);
        for (const [index, profile] of Object.values(registry.profiles).entries()) {
            const state = JSON.parse(profile.data[stateKey]);
            state.lastState.taxState = { lossCarry: index ? 654 : 321 };
            profile.data[stateKey] = JSON.stringify(state);
        }
        copy.initialRecords.rs_profiles_v1 = JSON.stringify(registry);
        copy.years[1].cashAndLots.cashOwnership.persons.forEach((person, index) => { person.taxState = { lossCarry: index ? 654 : 321 }; });
    });
    equal(buildParityBalanceReplayYear(ownTaxes, 1).calculation.profiles.map(profile => profile.balanceState.lastState.taxState.lossCarry),
        [321, 654], 'persönliche Steuerherkunft bleibt getrennt vom Haushaltspool');

    const zeroAndCategories = mutate(copy => {
        const registry = JSON.parse(copy.initialRecords.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) profile.data.profile_tagesgeld = '0';
        copy.initialRecords.rs_profiles_v1 = JSON.stringify(registry);
        const year = copy.years[0];
        for (const person of year.cashAndLots.cashOwnership.persons) person.tagesgeld = 0;
        for (const [index, category, type] of [[0, 'gold', 'gold'], [1, 'bonds', 'anleihe']]) {
            Object.assign(year.cashAndLots.lots[index], { category, type, tqf: 0, taxExempt: true });
        }
        year.engineInput.detailledTranches = structuredClone(year.cashAndLots.lots);
    });
    const categorized = buildParityBalanceReplayYear(zeroAndCategories, 0).calculation;
    equal(categorized.engineInput.tagesgeld, 0, 'explizite Null bleibt Null');
    equal(zeroAndCategories.years[0].cashAndLots.lots.slice(0, 2).map(sourceLot => {
        const lot = categorized.engineInput.detailledTranches.find(item => item.trancheId === sourceLot.trancheId);
        return [lot.category, lot.type, lot.taxExempt];
    }),
        [['gold', 'gold', true], ['bonds', 'anleihe', true]]);

    const singleLog = mutate(copy => {
        copy.years = [copy.years[0]];
        const registry = JSON.parse(copy.initialRecords.rs_profiles_v1);
        delete registry.profiles.muster_b;
        copy.initialRecords.rs_profiles_v1 = JSON.stringify(registry);
        const initialValues = original.calculation.householdPlan.entry.values;
        copy.initialRecords.household_plan_v1 = buildPlanRecord(null,
            [{ scope: planScope('household', ['muster_a']), values: initialValues }], { now: () => new Date('2026-01-01T12:00:00Z') }).raw;
        const year = copy.years[0];
        year.assumptions.partner = { aktiv: false };
        year.cashAndLots.lots = year.cashAndLots.lots.filter(lot => lot.sourceProfileId === 'muster_a');
        year.engineInput.detailledTranches = structuredClone(year.cashAndLots.lots);
    });
    const single = evaluateParityBalanceReplayYear(singleLog, 0, { engineApi: EngineAPI });
    ok(single.householdResult, JSON.stringify(single.issues));
    equal(single.calculation.profiles.length, 1);
    equal(single.calculation.profiles[0].profileId, 'muster_a');

    const overrideLog = mutate(copy => {
        copy.years[0].assumptions.personDataContext = {
            schemaVersion: 1, referenceYear: 2026, ageRule: 'january-1-completed-years', deviationApplied: true,
            persons: [{ profileId: 'muster_a', role: 'primary', changes: [] },
                { profileId: 'muster_b', role: 'partner', changes: [{ field: 'profile_rentenbeginn', profileValue: '2027-07-01', effectiveValue: '2026-07-01' }] }]
        };
    });
    const withOverride = buildParityBalanceReplayYear(overrideLog, 0);
    equal(withOverride.calculation.profiles.find(profile => profile.profileId === 'muster_b').inputs.renteMonatlich, 800,
        'belegte Personenalternative verwendet echte Bezugsmonate');

    // Independent ownership survives even when local IDs collide between people.
    const lot = restoreParityReplayValue(log.years[1].cashAndLots.lots[0]);
    const local = serializeParityBalanceLot({ ...lot, trancheId: `${lot.sourceProfileId}:same` }, lot.sourceProfileId);
    equal(local.trancheId, 'same');
    equal(local.shares, lot.shares);
    for (const field of ['shares', 'sourceProfileId', 'costBasis', 'purchaseDate', 'taxExempt']) {
        const broken = { ...lot }; delete broken[field];
        throws(() => serializeParityBalanceLot(broken, lot.sourceProfileId));
    }
    const standalone = { a: 'b' }, view = createReadonlyParityStorage(standalone);
    standalone.a = 'changed';
    equal(view.getItem('a'), 'b');
    equal(view.getItem('toString'), null);
    equal(view.key(0), 'a');
    equal(view.length, 1);
    throws(() => createReadonlyParityStorage({ a: undefined }), TypeError);

    const missingCases = [
        [copy => { copy.initialRecords = null; }, 'initialRecords'],
        [copy => { copy.years[1].logicalPlanningYear = null; }, 'logicalPlanningYear'],
        [copy => { copy.years[1].historicalYear = null; copy.years[1].marketContext.yearData.jahr = null; }, 'historicalYear'],
        [copy => { delete copy.initialRecords.household_plan_v1; }, 'household_plan_v1'],
        [copy => { delete copy.years[1].simulatorStateBefore.baseMinimumFlexAnnual; }, 'baseMinimumFlexAnnual'],
        [copy => { delete copy.years[1].resetEvidence.previousEngineInput; }, 'previousEngineInput'],
        [copy => { delete copy.years[1].householdEvents.normalizedHouseholdContext; }, 'normalizedHouseholdContext'],
        [copy => { copy.years[1].cashAndLots.lots[0].sourceProfileId = 'foreign'; copy.years[1].engineInput.detailledTranches = copy.years[1].cashAndLots.lots; }, 'sourceProfileId'],
        [copy => {
            const registry = JSON.parse(copy.initialRecords.rs_profiles_v1);
            registry.profiles.muster_b.data.profile_tagesgeld = 'unknown';
            copy.initialRecords.rs_profiles_v1 = JSON.stringify(registry);
        }, 'profile_tagesgeld']
    ];
    for (const [change, path] of missingCases) {
        const incomplete = buildParityBalanceReplayYear(mutate(change), 1);
        equal(incomplete.calculation, null, `keine erfundene Herkunft ${path}`);
        ok(incomplete.issues.some(issue => issue.path.includes(path)));
    }
    const invalidMinimum = buildParityBalanceReplayYear(mutate(copy => { copy.years[1].simulatorStateBefore.baseMinimumFlexAnnual = 100000; }), 1);
    equal(invalidMinimum.calculation, null, 'Mindest-Flex wird abgewiesen statt begrenzt');
    ok(invalidMinimum.issues.some(issue => issue.status === 'TECHNISCHER_FEHLER' && issue.reason.includes('Mindest-Flex')));
    const wrongPrevious = buildParityBalanceReplayYear(mutate(copy => { copy.years[1].resetEvidence.previousEngineInput.ath = -1; }), 1);
    equal(wrongPrevious.calculation, null);
    ok(wrongPrevious.issues.some(issue => issue.reason === 'previous_input_evidence_mismatch'));
    const excluded = buildParityBalanceReplayYear(mutate(copy => { copy.years[0].householdEvents.temporaryFlexFactor = 0.5; }), 0);
    equal(excluded.calculation, null);
    ok(excluded.issues.some(issue => issue.status === 'AUSGEKLAMMERT'));
    const wrongHash = JSON.parse(logBytes); wrongHash.years[0].engineInput.ath = -1;
    equal(buildParityBalanceReplayYear(wrongHash, 0).calculation, null);
    equal(buildParityBalanceReplayYear(log, 0, { expectedSource: { sourceHash: 'a'.repeat(64) } }).calculation, null);
    equal(buildParityBalanceReplayYear({ rows: [] }, 0).calculation, null);
    equal(buildParityBalanceReplayYear(log, 99).calculation, null);
    const engineFailure = evaluateParityBalanceReplayYear(log, 0, { engineApi: { simulateSingleYear() { throw new Error('synthetic_engine_failure'); } } });
    equal(engineFailure.householdResult, null);
    ok(engineFailure.issues.some(issue => issue.reason === 'synthetic_engine_failure'));
    equal(JSON.stringify(log), logBytes, 'Replaybeleg unverändert');
    equal(JSON.stringify(records), recordBytes, 'ursprüngliche Musterrecords unverändert');
    equal(JSON.stringify(inputs), inputBytes, 'Simulatoreingaben bleiben unverändert');
    console.log(`Parity Balance replay: ${checks} Prüfungen erfolgreich.`);
}
