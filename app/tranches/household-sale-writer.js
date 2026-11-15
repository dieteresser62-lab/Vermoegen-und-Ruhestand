// FR-79 Ergänzung 1 Punkt 9 (Regelprüfung VKR Abschnitt 3): ein transaktionaler Schreiber für mehrere Personen, für den Live- und
// den Spielbereich. Die vorhandenen Verkaufs- und Cashwriter laufen je Person auf einer privaten Kopie (ohne Profilwechsel);
// danach schreibt ein einziger Commit Verkaufsbelege, Tranchen, Vermögensverlauf, Tagesgeld und Cashverlauf der betroffenen
// Personen. Vorher: Jahresbesitz (Sperre), Flush und Vergleich mit dem erwarteten Ausgangsstand. Doppelschutz über `actionId`.
import { appNow, localCalendarDate } from '../shared/app-clock.js';
import { PersistenceFacade, persistenceStorage } from '../shared/persistence-facade.js';
import { withAnnualWriteAccess } from '../shared/annual-operation-lock.js';
import { PROFILE_SCOPED_FIXED_KEYS } from '../profile/profile-state.js';
import { prepareCashRecords, readCashPerson } from '../profile/profile-cash-update.js';
import { captureProfileData } from '../profile/profile-live-storage.js';
import { PROFILE_CASH_HISTORY_KEY, assertCashHistory } from '../profile/profile-wealth-history.js';
import { ANNUAL_PLAN_RESOLUTIONS_KEY, buildAnnualPlanResolutions } from '../profile/annual-plan-resolutions.js';
import { CONFIG } from '../balance/balance-config.js';
import { HOUSEHOLD_PLAN_KEY } from '../profile/household-plan.js';
import { commitTrancheReconciliation, commitCashPostingConfirmation, readReconciliationHistory, projectBuyCashStatuses, TrancheReconciliationError, registryWithAuditRecord,
    RECONCILIATION_EVENT_TYPES } from './tranche-reconciliation.js';
import { trancheDeletion, cancelledBuyDebit, correctedTranche } from './tranche-detail-model.js';
import { loadTranchesFromStorage, normalizeTranches, calculateTrancheDerivedValues } from './tranchen-manager-state.js';
import { recordTrancheCollection } from './tranchen-recording.js';
import { PROFILE_WEALTH_LOTS_KEY, correctWealthLot } from '../profile/profile-wealth-history.js';

export const HOUSEHOLD_REGISTRY_KEY = 'rs_profiles_v1';
/** Schlüssel des Verkaufsablaufs. Der Spielbereich ergänzt Profilzeiger und Probelaufzustand. */
export const SALE_FLOW_WRITE_KEYS = Object.freeze([HOUSEHOLD_REGISTRY_KEY, 'depot_tranchen', 'profile_wealth_history_lots_v1', 'profile_tagesgeld',
    PROFILE_CASH_HISTORY_KEY, ANNUAL_PLAN_RESOLUTIONS_KEY]);
const cents = value => Math.round(value * 100) / 100;

/** Ausgangsstand aller Schlüssel, die ein Haushaltscommit lesen oder schreiben kann. @param {any} storage @param {Iterable<string>} writeKeys */
export function captureHouseholdRecords(storage, writeKeys) {
    return Object.fromEntries([...new Set([...Object.keys(captureProfileData(storage)), ...PROFILE_SCOPED_FIXED_KEYS, ...writeKeys,
        CONFIG.STORAGE.LS_KEY, HOUSEHOLD_PLAN_KEY])].sort().map(key => [key, storage.getItem(key)]).filter(([, raw]) => raw !== null));
}

/** @param {Record<string, string>} data */
export function memoryStorage(data) {
    const copy = { ...data };
    return { copy, getItem: (/** @type {string} */ key) => copy[key] ?? null, setItem: (/** @type {string} */ key, /** @type {unknown} */ raw) => { copy[key] = String(raw); },
        removeItem: (/** @type {string} */ key) => { delete copy[key]; } };
}

/** Private Kopie einer Person für die vorhandenen Writer: Profilzeiger zeigen auf sie, Speichern schreibt nur in die Kopie.
 * @param {any} registry @param {string} id @param {Iterable<string>} writeKeys */
export function householdProfileStore(registry, id, writeKeys) {
    const keys = [...writeKeys];
    const storage = memoryStorage({ ...registry.profiles[id].data, [HOUSEHOLD_REGISTRY_KEY]: JSON.stringify(registry), rs_current_profile: id, rs_active_profile: id });
    const save = () => {
        const next = JSON.parse(/** @type {string} */ (storage.getItem(HOUSEHOLD_REGISTRY_KEY)));
        for (const key of PROFILE_SCOPED_FIXED_KEYS) {
            const raw = storage.getItem(key);
            if (raw === null) delete next.profiles[id].data[key]; else next.profiles[id].data[key] = raw;
        }
        storage.setItem(HOUSEHOLD_REGISTRY_KEY, JSON.stringify(next)); return true;
    };
    const persistence = { async replaceRecordsTransactional(/** @type {Record<string, string>} */ records, /** @type {{allowKey: (key: string) => boolean}} */ options) {
        for (const key of new Set([...keys, ...Object.keys(records)])) if (options.allowKey(key)) {
            if (records[key] === undefined) storage.removeItem(key); else storage.setItem(key, records[key]);
        }
        return { ok: true };
    } };
    return { storage, options: { storage, saveCurrentProfile: save, getCurrentProfileId: () => id, getActiveProfileId: () => id,
        flush: async () => true, persistence }, save };
}

/** Haushaltsregistry mit den Livewerten der aktiven Person. @param {any} storage */
export function openHouseholdRegistry(storage) {
    const activeId = storage.getItem('rs_current_profile');
    const registry = JSON.parse(storage.getItem(HOUSEHOLD_REGISTRY_KEY) || 'null');
    if (!registry?.profiles?.[activeId] || storage.getItem('rs_active_profile') !== activeId) throw new Error('Profilbestand nicht verfügbar.');
    registry.profiles[activeId].data = captureProfileData(storage);
    return { activeId, registry };
}

/** Zielrecords: alle Schreibschlüssel des Ausgangsstands, die Registry und die Livekopie der aktiven Person.
 * @param {Record<string, string>} before @param {any} registry @param {string} activeId @param {Iterable<string>} writeKeys @param {Record<string, string>} [extra] */
export function householdRecords(before, registry, activeId, writeKeys, extra = {}) {
    const keys = new Set(writeKeys);
    const records = Object.fromEntries(Object.entries(before).filter(([key]) => keys.has(key)));
    records[HOUSEHOLD_REGISTRY_KEY] = JSON.stringify(registry);
    for (const key of keys) if (PROFILE_SCOPED_FIXED_KEYS.includes(key)) {
        if (registry.profiles[activeId].data[key] === undefined) delete records[key];
        else records[key] = registry.profiles[activeId].data[key];
    }
    return { ...records, ...extra };
}

/** VK-3d P2: Passt der gespeicherte Betrag nicht zum letzten Stand im Tagesgeldverlauf, gilt vor einer ausdrücklich eingetragenen
 * Tagesgeld-Angabe (Gutschrift, Abbuchung) der Verlauf als bisheriger Stand. Die Eingabe ist der neue Stand; der Widerspruch
 * blockiert sie nicht. Ein unlesbarer Verlauf bleibt ein Fehler. Ändert `data` nur bei einem Widerspruch.
 * @param {Record<string, string>} data */
export function alignCashWithHistory(data) {
    if (!readCashPerson('', '', data).error || !data[PROFILE_CASH_HISTORY_KEY]) return;
    let history;
    try { history = assertCashHistory(JSON.parse(data[PROFILE_CASH_HISTORY_KEY])); } catch { return; }
    data.profile_tagesgeld = String(history.entries.at(-1)?.value ?? history.baselineValue);
}

/** Tagesgeld einer Person in der Registry setzen (Cashverlauf wie im Manager). @param {Record<string, string>} data @param {number} value @param {string} date @param {string|null} [source] */
export function setHouseholdCash(data, value, date, source = null) {
    alignCashWithHistory(data);
    const changes = prepareCashRecords(data, cents(value), date);
    if (source && changes[PROFILE_CASH_HISTORY_KEY]) {
        const history = JSON.parse(changes[PROFILE_CASH_HISTORY_KEY]);
        const entry = history.entries.find((/** @type {{date: string}} */ item) => item.date === date);
        if (entry) entry.source = source;
        changes[PROFILE_CASH_HISTORY_KEY] = JSON.stringify(history);
    }
    Object.assign(data, changes);
}

/** Ein Verkauf einer Person auf der privaten Kopie (vorhandener Verkaufswriter). @param {any} registry @param {{profileId: string, action: any}} sale @param {Iterable<string>} writeKeys */
export async function applyHouseholdSale(registry, { profileId, action }, writeKeys) {
    const context = householdProfileStore(registry, profileId, writeKeys);
    const result = await commitTrancheReconciliation({ profileId, action }, context.options);
    return { registry: result.status === 'duplicate' ? registry : structuredClone(/** @type {any} */ (result).registry), result };
}

/** Bestätigte Gutschrift zu einem offenen Verkauf auf der privaten Kopie (vorhandener Cashwriter).
 * @param {any} registry @param {{profileId: string, targetActionId: string, value: number, confirmedAt: string}} credit @param {Iterable<string>} writeKeys */
export async function applyHouseholdCredit(registry, credit, writeKeys) {
    const context = householdProfileStore(registry, credit.profileId, writeKeys);
    const result = await commitCashPostingConfirmation({ profileId: credit.profileId, targetActionId: credit.targetActionId,
        cashBalanceAfterPostingEur: credit.value, confirmedAt: credit.confirmedAt }, context.options);
    return { registry: result.status === 'duplicate' ? registry : structuredClone(result.registry), result };
}

/** VK-3c (Fable P3-3, Gemini Befund 1): Kennung mit Folgezähler (`~r2`) auf höchstens 128 Zeichen; gekürzt wird vor dem Zähler, damit er
 * auch bei sehr langer Ordernummer erhalten bleibt. @param {string} id @param {string} counter */
const idWithCounter = (id, counter) => `${id.slice(0, 128 - counter.length)}${counter}`;

/** Stornokennung zu einem Kaufbeleg: `buy-cancel-<Kennung>`, Folgezähler des Kaufs am Ende. @param {string} buyId */
function buyCancellationId(buyId) {
    const counter = /~r\d+$/.exec(buyId)?.[0] || '';
    return idWithCounter(`buy-cancel-${counter ? buyId.slice(0, -counter.length) : buyId}`, counter);
}

/** VK-3d P3 (VK-1b P3-4): Kennung einer Abrechnung mit Ordernummer der Bank (`bankOrder`). Die Bank vergibt für Teilausführungen dieselbe
 * Ordernummer; eine andere Abrechnung
 * unter derselben Kennung (andere Tranche, Stück, Beträge) bekommt die nächste Folgekennung (`~t2`, `~t3` …). Steht unter einer Kennung
 * dieselbe Abrechnung, bleibt die Kennung: Der Verkaufswriter meldet dann `duplicate` oder bei anderem Kontostand einen Konflikt.
 * Platz für den Tranchenzähler (`~2`) bleibt frei. @param {any[]} history @param {{actionId: string, executedAt: string, parts: any[]}} sale */
function saleSettlementId(history, sale) {
    const same = (/** @type {number} */ a, /** @type {number} */ b) => Math.abs(Number(a) - Number(b)) < 1e-6;
    const settled = (/** @type {any} */ record, /** @type {any} */ part) => record.trancheId === part.trancheId && record.executedAt === sale.executedAt
        && same(record.actual?.sharesSold, part.shares) && same(record.actual?.grossProceeds, part.gross) && same(record.actual?.fees, part.fees)
        && same(record.actual?.taxes ?? 0, part.taxes ?? 0);
    for (let round = 1; ; round++) {
        const counter = round === 1 ? '' : `~t${round}`;
        const base = round === 1 ? sale.actionId : `${sale.actionId.slice(0, 124 - counter.length)}${counter}`;
        const existing = sale.parts.map((_, index) => history.find(record => record.eventType === RECONCILIATION_EVENT_TYPES.SALE
            && record.actionId === (index === 0 ? base : `${base}~${index + 1}`)));
        if (existing.every(record => !record) || existing.some((record, index) => record && settled(record, sale.parts[index]))) return base;
    }
}

/** VK-2: Vergleichbare Felder eines Kaufbelegs (Doppelschutz über `actionId`, auch Abbuchungsstand). @param {any} record */
const comparableBuy = record => JSON.stringify({ profileId: record.profileId, trancheId: record.trancheId, executedAt: record.executedAt,
    shares: record.actual?.sharesBought, gross: record.actual?.grossAmount, fees: record.actual?.fees, cashStatus: record.cashStatus ?? null,
    cash: record.cashStatus === 'confirmed_already_reflected' ? record.cashBalanceAfterPostingEur ?? null : null });

/** VK-2: Ein Kauf einer Person auf der privaten Kopie: neue Tranche über den vorhandenen Erfassungsweg (`recordTrancheCollection`,
 * Vermögensverlauf inklusive) und Beleg `buy_reconciled` im Abgleich. Gleiche Wiederholung ist `duplicate`, abweichende ein Konflikt.
 * @param {any} registry @param {{profileId: string, record: any, tranche: any, date: string}} buy @param {Iterable<string>} writeKeys */
export function applyHouseholdBuy(registry, { profileId, record, tranche, date }, writeKeys) {
    const history = readReconciliationHistory(registry);
    const cancelled = new Set(history.filter(item => item.eventType === 'buy_cancelled').map(item => item.targetActionId));
    // VK-3b (Gutachten VK3-FABLE P2-1, Nachtrag 1): Ein vollständig stornierter Kaufbeleg blockiert seine Kennung nicht. Der Wiedereintrag
    // bekommt die nächste freie Folgekennung (`~r2`, `~r3` …); ein nicht stornierter Beleg mit derselben Kennung bleibt ein Konflikt.
    for (let round = 1; ; round++) {
        const actionId = round === 1 ? record.actionId : idWithCounter(record.actionId, `~r${round}`);
        const existing = history.find(item => item.actionId === actionId);
        if (!existing) { if (round > 1) record = { ...record, actionId }; break; }
        if (existing.eventType === 'buy_reconciled' && cancelled.has(actionId)) continue;
        if (existing.eventType === 'buy_reconciled' && comparableBuy(existing) === comparableBuy(record)) return { registry, result: { status: 'duplicate', actionId } };
        throw new TrancheReconciliationError('RECONCILIATION_ACTION_CONFLICT', `actionId ${actionId} wurde bereits für eine andere Ausführung verwendet.`, { field: 'actionId' });
    }
    const context = householdProfileStore(registry, profileId, writeKeys);
    const loaded = loadTranchesFromStorage(context.storage);
    if (loaded.status === 'corrupt' || loaded.status === 'unavailable') {
        throw new TrancheReconciliationError('RECONCILIATION_TRANCHE_STORAGE_INVALID', 'Der Tranchenbestand ist beschädigt oder momentan nicht lesbar.');
    }
    const previous = loaded.tranches || [];
    if (previous.some((/** @type {any} */ item) => item.trancheId === tranche.trancheId)) {
        throw new TrancheReconciliationError('RECONCILIATION_ACTION_CONFLICT', 'Die neue Tranche gibt es schon.', { field: 'trancheId' });
    }
    const next = normalizeTranches([...previous, calculateTrancheDerivedValues(tranche)]);
    recordTrancheCollection(next, context.storage, { previousTranches: previous, date });
    context.save();
    const nextRegistry = registryWithAuditRecord(context.storage.getItem(HOUSEHOLD_REGISTRY_KEY), record);
    nextRegistry.profiles[profileId].data[PROFILE_WEALTH_LOTS_KEY] = context.storage.getItem(PROFILE_WEALTH_LOTS_KEY);
    // VK-2b P2-1: Der neue Beleg wird geprüft wie beim Lesen; ein unlesbarer Verlauf kann so nicht entstehen.
    readReconciliationHistory(nextRegistry);
    return { registry: nextRegistry, result: { status: 'applied', actionId: record.actionId } };
}

/** Tranche im Detail über den gemeinsamen Schreiber. Nur eine geänderte Stückzahl über `correction` hängt einen Verlaufseintrag an.
 * Der Vermögensverlauf führt weiter `manualCorrectionAt`. `cancelBuy` nimmt den Kauf ohne Verkaufsbeleg zurück.
 * VK-3b: Der Schreiber prüft die Löschsperre selbst (P3-1) und setzt bei bestätigter Abbuchung auf Wunsch das Tagesgeld zurück (P2-3,
 * `cashValue` = Tagesgeld jetzt; ohne bestätigte Abbuchung abgewiesen).
 * @param {{storage?: any, now?: Date, profileId: string, tranche?: any, correction?: boolean, correctionReason?: 'depotauszug'|'split', remove?: string|null, cancelBuy?: string|null, cashValue?: number|null}} request */
export async function prepareTrancheDetailWrite({ storage = persistenceStorage, now = appNow(), profileId, tranche = null, correction = false, correctionReason = 'depotauszug', remove = null, cancelBuy = null,
    cashValue = null }) {
    const writeKeys = SALE_FLOW_WRITE_KEYS;
    const before = captureHouseholdRecords(storage, writeKeys), date = localCalendarDate(now);
    let { activeId, registry } = openHouseholdRegistry(storage);
    if (!registry.profiles[profileId]) throw new Error('Die Person gehört nicht mehr zum Bestand.');
    let debit = null;
    if (remove) {
        const records = [...readReconciliationHistory(registry)];
        const deletion = trancheDeletion({ trancheId: remove }, profileId, records);
        if (!deletion.allowed) throw Object.assign(new Error(deletion.reason), { code: 'TRANCHE_DELETE_BLOCKED' });
        if ((deletion.cancelBuy || null) !== (cancelBuy || null)) throw Object.assign(new Error('Der Kaufbeleg passt nicht zur Tranche.'), { code: 'HOUSEHOLD_WRITE_STALE' });
        debit = cancelledBuyDebit(records, [...projectBuyCashStatuses(registry, profileId)], cancelBuy);
    }
    if (cashValue !== null && (!remove || !debit?.confirmed || !(Number.isFinite(cashValue) && cashValue >= 0))) {
        throw Object.assign(new Error('Das Tagesgeld lässt sich nur nach einer bestätigten Abbuchung zurücksetzen.'), { code: 'TRANCHE_CASH_INVALID' });
    }
    const context = householdProfileStore(registry, profileId, writeKeys);
    const loaded = loadTranchesFromStorage(context.storage);
    if (loaded.status === 'corrupt' || loaded.status === 'unavailable') {
        throw new TrancheReconciliationError('RECONCILIATION_TRANCHE_STORAGE_INVALID', 'Der Tranchenbestand ist beschädigt oder momentan nicht lesbar.');
    }
    const previous = loaded.tranches || [];
    const targetId = remove || tranche?.trancheId;
    const original = previous.find((/** @type {any} */ item) => item.trancheId === targetId);
    if (!original) throw Object.assign(new Error('Die Tranche gibt es nicht mehr.'), { code: 'HOUSEHOLD_WRITE_STALE' });
    const changedShares = correction && !remove && tranche.shares !== original.shares;
    if (!remove) {
        // Die bestätigte Liste besitzt der Schreiber, nicht das Formular oder dessen Vorschau.
        tranche = { ...tranche, correctionHistory: original.correctionHistory || [] };
        if (original.legacyCorrectionAt) tranche.legacyCorrectionAt = original.legacyCorrectionAt;
        if (changedShares) {
            if (!['depotauszug', 'split'].includes(correctionReason)) throw new Error('Bitte den Grund der Stückkorrektur wählen.');
            tranche.purchasePrice = correctedTranche(original, tranche.shares, correctionReason).purchasePrice;
            const oldDate = JSON.parse(context.storage.getItem(PROFILE_WEALTH_LOTS_KEY) || 'null')?.lots?.[targetId]?.manualCorrectionAt;
            if (!tranche.correctionHistory.length && oldDate) tranche.legacyCorrectionAt = oldDate;
            tranche = { ...tranche, correctionHistory: [...tranche.correctionHistory, { at: now.toISOString(),
                sharesBefore: original.shares, sharesAfter: tranche.shares, purchasePriceBefore: original.purchasePrice,
                purchasePriceAfter: tranche.purchasePrice, reason: correctionReason }] };
        }
    }
    const next = remove ? previous.filter((/** @type {any} */ item) => item.trancheId !== remove)
        : normalizeTranches(previous.map((/** @type {any} */ item) => item.trancheId === targetId ? calculateTrancheDerivedValues(tranche) : item));
    recordTrancheCollection(next, context.storage, { previousTranches: previous, date });
    const lots = JSON.parse(/** @type {string} */ (context.storage.getItem(PROFILE_WEALTH_LOTS_KEY)));
    const kind = remove && cancelBuy ? 'discard' : changedShares ? 'correct' : null;
    if (kind) {
        const corrected = correctWealthLot(lots, next, /** @type {string} */ (targetId), kind, date, { allowMissingPurchaseDate: kind === 'correct' });
        if (corrected) context.storage.setItem(PROFILE_WEALTH_LOTS_KEY, JSON.stringify(corrected));
    }
    context.save();
    let nextRegistry = JSON.parse(/** @type {string} */ (context.storage.getItem(HOUSEHOLD_REGISTRY_KEY)));
    if (remove && cancelBuy) {
        nextRegistry = registryWithAuditRecord(nextRegistry, { schemaVersion: 1, eventType: 'buy_cancelled', actionId: buyCancellationId(cancelBuy),
            profileId, trancheId: remove, targetActionId: cancelBuy, cancelledAt: now.toISOString() });
        readReconciliationHistory(nextRegistry);
    }
    nextRegistry.profiles[profileId].data[PROFILE_WEALTH_LOTS_KEY] = context.storage.getItem(PROFILE_WEALTH_LOTS_KEY);
    // Tagesgeld zurücksetzen wie im Gutschrift-Schritt (Betrag und Tagesgeldverlauf über denselben Commit).
    if (cashValue !== null) setHouseholdCash(nextRegistry.profiles[profileId].data, cashValue, date);
    return { before, date, activeId, results: [], unchanged: false, records: householdRecords(before, nextRegistry, activeId, writeKeys) };
}

/** Ein Commit: Sperre, Frischeprüfung, transaktionales Ersetzen mit erwartetem Ausgangsstand.
 * @param {{before: Record<string, string>, records: Record<string, string>, date: string}} prepared
 * @param {{storage?: any, writeKeys: Iterable<string>, navigationOperation?: any, validate?: () => void, probelaufDomainWrite?: boolean,
 * assertFresh?: (prepared: any) => void, postValidate?: () => boolean}} options */
export async function commitHouseholdRecords(prepared, { storage = persistenceStorage, writeKeys, navigationOperation, validate = () => {},
    probelaufDomainWrite = true, assertFresh, postValidate = () => true }) {
    const keys = new Set(writeKeys);
    return withAnnualWriteAccess(async () => {
        await PersistenceFacade.flush?.();
        (assertFresh || (() => {
            if (prepared.date !== localCalendarDate(appNow()) || JSON.stringify(captureHouseholdRecords(storage, keys)) !== JSON.stringify(prepared.before)) {
                throw Object.assign(new Error('Der Bestand hat sich seit dem Öffnen geändert. Bitte den Schritt erneut öffnen.'), { code: 'HOUSEHOLD_WRITE_STALE' });
            }
        }))(prepared);
        validate();
        await PersistenceFacade.replaceRecordsTransactional(prepared.records, { probelaufDomainWrite, navigationOperation,
            allowKey: (/** @type {string} */ key) => keys.has(key),
            expectedRecords: Object.fromEntries(Object.entries(prepared.before).filter(([key]) => keys.has(key))), postValidate });
        return prepared;
    });
}

/**
 * Vorbereitung des Verkaufsablaufs (Live und Spielbereich): Verkäufe (eine Abrechnung, je Tranche ein Beleg), sofortige Gutschrift
 * („Schon da“), Bestätigungen offener Gutschriften und Entscheidungen zum Plan, alles für einen Commit.
 * @param {{storage?: any, now?: Date, sales?: {profileId: string, actionId: string, bankOrder?: boolean, executedAt: string, parts: {trancheId: string, shares: number, gross: number, fees: number, taxes: number}[],
 * recommendation?: any, cashValue?: number|null}[], credits?: {profileId: string, targetActionIds: string[], value: number}[],
 * resolution?: {year: number, ids: string[], line?: {key: string, decision: string|null, reason?: string}, lines?: {key: string, decision: string|null, reason?: string}[],
 * keepCash?: boolean}|null, buys?: {profileId: string, actionId: string, executedAt: string, assetClass: string, tranche: any, shares: number, gross: number, fees: number, cashValue?: number|null}[],
 * debits?: {profileId: string, targetActionIds: string[], value: number}[]}} request
 */
export async function prepareSaleFlowWrite({ storage = persistenceStorage, now = appNow(), sales = [], credits = [], resolution = null, buys = [], debits = [] }) {
    const writeKeys = SALE_FLOW_WRITE_KEYS;
    const before = captureHouseholdRecords(storage, writeKeys), date = localCalendarDate(now);
    let { activeId, registry } = openHouseholdRegistry(storage);
    const results = [];
    for (const sale of sales) {
        if (!registry.profiles[sale.profileId]) throw new Error('Die Person gehört nicht mehr zum Bestand.');
        // Gutachten VK-1 P2-03: ein Verkauf ohne Teile würde Tagesgeld ohne Beleg schreiben oder still nichts tun.
        if (!Array.isArray(sale.parts) || !sale.parts.length || sale.parts.some(part => !(part.shares > 0))) {
            throw Object.assign(new Error('Ein Verkauf braucht mindestens ein verkauftes Stück.'), { code: 'SALE_FLOW_NO_PARTS' });
        }
        const confirmed = Number.isFinite(sale.cashValue);
        const settlementId = sale.bankOrder ? saleSettlementId(readReconciliationHistory(registry), sale) : sale.actionId;
        for (const [index, part] of sale.parts.entries()) {
            const action = { actionId: index === 0 ? settlementId : `${settlementId}~${index + 1}`, profileId: sale.profileId, trancheId: part.trancheId,
                executedAt: sale.executedAt, sharesSold: part.shares, grossProceeds: part.gross, fees: part.fees, taxes: part.taxes,
                ...(sale.recommendation && index === 0 ? { recommendation: sale.recommendation } : {}),
                cashStatus: confirmed ? 'confirmed_already_reflected' : 'pending_manual_posting',
                ...(confirmed ? { cashBalanceAfterPostingEur: cents(/** @type {number} */ (sale.cashValue)), cashConfirmedAt: now.toISOString() } : {}) };
            const applied = await applyHouseholdSale(registry, { profileId: sale.profileId, action }, writeKeys);
            registry = applied.registry; results.push({ kind: 'sale', status: applied.result.status, actionId: action.actionId });
        }
        if (confirmed) setHouseholdCash(registry.profiles[sale.profileId].data, /** @type {number} */ (sale.cashValue), date);
    }
    // VK-2: Käufe (neue Tranche, Beleg) und sofortige Abbuchung („Schon abgegangen“) im selben Commit.
    for (const buy of buys) {
        if (!registry.profiles[buy.profileId]) throw new Error('Die Person gehört nicht mehr zum Bestand.');
        if (!(buy.shares > 0) || !(buy.gross > 0) || !(buy.fees >= 0)) {
            throw Object.assign(new Error('Ein Kauf braucht Stückzahl, Kurs und Gebühren.'), { code: 'BUY_FLOW_INVALID' });
        }
        // VK-2b P2-1/P3-4 (Gutachten Fable VK2): Beträge auf Cent, Tranche und Beleg passen zueinander, Ausführungstag nicht in der Zukunft.
        const onCent = (/** @type {number} */ value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
        const debit = cents(cents(buy.gross) + cents(buy.fees));
        if (!onCent(buy.gross) || !onCent(buy.fees) || !(typeof buy.executedAt === 'string' && buy.executedAt <= date)
            || buy.tranche?.shares !== buy.shares || !(Math.abs(buy.shares * Number(buy.tranche?.purchasePrice) - debit) < 0.005)
            || buy.tranche?.purchaseDate !== buy.executedAt || !String(buy.tranche?.name || '').trim()) {
            throw Object.assign(new Error('Die Abrechnung passt nicht zur neuen Tranche.'), { code: 'BUY_FLOW_INVALID' });
        }
        const confirmed = Number.isFinite(buy.cashValue);
        const record = { schemaVersion: 1, eventType: 'buy_reconciled', actionId: buy.actionId, profileId: buy.profileId, trancheId: buy.tranche.trancheId,
            executedAt: buy.executedAt, assetClass: buy.assetClass, name: buy.tranche.name, ...(buy.tranche.isin ? { isin: buy.tranche.isin } : {}),
            actual: { sharesBought: buy.shares, grossAmount: cents(buy.gross), fees: cents(buy.fees), netCashDebited: debit },
            cashStatus: confirmed ? 'confirmed_already_reflected' : 'pending_manual_posting',
            ...(confirmed ? { cashBalanceAfterPostingEur: cents(/** @type {number} */ (buy.cashValue)), cashConfirmedAt: now.toISOString() } : {}),
            reconciledAt: now.toISOString() };
        const applied = applyHouseholdBuy(registry, { profileId: buy.profileId, record, tranche: buy.tranche, date }, writeKeys);
        registry = applied.registry; results.push({ kind: 'buy', status: applied.result.status, actionId: applied.result.actionId || buy.actionId });
        if (confirmed && applied.result.status !== 'duplicate') setHouseholdCash(registry.profiles[buy.profileId].data, /** @type {number} */ (buy.cashValue), date);
    }
    for (const credit of [...credits, ...debits]) {
        if (registry.profiles[credit.profileId]) alignCashWithHistory(registry.profiles[credit.profileId].data);
        for (const targetActionId of credit.targetActionIds) {
            const applied = await applyHouseholdCredit(registry, { profileId: credit.profileId, targetActionId, value: cents(credit.value), confirmedAt: now.toISOString() }, writeKeys);
            registry = applied.registry; results.push({ kind: 'credit', status: applied.result.status, actionId: targetActionId });
        }
    }
    /** @type {Record<string, string>} */
    const extra = {};
    if (resolution) extra[ANNUAL_PLAN_RESOLUTIONS_KEY] = buildAnnualPlanResolutions(storage.getItem(ANNUAL_PLAN_RESOLUTIONS_KEY), { ...resolution, now: now.toISOString() });
    // Doppelschutz: Wiederholung mit gleichen Daten ändert keine Bytes (auch nicht die Registry der aktiven Person).
    const unchanged = !resolution && results.every(result => result.status === 'duplicate');
    const keys = new Set(writeKeys);
    return { before, date, activeId, results, unchanged,
        records: unchanged ? Object.fromEntries(Object.entries(before).filter(([key]) => keys.has(key))) : householdRecords(before, registry, activeId, writeKeys, extra) };
}

/** Commit des Verkaufsablaufs. @param {Awaited<ReturnType<typeof prepareSaleFlowWrite>>} prepared @param {{storage?: any, navigationOperation?: any}} [options] */
export async function commitSaleFlowWrite(prepared, { storage = persistenceStorage, navigationOperation } = {}) {
    if (prepared.unchanged) return prepared;
    return commitHouseholdRecords(prepared, { storage, writeKeys: SALE_FLOW_WRITE_KEYS, navigationOperation });
}
