// WT-1 (FR-77, FR-71 geändert): von Hand hergeleitete Sollfälle als dauerhafte Node-Tests. Nur synthetische Daten.
import { readKO2References } from './helpers/ko-2-expectations.mjs';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { EngineAPI } from '../engine/index.mjs';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { projectAnnualActionProgress } from '../app/balance/annual-action-progress.js';
import { projectAnnualTodoPlan, projectCashRefill, CASH_REFILL_MIN_MONTHS, saleEntryHref } from '../app/balance/annual-todo.js';
import { createTodoPlan, createCashRefill, createHiddenBearBlock, createPlanProgressNote, createTodoResult } from '../app/shared/annual-todo-view.js';
import { prepareMarketPreview, projectMarketPreview, isHiddenBearMarket, hiddenBearCheckUnreliable, unavailableBudgetComparison } from '../app/balance/balance-market-preview.js';
import { createAnnualMarketReadings } from '../app/balance/balance-market-preview-renderer.js';
import { createAnnualMarketChoice } from '../app/shared/annual-market-choice.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { planScope } from '../app/profile/household-plan.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { resolveManagerTarget } from '../app/tranches/tranchen-manager-page.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { displayUp } from '../app/shared/display-rounding.js';
import { renderCard, withPurchases, clean as renderedText } from './helpers/wt-1-balance-render.mjs';

const clean = text => String(text).replaceAll(' ', ' ').replaceAll(' ', ' ');
const text = node => clean(node.textContent);

// S1 Status: Plan Max 9.362 €, Erika 79.950 €; Beschluss im Jahresabschluss am 02.01.2026.
{
    const action = { type: 'TRANSACTION', title: 'Aktien verkaufen', steuer: 827, verwendungen: { liquiditaet: 89312 },
        quellen: [{ kind: 'aktien_neu', category: 'equity', name: 'Muster Aktien-ETF', sourceProfileId: 'max', sourceProfileName: 'Max', trancheId: 'max:max_lot_2', brutto: 9500, steuer: 138, netto: 9362 },
            { kind: 'aktien_neu', category: 'equity', name: 'Muster Aktien-ETF', sourceProfileId: 'erika', sourceProfileName: 'Erika', trancheId: 'erika:erika_lot_2', brutto: 80639, steuer: 689, netto: 79950 }] };
    const sale = (profileId, netProceeds, executedAt, assetClass = 'equity', creditPending = false) => ({ profileId, trancheId: `${profileId}_lot_2`, executedAt, netProceeds, assetClass, creditPending });
    const sales = [sale('max', 9300, '2026-03-12'), sale('erika', 30638, '2026-09-02', 'equity', true),
        sale('erika', 5000, '2026-01-01'), sale('max', 20000, '2026-04-01', 'money_market'), sale('erika', 4000, '2025-12-20')];
    const progress = projectAnnualActionProgress({ action, year: 2026, decidedOn: '2026-01-02', sales });
    assertEqual(progress.lines.map(line => line.status).join(' · '), 'erledigt · teilweise', 'S1: Max 9.300 € (99,3 %) erledigt, Erika 30.638 € teilweise');
    assertEqual(progress.status, 'teilweise', 'S1: Plan teilweise umgesetzt');
    assertEqual(progress.soldNet, 39938, 'S1: Verkauf vor dem Beschlussdatum und andere Anlageklasse zählen nicht (39.938 €)');
    assertEqual(progress.lastSaleAt, '2026-09-02', 'S1: Letzter gezählter Verkauf am 02.09.2026');
    assertEqual(progress.creditPendingSales.map(entry => `${entry.profileId} ${entry.netProceeds}`).join(), 'erika 30638', 'S1: Gutschrift fehlt nur bei Erikas Verkauf');
    const plan = projectAnnualTodoPlan({ confirmed: { year: 2026, committedAt: '2026-01-02T11:00:00.000Z', action, progress },
        people: [{ id: 'max', name: 'Max' }, { id: 'erika', name: 'Erika' }] });
    assertEqual(plan.planNet, 89312, 'S1: Plan 89.312 € netto');
    assertEqual(plan.decidedOn, '02.01.2026', 'S1: Beschlussdatum');
    const doc = new MockDocument(), card = createTodoPlan(doc, plan), cardText = text(card);
    assert(cardText.includes('Teilweise erledigt39.938 € von 89.500 € verkauft'), 'S1: Kopf „39.938 € von 89.312 € verkauft“ (Plan aufgerundet, Verkauf genau, FR-78)');
    assert(cardText.includes('Noch offen50.000 €Muster Aktien-ETF, netto'), 'S1: Hauptzeile mit offenem Rest (Erika 79.950 − 30.638 € = 49.312 €, aufgerundet)');
    assert(cardText.includes('ErledigtMax') === false && cardText.includes('Max · ') === false, 'S1: Tabelle mit eigener Spalte „Wer“');
    assert(cardText.includes('WerWertpapierBetrag nettoStand'), 'S1: Tabelle Wer / Wertpapier / Betrag netto / Stand');
    assert(cardText.includes('Erledigt am 12.03.2026'), 'S1: Max erledigt am 12.03.2026');
    assert(cardText.includes('Teilweise 30.638 € am 02.09.2026 · 50.000 € offen'), 'S1: Erika teilweise mit Datum und Rest (49.312 € aufgerundet)');
    assert(cardText.includes('Gutschrift nachtragen') && cardText.includes('Zum Verkauf vom 02.09.2026 (Erika) fehlt die Gutschrift auf dem Tagesgeld (30.638 €)'), 'S1: Gutschrift nachtragen mit Betrag');
    assert(cardText.includes('Verkauf eintragen') && cardText.includes('Details & Drucken'), 'S1: Knöpfe Verkauf eintragen und Details & Drucken');
    for (const word of ['festgeschrieben', 'Liquidität', 'Regime', 'Jahresendregel', 'Lesart']) assert(!cardText.includes(word), `S1: kein Fachwort „${word}“ auf der Karte`);
    assertEqual(plan.saleTarget.profileId, 'erika', 'S1: Verkauf eintragen öffnet die erste offene Zeile');
    assertEqual(saleEntryHref(plan.saleTarget), 'depot-tranchen-manager.html?person=erika&tranche=erika_lot_2#verkauf', 'S1: Verkaufsdialog für Person und Tranche (Belegkennung mit Personenpräfix, Link ohne)');
    assertEqual(saleEntryHref(null), 'depot-tranchen-manager.html', 'S1: ohne Zeile die Seite');

    const open = projectAnnualTodoPlan({ confirmed: { year: 2026, committedAt: '2026-01-02T11:00:00.000Z', action,
        progress: projectAnnualActionProgress({ action, year: 2026, decidedOn: '2026-01-02', sales: [] }) }, people: [] });
    const openText = text(createTodoPlan(new MockDocument(), open));
    assert(openText.includes('OffenNoch kein Verkauf eingetragen.') && openText.includes('Aktien verkaufen89.500 €netto, Steuer 1.000 € schon abgezogen'), 'S1: offen mit Verb und Netto-Betrag (Summe der angezeigten Zeilen 9.500 + 80.000, Steuer 827 € aufgerundet)');
    assert(openText.includes('Wohin das Geld geht') && openText.includes('Beschlossen im Jahresabschluss am 02.01.2026.'), 'S1: offen mit „Wohin das Geld geht“ und Beschlusszeile');
    const done = projectAnnualTodoPlan({ confirmed: { year: 2026, committedAt: '2026-01-02T11:00:00.000Z', action,
        progress: projectAnnualActionProgress({ action, year: 2026, decidedOn: '2026-01-02', sales: [sale('max', 9300, '2026-03-12'), sale('erika', 79500, '2026-09-02')] }) }, people: [] });
    const doneText = text(createTodoPlan(new MockDocument(), done));
    assert(doneText.includes('Alle Verkäufe aus dem Plan 2026 sind eingetragen, zuletzt am 02.09.2026.') && !doneText.includes('Verkauf eintragen'), 'S1: erledigt ohne Verkaufsknopf');
    const note = text(createPlanProgressNote(new MockDocument(), { ...progress, year: 2026 }));
    assert(note.includes('Teilweise umgesetztPlan 2026') && note.includes('39.938 € von 89.500 € verkauft. Der Plan 2027 rechnet mit deinem Bestand vom 31.12.'), 'S1: Jahresabschluss, Schritt Plan (Plan aufgerundet)');
    assert(text(createPlanProgressNote(new MockDocument(), { ...progress, year: 2026 }, true)).includes('Plan 2026 · teilweise umgesetzt'), 'S1: Ergebnis nennt den Stand des alten Plans');
    const result = text(createTodoResult(new MockDocument(), projectAnnualTodoPlan({ confirmed: { year: 2027, action,
        marketReading: { reading: 'year_high', asOf: '2026-08-12' } }, people: [], routing: { tagesgeld: 32400, geldmarkt: 56912 }, cashMonths: 12 })));
    assert(result.includes('Was zu tun istPlan 2027') && result.includes('Gewählt: mit dem Jahreshoch vom 12.08.2026 (vorsichtiger).'), 'S1: Ergebnis im selben Baustein');
    assert(result.includes('Aufs Tagesgeld, bis es 12 Monate Entnahme deckt32.500 €') && result.includes('Der Rest in den Geldmarkt57.000 €'), 'S1: Ergebnis mit Aufteilung (32.500 € und der Rest des angezeigten Plans 89.500 − 32.500 = 57.000 €)');
}

// S2 C: Ziel 12 × 2.700 = 32.400 €. Tagesgeld 13.500 € (5 Monate), Geldmarkt 60.000 €, Plan erledigt → 18.900 €.
{
    assertEqual(CASH_REFILL_MIN_MONTHS, 6, 'S2: Schwelle 6 Monate');
    const person = (tagesgeld, geldmarkt) => [{ profileId: 'p', name: 'Renate', tagesgeld, geldmarkt, target: 32400, moneyMarketTrancheId: 'p_lot_3' }];
    const hint = projectCashRefill({ people: person(13500, 60000), monthlyBase: 2700, planOpen: false });
    assertEqual(hint.amount, 18900, 'S2: Hinweis 18.900 €');
    const hintText = text(createCashRefill(new MockDocument(), hint));
    assert(hintText.includes('Dein Tagesgeld reicht noch für 5 Monate Entnahme (13.500 €). Ziel sind 12 Monate (32.500 €).'), 'S2: Satz mit Monaten und Ziel (Ziel 32.400 € aufgerundet)');
    assert(hintText.includes('19.000 €vom Geldmarkt aufs Tagesgeld umschichten') && hintText.includes('Umschichtung eintragen'), 'S2: Betrag und Knopf (18.900 € aufgerundet)');
    assertEqual(saleEntryHref(hint.saleTarget), 'depot-tranchen-manager.html?person=p&tranche=p_lot_3#verkauf', 'S2: Knopf öffnet den Verkaufsdialog für den Geldmarkt');
    assertEqual(projectCashRefill({ people: person(16200, 60000), monthlyBase: 2700, planOpen: false }), null, 'S2: genau 6 Monate → kein Hinweis');
    assertEqual(projectCashRefill({ people: person(13500, 60000), monthlyBase: 2700, planOpen: true }), null, 'S2: offener Planverkauf → kein Hinweis');
    assertEqual(projectCashRefill({ people: person(13500, 10000), monthlyBase: 2700, planOpen: false }).amount, 10000, 'S2: höchstens der Geldmarkt (10.000 €)');
    // Haushalt: Schwelle für das ganze Tagesgeld, Betrag je Person bis zu ihrem Ziel aus ihrem Geldmarkt.
    const household = projectCashRefill({ people: [{ profileId: 'a', name: 'Max', tagesgeld: 1000, geldmarkt: 2000, target: 5000 },
        { profileId: 'b', name: 'Erika', tagesgeld: 12500, geldmarkt: 60000, target: 27400 }], monthlyBase: 2700, planOpen: false });
    assertEqual(household.rows.map(row => `${row.name} ${row.amount}`).join(' · '), 'Max 2000 · Erika 14900', 'S2: je Person bis zum eigenen Ziel, höchstens ihr Geldmarkt');
}

// S3 verdeckter Bär: Ende 2025 120 €, Jahreshoch 165,79 € am 12.08.2026; Max und Erika am 15.12.2026.
const bearView = (() => {
    const records = createMusterHaushaltRecords('2026-12-15', 'max-erika');
    const registry = JSON.parse(records.rs_profiles_v1);
    const storage = { getItem: key => records[key] ?? null };
    const calc = buildBalanceEngineInputFromStorage({ storage, scope: planScope('household', Object.keys(registry.profiles)), referenceYear: 2026 });
    const day = date => Date.parse(`${date}T00:00:00Z`) / 86400000;
    return today => {
        const dates = ['2025-12-31', '2026-03-31', '2026-08-12', '2026-12-14'];
        const prices = { version: 1, symbols: { 'VWCE.DE': { currency: 'EUR', days: dates.map(day), closes: [120, 140, 165.79, today], queried: [[day(dates[0]), day(dates[3])]] } } };
        const inputs = { endeVJ: 120, endeVJ_1: 100, endeVJ_2: 90, endeVJ_3: 80, ath: 120, jahreSeitAth: 0 };
        const prepared = prepareMarketPreview({ inputs, dailyPrices: /** @type {any} */ (prices), today: '2026-12-15', yearEndDate: '2025-12-31', hasAnnualClose: true });
        const run = market => {
            const result = EngineAPI.simulateSingleYear({ ...structuredClone(calc.engineInput), ...market }, structuredClone(calc.engineLastState));
            if (result.error) throw result.error;
            return result;
        };
        return projectMarketPreview(prepared, { stored: run(prepared.inputs), rule: run(prepared.ruleInputs), high: run(prepared.highInputs) });
    };
})();
{
    const hidden = bearView(126);
    assertClose(hidden.rule.changeSinceYearEndPct, 5, 1e-9, 'S3: Jahresendregel +5 %');
    assert(['bear_deep', 'recovery_in_bear'].includes(hidden.high.market.key), `S3: 24 % unter dem Hoch kürzt die Engine den Flex (${hidden.high.market.key})`);
    assert(isHiddenBearMarket(hidden), 'S3: 126 € → Block und Wahl');
    const block = text(createHiddenBearBlock(new MockDocument(), hidden));
    assert(block.includes('Bärenmarkt, den die Jahresregel nicht sieht') && block.includes('Aktien liegen heute 24 % unter dem Jahreshoch vom 12.08.2026.'), 'S3: Abstand und Datum');
    assert(block.includes('Von Ende 2025 bis heute ist das ein Plus von 5 %, also kein Bärenmarkt.'), 'S3: Sicht der Jahresendregel');
    assert(block.includes('Ende 2025120,00 €') && block.includes('Jahreshoch 12.08.165,79 €') && block.includes('Heute126,00 €24 % unter dem Hoch'), 'S3: drei Kurse');
    assert(block.includes('Was das für 2027 heißt') && block.includes('Marktlagekein BärenmarktBärenmarkt') && block.includes('Kursverlauf 2026'), 'S3: Tabelle und zugeklappter Kursverlauf');
    const annual = text(createHiddenBearBlock(new MockDocument(), hidden, { annual: true, choice: createAnnualMarketChoice(new MockDocument(), hidden, null, () => {}) }));
    assert(annual.includes('Wahl nötig') && annual.includes('Welcher Plan soll gelten?') && annual.includes('Nach Kursen zum Jahresende') && annual.includes('Mit dem Jahreshoch vom 12.08.2026'), 'S3: Wahl im Jahresabschluss');
    assert(annual.includes('Die App wählt nichts vor.'), 'S3: ohne Vorauswahl');
    const corrected = bearView(141);
    assert(!isHiddenBearMarket(corrected), `S3: 141 € (15 % unter dem Hoch, ${corrected.high.market.key}) → kein Block, keine Wahl`);
    const bear = bearView(90);
    assert(['bear_deep', 'recovery_in_bear'].includes(bear.rule.market.key), `S3: 90 € ist auch nach der Jahresendregel ein Bärenmarkt (${bear.rule.market.key})`);
    assert(!isHiddenBearMarket(bear), 'S3: 90 € → kein Block');
    // „Nicht belastbar“ nur, wenn die Kurse fehlen und es auf sie ankäme.
    const missing = { withoutQuote: true, withoutQuoteReason: 'kein Tageskurs seit Jahresende VJ', quote: null, yearEndDate: null, readingsEqual: true, comparison: unavailableBudgetComparison('kein Tageskurs seit Jahresende VJ') };
    assert(hiddenBearCheckUnreliable(missing) && !createAnnualMarketReadings(new MockDocument(), missing).hidden, 'S3: fehlende Kurse → Hinweis im Schritt Marktdaten');
    assert(createAnnualMarketReadings(new MockDocument(), hidden).hidden && createAnnualMarketReadings(new MockDocument(), corrected).hidden, 'S3: belastbare Kurse → Schritt Marktdaten ohne Jahreshoch');
    assert(!hiddenBearCheckUnreliable({ ...bear, comparison: unavailableBudgetComparison('alt') }), 'S3: Sieht die Jahresendregel schon einen Bären, kommt es auf die Kurse nicht an');
}

// Verkaufsdialog im Vermögen: Sprungziel mit Person und Tranche.
{
    const target = resolveManagerTarget({ hash: '#verkauf', search: '?person=x&tranche=x_lot_1' });
    assertEqual(target, null, 'Unbekannte Person ist kein Sprungziel');
}

// S4 bytegleich: Engine (Balance) und Übersicht wie im Ausgangsstand (Prüfsummen aus scripts/measure-ph1.mjs).
{
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const expected = JSON.parse(fs.readFileSync(new URL('./fixtures/wt-1-ph1-checksums.json', import.meta.url), 'utf8'));
    for (const id of ['max-erika', 'renate']) {
        const records = createMusterHaushaltRecords('2026-10-28', id);
        const registry = JSON.parse(records.rs_profiles_v1);
        const scope = planScope(Object.keys(registry.profiles).length === 1 ? 'single' : 'household', Object.keys(registry.profiles));
        const calc = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, scope, referenceYear: 2026 });
        const balance = EngineAPI.simulateSingleYear(calc.engineInput, calc.engineLastState);
        assertEqual(hash(balance), expected[id].balance, `S4: ${id} Engine bytegleich`);
        const overview = projectOverviewFromRecords({ registry, activeId: records.rs_current_profile, liveData: records, now: new Date('2026-10-28T12:00:00Z') });
        // KO-2: Der Planstand der Übersicht trägt den gelesenen Planwert equityCostPct; Zahlen bleiben gleich.
        assertEqual(hash(overview), readKO2References(expected[id].overview), `S4: ${id} Übersicht bytegleich`);
    }
}

// Nachtrag (Gutachten GU1B-FABLE Befund 1): Ein Beleg ohne Verkaufszeile kauft nur aus der Liquidität. Nach dem Kauf rechnen
// Reservekarte und Diagnose wie vor GU-1 neu; die Seite bricht nie ab und zieht den Kauf nicht ein zweites Mal ab.
// Rendern über den echten Balance-Renderer: tests/helpers/wt-1-balance-render.mjs (seit WT-1b gemeinsam genutzt).
{
    const money = value => renderedText(UIUtils.formatBalanceCurrency(value));
    const sophie = await renderCard(withPurchases(createMusterHaushaltRecords('2026-10-23', 'sophie'), [{ profileId: 'muster_sophie', amount: 9000 }]));
    assert(sophie.values.startsWith(`Liquidität heute${money(6000)}`) && !sophie.values.includes('nach Umsetzung'), `Nachtrag: Sophie nach dem Kauf heute 6.000 €, kein zweiter Kauf (${sophie.values})`);
    assert(sophie.card.includes('Aktien kaufen') && sophie.card.includes('Käufe verfolgt die App nicht – trag sie im Vermögen ein.'), 'Nachtrag: Kaufzeile ohne Status mit Hinweis');
    const couple = await renderCard(withPurchases(createMusterHaushaltRecords('2026-10-23', 'martin-petra'),
        [{ profileId: 'muster_martin', amount: 100000 }, { profileId: 'muster_petra', amount: 21600 }]));
    assert(couple.values.startsWith(`Liquidität heute${money(8400)}`) && !couple.values.includes('nach Umsetzung'), `Nachtrag: Martin und Petra heute 8.400 €, kein zweiter Kauf (${couple.values})`);
    assertEqual(`${sophie.verb} · ${couple.verb}`, 'Nichts tun · Nichts tun', 'Nachtrag: Diagnose beider Haushalte „Nichts tun“');
    // Sophie mit 30.000 € Liquidität und 9.400 € gekauft: kein zweiter Abzug des Belegkaufs (vorher 11.200 €). Die Neuberechnung
    // wie vor GU-1 legt den Überschuss über dem Tagesgeldziel neu an; „nach Umsetzung“ ist heute minus dieser neuen Empfehlung.
    const rich = await renderCard(withPurchases(createMusterHaushaltRecords('2026-10-23', 'sophie'), [{ profileId: 'muster_sophie', amount: 9400 }], { muster_sophie: 30000 }));
    assert(rich.values.startsWith(`Liquidität heute${money(20600)}`) && !rich.values.includes(money(11200))
        && (rich.verb === 'Nichts tun' ? !rich.values.includes('nach Umsetzung') : rich.values.includes(`nach Umsetzung${money(displayUp(20600 - rich.amount))}`)), // Ergänzung 2 FR-78: Tagesgeld genau am Ziel 5.600 € → angezeigtes Ziel
        `Nachtrag: Sophie mit 30.000 € und 9.400 € gekauft: Belegkauf nicht doppelt (${rich.values}, ${rich.verb} ${rich.amount})`);
}

// Soll 7 [A5]: Beispiel „Plan teilweise umgesetzt“ zeigt den Stand über den echten Balance-Renderer.
{
    const example = await renderCard(createMusterHaushaltRecords('2026-10-23', 'max-erika', 'teilweise'));
    assert(example.card.includes('Teilweise erledigt') && example.card.includes('39.744 € von 89.500 € verkauft'), `Beispiel: Teilweise erledigt (Plan 89.312 € aufgerundet) (${example.card.slice(0, 160)})`);
    assert(example.card.includes('Gutschrift nachtragen') && example.card.includes('Zum Verkauf vom 02.09.2026 (Erika)'), 'Beispiel: Gutschrift nachtragen für Erikas Verkauf');
    assert(example.card.includes('ErledigtMax') === false && example.card.includes('Erledigt am 12.03.2026'), 'Beispiel: Max erledigt am 12.03.2026');
    assert(example.credit.includes('Ohne die offene Gutschrift von'), 'Nachtrag Punkt 3: Reserven nennen den Grund für das niedrigere „nach Umsetzung“');
}
