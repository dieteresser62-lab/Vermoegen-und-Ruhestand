/** RNG-1, ausschließlich synthetische Haushalte.
 * node scripts/measure-rng-1.mjs <Quellordner> <Ausgabe.json> [uniform,sampling,mc,deterministic,calibration]
 * Für Alt/Neu getrennte Prozesse verwenden; Alt = git archive HEAD vor RNG-1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [source = '.', output, selection = 'uniform,sampling,mc,deterministic,calibration'] = process.argv.slice(2);
if (!output) throw new Error('Quellordner und Ausgabe fehlen.');
const load = file => import(pathToFileURL(resolve(source, file)));
const { rng, makeRunSeed, quantile } = await load('app/simulator/simulator-utils.js');
const { annualData, REGIME_DATA } = await load('app/simulator/simulator-data.js');
const helpers = await load('app/simulator/simulator-engine-helpers.js');
const { EngineAPI } = await load('engine/index.mjs');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const q = (values, p) => values.length ? quantile(values, p) : null;
const result = { schemaVersion: 'RNG1MeasurementV1', seed: 12345, runtime: process.version, measurements: {} };
const save = () => writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
const html = readFileSync(resolve(source, 'Simulator.html'), 'utf8');
const defaultValue = id => Number(html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0].match(/\bvalue="([^"]*)"/)?.[1]);
// Seit FR-75 ist das Feld leer (automatisch); die RNG-1-Messung bleibt bei 35 Jahren.
const defaults = { anzahl: 2000, maxDauer: defaultValue('mcDauer') || 35, blockSize: defaultValue('mcBlockSize'),
    seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' };

for (const part of selection.split(',')) {
    if (part === 'uniform') {
        const random = rng(12345), n = 1000000;
        let sum = 0, below01 = 0, below0295 = 0, below05 = 0;
        for (let i = 0; i < n; i++) {
            const u = random(); sum += u; below01 += u < .1; below0295 += u < .295; below05 += u < .5;
        }
        result.measurements.uniform = { draws: n, mean: sum / n, below01: below01 / n,
            below0295: below0295 / n, below05: below05 / n };
    } else if (part === 'sampling') {
        const sampling = await load('app/simulator/mc-year-sampling.js');
        const rows = {};
        for (const method of ['regime_markov', 'regime_iid', 'block', 'stationary']) {
            const config = sampling.resolveMonteCarloSamplingContractV1({ method, inputs: {}, annualData,
                useCapeSampling: false, startYearMode: 'UNIFORM', blockSize: defaults.blockSize });
            let logSum = 0;
            const factors = [], counts = Object.fromEntries(Object.keys(REGIME_DATA).map(key => [key, 0]));
            for (let path = 0; path < 20000; path++) {
                const random = rng(makeRunSeed(12345, 0, path));
                const startYearIndex = sampling.pickMonteCarloStartYearIndex({ rand: random, inputs: {}, annualData,
                    useCapeSampling: false, samplingContract: config });
                const state = { samplerState: {} };
                sampling.initializeMonteCarloSamplingStateV1({ state, method, blockSize: defaults.blockSize,
                    rand: random, startYearIndex, samplingResolution: config, annualData });
                let log = 0;
                for (let year = 0; year < 24; year++) {
                    const { yearData: data } = sampling.sampleMonteCarloYearV1({ state, method, blockSize: defaults.blockSize,
                        rand: random, samplingResolution: config, annualData, sampleNextYearData: helpers.sampleNextYearData });
                    log += Math.log((1 + data.rendite) / (1 + data.inflation / 100)); counts[data.regime]++;
                }
                logSum += log; factors.push(Math.exp(log));
            }
            const poolIndices = config.effectiveYearSamplingConfig?.allowedIndices || [];
            rows[method] = { paths: 20000, years: 24, blockSize: defaults.blockSize, cape: false,
                effectivePoolYears: poolIndices.map(index => annualData[index].jahr),
                effectivePoolMeanRealLogReturnPct: 100 * mean(poolIndices.map(index => Math.log((1 + annualData[index].rendite) / (1 + annualData[index].inflation / 100)))),
                meanRealLogReturnPct: 100 * logSum / (20000 * 24), median24YearFactor: q(factors, .5), regimeYearCounts: counts };
        }
        result.measurements.sampling = { reference: { start: 1925, end: 2025,
            meanRealLogReturnPct: 100 * mean(annualData.map(d => Math.log((1 + d.rendite) / (1 + d.inflation / 100)))),
            regimeCounts: Object.fromEntries(Object.entries(REGIME_DATA).map(([key, pool]) => [key, pool.length])) }, methods: rows,
            counting: 'Reiner Marktdatenpfad über den produktiven Samplingvertrag; eigener makeRunSeed(12345,0,Laufindex), keine Lebensereignisse.' };
    } else if (part === 'calibration') {
        const { calibrateCareModel } = await load('scripts/calibrate-care-model.mjs');
        result.measurements.calibration = calibrateCareModel();
    } else if (part === 'mc' || part === 'deterministic') {
        const { measurementInputs } = await load('tests/helpers/ek-1b-measurement.mjs');
        const { inputs: pairFixture, runFixture, source: paritySource } = await load('tests/extended/parity-replay-fixture.mjs');
        const { readCareInputs } = await load('app/simulator/simulator-input-care.js');
        const careDefaults = readCareInputs({ doc: { getElementById(id) {
            const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))?.[0];
            return tag ? { value: tag.match(/\bvalue="([^"]*)"/)?.[1] ?? '', checked: /\bchecked\b/.test(tag) } : null;
        } } });
        const scenarios = {};
        for (const name of ['max-erika', 'sophie']) scenarios[name] = { ...await measurementInputs(0, name), ...careDefaults,
            pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch' };
        scenarios['today-slower'] = { ...structuredClone(pairFixture), ...careDefaults, startAlter: 60,
            partner: { ...pairFixture.partner, startAlter: 63 }, pflegefallLogikAktivieren: true, pflegeModellTyp: 'chronisch',
            careToday: { grade: 2, additionalMonthly: null, progression: 'slower', allowanceAsIncome: false } };
        const scenariosResult = {};
        if (part === 'deterministic') {
            const { runParityScenarios } = await load('tests/extended/parity-scenarios.mjs');
            for (const [name, inputs] of Object.entries(scenarios)) {
                const backtest = runFixture({ input: inputs, selectedPeriod: { startYear: 1965, endYear: 2011 } });
                if (backtest.outcome.kind !== 'completed') throw new Error('Backtest nicht auswertbar.');
                scenariosResult[name] = { inputSha256: hash(inputs), backtestSha256: hash(backtest),
                    backtestBytes: Buffer.byteLength(JSON.stringify(backtest)), rows: backtest.rows.length };
            }
            const parity = runParityScenarios({ source: paritySource });
            if (parity.failed) throw new Error('Parität fehlgeschlagen.');
            result.measurements.deterministic = { scenarios: scenariosResult, balanceParityCasesSha256: hash(parity.cases),
                balanceParityCaseCount: parity.cases.length, counting: 'Vollständige Backtest-Ausgaben und Paritätsfälle byteweise über JSON.stringify/SHA-256; feste synthetische Quellidentität aus parity-replay-fixture, keine Feldfilter.' };
        } else {
            const { runMonteCarloChunk } = await load('app/simulator/monte-carlo-runner.js');
            const { MONTE_CARLO_MISSINGNESS_CODE } = await load('app/simulator/monte-carlo-chunk-result.js');
            const { createStressReplayCaptureRequest } = await load('app/simulator/stress-replay-path-materializer.js');
            for (const [name, inputs] of Object.entries(scenarios)) {
                const wealth = [], budgets = [], withdrawalP10s = [], careYears = [], householdCareYears = [], restrictedYears = [];
                const aliveYears = [[], []], deathAges = [[], []], censored = [0, 0];
                let failures = 0, carePaths = 0;
                const digest = createHash('sha256');
                for (let start = 0; start < defaults.anzahl; start += 50) {
                    const count = Math.min(50, defaults.anzahl - start), indices = Array.from({ length: count }, (_, i) => start + i);
                    const chunk = await runMonteCarloChunk({ inputs, monteCarloParams: defaults,
                        widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count },
                        logIndices: new Set(indices), stressReplayCapture: createStressReplayCaptureRequest(indices), engine: EngineAPI });
                    if (!chunk.financialMetricsValid || chunk.batchStatus !== 'completed' || chunk.technicalInventory.technicalError) throw new Error('Technischer MC-Fehler.');
                    digest.update(JSON.stringify(chunk)); failures += chunk.totals.failCount;
                    const s = chunk.pathSummaries;
                    wealth.push(...s.finalValueRealEur); restrictedYears.push(...s.minimumFlexAffectedYearCount);
                    for (let i = 0; i < count; i++) if (chunk.pathMissingness.realWithdrawalP10RealEur[i] === MONTE_CARLO_MISSINGNESS_CODE.OBSERVED) withdrawalP10s.push(s.realWithdrawalP10RealEur[i]);
                    for (const meta of chunk.runMeta) {
                        const years = meta.stressReplayCapture.years;
                        const payments = meta.logDataRows.filter(row => row.recordType === 'financial_year' && row.Regime !== 'accumulation')
                            .map(row => (row.floor_brutto + row.flex_haushalt_erfuellt) / row.inflation_factor_cum);
                        if (payments.some(value => !Number.isFinite(value))) throw new Error('Budgetdaten fehlen.');
                        if (payments.length) budgets.push(mean(payments));
                        let hadCare = false, personYearsInCare = 0, yearsWithAnyCare = 0;
                        for (const year of years) {
                            const e = year.householdEvents[0];
                            let careThisYear = false;
                            for (const p of [1, 2]) {
                                const alive = e?.[`p${p}Alive`];
                                if (e?.[`careMetaP${p}`]?.active) { hadCare = careThisYear = true; personYearsInCare += alive === 1 ? 1 : .5; }
                            }
                            if (careThisYear) yearsWithAnyCare++;
                        }
                        for (const p of [1, 2]) {
                            if (p === 2 && !inputs.partner?.aktiv) continue;
                            let duration = 0, died = false;
                            for (const year of years) {
                                const e = year.householdEvents[0];
                                if (e) duration += e[`p${p}Alive`] === 1 ? 1 : .5;
                                if (e && e[`p${p}Alive`] === 0) { died = true; break; }
                            }
                            aliveYears[p - 1].push(duration);
                            if (died) deathAges[p - 1].push((p === 1 ? inputs.startAlter : inputs.partner.startAlter) + duration);
                            else censored[p - 1]++;
                        }
                        carePaths += hadCare; careYears.push(personYearsInCare); householdCareYears.push(yearsWithAnyCare);
                    }
                    if ((start + count) % 500 === 0) console.log(`${name}: ${start + count}/${defaults.anzahl}`);
                }
                scenariosResult[name] = { inputSha256: hash(inputs), completeChunksSha256: digest.digest('hex'),
                    startAges: [inputs.startAlter, inputs.partner?.aktiv ? inputs.partner.startAlter : null],
                    successPct: 100 * (defaults.anzahl - failures) / defaults.anzahl,
                    endWealthRealP10: q(wealth, .1), endWealthRealP50: q(wealth, .5),
                    lifetime: aliveYears.map((values, i) => ({ meanYearsWithinHorizon: mean(values), meanObservedDeathAge: mean(deathAges[i]),
                        observedDeaths: deathAges[i].length, censoredAtHorizon: censored[i] })),
                    carePathsPct: 100 * carePaths / defaults.anzahl, meanCarePersonYearsPerHousehold: mean(careYears),
                    meanCalendarYearsWithCarePerHousehold: mean(householdCareYears),
                    meanYearsUnderMinimumFlex: mean(restrictedYears), budgetRealAnnualP10: q(budgets, .1), budgetObservedPaths: budgets.length,
                    withdrawalRealAnnualP10OfP10: q(withdrawalP10s, .1), withdrawalObservedPaths: withdrawalP10s.length };
                result.measurements.mc = { parameters: defaults, cape: false, scenarios: scenariosResult,
                    counting: 'App-Vorgabe (35 Jahre, Markov, Blockgröße 5), 2000 Pfade. Budget-P10 = P10 des mittleren realen Jahresverbrauchs (Grundbedarf inklusive Pflege plus gezahlter Haushaltsflex, einschließlich Einkommensdeckung) je Pfad über abgeschlossene Entnahmejahre. Zusätzlich Entnahme-P10 der App (P10 der jährlichen realen Entnahme-P10 je Pfad); fehlende Beobachtungen ausgeschlossen. Lebens- und Pflegezeiten einschließlich Schattenjahren nach Ruin, Sterbejahr halb. Lebensdauer am Horizont rechtszensiert; Haushaltspflegejahre zusätzlich als Kalenderjahre mit mindestens einer gepflegten Person.' };
                save();
            }
        }
    } else throw new Error(`Unbekannter Messteil: ${part}`);
    save();
    console.log(`${part} fertig`);
}
