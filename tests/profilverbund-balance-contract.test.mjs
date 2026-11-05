import * as facade from '../app/profile/profilverbund-balance.js';
import * as tax from '../app/profile/profilverbund-balance/tax.js';
import * as tranches from '../app/profile/profilverbund-balance/tranches.js';
import * as profiles from '../app/profile/profilverbund-balance/profiles.js';
import * as household from '../app/profile/profilverbund-balance/household.js';
import * as withdrawal from '../app/profile/profilverbund-balance/withdrawal.js';

const bindings = {
    calculateTaxPerEuro: tax.calculateTaxPerEuro,
    selectTranchesForSale: tax.selectTranchesForSale,
    classifyTrancheCategoryCached: tranches.classifyTrancheCategoryCached,
    buildProfileOwnedTranches: tranches.buildProfileOwnedTranches,
    loadProfilverbundProfiles: profiles.loadProfilverbundProfiles,
    aggregateProfilverbundInputs: household.aggregateProfilverbundInputs,
    calculateHouseholdWithdrawalNeed: household.calculateHouseholdWithdrawalNeed,
    buildProfilverbundAssetSummary: household.buildProfilverbundAssetSummary,
    buildProfilverbundProfileSummaries: household.buildProfilverbundProfileSummaries,
    calculateWithdrawalDistribution: withdrawal.calculateWithdrawalDistribution,
    reconcileWithdrawalLiquidity: withdrawal.reconcileWithdrawalLiquidity
};
assertEqual(JSON.stringify(Object.keys(facade).sort()), JSON.stringify(Object.keys(bindings).sort()),
    'Die Fassade erhält die elf öffentlichen Namen');
for (const [name, binding] of Object.entries(bindings)) {
    assert(facade[name] === binding, `${name}: Fassade und Definitionsmodul teilen dieselbe Bindung`);
}

let typeReads = 0;
const tranche = { get type() { typeReads++; return 'aktien_alt'; }, category: 'equity',
    marketValue: 100, costBasis: 50, tqf: 0, purchaseDate: '2020-01-01' };
facade.classifyTrancheCategoryCached(tranche);
typeReads = 0;
const selection = tax.selectTranchesForSale([tranche], 20);
assertEqual(typeReads, 1, 'Die Verkaufsauswahl trifft den über die Fassade gefüllten Klassifikationscache');
assertEqual(selection[0].sellAmount, 20, 'Die Verkaufsauswahl bleibt über die neue Modulgrenze ausführbar');
