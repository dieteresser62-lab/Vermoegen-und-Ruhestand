import { historicalSurvivorInput } from './historical-survivor-inputs.mjs';
import { createMusterHaushaltRecords } from '../../app/demo/muster-haushalt.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../../app/simulator/simulator-profile-inputs.js';
import { validateSimulatorInputs } from '../../app/simulator/simulator-input-validation.js';
import { initializePortfolio } from '../../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../../app/simulator/simulator-engine-direct.js';
import { computeAdjPctForYear } from '../../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../../app/simulator/dynamic-flex-runner-horizon.js';
import { createHistoricalBacktestContractProvider } from '../../app/simulator/historical-backtest-contract.js';
import { runHistoricalBacktest } from '../../app/simulator/historical-backtest-runner.js';
import { portfolioTotal } from '../../app/simulator/simulator-results.js';
import { prepareHistoricalDataOnce } from '../../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../../engine/index.mjs';

export function helgaWernerBacktest({ onEngineResult } = {}) {
    const records = createMusterHaushaltRecords('2026-10-15', 'helga-werner');
    const registry = JSON.parse(records.rs_profiles_v1);
    const plan = Object.values(JSON.parse(records.household_plan_v1).entries)[0].values;
    const profiles = Object.entries(registry.profiles).map(([profileId, profile]) => ({ profileId, name: profile.meta.name,
        inputs: buildSimulatorInputsFromProfileData({ ...profile.data,
            depot_tranchen: JSON.stringify(normalizeTrancheCollection(JSON.parse(profile.data.depot_tranchen), { mode: 'persisted' }))
        }, { referenceYear: 2026, planValues: plan }) }));
    const inputs = historicalSurvivorInput(validateSimulatorInputs(combineSimulatorProfiles(profiles, profiles[0].profileId, { planValues: plan }).combined));
    // GU-1 (FR-74): Beispiele passen die Rente seit GU-1 „wie Inflation“ an. Die historische Hashprobe behält die
    // damalige Beispielwahl „wie Löhne“ als explizite Eingabe; die neue Vorgabe prüft gu-1-sollfaelle.
    Object.assign(inputs, { rentAdjMode: 'wage', renteIndexierungsart: 'wage' });
    // Historische Hashprobe ohne Pflege: die damaligen Reader-Vorgaben als
    // explizite Eingaben bewahren. FR-39 ändert diese Metadaten, keine Jahreszeile.
    for (const config of Object.values(inputs.pflegeGradeConfigs)) {
        config.flexCut = 1;
        config.mortalityFactor = 0; // Vor FR-41 explizit neutraler historischer Eingang.
    }
    prepareHistoricalDataOnce();
    const engine = onEngineResult ? { ...EngineAPI, simulateSingleYear(input, state, options) {
        const result = EngineAPI.simulateSingleYear(input, state, { ...options, includeFlexTrace: true });
        onEngineResult(result);
        return result;
    } } : EngineAPI;
    return runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2025 },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (...args) => simulateOneYear(...args, null, 0, null, 1, engine),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
        totalPortfolio: portfolioTotal, breakOnRuin: true });
}

export const pensionStrongInput = {
    depotwertAlt: 500000, depotwertNeu: 0, tagesgeld: 100000, geldmarktEtf: 0,
    floorBedarf: 36000, flexBedarf: 12000, minimumFlexAnnual: 6000, inflation: 0,
    goldAktiv: false, renteAktiv: true, renteMonatlich: 2800,
    liquidityRunwayYears: 5, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0,
    risikoprofil: 'sicherheits-dynamisch', endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100,
    ath: 100, jahreSeitAth: 0, dynamicFlex: false, goGoActive: false, aktuellesAlter: 70
};

// Vollständige Ausgabe der initialen Flex-Policy einschließlich State, Entscheidungen
// und Trace: unter 2 % ohne bisherigen Eingriff sowie oberhalb der neuen Schwelle.
export function unchangedFFE(calculateFlexRate, createTrace) {
    return [.014, .021, .035, .045].flatMap(quote => [50, 80, 100].map(previousRate => {
        const wealth = 8400 / quote, decisions = [];
        const params = { inflatedBedarf: { floor: 2400, flex: 12000 }, gesamtwert: wealth,
            depotwertGesamt: wealth, renteJahr: 33600, input: pensionStrongInput,
            market: { sKey: 'side_long' }, runwayMonate: 120,
            lastState: { lastEntnahmeReal: (quote < .02 ? .005 : .045) * wealth, cumulativeInflationFactor: 1 } };
        const state = { flexRate: previousRate, keyParams: {} }, trace = createTrace(12000);
        const result = calculateFlexRate(state, { active: false }, params, (...args) => decisions.push(args), trace);
        return { params, state, result, decisions, trace: trace.snapshot() };
    }));
}
