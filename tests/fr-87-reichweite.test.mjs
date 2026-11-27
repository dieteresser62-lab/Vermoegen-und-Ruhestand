// FR-87: „Reichweite zuerst“ gleicht die operative Liquidität je Person an (erfundene Zahlen, gleicher Bedarf je Person).
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { calculateWithdrawalDistribution } from '../app/profile/profilverbund-balance.js';
import { equalizeLiquidity } from '../app/profile/runway-equalize.js';

const person = (profileId, liquidity, depot) => ({ profileId, name: `Person ${profileId.toUpperCase()}`, hasExplicitTrancheOverride: true,
    inputs: { depotwertNeu: depot, tagesgeld: liquidity, geldmarktEtf: 0, sparerPauschbetrag: 1000, kirchensteuerSatz: 0, liquidityRunwayYears: 5 },
    tranches: depot > 0 ? [{ trancheId: `eq-${profileId}`, category: 'equity', type: 'aktien_neu', marketValue: depot, costBasis: depot,
        shares: depot, purchaseDate: '2020-01-01', tqf: 0 }] : [] });
const refill = amount => ({ type: 'TRANSACTION', verwendungen: { liquiditaet: amount }, quellen: [{ sourceProfileId: 'a', kind: 'aktien_neu',
    category: 'equity', brutto: amount, realizedGainSigned: 0, taxableAfterTqfSigned: 0 }] });
const sold = (result, id) => result.finalAction.quellen.filter(source => source.sourceProfileId === id && source.kind !== 'liquiditaet')
    .reduce((total, source) => total + source.brutto, 0);
const paid = (plan, id) => plan.items.find(item => item.profileId === id).withdrawalAmount;

// Auffüllen 20.000 €: A (10.000 €) bekommt alles, danach 30.000 € gegen 40.000 €.
{
    const result = attributeHouseholdAction({ profiles: [person('a', 10000, 100000), person('b', 40000, 100000)], householdAction: refill(20000), mode: 'runway_first' });
    assertClose(sold(result, 'a'), 20000, .01, 'FR-87: Auffüllen 20.000 €, A verkauft 20.000 €');
    assertClose(sold(result, 'b'), 0, .01, 'FR-87: Auffüllen 20.000 €, B verkauft nichts');
}
// Auffüllen 40.000 €: erst 30.000 € an A bis Gleichstand, dann 5.000 € je Person; beide 45.000 €.
{
    const result = attributeHouseholdAction({ profiles: [person('a', 10000, 100000), person('b', 40000, 100000)], householdAction: refill(40000), mode: 'runway_first' });
    assertClose(sold(result, 'a'), 35000, .01, 'FR-87: Auffüllen 40.000 €, A verkauft 35.000 €');
    assertClose(sold(result, 'b'), 5000, .01, 'FR-87: Auffüllen 40.000 €, B verkauft 5.000 €');
    assertClose(result.finalAction.nettoErlös, 40000, .01, 'FR-87: Summe bleibt gleich');
}
// Kapazitätsgrenze: A hat kein Depot, also verkauft B alles.
{
    const result = attributeHouseholdAction({ profiles: [person('a', 10000, 0), person('b', 40000, 100000)],
        householdAction: { ...refill(20000), quellen: [{ ...refill(20000).quellen[0], sourceProfileId: 'b' }] }, mode: 'runway_first' });
    assertClose(sold(result, 'a'), 0, .01, 'FR-87: A ohne Depot verkauft nichts');
    assertClose(sold(result, 'b'), 20000, .01, 'FR-87: B übernimmt den ganzen Verkauf');
}
// Gleichstand: 50/50.
{
    const result = attributeHouseholdAction({ profiles: [person('a', 20000, 100000), person('b', 20000, 100000)], householdAction: refill(20000), mode: 'runway_first' });
    assertClose(sold(result, 'a'), 10000, .01, 'FR-87: Gleichstand, A verkauft die Hälfte');
    assertClose(sold(result, 'b'), 10000, .01, 'FR-87: Gleichstand, B verkauft die Hälfte');
}
// Auszahlung 20.000 € aus denselben Ständen: B (40.000 €) zahlt alles.
{
    const plan = calculateWithdrawalDistribution([person('a', 10000, 100000), person('b', 40000, 100000)], { netWithdrawal: 20000 }, 'runway_first');
    assertClose(paid(plan, 'a'), 0, .001, 'FR-87: Auszahlung 20.000 €, A zahlt nichts');
    assertClose(paid(plan, 'b'), 20000, .001, 'FR-87: Auszahlung 20.000 €, B zahlt alles');
    assertEqual(plan.remaining, 0, 'FR-87: Auszahlung vollständig verteilt');
}
// Auszahlung 40.000 €: B zahlt 30.000 € bis Gleichstand, dann 5.000 € je Person; je Person höchstens ihre Liquidität.
{
    const plan = calculateWithdrawalDistribution([person('a', 10000, 100000), person('b', 40000, 100000)], { netWithdrawal: 40000 }, 'runway_first');
    assertClose(paid(plan, 'a'), 5000, .001, 'FR-87: Auszahlung 40.000 €, A zahlt 5.000 €');
    assertClose(paid(plan, 'b'), 35000, .001, 'FR-87: Auszahlung 40.000 €, B zahlt 35.000 €');
    assert(plan.items.every(item => item.sellAmount === 0), 'FR-87: Auszahlung aus Liquidität ohne Verkauf');
}
// Gleichstand bei der Auszahlung: 50/50.
{
    const plan = calculateWithdrawalDistribution([person('a', 20000, 100000), person('b', 20000, 100000)], { netWithdrawal: 20000 }, 'runway_first');
    assertClose(paid(plan, 'a'), 10000, .001, 'FR-87: Gleichstand, A zahlt die Hälfte');
    assertClose(paid(plan, 'b'), 10000, .001, 'FR-87: Gleichstand, B zahlt die Hälfte');
}

// Simulator, erfundener Musterhaushalt Max und Erika, erstes Jahr 2000: Planverkauf und Auszahlung gleichen die Liquidität an.
// Verheiratet: Am Jahresende haben beide fast gleich viel; der Rest kommt aus der Steuer je Person und den Zinsen.
// Unverheiratet: Die Auszahlung folgt den Vermögensanteilen und Max' Rente geht auf sein Tagesgeld; ohne beides haben beide fast gleich viel.
{
    const { measurementInputs, backtest } = await import('./helpers/ek-1b-measurement.mjs');
    for (const unmarried of [false, true]) {
        const inputs = await measurementInputs(0, 'max-erika', '2027-01-02');
        inputs.householdWithdrawalMode = 'runway_first';
        if (unmarried) inputs.partnership = { schemaVersion: 1, status: 'unmarried', inheritance: { muster_a: 0, muster_b: 0 } };
        const row = backtest(inputs, 2000, 2000).rows[0].row;
        const level = id => {
            const account = row.personAccounts.find(entry => entry.profileId === id);
            const payout = row.personalPayout.items.find(item => item.profileId === id).amount;
            const income = id === 'muster_a' ? row.rente1 : row.rente2;
            return account.tagesgeld + account.geldmarktEtf + (unmarried ? payout - income : 0);
        };
        const label = unmarried ? 'unverheiratet' : 'verheiratet';
        assert(Math.abs(level('muster_a') - level('muster_b')) < 1000, `FR-87 Simulator ${label}: Liquidität beider Personen angeglichen`);
        if (unmarried) {
            // Die Auszahlung Unverheirateter folgt den Vermögensanteilen zu Jahresbeginn, nicht dem Liquiditätsausgleich.
            const wealth = id => inputs.simulationPeople.find(person => person.profileId === id).tagesgeld
                + inputs.detailledTranches.filter(lot => lot.sourceProfileId === id).reduce((sum, lot) => sum + lot.marketValue, 0);
            const total = row.personalPayout.items.reduce((sum, item) => sum + item.amount, 0);
            assertClose(row.personalPayout.items.find(item => item.profileId === 'muster_a').amount,
                total * wealth('muster_a') / (wealth('muster_a') + wealth('muster_b')), .01, 'FR-87 Simulator unverheiratet: Auszahlung nach Vermögensanteilen');
        }
    }
}

// FR-87-b (Gutachten P2-1): Unverheiratet mit Pflege und Einkünften. A: 10.000 € Liquidität, 10.000 € Rente; B: 40.000 € Liquidität,
// 5.000 € eigene Pflege. Gemeinsamer Bedarf und Auszahlung ändern sich um 1 €, die Aufteilung springt nicht.
{
    const withIncome = (profile, rente) => ({ ...profile, inputs: { ...profile.inputs, renteAktiv: rente > 0, renteMonatlich: rente / 12 } });
    const profiles = [withIncome(person('a', 10000, 100000), 10000), withIncome(person('b', 40000, 100000), 0)];
    for (const need of [45000, 50000]) {
        const [low, high] = [need, need + 1].map(netWithdrawal => calculateWithdrawalDistribution(profiles,
            { netWithdrawal, personalNeeds: { b: 5000 } }, 'runway_first'));
        for (const id of ['a', 'b']) {
            const step = paid(high, id) - paid(low, id);
            assert(step >= -.001 && step <= 1.001, `FR-87-b: ${need} → ${need + 1} €, ${id} zahlt stetig`);
            const item = high.items.find(row => row.profileId === id);
            assert(item.cashUsed <= profiles.find(profile => profile.profileId === id).inputs.tagesgeld + .001, `FR-87-b: ${id} zahlt nicht mehr Liquidität, als da ist`);
        }
        assertEqual(high.remaining, 0, `FR-87-b: ${need + 1} € vollständig verteilt`);
    }
}

// FR-87-b (Gutachten P2-3): Reicht der Hauptverkauf wegen der Steuer nicht, folgt der Zusatzverkauf derselben Regel. A hat keine
// Liquidität und verkauft 30.000 € Aktien mit Gewinn, B hat 50.000 € Geldmarkt; A hat nach dem Hauptverkauf weniger und verkauft auch das Gold.
{
    const lot = (id, category, value, cost) => ({ trancheId: id, category, type: category === 'gold' ? 'gold' : 'aktien_neu',
        marketValue: value, costBasis: cost, shares: value, purchaseDate: '2020-01-01', tqf: category === 'gold' ? 0 : .3 });
    const base = { sparerPauschbetrag: 1000, kirchensteuerSatz: 0, tagesgeld: 0 };
    const profiles = [
        { profileId: 'a', name: 'A', hasExplicitTrancheOverride: true, inputs: { ...base, depotwertNeu: 30000, goldWert: 20000, geldmarktEtf: 0, liquidityRunwayYears: 1 },
            tranches: [lot('eq-a', 'equity', 30000, 0), lot('gold-a', 'gold', 20000, 20000)] },
        { profileId: 'b', name: 'B', hasExplicitTrancheOverride: true, inputs: { ...base, goldWert: 20000, geldmarktEtf: 50000, liquidityRunwayYears: 9 },
            tranches: [lot('gold-b', 'gold', 20000, 20000)] }];
    const result = attributeHouseholdAction({ profiles, mode: 'runway_first', householdAction: { type: 'TRANSACTION', verwendungen: { liquiditaet: 30000 },
        quellen: [{ sourceProfileId: 'a', kind: 'aktien_neu', category: 'equity', brutto: 30000, realizedGainSigned: 30000, taxableAfterTqfSigned: 21000, tqf: .3 }] } });
    const gold = id => result.finalAction.quellen.filter(source => source.sourceProfileId === id && source.kind === 'gold').reduce((total, source) => total + source.brutto, 0);
    assert(gold('a') > 1000, 'FR-87-b: Zusatzverkauf bei A, der Person mit weniger Liquidität');
    assertClose(gold('b'), 0, .01, 'FR-87-b: B verkauft im Zusatzverkauf nichts');
    assertClose(result.finalAction.nettoErlös, 30000, .01, 'FR-87-b: Summe bleibt gleich');
}

// FR-87-b (Gutachten P3-2): Nur endliche Zahlen zählen.
assertEqual(equalizeLiquidity([Infinity, 10000], 5000).join('/'), '5000/0', 'FR-87-b: unendlicher Stand zählt als 0');
assertEqual(equalizeLiquidity([0, 0], Infinity).join('/'), '0/0', 'FR-87-b: unendlicher Betrag zählt als 0');

// HP-1: Haben beide 0 Zieljahre, folgt der Betrag über der Haushaltsliquidität den Vermögensanteilen wie bei „Anteilig“.
// A: 10.000 € Liquidität, 100.000 € Vermögen; B: 40.000 € Liquidität, 300.000 € Vermögen. Bedarf 80.000 €, Überschuss 30.000 € → 7.500/22.500 €.
{
    const noYears = (profileId, liquidity, depot) => { const profile = person(profileId, liquidity, depot);
        return { ...profile, inputs: { ...profile.inputs, liquidityRunwayYears: 0 } }; };
    const plan = calculateWithdrawalDistribution([noYears('a', 10000, 90000), noYears('b', 40000, 260000)], { netWithdrawal: 80000 }, 'runway_first');
    assertClose(paid(plan, 'a'), 17500, .001, 'HP-1: 0 Zieljahre, A zahlt 10.000 € Liquidität plus 7.500 € nach Vermögen');
    assertClose(paid(plan, 'b'), 62500, .001, 'HP-1: 0 Zieljahre, B zahlt 40.000 € Liquidität plus 22.500 € nach Vermögen');
    assertEqual(plan.remaining, 0, 'HP-1: 0 Zieljahre, Auszahlung vollständig verteilt');
    const dry = calculateWithdrawalDistribution([noYears('a', 0, 100000), noYears('b', 0, 300000)], { netWithdrawal: 40000 }, 'runway_first');
    assertClose(paid(dry, 'a'), 10000, .001, 'HP-1: 0 Zieljahre ohne Liquidität, A verkauft nach Vermögen');
    assertClose(paid(dry, 'b'), 30000, .001, 'HP-1: 0 Zieljahre ohne Liquidität, B verkauft nach Vermögen');
    assertEqual(dry.remaining, 0, 'HP-1: 0 Zieljahre ohne Liquidität, nichts bleibt offen');
}
