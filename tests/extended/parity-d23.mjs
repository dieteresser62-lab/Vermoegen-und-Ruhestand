import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { measure, checkObserved } from './parity-d23-probes.mjs';
import { EngineAPI } from '../../engine/index.mjs';
import { sealParityCase } from '../../app/balance/parity-case.js';
import { hashParityReplayValue } from '../../app/simulator/parity-replay-contract.js';
import { compareParityField, compareParityTree, parityMeasurement, PARITY_TOLERANCES, summarizeParityFields } from '../../app/shared/parity-compare.js';

const directory = new URL('./fixtures/parity-d23/', import.meta.url);

/** Original D23 evidence is pinned byte for byte; observation is never regenerated. */
export function loadD23Fixtures() {
    const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', directory), 'utf8'));
    assert.equal(Object.keys(manifest).length, 13);
    return Object.entries(manifest).map(([file, hash]) => {
        const bytes = fs.readFileSync(new URL(file, directory));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `D23 fixture changed: ${file}`);
        return JSON.parse(bytes);
    });
}

// FR-8/FR-9: feste neue Sollwerte; historische JSON-Belege bleiben unverändert.
function expectedThreeBucketObservation(fixture) {
    const bad = fixture.id === '4-drei-toepfe-rendite';
    const taxable = fixture.id === '11-drei-toepfe-steuerreserve';
    const tax = taxable ? 3222.7622201742215 : 0;
    const refillGross = taxable ? 153231.58164269844 : bad ? 0 : 150000;
    const bonds = bad ? 0 : 150000;
    const cashUse = taxable ? 70008.81942252422 : bad ? 50000 : 60000;
    const balance = { is3Bucket: true, isBadYear: bad, bondBucketBefore: 50000,
        bondBucketAfter: bonds, bondRefillGross: refillGross, bondRefillNet: bonds,
        bondRefillTax: tax, bondSaleAmount: 50000, equityPreserved: bad ? 10000 : 0,
        unmetLiquidity: bad ? 10000 : 0 };
    const { is3Bucket, ...simulator } = balance;
    // Die Logform behält ihre bisherigen Diagnosefelder.
    const sim = { ...simulator };
    delete sim.equityPreserved; delete sim.unmetLiquidity;
    Object.assign(sim, { bondRefillDebugVersion: 'shared-finalizer-before-payout',
        bondRefillSaleShortfallGross: 0, equityPreserved: balance.equityPreserved,
        unmetLiquidity: balance.unmetLiquidity });
    const plannedAction = { type: 'TRANSACTION', tax,
        sources: [{ owner: 'muster_a', lot: 'muster_a:bond', kind: 'anleihe', gross: 50000, net: 50000, tax: 0 },
            ...(!bad ? [{ owner: 'muster_b', lot: 'muster_b:muster_b_lot_2', kind: 'aktien_neu',
                gross: taxable ? 173231.58164269844 : 160000,
                net: taxable ? 170008.81942252422 : 160000, tax }] : [])],
        uses: { liquiditaet: cashUse, gold: 0, aktien: 0, ...(!bad ? { bonds } : {}) } };
    const cash = 90000 + cashUse;
    const payout = bad ? 28800 : 30000;
    return { nominalReturn: fixture.yearData.rendite,
        simulatorRealReturn: fixture.observed.balanceRealReturn,
        balanceRealReturn: fixture.observed.balanceRealReturn,
        simulator: sim, balance, balanceError: null,
        simulatorPlannedAction: plannedAction, balancePlannedAction: plannedAction,
        simulatorBondBeforePayout: bonds, simulatorBondAtEnd: bonds,
        balanceBondAfterTransaction: bonds, deltaBondAfterTransaction: 0, deltaBondAtEnd: 0, flowDelta: 0,
        phases: [{ phase: 'after_returns', bonds: 50000, cash: 90000 },
            { phase: 'after_action_sales', bonds: 0, cash },
            { phase: 'after_forced_sales', bonds: 0, cash },
            { phase: 'after_buys', bonds, cash },
            ...['after_payout', 'after_cash_interest', 'after_tax_reconciliation']
                .map(phase => ({ phase, bonds, cash: cash - payout }))] };
}

export function createD23ParityCase(fixture) {
    const bytes = JSON.stringify(fixture);
    const actual = measure(fixture);
    assert.equal(JSON.stringify(fixture), bytes, 'D23 source mutated');
    // Die Originalbytes bleiben als Ausgangsbeleg erhalten; entschiedene Regeln haben neue Sollwerte.
    const expected = fixture.kind === 'household'
        ? { ...fixture.observed, simulator: fixture.observed.balance,
            simulatorPersonalTax: fixture.observed.balancePeople.map(({ id, tax, lossCarry }) => ({ id, tax, lossCarry })),
            deltaTax: 0, deltaGross: 0,
            simulatorPersonalPayout: [{ id: 'muster_b', withdrawal: 28800 }, { id: 'muster_a', withdrawal: 0 }] }
        : fixture.kind === 'cash'
        ? { historicalDeltaLiquidity: fixture.observed.deltaLiquidity, historicalDeltaRunway: fixture.observed.deltaRunway,
            simulatorPool: 135309.1603862919, componentSum: 135309.1603862919,
            simulatorRunway: 73.14008669529291, componentRunway: 73.14008669529291,
            deltaLiquidity: 0, deltaRunway: 0, personalAccountDelta: 0, personalAccounts: ['muster_a', 'muster_b'] }
        : fixture.kind === 'three_bucket' ? expectedThreeBucketObservation(fixture)
        : fixture.kind === 'horizon'
        ? fixture.observed.map(variant => ({ ...variant,
            balanceHorizon: variant.simulatorHorizon, deltaHorizonYears: 0,
            balanceWithdrawal: variant.simulatorWithdrawal, deltaAnnual: 0,
            balanceDynamicFlex: variant.simulatorDynamicFlex, deltaDynamicFlex: 0 }))
        : fixture.kind === 'reset'
        ? { ...fixture.observed, balanceWithPreviousEvidence: fixture.observed.balanceWithCurrentEvidence,
            previousStateKeys: Object.keys(fixture.lastState), deltaAnnual: 0 }
        : fixture.kind === 'partner_pension'
        ? { ...fixture.observed, simulatorPension: 46800, simulatorPartnerPension: 19200, deltaAnnualIncome: 0 }
        : fixture.kind === 'ath'
            ? { ...fixture.observed, simulatorAth: 110, deltaAth: 0, simulatorYearsSince: 0,
                deltaYearsSince: 0, simulatorDistancePct: 0 }
            : fixture.kind === 'pension_rounding'
                ? { annualPension: fixture.observed.annualPension, balanceAnnualPension: fixture.observed.annualPension,
                    simulatorMonthlyBudget: fixture.observed.simulatorMonthlyBudget,
                    balanceMonthlyBudget: fixture.observed.simulatorMonthlyBudget, deltaMonthly: 0, deltaAnnualIncome: 0 }
                : fixture.kind === 'annual_rounding'
                    ? { ...fixture.observed, balanceNextFloor: fixture.observed.simulatorNextFloor, deltaFloor: 0,
                        balanceNextMinimumFlex: fixture.observed.simulatorNextMinimumFlex, deltaMinimumFlex: 0,
                        balanceInflation: fixture.observed.simulatorInflation, deltaInflationPctPoints: 0,
                        balanceCape: fixture.observed.simulatorCape, deltaCape: 0,
                        balanceEndPrice: fixture.observed.simulatorEndPrice, deltaEndPrice: 0 }
                    : fixture.observed;
    checkObserved(actual, expected, fixture.id);
    const fields = [];
    const add = (id, a, b, tolerance = 'EUR', options = {}) => {
        const phase = options.phase || 'VOR_TRANSAKTION';
        fields.push(compareParityField({ id, tolerance, category: 'EINGABE', phase, ...options,
            simulator: parityMeasurement(a, { phase, path: `D23.simulator.${id}` }),
            balance: parityMeasurement(b, { phase, path: `D23.balance.${id}` }) }));
    };
    switch (fixture.kind) {
    case 'reset':
        add('annualWithdrawal', actual.simulator.withdrawal, actual.balanceWithPreviousEvidence.withdrawal, 'EUR');
        add('monthlyBudget', actual.simulator.budget / 12, actual.balanceWithPreviousEvidence.budget / 12, 'EUR');
        add('stateKeys', Object.keys(fixture.lastState), actual.previousStateKeys, 'EXACT', { category: 'VORZUSTAND' });
        break;
    case 'household':
        fields.push(...compareParityTree({ id: 'sources', simulator: actual.simulator.sources, balance: actual.balance.sources,
            phase: 'NACH_TRANSAKTION', category: 'PERSONENVERTEILUNG', toleranceForKey: key => ['gross', 'net', 'tax'].includes(key) ? 'EUR' : 'EXACT',
            }));
        add('personalTax', actual.simulatorPersonalTax, actual.balancePeople.map(person => ({ id: person.id, tax: person.tax, lossCarry: person.lossCarry })), 'EXACT',
            { phase: 'NACH_TRANSAKTION' });
        add('personalPayout', [...actual.simulatorPersonalPayout].sort((a,b) => a.id.localeCompare(b.id)),
            actual.balancePeople.map(person => ({ id: person.id, withdrawal: person.withdrawal })).sort((a,b) => a.id.localeCompare(b.id)), 'EXACT',
            { phase: 'NACH_TRANSAKTION' });
        break;
    case 'horizon':
        for (const variant of actual) {
            add(`${variant.preset}.horizon`, variant.simulatorHorizon, variant.balanceHorizon, 'EXACT');
            add(`${variant.preset}.annualWithdrawal`, variant.simulatorWithdrawal, variant.balanceWithdrawal, 'EUR');
            add(`${variant.preset}.dynamicFlex`, variant.simulatorDynamicFlex, variant.balanceDynamicFlex, 'EUR');
        }
        break;
    case 'three_bucket':
        add('triggerReturn', actual.simulatorRealReturn, actual.balanceRealReturn, 'RATE');
        add('isBadYear', actual.simulator.isBadYear, actual.balance.isBadYear, 'EXACT');
        add('completeTransaction', actual.simulatorPlannedAction, actual.balancePlannedAction, 'EXACT',
            { phase: 'NACH_TRANSAKTION' });
        add('bondPhase', actual.simulatorBondBeforePayout, actual.balanceBondAfterTransaction, 'EUR',
            { phase: 'VOR_AUSZAHLUNG' });
        add('bondRestInventory', actual.simulatorBondAtEnd, actual.balanceBondAfterTransaction, 'EUR',
            { phase: 'JAHRESENDE', reason: 'isolated_fixture_without_post_payout_bond_trades' });
        add('balanceEngineError', actual.balanceError, null, 'EXACT', { phase: 'NACH_TRANSAKTION' });
        add('flowDelta', actual.flowDelta, 0, 'EUR', { phase: 'JAHRESENDE' });
        break;
    case 'pension_rounding':
        add('annualPension', actual.annualPension, actual.balanceAnnualPension, 'EUR');
        add('monthlyBudget', actual.simulatorMonthlyBudget, actual.balanceMonthlyBudget, 'EUR', { category: 'ENTSCHEIDUNG' });
        break;
    case 'cash':
        add('pooledCash', actual.simulatorPool, actual.componentSum, 'EUR');
        add('runway', actual.simulatorRunway, actual.componentRunway, 'RATE', { phase: 'VOR_AUSZAHLUNG' });
        add('personalAccounts', actual.personalAccountDelta, 0, 'EUR');
        break;
    case 'partner_pension':
        add('annualPension', actual.simulatorPension, actual.balancePension, 'EUR');
        add('partnerPension', actual.simulatorPartnerPension, actual.partnerGross, 'EUR');
        break;
    case 'ath':
        add('athRelative', actual.simulatorAth / fixture.price, actual.balanceAth / fixture.price, 'RATE');
        add('yearsSinceAth', actual.simulatorYearsSince, actual.balanceYearsSince, 'EXACT');
        add('distancePercent', actual.simulatorDistancePct, actual.balanceDistancePct, 'RATE');
        add('market', actual.simulatorMarket, actual.balanceMarket, 'EXACT', { category: 'ENTSCHEIDUNG' });
        break;
    case 'annual_rounding':
        for (const [key, a, b, tolerance] of [['floor', 'simulatorNextFloor', 'balanceNextFloor', 'EUR'],
            ['minimumFlex', 'simulatorNextMinimumFlex', 'balanceNextMinimumFlex', 'EUR'],
            ['inflation', 'simulatorInflation', 'balanceInflation', 'RATE'], ['cape', 'simulatorCape', 'balanceCape', 'RATE'],
            ['priceRounding', 'simulatorEndPrice', 'balanceEndPrice', 'RATE']]) add(key, actual[a], actual[b], tolerance);
        break;
    case 'liquidity_plan':
        for (const variant of actual) {
            add(`${variant.years}.target`, fixture.netFloor * variant.targetMonths / 12, variant.simulatorFloorNeed, 'EUR');
            add(`${variant.years}.minimumMonths`, variant.hardMinimumMonths, variant.engineHardMinimumMonths, 'RATE');
            add(`${variant.years}.minimumFlexRunway`, variant.hardMinimumMonths, variant.minimumFlexRunway, 'RATE');
        }
        break;
    default: throw new Error(`Unknown D23 probe ${fixture.kind}`);
    }
    const currentSources = Object.fromEntries(Object.keys(fixture.sourceHashes).map(file => {
        assert.match(file, /^(app|engine|types)\/[a-zA-Z0-9_./-]+\.(mjs|js)$/);
        assert.ok(!file.split('/').includes('..'));
        return [file, createHash('sha256').update(fs.readFileSync(new URL(`../../${file}`, import.meta.url))).digest('hex')];
    }));
    return sealParityCase({ schemaVersion: 'ParityCaseV1', id: fixture.id, kind: 'D23_PROBE',
        source: { revision: null, baselineRevision: fixture.sourceRevision, baselineSourceHashes: fixture.sourceHashes,
            engineVersion: EngineAPI.getVersion(), sourceHash: hashParityReplayValue(currentSources), sourceHashes: currentSources,
            datasetHash: hashParityReplayValue(fixture), temporalConventionId: 'D23_isolated_diagnostic' },
        configurationHash: hashParityReplayValue(fixture), phases: [...new Set(fields.map(field => field.phase))],
        replay: { fixture: structuredClone(fixture) }, expected, measured: actual,
        tolerances: { ...PARITY_TOLERANCES }, fields, summary: summarizeParityFields(fields),
        proofBoundary: 'D23 isolated diagnostic; injected controls are declared in original assumptions; no household parity approval' });
}

export function replayD23ParityCase(value) {
    const { caseHash, ...payload } = value;
    assert.equal(value.schemaVersion, 'ParityCaseV1');
    assert.equal(value.kind, 'D23_PROBE');
    assert.equal(caseHash, hashParityReplayValue(payload), 'D23 case hash');
    const actual = createD23ParityCase(value.replay.fixture);
    return { reproduced: actual.caseHash === caseHash, case: actual };
}

export function testParityD23() {
    const cases = loadD23Fixtures().map(createD23ParityCase);
    assert.equal(cases.length, 13);
    for (const value of cases) assert.equal(replayD23ParityCase(JSON.parse(JSON.stringify(value))).reproduced, true, value.id);
    const reserve = cases.find(value => value.id === '11-drei-toepfe-steuerreserve');
    assert.equal(reserve.summary.status, 'GLEICH');
    for (const value of cases.filter(value => value !== reserve)) assert.notEqual(value.summary.status, 'TECHNISCHER_FEHLER', value.id);
    assert.ok(!cases.some(value => value.fields.some(field => field.question === 3)), 'FR-10 ist entschieden');
    assert.equal(cases.find(value => value.id === '2-haushalt').fields.find(field => field.id === 'personalPayout').status, 'GLEICH');
    for (const id of ['2-haushalt', '4-drei-toepfe-rendite', '5-drei-toepfe-phase', '11-drei-toepfe-steuerreserve', '1-reset-2001', '1-reset-2002', '3-horizont', '6-jahresrentenrundung', '8-partnerrente', '9-ath-phase', '12-jahresfortschreibung-rundung', '7-cashaufteilung']) assert.equal(cases.find(value => value.id === id).summary.status, 'GLEICH', id);
    assert.ok(!cases.some(value => value.fields.some(field => [1, 2, 5, 6, 7].includes(field.question))), 'FR-8/FR-9/FR-12/FR-13/FR-14 sind entschieden');
    assert.equal(cases.find(value => value.id === '6-jahresrentenrundung').fields.find(field => field.id === 'monthlyBudget').withinTolerance, true);
    console.log('Parität D23: 13 unveränderte Ausgangsbelege und Einzelreplays geprüft; FR-8 bis FR-15 und persönliche Auszahlung gleich; Steuerreserve gedeckt.');
    return cases;
}
