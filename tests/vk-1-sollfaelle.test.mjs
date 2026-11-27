// VK-1 (FR-79 mit Ergänzung 1): Sollfälle des geführten Verkaufs und des gemeinsamen Haushaltsschreibers.
// Nur synthetische Daten: Musterhaushalt Max und Erika, Testdatum 23.10.2026, Spielkurse.
import strict from 'node:assert/strict';
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { ANNUAL_PLAN_RESOLUTIONS_KEY, readAnnualPlanResolutions, assertAnnualPlanResolutions } from '../app/profile/annual-plan-resolutions.js';
import { suggestSaleShares, settleSale, restQuestionAmount, distributeCredits, bankOrderTranches, allocateBankOrder, estimatePartsTax,
    splitOrder } from '../app/tranches/sale-flow-model.js';
import { prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { readSaleFlowPlan, projectSaleFlowCard, saleFlowPlanFromConfirmed } from '../app/tranches/sale-flow-dialog.js';
import { readReconciliationHistory, projectReconciliationCashStatuses } from '../app/tranches/tranche-reconciliation.js';
import { annualActionDoneThreshold } from '../app/balance/annual-action-progress.js';
import { pendingCreditTotal, creditUnderwayText } from '../app/tranches/sale-underway.js';

const DATE = '2026-10-23';
const MAX = 'muster_a', ERIKA = 'muster_b';
const cents = value => Math.round(value * 100) / 100;

// 1 · Stückvorschlag mit 1 % Puffer (Ergänzung 1 Punkt 3), alter Vorschlag ohne Puffer als Gegenprobe.
assertEqual(suggestSaleShares(9363, 144.47), 66, 'Stückvorschlag Max ⌈9.363 × 1,01 ÷ 144,47⌉ = 66');
assertEqual(suggestSaleShares(80776, 144.47), 565, 'Stückvorschlag Erika ⌈80.776 × 1,01 ÷ 144,47⌉ = 565');
assertEqual(Math.ceil(9363 / 144.47), 65, 'alt ohne Puffer: Max 65');
assertEqual(Math.ceil(80776 / 144.47), 560, 'alt ohne Puffer: Erika 560');
assertEqual(suggestSaleShares(9363, 144.46978), 66, 'gerechnet mit dem angezeigten Kurs (2 Nachkommastellen)');

// 2 · Abrechnung: Stück × Kurs − Gebühren − Steuern = Gutschrift; Steuern als Rest aus der Gutschrift; Erstattung negativ.
{
    const erika = settleSale({ shares: 560, price: 144.38, fees: 9.9, taxes: 828.1 });
    assertEqual(erika.gross, 80852.8, 'Erika Kurswert 80.852,80 €');
    assertEqual(erika.net, 80014.8, 'Erika Gutschrift 80.014,80 €');
    assertEqual(settleSale({ shares: 560, price: 144.38, fees: 9.9, credit: 80014.8, fromCredit: true }).taxes, 828.1, 'Steuern als Rest aus der Gutschrift');
    const max = settleSale({ shares: 65, price: 144.52, fees: 4.9, taxes: 0 });
    assertEqual(max.net, 9388.9, 'Max Gutschrift 9.388,90 €');
    assertEqual(cents(18000 + max.net), 27388.9, 'Tagesgeld-Vorschlag Max 27.388,90 €');
    assertEqual(settleSale({ shares: 10, price: 90, fees: 1, taxes: -25.5 }).net, 924.5, 'Erstattung als negativer Steuerbetrag erhöht die Gutschrift');
    // Vorher zählte der alte Weg ohne Steuerfeld Brutto − Kosten.
    assertEqual(cents(erika.gross - 9.9), 80842.9, 'alt ohne Steuer: 80.842,90 €');
}

// 3 · Rest-Frage erst über der Erledigt-Grenze (Ergänzung 1 Punkt 5).
{
    const line = { planNet: 79949.58, soldNet: 0 };
    assertEqual(annualActionDoneThreshold(79949.58), 74949.58, 'Erledigt-Grenze Erika: Plan − 5.000 €');
    const weniger = settleSale({ shares: 400, price: 144.38, fees: 9.9, taxes: 478.03 });
    assertEqual(weniger.net, 57264.07, 'Erika bewusst weniger: 57.264,07 €');
    assertEqual(restQuestionAmount(line, weniger.net), 22685.51, 'Rest von 22.685,51 € (Beleg genau 79.949,58 €; Sollfall gerundet 22.685 €)');
    assertEqual(restQuestionAmount(line, 80014.8), null, 'Plan erreicht: keine Rest-Frage');
    assertEqual(restQuestionAmount(line, 76000), null, 'unter 5.000 € Rest: erledigt ohne Frage');
}

// 4 · Verteilung: nur die Lücke zum Haushaltsziel, an wer darunter liegt (Ergänzung 1 Punkt 2).
{
    const view = distributeCredits({ householdTarget: 32400, people: [
        { profileId: MAX, name: 'Max', cashBefore: 18000, target: 5000, credit: 9388.9 },
        { profileId: ERIKA, name: 'Erika', cashBefore: 12000, target: 27400, credit: 80014.8 }] });
    const [max, erika] = view.rows;
    assertEqual(view.gap, 2400, 'Lücke 32.400 − 30.000 = 2.400 €');
    assertEqual(max.toCash, 0, 'Max 0 € aufs Tagesgeld');
    assertEqual(erika.toCash, 2400, 'Erika +2.400 €');
    assertEqual(max.toMoneyMarket, 9388.9, 'Geldmarkt Max 9.388,90 €');
    assertEqual(erika.toMoneyMarket, 77614.8, 'Geldmarkt Erika 77.614,80 €');
    assertEqual(view.toMoneyMarket, 87003.7, 'zusammen 87.003,70 € in den Geldmarkt');
    assertEqual(view.cashAfter, 32400, 'Tagesgeld danach 32.400 €');
    assertEqual(view.credits, 89403.7, 'Gutschriften zusammen 89.403,70 €');
}

// 5 · Bankreihenfolge: älteste Stücke zuerst, auch über zwei Tranchen (Ergänzung 1 Punkt 1, Sollfall Martin).
{
    const tranches = [
        { trancheId: 'neu-2026', isin: 'IE00BK5BQT80', shares: 692, purchasePrice: 144.4243, purchaseDate: '2026-10-23', tqf: 0.3 },
        { trancheId: 'alt-2020', isin: 'IE00BK5BQT80', shares: 3460.931, purchasePrice: 86.68, purchaseDate: '2020-05-18', tqf: 0.3 }];
    const ordered = bankOrderTranches(tranches, tranches[0]);
    assertEqual(ordered[0].trancheId, 'alt-2020', 'Bank nimmt die Tranche von 2020 zuerst');
    const bank = allocateBankOrder(ordered, 500);
    assertEqual(estimatePartsTax(bank.parts, 144.47), 5334.74, 'Bankreihenfolge: Steuer 5.334,74 € (ohne Pauschbetrag)');
    assertClose(estimatePartsTax([{ tranche: tranches[0], shares: 500 }], 144.47), 4.22, 0.01, 'Steuerreihenfolge nähme 2026: ca. 4,22 €');
    const split = splitOrder(allocateBankOrder(ordered, 4000).parts, { shares: 4000, gross: 577880, fees: 9.9, taxes: 1000 });
    assertEqual(split.length, 2, 'eine Abrechnung, intern auf zwei Tranchen aufgeteilt');
    assertEqual(cents(split.reduce((sum, part) => sum + part.fees, 0)), 9.9, 'Gebühren anteilig, Summe gleich');
    assertEqual(cents(split.reduce((sum, part) => sum + part.taxes, 0)), 1000, 'Steuern anteilig, Summe gleich');
}

// 6 · Gemeinsamer Schreiber im Musterhaushalt: Erfolg, Wiederholung, Konflikt, Abbruch, Gutschrift, Entscheidung.
async function freshArea(records) {
    P.resetPersistenceForTests({ name: 'vk-1-synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const snapshot = () => JSON.stringify(Object.fromEntries(P.keysSync().sort().map(key => [key, P.getItemSync(key)])));
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const tranche = (id, lot) => JSON.parse(registry().profiles[id].data.depot_tranchen).find(item => item.trancheId === lot);
const erikaSale = (overrides = {}) => ({ profileId: ERIKA, actionId: 'vk1-erika-1', executedAt: DATE,
    parts: [{ trancheId: 'muster_b_lot_2', shares: 560, gross: 80852.8, fees: 9.9, taxes: 828.1 }], recommendation: { sharesSold: 565, grossProceeds: 80776.04 }, ...overrides });

setAppTestDate(DATE);
const records = createMusterHaushaltRecords(DATE, 'max-erika', 'grund');
await freshArea(records);
const entry = Object.values(JSON.parse(storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries)[0];
const plan = saleFlowPlanFromConfirmed({ year: 2026, committedAt: entry.committedAt, action: entry.adopted.action }, [MAX, ERIKA], registry());
assert(plan && plan.people.length === 2, 'Plan aus dem Musterbeleg mit zwei Personen');
{
    const before = snapshot();
    const card = projectSaleFlowCard({ plan, registry: registry() });
    assertEqual(card.started, false, 'Karte: noch nichts eingetragen');
    const lines = readSaleFlowPlan({ plan, registry: registry() }).lines;
    assertEqual(lines.map(line => line.suggestion.shares).join('/'), '66/565', 'Überblick: Vorschlag 66 und 565 Stück');
    assertEqual(snapshot(), before, 'Überblick und Karte schreiben nichts');
}
{
    const before = snapshot();
    const prepared = await prepareSaleFlowWrite({ sales: [erikaSale()] });
    assertEqual(snapshot(), before, 'Vorbereitung schreibt nichts');
    await commitSaleFlowWrite(prepared);
    const record = readReconciliationHistory(registry()).find(event => event.actionId === 'vk1-erika-1');
    assertEqual(record.actual.taxes, 828.1, 'Verkaufsbeleg trägt die Steuern');
    assertClose(record.actual.netProceeds, 80014.8, 0.001, 'netProceeds = Kurswert − Gebühren − Steuern');
    assertEqual(record.recommendation.sharesSold, 565, 'Vorschlag als recommendation gespeichert');
    assertClose(tranche(ERIKA, 'muster_b_lot_2').shares, 685.9353, 0.0001, 'Neubestand 1.245,935 → 685,935 Stück');
    const lines = readSaleFlowPlan({ plan, registry: registry() }).lines;
    assertEqual(lines[1].status, 'erledigt', 'Erika: Zeile erledigt');
    assert(projectReconciliationCashStatuses(registry()).some(status => status.targetActionId === 'vk1-erika-1' && status.isPending), 'Gutschrift kommt noch');
    const card = projectSaleFlowCard({ plan, registry: registry() });
    assertEqual(card.next, 3, 'Karte: weiter mit Schritt 3 (Max fehlt)');
    assertEqual(creditUnderwayText(pendingCreditTotal(registry())).replace(/\s/g, ' '), 'Gutschrift unterwegs: Vermögen um 80.014,80 € zu niedrig.', 'Geld unterwegs mit Betrag und Richtung');
}
{
    const before = snapshot();
    const again = await prepareSaleFlowWrite({ sales: [erikaSale()] });
    assertEqual(again.results[0].status, 'duplicate', 'Wiederholung mit gleichen Daten: idempotent');
    await commitSaleFlowWrite(again);
    assertEqual(snapshot(), before, 'Wiederholung ändert nichts');
    await strict.rejects(prepareSaleFlowWrite({ sales: [erikaSale({ parts: [{ trancheId: 'muster_b_lot_2', shares: 500, gross: 72190, fees: 9.9, taxes: 700 }] })] }),
        error => error?.code === 'RECONCILIATION_ACTION_CONFLICT');
    assertEqual(snapshot(), before, 'Konflikt bei abweichenden Daten ändert nichts');
}
{
    const prepared = await prepareSaleFlowWrite({ sales: [{ profileId: MAX, actionId: 'vk1-max-1', executedAt: DATE,
        parts: [{ trancheId: 'muster_a_lot_2', shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }], cashValue: 27388.9 }] });
    P.setItemSync('profile_tagesgeld', '18001');
    const changed = snapshot();
    await strict.rejects(commitSaleFlowWrite(prepared), error => ['HOUSEHOLD_WRITE_STALE', 'persistence_precondition_mismatch'].includes(error?.code));
    assertEqual(snapshot(), changed, 'Abbruch bei geändertem Ausgangsstand: nichts geschrieben');
    P.setItemSync('profile_tagesgeld', '18000');
    const fresh = await prepareSaleFlowWrite({ sales: [{ profileId: MAX, actionId: 'vk1-max-1', executedAt: DATE,
        parts: [{ trancheId: 'muster_a_lot_2', shares: 65, gross: 9393.8, fees: 4.9, taxes: 0 }], cashValue: 27388.9 }] });
    await commitSaleFlowWrite(fresh);
    assertEqual(Number(storage.getItem('profile_tagesgeld')), 27388.9, 'sofortige Gutschrift im selben Commit (aktive Person, Livewert)');
    assertEqual(Number(registry().profiles[MAX].data.profile_tagesgeld), 27388.9, 'sofortige Gutschrift in der Registry');
    assert(!projectReconciliationCashStatuses(registry()).some(status => status.targetActionId === 'vk1-max-1' && status.isPending), 'Max: keine offene Gutschrift');
}
{
    const prepared = await prepareSaleFlowWrite({ credits: [{ profileId: ERIKA, targetActionIds: ['vk1-erika-1'], value: 92014.8 }] });
    await commitSaleFlowWrite(prepared);
    assertEqual(Number(registry().profiles[ERIKA].data.profile_tagesgeld), 92014.8, 'Gutschrift Erika bestätigt: Tagesgeld 92.014,80 €');
    const card = projectSaleFlowCard({ plan, registry: registry(), cashContext: { householdTarget: 32400, targets: { [MAX]: 5000, [ERIKA]: 27400 } } });
    assertEqual(card.next, null, 'Karte: Verkauf abgeschlossen, kein „Weiter mit Schritt“');
    assertEqual(card.buys.map(buy => `${buy.name} ${buy.amount}`).join(' · '), 'Max 9388.9 · Erika 77614.8', 'eigene Zeile „Geldmarkt kaufen“ je Person');
}

// 7 · Bewusst weniger: „Rest bleibt im Depot“ und „Rest doch verkaufen“ (FR-79 Punkt 11).
setAppTestDate(DATE);
await freshArea(createMusterHaushaltRecords(DATE, 'max-erika', 'grund'));
{
    const raw = storage.getItem(ANNUAL_PLAN_RESOLUTIONS_KEY);
    assertEqual(raw, null, 'ohne Entscheidung kein Schlüssel (keine Schreib-Migration)');
    const lines = readSaleFlowPlan({ plan, registry: registry() }).lines;
    const key = lines[1].key;
    const prepared = await prepareSaleFlowWrite({ sales: [erikaSale({ actionId: 'vk1-erika-weniger',
        parts: [{ trancheId: 'muster_b_lot_2', shares: 400, gross: 57752, fees: 9.9, taxes: 478.03 }] })],
        resolution: { year: 2026, ids: [MAX, ERIKA], line: { key, decision: 'keep_in_depot', reason: 'Tagesgeld reicht bis Jahresende' } } });
    await commitSaleFlowWrite(prepared);
    assertAnnualPlanResolutions(storage.getItem(ANNUAL_PLAN_RESOLUTIONS_KEY));
    let line = readSaleFlowPlan({ plan, registry: registry() }).lines[1];
    assertEqual(line.status, 'erledigt', 'Bleibt im Depot: Zeile erledigt');
    assertEqual(line.keptInDepot, true, 'Erledigt · Rest bleibt im Depot');
    assertEqual(line.restNet, 0, 'keine Erinnerung an den Rest');
    assertEqual(readAnnualPlanResolutions({ year: 2026, ids: [ERIKA, MAX] }).lines[key].reason, 'Tagesgeld reicht bis Jahresende', '„Warum?“ gespeichert');
    const revoke = await prepareSaleFlowWrite({ resolution: { year: 2026, ids: [MAX, ERIKA], line: { key, decision: null } } });
    await commitSaleFlowWrite(revoke);
    line = readSaleFlowPlan({ plan, registry: registry() }).lines[1];
    assertEqual(line.status, 'teilweise', 'Rest doch verkaufen: wieder teilweise');
    assertClose(line.restNet, 22685.51, 0.01, 'Rest wieder offen');
}

// 8 · Neuer Schlüssel in Allowlists und Sicherungsprüfer (VKR Abschnitt 2, Gate-Check).
{
    const { isAllowedPersistenceImportKey, isAllowedSnapshotCaptureKey } = await import('../app/shared/persistence-key-policy.js');
    assert(isAllowedPersistenceImportKey(ANNUAL_PLAN_RESOLUTIONS_KEY), 'Import-Allowlist kennt annual_plan_resolutions_v1');
    assert(isAllowedSnapshotCaptureKey(ANNUAL_PLAN_RESOLUTIONS_KEY), 'Sicherungsabbild erfasst annual_plan_resolutions_v1');
    strict.throws(() => assertAnnualPlanResolutions('{"version":1,"entries":{"x":{}}}'), /Entscheidung/);
    strict.throws(() => assertAnnualPlanResolutions({ version: 1, entries: { '[2026,["a"]]': { year: 2026, ids: ['a'], lines: { k: { decision: 'keep_in_depot', decidedAt: 'gestern' } } } } }), /Planzeile/);
}

// 9 · Jahresabschluss Schritt „Plan“: „umgesetzt, Rest bewusst im Depot“ und Geld unterwegs (FR-79 Punkt 11, Ergänzung 1 Punkt 4).
{
    const { MockDocument } = await import('./helpers/balance-page-fixture.mjs');
    const { createPlanProgressNote } = await import('../app/shared/annual-todo-view.js');
    const text = node => [node.textContent || '', ...(node.children || []).map(text)].join(' ').replace(/\s+/g, ' ');
    const progress = { year: 2026, status: 'erledigt', soldNet: 66652.97, planNet: 89312.5, creditPendingNet: 57264.07,
        lines: [{ planNet: 9362.92 }, { planNet: 79949.58, keptInDepot: true }] };
    assert(text(createPlanProgressNote(new MockDocument(), progress, true)).includes('Plan 2026 · umgesetzt, Rest bewusst im Depot'), 'Ergebnis: umgesetzt, Rest bewusst im Depot');
    const note = text(createPlanProgressNote(new MockDocument(), progress));
    assert(note.includes('umgesetzt, Rest bewusst im Depot') && note.includes('Gutschrift unterwegs: Vermögen um 57.264,07 € zu niedrig'), `Schritt „Plan“ nennt Rest und Geld unterwegs (${note})`);
}
