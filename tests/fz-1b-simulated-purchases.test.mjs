import { readFileSync } from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { calculateSaleAndTax } from '../engine/transactions/sale-engine.mjs';
import { buildDetailedTranchesFromPortfolio } from '../app/simulator/simulator-engine-direct-utils.js';
import { buyStocksNeu, initializePortfolioDetailed } from '../app/simulator/simulator-portfolio.js';
import { HOUSEHOLD_PURCHASES_KEY, parseHouseholdEquityPurchases } from '../app/simulator/simulator-household-purchases-persistence.js';
import { PROFILE_BUNDLE_GLOBAL_KEYS } from '../app/profile/profile-bundle-io.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../app/profile/profile-state.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { isAllowedSnapshotCaptureKey } from '../app/shared/persistence-key-policy.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { backtest, hash, measurementInputs, parameters } from './helpers/ek-1b-measurement.mjs';

assert(PROFILE_BUNDLE_GLOBAL_KEYS.includes(HOUSEHOLD_PURCHASES_KEY) && !PROFILE_SCOPED_FIXED_KEYS.includes(HOUSEHOLD_PURCHASES_KEY),
    'FR-97: Die Seitenübergabe hält die Auswahl beim Haushalt');
assert(isAllowedSnapshotCaptureKey(HOUSEHOLD_PURCHASES_KEY), 'FR-97: Wiederherstellungspunkt enthält die Haushaltswahl');
assert(validatePersistenceDomainRecords({ [HOUSEHOLD_PURCHASES_KEY]: 'separate' }).ok, 'FR-97: Gültige Haushaltswahl ist einspielbar');
assert(!validatePersistenceDomainRecords({ [HOUSEHOLD_PURCHASES_KEY]: 'invalid' }).ok, 'FR-97: Sicherungsimport weist ungültige Haushaltswahl ab');
assertEqual(parseHouseholdEquityPurchases(''), 'same', 'FZ-1c: Leerer Wert gilt wie ein fehlender als Vorgabe');
assert(validatePersistenceDomainRecords({ [HOUSEHOLD_PURCHASES_KEY]: '' }).ok, 'FZ-1c: Sicherung mit leerem Wert blockiert den Import nicht');

const oldLot = {
    schemaVersion: 2, trancheId: 'bestand', sourceProfileId: 'beispiel',
    name: 'Muster-ETF', isin: 'IE00BK5BQT80', type: 'aktien_neu', category: 'equity',
    shares: 300, purchasePrice: 40, currentPrice: 100, purchaseDate: '2016-06-15',
    marketValue: 30000, costBasis: 12000, tqf: 0.3, taxExempt: false
};

for (const [mode, isin, expectedLot, tax] of [
    ['same', oldLot.isin, oldLot.trancheId, 326.27],
    ['separate', '', null, 0]
]) {
    const portfolio = initializePortfolioDetailed({ detailledTranches: [oldLot], simulatedEquityPurchases: mode });
    portfolio.simulationDate = '2001-12-31';
    const purchase = buyStocksNeu(portfolio, 10000);
    const sale = calculateSaleAndTax(5000, {
        detailledTranches: buildDetailedTranchesFromPortfolio(portfolio),
        sparerPauschbetrag: 1000, kirchensteuerSatz: 0, goldAktiv: false
    }, {}, { sKey: 'bull' }, false);
    assertEqual(purchase.isin, isin, `${mode}: ISIN des Zukaufs`);
    assertEqual(purchase.tqf, 0.3, `${mode}: Teilfreistellung aus der Vorlage`);
    assertEqual(sale.breakdown[0].trancheId, expectedLot ?? purchase.trancheId, `${mode}: zuerst verkaufte Tranche`);
    assertClose(sale.steuerGesamt, tax, 0.01, `${mode}: Steuer für 5.000 € netto`);
}

// Die PH1-Referenz vor FZ-1 wurde zusätzlich auf Produktiv 24456187 nachgemessen.
const reference = JSON.parse(readFileSync(new URL('./fixtures/fz-1-expectation-deltas.json', import.meta.url), 'utf8')).messung.vorher;
for (const household of ['max-erika', 'renate']) {
    const inputs = await measurementInputs(0, household, '2026-10-28', 'grund',
        records => ({ ...records, [HOUSEHOLD_PURCHASES_KEY]: 'separate' }));
    const historical = backtest(inputs);
    const { request } = historical;
    const { simulatedEquityPurchases, ...requestInputs } = request.inputs;
    assertEqual(simulatedEquityPurchases, 'separate', `${household}: Haushaltswahl im Laufbeleg`);
    // Der Laufbeleg führt die neue Auswahl. Alle übrigen Bytes waren bereits Teil der Produktivrechnung.
    assertEqual(hash({ ...historical, request: { ...request, inputs: requestInputs } }), reference[household].backtest,
        `${household}: Backtest bytegleich zu Produktiv`);

    const count = 40;
    const { personOutcomeCounts, ...monteCarlo } = await runMonteCarloChunk({
        inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: count },
        widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 0, count },
        logIndices: Array.from({ length: count }, (_, index) => index), collectPersonOutcomes: true
    });
    assertEqual(hash(monteCarlo), reference[household].monteCarlo, `${household}: Monte-Carlo-Rechnung bytegleich zu Produktiv`);
}
