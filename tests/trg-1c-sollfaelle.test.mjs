// TRG-1c (FR-80, Gutachten Gemini VK1B): zweiter Nachschritt zu „Eine Person trägt“. Nur synthetische Daten (Musterhaushalte,
// gebaute Eingaben), Testdatum 23.10.2026.
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { beginPersonalTaxYear, settlePersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { oneCarriesMode } from '../app/profile/household-withdrawal-mode.js';

const MARTIN = 'muster_martin', PETRA = 'muster_petra';
const person = (profileId, tagesgeld = 0) => ({ profileId, tagesgeld, sparerPauschbetrag: 0, kirchensteuerSatz: 0, taxState: { lossCarry: 0 } });
const lot = (profileId, value, cost, tqf = 0.3) => ({ schemaVersion: 2, sourceProfileId: profileId, trancheId: `${profileId}:eq`, marketValue: value, costBasis: cost,
    shares: value / 100, purchasePrice: cost / (value / 100), currentPrice: 100, purchaseDate: '2020-01-01', tqf, taxExempt: false, category: 'equity', type: 'aktien_neu' });
const portfolioFor = (people, lots) => initializePortfolio({ simulationSourceProfileId: people[0].profileId, simulationPeople: people,
    tagesgeld: people.reduce((sum, row) => sum + row.tagesgeld, 0), detailledTranches: lots });
const settle = (portfolio, book, mode) => {
    const action = {};
    settlePersonalTaxYear({ portfolio, book, personalInterest: { items: [] }, actionResult: action, inputs: { householdWithdrawalMode: mode },
        plannedActionFlow: null, regularSaleScale: 0, forcedTaxReserved: 0, spendingNewState: {}, didForcedSale: false });
    return action;
};

// Punkt 1 (P1-01) · Steuer im Simulator: Martin Tagesgeld 0 €, Depot 150.000 € (Gewinnanteil 40 %, Teilfreistellung 30 %), Reststeuer 2.954 €,
// Petra 5.000 € Tagesgeld. „Martin trägt“: Martin verkauft aus seinem Depot, Petra bleibt bei 5.000 €. Gegenprobe steueroptimiert: Petra zahlt.
{
    const run = mode => {
        const portfolio = portfolioFor([person(MARTIN), person(PETRA, 5000)], [lot(MARTIN, 150000, 90000)]);
        const book = beginPersonalTaxYear(portfolio);
        book[0].rawAggregate.sumTaxableAfterTqfSigned = 2954 / 0.26375;
        const action = settle(portfolio, book, mode);
        return { portfolio, action, petra: portfolio.personAccounts.find(row => row.profileId === PETRA).tagesgeld };
    };
    const carried = run(oneCarriesMode(MARTIN));
    assertClose(carried.petra, 5000, 1e-6, 'P1-01: Petra bleibt bei 5.000 €');
    assert(carried.action.personalAnnualTaxes[0].taxFundingGross > 3100, `P1-01: Martin verkauft aus seinem Depot (≈ 3.190 € brutto und mehr für die Steuer darauf, ${Math.round(carried.action.personalAnnualTaxes[0].taxFundingGross)} €)`);
    assert(!carried.action.carrierTaxAttacked, 'P1-01: kein Rückgriff, Martins Depot reicht');
    const optimized = run('tax_optimized');
    assertClose(optimized.petra, 5000 - 2954, 0.01, 'Gegenprobe steueroptimiert: Petras Tagesgeld zahlt zuerst (5.000 → 2.046 €)');
}
{
    // Martin ohne Depot: erst dann greift die Steuer auf Petra zu, mit Hinweis.
    const portfolio = portfolioFor([person(MARTIN), person(PETRA, 5000)], []);
    const book = beginPersonalTaxYear(portfolio);
    book[0].rawAggregate.sumTaxableAfterTqfSigned = 2954 / 0.26375;
    const action = settle(portfolio, book, oneCarriesMode(MARTIN));
    assertClose(portfolio.personAccounts.find(row => row.profileId === PETRA).tagesgeld, 2046, 0.01, 'P1-01: ohne eigenes Vermögen zahlt Petra');
    assertEqual(action.carrierTaxAttacked?.[0]?.profileId, PETRA, 'P1-01: Rückgriff auf Petra mit Hinweis');
}

// Punkt 4 (P2-01) · schon gebaut (Nachtrag 1): Tranchenwahl mit „ganz steuerfrei“. A 20.000 € / 10.000 € Einstand, 30 %, steuerfrei; B 20.000 € /
// 18.000 €, nicht steuerfrei; Verkauf 10.000 € → aus A, Steuer 0,00 €.
import { selectTranchesForSale } from '../app/profile/profilverbund-balance.js';
{
    const a = { trancheId: 'a', category: 'equity', type: 'aktien_neu', marketValue: 20000, costBasis: 10000, tqf: 0.3, taxExempt: true, purchaseDate: '2010-01-01' };
    const b = { trancheId: 'b', category: 'equity', type: 'aktien_neu', marketValue: 20000, costBasis: 18000, tqf: 0.3, taxExempt: false, purchaseDate: '2020-01-01' };
    const picked = selectTranchesForSale([b, a], 10000, 0.26375);
    assertEqual(picked.map(row => `${row.tranche.trancheId}:${row.sellAmount}`).join(), 'a:10000', 'P2-01: Verkauf aus der steuerfreien Tranche A');
    assertEqual(picked[0].taxAmount, 0, 'P2-01: Steuer 0,00 €');
}

// ---------------------------------------------------------------------------------------------------------------------------------------
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { ANNUAL_PLAN_RECORD_KEY, annualPlanEntryMode, assertAnnualPlanRecord, householdWithdrawalEvidence } from '../app/profile/annual-plan-record.js';
import { buyFlowPlanFromConfirmed, readBuyFlowPlan } from '../app/tranches/buy-flow-dialog.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { createPlanDetails } from '../app/shared/annual-todo-view.js';
import { projectAnnualTodoPlan } from '../app/balance/annual-todo.js';
import { formatHouseholdPlanValue, carrierModeText } from '../app/shared/household-plan-fields.js';
import { debitPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23';
setAppTestDate(DATE);
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const texts = node => walk(node).map(item => item.textContent || '').join(' ');
async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'trg-1c-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}

// Punkte 5 und 8 · Der Beleg speichert Modus, tragende Person und Rückgriff (additiv, optional); alte Belege ohne Feld bleiben gültig.
{
    const carried = Object.values(JSON.parse(createMusterHaushaltRecords(DATE, 'martin-petra', 'traegt')[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
    assertEqual(JSON.stringify(carried.adopted.householdWithdrawal), JSON.stringify({ mode: 'one_carries:muster_martin', carrierId: MARTIN, carrierName: 'Martin' }),
        'Punkt 5/8: Beleg „Martin trägt“ hält Modus und tragende Person');
    assertEqual(annualPlanEntryMode(carried), 'one_carries:muster_martin', 'Punkt 8: Modus des Belegs');
    const plain = Object.values(JSON.parse(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund')[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
    assert(!('householdWithdrawal' in plain.adopted), 'Vorgabemodus: kein neues Feld (Belegbytes wie bisher)');
    assertEqual(annualPlanEntryMode(plain), 'tax_optimized', 'Punkt 8: Grundfall steueroptimiert');
    const legacy = structuredClone(plain); delete legacy.adopted.snapshot.plan.householdWithdrawalMode;
    assertEqual(annualPlanEntryMode(legacy), '', 'Altbeleg ohne Angabe = Vorgabemodus');
    const record = { version: 1, entries: { k: carried } };
    assertAnnualPlanRecord({ version: 1, entries: { [Object.keys(JSON.parse(createMusterHaushaltRecords(DATE, 'martin-petra', 'traegt')[ANNUAL_PLAN_RECORD_KEY]).entries)[0]]: carried } });
    const broken = structuredClone(carried); broken.adopted.householdWithdrawal.carrierId = PETRA;
    let rejected = false;
    try { assertAnnualPlanRecord({ version: 1, entries: { [Object.keys(JSON.parse(createMusterHaushaltRecords(DATE, 'martin-petra', 'traegt')[ANNUAL_PLAN_RECORD_KEY]).entries)[0]]: broken } }); } catch { rejected = true; }
    assert(rejected && record, 'Sicherungsprüfer weist widersprüchliche tragende Person ab');
    const evidence = householdWithdrawalEvidence('one_carries:muster_martin', { carrierId: MARTIN, carrierName: 'Martin', attacked: [{ profileId: PETRA, name: 'Petra', amount: 12800.004 }] });
    assertEqual(JSON.stringify(evidence.attacked), JSON.stringify([{ profileId: PETRA, name: 'Petra', amount: 12800 }]), 'Punkt 5: Rückgriff mit Betrag im Beleg');
    const plan = projectAnnualTodoPlan({ confirmed: { year: 2026, committedAt: carried.committedAt, action: carried.adopted.action, text: '' }, people: [{ id: MARTIN, name: 'Martin' }, { id: PETRA, name: 'Petra' }] });
    const details = createPlanDetails(new MockDocument(), { ...plan, carrier: evidence }, carried.adopted.action, [{ id: MARTIN, name: 'Martin' }, { id: PETRA, name: 'Petra' }]);
    const shown = texts(details.root || details);
    assert(shown.includes('Eine Person trägt · Martin') && shown.includes('Vermögen von Petra wird angegriffen'), 'Punkt 5: „Details & Drucken“ nennt tragende Person und Rückgriff');
}

// Punkt 8 (Fable VK2 P2-4) · Stand der Käufe folgt dem Beleg: Martin 685 Stück (98.930,75 €), Petra 150 Stück (21.677,50 €) eingetragen.
// Beleg steueroptimiert → nach Wechsel auf „Martin trägt“ bleibt der Plan erledigt (vorher „teilweise, 23.069,25 € offen“).
{
    const records = createMusterHaushaltRecords(DATE, 'martin-petra', 'grund');
    const entry = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
    await freshArea(records);
    const tranche = (id, shares, debit) => ({ schemaVersion: 2, trancheId: id, name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE',
        isin: 'IE00BK5BQT80', shares, purchasePrice: debit / shares, currentPrice: 144.46978, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' });
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [
        { profileId: MARTIN, actionId: 'trg1c-m', executedAt: DATE, assetClass: 'equity', tranche: tranche('trg1c_m', 685, 98930.75), shares: 685, gross: 98920.85, fees: 9.9, cashValue: 1069.25 },
        { profileId: PETRA, actionId: 'trg1c-p', executedAt: DATE, assetClass: 'equity', tranche: tranche('trg1c_p', 150, 21677.5), shares: 150, gross: 21667.6, fees: 9.9, cashValue: 8322.5 }] }));
    const registry = JSON.parse(storage.getItem('rs_profiles_v1'));
    const confirmed = { year: 2026, committedAt: entry.committedAt, action: entry.adopted.action };
    const state = mode => readBuyFlowPlan({ plan: buyFlowPlanFromConfirmed(confirmed, [MARTIN, PETRA], registry, mode), registry })
        .lines.map(line => `${line.name} ${line.status}${line.status === 'teilweise' ? ` ${line.restAmount}` : ''}`).join(', ');
    assertEqual(state(annualPlanEntryMode(entry)), 'Martin erledigt, Petra erledigt', 'Punkt 8: Stand aus dem Beleg bleibt erledigt');
    assertEqual(state('one_carries:muster_martin'), 'Martin teilweise 23069.25', 'Gegenprobe heutiger Modus: „teilweise, 23.069,25 € offen“ (so vorher)');
}

// Punkt 6 · Anzeige „Eine Person trägt · <Name>“ (Haushalt & Plan, Probelauf-Vergleich, Balance).
{
    assertEqual(carrierModeText('one_carries:muster_martin', [{ id: MARTIN, name: 'Martin' }]), 'Eine Person trägt · Martin', 'Punkt 6: Name aus der Liste');
    assertEqual(formatHouseholdPlanValue('one_carries:muster_petra', 'householdWithdrawalMode'), 'Eine Person trägt · Petra', 'Punkt 6: Name aus dem Bestand (Probelauf-Vergleich)');
    assertEqual(formatHouseholdPlanValue('one_carries:unbekannt', 'householdWithdrawalMode'), 'Eine Person trägt', 'Punkt 6: ohne bekannte Person ohne Namen');
}

// Punkt 3 (P1-03) · Rückfallverkauf ohne fertigen Plan: bei „Martin trägt“ zahlt Martin zuerst; zahlt Petra, steht das als Rückgriff da.
{
    const portfolio = portfolioFor([person(MARTIN, 3000), person(PETRA, 5000)], []);
    const paid = debitPersonalLiquidity(portfolio, 4000, null, oneCarriesMode(MARTIN));
    assertEqual(paid.items.map(row => `${row.profileId === MARTIN ? 'M' : 'P'}${Math.round(row.amount)}`).join(','), 'M3000,P1000', 'P1-03: Martin zuerst, Rest Petra');
    assertEqual(paid.attacked?.[0]?.profileId, PETRA, 'P1-03: Rückgriff auf Petra mit Hinweis');
    const base = debitPersonalLiquidity(portfolioFor([person(MARTIN, 3000), person(PETRA, 5000)], []), 4000);
    assert(!base.attacked, 'Gegenprobe ohne Modus: kein Hinweis (wie bisher)');
}

// Punkt 2 (P1-02) · Lücke der Zuordnung bei „Helga trägt“ (Werte wie Helga und Werner): Der Plan verkauft alles Gold beider (100.000 €) und
// 10.000 € Aktien für 110.000 € Liquidität; die Steuer der Aktien lässt eine Lücke. Helga hat kein Tagesgeld, Werner 40.000 €. Vorher deckte
// Werners Tagesgeld die Lücke still; jetzt deckt Helga sie zuerst aus eigenem Bestand.
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
{
    const HELGA = 'muster_helga', WERNER = 'muster_werner';
    const data = createMusterHaushaltRecords(DATE, 'helga-werner', 'grund');
    const registry = JSON.parse(data.rs_profiles_v1);
    registry.profiles[HELGA].data.profile_tagesgeld = '0'; registry.profiles[WERNER].data.profile_tagesgeld = '40000';
    data.profile_tagesgeld = data.rs_current_profile === HELGA ? '0' : '40000';
    data.rs_profiles_v1 = JSON.stringify(registry);
    const list = buildBalanceEngineInputFromStorage({ storage: { getItem: key => data[key] ?? null }, referenceYear: 2026 }).profiles;
    const sale = { type: 'TRANSACTION', quellen: [
        { source: 'Gold', kind: 'gold', category: 'gold', brutto: 50000, netto: 50000, steuer: 0, realizedGainSigned: 0, taxableAfterTqfSigned: 0, tqf: 0, sourceProfileId: HELGA },
        { source: 'Gold', kind: 'gold', category: 'gold', brutto: 50000, netto: 50000, steuer: 0, realizedGainSigned: 0, taxableAfterTqfSigned: 0, tqf: 0, sourceProfileId: WERNER },
        { source: 'Aktien', kind: 'aktien_neu', category: 'equity', brutto: 10000, netto: 10000, steuer: 0, realizedGainSigned: 0, taxableAfterTqfSigned: 0, tqf: 0.3, sourceProfileId: HELGA }],
        verwendungen: { liquiditaet: 110000, gold: 0, aktien: 0, geldmarkt: 0, bonds: 0 } };
    const run = mode => attributeHouseholdAction({ householdAction: sale, profiles: list, mode }).finalAction;
    const cash = (action, id) => (action.quellen || []).filter(source => source.kind === 'liquiditaet' && source.sourceProfileId === id).reduce((sum, source) => sum + source.brutto, 0);
    const sold = (action, id, kind) => (action.quellen || []).filter(source => source.kind !== 'liquiditaet' && source.sourceProfileId === id && (!kind || source.category === kind))
        .reduce((sum, source) => sum + source.brutto, 0);
    const carried = run(oneCarriesMode(HELGA));
    assertEqual(Math.round(carried.personalTaxFunding?.cash || 0), 0, 'P1-02: Werners Tagesgeld deckt die Lücke nicht mehr (vorher 1.596 € aus vorhandenen Haushaltsmitteln)');
    assertEqual(Math.round(sold(carried, WERNER)), 0, 'P1-02: bei Werner kein Verkauf');
    assert(sold(carried, HELGA, 'bonds') > 0, `P1-02: Helga deckt die Lücke aus eigenem Bestand (${Math.round(sold(carried, HELGA, 'bonds'))} € Anleihen)`);
    assert(!carried.personalTaxFunding || carried.personalTaxFunding.shortfall < 0.01, 'P1-02: keine ungedeckte Lücke');
}
