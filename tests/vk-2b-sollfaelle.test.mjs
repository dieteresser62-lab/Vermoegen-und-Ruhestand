// VK-2b: Nachschritt zu VK-2 und TRG-1b aus den Gutachten (Gemini, Fable). Nur synthetische Daten: Musterhaushalte Martin und Petra
// (unverheiratet), Testdatum 23.10.2026.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { oneCarriesMode } from '../app/profile/household-withdrawal-mode.js';
import { planCarrierAction } from '../app/profile/household-carrier-action.js';
import { unmarriedPayoutPlan, unmarriedWithdrawalPlan } from '../app/simulator/simulator-unmarried.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';

const DATE = '2026-10-23';
const MARTIN = 'muster_martin', PETRA = 'muster_petra';
const CARRIES = oneCarriesMode(MARTIN);
const lot = (id, values) => ({ schemaVersion: 2, trancheId: id, name: id, type: 'aktien_neu', category: 'equity', purchaseDate: '2020-01-02',
    tqf: 0.3, taxExempt: false, sourceProfileId: MARTIN, ...values });
const view = action => ({ cash: () => 0, liquidity: id => id === MARTIN ? (action.verwendungen?.liquiditaet || 0) : 0, result: action });

// Punkt 2 (Gemini P1-2) · Jeder Bestand höchstens einmal: Martin 0 € Tagesgeld, ein Aktienlos 10.000 € (Einstand 0 €, Teilfreistellung 30 %)
// → netto höchstens 10.000 − 10.000 × 0,7 × 26,375 % = 8.153,75 € < Auszahlung 10.000 €. Vorher verkaufte die Schleife dasselbe Los dreimal.
{
    const planned = planCarrierAction({ action: { type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0 }, carrierId: MARTIN,
        cashBefore: 0, payout: 10000, attribute: view, purchase: requested => requested,
        sale: { lots: [lot('eq', { shares: 100, purchasePrice: 0.0001, currentPrice: 100, marketValue: 10000, costBasis: 0.01 })] } });
    const sold = planned.action.quellen.reduce((sum, source) => sum + source.brutto, 0);
    assertClose(sold, 10000, 0.01, 'P1-2: höchstens einmal verkauft (10.000 € brutto, nicht 30.000 €)');
    assertClose(planned.carrierSale, 8153.75, 0.05, 'P1-2: Nettoerlös 8.153,75 €, Rest bleibt für den Rückgriff');
    assertEqual(planned.action.quellen.length, 1, 'P1-2: ein Verkaufsposten');
}
{
    // Zwei Lose: Das zweite Los deckt den Rest nach Steuer, das erste wird nicht doppelt verkauft.
    const planned = planCarrierAction({ action: { type: 'NONE', quellen: [], verwendungen: {}, nettoErlös: 0, steuer: 0 }, carrierId: MARTIN,
        cashBefore: 0, payout: 15000, attribute: view, purchase: requested => requested,
        sale: { lots: [lot('a', { shares: 100, purchasePrice: 0.0001, currentPrice: 100, marketValue: 10000, costBasis: 0.01 }),
            lot('b', { shares: 100, purchasePrice: 100, currentPrice: 100, marketValue: 10000, costBasis: 10000, purchaseDate: '2024-01-02' })] } });
    const byLot = id => planned.action.quellen.filter(source => source.trancheId === id).reduce((sum, source) => sum + source.brutto, 0);
    assert(byLot('a') <= 10000.01 && byLot('b') <= 10000.01, `P1-2: kein Los über seinen Wert verkauft (${byLot('a')}, ${byLot('b')})`);
    assertClose(planned.carrierSale, 15000, 1.01, 'P1-2: Lücke nach Steuer aus weiterem eigenem Bestand gedeckt');
}

// Punkt 3 (Gemini P1-3) · Rückgriff in der Auszahlung: Martin 10.000 €, Petra 20.000 € Tagesgeld, kein Depot, Zielentnahme 60.000 €,
// gezahlt werden können 30.000 €. Vorher kürzte die Auszahlung nur Martin (0 €) und ließ Petra 50.000 € → Ruin trotz Geld.
{
    const portfolio = { personAccounts: [{ profileId: MARTIN, tagesgeld: 10000 }, { profileId: PETRA, tagesgeld: 20000 }],
        depotTranchesAktien: [], depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [] };
    const shares = [{ profileId: MARTIN, carries: true, share: 1, care: 0 }, { profileId: PETRA, carries: false, share: 0, care: 0 }];
    const plan = unmarriedWithdrawalPlan(shares, 60000, portfolio, true, []);
    assertEqual(plan.items.map(item => Math.round(item.withdrawalAmount)).join('/'), '10000/50000', 'P1-3: Plan über 60.000 €: Martin 10.000 €, Petra 50.000 € (Rückgriff)');
    const paid = unmarriedPayoutPlan({ ...plan, credits: [] }, shares, { payout: 30000, incomeConsumed: 0, plannedExpense: 0, target: 60000 }, portfolio);
    assertEqual(paid.items.map(item => Math.round(item.withdrawalAmount)).join('/'), '10000/20000', 'P1-3: gezahlt 30.000 €: Martin 10.000 €, Petra den Rest 20.000 €');
    assertEqual(paid.attacked?.[0]?.profileId, PETRA, 'P1-3: Rückgriff auf Petra mit Hinweis');
    // Gegenprobe ohne tragende Person: lineare Kürzung nach Anteil wie bisher (Vorgabemodus bytegleich).
    const linear = unmarriedPayoutPlan({ items: [{ withdrawalAmount: 40000 }, { withdrawalAmount: 20000 }] },
        [{ profileId: MARTIN, share: 2 / 3 }, { profileId: PETRA, share: 1 / 3 }], { payout: 30000, incomeConsumed: 0, plannedExpense: 0, target: 60000 }, portfolio);
    assertEqual(linear.items.map(item => Math.round(item.withdrawalAmount)).join('/'), '20000/10000', 'P1-3: Vorgabemodus kürzt weiter linear');
}

// Punkt 3 · Simulator (historischer Lauf 2000–2025) mit erschöpfter tragender Person: Martin ohne Tagesgeld und Depot, Petra 30.000 €
// Tagesgeld und 70.000 € Depot. Klärung Gemini ↔ Fable: Vorher scheiterte der Lauf an „Persönlicher Ausgabenanteil ungedeckt“, während Petra
// noch Geld hatte (Bedarf 36.000 + 60.000 €: 2024; 80.000 + 20.000 €: 2014). Nachher zahlt Petra den Rest mit Hinweis; der Lauf scheitert nur,
// wenn beide nicht reichen (Gesamtvermögen unter dem Floor).
{
    const base = await measurementInputs(0, 'martin-petra', DATE);
    const run = (floor, flex) => {
        const inputs = structuredClone(base);
        inputs.householdWithdrawalMode = CARRIES;
        inputs.detailledTranches = inputs.detailledTranches.filter(tranche => tranche.sourceProfileId !== MARTIN);
        const martin = inputs.simulationPeople.find(person => person.profileId === MARTIN);
        inputs.tagesgeld -= martin.tagesgeld; martin.tagesgeld = 0;
        Object.assign(inputs, { startFloorBedarf: floor, floorBedarf: floor, startFlexBedarf: flex, flexBedarf: flex });
        return backtest(inputs, 2000, 2025);
    };
    const flexHeavy = run(36000, 60000);
    assertEqual(flexHeavy.outcome.kind, 'completed', 'P1-3: Einkünfte decken den Floor, Petra zahlt den Rest: kein Scheinruin (vorher 2024)');
    assert(flexHeavy.rows.some(entry => entry.row.personalPayout?.attacked?.some(row => row.profileId === PETRA)), 'P1-3: Rückgriff auf Petra steht im Protokoll');
    const floorHeavy = run(80000, 20000);
    assertEqual(floorHeavy.outcome.kind, 'ruin', 'P1-3: reicht beider Vermögen nicht, scheitert der Lauf');
    assert(/^Gesamtvermögen/.test(floorHeavy.outcome.reason), `P1-3: Grund ist das Gesamtvermögen, nicht der persönliche Anteil (${floorHeavy.outcome.reason})`);
    assertEqual(floorHeavy.outcome.ruinYear, 2015, 'P1-3: Ruin erst 2015, wenn beide nicht reichen (vorher 2014 mit Geld bei Petra)');
    // LZ-1: Martin füllt seine Liquidität seither ohne Petras Tagesgeld auf (Rückgriff über Petras Verkäufe); er zahlt dadurch bis 2014 selbst.
    assert(floorHeavy.rows.some(entry => entry.row.personalPayout?.attacked?.some(row => row.profileId === PETRA)
        || /angegriffen/.test(String(entry.row.aktionUndGrund || ''))), 'P1-3: Rückgriff auf Petra steht im Protokoll');
}

// Punkt 5 (Gemini P2-2) · Anleihen der tragenden Person, Bärenmarkt im 3-Töpfe-Modus (Ausgangslage wie „Balance 3-Bucket bear“: Jahresende 70,
// Jahreshoch 100). Martin hält 100.000 € Anleihen, Tagesgeld 5.000 / 5.000 €, Bedarf 60.000 + 24.000 €.
setAppTestDate(DATE);
function threeBucket(mode, bear) {
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', 'grund');
    const plan = JSON.parse(data.household_plan_v1);
    for (const entry of Object.values(plan.entries)) Object.assign(entry.values, { householdWithdrawalMode: mode, floorBedarf: 60000, flexBedarf: 24000 });
    data.household_plan_v1 = JSON.stringify(plan);
    const registry = JSON.parse(data.rs_profiles_v1);
    const bond = { schemaVersion: 2, trancheId: 'muster_martin_bond', name: 'Muster Anleihen-ETF', type: 'anleihe', category: 'bonds', shares: 1000,
        purchasePrice: 100, currentPrice: 100, purchaseDate: '2022-01-03', tqf: 0, taxExempt: false, marketValue: 100000, costBasis: 100000 };
    const tranches = [...JSON.parse(registry.profiles[MARTIN].data.depot_tranchen), bond];
    registry.profiles[MARTIN].data.depot_tranchen = JSON.stringify(tranches);
    data.depot_tranchen = JSON.stringify(tranches);
    for (const id of [MARTIN, PETRA]) registry.profiles[id].data.profile_tagesgeld = '5000';
    data.profile_tagesgeld = '5000';
    data.rs_profiles_v1 = JSON.stringify(registry);
    const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => data[key] ?? null }, referenceYear: 2026 });
    calc.inputData.decumulation = { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: 80 };
    if (bear) Object.assign(calc.inputData, { inflation: 0, endeVJ: 70, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100, jahreSeitAth: 1 });
    const runs = evaluateStoredAnnualHousehold(calc.inputData, calc.profiles, calc.engineLastState, { engineApi: EngineAPI, withdrawalMode: mode });
    const sales = id => (runs.find(entry => entry.profileId === id).ui.action.quellen || []).filter(source => source.kind !== 'liquiditaet');
    return { runs, sales };
}
{
    const bear = threeBucket(CARRIES, true);
    const martin = bear.sales(MARTIN);
    assert(martin.length > 0 && martin.every(source => source.category === 'bonds'), `P2-2: im Bärenmarkt verkauft Martin Anleihen, keine Aktien (${JSON.stringify(martin.map(source => source.category))})`);
    assertEqual(bear.sales(PETRA).length, 0, 'P2-2: Petra verkauft nichts');
    assertEqual(bear.runs.distribution.attacked?.length || 0, 0, 'P2-2: kein Rückgriff, Martins Anleihen reichen');
    // Gegenprobe ohne Bärenmarkt: Martin trägt allein, Petra bleibt unangetastet (Reihenfolge dort wie bisher: Aktien vor Anleihen).
    const calm = threeBucket(CARRIES, false);
    assertEqual(calm.sales(PETRA).length, 0, 'P2-2: ohne Bärenmarkt verkauft Petra nichts');
    assert(calm.sales(MARTIN).length > 0, 'P2-2: ohne Bärenmarkt verkauft Martin')
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Geführter Kauf (VK-2-Nachschritt). Speicher im Testbereich, nur Musterhaushalte.
import strict from 'node:assert/strict';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { buyFlowPlanFromConfirmed, suggestedSecurity, buildBuyTranche, securityFromHit, readBuyFlowPlan } from '../app/tranches/buy-flow-dialog.js';
import { buyOverviewStep, debitStep, draftBuySettlement } from '../app/tranches/buy-flow-steps.js';
import { restBuyQuestionAmount, buyRestLimit, projectBuyLines } from '../app/tranches/buy-flow-model.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { readReconciliationHistory } from '../app/tranches/tranche-reconciliation.js';
import { pendingDebitPeople, openDebitNotes } from '../app/tranches/buy-debit-dialog.js';
import { createOpenDebitsNote, createPlanProgressNote } from '../app/shared/annual-todo-view.js';
import { buildOpenDebitsHtml } from '../app/tranches/tranchen-manager-renderer.js';
import { nonCarrierSales } from '../app/profile/household-carrier-action.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const HELGA = 'muster_helga', WERNER = 'muster_werner';
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const texts = node => walk(node).map(item => item.textContent || '').join(' ');

// Punkt 1 (Gemini P1-1, Fable P3-1) · Kaufplan mit Aktien und Gold (Werte wie Helga und Werner, beide halten Gold): Schritt 1 zeigt je Klasse eine
// Wertpapierwahl, beide neuen Tranchen tragen Name und ISIN ihres Wertpapiers (keine Tranche „Wertpapier“ ohne ISIN).
{
    const registry = JSON.parse(createMusterHaushaltRecords(DATE, 'helga-werner', 'grund').rs_profiles_v1);
    const action = { type: 'TRANSACTION', verwendungen: { aktien: 20000, gold: 5000 },
        quellen: [{ kind: 'liquiditaet', source: 'Liquidität', brutto: 25000, netto: 25000, steuer: 0, sourceProfileId: HELGA }] };
    const plan = buyFlowPlanFromConfirmed({ year: 2026, committedAt: '2026-01-10T10:00:00.000Z', action }, [HELGA, WERNER], registry, 'proportional');
    assertEqual(plan.lines.map(line => `${line.assetClass}:${line.amount}`).join(), 'equity:20000,gold:5000', 'P1-1: zwei Kaufzeilen, Aktien und Gold');
    const securities = plan.lines.map(line => suggestedSecurity(registry, plan.people, line.assetClass));
    assertEqual(securities.map(security => security.name).join(' | '), 'Muster Aktien-ETF | Xetra-Gold ETC', 'P1-1: je Klasse ein eigenes Wertpapier (Vorschlag)');
    const view = { lines: readBuyFlowPlan({ plan, registry }).lines, plan: true, decidedOn: '10.01.2026', cash: {}, suggestion: securities[1], choice: 'suggestion', security: securities[1],
        search: { query: '', status: 'idle' }, quoteDate: DATE, play: true, onChoose() {}, onSearch() {}, onPick() {}, onSecurity() {},
        classes: [{ id: 'equity', label: 'Aktien', active: false, done: true }, { id: 'gold', label: 'Gold', active: true, done: false }], onClass() {} };
    const dom = buyOverviewStep(new MockDocument(), view);
    const segment = walk(dom).filter(node => node.dataset?.buyFlowClass);
    assertEqual(segment.map(node => node.dataset.buyFlowClass).join(), 'equity,gold', 'P1-1: Schritt 1 zeigt die Wahl je Anlageklasse');
    assert(texts(dom).includes('Xetra-Gold ETC') && texts(dom).includes('DE000A0S9GB0'), 'P1-1: für Gold steht das Gold-Wertpapier mit ISIN zur Wahl');
    const values = { shares: 10, pricePerShare: 100.99, gross: 1000 };
    const tranches = plan.lines.map((line, index) => buildBuyTranche(securities[index], line, values, { trancheId: `t${index}`, executedAt: DATE }));
    assert(tranches.every(item => item.name !== 'Wertpapier' && /^[A-Z]{2}[A-Z0-9]{10}$/.test(item.isin)), `P1-1: beide Tranchen mit Name und ISIN (${tranches.map(item => `${item.name} ${item.isin}`).join(', ')})`);
    assertEqual(tranches.map(item => item.category).join(), 'equity,gold', 'P1-1: Anlageklasse je Tranche richtig');
}

// Punkt 8 (Fable P2-3) · Suchtreffer überschreibt die gesetzte Anlageklasse nicht: Geldmarkt kaufen, Treffer XEON.DE vom Typ ETF → bleibt Geldmarkt.
{
    const hit = { symbol: 'XEON.DE', name: 'Xtrackers II EUR Overnight Rate Swap', exchange: 'Xetra', price: 121.48, asOf: 1792713600, status: 'ok', assetClass: 'equity' };
    const fixed = securityFromHit(hit, { fixed: 'money_market', fallback: 'equity' });
    assertEqual(fixed.assetClass, 'money_market', 'P2-3: Vorbelegung Geldmarkt bleibt');
    assertEqual(fixed.tqf, 0, 'P2-3: Teilfreistellung 0 %, keine Bestätigung nötig');
    assertEqual(securityFromHit({ ...hit, symbol: '4GLD.DE', name: 'Xetra-Gold' }, { fixed: 'gold' }).assetClass, 'gold', 'P2-3: Goldzeile bleibt Gold');
    assertEqual(securityFromHit(hit, { fixed: null, fallback: 'gold' }).assetClass, 'equity', 'P2-3: ohne Vorgabe ist der Typ des Treffers der Vorschlag');
    assertEqual(securityFromHit(hit, { fixed: null }).tqf, null, 'P2-3: bei Aktien bestätigt der Nutzer die Teilfreistellung');
}

// P3-3, P3-5, Gemini P3-2 · Neue Kauftranche nie ganz steuerfrei; „Ohne Kursabruf“ nur ohne Kürzel (nicht bei veraltetem Kurs).
{
    const values = { shares: 10, pricePerShare: 101, gross: 1000 };
    const stale = buildBuyTranche({ name: 'ETF', isin: 'IE00BK5BQT80', ticker: 'VWCE.DE', assetClass: 'equity', tqf: 0.3, taxExempt: true, check: 'stale', available: false, price: 100, asOf: 1792000000 },
        { assetClass: 'equity' }, values, { trancheId: 'x', executedAt: DATE });
    assertEqual(stale.taxExempt, false, 'P3-3: neuer Kauf erbt „ganz steuerfrei“ nicht');
    assertEqual(stale.notes, '', 'Gemini P3-2/P3-5: veralteter Kurs mit Kürzel → keine Notiz „Ohne Kursabruf“');
    assertEqual(stale.asOf, 1792000000, 'veralteter Kurs: Kursdatum bleibt');
    const manual = buildBuyTranche({ name: 'Fonds', isin: 'DE0001234567', ticker: '', assetClass: 'equity', tqf: 0.3 }, { assetClass: 'equity' }, values, { trancheId: 'y', executedAt: DATE });
    assertEqual(manual.notes, 'Ohne Kursabruf – Kurs von Hand pflegen.', 'ohne Kürzel: Notiz bleibt');
}

// Gemini P3-1 · Rest genau auf der Grenze: Rest-Frage erscheint (vorher stumm „teilweise“). Plan 1.000 €, Kurs 100 €, Grenze 500 €, Belastung 500 €.
assertEqual(buyRestLimit(1000, 100), 500, 'Gemini P3-1: Grenze 500 €');
assertEqual(restBuyQuestionAmount({ restAmount: 1000, amount: 1000, price: 100 }, 500), 500, 'Gemini P3-1: Rest 500 € = Grenze → Rest-Frage');

// P3-6 · Karte und Dialog: Erledigt-Grenze mit dem Kurs des eingetragenen Kaufs. Plan 5.000 €, Stück 2.000 €, Rest 1.500 € → beide erledigt.
{
    const buys = [{ profileId: MARTIN, assetClass: 'equity', executedAt: DATE, shares: 1.75, gross: 3500, debit: 3500 }];
    const line = { key: 'buy:m:equity', profileId: MARTIN, assetClass: 'equity', amount: 5000 };
    const card = projectBuyLines({ lines: [line], buys, year: 2026, prices: { [line.key]: 144.47 } })[0];
    const dialog = projectBuyLines({ lines: [line], buys, year: 2026, prices: { [line.key]: 2000 } })[0];
    assertEqual(`${card.status}/${dialog.status}`, 'erledigt/erledigt', 'P3-6: Karte und Dialog sagen dasselbe (vorher Karte teilweise)');
}

// P3-7 (Nachtrag 1) · Hinweis nur, wenn Vermögen der anderen Person verwendet wird: Auffüllverkauf bei Petra, Erlös bleibt auf ihrem Tagesgeld → kein Hinweis.
{
    const action = { quellen: [{ kind: 'aktien_neu', sourceProfileId: PETRA, brutto: 80540, steuer: 1500, netto: 79040 }] };
    assertEqual(nonCarrierSales(action, MARTIN, [{ profileId: PETRA, action: { verwendungen: { liquiditaet: 79040 } } }]).length, 0, 'P3-7: Auffüllverkauf ohne Hinweis');
    assertEqual(nonCarrierSales(action, MARTIN, [{ profileId: PETRA, action: { verwendungen: { liquiditaet: 40000 } } }])[0]?.amount, 39040, 'P3-7: verwendeter Teil mit Hinweis');
}

async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'vk-2b-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const tranche = (trancheId, shares, debit) => ({ schemaVersion: 2, trancheId, name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE',
    isin: 'IE00BK5BQT80', shares, purchasePrice: debit / shares, currentPrice: 144.46978, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' });

// Punkt 6 (Fable P2-1) · Kaufbeleg geprüft: „9,905“ wird im Dialog auf Cent gerundet; der Schreiber weist Beträge außerhalb des Cents ab;
// der Verlauf bleibt lesbar. P3-4: Tranche und Beleg passen zueinander, kein Ausführungstag in der Zukunft.
{
    setAppTestDate(DATE);
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    const values = draftBuySettlement({ restAmount: 1500 }, { shares: 10, price: '144,41', fees: '9,905' }, { price: 144.41 });
    assertEqual(`${values.gross}/${values.fees}/${values.debit}`, '1444.1/9.91/1454.01', 'P2-1: 10 × 144,41 € + 9,91 € = 1.454,01 € (Gebühren auf Cent gerundet)');
    const buy = (overrides = {}) => ({ profileId: MARTIN, actionId: 'vk2b-1', executedAt: DATE, assetClass: 'equity', tranche: tranche('vk2b_lot', 10, 1454.01),
        shares: 10, gross: 1444.1, fees: 9.91, cashValue: null, ...overrides });
    await strict.rejects(prepareSaleFlowWrite({ buys: [buy({ fees: 9.905, tranche: tranche('vk2b_lot', 10, 1454.005) })] }), error => error?.code === 'BUY_FLOW_INVALID', 'P2-1: Gebühren 9,905 abgewiesen');
    await strict.rejects(prepareSaleFlowWrite({ buys: [buy({ tranche: tranche('vk2b_lot', 685, 685) })] }), error => error?.code === 'BUY_FLOW_INVALID', 'P3-4: Tranche 685 Stück zu 1 € passt nicht zum Beleg');
    await strict.rejects(prepareSaleFlowWrite({ buys: [buy({ executedAt: '2026-10-24', tranche: { ...tranche('vk2b_lot', 10, 1454.01), purchaseDate: '2026-10-24' } })] }), error => error?.code === 'BUY_FLOW_INVALID', 'P3-4: Ausführungstag in der Zukunft abgewiesen');
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [buy()] }));
    assertEqual(readReconciliationHistory(registry()).find(record => record.actionId === 'vk2b-1')?.actual.netCashDebited, 1454.01, 'P2-1: Beleg gespeichert, Verlauf lesbar');

    // Punkt 7 (Fable P2-2) · offene Abbuchung ohne Planzeile: Martin hat nur diesen freien Kauf („Kommt noch“). Erinnerung in Personen & Vermögen
    // und in der Karte, Bestätigen über denselben Schreiber.
    const notes = openDebitNotes(registry(), [MARTIN, PETRA]);
    assertEqual(notes.map(note => `${note.who} ${note.amount}`).join(), 'Martin 1454.01', 'P2-2: offene Abbuchung erkannt (ohne Planzeile)');
    const card = createOpenDebitsNote(new MockDocument(), notes, [MARTIN]);
    assert(texts(card).includes('Abbuchung nachtragen') && walk(card).some(node => node.dataset?.buyDebitOpen === MARTIN), 'P2-2: Karte zeigt „Abbuchung nachtragen“ mit Einstieg');
    assert(buildOpenDebitsHtml(notes).includes('data-buy-debit-open'), 'P2-2: Personen & Vermögen zeigt die Erinnerung mit Knopf');
    const people = pendingDebitPeople(registry(), [MARTIN]);
    const dom = debitStep(new MockDocument(), { people, missing: [], drafts: {}, lines: [], plan: false, onChange() {}, onSettle() {} });
    assert(walk(dom).filter(node => node.dataset?.buyFlowDebitChoice).every(node => !node.checked), 'P2-2: im Kauf ohne Plan ist nichts vorgewählt');
    const cash = Number(registry().profiles[MARTIN].data.profile_tagesgeld);
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ debits: [{ profileId: MARTIN, targetActionIds: people[0].buys.map(item => item.actionId), value: cash - 1454.01 }] }));
    assertEqual(openDebitNotes(registry(), [MARTIN]).length, 0, 'P2-2: nach dem Bestätigen keine Erinnerung mehr');
}

// Punkt 4 (Gemini P2-1, Fable P3-2) · Jahresabschluss, reiner Kaufplan (Martin und Petra): Schritt „Plan“ zeigt den Stand der Käufe und „Abbuchung unterwegs“.
{
    const dom = createPlanProgressNote(new MockDocument(), { year: 2026, status: null, soldNet: 0, planNet: 0, lines: [], debitPendingNet: 21677.5,
        buy: { status: 'teilweise', bought: 21677.5, plan: 122000, kept: false } });
    assertEqual(dom.dataset.annualPlanProgress, 'offen', 'P2-4: Rahmen ohne Verkaufsstand');
    // VN-1 Punkt 4: Plan und Gekauftes auf den Euro wie in der Karte.
    assert(texts(dom).includes('21.678 € von 122.000 € gekauft'), `P2-4: Stand der Käufe sichtbar (${texts(dom)})`);
    assert(texts(dom).includes('Abbuchung unterwegs: Vermögen um 21.677,50 € zu hoch'), 'P2-4: Abbuchung unterwegs sichtbar');
    assert(walk(dom).some(node => node.dataset?.todoStatus === 'teilweise'), 'P2-4: Stand „Teilweise umgesetzt“ aus den Käufen');
}
