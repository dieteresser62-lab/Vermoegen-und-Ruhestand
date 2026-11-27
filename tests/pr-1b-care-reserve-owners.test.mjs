import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { applyHealthBucketInterest } from '../app/simulator/simulator-health-bucket.js';
import { addReserveCashInterest, applyPersonalInterest } from '../app/simulator/simulator-personal-accounts.js';
import { beginPersonalTaxYear, settlePersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { A, B, couple, lot } from './helpers/nk-1b-cases.mjs';

const records = createMusterHaushaltRecords('2026-10-23', 'helga-werner');
const plan = Object.values(JSON.parse(records.household_plan_v1).entries)[0].values;
const profiles = Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([profileId, { data }]) => ({
    profileId, inputs: buildSimulatorInputsFromProfileData(data, { referenceYear: 2026, planValues: plan })
}));
const [helga, werner] = profiles.map(profile => profile.profileId);
const combine = (entries, primary = helga) => combineSimulatorProfiles(entries, primary, { planValues: plan }).combined;
const balances = portfolio => Object.fromEntries(portfolio.personAccounts.map(account => [account.profileId, account.tagesgeld]));
const byOwner = (rows, field) => Object.fromEntries(rows.map(row => [row.profileId, row[field]]));

for (const primary of [helga, werner]) {
    const inputs = validateSimulatorInputs(combine(profiles, primary));
    const portfolio = initializePortfolio(inputs);
    assertEqual(inputs.healthBucket.initialAmount, 60000, 'Die Summe der persönlichen Ziele bleibt 60.000 €');
    for (const profileId of [helga, werner]) {
        assertEqual(balances(portfolio)[profileId], 20000, 'Auf jedem Konto bleiben 20.000 € freies Tagesgeld');
        assertEqual(portfolio.healthBucketTranches.find(lot => lot.sourceProfileId === profileId)?.marketValue,
            10000, 'Jede Person verwendet ihren Geldmarkt zuerst');
        assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[profileId], 20000, 'Der Baranteil gehört beiden zur Hälfte');
    }
    assertEqual(byOwner(inputs.healthBucketOwners, 'amount')[helga], 30000, 'Helga bringt ein Ziel von 30.000 € mit');
    assertEqual(byOwner(inputs.healthBucketOwners, 'amount')[werner], 30000, 'Werner bringt ein Ziel von 30.000 € mit');
    const interest = applyHealthBucketInterest({ portfolio, rC: .0412 });
    for (const profileId of [helga, werner]) {
        assertClose(byOwner(interest.cashInterestByOwner, 'cashInterest')[profileId], 824, 1e-8,
            'Jede Person erhält 824 € steuerpflichtigen Barzins');
    }
}

const healthBucket = { enabled: true, initialAmount: 30000 };
const healthBucketOwners = [{ profileId: A, amount: 10000 }, { profileId: B, amount: 20000 }];

{
    const inputs = { ...couple({ cash: [20000, 30000], healthBucket: { ...healthBucket, returnMode: 'cash_return' } }),
        healthBucketOwners, jointAssessment: false };
    for (const person of inputs.simulationPeople) {
        person.sparerPauschbetrag = person.profileId === A ? 1000 : 500;
        person.kirchensteuerSatz = 0;
    }
    const portfolio = initializePortfolio(inputs);
    const book = beginPersonalTaxYear(portfolio), actionResult = {};
    const personalInterest = applyPersonalInterest(portfolio, .04);
    const reserveInterest = applyHealthBucketInterest({ portfolio, rC: .04 });
    addReserveCashInterest(personalInterest, reserveInterest.cashInterestByOwner);
    settlePersonalTaxYear({ portfolio, book, personalInterest, actionResult, inputs, spendingNewState: {},
        plannedActionFlow: null, regularSaleScale: 0, forcedTaxReserved: 0, didForcedSale: false });
    const [a, b] = [A, B].map(id => actionResult.personalAnnualTaxes.find(row => row.profileId === id));
    assertEqual(a.cashInterestIncomeSigned, 800, 'A versteuert 400 € freien Barzins und 400 € Barzins der Pflegereserve');
    assertEqual(b.cashInterestIncomeSigned, 1200, 'B versteuert 400 € freien Barzins und 800 € Barzins der Pflegereserve');
    assertEqual(a.taxDue, 0, 'As eigener Pauschbetrag von 1.000 € deckt As Zinsen');
    assertClose(b.taxDue, 700 * .26375, 1e-8, 'B zahlt Steuer auf Zinsen abzüglich des eigenen Pauschbetrags von 500 €');
}

{
    const owners = [{ profileId: A, amount: 10000.125 }, { profileId: B, amount: 20000.375 }];
    const inputs = couple({ cash: [40000, 40000], healthBucket: { enabled: true, initialAmount: 30000.5 } });
    const portfolio = initializePortfolio({ ...inputs, healthBucketOwners: owners });
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[A], 10000.125, 'As Ziel bleibt bis zum Cent-Bruchteil erhalten');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[B], 20000.375, 'Bs Ziel bleibt bis zum Cent-Bruchteil erhalten');
    assertEqual(portfolio.healthBucketCashAmount, 30000.5, 'Die Barreserve entspricht der Summe beider Ziele');
}

{
    const inputs = couple({ cash: [0, 25000], lots: [lot(A, 16000, 8000)], healthBucket });
    const portfolio = initializePortfolio({ ...inputs, healthBucketOwners });
    assertEqual(portfolio.healthBucketMeta.usedFromMoneyMarket, 10000, 'As Geldmarkt deckt das persönliche Ziel');
    assertEqual(portfolio.depotTranchesGeldmarkt.find(row => row.sourceProfileId === A)?.marketValue, 6000,
        'Der Geldmarktüberschuss von 6.000 € bleibt bei A verfügbar');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[B], 20000, 'B deckt das eigene Ziel vollständig aus eigenem Tagesgeld');
}

{
    const inputs = couple({ cash: [90000, 30000], lots: [lot(A, 10000, 10000)], healthBucket });
    const portfolio = initializePortfolio(inputs);
    assertEqual(portfolio.healthBucketCashAmount, 20000, 'Der Altfall schöpft wie bisher zuerst den Geldmarkt aus');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[A], 15000, 'Ohne Anteile trägt A 75 % des Baranteils');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[B], 5000, 'Ohne Anteile trägt B 25 % des Baranteils');
    assertEqual(balances(portfolio)[A], 75000, 'Die Barreserve wird vom richtigen Konto abgezogen');
    assertEqual(balances(portfolio)[B], 25000, 'Die Barreserve wird vom richtigen Konto abgezogen');
}

{
    const withoutTarget = profiles.map((profile, index) => index === 0 ? profile : {
        ...profile, inputs: { ...profile.inputs, healthBucket: { enabled: true, initialAmount: 0 } }
    });
    const inputs = combine(withoutTarget);
    const portfolio = initializePortfolio(inputs);
    assertEqual(inputs.healthBucket.initialAmount, 30000, 'Ein fehlendes Ziel verändert den Haushaltszielbetrag nicht');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[helga], 20000, 'Helga füllt die eigene Reserve aus 10.000 € Geldmarkt und 20.000 € Tagesgeld');
    assertEqual(balances(portfolio)[werner], 40000, 'Werner behält sein Tagesgeld bei einseitiger Reserve');
    assertEqual(portfolio.depotTranchesGeldmarkt.find(row => row.sourceProfileId === werner)?.marketValue, 10000,
        'Werner behält seinen eigenen Geldmarkt');
}

{
    const inputs = couple({ cash: [2000, 40000], lots: [lot(A, 3000, 2500), lot(B, 20000, 19000)], healthBucket });
    const portfolio = initializePortfolio({ ...inputs, healthBucketOwners: [{ profileId: A, amount: 30000.001 }] });
    assertEqual(portfolio.healthBucketMeta.used, 5000, 'Nur eigenes Geld füllt As Pflegereserve auch bei einer Rundungsdifferenz');
    assertEqual(portfolio.healthBucketMeta.shortfall, 25000, 'Der Rest bleibt als fehlender Betrag sichtbar');
    assertEqual(portfolio.healthBucketCashOwners.length, 1, 'Der Baranteil gehört allein der Person mit Reserve');
    assertEqual(balances(portfolio)[B], 40000, 'Bs Tagesgeld bleibt bei Unterdeckung verfügbar');
    assertEqual(portfolio.depotTranchesGeldmarkt.find(row => row.sourceProfileId === B)?.marketValue, 20000,
        'Bs Geldmarkt bleibt bei Unterdeckung verfügbar');
}

{
    const lots = [lot(A, 16000, 8000), lot(B, 3000, 3000)];
    const inputs = couple({ cash: [40000, 2000], lots, healthBucket });
    const portfolio = initializePortfolio({ ...inputs, healthBucketOwners });
    assertEqual(portfolio.healthBucketMeta.usedFromMoneyMarket, 13000, 'As Geldmarkt bleibt oberhalb ihres Ziels frei');
    assertEqual(portfolio.depotTranchesGeldmarkt[0].marketValue, 6000, 'Der freie Geldmarktbestand bleibt A zugeordnet');
    assertEqual(portfolio.depotTranchesGeldmarkt[0].costBasis, 3000, 'Die Einstandskosten werden proportional aufgeteilt');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[A], 15000, 'A deckt Bs Rest vom verfügbaren Tagesgeld');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[B], 2000, 'B nutzt erst ihr eigenes Tagesgeld');
    assertEqual(portfolio.healthBucketMeta.shortfall, 0, 'Das Tagesgeld deckt die Reserve vollständig');
}

{
    const inputs = couple({ cash: [40000, 40000], lots: [lot(A, 12000, 12000)], healthBucket });
    const portfolio = initializePortfolio({ ...inputs, geldmarktEtf: 12000, detailledTranches: null, healthBucketOwners });
    assertEqual(portfolio.healthBucketMeta.usedFromMoneyMarket, 12000, 'Aggregierter Geldmarkt fließt weiterhin in die Reserve');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[A], 6000, 'Gemeinsamer Geldmarkt deckt die Ziele im Verhältnis 1 zu 2');
    assertEqual(byOwner(portfolio.healthBucketCashOwners, 'amount')[B], 12000, 'Die verbleibenden Barziele haben dasselbe Verhältnis');
}
