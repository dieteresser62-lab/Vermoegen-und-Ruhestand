// TRG-1b (FR-80): Nachschritt „Eine Person trägt“ nach dem Gutachten Fable (VK1B). Nur synthetische Daten: Musterhaushalte
// Martin und Petra (unverheiratet) und Max und Erika, Testdatum 23.10.2026.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { calculateTaxPerEuro, calculateWithdrawalDistribution, reconcileWithdrawalLiquidity } from '../app/profile/profilverbund-balance.js';
import { attributeHouseholdAction } from '../app/profile/profilverbund-action-attribution.js';
import { oneCarriesMode, carrierMissing } from '../app/profile/household-withdrawal-mode.js';
import { nonCarrierSales } from '../app/profile/household-carrier-action.js';
import { projectAnnualTodoPlan } from '../app/balance/annual-todo.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';

const DATE = '2026-10-23';
const MARTIN = 'muster_martin', PETRA = 'muster_petra';
const CARRIES = oneCarriesMode(MARTIN);

// P2-2 · Simulator unverheiratet: Die Einkünfte beider zählen zum Haushalt. Jahr 1, Grundfall mit „Martin trägt“: Martin zahlt aus
// seiner Rente 27.600 €, Petra aus ihren Einkünften 20.400 €; aus dem Vermögen 0 € wie in der Balance (vorher zahlte Martin 48.000 €).
{
    const inputs = await measurementInputs(0, 'martin-petra', DATE);
    inputs.householdWithdrawalMode = CARRIES;
    const first = backtest(inputs, 2000, 2000).rows[0].row;
    const paid = Object.fromEntries(first.personalPayout.items.map(item => [item.profileId, Math.round(item.amount)]));
    assertEqual(paid[MARTIN], 27600, 'P2-2: Martin zahlt 27.600 € (seine Rente), nicht 48.000 €');
    assertEqual(paid[PETRA], 20400, 'P2-2: Petra zahlt 20.400 € aus ihren Einkünften');
    assertEqual(Math.round(first.entnahme_plan), 0, 'P2-2: Entnahme aus dem Vermögen 0 € wie in der Balance');
    // Gegenprobe steueroptimiert: Aufteilung nach Vermögensanteil (FR-48) bleibt.
    inputs.householdWithdrawalMode = 'tax_optimized';
    const base = backtest(inputs, 2000, 2000).rows[0].row;
    assertEqual(base.personalPayout.items.map(item => Math.round(item.amount)).join('/'), '41143/6857', 'Gegenprobe steueroptimiert: 41.143 / 6.857 € wie bisher');
}

setAppTestDate(DATE);
/** Balance mit dem echten Weg (Haushalts-Engine, Zuordnung, Auszahlungsverteilung). */
function household({ variant = 'grund', mode = CARRIES, cash = null, floor = null, flex = null } = {}) {
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', variant);
    const plan = JSON.parse(data.household_plan_v1);
    for (const entry of Object.values(plan.entries)) {
        entry.values.householdWithdrawalMode = mode;
        if (floor) Object.assign(entry.values, { floorBedarf: floor, flexBedarf: flex });
    }
    data.household_plan_v1 = JSON.stringify(plan);
    if (cash) {
        const registry = JSON.parse(data.rs_profiles_v1);
        for (const [id, value] of Object.entries(cash)) {
            registry.profiles[id].data.profile_tagesgeld = String(value);
            if (data.rs_current_profile === id) data.profile_tagesgeld = String(value);
        }
        data.rs_profiles_v1 = JSON.stringify(registry);
    }
    const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => data[key] ?? null }, referenceYear: 2026 });
    const runs = evaluateStoredAnnualHousehold(calc.inputData, calc.profiles, calc.engineLastState, { engineApi: EngineAPI, withdrawalMode: mode });
    return { runs, profiles: calc.profiles };
}
const person = (runs, id) => runs.find(run => run.profileId === id).ui.action;
const cashPaid = action => (action.quellen || []).filter(source => source.kind === 'liquiditaet').reduce((sum, source) => sum + source.brutto, 0);
const sold = action => (action.quellen || []).filter(source => source.kind !== 'liquiditaet').reduce((sum, source) => sum + source.brutto, 0);
const payout = (runs, id) => runs.distribution.items.find(item => item.profileId === id).withdrawalAmount;

// P1-1 · Auszahlung nur von der tragenden Person: Tagesgeld 10.000 / 110.000 €, Bedarf 60.000 + 24.000 €, Entnahme 22.800 €.
{
    const { runs } = household({ cash: { [MARTIN]: 10000, [PETRA]: 110000 }, floor: 60000, flex: 24000 });
    assertClose(runs.distribution.totalNeed, 22800, 0.01, 'P1-1: Entnahme 22.800 €');
    assertClose(payout(runs, PETRA), 0, 0.01, 'P1-1: Petra zahlt 0 € (vorher 12.800 € aus ihrem Tagesgeld)');
    assertClose(payout(runs, MARTIN), 22800, 0.01, 'P1-1: Martin zahlt die ganze Entnahme');
    const martin = person(runs, MARTIN), petra = person(runs, PETRA);
    // LZ-1 (Ergänzung 2 FR-80): Martin füllt seine eigene Liquidität bis zum Ziel auf; Petras Tagesgeld deckt keinen Teil mehr
    // (vorher 12.800 € netto, nur der Rest seiner Auszahlung). Gleicher Verkauf wie bei Petra 1.000 €.
    assertClose(martin.verwendungen.liquiditaet, 111665.5, 1, 'P1-1/LZ-1/VN-3: Martin verkauft für 111.665,50 € netto (Auffüllen ohne Petras Tagesgeld, Engine sieht nur seine Lose)');
    assert(sold(martin) > 12800, 'P1-1: Verkauf brutto über dem Netto (Steuer)');
    assertEqual(sold(petra) + cashPaid(petra), 0, 'P1-1: bei Petra kein Verkauf und kein Kauf, ihr Tagesgeld bleibt 110.000 €');
    assertEqual(runs.distribution.attacked.length, 0, 'P1-1: kein Hinweis, Martins Vermögen reicht');
    // Gegenprobe steueroptimiert: die Haushaltsliquidität reicht, kein Verkauf.
    const base = household({ mode: 'tax_optimized', cash: { [MARTIN]: 10000, [PETRA]: 110000 }, floor: 60000, flex: 24000 }).runs;
    assertEqual(sold(person(base, MARTIN)) + sold(person(base, PETRA)), 0, 'Gegenprobe steueroptimiert: kein Verkauf');
}
{
    // Tagesgeld 20.000 / 150.000 €: vorher kaufte Martin für 20.000 € und Petra für 30.000 €, die Entnahme zahlte Petra.
    const { runs } = household({ cash: { [MARTIN]: 20000, [PETRA]: 150000 }, floor: 60000, flex: 24000 });
    assertEqual(cashPaid(person(runs, PETRA)), 0, 'P1-1/P2-1: Petra kauft nichts');
    assertEqual(cashPaid(person(runs, MARTIN)), 0, 'P2-1: Martin hat nach seiner Auszahlung nichts frei, kein Kauf');
    assertClose(person(runs, MARTIN).verwendungen.liquiditaet, 102404, 1, 'P1-1/LZ-1/VN-3: Martin füllt seine Liquidität auf (vorher 2.800 €, Rest seiner Auszahlung)');
    assertClose(payout(runs, PETRA), 0, 0.01, 'P1-1: Petra zahlt 0 €');
}

// P2-1 · Käufe aus Überschuss nur aus Martins Liquidität (Grundfall mit gesetztem Modus, Tagesgeld 100.000 / 30.000 €).
{
    const { runs } = household();
    // LZ-1: Anlegen nur aus Martins Überschuss über das Ziel (vorher 100.000 €, Petras Tagesgeld deckte das Ziel mit).
    assertEqual(cashPaid(person(runs, MARTIN)), 92000, 'P2-1/LZ-1: Martin kauft für 92.000 € aus seinem Tagesgeld');
    assertEqual(cashPaid(person(runs, PETRA)), 0, 'P2-1: Petra kauft 0 € (vorher 22.000 €), ihr Tagesgeld bleibt 30.000 €');
    const base = household({ mode: 'tax_optimized' }).runs;
    assertEqual(cashPaid(person(base, PETRA)), 22000, 'Gegenprobe steueroptimiert: Petra kauft 22.000 €');
}
{
    // Martins Überschuss über das Ziel bestimmt den Kauf; „Was zu tun ist“ nennt denselben Betrag.
    const { runs } = household({ cash: { [MARTIN]: 60000, [PETRA]: 30000 } });
    assertEqual(cashPaid(person(runs, MARTIN)), 52000, 'P2-1/LZ-1: Martin kauft nur seinen Überschuss über das Ziel (52.000 €, vorher 60.000 €)');
    assertEqual(cashPaid(person(runs, PETRA)), 0, 'P2-1: Petra kauft nichts');
    const todo = projectAnnualTodoPlan({ confirmed: { action: runs.finalAction }, people: [{ id: MARTIN, name: 'Martin' }, { id: PETRA, name: 'Petra' }] });
    assertEqual(todo.purchases.reduce((sum, row) => sum + row.amount, 0), 52000, 'P2-1: „Was zu tun ist“ nennt 52.000 € Kauf');
}

// P3-3 · Variante „Martin trägt“ zeigt Verkäufe nur bei Martin.
{
    const { runs } = household({ variant: 'traegt' });
    assert(sold(person(runs, MARTIN)) > 50000, 'P3-3: Martin verkauft in der Variante');
    assertEqual(sold(person(runs, PETRA)) + cashPaid(person(runs, PETRA)), 0, 'P3-3: Petra verkauft und kauft nichts');
    const base = household({ variant: 'traegt', mode: 'tax_optimized' }).runs;
    assert(sold(person(base, PETRA)) > 0, 'Gegenprobe steueroptimiert: Petra verkauft');
}

// P3-4 · Planverkauf in einer Anlageklasse, die Martin nicht hält (Gold nur bei Petra): Verkauf aus Martins Aktien, kein Rückgriff.
{
    const { profiles } = household();
    const list = profiles.map(profile => profile.profileId !== PETRA ? profile : { ...profile, tranches: [...profile.tranches,
        { ...profile.tranches[0], trancheId: 'muster_petra_gold', name: 'Gold', isin: '', type: 'gold', kind: 'gold', category: 'gold',
            marketValue: 10000, costBasis: 8000, shares: 10, currentPrice: 1000, purchasePrice: 800, tqf: 0 }] });
    const sale = { type: 'TRANSACTION', quellen: [{ source: 'Gold', kind: 'gold', category: 'gold', brutto: 5000, netto: 5000, steuer: 0,
        sourceProfileId: PETRA, trancheId: 'muster_petra_gold', realizedGainSigned: 1000, taxableAfterTqfSigned: 1000, tqf: 0 }],
        verwendungen: { liquiditaet: 5000, gold: 0, aktien: 0, geldmarkt: 0, bonds: 0 } };
    const carried = attributeHouseholdAction({ householdAction: sale, profiles: list, mode: CARRIES }).finalAction;
    assertEqual([...new Set(carried.quellen.map(source => source.sourceProfileId))].join(), MARTIN, 'P3-4: Verkauf nur bei Martin (aus seinen Aktien)');
    assertEqual(nonCarrierSales(carried, MARTIN).length, 0, 'P3-4: kein Hinweis nötig');
    const optimized = attributeHouseholdAction({ householdAction: sale, profiles: list, mode: 'tax_optimized' }).finalAction;
    assertEqual(nonCarrierSales(optimized, MARTIN)[0]?.profileId, PETRA, 'Gegenprobe steueroptimiert: Gold bei Petra (wäre im Modus ein Rückgriff mit Hinweis)');
}

// Rückgriff in der Auszahlung (P1-1): Fehlt der tragenden Person Liquidität, ist die Verschiebung ein Rückgriff mit Hinweis.
{
    const list = household().profiles;
    const plan = calculateWithdrawalDistribution(list, { netWithdrawal: 30000 }, CARRIES);
    const shifted = reconcileWithdrawalLiquidity(plan, [{ profileId: MARTIN, tagesgeld: 10000 }, { profileId: PETRA, tagesgeld: 30000 }]);
    assertEqual(shifted.attacked.map(row => `${row.profileId} ${Math.round(row.amount)}`).join(), `${PETRA} 20000`, 'Verschiebung zu Petra steht im Hinweis');
    const steady = reconcileWithdrawalLiquidity(plan, [{ profileId: MARTIN, tagesgeld: 40000 }, { profileId: PETRA, tagesgeld: 30000 }]);
    assertEqual(steady.attacked.length, 0, 'reicht Martins Liquidität, kein Hinweis');
}

// P3-5 · Steuerlast je Euro ohne Tranchen mit Teilfreistellung; eine Person mit und eine ohne Tranchen gleich gerechnet.
{
    const petra = household().profiles.find(profile => profile.profileId === PETRA);
    const withLots = calculateTaxPerEuro(petra.inputs, petra.tranches);
    const tqf = petra.tranches[0].tqf;
    const inputs = { ...petra.inputs, depotwertAlt: 0, costBasisAlt: 0, depotwertNeu: petra.tranches[0].marketValue, costBasisNeu: petra.tranches[0].costBasis, tqfNeu: tqf };
    assertClose(calculateTaxPerEuro(inputs) * 35000, withLots * 35000, 0.01, 'P3-5: ohne Tranchen mit tqfNeu wie mit Tranchen (1.031 € für 35.000 €)');
    assertClose(calculateTaxPerEuro({ ...inputs, tqfNeu: 0 }) * 35000, 1473, 0.5, 'P3-5 Gegenprobe ohne Teilfreistellung: 1.473 €');
}

// P3-6 · Gelöschte tragende Person: Hinweis, gerechnet wird steueroptimiert.
{
    assert(carrierMissing(oneCarriesMode('geloescht'), [{ profileId: MARTIN }, { profileId: PETRA }]), 'P3-6: tragende Person fehlt → Hinweis');
    assert(!carrierMissing(CARRIES, [{ profileId: MARTIN }, { profileId: PETRA }]), 'P3-6: Martin da → kein Hinweis');
    assert(!carrierMissing('tax_optimized', [{ profileId: MARTIN }]), 'P3-6: anderer Modus → kein Hinweis');
    const list = household().profiles;
    const missing = calculateWithdrawalDistribution(list, { netWithdrawal: 60000 }, oneCarriesMode('geloescht'));
    const optimized = calculateWithdrawalDistribution(list, { netWithdrawal: 60000 }, 'tax_optimized');
    assertEqual(JSON.stringify(missing.items.map(item => item.withdrawalAmount)), JSON.stringify(optimized.items.map(item => item.withdrawalAmount)), 'P3-6: gerechnet steueroptimiert');
}

// P3-8 bis P3-11 · Nachschritt VK-1b (Max und Erika).
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { cashBeforeCredits } from '../app/tranches/sale-flow-model.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { projectSaleFlowCard, saleFlowPlanFromConfirmed, readSaleFlowPlan } from '../app/tranches/sale-flow-dialog.js';
import { parseShares, parseQuantity } from '../app/tranches/sale-flow-steps.js';
{
    // P3-8: Erste bestätigte Gutschrift ohne Kontostand, spätere mit: nicht über die fehlende hinweg, sondern heutiges Tagesgeld
    // minus alle bestätigten Gutschriften (12.000 €, vorher 69.264,07 € aus dem späteren Beleg).
    const sales = [{ net: 20400, creditPending: false, cashAfter: null, confirmedAt: '2026-10-24T10:00:00Z' },
        { net: 57264.07, creditPending: false, cashAfter: 126664.07, confirmedAt: '2026-10-25T10:00:00Z' }];
    assertEqual(cashBeforeCredits(sales, 89664.07), 12000, 'P3-8: 89.664,07 − 20.400 − 57.264,07 = 12.000 €');
    assertEqual(cashBeforeCredits([{ ...sales[0], confirmedAt: null }, sales[1]], 89664.07), 12000, 'P3-8: Altbeleg ohne Zeitpunkt ebenso');
    assertEqual(cashBeforeCredits([sales[1], { ...sales[0], confirmedAt: '2026-10-26T10:00:00Z' }], 0), 69400, 'P3-8: spätere Gutschrift ohne Beleg stört den früheren Beleg nicht');
}
{
    // P3-11: Stückzahl wie die Betragsfelder; der Kurs bleibt wie die Kursfelder.
    assertEqual(parseShares('1.245'), 1245, 'P3-11: „1.245“ → 1.245 Stück');
    assertEqual(parseShares('1.245,935'), 1245.935, 'P3-11: „1.245,935“ → 1.245,935 Stück');
    assertEqual(parseShares('685,935'), 685.935, 'P3-11: Komma ist Dezimalzeichen');
    assertEqual(parseShares('12.5'), 12.5, 'P3-11: Punkt mit weniger als drei Ziffern bleibt Dezimalpunkt');
    assertEqual(parseQuantity('144.38'), 144.38, 'P3-11: Kurs „144.38“ bleibt 144,38 €');
}
{
    // P3-9: Tagesgeld einer Person nicht lesbar → „Verteilen“ nicht erledigt, die Karte führt in Schritt 5 mit Hinweis.
    const MAX = 'muster_a', ERIKA = 'muster_b';
    const records = createMusterHaushaltRecords(DATE, 'max-erika', 'grund');
    P.resetPersistenceForTests({ name: 'trg-1b-synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    setAppTestDate(DATE);
    const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
    const entry = Object.values(JSON.parse(storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
    const plan = saleFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MAX, ERIKA], registry());
    // Erika verkauft mit sofortiger Gutschrift; Max' Zeile „Rest bleibt im Depot“ (Max hat damit keinen Beleg mit Kontostand).
    const maxKey = readSaleFlowPlan({ plan, registry: registry() }).lines.find(line => line.profileId === MAX).key;
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ sales: [
        { profileId: ERIKA, actionId: 'trg1b-erika-1', executedAt: DATE, parts: [{ trancheId: 'muster_b_lot_2', shares: 560, gross: 80852.8, fees: 9.9, taxes: 828.1 }], cashValue: 92014.8 }],
        resolution: { year: 2026, ids: [MAX, ERIKA], line: { key: maxKey, decision: 'keep_in_depot' } } }));
    const cash = { householdTarget: 32400, targets: { [MAX]: 5000, [ERIKA]: 27400 }, months: 12 };
    const readable = projectSaleFlowCard({ plan, registry: registry(), cashContext: cash });
    assertEqual(readable.unreadable.length, 0, 'P3-9 Gegenprobe: Tagesgeld lesbar, kein Hinweis');
    const broken = registry();
    broken.profiles[MAX].data.profile_tagesgeld = 'kaputt';
    const card = projectSaleFlowCard({ plan, registry: broken, cashContext: cash });
    assertEqual(card.unreadable.join(), 'Max', 'P3-9: Max\' Tagesgeld nicht lesbar');
    assertEqual(card.steps[4].done, false, 'P3-9: „Verteilen“ nicht erledigt');
    assertEqual(card.next, 5, 'P3-9: Karte führt in Schritt 5');
}
