// VK-3b (Nachschritt zu VK-2b, TRG-1c und VK-3 aus den Gutachten VK3 und VK3-FABLE). Nur synthetische Daten: Musterhaushalte Max und
// Erika, Martin und Petra, Testdatum 23.10.2026, Spielkurse.
import { PersistenceFacade as P, persistenceStorage as storage } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { prepareTrancheDetailWrite, prepareSaleFlowWrite, commitSaleFlowWrite } from '../app/tranches/household-sale-writer.js';
import { validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';
import { unmarriedWithdrawalPlan, unmarriedPayoutPlan, capCarrierToPayable } from '../app/simulator/simulator-unmarried.js';
import { readReconciliationHistory, projectBuyCashStatuses } from '../app/tranches/tranche-reconciliation.js';
import { cancelledBuyDebit, trancheDetailFigures, trancheHistory } from '../app/tranches/tranche-detail-model.js';
import { renderQuoteCheck } from '../app/tranches/tranche-detail-view.js';
import { readFlowBuys } from '../app/tranches/buy-flow-model.js';
import { futureBuyMessage } from '../app/tranches/buy-flow-steps.js';
import { confirmedCarrier } from '../app/balance/balance-renderer-summary.js';
import { createPlanDetails } from '../app/shared/annual-todo-view.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { readDecimalInput } from '../app/tranches/tranchen-manager-decimal-input.js';
import { oneCarriesMode } from '../app/profile/household-withdrawal-mode.js';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';

const DATE = '2026-10-23';
const MAX = 'muster_a', MARTIN = 'muster_martin', PETRA = 'muster_petra';
setAppTestDate(DATE);
async function freshArea(data) {
    P.resetPersistenceForTests({ name: 'vk-3b-synthetic', loadAll: async () => ({ ...data }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete data[key]); batch.upserts.forEach(([key, value]) => { data[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
const registry = () => JSON.parse(storage.getItem('rs_profiles_v1'));
const lots = id => JSON.parse(registry().profiles[id].data.depot_tranchen);
/** Kauf Martin: 685 Stück Muster Aktien-ETF, Abrechnung 98.920,85 € + 9,90 € Gebühren. */
const buyTranche = id => ({ schemaVersion: 2, trancheId: id, name: 'Muster Aktien-ETF', type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE', isin: 'IE00BK5BQT80',
    shares: 685, purchasePrice: 98930.75 / 685, currentPrice: 144.46978, purchaseDate: DATE, tqf: 0.3, taxExempt: false, notes: '' });

// Gutachten VK3 Befund 2: Korrigieren einer Tranche ohne Kaufdatum stürzt nicht mehr ab.
{
    await freshArea(createMusterHaushaltRecords(DATE, 'max-erika', 'grund'));
    const tranche = { ...lots(MAX).find(lot => lot.trancheId === 'muster_a_lot_1'), purchaseDate: '', shares: 1500 };
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MAX, tranche, correction: true }));
    const lot = JSON.parse(registry().profiles[MAX].data.profile_wealth_history_lots_v1).lots.muster_a_lot_1;
    assertEqual(`${lot.status} ${lot.remainingShares} ${lot.manualCorrectionAt}`, `present 1500 ${DATE}`, 'Korrektur ohne Kaufdatum gespeichert');
    assertEqual(lots(MAX).find(item => item.trancheId === 'muster_a_lot_1').purchaseDate, '', 'Kaufdatum bleibt leer („Kaufdatum fehlt“)');
}

// Gutachten VK3 Befund 3: Der Sicherungsprüfer liest den Abgleich (Käufe, Stornos) wie die App beim Öffnen.
{
    const data = createMusterHaushaltRecords(DATE, 'martin-petra', 'grund');
    await freshArea(data);
    const tranche = buyTranche('vk3b_buy');
    await commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [{ profileId: MARTIN, actionId: 'vk3b-buy', executedAt: DATE, assetClass: 'equity', tranche,
        shares: 685, gross: 98920.85, fees: 9.9, cashValue: null }] }));
    await P.flush();
    const records = { ...data };
    const reg = JSON.parse(records.rs_profiles_v1);
    assert(reg.trancheReconciliation.actions.some(action => action.eventType === 'buy_reconciled'), 'Abgleich mit Kaufbeleg');
    const valid = validatePersistenceDomainRecords(records);
    assert(valid.ok, `intakter Abgleich besteht den Sicherungsprüfer ${valid.message || ''}`);
    const broken = structuredClone(reg);
    broken.trancheReconciliation.actions.push({ schemaVersion: 1, eventType: 'buy_cancelled', actionId: 'buy-cancel-x', profileId: MARTIN, trancheId: 'vk3b_buy',
        targetActionId: 'gibt-es-nicht', cancelledAt: `${DATE}T10:00:00.000Z` });
    assert(!validatePersistenceDomainRecords({ ...records, rs_profiles_v1: JSON.stringify(broken) }).ok, 'Storno ohne Kaufbeleg wird beim Import abgewiesen');
    const unknown = structuredClone(reg);
    unknown.trancheReconciliation.actions.push({ schemaVersion: 1, eventType: 'buy_deleted', actionId: 'x' });
    assert(!validatePersistenceDomainRecords({ ...records, rs_profiles_v1: JSON.stringify(unknown) }).ok, 'unbekannter Ereignistyp wird beim Import abgewiesen');
}

// Gutachten VK3-FABLE P2-2 (Nachtrag 1): Bei „Eine Person trägt“ zahlt die tragende Person nur, was sie auszahlen kann; ein kleiner
// Depotrest führt nicht mehr zum Scheinruin. Beispiel aus dem Gutachten: Martin plant 89.107,00 €, hat 89.102,40 € Tagesgeld und 5 € Depot.
{
    const portfolio = { personAccounts: [{ profileId: MARTIN, tagesgeld: 89102.4 }, { profileId: PETRA, tagesgeld: 477985 }],
        depotTranchesAktien: [{ sourceProfileId: MARTIN, marketValue: 5, costBasis: 5 }], depotTranchesGold: [], depotTranchesGeldmarkt: [], healthBucketTranches: [] };
    const shares = [{ profileId: MARTIN, carries: true, share: 1, care: 0 }, { profileId: PETRA, carries: false, share: 0, care: 0 }];
    const plan = unmarriedWithdrawalPlan(shares, 89107, portfolio, true, []);
    assertEqual(plan.items.map(item => item.withdrawalAmount.toFixed(2)).join('/'), '89107.00/0.00', 'Plan nach Vermögenswert: Martin 89.107,00 € (Depotrest zählt mit)');
    const capped = capCarrierToPayable(plan, shares, portfolio);
    assertEqual(capped.items.map(item => item.withdrawalAmount.toFixed(2)).join('/'), '89102.40/4.60', 'Martin zahlt 89.102,40 €, Petra 4,60 €');
    assertEqual(`${capped.attacked?.[0]?.profileId} ${capped.attacked?.[0]?.amount.toFixed(2)}`, `${PETRA} 4.60`, 'Rückgriff auf Petra mit Hinweis');
    const paid = unmarriedPayoutPlan({ ...plan, credits: [] }, shares, { payout: 89107, incomeConsumed: 0, plannedExpense: 0, target: 89107 }, portfolio);
    assertEqual(paid.items.map(item => item.withdrawalAmount.toFixed(2)).join('/'), '89102.40/4.60', 'Auszahlung im Modus begrenzt die tragende Person');
    const linear = [{ profileId: MARTIN, share: 0.5 }, { profileId: PETRA, share: 0.5 }];
    assertEqual(capCarrierToPayable(plan, linear, portfolio), plan, 'Vorgabemodus (ohne tragende Person) unverändert');
}

// Historischer Lauf (eigene Reihe wie im Gutachten): Martin trägt, sein Depot auf 20 % verkleinert, Petra 400.000 € Tagesgeld, Bedarf
// 70.000 + 30.000 €, Start 2000. Vorher endete der Lauf 2012 mit „Persönlicher Ausgabenanteil ungedeckt“, obwohl Petra zahlen konnte.
{
    const base = await measurementInputs(0, 'martin-petra', DATE);
    const inputs = structuredClone(base);
    inputs.householdWithdrawalMode = oneCarriesMode(MARTIN);
    inputs.detailledTranches = inputs.detailledTranches.map(tranche => tranche.sourceProfileId === MARTIN
        ? { ...tranche, shares: tranche.shares * 0.2, marketValue: tranche.marketValue * 0.2, costBasis: tranche.costBasis * 0.2 } : tranche);
    const petra = inputs.simulationPeople.find(person => person.profileId === PETRA);
    inputs.tagesgeld += 400000 - petra.tagesgeld; petra.tagesgeld = 400000;
    Object.assign(inputs, { startFloorBedarf: 70000, floorBedarf: 70000, startFlexBedarf: 30000, flexBedarf: 30000 });
    const run = backtest(inputs, 2000, 2025);
    assert(!/Persönlicher/.test(run.outcome.reason || ''), `kein Scheinruin „Persönlicher Ausgabenanteil ungedeckt“ (${run.outcome.kind} ${run.outcome.reason || ''})`);
    assertEqual(run.outcome.kind, 'completed', 'Lauf 2000–2025 endet regulär');
    assert(run.rows.some(entry => entry.row.personalPayout?.attacked?.some(row => row.profileId === PETRA)), 'Rückgriff auf Petra steht im Protokoll');
}

// Gutachten VK3-FABLE P2-1 (Nachtrag 1): Nach „Kauf rückgängig“ lässt sich derselbe Kauf mit seiner Ordernummer neu eintragen. Martin kauft
// mit Ordernummer 4711 am 23.10., storniert, trägt neu ein: Folgekennung `~r2`; zweites identisches Absenden bleibt „duplicate“.
{
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    const order = `order-buy-${MARTIN}-${DATE}-4711`;
    const buy = (trancheId, shares = 685, gross = 98920.85) => ({ profileId: MARTIN, actionId: order, executedAt: DATE, assetClass: 'equity',
        tranche: { ...buyTranche(trancheId), shares, purchasePrice: (gross + 9.9) / shares }, shares, gross, fees: 9.9, cashValue: null });
    const write = async request => { const prepared = await prepareSaleFlowWrite({ buys: [request] }); await commitSaleFlowWrite(prepared); return prepared.results[0]; };
    const history = () => [...readReconciliationHistory(registry())];
    assertEqual((await write(buy('vk3b_a'))).actionId, order, 'erster Kauf mit der Ordernummer');
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3b_a', cancelBuy: order }));
    const again = await write(buy('vk3b_b'));
    assertEqual(`${again.status} ${again.actionId}`, `applied ${order}~r2`, 'Wiedereintrag nach Storno: gespeichert mit Folgekennung ~r2');
    assertEqual((await write(buy('vk3b_b'))).status, 'duplicate', 'zweites identisches Absenden bleibt „duplicate“');
    assertEqual(readFlowBuys(registry(), [MARTIN]).length, 1, 'Stand der Käufe zählt genau einen Kauf');
    let conflict = '';
    try { await write(buy('vk3b_c', 100, 14446.98 - 9.9)); } catch (error) { conflict = error.code; }
    assertEqual(conflict, 'RECONCILIATION_ACTION_CONFLICT', 'anderer Kauf mit gleicher Ordernummer und gleichem Tag bleibt ein Konflikt');
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3b_b', cancelBuy: `${order}~r2` }));
    assertEqual((await write(buy('vk3b_d'))).actionId, `${order}~r3`, 'nach zweitem Storno: Folgekennung ~r3');
    conflict = '';
    try { await write(buy('vk3b_e', 100, 14446.98 - 9.9)); } catch (error) { conflict = error.code; }
    assertEqual(conflict, 'RECONCILIATION_ACTION_CONFLICT', 'nicht stornierter Kauf bleibt auch nach mehreren Stornos ein Konflikt');
    assert(history().filter(item => item.eventType === 'buy_cancelled').length === 2, 'zwei Stornos im Verlauf, Verlauf lesbar');
}

// Gutachten VK3-FABLE P2-3 (Nachtrag 1) und P3-1: „Kauf rückgängig“ nach bestätigter Abbuchung setzt das Tagesgeld nur auf ausdrücklichen
// Wunsch zurück (Martin 100.000 € → Kauf 98.930,75 € bestätigt → 1.069,25 € → Storno mit Rücksetzen → 100.000 €); der Schreiber prüft die
// Löschsperre selbst.
{
    const cash = () => Number(registry().profiles[MARTIN].data.profile_tagesgeld);
    const buyNow = async (trancheId, actionId, cashValue) => commitSaleFlowWrite(await prepareSaleFlowWrite({ buys: [{ profileId: MARTIN, actionId, executedAt: DATE,
        assetClass: 'equity', tranche: buyTranche(trancheId), shares: 685, gross: 98920.85, fees: 9.9, cashValue }] }));
    await freshArea(createMusterHaushaltRecords(DATE, 'martin-petra', 'grund'));
    assertEqual(cash(), 100000, 'Martin vor dem Kauf 100.000 €');
    await buyNow('vk3b_cash', 'vk3b-cash', 1069.25);
    assertEqual(cash(), 1069.25, 'Abbuchung bestätigt: 1.069,25 €');
    const records = [...readReconciliationHistory(registry())];
    const debit = cancelledBuyDebit(records, [...projectBuyCashStatuses(registry(), MARTIN)], 'vk3b-cash');
    assertEqual(`${debit.confirmed} ${debit.amount}`, 'true 98930.75', 'Nachfrage kennt Betrag und bestätigte Abbuchung');
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3b_cash', cancelBuy: 'vk3b-cash', cashValue: 100000 }));
    assertEqual(cash(), 100000, 'Storno mit „Tagesgeld zurücksetzen“: wieder 100.000 €');
    const history = JSON.parse(registry().profiles[MARTIN].data.profile_cash_history_v1);
    assertEqual(history.entries.at(-1)?.value, 100000, 'Tagesgeldverlauf führt den zurückgesetzten Stand');

    await buyNow('vk3b_keep', 'vk3b-keep', 1069.25);
    await commitSaleFlowWrite(await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3b_keep', cancelBuy: 'vk3b-keep' }));
    assertEqual(cash(), 1069.25, '„Tagesgeld unverändert lassen“: keine Änderung');

    await buyNow('vk3b_open', 'vk3b-open', null);
    const open = cancelledBuyDebit([...readReconciliationHistory(registry())], [...projectBuyCashStatuses(registry(), MARTIN)], 'vk3b-open');
    assertEqual(open.confirmed, false, 'offene Abbuchung: kein Tagesgeldfeld');
    let refused = '';
    try { await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3b_open', cancelBuy: 'vk3b-open', cashValue: 5000 }); } catch (error) { refused = error.code; }
    assertEqual(refused, 'TRANCHE_CASH_INVALID', 'ohne bestätigte Abbuchung keine Änderung am Tagesgeld');

    await commitSaleFlowWrite(await prepareSaleFlowWrite({ sales: [{ profileId: MARTIN, actionId: 'vk3b-sale', executedAt: DATE,
        parts: [{ trancheId: 'vk3b_open', shares: 10, gross: 1444.7, fees: 4.9, taxes: 0 }], cashValue: null }] }));
    refused = '';
    try { await prepareTrancheDetailWrite({ profileId: MARTIN, remove: 'vk3b_open', cancelBuy: 'vk3b-open' }); } catch (error) { refused = error.code; }
    assertEqual(refused, 'TRANCHE_DELETE_BLOCKED', 'P3-1: Schreiber weist Storno mit Verkaufsbeleg ab');
}

// Gutachten VK3 Befund 5 und Fable P3-5: Kaufpreis ab 1.000 € je Stück. Das Feld liest Tausenderpunkt mit Komma wie die Betragsfelder.
{
    const field = { id: 'purchasePrice' };
    assertEqual(readDecimalInput('1.234,58', field), 1234.58, '„1.234,58“ = 1.234,58 €');
    assertEqual(readDecimalInput('1234,58', field), 1234.58, '„1234,58“ = 1.234,58 €');
    assertEqual(readDecimalInput('1.234', field), 1.234, 'Punkt ohne Komma bleibt Dezimalpunkt (Kurse mit drei Nachkommastellen)');
    assert(Number.isNaN(readDecimalInput('1.2.3,4', field)), 'uneindeutige Eingabe bleibt ungültig');
}

// TD-1: Gespeicherter und frisch geprüfter Kurs stehen ohne Chips in der Kopfzeile.
{
    const text = { textContent: '' }, reason = { textContent: '' };
    const doc = { getElementById: id => ({ trancheQuoteText: text, trancheTickerReason: reason })[id] || null };
    const asOf = Date.UTC(2026, 9, 23, 12) / 1000;
    renderQuoteCheck(doc, { status: 'stored', symbol: 'VWCE.DE', price: 144.47, asOf });
    assert(text.textContent.includes('Kurs 144,47 € vom 23.10.2026'), 'Gespeicherter Kurs mit Datum im Kopf');
    assert(!/✓/.test(text.textContent), 'kein grüner Haken ohne frische Prüfung');
    assert(reason.textContent.includes('Zuletzt geholt am 23.10.2026'), 'Kürzelfeld nennt Abrufdatum');
    renderQuoteCheck(doc, { status: 'ok', symbol: 'VWCE.DE', exchange: 'Xetra', price: 145, asOf });
    assert(text.textContent.includes('Kurs 145,00 € vom 23.10.2026'), 'Kursprüfung aktualisiert die Kopfzeile');
    assert(!('priceEstimated' in trancheDetailFigures({ shares: 1, purchasePrice: 1, currentPrice: 1 })), 'P3-3: kein Zweig „Kurs fehlt“');
}

// TD-1b: Ein alter Korrekturtag ohne Werte bleibt als Lücke unter dem Kauf sichtbar.
{
    const tranche = { ...buyTranche('vk3b_corr'), shares: 700, purchaseDate: '2026-10-01' };
    const rows = trancheHistory({ tranche, profileId: MARTIN, records: [], correctedAt: DATE });
    assertEqual(rows.map(row => row.kind).join(), 'buy', 'Altdatum erfindet keinen Korrektureintrag');
    assertEqual(`${rows[0].legacyCorrectionAt} ${rows[0].shares} ${rows[0].amount}`, `${DATE} null null`, 'Altkauf ohne Stücke und Einstand');
    assertEqual(trancheHistory({ tranche, profileId: MARTIN, records: [] }).length, 1, 'ohne Korrektur keine Zeile');
}

// Fable P3-7: Kauf mit Datum in der Zukunft – die Meldung nennt das Datum.
assertEqual(futureBuyMessage('2026-10-24'), 'Der 24.10.2026 liegt in der Zukunft. Einen Kauf trägst du ab seinem Ausführungstag ein.', 'Meldung nennt das Datum');

// Fable P3-8: „Details & Drucken“ und Hinweis lesen den Modus wie der Stand (Feld, sonst `snapshot.plan`), auch bei Belegen vor TRG-1c.
{
    assertEqual(JSON.stringify(confirmedCarrier({ withdrawalMode: `one_carries:${MARTIN}` })), JSON.stringify({ mode: `one_carries:${MARTIN}`, carrierId: MARTIN }),
        'Altbeleg ohne Feld: Modus aus der Momentaufnahme → „Entnahme: Eine Person trägt · Martin“');
    const stored = { mode: `one_carries:${MARTIN}`, carrierId: MARTIN, carrierName: 'Martin', attacked: [{ profileId: PETRA, amount: 10 }] };
    assertEqual(confirmedCarrier({ withdrawalMode: stored.mode, householdWithdrawal: stored }), stored, 'neuer Beleg: Feld gilt');
    assertEqual(confirmedCarrier({ withdrawalMode: 'tax_optimized' }), null, 'Vorgabemodus: keine Zeile');
    const doc = new MockDocument();
    const details = createPlanDetails(doc, { year: 2026, rows: [], destinations: [], carrier: confirmedCarrier({ withdrawalMode: `one_carries:${MARTIN}` }) },
        { type: 'NONE' }, [{ id: MARTIN, name: 'Martin' }, { id: PETRA, name: 'Petra' }]);
    assert(details.text.split('\n').includes('Entnahme: Eine Person trägt · Martin'), `Details & Drucken nennen den Modus (${details.text})`);
}
