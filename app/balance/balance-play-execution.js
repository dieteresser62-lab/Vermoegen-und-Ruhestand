import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { canGenerateExampleExpenses } from '../demo/beispielausgaben.js';
import { PersistenceFacade as P, persistenceStorage } from '../shared/persistence-facade.js';
import { PROBELAUF_STATE_KEY } from '../shared/probelauf-state.js';
import { withAnnualWriteAccess } from '../shared/annual-operation-lock.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';
import { prepareCashRecords, readCashPerson, parseCashInput } from '../profile/profile-cash-update.js';
import { captureProfileData } from '../profile/profile-live-storage.js';
import { PROFILE_CASH_HISTORY_KEY } from '../profile/profile-wealth-history.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { settleTaxYear } from '../../engine/tax-settlement.mjs';
import { syntheticQuote } from '../shared/probelauf-prices.js';
import { recordTrancheCollection } from '../tranches/tranchen-recording.js';
import { CONFIG } from './balance-config.js';
import { HOUSEHOLD_PLAN_KEY } from '../profile/household-plan.js';
import { commitTrancheReconciliation, commitCashPostingConfirmation, projectReconciliationCashStatuses } from '../tranches/tranche-reconciliation.js';

const REGISTRY = 'rs_profiles_v1';
const BATCHES = 'playActionExecutions';
const cents = value => Math.round(value * 100) / 100;
const positive = value => Number.isFinite(value) && value > 0 ? value : 0;
const defaults = {
    aktien: { type: 'aktien_neu', category: 'equity', ticker: 'VWCE.DE', name: 'Spielwert Aktien-ETF', tqf: .3 },
    gold: { type: 'gold', category: 'gold', ticker: '4GLD.DE', name: 'Spielwert Gold', tqf: 0 },
    bonds: { type: 'anleihe', category: 'bonds', ticker: 'IBGS.DE', name: 'Spielwert Anleihen', tqf: 0 },
    geldmarkt: { type: 'geldmarkt', category: 'money_market', ticker: 'XEON.DE', name: 'Spielwert Geldmarkt-ETF', tqf: 0 }
};
const writeKeys = new Set([REGISTRY, 'depot_tranchen', 'profile_wealth_history_lots_v1', 'profile_tagesgeld', PROFILE_CASH_HISTORY_KEY,
    'rs_current_profile', 'rs_active_profile', PROBELAUF_STATE_KEY]);

/** Gemeinsame Cashaufteilung für dargestellte und automatisch eingetragene Anweisungen. */
export function splitPlayLiquidity(input, action, spending, targetLiquidity) {
    if (!input || typeof input.tagesgeld !== 'number' || typeof input.geldmarktEtf !== 'number') return null;
    const monthly = spending?.monatlicheEntnahme;
    const zielTagesgeld = Number.isFinite(monthly) ? monthly * 12 + monthly * 2 : Number.isFinite(targetLiquidity) ? targetLiquidity : 0;
    const outflow = (Array.isArray(action?.quellen) ? action.quellen : [])
        .filter(source => source.kind === 'liquiditaet' || source.source === 'Liquidität').reduce((sum, source) => sum + (source.brutto || 0), 0);
    if (!Number.isFinite(outflow) || outflow <= 0) return null;
    const fromTagesgeld = Math.min(outflow, Math.max(0, input.tagesgeld - zielTagesgeld));
    return { zielTagesgeld, fromTagesgeld, fromGeldmarkt: Math.max(0, outflow - fromTagesgeld), totalOutflow: outflow };
}

export function canExecutePlayAction(controller) {
    return canGenerateExampleExpenses(controller) && P.getPersistenceStatus().activeArea === 'spiel';
}
function requirePlay(controller) {
    if (!canExecutePlayAction(controller)) throw new Error('Anweisungen lassen sich nur im bestätigten aktiven Spielbereich eintragen.');
}
function capture(storage) {
    return Object.fromEntries([...new Set([...Object.keys(captureProfileData(storage)), ...PROFILE_SCOPED_FIXED_KEYS, ...writeKeys, CONFIG.STORAGE.LS_KEY, HOUSEHOLD_PLAN_KEY])].sort()
        .map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw !== null));
}
function assertFresh(prepared, controller, storage) {
    requirePlay(controller);
    if (prepared.date !== localCalendarDate(appNow()) || JSON.stringify(capture(storage)) !== JSON.stringify(prepared.before)) {
        throw new Error('Bestand oder Spielbereich hat sich geändert. Bitte die Anweisung erneut öffnen.');
    }
}
function memory(data) {
    const copy = { ...data };
    return { copy, getItem: key => copy[key] ?? null, setItem: (key, raw) => { copy[key] = String(raw); }, removeItem: key => { delete copy[key]; } };
}
function profileStore(registry, id) {
    const storage = memory({ ...registry.profiles[id].data, [REGISTRY]: JSON.stringify(registry), rs_current_profile: id, rs_active_profile: id });
    const save = () => {
        const next = JSON.parse(storage.getItem(REGISTRY));
        for (const key of PROFILE_SCOPED_FIXED_KEYS) {
            const raw = storage.getItem(key);
            if (raw === null) delete next.profiles[id].data[key]; else next.profiles[id].data[key] = raw;
        }
        storage.setItem(REGISTRY, JSON.stringify(next)); return true;
    };
    const persistence = { async replaceRecordsTransactional(records, options) {
        for (const key of writeKeys) if (options.allowKey(key)) {
            if (records[key] === undefined) storage.removeItem(key); else storage.setItem(key, records[key]);
        }
        return { ok: true };
    } };
    return { storage, options: { storage, saveCurrentProfile: save, getCurrentProfileId: () => id, getActiveProfileId: () => id,
        flush: async () => true, persistence }, save };
}
function updateCash(data, value, date) {
    const changes = prepareCashRecords(data, cents(value), date);
    if (changes[PROFILE_CASH_HISTORY_KEY]) {
        const history = JSON.parse(changes[PROFILE_CASH_HISTORY_KEY]);
        const entry = history.entries.find(item => item.date === date);
        if (entry) entry.source = 'spielwert';
        changes[PROFILE_CASH_HISTORY_KEY] = JSON.stringify(history);
    }
    Object.assign(data, changes);
}
function finalRecords(before, registry, activeId) {
    const records = Object.fromEntries(Object.entries(before).filter(([key]) => writeKeys.has(key)));
    records[REGISTRY] = JSON.stringify(registry);
    for (const key of writeKeys) if (PROFILE_SCOPED_FIXED_KEYS.includes(key)) {
        if (registry.profiles[activeId].data[key] === undefined) delete records[key];
        else records[key] = registry.profiles[activeId].data[key];
    }
    return records;
}

/** Nur private Stringrecords: dieselben Verkaufs-, Kauf- und Cashwriter wie im Manager. */
export async function preparePlayAction({ entries, controller, storage = persistenceStorage, id = globalThis.crypto?.randomUUID?.() || `spiel-${Date.now()}` }) {
    requirePlay(controller);
    const before = capture(storage), date = localCalendarDate(appNow());
    const activeId = storage.getItem('rs_current_profile');
    let registry = JSON.parse(storage.getItem(REGISTRY));
    if (!registry?.profiles?.[activeId] || storage.getItem('rs_active_profile') !== activeId) throw new Error('Profilbestand nicht verfügbar.');
    registry.profiles[activeId].data = captureProfileData(storage);
    const members = Object.keys(registry.profiles).filter(key => registry.profiles[key].meta.belongsToHousehold !== false).sort();
    const ids = entries.map(entry => entry.profileId).sort();
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(key => !registry.profiles[key])
        || (ids.length > 1 && JSON.stringify(ids) !== JSON.stringify(members))) throw new Error('Anweisung passt nicht mehr zum Haushalt.');
    if (pendingPlayActions(registry).length) throw new Error('Bitte zuerst die ausstehende Gutschrift bestätigen.');
    const allLots = ids.flatMap(key => normalizeTrancheCollection(JSON.parse(registry.profiles[key].data.depot_tranchen || '[]'), { mode: 'persisted' }));
    const people = [], lines = [];
    for (const entry of entries) {
        const profileId = entry.profileId, data = registry.profiles[profileId].data;
        const name = registry.profiles[profileId].meta.name;
        const person = readCashPerson(profileId, name, data);
        if (person.error || person.value === null) throw new Error(`${name}: Tagesgeld-Stand fehlt oder ist beschädigt.`);
        const original = normalizeTrancheCollection(JSON.parse(data.depot_tranchen || '[]'), { mode: 'persisted' });
        const reserved = new Map(), sales = [];
        const addSale = (lot, gross, taxes = null) => {
            const available = lot.marketValue - (reserved.get(lot.trancheId) || 0);
            if (gross > available + .01) throw new Error(`${name}: Verkauf übersteigt den Tranchenbestand.`);
            const amount = Math.min(gross, available);
            if (amount <= 0) return;
            reserved.set(lot.trancheId, (reserved.get(lot.trancheId) || 0) + amount);
            sales.push({ lot, gross: amount, taxes });
        };
        const sellMoneyMarket = amount => {
            const lots = original.filter(lot => lot.category === 'money_market').sort((a, b) =>
                (1 - a.purchasePrice / a.currentPrice) - (1 - b.purchasePrice / b.currentPrice)
                || a.purchaseDate.localeCompare(b.purchaseDate) || a.trancheId.localeCompare(b.trancheId));
            for (const lot of lots) {
                const part = Math.min(amount, lot.marketValue - (reserved.get(lot.trancheId) || 0));
                if (part > 0) { addSale(lot, part); amount -= part; }
            }
            if (amount > .01) throw new Error(`${name}: Geldmarktbestand reicht nicht aus.`);
        };
        for (const q of entry.action.quellen || []) {
            if (!positive(q.brutto)) continue;
            if (q.kind === 'liquiditaet' || q.source === 'Liquidität') {
                if (!entry.cashSplit) throw new Error('Aufteilung zwischen Tagesgeld und Geldmarkt fehlt.');
                continue;
            }
            const lot = original.find(lot => lot.trancheId === q.trancheId
                || q.sourceProfileId === profileId && `${profileId}:${lot.trancheId}` === q.trancheId);
            if (q.sourceProfileId && q.sourceProfileId !== profileId) throw new Error('Verkauf gehört zu einer anderen Person.');
            if (lot) addSale(lot, q.brutto, Number.isFinite(q.steuer) ? q.steuer : null);
            else if (q.kind === 'geldmarkt') sellMoneyMarket(q.brutto);
            else throw new Error(`${name}: Konkrete Verkaufstranche fehlt. Bitte den Bestand in Vermögen prüfen.`);
        }
        if (positive(entry.cashSplit?.fromGeldmarkt)) sellMoneyMarket(entry.cashSplit.fromGeldmarkt);
        // Konkrete Balance-Verkäufe behalten ihre finale Steuer. Zusätzliche
        // Geldmarktverkäufe nutzen die bestehende Settlementrechnung auf allen Quellen.
        const taxable = sale => sale.gross * (1 - sale.lot.purchasePrice / sale.lot.currentPrice) * (sale.lot.taxExempt ? 0 : 1 - sale.lot.tqf);
        const plannedTaxes = sales.reduce((sum, sale) => sum + (sale.taxes ?? 0), 0);
        const rawAggregate = { sumTaxableAfterTqfSigned: sales.reduce((sum, sale) => sum + taxable(sale), 0) };
        const balanceState = JSON.parse(data[CONFIG.STORAGE.LS_KEY] || '{}');
        const computed = settleTaxYear({ rawAggregate, sparerPauschbetrag: entry.input?.sparerPauschbetrag,
            kirchensteuerSatz: entry.input?.kirchensteuerSatz,
            taxStatePrev: { lossCarry: entry.action.taxSettlement?.lossCarryStart ?? balanceState.lastState?.taxState?.lossCarry ?? 0 } }).taxDue;
        let extraTax = Math.max(0, computed - plannedTaxes);
        for (const sale of sales.filter(sale => sale.taxes === null)) { sale.taxes = Math.min(extraTax, sale.gross); extraTax -= sale.taxes; }
        const saleIds = [], purchases = [];
        let net = 0;
        for (const [index, sale] of sales.entries()) {
            const context = profileStore(registry, profileId), actionId = `${id}-${profileId}-${index + 1}`;
            const result = await commitTrancheReconciliation({ profileId, action: { actionId, profileId,
                trancheId: sale.lot.trancheId, executedAt: date, grossProceeds: sale.gross,
                sharesSold: sale.gross / sale.lot.currentPrice, fees: 0, taxes: sale.taxes, source: 'spielwert' } }, context.options);
            registry = structuredClone(result.registry); saleIds.push(actionId); net += result.preview.action.netProceeds;
            lines.push({ profileId, name, kind: 'sale', asset: sale.lot.name, amount: sale.gross, taxes: sale.taxes,
                net: result.preview.action.netProceeds, price: sale.lot.currentPrice });
        }
        for (const [key, fallback] of Object.entries(defaults)) {
            const amount = positive(entry.action.verwendungen?.[key]);
            if (!amount) continue;
            const template = allLots.find(lot => lot.type === fallback.type) || allLots.find(lot => lot.category === fallback.category);
            const quote = template ? { price: template.currentPrice, asOf: template.asOf } : syntheticQuote(fallback.ticker, date);
            const lot = { ...(template || fallback), trancheId: `${id}-${profileId}-buy-${key}`, schemaVersion: 2,
                type: fallback.type, category: fallback.category, shares: amount / quote.price, currentPrice: quote.price,
                purchasePrice: quote.price, purchaseDate: date, ...(quote.asOf ? { asOf: quote.asOf } : {}),
                taxExempt: key === 'gold' && data.profile_gold_steuerfrei === 'true',
                source: 'spielwert', notes: 'Spielwert · Anweisung als ausgeführt eingetragen' };
            purchases.push(lot);
            lines.push({ profileId, name, kind: 'buy', asset: lot.name, amount, price: quote.price, synthetic: !template });
        }
        const purchaseTotal = lines.filter(line => line.profileId === profileId && line.kind === 'buy').reduce((sum, line) => sum + line.amount, 0);
        const finalCash = cents(person.value + net - purchaseTotal);
        if (finalCash < 0) throw new Error(`${name}: Tagesgeld reicht nach den Buchungen nicht aus.`);
        if (purchases.length) {
            const context = profileStore(registry, profileId);
            const current = JSON.parse(context.storage.getItem('depot_tranchen') || '[]');
            recordTrancheCollection([...current, ...purchases], context.storage, { previousTranches: current, date });
            context.save(); registry = JSON.parse(context.storage.getItem(REGISTRY));
        }
        if (!saleIds.length && purchaseTotal) updateCash(registry.profiles[profileId].data, finalCash, date);
        people.push({ profileId, name, saleIds, net: cents(net), purchaseTotal: cents(purchaseTotal), cashBefore: person.value, finalCash });
    }
    if (!lines.length) throw new Error('Die Anweisung enthält keine Buchungen.');
    const batch = { id, source: 'spielwert', date, people };
    registry[BATCHES] = [...(registry[BATCHES] || []), batch];
    return { before, date, activeId, batch, lines, records: finalRecords(before, registry, activeId) };
}

export function pendingPlayActions(registry = JSON.parse(persistenceStorage.getItem(REGISTRY) || '{}')) {
    const statuses = projectReconciliationCashStatuses(registry);
    return (registry[BATCHES] || []).filter(batch => batch.source === 'spielwert' && batch.people.some(person =>
        person.saleIds.some(id => statuses.some(status => status.targetActionId === id && status.canConfirm))));
}

export async function commitPlayAction(prepared, { controller, storage = persistenceStorage, navigationOperation, validate = () => {} } = {}) {
    return withAnnualWriteAccess(async () => {
        assertFresh(prepared, controller, storage); validate();
        await P.replaceRecordsTransactional(prepared.records, { probelaufDomainWrite: true, navigationOperation,
            allowKey: key => writeKeys.has(key), expectedRecords: Object.fromEntries(Object.entries(prepared.before).filter(([key]) => writeKeys.has(key))),
            postValidate: () => { requirePlay(controller); return true; } });
        return prepared.batch;
    });
}

export async function preparePlayCredit(batchId, { controller, storage = persistenceStorage, values = {} } = {}) {
    requirePlay(controller);
    const before = capture(storage), date = localCalendarDate(appNow()), activeId = storage.getItem('rs_current_profile');
    let registry = JSON.parse(storage.getItem(REGISTRY));
    registry.profiles[activeId].data = captureProfileData(storage);
    const batch = pendingPlayActions(registry).find(batch => batch.id === batchId);
    if (!batch) throw new Error('Keine ausstehende Spielgutschrift vorhanden.');
    const statuses = projectReconciliationCashStatuses(registry);
    for (const person of batch.people) {
        const pendingIds = person.saleIds.filter(id => statuses.some(status => status.targetActionId === id && status.canConfirm));
        const cash = readCashPerson(person.profileId, person.name, registry.profiles[person.profileId].data);
        if (pendingIds.length && (cash.error || cash.value !== person.cashBefore)) throw new Error(`${person.name}: Tagesgeld wurde inzwischen geändert. Bitte den Cashstatus in Vermögen prüfen.`);
        if (pendingIds.length !== person.saleIds.length) throw new Error('Eine Gutschrift wurde bereits außerhalb dieses Dialogs bestätigt. Bitte den Cashstatus in Vermögen prüfen.');
        const value = parseCashInput(values[person.profileId] ?? person.finalCash);
        for (const targetActionId of pendingIds) {
            const context = profileStore(registry, person.profileId);
            const result = await commitCashPostingConfirmation({ profileId: person.profileId, targetActionId,
                cashBalanceAfterPostingEur: value, confirmedAt: appNow().toISOString() }, context.options);
            registry = structuredClone(result.registry);
        }
        if (pendingIds.length) {
            const history = JSON.parse(registry.profiles[person.profileId].data[PROFILE_CASH_HISTORY_KEY] || 'null');
            const historyEntry = history?.entries.find(item => item.date === date);
            if (historyEntry) { historyEntry.source = 'spielwert'; registry.profiles[person.profileId].data[PROFILE_CASH_HISTORY_KEY] = JSON.stringify(history); }
        }
    }
    return { before, date, activeId, batch, records: finalRecords(before, registry, activeId) };
}
