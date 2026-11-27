import { createHash } from 'node:crypto';
import { applyHealthBucketInterest } from '../app/simulator/simulator-health-bucket.js';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { A, B, YEAR, couple, lot, single } from './helpers/nk-1b-cases.mjs';
import { readKL1Hash } from './helpers/kl-1-expectations.mjs';

const year = { ...YEAR, zinssatz: 2 };
const taxRate = .26375;
const reserve = { enabled: true, initialAmount: 30000, returnMode: 'cash_return' };

function run(inputs, accumulation, prepare = () => {}, household = null) {
    Object.assign(inputs, { equityCostPct: 0, jointAssessment: false, startSPB: 1000, kirchensteuerSatz: 0,
        transitionYear: 1, accumulationPhase: { enabled: accumulation, sparrate: 0 } });
    for (const person of inputs.simulationPeople) {
        Object.assign(person, { sparerPauschbetrag: 1000, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } });
    }
    const state = initMcRunState(inputs);
    prepare(state.portfolio);
    const result = simulateOneYear(state, inputs, year, 0, null, 0, household, 1, EngineAPI);
    assertEqual(result.kind, 'success', 'Das Testjahr ist berechenbar');
    return result;
}

const noCashHashes = [
    '4089547042860ebed2df7eae666a3ccd3efd5ea6052dce2a563ace3f7822d392',
    readKL1Hash('afedd5f6896ce801220cf3509b9584de87cd048810fff6de1778ab1bde14e34a')
];
for (const accumulation of [false, true]) {
    const inputs = single({ cash: 80000, lots: [lot(A, 30000, 30000)] });
    inputs.healthBucket = { ...reserve, assetSource: 'money_market_first_then_cash' };
    const result = run(inputs, accumulation);
    assertClose(result.logData.health_bucket_interest, 600, 1e-7, 'Die reine Geldmarktrücklage erhält 600 € Zins');
    if (accumulation) assertClose(result.logData.liqEnd, 60000, 1e-7, 'Ansparjahr: 81.600 € nach Zins minus 21.600 € Kauf, vor 158,25 € Steuer');
    const hash = createHash('sha256').update(JSON.stringify(result)).digest('hex');
    assertEqual(hash, noCashHashes[Number(accumulation)], 'Das vollständige Jahresergebnis ohne Bar-Teil bleibt bytegleich');
}

for (const accumulation of [false, true]) {
    const phase = accumulation ? 'Ansparjahr' : 'Entnahmejahr';
    const control = run(single({ cash: 80000 }), accumulation);
    const result = run(single({ cash: 80000, reserve: 30000 }), accumulation);
    assertClose(result.totalTaxesThisYear - control.totalTaxesThisYear, 600 * taxRate, 1e-7,
        `${phase}: 600 € zusätzlicher Zinsertrag nach ausgeschöpftem Pauschbetrag`);
    assertClose(result.logData.cashInterestEarned, control.logData.cashInterestEarned, 1e-7,
        `${phase}: Nur der freie Liquiditätszins erscheint als solcher`);
    assertClose(result.logData.portfolio_flow_delta, 0, .01, `${phase}: Die Vermögensrechnung geht auf`);

    const legacy = run(couple({ cash: [110000, 0], healthBucket: { ...reserve, assetSource: 'cash' } }),
        accumulation, portfolio => portfolio.personAccounts.forEach(account => delete account.sparerPauschbetrag));
    assertClose(legacy.totalTaxesThisYear, (1600 + 600 - 1000) * taxRate, 1e-7,
        `${phase}: Die gemeinsame Steuerrechnung im Altformat erfasst den Rücklagenzins`);
}

{
    const result = run(couple({ cash: [90000, 80000], healthBucket: { ...reserve, assetSource: 'cash' } }),
        false, portfolio => {
            // 10.000 € aus As und 20.000 € aus Bs Tagesgeld bilden die Rücklage.
            portfolio.personAccounts[0].tagesgeld = 80000;
            portfolio.personAccounts[1].tagesgeld = 60000;
            portfolio.personAccounts[1].sparerPauschbetrag = 2000;
            portfolio.healthBucketCashOwners = [{ profileId: A, amount: 10000 }, { profileId: B, amount: 20000 }];
        });
    assertClose(result.logData.cash_interest_taxable_signed, 3400, 1e-7, 'Das Paar versteuert 200 € und 400 € Rücklagenzins');
    assertClose(result.totalTaxesThisYear, 800 * taxRate, 1e-7,
        'A versteuert 800 € nach Pauschbetrag und B bleibt mit 1.600 € unter dem eigenen Pauschbetrag');
}

{
    const inputs = single({ floor: 0, reserve: 30000 });
    const homeCare = { active: true, grade: 4, form: 'residential', heimJahr: 1, heimKosten: 30600 };
    const result = run(inputs, false, portfolio => { portfolio.personAccounts[0].sparerPauschbetrag = 0; },
        { p1Alive: true, p2Alive: false, care: { p1: homeCare } });
    assertClose(result.logData.health_bucket_used, 30600, 1e-7, 'Rücklage samt Zins fließt vollständig ins Heim');
    assertClose(result.logData.hilfe_zur_pflege_steuer, 600 * taxRate, 1e-7, 'Die offene Zinssteuer zählt zur Hilfe zur Pflege');
}

for (const [sourceProfileId, expected] of [[B, B], [undefined, A]]) {
    const interest = applyHealthBucketInterest({ rC: .02, portfolio: {
        healthBucketConfig: reserve, healthBucketGeldmarkt: 30000, healthBucketCashAmount: 30000,
        simulationSourceProfileId: sourceProfileId, personAccounts: [{ profileId: A }, { profileId: B }]
    } });
    assertEqual(interest.cashInterestByOwner[0].profileId, expected, 'Ohne Eigentümerliste zählt die Herkunft oder das erste Personenkonto');
    assertClose(interest.cashInterestByOwner[0].cashInterest, 600, 1e-7, 'Der Rücklagenzins wird vollständig zugeordnet');
}

{
    const interest = applyHealthBucketInterest({ rC: .02, portfolio: {
        healthBucketConfig: reserve, healthBucketGeldmarkt: 30000, healthBucketCashAmount: 30000
    } });
    assertEqual(interest.cashInterestByOwner.length, 0, 'Ohne Personenkonten gibt es keine persönliche Zuordnung');
    assertClose(interest.cashInterest, 600, 1e-7, 'Der Barzins steht weiterhin für die gemeinsame Steuerbasis bereit');
}
