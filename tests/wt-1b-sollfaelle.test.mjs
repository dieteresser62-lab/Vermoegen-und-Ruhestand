// WT-1b (Nachschritt zu WT-1, Gutachten WT1-FABLE): Sollfälle als dauerhafte Node-Tests, wo möglich über den echten Renderer.
// Nur synthetische Beispieldaten.
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { renderCard, editRegistry, clean } from './helpers/wt-1-balance-render.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { projectAnnualTodoPlan, projectCashRefill, cashRefillMonthlyBase, saleEntryHref, stockTrancheId } from '../app/balance/annual-todo.js';
import { createTodoPlan, createTodoResult, createCashRefill, createPlanProgressNote, createPlanDetails } from '../app/shared/annual-todo-view.js';
import { describePlanAction } from '../app/balance/balance-action-summary.js';
import { unavailableMarketPreview, highPriceProblem } from '../app/balance/balance-market-preview.js';
import { renderBalanceMarketPreview } from '../app/balance/balance-market-preview-renderer.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { createAnnualTodoResult } from '../app/shared/annual-close-result.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { initTranchenManagerPage, startTranchenManagerPage, openManagerOverviewTarget } from '../app/tranches/tranchen-manager-page.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { createTranchenPageDom, createLocalStorageMock, installGlobals, MockElement, addManagerDialogDom } from './tranchen-manager-page.test.mjs';

const text = node => clean(node.textContent);
const walk = node => [node, ...(node.children || []).flatMap(walk)];
const beleg = records => Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];

/** Plan ganz umgesetzt: jede Planzeile verkauft und gutgeschrieben (wie nach „Verkauf eintragen“), danach Tagesgeld je Person.
 * @param {Record<string, string>} records @param {Record<string, number>} cash */
function planDone(records, cash) {
    const lines = (beleg(records).adopted.action.quellen || []).filter(source => source.sourceProfileId && source.trancheId && source.netto > 0
        && !['liquiditaet', 'cash'].includes(source.kind));
    return editRegistry(records, registry => {
        const actions = lines.map((source, index) => {
            const profileId = source.sourceProfileId, trancheId = stockTrancheId(source.trancheId, profileId), data = registry.profiles[profileId].data;
            const tranches = JSON.parse(data.depot_tranchen), lot = tranches.find(item => item.trancheId === trancheId);
            const sold = source.netto / lot.currentPrice, before = lot.shares;
            lot.shares -= sold; if ('marketValue' in lot) lot.marketValue = lot.shares * lot.currentPrice;
            data.depot_tranchen = JSON.stringify(tranches);
            return { schemaVersion: 1, eventType: 'sale_reconciled', actionId: `wt1b-${index}`, profileId, trancheId, executedAt: '2026-03-12',
                actual: { sharesSold: sold, grossProceeds: source.netto, fees: 0, taxes: 0, netProceeds: source.netto }, cashStatus: 'confirmed_already_reflected',
                cashBalanceAfterPostingEur: cash[profileId] ?? 0, cashConfirmedAt: '2026-03-12T10:00:00.000Z',
                result: { beforeShares: before, remainingShares: lot.shares, trancheRemoved: false }, reconciledAt: '2026-03-12T10:00:00.000Z' };
        });
        for (const [profileId, value] of Object.entries(cash)) registry.profiles[profileId].data.profile_tagesgeld = String(value);
        registry.trancheReconciliation = { schemaVersion: 1, actions };
    });
}

// Soll 1 (P2-1): Schwelle und Ziel mit derselben Monatsbasis wie die Reservekarte, über den echten Renderer.
{
    assertEqual(cashRefillMonthlyBase({ zielLiquiditaet: 162000, input: { liquidityRunwayYears: 5 } }), 2700, 'Soll 1: Max und Erika 162.000 € ÷ 60 = 2.700 €');
    assertEqual(cashRefillMonthlyBase({ zielLiquiditaet: 96000, input: { liquidityRunwayYears: 5 } }), 1600, 'Soll 1: Renate 96.000 € ÷ 60 = 1.600 €');
    const maxErika = async erika => renderCard(planDone(createMusterHaushaltRecords('2026-10-23', 'max-erika'), { muster_a: 5000, muster_b: erika }));
    const at15000 = await maxErika(10000);
    assert(at15000.reserveTarget.includes('Ziel: 60 Monate Entnahme = 165.000 €, davon 12 Monate im Tagesgeld'), `Soll 1: Reservekarte mit derselben Basis, 162.000 € aufgerundet (FR-78) (${at15000.reserveTarget})`);
    assert(at15000.card.includes('Alle Verkäufe aus dem Plan 2026 sind eingetragen'), 'Soll 1: Plan erledigt');
    assert(at15000.refill.includes('Dein Tagesgeld reicht noch für 5 Monate Entnahme (15.000 €). Ziel sind 12 Monate (32.500 €).')
        && at15000.refill.includes('18.000 €vom Geldmarkt aufs Tagesgeld umschichten'), `Soll 1: Max und Erika 15.000 € → Hinweis 17.400 €, angezeigt 18.000 € (FR-78) (${at15000.refill})`);
    const at16200 = await maxErika(11200);
    assertEqual(at16200.refill, '', 'Soll 1: Max und Erika 16.200 € (genau 6 Monate) → kein Hinweis');
    const at13500 = await maxErika(8500);
    assert(at13500.refill.includes('19.000 €vom Geldmarkt') && at13500.refill.includes('Ziel sind 12 Monate (32.500 €)'), `Soll 1: Max und Erika 13.500 € → 18.900 €, angezeigt 19.000 €, „Ziel sind 12 Monate“ (${at13500.refill})`);
    const renate = await renderCard(planDone(createMusterHaushaltRecords('2026-10-23', 'renate'), { muster_renate: 9000 }));
    assert(renate.reserveTarget.includes('= 100.000 €, davon 12 Monate im Tagesgeld'), 'Soll 1: Renate Reserveziel 96.000 €, angezeigt 100.000 €');
    assert(renate.refill.includes('11.000 €vom Geldmarkt') && renate.refill.includes('(9.000 €). Ziel sind 12 Monate (20.000 €).'), `Soll 1: Renate 9.000 € → Hinweis 10.200 €, angezeigt 11.000 € (Ziel 19.200 € → 20.000 €) (${renate.refill})`);

    // Soll 4 (P3-5): zwei Personen, je Person Betrag und Knopf; die Summe liegt nie über dem Haushaltsziel.
    const both = await renderCard(planDone(createMusterHaushaltRecords('2026-10-23', 'max-erika'), { muster_a: 1000, muster_b: 12500 }));
    assert(both.refill.includes('19.000 €vom Geldmarkt') && both.refill.includes('Max4.000 €Umschichtung eintragen') && both.refill.includes('Erika15.000 €Umschichtung eintragen'),
        `Soll 4: je Person Betrag und Knopf (18.900 € und 14.900 € aufgerundet) (${both.refill})`);
    const links = walk(both.doc.getElementById('balanceCashRefill')).filter(node => node.tagName?.toLowerCase() === 'a').map(node => node.getAttribute('href'));
    assertEqual(links.length, 2, 'Soll 4: zwei Knöpfe „Umschichtung eintragen“');
    assert(links[0].includes('person=muster_a&tranche=') && links[1].includes('person=muster_b&tranche=') && links.every(link => link.endsWith('#verkauf')), `Soll 4: Knöpfe öffnen den Verkaufsdialog der jeweiligen Person (${links.join(' ')})`);
    const over = await renderCard(planDone(createMusterHaushaltRecords('2026-10-23', 'max-erika'), { muster_a: 12000, muster_b: 1500 }));
    assert(over.refill.includes('(13.500 €). Ziel sind 12 Monate (32.500 €).19.000 €vom Geldmarkt'), `Soll 4: Max über dem eigenen Ziel → höchstens bis zum Haushaltsziel (angezeigt aufgerundet) (${over.refill})`);
    const capped = projectCashRefill({ people: [{ profileId: 'a', name: 'A', tagesgeld: 1000, geldmarkt: 30000, target: 8000 },
        { profileId: 'b', name: 'B', tagesgeld: 2000, geldmarkt: 60000, target: 27400 }], monthlyBase: 2700, cashMonths: 12, planOpen: false });
    assertClose(capped.amount, 32400 - 3000, 1e-6, 'Soll 4: Summe der Personen genau bis zum Haushaltsziel');
    assertClose(capped.tagesgeld + capped.rows.reduce((sum, row) => sum + row.amount, 0), 32400, 1e-6, 'Soll 4: danach Haushalt genau am Ziel, nicht darüber');
    assertEqual(capped.rows.length, 2, 'Soll 4: beide Personen im Hinweis');
    const view = text(createCashRefill(new MockDocument(), capped));
    assert(view.includes('A6.500 €') && view.includes('B24.000 €'), `Soll 4: im selben Verhältnis gekürzt (6.352 € und 23.048 € aufgerundet) (${view})`);
}

// Soll 2 (P2-2): Verb bei Anleiheverkäufen wie die Diagnose, nie „Handlung prüfen“ bei eindeutigem Beleg.
{
    const renate = await renderCard(createMusterHaushaltRecords('2026-10-23', 'renate'));
    assert(renate.card.includes('Anleihen verkaufenca. 45.000 €netto'), `Soll 2: Renate „Anleihen verkaufen · 44.448 €“, angezeigt ca. 45.000 € (${renate.card.slice(0, 200)})`);
    for (const variant of ['grund', 'haus-pg3']) {
        const helga = await renderCard(createMusterHaushaltRecords('2026-10-23', 'helga-werner', variant));
        assert(helga.card.includes('Anleihen verkaufen') && !helga.card.includes('Handlung prüfen'), `Soll 2: Helga und Werner (${variant}) mit passendem Verb`);
    }
    const action = beleg(createMusterHaushaltRecords('2026-10-23', 'renate')).adopted.action;
    const result = text(createTodoResult(new MockDocument(), projectAnnualTodoPlan({ confirmed: { year: 2026, action }, people: [{ id: 'muster_renate', name: 'Renate' }] })));
    assert(result.includes('Anleihen verkaufenca. 45.000 €netto') && !result.includes('Handlung prüfen'), 'Soll 2: Ergebnis im Jahresabschluss mit demselben Verb (44.448 € aufgerundet, „ca.“ wie die Karte)');
    assertEqual(describePlanAction({ type: 'TRANSACTION', quellen: [], verwendungen: { bonds: 5000 } }).verb, 'Anleihen kaufen', 'Soll 2: reiner Anleihekauf');
}

// Soll 3 (P2-3): Tranche vorwählen mit dem echten Musterbeleg (Kennung mit Personenpräfix).
{
    const records = createMusterHaushaltRecords('2026-10-23', 'max-erika', 'teilweise');
    assert(beleg(records).adopted.action.quellen.some(source => source.trancheId === 'muster_b:muster_b_lot_2'), 'Soll 3: Beleg trägt „person:tranche“');
    const shown = await renderCard(records);
    const sale = walk(shown.doc.getElementById('balanceAnnualAction')).find(node => node.dataset?.todoSaleEntry !== undefined);
    // FR-79: Die Karte öffnet den geführten Verkauf in der Balance; die Planzeile bringt ihre Tranche selbst mit.
    // Max erledigt, Erika teilweise: Stand aus Eingetragenem, Sprung direkt in die Abrechnung (Ergänzung 1 FR-79 Punkt 7).
    assertEqual(sale?.dataset?.saleFlowStart, '3', 'Soll 3: „Weiter mit Schritt 3“ springt in die Abrechnung');
    assert(sale?.textContent === 'Weiter mit Schritt 3', 'Soll 3: Knopftext nach Unterbrechung');
    // Der alte Sprung in den Verkaufsdialog von Personen & Vermögen entfällt (FR-79); die Tranche kommt aus der Planzeile (vk-1-sollfaelle).
}

// Soll 5 (P3-6): „Vorschau auf den Plan J+1“; der Jahresabschluss „Jahr J abschließen“ beschließt genau diesen Plan.
{
    const shown = await renderCard(createMusterHaushaltRecords('2026-10-23', 'max-erika'));
    assertEqual(shown.preview, 'Vorschau auf den Plan 2027', 'Soll 5: Vorschauzeile im Oktober 2026');
    const january = projectBalanceActionOrigin({ year: 2027, occasion: { closingYear: 2026, annualState: 'open' } });
    assertEqual(january.previewYear, 2026, 'Soll 5: im Januar 2027 vor dem Abschluss steht „Jahr 2026 abschließen“ an');
    assertEqual(january.previewYear + 1, 2027, 'Soll 5: … und die Vorschau heißt „Plan 2027“');
    const october = projectBalanceActionOrigin({ year: 2026, occasion: { closingYear: 2025, annualState: 'done' } });
    assertEqual(october.previewYear, 2026, 'Soll 5: im Oktober 2026 ist der nächste Abschluss „Jahr 2026“');
}

// Soll 6 (P3-7): Kurse nicht belastbar → genau eine kleine Zeile; sonst nichts zum Allzeithoch in „Was zu tun ist“ (FR-89).
{
    const stale = await renderCard(createMusterHaushaltRecords('2026-10-23', 'max-erika'), '2026-11-12');
    assertEqual(stale.market, 'Kurse älter als 10 Tage – Allzeithoch nicht belastbar · Kurse holen →', `Soll 6: Zeile bei alten Kursen (${stale.market})`);
    const link = walk(stale.doc.getElementById('balanceMarketPreviewBody')).find(node => node.tagName?.toLowerCase() === 'a');
    assertEqual(link?.getAttribute('href'), 'Daten-Sicherung.html#kursdienst', 'Soll 6: „Kurse holen →“ führt zum Kursdienst');
    const fresh = await renderCard(createMusterHaushaltRecords('2026-10-23', 'max-erika'));
    assertEqual(fresh.market, '', 'Soll 6: frische Kurse → keine Zeile');
    const other = unavailableMarketPreview('Das Projektionsjahr ist bereits abgeschlossen.');
    assertEqual(highPriceProblem(other), null, 'Soll 6: andere Gründe ohne Kurszeile');
    const doc = new MockDocument();
    renderBalanceMarketPreview(doc, other);
    assert(doc.getElementById('balanceMarketPreview').hidden, 'Soll 6: andere Gründe → nichts');
}

// Soll 7 (P3-8): Kaufpläne mit neutralen Sätzen.
{
    const sophie = await renderCard(createMusterHaushaltRecords('2026-10-23', 'sophie'));
    assert(sophie.card.includes('Die App bucht nichts – du entscheidest, wann du kaufst.') && !sophie.card.includes('wann du verkaufst'), 'Soll 7: Kaufplan in der Karte neutral');
    const action = beleg(createMusterHaushaltRecords('2026-10-23', 'sophie')).adopted.action;
    const plan = projectAnnualTodoPlan({ confirmed: { year: 2026, committedAt: '2026-01-01T10:00:00.000Z', action }, people: [{ id: 'muster_sophie', name: 'Sophie' }] });
    const result = text(createTodoResult(new MockDocument(), plan));
    assert(!result.includes('Den Stand verfolgst du') && result.includes('du entscheidest, wann du kaufst'), 'Soll 7: Ergebnis ohne „Stand“ bei Kaufplänen');
    assert(createPlanDetails(new MockDocument(), plan, action).text.includes('wann du kaufst'), 'Soll 7: Details & Drucken neutral');
}

// Soll 9 (P3-4): Details & Drucken mit ISIN und Cent.
{
    const action = { type: 'TRANSACTION', title: 'Aktien verkaufen', steuer: 233.51, verwendungen: { liquiditaet: 1000.49 },
        quellen: [{ kind: 'aktien_neu', category: 'equity', name: 'Muster Aktien-ETF', isin: 'DE000TEST123', sourceProfileId: 'max', sourceProfileName: 'Max', trancheId: 'max:max_lot_2',
            purchaseDate: '2025-02-14', brutto: 1234, steuer: 233.51, netto: 1000.49 }] };
    const plan = projectAnnualTodoPlan({ confirmed: { year: 2026, committedAt: '2026-01-02T11:00:00.000Z', action }, people: [] });
    const details = createPlanDetails(new MockDocument(), plan, action);
    assert(details.text.includes('Max | Muster Aktien-ETF · DE000TEST123 | Kauf 14.02.2025 | 1.234,00 € | 233,51 € | 1.000,49 €'), `Soll 9: ISIN und Cent je Zeile (${details.text})`);
    assert(details.text.includes('Summe | 1.234,00 € | 233,51 € | 1.000,49 €'), 'Soll 9: Summe mit Cent');
    assert(details.text.includes('Aufs Tagesgeld bis zum Tagesgeldziel, der Rest in den Geldmarkt: 1.000,49 €'), 'Soll 9: Verwendung mit Cent');
}

// Nachtrag 11 und 12 (Bildabnahme): „Details“ ohne doppeltes „zeigen“, Stand des alten Plans ohne „Erledigt“.
{
    const note = text(createPlanProgressNote(new MockDocument(), { year: 2026, status: 'offen', soldNet: 0, planNet: 89312 }, true));
    assertEqual(note, 'Plan 2026 · nicht umgesetzt0 € von 89.312 € verkauft. Der neue Plan ersetzt ihn.', 'Nachtrag 12: kein „Erledigt“ bei nicht umgesetztem Plan (VN-1 Punkt 4: Plan auf den Euro)');
    const { doc } = createDialogFixture();
    const action = beleg(createMusterHaushaltRecords('2026-10-23', 'renate')).adopted.action;
    const root = createAnnualTodoResult(doc, { year: 2027, action, text: 'Anleihen verkaufen', people: [{ id: 'muster_renate', name: 'Renate' }] });
    const summary = walk(root).find(node => node.tag === 'summary');
    assertEqual(summary?.textContent, 'Details', 'Nachtrag 11: Beschriftung „Details“; „zeigen“ hängt das Designsystem an');
}

// Gutachten WT1-FABLE Befund 11: Rückfall im Rendern. Ein Beleg, dessen Liquiditätsquelle den heutigen Bestand übersteigt,
// lässt die Aufbereitung werfen; Reserven rechnen dann neu, die Karte zeigt weiter den Beleg, die Seite bricht nicht ab.
// ATH-1b (FR-89, Ergänzung 3): Der Kurs liegt höchstens 5 % unter dem Tageshoch der Spielkurse vom 12.08.2026 und gilt als
// Höchststand (heiß gelaufen); nach ATH-1 ohne Grundrauschen waren es 125.000 € und 124.363 €.
for (const [variant, expected, planText] of [
    ['grund', 'nach Umsetzung180.000 €', 'Aktien verkaufenca. 90.000 €'],
    ['teilweise', 'nach Umsetzung179.363 €', 'Noch offen']
]) {
    const records = createMusterHaushaltRecords('2026-10-23', 'max-erika', variant);
    const record = JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]), entry = Object.values(record.entries)[0];
    entry.adopted.action.quellen.push({ kind: 'liquiditaet', source: 'Liquidität', sourceProfileId: 'muster_a', sourceProfileName: 'Max', brutto: 5000000, steuer: 0, netto: 5000000 });
    entry.adopted.action.verwendungen.aktien = 5000000;
    records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify(record);
    const warn = console.warn; let warned = 0; console.warn = () => { warned++; };
    let shown = null;
    try { shown = await renderCard(records); } finally { console.warn = warn; }
    assertEqual(warned, 1, 'Befund 11: Aufbereitung des Belegs wirft, der Rückfall greift');
    assert(shown.values.includes(expected), `Befund 11: Reserven mit dem gerundeten Verkauf aus der Neuberechnung (${shown.values})`);
    assert(shown.card.includes(planText), `Befund 11: Karte zeigt weiter den Beleg (${variant})`);
}
