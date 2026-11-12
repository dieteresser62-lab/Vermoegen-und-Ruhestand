// WT-1c (Gutachten WT1B-FABLE Befunde 1–4 und 6): Kurszeile im Januar, eiserne Reserve, Wahl nach Tagesgeldänderung,
// Name bei einer Umschichtung. Über den echten Renderer bzw. den echten Abschlussdialog, nur synthetische Beispieldaten.
import { EngineAPI } from '../engine/index.mjs';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { renderCard, editRegistry, clean } from './helpers/wt-1-balance-render.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { prepareMarketPreview, hiddenBearPriceProblem, hiddenBearPricesUnreliable, unavailableBudgetComparison } from '../app/balance/balance-market-preview.js';
import { projectCashRefill, cashRefillIronReserve, stockTrancheId } from '../app/balance/annual-todo.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { createCashRefill } from '../app/shared/annual-todo-view.js';
import { annualTestMarketData as marketData, annualTestNow as now } from './helpers/balance-storage-fixtures.mjs';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { emptyHistorySymbol, historyDay, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { projectAnnualPreview } from '../app/balance/balance-annual-preview.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { captureCashPeople } from '../app/profile/profile-cash-update.js';
import { setAppTestDate } from '../app/shared/app-clock.js';

const text = node => clean(node.textContent);
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const day = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
const STALE = 'Kurse älter als 10 Tage – verdeckter Bärenmarkt nicht prüfbar · Kurse holen →';
const MISSING = 'Kurse fehlen oder sind lückenhaft – verdeckter Bärenmarkt nicht prüfbar · Kurse holen →';

/** Tageskurse der Beispieldaten nur bis `last` (wie: zuletzt an diesem Tag Kurse geholt). */
function pricesUntil(records, last) {
    const prices = JSON.parse(records[DAILY_PRICES_KEY]), series = prices.symbols['VWCE.DE'];
    const count = series.days.filter(value => value <= day(last)).length;
    series.days = series.days.slice(0, count); series.closes = series.closes.slice(0, count);
    series.queried = [[series.days[0], day(last)]];
    records[DAILY_PRICES_KEY] = JSON.stringify(prices);
    return records;
}

// Befund 1 / Soll 1: Kurszeile im Januar über den echten Renderer.
{
    // Abschluss 2026 erledigt (Beispieldaten vom 02.01.2027), Kurse bis 31.12.2026.
    const done = () => pricesUntil(createMusterHaushaltRecords('2027-01-02'), '2026-12-31');
    const jan2 = await renderCard(done(), '2027-01-02');
    assertEqual(jan2.next.closingYear, 2027, 'Soll 1: Abschluss 2026 ist erledigt, die Vorschau gilt dem nächsten Abschluss');
    assertEqual(jan2.market, '', `Soll 1: 02.01.2027, Kurse bis 31.12.2026 → nichts (${jan2.market})`);
    assertEqual((await renderCard(done(), '2027-01-10')).market, '', 'Soll 1: am 10. Tag nach dem Jahresende noch nichts');
    assertEqual((await renderCard(done(), '2027-01-11')).market, STALE, 'Soll 1: ab dem 11. Tag die Zeile „älter als 10 Tage“');
    const jan12 = await renderCard(done(), '2027-01-12');
    assertEqual(jan12.market, STALE, `Soll 1: 12.01.2027 → Zeile „älter als 10 Tage“ (${jan12.market})`);
    const link = walk(jan12.doc.getElementById('balanceMarketPreviewBody')).find(node => node.tagName?.toLowerCase() === 'a');
    assertEqual(link?.getAttribute('href'), 'Daten-Sicherung.html#kursdienst', 'Soll 1: „Kurse holen →“ führt zum Kursdienst');
    // Mit einem Kurs vom 01.01.2027 gibt es keinen Kursgrund.
    assertEqual((await renderCard(pricesUntil(createMusterHaushaltRecords('2027-01-02'), '2027-01-01'), '2027-01-02')).market, '', 'Soll 1: Kurs vom 01.01. → nichts');

    // Keine Kursdatei → „fehlen oder sind lückenhaft“.
    const noFile = createMusterHaushaltRecords('2026-10-23'); delete noFile[DAILY_PRICES_KEY];
    assertEqual((await renderCard(noFile)).market, MISSING, 'Soll 1: keine Kursdatei → Zeile „fehlen oder sind lückenhaft“');

    // Abschluss 2026 offen, heute 05.01.2027, Kurse bis 28.12.2026 → nichts, wie bisher.
    const open = createMusterHaushaltRecords('2026-12-15');
    open[DAILY_PRICES_KEY] = pricesUntil(createMusterHaushaltRecords('2027-01-05'), '2026-12-28')[DAILY_PRICES_KEY];
    const jan5 = await renderCard(open, '2027-01-05');
    assertEqual(jan5.next.closingYear, 2026, 'Soll 1: Abschluss 2026 ist noch offen');
    assertEqual(jan5.market, '', `Soll 1: Abschluss offen, 05.01.2027, Kurse bis 28.12. → nichts (${jan5.market})`);
    // Befund 6 (Soll 5 aus WT-1b): im Januar vor dem Abschluss heißt die Vorschau auf der Seite „Plan 2027“.
    assertEqual(jan5.preview, 'Vorschau auf den Plan 2027', 'Befund 6: Vorschauzeile im Januar 2027 vor dem Abschluss');

    // Grund je Fall, an der Projektion selbst.
    const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 130, endeVJ_3: 120, ath: 150, jahreSeitAth: 0 };
    const series = closes => ({ version: 1, symbols: { 'VWCE.DE': { currency: 'EUR', days: closes.map(([date]) => day(date)), closes: closes.map(([, price]) => price),
        queried: [[day(closes[0][0]), day(closes.at(-1)[0])]] } } });
    const reason = (dailyPrices, today) => prepareMarketPreview({ inputs, dailyPrices, today, yearEndDate: '2026-12-31', hasAnnualClose: true }).unreliableReason;
    const view = why => ({ withoutQuote: true, withoutQuoteReason: why, quote: null, yearEndDate: null, readingsEqual: true, comparison: unavailableBudgetComparison(why) });
    for (const [prices, today, expected, label] of [
        [series([['2026-12-31', 150]]), '2027-01-02', null, 'Kurs bis Jahresende, 2 Tage danach'],
        [null, '2027-01-04', null, 'keine Kurse, 4 Tage nach dem Jahresende'],
        [series([['2026-12-31', 150]]), '2027-01-12', 'stale', 'Kurs bis Jahresende, 12 Tage danach'],
        [null, '2027-01-12', 'missing', 'keine Kurse, 12 Tage danach'],
        [series([['2026-12-31', 150], ['2027-01-15', 152]]), '2027-02-01', 'stale', 'letzter Kurs 17 Tage alt']]) {
        assertEqual(hiddenBearPriceProblem(view(reason(prices, today))), expected, `Befund 1: Grund ${label}`);
    }
    assert(!hiddenBearPricesUnreliable(view('Das Projektionsjahr ist bereits abgeschlossen.')), 'Befund 1: andere Gründe ohne Kurszeile');
    assertEqual(hiddenBearPriceProblem(view('Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen')), 'missing', 'Befund 1: Lücken → „fehlen oder lückenhaft“');
}

// Befund 2 / Soll 2: Die eiserne Reserve zählt wie in der Reservekarte, wenn sie über den Tagesgeldmonaten liegt.
const moneyMarket = { schemaVersion: 2, name: 'Muster Geldmarkt', type: 'geldmarkt', category: 'money_market', ticker: 'XEON.DE', isin: 'LU0290358497', shares: 100,
    purchasePrice: 116.070752, currentPrice: 121.478441, asOf: 1792713600, purchaseDate: '2024-04-12', tqf: 0, taxExempt: false, notes: 'Synthetischer Musterbestand',
    marketValue: 12147.8441, costBasis: 11607.0752, instrumentId: 'isin:LU0290358497' };
/** Beispiel mit zugefügter Geldmarkt-Tranche je Person und gesetztem Tagesgeld. */
const withMoneyMarket = (id, cash) => editRegistry(createMusterHaushaltRecords('2026-10-23', id), registry => {
    for (const [profileId, profile] of Object.entries(registry.profiles)) {
        const tranches = JSON.parse(profile.data.depot_tranchen); tranches.push({ ...moneyMarket, trancheId: `${profileId}_wt1c_geldmarkt` });
        profile.data.depot_tranchen = JSON.stringify(tranches);
        if (cash[profileId] !== undefined) profile.data.profile_tagesgeld = String(cash[profileId]);
    }
});
{
    const low = await renderCard(withMoneyMarket('martin-petra', { muster_martin: 300, muster_petra: 300 }));
    assert(text(low.doc.getElementById('balancePersonalCashTargets')).includes('Summe 8.000 €'), 'Soll 2: Reservekarte Martin und Petra mit Tagesgeldziel 8.000 €');
    assert(low.refill.includes('Dein Tagesgeld (600 €) liegt unter der eisernen Reserve von 8.000 €.') && low.refill.includes('7.400 €vom Geldmarkt')
        && low.refill.includes('Martin3.700 €') && low.refill.includes('Petra3.700 €'), `Soll 2: Martin und Petra 600 € → bis zur eisernen Reserve 8.000 € (${low.refill})`);
    const mid = await renderCard(withMoneyMarket('martin-petra', { muster_martin: 2000, muster_petra: 2000 }));
    assert(mid.refill.includes('4.000 €vom Geldmarkt'), `Soll 2: 4.000 € unter der Reserve → Hinweis 4.000 € (${mid.refill})`);
    assertEqual((await renderCard(withMoneyMarket('martin-petra', { muster_martin: 4000, muster_petra: 4000 }))).refill, '', 'Soll 2: genau an der eisernen Reserve → kein Hinweis');
    const sophie = await renderCard(withMoneyMarket('sophie', { muster_sophie: 300 }));
    assert(sophie.refill.includes('liegt unter der eisernen Reserve von 5.600 €') && sophie.refill.includes('5.300 €vom Geldmarkt'), `Soll 2: Sophie bis 5.600 € (${sophie.refill})`);
    // Ohne vorherrschende Reserve rechnet der Hinweis wie in WT-1b (Max und Erika, Tagesgeld 15.000 €).
    const people = [{ profileId: 'a', name: 'A', tagesgeld: 5000, geldmarkt: 36000, target: 16200 }, { profileId: 'b', name: 'B', tagesgeld: 10000, geldmarkt: 24000, target: 16200 }];
    const normal = projectCashRefill({ people, monthlyBase: 2700, cashMonths: 12, planOpen: false, ironReserve: 12000 });
    assertEqual(normal.target, 32400, 'Soll 2: Reserve unter 12 Monaten ändert das Ziel nicht');
    assertEqual(normal.ironReserve, false, 'Soll 2: dann Satz mit Monaten Entnahme');
    assertEqual(projectCashRefill({ people, monthlyBase: 2700, cashMonths: 12, planOpen: false, ironReserve: 12000 }).amount,
        projectCashRefill({ people, monthlyBase: 2700, cashMonths: 12, planOpen: false }).amount, 'Soll 2: Betrag wie ohne Reserve');
    assertEqual(cashRefillIronReserve({ input: { floorBedarf: 36000, flexBedarf: 12000, minCashBufferMonths: 2 } }), 8000, 'Soll 2: eiserne Reserve = Bruttobedarf je Monat × 2');
    assertEqual(cashRefillIronReserve({ input: { floorBedarf: 36000, flexBedarf: 12000, personalTagesgeldTarget: 5000 } }), null, 'Soll 2: persönliches Tagesgeldziel ersetzt die Reserve');
}

// Befund 4 / Soll 4: Haushalt mit nur einer Umschichtung nennt die Person.
/** Plan ganz umgesetzt (wie in wt-1b-sollfaelle): jede Planzeile verkauft und gutgeschrieben, danach Tagesgeld je Person. */
function planDone(records, cash) {
    const beleg = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
    const lines = (beleg.adopted.action.quellen || []).filter(source => source.sourceProfileId && source.trancheId && source.netto > 0
        && !['liquiditaet', 'cash'].includes(source.kind));
    return editRegistry(records, registry => {
        const actions = lines.map((source, index) => {
            const profileId = source.sourceProfileId, trancheId = stockTrancheId(source.trancheId, profileId), data = registry.profiles[profileId].data;
            const tranches = JSON.parse(data.depot_tranchen), lot = tranches.find(item => item.trancheId === trancheId);
            const sold = source.netto / lot.currentPrice, before = lot.shares;
            lot.shares -= sold; if ('marketValue' in lot) lot.marketValue = lot.shares * lot.currentPrice;
            data.depot_tranchen = JSON.stringify(tranches);
            return { schemaVersion: 1, eventType: 'sale_reconciled', actionId: `wt1c-${index}`, profileId, trancheId, executedAt: '2026-03-12',
                actual: { sharesSold: sold, grossProceeds: source.netto, fees: 0, taxes: 0, netProceeds: source.netto }, cashStatus: 'confirmed_already_reflected',
                cashBalanceAfterPostingEur: cash[profileId] ?? 0, cashConfirmedAt: '2026-03-12T10:00:00.000Z',
                result: { beforeShares: before, remainingShares: lot.shares, trancheRemoved: false }, reconciledAt: '2026-03-12T10:00:00.000Z' };
        });
        for (const [profileId, value] of Object.entries(cash)) registry.profiles[profileId].data.profile_tagesgeld = String(value);
        registry.trancheReconciliation = { schemaVersion: 1, actions };
    });
}
{
    // Echter Renderer: Tagesgeld 5.000 € und 10.000 €; nur eine Person schichtet um (Gutachten WT1B-FABLE Befund 4).
    const one = await renderCard(planDone(createMusterHaushaltRecords('2026-10-23', 'max-erika'), { muster_a: 5000, muster_b: 10000 }));
    const rows = walk(one.doc.getElementById('balanceCashRefill')).filter(node => node.dataset?.todoRefillPerson !== undefined);
    assertEqual(rows.length, 1, `Soll 4: genau eine Personenzeile (${one.refill})`);
    assert(one.refill.includes('Erika') && !one.refill.includes('Max'), `Soll 4: der Hinweis nennt Erika (${one.refill})`);
    assertEqual(rows[0]?.dataset.todoRefillPerson, 'muster_b', 'Soll 4: Zeile und Knopf gehören Erika');
    // Einzelplan bleibt ohne Personenzeile.
    const refill = projectCashRefill({ people: [{ profileId: 'muster_renate', name: 'Renate', tagesgeld: 9000, geldmarkt: 20000, target: 19200 }], monthlyBase: 1600, cashMonths: 12, planOpen: false });
    assertEqual(refill.household, false, 'Soll 4: Einzelplan ist kein Haushalt');
    assert(!text(createCashRefill(new MockDocument(), refill)).includes('Renate'), 'Soll 4: Einzelplan ohne Personenzeile wie bisher');
}

// Befund 3 / Soll 3: Wahl im Schritt „Plan“ rechnet auch nach einer Tagesgeldänderung neu (nach vorheriger Planänderung).
// Fachdatum 02.01.2027 wie beim Abschluss, damit der neue Tagesgeldstand nach der Tageshistorie der Beispieldaten liegt.
setAppTestDate('2027-01-02');
try {
    const key = 'ruhestandsmodellValues_v29_guardrails';
    const records = createMusterHaushaltRecords('2026-12-15');
    const state = JSON.parse(records[key]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'wt1c-before', phase: 'writes_started' };
    records[key] = JSON.stringify(state);
    const storage = annualRecordStorage(records), draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage, now });
    const days = ['2025-12-31', '2026-06-15', '2026-12-31'].map(historyDay);
    storage.setItem(DAILY_PRICES_KEY, JSON.stringify({ version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days, closes: [150, 250, 160.2], queried: [[days[0], days[2]]] } } }));
    const { doc } = createDialogFixture(); let binding;
    const calls = [];
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    const people = captureCashPeople({ storage, registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, ids: draft.scope.ids });
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectMarketReadings: opts => projectAnnualMarketReadings({ ...opts, storage, engineLoader: { load: async () => EngineAPI } }),
        projectPreview: opts => projectAnnualPreview({ ...opts, storage }),
        evaluatePlan: async opts => { const result = await evaluateAnnualPlanPreview({ ...opts, storage, now, engineLoader: { load: async () => EngineAPI } }); calls.push({ opts, result }); return result; } });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people, onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: marketData, errors: {} });
    const settle = () => new Promise(resolve => setTimeout(resolve, 40));
    await settle(); await prepareCloseFixture(doc, { marketReading: null }); await settle(); binding.activate('preview'); await settle();
    const all = () => walk(doc.body);
    const option = id => clean(all().find(node => node.dataset?.annualMarketReading === id).parent.children.map(node => node.textContent).join(''));
    const before = option('year_end');
    const floor = doc.getElementById('annualPlan_floorBedarf'); floor.value = '35.000'; await floor.fire('input');
    for (let turn = 0; turn < 50 && option('year_end') === before; turn++) await settle();
    const afterPlan = option('year_end');
    assert(afterPlan !== before, `Soll 3: Planänderung rechnet die Wahl neu (${before} → ${afterPlan})`);
    const choiceCalls = () => calls.filter(call => call.opts.choiceVariant === 'year_end');
    const countBefore = choiceCalls().length;
    const input = all().find(node => node.dataset?.tagesgeldPerson !== undefined);
    input.value = '1.000'; await input.fire('input');
    for (let turn = 0; turn < 80 && choiceCalls().length === countBefore; turn++) await settle();
    for (let turn = 0; turn < 10; turn++) await settle();
    const changed = choiceCalls().at(-1);
    assert(choiceCalls().length > countBefore, 'Soll 3: Tagesgeldänderung rechnet die Wahl neu');
    assert(changed && Object.values(changed.opts.cash || {}).some(value => JSON.stringify(value).includes('1000')), 'Soll 3: mit dem neuen Tagesgeld');
    const money = value => `${Math.round(value).toLocaleString('de-DE')} €`;
    assert(option('year_end').includes(money(Math.round(changed.result.adopted.monthlyBudget))), `Soll 3: Wahl zeigt den neu gerechneten Betrag (${option('year_end')})`);
    binding.close(true); await pending.catch(() => null);
} finally { setAppTestDate(null); }
