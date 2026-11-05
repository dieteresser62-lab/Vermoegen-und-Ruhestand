import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { resolvePlannedAction } from '../types/planned-action-contract.js';

for (const difference of [-.0076, -.0001]) {
    const value = (1000 + difference) / (1 - .5 * .26375);
    const profiles = ['a', 'b'].map(profileId => ({ profileId, hasExplicitTrancheOverride: true,
        inputs: { tagesgeld: 0,
            geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 },
        tranches: profileId === 'a' ? [{ trancheId: 'bond', category: 'bonds', type: 'anleihe',
            marketValue: value, costBasis: value / 2, tqf: 0 }] : [] }));
    const householdAction = { type: 'TRANSACTION', nettoErlös: 1000, steuer: 0,
        quellen: [{ sourceProfileId: 'a', trancheId: 'a:bond', kind: 'anleihe', category: 'bonds',
            brutto: 1000 / (1 - .5 * .26375), netto: 1000, steuer: 0,
            realizedGainSigned: value / 2, taxableAfterTqfSigned: value / 2 }],
        verwendungen: { bonds: 100, liquiditaet: 900 } };
    for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
        const before = JSON.stringify({ profiles, householdAction });
        const { finalAction, profileActions } = attributeHouseholdAction({ profiles, householdAction, mode });
        const net = finalAction.quellen.reduce((total, source) => total + source.netto, 0);
        const uses = Object.values(finalAction.verwendungen).reduce((total, value) => total + value, 0);
        assert(Math.abs(net - Object.values(householdAction.verwendungen).reduce((a, b) => a + b, 0)) > 1e-7,
            `${mode}/${difference}: Abweichung liegt über der strengen Vertragstoleranz`);
        assertClose(net, uses, 1e-7, `${mode}/${difference}: Quellen entsprechen Verwendungen`);
        assertClose(profileActions.reduce((total, row) => total + row.action.verwendungen.liquiditaet, 0),
            finalAction.verwendungen.liquiditaet, 1e-7, 'Persönliche Verwendungen enthalten denselben Cent-Rest');
        assertEqual(finalAction.verwendungen.bonds, 0,
            'QS-C FR-63: gegenläufiger Anleihenkauf wird vor Buchung verrechnet');
        const action = { ...finalAction, verwendungen: Object.fromEntries(Object.entries(finalAction.verwendungen)
            .filter(([key, amount]) => key !== 'geldmarkt' || amount !== 0)) };
        assertEqual(resolvePlannedAction({ action, availableLiquidity: 1000 }).status, 'resolved',
            'Strenger Quellen-/Verwendungsvertrag bleibt erfüllt');
        const invalid = { ...action, verwendungen: { ...action.verwendungen,
            liquiditaet: action.verwendungen.liquiditaet + .02 } };
        assertEqual(resolvePlannedAction({ action: invalid }).reason, 'liquidity_inflow_without_asset_source',
            'Größere Abweichungen bleiben ein Vertragsfehler');
        assertEqual(JSON.stringify({ profiles, householdAction }), before, 'Eingaben bleiben unverändert');
    }
}

function purchaseInput(difference, uses, owner = 'a') {
    const value = (1000 + difference) / (1 - .5 * .26375);
    return {
        profiles: ['a', 'b'].map(profileId => ({ profileId, hasExplicitTrancheOverride: true,
            inputs: { tagesgeld: 0, geldmarktEtf: 0, sparerPauschbetrag: 0, kirchensteuerSatz: 0 },
            tranches: profileId === owner ? [{ trancheId: 'bond', category: 'bonds', type: 'anleihe',
                marketValue: value, costBasis: value / 2, tqf: 0 }] : [] })),
        householdAction: { type: 'TRANSACTION', nettoErlös: 1000, steuer: 0,
            quellen: [{ sourceProfileId: owner, trancheId: `${owner}:bond`, kind: 'anleihe', category: 'bonds',
                brutto: 1000 / (1 - .5 * .26375), netto: 1000, steuer: 0,
                realizedGainSigned: value / 2, taxableAfterTqfSigned: value / 2 }],
            verwendungen: uses }
    };
}

function checkResolvedActions({ finalAction, profileActions }, label) {
    for (const [name, action] of [['Haushalt', finalAction], ...profileActions.map(row => [row.profileId, row.action])]) {
        // Wie beim Aufrufer den vom Vertrag nicht unterstützten Nullschlüssel entfernen.
        const planned = { ...action, verwendungen: Object.fromEntries(Object.entries(action.verwendungen)
            .filter(([key, amount]) => key !== 'geldmarkt' || amount !== 0)) };
        assertClose(action.quellen.reduce((total, source) => total + source.netto, 0),
            Object.values(action.verwendungen).reduce((total, amount) => total + amount, 0), 1e-7,
            `${label}/${name}: Quellen entsprechen Verwendungen`);
        assertEqual(resolvePlannedAction({ action: planned, availableLiquidity: 1000 }).status, 'resolved',
            `${label}/${name}: strenger Aktionsvertrag erfüllt`);
        assert(Object.values(action.verwendungen).every(amount => amount >= 0),
            `${label}/${name}: alle Verwendungen bleiben nichtnegativ`);
    }
    for (const [key, amount] of Object.entries(finalAction.verwendungen)) {
        assertClose(profileActions.reduce((total, row) => total + row.action.verwendungen[key], 0), amount, 1e-7,
            `${label}/${key}: persönliche Summe entspricht dem Haushalt`);
    }
}

for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    for (const difference of [-.0076, -.0001]) for (const key of ['bonds', 'aktien', 'gold']) {
        for (const owner of ['a', 'b']) {
            const input = purchaseInput(difference, { [key]: 1000 }, owner);
            const before = JSON.stringify(input);
            const result = attributeHouseholdAction({ ...input, mode });
            const label = `${mode}/${difference}/${key}/${owner}`;
            checkResolvedActions(result, label);
            assertClose(result.finalAction.verwendungen[key], key === 'bonds' ? 0 : 1000 + difference, 1e-7,
                `${label}: Kauf übernimmt den negativen Cent-Rest`);
            if (key === 'bonds') assert(result.finalAction.verwendungen.liquiditaet >= 0, `${label}: freigewordene Steuer erhöht Liquidität`);
            else assertEqual(result.finalAction.verwendungen.liquiditaet, 0, `${label}: kein Liquiditätszugang erfunden`);
            assertEqual(JSON.stringify(input), before, `${label}: Eingaben unverändert`);
        }
    }
    for (const uses of [
        { liquiditaet: .001, bonds: .002, aktien: .001, gold: 999.996 },
        { bonds: 600, aktien: 300, gold: 100 }
    ]) {
        const result = attributeHouseholdAction({ ...purchaseInput(-.0076, uses), mode });
        checkResolvedActions(result, `${mode}/Reihenfolge`);
        if (uses.liquiditaet) {
            for (const key of ['liquiditaet', 'bonds', 'aktien']) {
                assertEqual(result.finalAction.verwendungen[key], 0, `${mode}/${key}: erst bis null abbauen`);
            }
            assertClose(result.finalAction.verwendungen.gold, 999.9924, 1e-7, `${mode}: Gold trägt den letzten Rest`);
        } else {
            assertClose(result.finalAction.verwendungen.bonds, 0, 1e-7, `${mode}: Anleihenkauf nach Cent-Ausgleich vollständig verrechnet`);
            assertEqual(result.finalAction.verwendungen.aktien, 300, `${mode}: Aktienkauf bleibt gleich`);
            assertEqual(result.finalAction.verwendungen.gold, 100, `${mode}: Goldkauf bleibt gleich`);
        }
    }
}

const cashProfiles = ['a', 'b'].map(profileId => ({ profileId,
    inputs: { tagesgeld: profileId === 'a' ? 2000 : 0, geldmarktEtf: 0 } }));
function cashPurchase(source, purchase) {
    return { profiles: cashProfiles, householdAction: { type: 'TRANSACTION', nettoErlös: source, steuer: 0,
        quellen: [{ source: 'Liquidität', kind: 'liquiditaet', brutto: source, netto: source, steuer: 0 }],
        verwendungen: { bonds: purchase } } };
}
const oneCent = attributeHouseholdAction(cashPurchase(1000, 1000.01));
checkResolvedActions(oneCent, 'Negativer Rest bis einschließlich einem Cent');
assertEqual(oneCent.finalAction.verwendungen.bonds, 1000, 'Ein Cent wird vom Kauf abgezogen');
let overCentError = '';
try {
    // Quellenrundung plus unter einem Cent zusätzlicher Verwendung erreicht
    // gezielt die abschließende Prüfung von Quellen gegen Verwendungen.
    attributeHouseholdAction(cashPurchase(1000.0049, 1000.0148));
} catch (error) { overCentError = error.message; }
assert(overCentError.includes('Quellen und Verwendungen weichen'), 'Mehr als ein Cent bleibt ein Fehler');

const positiveRest = attributeHouseholdAction(cashPurchase(1000, 999.995));
assert(positiveRest.finalAction.verwendungen.liquiditaet > 1e-7, 'Positiver Rest behält den bisherigen Liquiditätszugang');
const positiveResolution = resolvePlannedAction({ action: { ...positiveRest.finalAction,
    verwendungen: { bonds: positiveRest.finalAction.verwendungen.bonds,
        liquiditaet: positiveRest.finalAction.verwendungen.liquiditaet } } });
assertEqual(positiveResolution.reason, 'liquidity_inflow_without_asset_source',
    'Positiver Rest ohne Vermögensquelle bleibt ein technischer Vertragsfehler');

// VF-2b: Beide Personen verkaufen und tragen jeweils ihren eigenen Centbruchteil.
for (const difference of [-.0076, .0076, 0]) for (const mode of ['tax_optimized', 'proportional', 'runway_first']) {
    const input = purchaseInput(difference, { aktien: 100, liquiditaet: 900 });
    const values = [499.9931 + difference / 2, 500.0069 + difference / 2].map(net => net / (1 - .5 * .26375));
    input.profiles.forEach((profile, index) => {
        profile.tranches = [{ ...input.profiles[0].tranches[0], trancheId: 'bond', marketValue: values[index], costBasis: values[index] / 2 }];
    });
    input.householdAction.quellen = values.map((value, index) => ({ ...input.householdAction.quellen[0],
        sourceProfileId: input.profiles[index].profileId, trancheId: `${input.profiles[index].profileId}:bond`,
        brutto: value, netto: value * (1 - .5 * .26375), realizedGainSigned: value / 2, taxableAfterTqfSigned: value / 2 }));
    if (difference > 0) {
        input.profiles[0].inputs.tagesgeld = 1;
        input.householdAction.quellen.push({ kind: 'liquiditaet', brutto: .006, netto: .006, steuer: 0 });
    }
    const result = attributeHouseholdAction({ ...input, mode });
    assert(result.profileActions.every(row => row.action.quellen.length > 0), 'Beide Verkäufer sind beteiligt');
    checkResolvedActions(result, `Zwei Verkäufer/${difference}/${mode}`);
    assertClose(result.finalAction.nettoErlös - 1000, difference > 0 ? .004 : difference, 1e-7, 'Positiver/negativer Haushaltsrest tatsächlich erreicht');
}
{
    const input = cashPurchase(1000, 1000);
    input.householdAction.verwendungen = { unbekannt: 1000.005 };
    let message = '';
    try { attributeHouseholdAction(input); } catch (error) { message = error.message; }
    assert(message.includes('Cent-Rest') && message.includes('keiner Verwendung'), 'Unabbaubarer Rest wirft einen klaren Fehler');
}
