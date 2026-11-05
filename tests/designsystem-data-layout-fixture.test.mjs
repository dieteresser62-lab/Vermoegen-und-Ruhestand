import { createDesignsystemDataLayoutFixture } from './browser-smoke.test.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { createProfilverbundHandlers } from '../app/balance/balance-main-profilverbund.js';
import { prepareEngineLastState } from '../app/balance/balance-update-pipeline.js';
import { assertProfileContextReady } from '../app/profile/profile-storage.js';
import { PROFILE_STORAGE_KEYS } from '../app/profile/profile-state.js';
import { loadProfilverbundProfiles } from '../app/profile/profilverbund-balance.js';
import {
    PersistenceFacade, persistenceStorage, resetPersistenceForTests,
    resetPersistenceRuntimeForTests
} from '../app/shared/persistence-facade.js';
import { LIQUIDITY_RUNWAY_CONTRACT_V1 } from '../types/liquidity-runway-contract.js';
import { LONGEVITY_DEFAULTS } from '../app/simulator/dynamic-flex-longevity-contract.js';

const STATE = CONFIG.STORAGE.LS_KEY;
const EXPENSES = 'balance_expenses_v1';
const MODE = 'profilverbund_withdrawal_mode';
const IDS = ['layout-a', 'layout-b'];

async function installFixture(fixture, activeId) {
    const registry = JSON.parse(fixture.storage[PROFILE_STORAGE_KEYS.registry]);
    // Wie nach dem Profilwechsel: dieselben Registrydaten in die aktive Projektion übernehmen.
    const store = new Map(Object.entries({ ...fixture.storage, ...registry.profiles[activeId].data,
        [PROFILE_STORAGE_KEYS.current]: activeId, [PROFILE_STORAGE_KEYS.active]: activeId }));
    resetPersistenceForTests({
        name: 'datenlayout-test-memory',
        async open() {},
        async loadAll() { return Object.fromEntries(store); },
        async saveBatch({ upserts, deletes }) {
            deletes.forEach(key => store.delete(key));
            upserts.forEach(([key, value]) => store.set(key, value));
        }
    });
    await PersistenceFacade.init();
    const context = assertProfileContextReady();
    assertEqual(context.currentId, activeId, 'Echte Kontextprüfung bestätigt das aktuelle Profil');
    assertEqual(context.activeId, activeId, 'Echte Kontextprüfung bestätigt das aktive Profil');
    assertEqual(persistenceStorage.getItem(STATE), registry.profiles[activeId].data[STATE], 'Aktiver Balance-State stammt aus der Registry');
    assertEqual(persistenceStorage.getItem('depot_tranchen'), registry.profiles[activeId].data.depot_tranchen, 'Aktive Tranchen stammen aus der Registry');
    assertEqual(persistenceStorage.getItem('profile_tagesgeld'), registry.profiles[activeId].data.profile_tagesgeld, 'Aktive Tagesgeldüberschreibung stammt aus der Registry');
    assertEqual(persistenceStorage.getItem(EXPENSES), fixture.storage[EXPENSES], 'Gemeinsame Ausgabenhistorie bleibt vollständig installiert');
    assertEqual(persistenceStorage.getItem(MODE), null, 'Fixture verwendet den produktiven Standardmodus tax_optimized');
    return loadProfilverbundProfiles();
}

function runFixture(profiles) {
    const activeState = JSON.parse(persistenceStorage.getItem(STATE));
    // Nicht gespeicherte Formularwerte: Balance.html und UIReader.readAllInputs.
    // Vermögen, Tranchen und Goldstrategie übernimmt anschließend der echte Aggregationspfad.
    const input = {
        risikoprofil: 'sicherheits-dynamisch',
        tqfAlt: 0, tqfNeu: 0, kirchensteuerSatz: 0.09, sparerPauschbetrag: 1000,
        liquidityRunwayYears: LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears,
        minCashBufferMonths: 2, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
        dynamicFlex: false, horizonMethod: 'survival_quantile', horizonYears: 30,
        survivalQuantile: 0.85, goGoActive: false, goGoMultiplier: 1.1,
        longevityMode: LONGEVITY_DEFAULTS.mode,
        longevityQuantileShift: LONGEVITY_DEFAULTS.quantileShift,
        longevityRelativePct: LONGEVITY_DEFAULTS.relativePct,
        longevityBufferYears: LONGEVITY_DEFAULTS.bufferYears,
        decumulation: { mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null },
        ...activeState.inputs
    };
    const handlers = createProfilverbundHandlers({ dom: {}, PROFILVERBUND_STORAGE_KEYS: { mode: MODE } });
    handlers.updateProfilverbundGlobals(profiles, input);
    // Haushalts-LastState genau wie balance-main.update, einschließlich Guardrail-Reset.
    const source = profiles.find(entry => entry.balanceState?.profilverbundHouseholdLastState)?.balanceState || activeState;
    const householdLastState = prepareEngineLastState({
        inputs: source.profilverbundHouseholdInputs,
        lastState: source.profilverbundHouseholdLastState
    }, input);
    return handlers.runProfilverbundProfileSimulations(input, profiles, householdLastState);
}

const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
try {
    // Nur Browserumgebung ersetzen; Engine, Verteilung und Action-Attribution sind produktiv.
    globalThis.window = { EngineAPI };
    for (const activeId of IDS) {
        const fixture = createDesignsystemDataLayoutFixture();
        const registry = JSON.parse(fixture.storage[PROFILE_STORAGE_KEYS.registry]);
        assertEqual(JSON.stringify(Object.keys(registry.profiles)), JSON.stringify(IDS), 'Fixture enthält genau zwei Profile');
        assertEqual(fixture.storage[PROFILE_STORAGE_KEYS.current], 'layout-a', 'Browserfixture startet mit Profil A');
        assertEqual(fixture.storage[PROFILE_STORAGE_KEYS.active], 'layout-a', 'Browserfixture hat eine konsistente aktive ID');
        assertEqual(fixture.names['layout-a'], 'Synthetisches Profil A – ' + 'Vollständiger Auswahlname '.repeat(10), 'Langer Name A bleibt unverändert');
        assertEqual(fixture.names['layout-b'], 'Synthetisches Profil B – ' + 'Anderer langer Auswahlname '.repeat(10), 'Langer Name B bleibt unverändert');
        assertEqual(fixture.lots.length, 10, 'Managerfixture enthält zehn Tranchen');
        assertEqual(fixture.lots[0].name, 'Synthetische Tranche ' + 'Langer vollständiger Name '.repeat(12), 'Langer Tranchenname bleibt unverändert');
        assertEqual(JSON.stringify(fixture.lots.map(lot => lot.trancheId)), JSON.stringify(Array.from({ length: 10 }, (_, i) => `layout-lot-${i}`)), 'Alle Tranchen-IDs bleiben erhalten');
        assertEqual(fixture.state.wealthHistory.entries.length, 24, 'Fixture enthält 24 Vermögensstände');
        assertEqual(fixture.storage[STATE], JSON.stringify(fixture.state), 'Zurückgegebener State entspricht dem gespeicherten State');
        assertEqual(fixture.storage.profile_tagesgeld, '100000', 'Aktiver Speicher setzt 100000 Euro Tagesgeld');
        const expenses = JSON.parse(fixture.storage[EXPENSES]);
        assertEqual(expenses.activeYear, 2026, 'Aktives Ausgabenjahr bleibt 2026');
        assertEqual(JSON.stringify(Object.keys(expenses.years)), JSON.stringify(Array.from({ length: 24 }, (_, i) => String(2003 + i))), 'Alle 24 Ausgabenjahre bleiben erhalten');
        for (const year of Object.values(expenses.years)) {
            assertEqual(year.months['1'].profiles['layout-a'].categories.Test, -100, 'Ausgabenbetrag A bleibt unverändert');
            assertEqual(year.months['1'].profiles['layout-b'].categories.Test, -50, 'Ausgabenbetrag B bleibt unverändert');
        }
        for (const id of IDS) {
            const profile = registry.profiles[id];
            assertEqual(profile.meta.name, fixture.names[id], 'Registry erhält den vollständigen Profilnamen');
            assertEqual(profile.meta.belongsToHousehold, true, 'Beide Profile bleiben Haushaltsmitglieder');
            assertEqual(profile.data.profile_tagesgeld, '100000', 'Explizite Profilüberschreibung beträgt 100000 Euro');
            assertEqual(JSON.parse(profile.data[STATE]).inputs.tagesgeld, 100000, 'Balance-Eingaben und Profilüberschreibung stimmen überein');
            assertEqual(profile.data[STATE], fixture.storage[STATE], 'Jedes Profil erhält den vollständigen Verlauf und positiven Bedarf');
            assertEqual(profile.data.depot_tranchen, JSON.stringify(fixture.lots), 'Jedes Profil erhält dieselben zehn vollständigen Tranchen');
        }
        const profiles = await installFixture(fixture, activeId);
        assertEqual(JSON.stringify(profiles.map(profile => profile.profileId)), JSON.stringify(IDS), 'Echter Ladepfad liefert beide Haushaltsprofile');
        for (const profile of profiles) {
            assertEqual(profile.inputs.tagesgeld, 100000, 'Ladepfad berücksichtigt die ausdrückliche Tagesgeldüberschreibung');
            assertEqual(profile.tranches.length, 10, 'Ladepfad erhält zehn Tranchen je Profil');
            assertEqual(profile.inputs.depotwertAlt + profile.inputs.depotwertNeu, 1800, 'Reale Tranchen ersetzen das allgemeine Depotaggregat');
            assert(profile.inputs.floorBedarf > 0 && profile.inputs.flexBedarf > 0, 'Floor-/Flex-Bedarfe bleiben positiv');
        }
        const runs = runFixture(profiles);
        assertEqual(runs.length, 2, `${activeId}: zwei reale Profilruns`);
        assertEqual(JSON.stringify(runs.map(run => run.profileId)), JSON.stringify(IDS), 'Runs erhalten beide geladenen Profil-IDs');
        assert(!runs.householdResult.error, 'Echte Haushalts-Engine liefert keinen Fehler');
        const annualNeed = runs.householdResult.ui.spending.monatlicheEntnahme * 12;
        assert(Number.isFinite(annualNeed) && annualNeed > 0, 'Engine entscheidet endlichen positiven Jahresbedarf');
        assert(Number.isFinite(runs.distribution.remaining) && Math.abs(runs.distribution.remaining) <= 0.01, 'Zuordnungsrest liegt innerhalb der Centtoleranz');
        const allocated = runs.distribution.items.reduce((sum, item) => sum + item.withdrawalAmount, 0);
        assert(Number.isFinite(allocated) && Math.abs(allocated - runs.distribution.totalNeed) <= 0.01, 'Zugeordnete Summe entspricht dem Gesamtbedarf innerhalb eines Cents');
        assert(Math.abs(runs.distribution.totalNeed - annualNeed) <= 0.01, 'Verteilung verwendet den tatsächlich entschiedenen Enginebedarf');
        assert(Math.abs(runs.reduce((sum, run) => sum + run.ui.spending.monatlicheEntnahme * 12, 0) - annualNeed) <= 0.01, 'Profilruns bilden den gesamten Jahresbedarf ab');
        assertEqual(runs.householdInput.tagesgeld, 200000, 'Echter Aggregationspfad summiert beide Tagesgeldwerte');
        console.log(`${activeId}: Bedarf ${annualNeed}, Zuordnung ${allocated}, Rest ${runs.distribution.remaining}`);

        // Gegenprobe: ausschließlich die alten Profilüberschreibungen zurücksetzen, sonst identische Fixture.
        const invalidFixture = createDesignsystemDataLayoutFixture();
        const invalidRegistry = JSON.parse(invalidFixture.storage[PROFILE_STORAGE_KEYS.registry]);
        IDS.forEach(id => { invalidRegistry.profiles[id].data.profile_tagesgeld = '10000'; });
        invalidFixture.storage[PROFILE_STORAGE_KEYS.registry] = JSON.stringify(invalidRegistry);
        const invalidProfiles = await installFixture(invalidFixture, activeId);
        assert(invalidProfiles.every(profile => profile.inputs.tagesgeld === 10000), 'Gegenprobe lädt die alten Tagesgeldüberschreibungen');
        let failure;
        try { runFixture(invalidProfiles); } catch (error) { failure = error; }
        assert(failure instanceof Error && /^Profilverbund: \d+\.\d{2} EUR Haushaltsbedarf konnten keinem Profil zugeordnet werden\.$/.test(failure.message),
            `${activeId}: reale Zuordnungsprüfung lehnt die alte Fixture ab`);
        console.log(`${activeId}: Gegenprobe: ${failure.message}`);
    }
} finally {
    resetPersistenceRuntimeForTests();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
}
