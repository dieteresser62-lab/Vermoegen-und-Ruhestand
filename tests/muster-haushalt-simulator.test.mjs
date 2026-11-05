import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { MUSTER_HAUSHALTE } from '../app/demo/muster-haushalte.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { initSimulatorProfileSelection } from '../app/simulator/simulator-main-profiles.js';
import { initInputPersistence } from '../app/simulator/simulator-main-input-persist.js';
import { initDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { getSimulatorPlanTrial, initSimulatorPlanTrial } from '../app/simulator/simulator-plan-trial.js';
import { readDocumentPersonInputs } from '../app/simulator/simulator-person-overrides.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { getCommonInputs, initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { EngineAPI } from '../engine/index.mjs';
import InputValidator from '../engine/validators/InputValidator.mjs';
import { simulatorDocument } from './simulator-page-fixture.mjs';
import { getProtocolColumns, readProtocolValue } from '../app/simulator/protocol-columns.js';

const previous = { window: globalThis.window, document: globalThis.document };
const originalValidate = InputValidator.validate;
prepareHistoricalDataOnce();
try {
    for (const household of MUSTER_HAUSHALTE) {
        const records = createMusterHaushaltRecords('2026-10-16', household.id);
        PersistenceFacade.resetPersistenceForTests({ name: 'BH-4-Seitenweg', async init() {},
            async loadAll() { return { ...records }; }, async saveBatch() {} });
        await PersistenceFacade.init({ installLifecycleHooks: false, installTauriCloseHook: false });
        const doc = simulatorDocument();
        globalThis.document = doc;
        globalThis.window = { EngineAPI, addEventListener() {}, removeEventListener() {} };
        // Reihenfolge wie simulator-main-init; keine Dialoge, Server oder Browser.
        initInputPersistence();
        initDynamicFlexControls({ enableLocalPersistence: false });
        initSimulatorProfileSelection();
        initSimulatorPlanTrial();
        assertEqual(window.__profileRecoveryBlocker, null, `${household.name}: Profilübernahme erfolgreich`);
        const planValues = Object.values(JSON.parse(records.household_plan_v1).entries)[0].values;
        const trial = getSimulatorPlanTrial(doc);
        for (const preset of ['Vorgabe', 'ausgewogen', 'offensiv']) {
            if (preset !== 'Vorgabe') {
                assert(trial.start(), 'Lokaler Planversuch startet');
                doc.getElementById('dynamicFlexPreset').value = preset;
                doc.getElementById('dynamicFlexPreset').dispatchEvent({ type: 'change' });
            }
            const inputs = validateSimulatorInputs(getCommonInputs());
            const label = `${household.name}, ${preset}`;
            assertEqual(inputs.dynamicFlex, preset === 'Vorgabe' ? planValues.dynamicFlex : true, label + ': Dynamic Flex über den Formularweg');
            assertEqual(inputs.decumulation.mode, planValues.decumulation.mode, label + ': Entnahmestrategie erhalten');
            if (preset !== 'Vorgabe') {
                assertEqual(inputs.horizonMethod, preset === 'offensiv' ? 'mean' : 'survival_quantile', label + ': Horizontmethode');
                assertEqual(inputs.goGoMultiplier, preset === 'offensiv' ? 1.2 : 1.1, label + ': Go-Go-Faktor');
            }
            const people = readDocumentPersonInputs();
            for (const entry of people.entries) assert(inputs.detailledTranches.some(lot => lot.sourceProfileId === entry.profileId), label + ': persönliche Tranchen');
            if (household.id === 'helga-werner') {
                assertEqual(inputs.startAlter, 74, 'Helgas Alter erreicht den Runner');
                assertEqual(inputs.partner.startAlter, 76, 'Werners Alter erreicht den Runner');
                assertEqual(inputs.kirchensteuerSatz, 0.09, '9 % Kirchensteuer erreicht den Runner');
                assert(people.combined.healthBucketEnabled && people.combined.healthBucketInitialAmount === 60000, 'FR-36: Profilprojektion summiert beide Pflegereserven zu 60.000 EUR');
                assert(inputs.pflegefallLogikAktivieren && inputs.pflegeGradeConfigs[4].zusatz > 0, 'Pflegeszenario wird aus dem Formular gelesen');
            }
            if (inputs.goldAktiv) {
                assertEqual(inputs.goldZielProzent, household.id === 'helga-werner' ? 20 : 10, label + ': Goldziel');
                assertEqual(inputs.goldFloorProzent, household.id === 'helga-werner' ? 10 : 5, label + ': Gold-Untergrenze');
                assert(inputs.goldSteuerfrei, label + ': Goldsteuerfreiheit');
                assertClose(inputs.rebalancingBand, 20, 1e-9, label + ': Umschichtungsband');
            }
            // Beobachtet exakt normalizedInput in engine/core, ohne die Prüfung zu ersetzen.
            let firstNormalized, invalidFields = [];
            InputValidator.validate = input => {
                const result = originalValidate(input);
                firstNormalized ||= structuredClone(input);
                invalidFields.push(...result.errors.map(error => ({ ...error, value: input[error.fieldId] })));
                return result;
            };
            const result = runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2025 },
                historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
                simulateYear: (...args) => simulateOneYear(...args, null, 0, null, 1, EngineAPI),
                computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
                totalPortfolio: portfolioTotal, breakOnRuin: true });
            assert(firstNormalized, label + ': Backtest erreicht den ersten Engineaufruf');
            assertEqual(JSON.stringify(invalidFields), '[]', label + ': gültiger normalizedInput im Backtest');
            assert(['completed', 'ruin'].includes(result.outcome.kind), label + ': Backtest ohne technischen Fehler');
            if (preset === 'Vorgabe') assertEqual(result.rows.length, 26, label + ': Backtest 2000–2025 vollständig');
            if (household.id === 'renate' && preset === 'Vorgabe') {
                const entry = result.rows.find(entry => entry.row.vk?.vkBnd > 0 && !entry.row.kaufAkt && !entry.row.bondRefillGross && !entry.row.threeBucket?.bondRefillGross);
                assert(entry, 'Renates Protokoll enthält ein Jahr mit Anleihenverkauf ohne Gegenkäufe');
                const options = { source: 'backtest', strategyMode: inputs.decumulation.mode, goldAktiv: inputs.goldAktiv };
                const columns = getProtocolColumns(options), read = id => readProtocolValue(columns.find(column => column.id === id), entry, options);
                assertClose(read('neta') + read('handl-bd'), entry.row.vk.vkGes, 1e-6,
                    'Renate: Aktienhandel und Anleihenhandel ergeben zusammen den Verkauf aus der Handlung');
                assertClose(read('sale-bonds'), entry.row.vk.vkBnd, 1e-6, 'Renates Protokoll weist den Anleihenverkauf separat aus');
            }
            if (household.id === 'jan-lena') {
                assertEqual(inputs.plannedInflowsReferenceYear, 2026, label + ': Zuflussjahr folgt dem Personenbezugsjahr');
                assertEqual(inputs.plannedInflows.length, 2, label + ': beide persönlichen Zuflüsse über den Seitenweg');
                assertEqual(result.rows[2].row.zufluss, 40000, label + ': Jans Erbe im dritten Backtestjahr');
                assertEqual(result.rows[5].row.zufluss, 60000, label + ': Lenas Verkauf im sechsten Backtestjahr');
            }
            firstNormalized = null; invalidFields = [];
            const chunk = await runMonteCarloChunk({ inputs,
                monteCarloParams: { anzahl: 4, maxDauer: 35, blockSize: 3, seed: 12345, methode: 'regime_markov',
                    rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
                widowOptions: inputs.widowOptions, useCapeSampling: doc.getElementById('useCapeSampling').checked,
                // Pfad 846 scheiterte im 16. Jahr beim Verkauf wieder aufgefüllter Anleihen.
                runRange: { start: household.id === 'helga-werner' ? 846 : 0, count: 4 }, engine: EngineAPI });
            assert(firstNormalized, label + ': Monte Carlo erreicht den ersten Engineaufruf');
            assertEqual(JSON.stringify(invalidFields), '[]', label + ': gültiger normalizedInput in Monte Carlo');
            if (household.id === 'jan-lena') {
                for (const run of chunk.runMeta) {
                    const log = run.logDataRows;
                    assertEqual(log[2].zufluss, 40000, label + ': Jans Erbe im dritten Monte-Carlo-Jahr');
                    assertEqual(log[5].zufluss, 60000, label + ': Lenas Verkauf im sechsten Monte-Carlo-Jahr');
                    assertEqual(log[2].zufluss_personen[0].profileId, 'muster_jan', label + ': persönlicher Zufluss bleibt zugeordnet');
                }
            }
            assertEqual(chunk.batchStatus, 'completed', label + ': Monte Carlo ohne Abbruch');
            assertEqual(chunk.technicalInventory.financiallyEvaluable, 4, label + ': vier Pfade auswertbar');
            assertEqual(chunk.technicalInventory.technicalError, 0, label + ': keine technischen Pfadfehler');
            assert(chunk.totals.totalSimulatedYears > 0, label + ': Finanzjahre tatsächlich gerechnet');
            InputValidator.validate = originalValidate;
            if (preset !== 'Vorgabe') trial.reset();
        }
    }
} finally {
    InputValidator.validate = originalValidate;
    Object.assign(globalThis, previous);
    PersistenceFacade.resetPersistenceRuntimeForTests();
}
