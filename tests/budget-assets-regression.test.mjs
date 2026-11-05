import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../engine/config.mjs';
import InputValidator from '../engine/validators/InputValidator.mjs';
import { prepareBalanceEngineAssets } from '../app/balance/balance-health-bucket.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { buildProfilverbundAssetSummary } from '../app/profile/profilverbund-balance.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { buildInputsCtxFromPortfolio } from '../app/simulator/simulator-portfolio-tranches.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateAnnualDraft } from '../app/balance/balance-annual-storage-commit.js';
import { balanceStorageFixture, recordStorage } from './helpers/balance-storage-fixtures.mjs';
import { SpendingPlanner } from '../engine/planners/SpendingPlanner.mjs';
import { combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { applyHealthBucketCoverage } from '../app/simulator/simulator-health-bucket.js';

const input = { depotwertAlt: 0, depotwertNeu: 800000, costBasisNeu: 800000,
    tagesgeld: 100000, geldmarktEtf: 100000, floorBedarf: 24000, flexBedarf: 60000,
    minimumFlexAnnual: 0, inflation: 2, goldAktiv: false, renteAktiv: false,
    dynamicFlex: true, horizonYears: 30, aktuellesAlter: 65, capeRatio: 25,
    liquidityRunwayYears: 5, risikoprofil: 'sicherheits-dynamisch',
    endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, ath: 100, jahreSeitAth: 0,
    maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0,
    healthBucket: { enabled: true, initialAmount: 150000 },
    detailledTranches: [
        { trancheId: 'eq', sourceProfileId: 'a', type: 'aktien_neu', category: 'equity', marketValue: 800000, costBasis: 800000, taxExempt: false, shares: 8000, purchaseDate: '2020-01-01', tqf: .3 },
        { trancheId: 'mm', sourceProfileId: 'a', type: 'geldmarkt', category: 'money_market', marketValue: 100000, costBasis: 100000, taxExempt: false, shares: 1000, purchaseDate: '2020-01-01', tqf: 0 }
    ] };
const balance = data => evaluateBalanceFileInputs({ inputData: data, persistentState: {}, profiles: [],
    profileId: 'a', engineApi: EngineAPI, publish: false }).modelResult;
const simulatorInput = data => buildInputsCtxFromPortfolio(data,
    initializePortfolio({ ...data, startVermoegen: 1000000, startAlter: 65, startSPB: 0 }),
    { pensionAnnual: 0, marketData: {} });
const before = JSON.stringify(input);
const operative = prepareBalanceEngineAssets(input).input;
assertEqual(operative.geldmarktEtf, 0, 'Pflege-Rücklage sperrt zuerst Geldmarkt');
assertEqual(operative.tagesgeld, 50000, 'Pflege-Rücklage sperrt danach Tagesgeld');
const result = balance(input), sim = EngineAPI.simulateSingleYear(simulatorInput(input), null);
assert(!result.error && !sim.error, 'Beide Rechenpfade liefern gültige Ergebnisse');
assertEqual(result.ui.spending.monatlicheEntnahme * 12, 46800, 'FR-33: freie Vermögensbasis ergibt 46.800 EUR Jahresentnahme');
assertEqual(result.ui.spending.monatlicheEntnahme, sim.ui.spending.monatlicheEntnahme, 'Balance und Simulator: gleiche Entnahme mit Pflege-Rücklage');
assertEqual(result.ui.runway.months, sim.ui.runway.months, 'Balance und Simulator: gleiche Reichweite am selben Entscheidungszeitpunkt');
assertEqual(result.input.tagesgeld + result.input.geldmarktEtf, 50000, 'Engine sieht nur freie Liquidität');
assertEqual(JSON.stringify(input), before, 'Rechenkopie erhält Bruttowerte für Speicherung und erneute Rechnung');
assertEqual(JSON.stringify(balance(input)), JSON.stringify(result), 'Erneute Vorschau zieht die Rücklage nicht doppelt ab');
const disabled = { ...input, healthBucket: { enabled: false } };
assert(prepareBalanceEngineAssets(disabled).input === disabled, 'Ohne Rücklage und Anleihen bleibt das Eingabeobjekt unverändert');
assertEqual(balance(disabled).ui.spending.monatlicheEntnahme * 12, 51600, 'FR-33: ohne Rücklage ergeben sich 51.600 EUR bei 2 Prozent Inflation');
const noTranches = { ...input, detailledTranches: undefined };
assertEqual(prepareBalanceEngineAssets(noTranches).input.tagesgeld, 50000, 'Auch aggregierte Bestände sperren die Rücklage');
const capped = prepareBalanceEngineAssets({ ...input, healthBucket: { enabled: true, initialAmount: 300000 }, aktuelleLiquiditaet: 200000 }).input;
assertEqual(capped.tagesgeld + capped.geldmarktEtf, 0, 'Ungedeckte Rücklage sperrt höchstens die vorhandene Liquidität');
assertEqual(capped.aktuelleLiquiditaet, 0, 'Liquiditäts-Override kann gesperrtes Geld nicht wieder freigeben');

const profiles = ['a', 'b'].map((profileId, index) => ({ profileId, name: profileId,
    inputs: { ...input, tagesgeld: 50000, geldmarktEtf: index ? 60000 : 40000, depotwertNeu: index ? 0 : 800000 },
    tranches: input.detailledTranches.filter(t => t.category === 'equity' && !index).concat({ ...input.detailledTranches[1],
        sourceProfileId: profileId, marketValue: index ? 60000 : 40000, costBasis: index ? 60000 : 40000 }),
    balanceState: {} }));
const profileBytes = JSON.stringify(profiles);
for (const mode of ['proportional', 'tax_optimized', 'runway_first']) {
    const household = evaluateStoredAnnualHousehold(input, profiles, null, { engineApi: EngineAPI, withdrawalMode: mode });
    assertEqual(household.householdResult.ui.spending.monatlicheEntnahme, result.ui.spending.monatlicheEntnahme, `${mode}: Haushalt verwendet dieselbe freie Basis`);
    assertEqual(household.householdResult.ui.runway.months, result.ui.runway.months, `${mode}: Haushalt hat dieselbe Reichweite`);
    assertEqual(household.householdInput.tagesgeld, 100000, 'Gespeicherte Haushaltseingaben bleiben brutto');
    assertEqual(household[0].persistedInput.tagesgeld, 50000, 'Persönliche Speichereingaben bleiben brutto');
    assert(!household.finalAction.quellen.some(t => t.category === 'money_market'), 'Gesperrte Geldmarkttranchen werden nicht verkauft');
    const cash = household.finalAction.quellen.filter(t => t.kind === 'liquiditaet');
    assert(cash.every(t => t.sourceProfileId === 'b'), 'Vollständig gesperrtes Cash der ersten Person wird nicht verwendet');
    assert(cash.reduce((sum, t) => sum + t.brutto, 0) <= 50000, 'Auszahlung und Auffüllung verwenden höchstens das freie Cash');
}
assertEqual(JSON.stringify(profiles), profileBytes, 'Haushaltsrechnung verändert keine persönlichen Bruttobestände');
const selected = evaluateStoredAnnualHousehold(input, [profiles[0]], null, { engineApi: EngineAPI, withdrawalMode: 'proportional' });
assertEqual(selected.householdResult.input.tagesgeld, 0, 'Einzeln ausgewählte Person sperrt ihre verfügbare Liquidität');
assertEqual(selected.householdInput.tagesgeld, 50000, 'Einzelperson wird mit ihrem Bruttobestand gespeichert');

// FR-35: alter Brutto-Peak und neuer Netto-Peak müssen dieselbe Entscheidung ergeben.
const reserveInput = { ...input, depotwertNeu: 570000, costBasisNeu: 570000,
    tagesgeld: 100000, geldmarktEtf: 100000, detailledTranches: undefined,
    healthBucket: { enabled: true, initialAmount: 30000 }, dynamicFlex: false,
    inflation: 0, endeVJ: 60, endeVJ_1: 80, endeVJ_2: 100, ath: 100, jahreSeitAth: 2 };
const legacyState = { initialized: true, peakRealVermoegen: 1000000,
    cumulativeInflationFactor: 1, flexRate: 100, lastMarketSKey: 'bear_deep' };
const reserveEngineInput = prepareBalanceEngineAssets(reserveInput).input;
const migrated = EngineAPI.simulateSingleYear(reserveEngineInput, legacyState);
const alreadyNet = EngineAPI.simulateSingleYear(reserveEngineInput, { ...legacyState,
    peakRealVermoegen: 970000, peakLockedHealthBucketReal: 30000 });
assertEqual(migrated.ui.market.sKey, 'bear_deep', 'FR-35: synthetischer Haushalt im tiefen Bär');
assertClose(migrated.ui.spending.details.realerDepotDrawdown, 230000 / 970000, 1e-12, 'FR-35: Rückgang 23,7 statt 26 Prozent');
assertEqual(migrated.ui.spending.details.severeFlexEmergencyActive, false, 'FR-35: keine schwere Notlage allein durch geänderte Basis');
assertEqual(migrated.newState.peakRealVermoegen, 970000, 'FR-35: Altstand behält den um die Rücklage verschobenen Peak');
assertEqual(migrated.newState.peakLockedHealthBucketReal, 30000, 'FR-35: reale Reservebasis wird gespeichert');
assertEqual(JSON.stringify(migrated), JSON.stringify(alreadyNet), 'FR-35: Migration ergibt dieselbe Entnahme und Diagnose wie passender Netto-Stand');
assertEqual(legacyState.peakRealVermoegen, 1000000, 'FR-35: Laden verändert den gespeicherten Altstand nicht');
const simReservePortfolio = initializePortfolio({ ...reserveInput, startVermoegen: 770000, startAlter: 65 });
const simReserveInput = buildInputsCtxFromPortfolio(reserveInput, simReservePortfolio, { pensionAnnual: 0, marketData: {} });
const simReserveResult = EngineAPI.simulateSingleYear(simReserveInput, legacyState);
assertEqual(simReserveInput.lockedHealthBucketAmount, 30000, 'FR-35: Simulator übergibt den aktuell gesperrten Betrag');
assertEqual(simReserveResult.ui.spending.monatlicheEntnahme, migrated.ui.spending.monatlicheEntnahme, 'FR-35: Balance und Simulator haben bei Altständen dieselbe Entnahme');
assertEqual(simReserveResult.ui.spending.details.realerDepotDrawdown, migrated.ui.spending.details.realerDepotDrawdown, 'FR-35: Balance und Simulator haben denselben Rückgang');
const plannerParams = { input: { lockedHealthBucketAmount: 60000 }, gesamtwert: 1440000,
    depotwertGesamt: 1140000, inflatedBedarf: { floor: 24000, flex: 60000 } };
const laterEnabled = SpendingPlanner._initializeOrLoadState({ ...legacyState, cumulativeInflationFactor: 2 }, plannerParams, () => {});
assertEqual(laterEnabled.keyParams.peakRealVermoegen, 970000, 'FR-35: späteres Einschalten bewertet 60.000 nominal bei Inflationsfaktor 2 als 30.000 real');
const increased = SpendingPlanner._initializeOrLoadState({ ...legacyState,
    peakRealVermoegen: 970000, peakLockedHealthBucketReal: 30000 },
{ ...plannerParams, input: { lockedHealthBucketAmount: 60000 } }, () => {});
assertEqual(increased.keyParams.peakRealVermoegen, 940000, 'FR-35: spätere Erhöhung verschiebt den Peak nur um die Differenz');
applyHealthBucketCoverage({ inputs: reserveInput, portfolio: simReservePortfolio,
    pflegeMeta: { active: true, grade: 4, zusatzFloorZiel: 30000 }, forcedShortfall: 30000, careFloorAddition: 30000 });
const releasedInput = buildInputsCtxFromPortfolio(reserveInput, simReservePortfolio, { pensionAnnual: 0, marketData: {} });
assertEqual(releasedInput.lockedHealthBucketAmount, 0, 'FR-35: nach vollständiger Pflegenutzung übergibt der Simulator 0');
const released = SpendingPlanner._initializeOrLoadState({ ...legacyState,
    peakRealVermoegen: 970000, peakLockedHealthBucketReal: 30000 },
{ ...plannerParams, input: releasedInput, gesamtwert: 770000 }, () => {});
assertEqual(released.keyParams.peakRealVermoegen, 1000000, 'FR-35: Freigabe erhöht den Peak um die bisherige reale Rücklage');
assertClose(released.keyParams.realerDepotDrawdown, .23, 1e-12, 'FR-35: echte Verluste bleiben nach Freigabe sichtbar');
const emptyPeak = SpendingPlanner._initializeOrLoadState({ ...legacyState, peakRealVermoegen: 10000 }, plannerParams, () => {});
assertEqual(emptyPeak.keyParams.peakRealVermoegen, 0, 'FR-35: verschobener Peak wird nie negativ');
assert(!Object.hasOwn(balance(disabled).newState, 'peakLockedHealthBucketReal'), 'FR-35: ohne Rücklage kein zusätzliches Zustandsfeld');
for (const value of [-1, Infinity, NaN, '30000']) {
    assert(!InputValidator.validate({ ...disabled, lockedHealthBucketAmount: value }).valid, 'FR-35: Enginevertrag weist ungültige gesperrte Beträge zurück');
}

// FR-36: zwei aktive Beträge addieren; abweichende Beträge sind keine Konfigurationswarnung.
const householdProfiles = profiles.map((entry, idx) => ({ ...entry,
    healthBucket: { enabled: true, initialAmount: idx ? 20000 : 30000, triggerMinGrade: 4 },
    inputs: { ...entry.inputs, healthBucket: { enabled: true, initialAmount: idx ? 20000 : 30000, triggerMinGrade: 4 } } }));
const combinedReserve = combineSimulatorProfiles(householdProfiles, 'a');
const balanceReserve = buildProfilverbundAssetSummary(householdProfiles).primaryHealthBucket;
assertEqual(balanceReserve.initialAmount, 50000, 'FR-36: Balance summiert die Rücklagen beider Personen');
assertEqual(combinedReserve.combined.healthBucket.initialAmount, 50000, 'FR-36: Simulator summiert dieselben Rücklagen');
assertEqual(JSON.stringify(combinedReserve.combined.healthBucket), JSON.stringify(balanceReserve), 'FR-36: beide Pfade nutzen dieselbe Haushaltsdefinition');
assert(!combinedReserve.warnings.some(w => w.includes('Pflegebucket-Konfiguration')), 'FR-36: unterschiedliche Beträge allein erzeugen keine Warnung');
householdProfiles[1].healthBucket.triggerMinGrade = householdProfiles[1].inputs.healthBucket.triggerMinGrade = 5;
assert(combineSimulatorProfiles(householdProfiles, 'a').warnings.some(w => w.includes('Pflegebucket-Konfiguration')), 'FR-36: unterschiedliche Einstellungen warnen weiterhin');
assertEqual(combineSimulatorProfiles(householdProfiles, 'b').combined.healthBucketTriggerMinGrade, 4, 'FR-36: erste Person folgt der Haushaltsreihenfolge auch bei anderem Hauptprofil');
householdProfiles[0].healthBucket.enabled = householdProfiles[0].inputs.healthBucket.enabled = false;
const onlySecond = combineSimulatorProfiles(householdProfiles, 'a').combined;
assertEqual(onlySecond.healthBucket.initialAmount, 20000, 'FR-36: deaktivierte Beträge zählen nicht');
assertEqual(onlySecond.healthBucketTriggerMinGrade, 5, 'FR-36: Einstellungen kommen von der ersten aktivierten Person');
assertEqual(buildProfilverbundAssetSummary(householdProfiles).primaryHealthBucket.triggerMinGrade, 5, 'FR-36: Balance findet die aktivierte zweite Person ebenfalls');

// FIFO gilt über die Besitzer hinweg; Cash folgt anschließend der Personenreihenfolge.
const datedProfiles = structuredClone(profiles);
datedProfiles[1].tranches[0].purchaseDate = '2010-01-01';
datedProfiles[1].tranches[0].costBasis = 30000;
const gross = { ...input, healthBucket: { enabled: true, initialAmount: 30000 },
    detailledTranches: buildProfilverbundAssetSummary(datedProfiles).mergedTranches };
const prepared = prepareBalanceEngineAssets(gross, datedProfiles);
const simPortfolio = initializePortfolio({ ...gross, simulationPeople: datedProfiles.map(p => ({ profileId: p.profileId, tagesgeld: p.inputs.tagesgeld })) });
for (const person of prepared.profiles) {
    const account = simPortfolio.personAccounts.find(a => a.profileId === person.profileId);
    assertEqual(person.inputs.geldmarktEtf, account.geldmarktEtf, 'FIFO reserviert Geldmarkt beim selben Besitzer wie der Simulator');
}
assertEqual(prepared.profiles[1].tranches[0].costBasis, 15000, 'Teilreservierung erhält anteilige Kostenbasis');
assertEqual(prepared.profiles[1].tranches[0].shares, 500, 'Teilreservierung erhält anteilige Stückzahl');
const householdPartial = evaluateStoredAnnualHousehold(gross, datedProfiles, null, { engineApi: EngineAPI, withdrawalMode: 'proportional' });
assert(householdPartial.finalAction.quellen.filter(t => t.trancheId).every(t => gross.detailledTranches.some(lot => lot.trancheId === t.trancheId)), 'Teilreservierte Quellen behalten ihre ursprünglichen Eigentums-IDs');

const bonds = { ...disabled, decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: -.15 },
    detailledTranches: disabled.detailledTranches.map(t => t.category === 'equity' ? { ...t, type: 'anleihe', category: 'bonds', tqf: 0 } : t) };
for (const returnPolicy of ['legacy_step', 'cape_continuous']) {
    const bondBalance = balance({ ...bonds, returnPolicy });
    const bondSim = EngineAPI.simulateSingleYear(simulatorInput({ ...bonds, returnPolicy }), null);
    assertEqual(bondBalance.input.anleihenWert, 800000, 'Balance meldet Anleihen als Teilmenge des Neubestands');
    assertEqual(bondBalance.input.depotwertNeu, 800000, 'Anleihen bleiben Teil des bisherigen Depotaggregats');
    assertClose(bondBalance.newState.vpwExpectedRealReturn, CONFIG.SPENDING_MODEL.DYNAMIC_FLEX.SAFE_ASSET_REAL_RETURN, 1e-12, 'Nur Anleihen und Cash: sichere Realrendite laut Konfiguration');
    assertEqual(bondBalance.newState.vpwExpectedRealReturn, bondSim.newState.vpwExpectedRealReturn, 'Anleihen: Balance und Simulator gleiche Renditeprognose');
    assertEqual(bondBalance.ui.spending.monatlicheEntnahme, bondSim.ui.spending.monatlicheEntnahme, 'Anleihen: gleiche Entnahme');
    assert(balance({ ...disabled, returnPolicy }).newState.vpwExpectedRealReturn > bondBalance.newState.vpwExpectedRealReturn, 'Aktien erhalten eine höhere Prognose als Anleihen');
    const mixed = balance({ ...bonds, returnPolicy, detailledTranches: [
        { ...disabled.detailledTranches[0], marketValue: 400000, costBasis: 400000 },
        { ...bonds.detailledTranches[0], trancheId: 'bond', marketValue: 400000, costBasis: 400000 },
        disabled.detailledTranches[1]
    ] });
    const forecast = mixed.ui.vpw;
    assertClose(forecast.equityWeight, .4, 1e-12, 'Mischportfolio gewichtet nur echte Aktien mit 40 Prozent');
    assertClose(forecast.safeWeight, .6, 1e-12, 'Anleihen und Cash bilden zusammen 60 Prozent sichere Anlagen');
}
const bondProfiles = structuredClone(profiles);
bondProfiles[0].tranches[0] = bonds.detailledTranches[0];
const bondHousehold = evaluateStoredAnnualHousehold(bonds, bondProfiles, null, { engineApi: EngineAPI, withdrawalMode: 'proportional' });
assertClose(bondHousehold.householdResult.newState.vpwExpectedRealReturn, .005, 1e-12, 'Auch der Haushalt meldet Anleihen als sichere Anlage');
const staticBond = balance({ ...bonds, dynamicFlex: false });
const staticLegacy = EngineAPI.simulateSingleYear({ ...bonds, dynamicFlex: false, finalizeThreeBucketAction: true }, null);
assertEqual(JSON.stringify(staticBond.ui.action), JSON.stringify(staticLegacy.ui.action), 'Ohne Dynamic Flex bleiben Transaktion und Steuer mit Anleihen unverändert');
for (const value of [-1, Infinity, NaN, '800000', 900000]) {
    assert(!InputValidator.validate({ ...disabled, anleihenWert: value }).valid, 'Anleihenfeld akzeptiert nur eine endliche nichtnegative Teilmenge');
}

// Der Speicherleser versorgt auch Jahresabschluss und Spielbereichsvorschau.
for (const kind of ['Einzelprofil', 'Muster-Haushalt']) {
    const fixture = balanceStorageFixture(kind);
    const registry = JSON.parse(fixture.records.rs_profiles_v1);
    const health = JSON.stringify({ enabled: true, initialAmount: 50000 });
    for (const profile of Object.values(registry.profiles)) profile.data.profile_health_bucket = health;
    fixture.records.rs_profiles_v1 = JSON.stringify(registry);
    fixture.records.profile_health_bucket = health;
    const bytes = JSON.stringify(fixture.records);
    const calculation = buildBalanceEngineInputFromStorage({ storage: recordStorage(fixture.records), scope: fixture.scope, referenceYear: 2026 });
    const grossCash = calculation.inputData.tagesgeld + calculation.inputData.geldmarktEtf;
    const reserve = calculation.inputData.healthBucket.initialAmount;
    assertEqual(calculation.engineInput.tagesgeld + calculation.engineInput.geldmarktEtf,
        Math.max(0, grossCash - reserve), `${kind}: direkter Engineinput aus Speicher ist frei von der Rücklage`);
    const annual = evaluateAnnualDraft({ records: fixture.records, scope: fixture.scope, planningYear: 2026,
        values: fixture.values, ageByPerson: {} }, { engineApi: EngineAPI });
    assertEqual(annual.modelResult.input.tagesgeld + annual.modelResult.input.geldmarktEtf,
        Math.max(0, grossCash - reserve), `${kind}: Jahresabschluss verwendet nur freie Liquidität`);
    assertEqual(annual.inputData.tagesgeld + annual.inputData.geldmarktEtf, grossCash, 'Jahresentwurf behält Bruttoliquidität zur Speicherung');
    assertEqual(JSON.stringify(fixture.records), bytes, 'Speicherleser und Jahresvorschau verändern keine Records');
}
