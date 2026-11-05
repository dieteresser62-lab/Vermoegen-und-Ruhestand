// Ausschließlich synthetische Muster: gepaarte Pfade für jährliche Wohnrechtsteuer nach FR-64.
import { writeFileSync } from 'node:fs';
import { measurementInputs, parameters, hash } from '../tests/helpers/ek-1b-measurement.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { quantile } from '../app/simulator/simulator-utils.js';
import { EngineAPI } from '../engine/index.mjs';
import { inheritancePreview, residenceAnnualValue } from '../app/profile/household-partnership.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';

const count = Number(process.argv[3] || 2000), results = {};
const modes = ['sofort', 'jaehrlich', 'miete1500-sofort', 'miete1500-jaehrlich', 'miete1050-jaehrlich', 'miete1950-jaehrlich'];
function configure(inputs, mode) {
    if (mode.endsWith('jaehrlich')) inputs.partnership.testament.muster_martin.residenceTax = 'annual';
    const rent = /^miete(\d+)/.exec(mode);
    if (rent) inputs.home.find(home => home.profileId === 'muster_martin').ortsueblicheMiete = Number(rent[1]);
    return inputs;
}
for (const mode of modes) {
    const inputs = configure(await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament'), mode);
    let paymentYears = 0, entitledPaths = 0, yearlyTaxes = 0;
    let failed = 0, technical = 0, taxes = 0, estates = 0, sales = 0, martinFirst = 0, zeroHomeDeath = null;
    const petraEndReal = [], chunks = [];
    for (let start = 0; start < count; start += 100) {
        const size = Math.min(100, count - start);
        const chunk = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: count },
            widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start, count: size },
            logIndices: Array.from({ length: size }, (_, index) => start + index) });
        failed += chunk.totals.failCount; technical += chunk.technicalInventory.technicalError; chunks.push(hash(chunk));
        for (const run of chunk.runMeta) {
            const rows = run.logDataRows || [], death = rows.find(row => row.inheritance);
            for (const row of rows) if (row.immobilien_notverkauf) sales += row.immobilienverkauf_personen?.length || 0;
            if (!death) continue;
            const annualRows = rows.filter(row => row.residenceTaxPayment);
            const payments = annualRows.reduce((sum, row) => sum + (row.wohnrechtsteuer || 0), 0);
            yearlyTaxes += payments;
            paymentYears += annualRows.filter(row => row.wohnrechtsteuer > 0).length;
            taxes += death.erbschaftsteuer + payments; estates++;
            if (death.inheritance.residenceTax) entitledPaths++;
            if (death.inheritance.deceasedProfileId !== 'muster_martin') continue;
            martinFirst++;
            const last = rows.findLast(row => row.financiallyEvaluable);
            petraEndReal.push(run.failed ? 0 : last ? last.portfolio_total_end / (last.inflation_factor_cum * (1 + last.inflation / 100)) : 0);
            if (!zeroHomeDeath && death.immobilien_wert_end === 0) zeroHomeDeath = { runIndex: run.index, year: death.jahr };
        }
        console.log(`${mode}: ${start + size}/${count}`);
    }
    results[mode] = { inputHash: hash(inputs), chunks, evaluable: count - technical, technical, coveredPct: 100 * (count - technical - failed) / (count - technical),
        ruin: failed, petraAfterMartinPaths: martinFirst, petraEndRealP10: quantile(petraEndReal, .1), petraEndRealMedian: quantile(petraEndReal, .5),
        inheritanceEvents: estates, meanInheritanceTaxNominal: taxes / estates,
        totalAnnualPaymentsNominal: yearlyTaxes, meanAnnualPaymentsNominalPerEstate: yearlyTaxes / estates,
        annualTaxEstates: entitledPaths, meanPaymentYearsPerAnnualEstate: entitledPaths ? paymentYears / entitledPaths : 0, emergencyHomeSales: sales, zeroHomeDeath };
}
const previewInputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
const records = createMusterHaushaltRecords('2026-10-23', 'martin-petra', 'testament');
const registry = JSON.parse(records.rs_profiles_v1), martin = registry.profiles.muster_martin.data;
const cash = Number(martin.profile_tagesgeld);
const lots = JSON.parse(martin.depot_tranchen);
const moneyAssets = cash + lots.reduce((sum, lot) => sum + lot.shares * lot.currentPrice, 0);
const previews = {};
for (const mode of modes.slice(0,4)) {
    const current = configure(structuredClone(previewInputs), mode);
    const home = current.home.find(home => home.profileId === 'muster_martin');
    previews[mode] = inheritancePreview(moneyAssets, home.wert, 100/3, { exemptHome: home.wert,
        partnerAge: current.partner.startAlter, testament: current.partnership.testament.muster_martin,
        residenceValue: residenceAnnualValue(home.wert, home.ortsueblicheMiete) });
}
const report = { testDate: '2026-10-23', parameters: { ...parameters, anzahl: count },
    metricBasis: 'Petras letztes Geldvermögen vor Tod/Horizontende in Startkaufkraft, nur Martin-zuerst, Ruin=0. Steuer inklusive aller §23-Zahlungen nominal je Erbfall. Laufzeit: Jahre mit positiver Zahlung je jährlichem Wohnrechtserbfall, durch Tod/Heim/Ruin/Horizont begrenzt.',
    previews, results };
report.counterchecks = [];
for (const [startYear, endYear] of [[2000, 2025], [1930, 1964]]) for (const mode of modes.slice(0,4)) {
    const inputs = configure(await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament'), mode);
    // Der normale Backtest zieht keine Todesfälle. Diese Gegenprobe setzt den Tod
    // ausdrücklich im elften Jahr und verwendet ansonsten den echten Jahrespfad.
    const result = runHistoricalBacktest({ inputs, period: { startYear, endYear },
        historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
        simulateYear: (state, current, data, index) => simulateOneYear(state, current, data, index, null, 0,
            index >= 10 ? { p1Alive: false, p2Alive: true } : null, 1, EngineAPI),
        computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon, totalPortfolio: portfolioTotal, breakOnRuin: true });
    const estate = result.rows.find(entry => entry.row.inheritance)?.row.inheritance;
    report.counterchecks.push({ mode, period: `${startYear}-${endYear}`, deathYear: startYear + 10, outcome: result.outcome.kind,
        rowCount: result.rows.length, finalMoney: result.rows.at(-1)?.row.portfolio_total_end, tax: estate?.tax, hash: hash(result) });
}
writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([mode, { chunks, ...metrics }]) => [mode, metrics]))));
