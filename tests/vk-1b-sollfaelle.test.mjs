// VK-1b: Sollfälle aus den Gutachten zu VK-1 (Fable und Gemini). Nur synthetische Daten: Musterhaushalt Max und Erika,
// Testdatum 23.10.2026, Spielkurse.
import strict from 'node:assert/strict';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { distributeCredits, cashBeforeCredits, settleSale, settlementReady, splitOrder, restQuestionAmount, projectSaleFlowLines } from '../app/tranches/sale-flow-model.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { readSaleFlowPlan, projectSaleFlowCard, projectSaleFlowDistribution, saleFlowPlanFromConfirmed, groupDecision, moneyMarketBuyHref } from '../app/tranches/sale-flow-dialog.js';
import { creditStep, parseMoney, parseQuantity, settleStep, distributeStep, overviewStep, shownPlanTotal } from '../app/tranches/sale-flow-steps.js';
import { projectAnnualActionProgress } from '../app/balance/annual-action-progress.js';
import { isAllowedSnapshotRestoreLiveKey } from '../app/shared/persistence-key-policy.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const DATE = '2026-10-23';
const MAX = 'muster_a', ERIKA = 'muster_b';
const CASH = { householdTarget: 32400, targets: { [MAX]: 5000, [ERIKA]: 27400 }, months: 12 };

async function freshArea(records) {
    P.resetPersistenceForTests({ name: 'vk-1b-synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const snapshot = () => JSON.stringify(Object.fromEntries(P.keysSync().sort().map(key => [key, P.getItemSync(key)])));
const erikaSale = (overrides = {}) => ({ profileId: ERIKA, actionId: 'vk1b-erika-1', executedAt: DATE,
    parts: [{ trancheId: 'muster_b_lot_2', shares: 560, gross: 80852.8, fees: 9.9, taxes: 828.1 }], ...overrides });
const maxSale = (overrides = {}) => ({ profileId: MAX, actionId: 'vk1b-max-1', executedAt: DATE,
    parts: [{ trancheId: 'muster_a_lot_2', shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }], ...overrides });
const text = node => [node.textContent || '', ...(node.children || []).map(text)].join(' ').replace(/\s+/g, ' ');
const find = (node, test) => test(node) ? node : (node.children || []).reduce((hit, child) => hit || find(child, test), null);
async function write(request) { await commitSaleFlowWrite(await prepareSaleFlowWrite(request)); }
async function start() {
    setAppTestDate(DATE);
    await freshArea(createMusterHaushaltRecords(DATE, 'max-erika', 'grund'));
    const entry = Object.values(JSON.parse(storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
    return saleFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MAX, ERIKA], registry());
}
const distribution = (plan, reg = registry()) => projectSaleFlowDistribution({ lines: readSaleFlowPlan({ plan, registry: reg }).lines, registry: reg,
    people: plan.people, cashContext: CASH, plan });
const row = (view, id) => view.distribution.rows.find(item => item.profileId === id);

// P1-01 (Gemini) · Verteilung mit einer Person ohne Verkauf: Max zählt mit Tagesgeld 18.000 € zur Lücke, verteilt wird nur an Erika.
{
    const plan = await start();
    await write({ sales: [erikaSale({ cashValue: 92014.8 })] });
    const view = distribution(plan);
    assertEqual(view.distribution.gap, 2400, 'P1-01: Lücke 32.400 − 30.000 = 2.400 € (vorher 20.400 €)');
    assertEqual(row(view, ERIKA).toCash, 2400, 'P1-01: Erika +2.400 € aufs Tagesgeld');
    assertEqual(row(view, ERIKA).toMoneyMarket, 77614.8, 'P1-01: Erika 77.614,80 € in den Geldmarkt (vorher 59.614,80 €)');
    assertEqual(row(view, MAX).toCash, 0, 'P1-01: Max ohne Gutschrift bekommt nichts');
    const old = distributeCredits({ householdTarget: 32400, people: [{ profileId: ERIKA, name: 'Erika', cashBefore: 12000, target: 27400, credit: 80014.8 }] });
    assertEqual(old.rows[0].toCash, 20400, 'P1-01 Gegenprobe alt: ohne Max 20.400 € aufs Tagesgeld');
}

// P2-3 (Fable) · „Tagesgeld vorher“ aus dem Bestätigungsbeleg; ein späterer Geldmarktkauf von Max ändert Erikas Zeile nicht.
// P2-4 (Fable) · Rest unter einem Stück zum letzten Kurs: Zeile „Geldmarkt kaufen“ erledigt.
{
    const plan = await start();
    await write({ sales: [maxSale({ cashValue: 27388.9 }), erikaSale()] });
    await write({ credits: [{ profileId: ERIKA, targetActionIds: ['vk1b-erika-1'], value: 92014.8 }] });
    assertEqual(row(distribution(plan), ERIKA).toMoneyMarket, 77614.8, 'P2-3: Ausgangslage Erika 77.614,80 €');
    const reg = registry();
    const max = reg.profiles[MAX].data, erika = reg.profiles[ERIKA].data;
    const buy = (data, id, shares) => { const list = JSON.parse(data.depot_tranchen);
        list.push({ ...list.find(item => item.type === 'geldmarkt'), trancheId: id, shares, purchasePrice: 121.478441, purchaseDate: DATE }); data.depot_tranchen = JSON.stringify(list); };
    max.profile_tagesgeld = '18000';
    let view = distribution(plan, reg);
    assertEqual(row(view, ERIKA).toMoneyMarket, 77614.8, 'P2-3: Max trägt 18.000 € nach → Erika bleibt 77.614,80 € (vorher 68.225,90 €)');
    assertEqual(cashBeforeCredits([{ net: 9388.9, creditPending: false, cashAfter: 27388.9, confirmedAt: '2026-10-23T10:00:00Z' }], 15000), 18000, 'P2-3: Max vorher 18.000 € aus dem Beleg, nicht aus dem heutigen Tagesgeld');
    assertEqual(cashBeforeCredits([{ net: 100, creditPending: true }], null), null, 'P2-3: Tagesgeld nicht lesbar → kein stilles 0 €');
    buy(max, 'mm-max-kauf', 77);
    buy(erika, 'mm-erika-kauf', 638);
    view = distribution(plan, reg);
    assertClose(view.moneyMarket[MAX].open, 35.06, 0.01, 'P2-4: Max Rest 35,06 €');
    assertEqual(view.moneyMarket[MAX].due, false, 'P2-4: Max 35,06 € < 121,48 € → erledigt');
    assertClose(view.moneyMarket[ERIKA].open, 111.55, 0.01, 'P2-4: Erika Rest 111,55 €');
    assertEqual(view.moneyMarket[ERIKA].due, false, 'P2-4: Erika 111,55 € < 121,48 € → erledigt');
    const card = projectSaleFlowCard({ plan, registry: reg, cashContext: CASH });
    assertEqual(card.buys.length, 0, 'P2-4: Karte ohne Zeile „Geldmarkt kaufen“');
    assertEqual(card.steps[4].done, true, 'P2-4: Schritt „Verteilen“ erledigt');
}

// P2-1 (Fable, Gemini P2-01) · Gutschrift: zweite Abrechnung nach bestätigter erster zählt nur die offene.
{
    const plan = await start();
    await write({ sales: [erikaSale({ actionId: 'vk1b-erika-a', parts: [{ trancheId: 'muster_b_lot_2', shares: 400, gross: 57752, fees: 9.9, taxes: 478.03 }], cashValue: 69264.07 })] });
    await write({ sales: [erikaSale({ actionId: 'vk1b-erika-b', parts: [{ trancheId: 'muster_b_lot_2', shares: 158, gross: 22812.04, fees: 9.9, taxes: 61.24 }] })] });
    const sales = readSaleFlowPlan({ plan, registry: registry() }).lines.flatMap(line => line.sales).filter(sale => sale.profileId === ERIKA);
    assertEqual(sales.length, 2, 'P2-1: zwei Abrechnungen Erika');
    const person = { profileId: ERIKA, name: 'Erika', sales, pending: true, cash: 69264.07, cashError: null };
    const view = creditStep(new MockDocument(), { people: [person], drafts: { [ERIKA]: { choice: 'now' } }, onChange: () => {} });
    const field = find(view, node => node.dataset?.saleFlowCash === ERIKA);
    assertEqual(field.value, '92.005', 'P2-1: Vorschlag 69.264,07 + 22.740,90 = 92.004,97 €, angezeigt in ganzen Euro (VN-4 Nachtrag 1 N2; vorher 149.269,04 €)');
    assert(text(view).includes('22.740,90 €') && !text(view).includes('80.004,97'), 'P2-1: Anzeige nennt nur die offene Gutschrift');
    const max = creditStep(new MockDocument(), { people: [{ profileId: MAX, name: 'Max', sales: [{ net: 9388.9, creditPending: true, executedAt: DATE, shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }],
        pending: true, cash: 18000, cashError: null }], drafts: { [MAX]: { choice: 'now' } }, onChange: () => {} });
    assertEqual(find(max, node => node.dataset?.saleFlowCash === MAX).value, '27.389', 'P2-1: Max bleibt 27.388,90 €, angezeigt in ganzen Euro (VN-4 Nachtrag 1 N2)');
    void snapshot; void strict;
}

// P2-2 (Fable) · Betragseingabe wie die übrigen Betragsfelder; Kurs und Stück wie die Kursfelder.
{
    assertEqual(parseMoney('92.014'), 92014, 'P2-2: „92.014“ → 92.014,00 € (vorher 92,01 €)');
    assertEqual(parseMoney('92.014,80'), 92014.8, 'P2-2: „92.014,80“ → 92.014,80 €');
    assertEqual(parseMoney('92014,80 €'), 92014.8, 'P2-2: ohne Tausenderpunkt mit Euro-Zeichen');
    assertEqual(parseMoney('9,90'), 9.9, 'P2-2: Gebühren mit Komma');
    assertEqual(parseMoney('-25,50'), -25.5, 'P2-2: Erstattung negativ');
    assert(Number.isNaN(parseMoney('1.2.3,4')), 'P2-2: uneindeutige Eingabe ungültig');
    assertEqual(parseQuantity('144.38'), 144.38, 'P2-2: Kurs „144.38“ → 144,38 €');
    assertEqual(parseQuantity('144,38'), 144.38, 'P2-2: Kurs „144,38“');
    assertEqual(parseQuantity('560'), 560, 'P2-2: Stück 560');
    assert(Number.isNaN(parseMoney('')), 'P2-2: leer ergibt keinen Betrag');
}

// P2-02 (Gemini) · Doppelschutz mit Gutschriftstand: gleiche Wiederholung idempotent, abweichender Stand ist Konflikt.
{
    await start();
    await write({ sales: [erikaSale({ actionId: 'order-muster_b-42' })] });
    const before = snapshot();
    const again = await prepareSaleFlowWrite({ sales: [erikaSale({ actionId: 'order-muster_b-42' })] });
    assertEqual(again.results[0].status, 'duplicate', 'P2-02: gleiche Wiederholung bleibt idempotent');
    await strict.rejects(prepareSaleFlowWrite({ sales: [erikaSale({ actionId: 'order-muster_b-42', cashValue: 92014.8 })] }),
        error => error?.code === 'RECONCILIATION_ACTION_CONFLICT');
    assertEqual(snapshot(), before, 'P2-02: abweichender Gutschriftstand ist Konflikt, nichts geschrieben (vorher still „duplicate“)');
    await write({ sales: [maxSale({ actionId: 'order-muster_a-7', cashValue: 27388.9 })] });
    const max = await prepareSaleFlowWrite({ sales: [maxSale({ actionId: 'order-muster_a-7', cashValue: 27388.9 })] });
    assertEqual(max.results[0].status, 'duplicate', 'P2-02: Wiederholung mit gleichem Kontostand idempotent');
    await strict.rejects(prepareSaleFlowWrite({ sales: [maxSale({ actionId: 'order-muster_a-7', cashValue: 27390 })] }),
        error => error?.code === 'RECONCILIATION_ACTION_CONFLICT');
}

// P2-03 (Gemini) · Verkauf ohne Stück: Knopf gesperrt, der Schreiber lehnt Verkäufe ohne Teile ab.
{
    await start();
    const values = { shares: 0, ...settleSale({ shares: 0, price: 144.38, fees: 0, credit: 500, fromCredit: true }) };
    assertEqual(values.net, 500, 'P2-03: 0 Stück mit Gutschrift 500 € ergäbe Netto 500 €');
    assertEqual(settlementReady(values), false, 'P2-03: Knopf gesperrt');
    assertEqual(settlementReady({ shares: 560, ...settleSale({ shares: 560, price: 144.38, fees: 9.9, taxes: 828.1 }) }), true, 'P2-03: gültige Abrechnung freigegeben');
    const before = snapshot();
    await strict.rejects(prepareSaleFlowWrite({ sales: [{ profileId: ERIKA, actionId: 'leer', executedAt: DATE, parts: [], cashValue: 12500 }] }),
        error => error?.code === 'SALE_FLOW_NO_PARTS');
    assertEqual(snapshot(), before, 'P2-03: nichts geschrieben');
}

// P2-05 (Gemini) · Ohne Geldmarkt-ETF: Zeile „Geldmarkt kaufen“ trotzdem, Kauflink ohne fremde Vorlage, mit Betrag.
{
    const plan = await start();
    await write({ sales: [maxSale({ cashValue: 27388.9 }), erikaSale({ cashValue: 92014.8 })] });
    const reg = registry();
    reg.profiles[ERIKA].data.depot_tranchen = JSON.stringify(JSON.parse(reg.profiles[ERIKA].data.depot_tranchen).filter(item => item.type !== 'geldmarkt'));
    const card = projectSaleFlowCard({ plan, registry: reg, cashContext: CASH });
    const erika = card.buys.find(buy => buy.profileId === ERIKA);
    assert(erika, 'P2-05: Zeile „Geldmarkt kaufen“ für Erika auch ohne Geldmarkt-Tranche (vorher keine Zeile)');
    assertEqual(erika.href, `depot-tranchen-manager.html?person=${ERIKA}&betrag=77614.80#kauf`, 'P2-05: Kauf mit Betrag, ohne fremde Tranche');
    assertEqual(card.steps[4].done, false, 'P2-05: Schritt „Verteilen“ offen wie im Ablauf');
    const view = distribution(plan, reg);
    const dom = distributeStep(new MockDocument(), { distribution: view.distribution, moneyMarket: view.moneyMarket, months: 12, pending: view.pending, kept: false,
        buyHref: item => moneyMarketBuyHref(item, view.moneyMarket[item.profileId]), onKeepCash: () => {} });
    const words = text(dom);
    assert(words.includes('Erika: noch kein Geldmarkt-ETF im Depot') && words.includes('Max: Geldmarkt-ETF'), 'P2-05: je Person der eigene Geldmarkt-ETF, keine Partner-ISIN');
    const buttons = [];
    (function walk(node) { if (node.dataset?.saleFlowBuy) buttons.push(node); (node.children || []).forEach(walk); })(dom);
    assert(buttons.length === 2 && buttons.every(node => node.className.includes('ds-button-secondary')), 'Schritt 5: „Geldmarkt kaufen“ sekundär, „Verkauf abschließen“ bleibt die dunkle Hauptaktion');
    const kept = distributeStep(new MockDocument(), { distribution: view.distribution, moneyMarket: view.moneyMarket, months: 12, pending: view.pending, kept: true,
        buyHref: () => null, onKeepCash: () => {} });
    assert(find(kept, node => node.dataset?.saleFlowKeepCashRevoke !== undefined), 'P3-3: „Doch in den Geldmarkt“ neben „Entschieden: …“');
}

// SV-1: Zurückholen setzt den ganzen Haushalt zurück, auch Entscheidungen und Jahresbeleg.
{
    assertEqual(isAllowedSnapshotRestoreLiveKey('annual_plan_resolutions_v1'), true, 'P2-04: Wiederherstellung setzt Entscheidungen mit dem Verlauf zurück');
    assertEqual(isAllowedSnapshotRestoreLiveKey('annual_plan_record_v1'), true, 'SP-1c: Wiederherstellung setzt den Jahresbeleg zurück');
}

// P3-1 · „So ändert sich … Depot“ je Tranche aus derselben Aufteilung, die gespeichert wird (Bankreihenfolge).
// P3-8 · Ausführungstag vor dem Beschluss oder in einem anderen Jahr: Hinweis vor dem Speichern.
{
    const plan = await start();
    const line = readSaleFlowPlan({ plan, registry: registry() }).lines.find(item => item.profileId === ERIKA);
    const old = { ...line.tranche, trancheId: 'erika-2019', shares: 100, purchaseDate: '2019-03-01', purchasePrice: 60 };
    const tranches = [old, ...line.tranches];
    const draft = { executedAt: '2025-12-30', trancheId: line.tranche.trancheId, shares: 575, price: '144,38', fees: '9,90', taxes: '2.000,00' };
    const dom = settleStep(new MockDocument(), line, { draft, plan: false, tranches, onChange: () => {}, scope: { year: 2026, decidedOn: plan.decidedOn } });
    const rows = [];
    (function walk(node) { if (node.dataset?.saleFlowDepotTranche) rows.push(`${node.dataset.saleFlowDepotTranche} ${text(node).replace(/\s+/g, ' ').trim()}`); (node.children || []).forEach(walk); })(dom);
    assertEqual(rows.length, 2, 'P3-1: zwei Zeilen, je betroffener Tranche');
    assert(rows[0].startsWith('erika-2019') && rows[0].includes('100,000 → 0,000'), `P3-1: Tranche 2019 100 → 0 (${rows[0]})`);
    assert(rows[1].includes('1.245,935 → 770,935'), `P3-1: Neubestand 1.245,935 → 770,935 statt 670,935 (${rows[1]})`);
    assert(find(dom, node => node.dataset?.saleFlowDateNote !== undefined && text(node).includes('zählt nicht zum Plan 2026')), 'P3-8: Hinweis „zählt nicht zum Plan 2026“');
    const fine = settleStep(new MockDocument(), line, { draft: { ...draft, executedAt: DATE }, plan: false, tranches, onChange: () => {}, scope: { year: 2026, decidedOn: plan.decidedOn } });
    assert(!find(fine, node => node.dataset?.saleFlowDateNote !== undefined), 'P3-8: kein Hinweis am Testdatum');
}

// P3-6 · Zwei Planzeilen derselben Person und Anlageklasse: Rest-Frage auf der Gruppe, Entscheidung für die offenen Zeilen.
{
    const plan = await start();
    const entry = Object.values(JSON.parse(storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
    const action = structuredClone(entry.adopted.action);
    const erika = action.quellen.findIndex(source => source.sourceProfileId === ERIKA && source.netto > 0);
    const source = action.quellen[erika];
    action.quellen.splice(erika, 1, { ...source, netto: 40000, brutto: 40400, steuer: 400, trancheId: `${source.trancheId}-a` },
        { ...source, netto: 40000, brutto: 40400, steuer: 400, trancheId: `${source.trancheId}-b` });
    await write({ sales: [erikaSale({ actionId: 'teil-1', parts: [{ trancheId: 'muster_b_lot_2', shares: 300, gross: 43314, fees: 9.9, taxes: 300 }] })] });
    const progress = projectAnnualActionProgress({ action, year: 2026, decidedOn: plan.decidedOn, sales: (await import('../app/balance/annual-action-progress.js')).readAnnualActionSales(registry(), [MAX, ERIKA]) });
    const lines = projectSaleFlowLines({ action, progress, registry: registry(), people: plan.people, decidedOn: plan.decidedOn, year: 2026 }).filter(line => line.profileId === ERIKA);
    assertEqual(lines.length, 2, 'P3-6: zwei Zeilen Erika');
    assertEqual(lines[0].status, 'erledigt', 'P3-6: erste Zeile durch 43.004,10 € erledigt');
    assertEqual(lines[1].status, 'teilweise', 'P3-6: zweite Zeile teilweise');
    assertClose(lines[1].group.planNet, 80000, 0.01, 'P3-6: Gruppe 80.000 €');
    assertEqual(restQuestionAmount({ planNet: 40000, soldNet: 3004.1 }, 20000), 16995.9, 'P3-6 Gegenprobe alt: Zeile allein fragt nach 16.995,90 €');
    assertEqual(restQuestionAmount(lines[1], 20000), 16995.9, 'P3-6: Gruppe 80.000 − 63.004,10 = 16.995,90 €');
    assertEqual(restQuestionAmount(lines[1], 32000), null, 'P3-6: über der Erledigt-Grenze der Gruppe keine Frage');
    const keep = groupDecision(lines, lines[1].key, true, 'reicht');
    assertEqual(keep.map(item => item.key).join(','), lines[1].key, 'P3-6: Entscheidung nur für die offene Zeile der Gruppe');
    assertEqual(keep[0].reason, 'reicht', 'P3-6: Warum geht mit');
}

// P3-7 · Rundungsrest bei vielen Tranchen: kein Teil negativ, Summe genau, Teile unter einem halben Cent gehen im Nachbarn auf.
{
    const parts = [1, 2, 3, 4].map(index => ({ tranche: { trancheId: `t${index}` }, shares: 10 }));
    const split = splitOrder(parts, { shares: 40, gross: 400, fees: 0.02, taxes: 0.03 });
    assert(split.every(part => part.fees >= 0 && part.taxes >= 0), 'P3-7: kein Teil negativ (vorher −0,01 € auf dem letzten)');
    assertEqual(Math.round(split.reduce((sum, part) => sum + part.fees, 0) * 100), 2, 'P3-7: Gebühren-Summe genau 0,02 €');
    assertEqual(Math.round(split.reduce((sum, part) => sum + part.taxes, 0) * 100), 3, 'P3-7: Steuer-Summe genau 0,03 €');
    const tiny = splitOrder([{ tranche: { trancheId: 'a' }, shares: 100 }, { tranche: { trancheId: 'b' }, shares: 0.00002 }], { shares: 100.00002, gross: 14438, fees: 9.9, taxes: 100 });
    assertEqual(tiny.length, 1, 'P3-7: Teil unter einem halben Cent geht im Nachbarn auf');
    assertEqual(tiny[0].gross, 14438, 'P3-7: Beträge vollständig beim Nachbarn');
    const refund = splitOrder(parts.slice(0, 3), { shares: 30, gross: 300, fees: 0.01, taxes: -1 });
    assertEqual(Math.round(refund.reduce((sum, part) => sum + part.taxes, 0) * 100), -100, 'P3-7: Erstattung verteilt, Summe genau');
}

// Anzeige im Überblick: Kopfzeile und Zeile „Zusammen“ aus den angezeigten Zeilen, 89.313 € in beiden.
{
    const plan = await start();
    const lines = readSaleFlowPlan({ plan, registry: registry() }).lines;
    assertEqual(shownPlanTotal(lines), 89313, 'Überblick: Summe der angezeigten Zeilen 9.363 + 79.950 = 89.313 €');
    const dom = overviewStep(new MockDocument(), { lines, decidedOn: '23.10.2026', quoteDate: DATE, play: true, people: plan.people });
    const total = find(dom, node => String(node.className || '').includes('sale-flow-total'));
    assert(text(total).includes('89.313 €'), 'Überblick: Zeile „Zusammen“ 89.313 €');
}

// P3-2 · „Rest bleibt im Depot“ in der Karte bei „teilweise“ nachholbar (nur in der Balance, wo der Ablauf gebunden ist).
{
    const { createTodoPlan } = await import('../app/shared/annual-todo-view.js');
    const plan = { year: 2026, status: 'teilweise', decidedOn: '23.10.2026', soldNet: 57264.07, planNet: 79949.58, share: 0.72, tax: 0, verb: 'Aktien verkaufen', amount: 79949.58,
        rows: [{ who: 'Erika', security: 'Vanguard FTSE All-World', planNet: 79949.58, soldNet: 57264.07, restNet: 22685.51, status: 'teilweise', key: 'muster_b:muster_b_lot_2', lastSaleAt: DATE }],
        credits: [], destinations: [], purchases: [], nothing: false, openSecurities: ['Vanguard FTSE All-World'] };
    const withFlow = createTodoPlan(new MockDocument(), { ...plan, flow: { started: true, next: 3, steps: [], allEntered: false, pendingNames: [], buys: [] } });
    const keep = find(withFlow, node => node.dataset?.saleFlowKeep !== undefined);
    assertEqual(keep?.dataset.saleFlowKeep, 'muster_b:muster_b_lot_2', 'P3-2: Knopf „Rest bleibt im Depot“ neben dem Rest');
    assert(!find(createTodoPlan(new MockDocument(), plan), node => node.dataset?.saleFlowKeep !== undefined), 'P3-2: ohne Ablauf (Jahresabschluss) kein Knopf');
}
