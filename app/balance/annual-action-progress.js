// FR-77 Punkt 2: Umsetzungsstand des Jahresbelegs je Planzeile (Person × Wertpapier) aus bestätigten Verkäufen.
// Rein lesend: kein DOM, kein Speicherzugriff, keine Engine. Reserven nutzen den offenen Rest, WT-1 den Status.
import { TRANCHE_CATEGORY_TYPES } from '../../types/tranche-contract.js';
import { readReconciliationHistory, projectReconciliationCashStatuses } from '../tranches/tranche-reconciliation.js';
import { confirmedHistorySales } from '../tranches/tranchen-history-model.js';
import { PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { PROFILE_WEALTH_LOTS_KEY } from '../profile/profile-wealth-history.js';

/** Ab diesem Anteil des Planbetrags gilt eine Zeile als erledigt; der Rest ist dann 0. */
export const ANNUAL_ACTION_DONE_SHARE = 0.98;

const CLASS_BY_TYPE = Object.fromEntries(Object.entries(TRANCHE_CATEGORY_TYPES).flatMap(([category, types]) => types.map(type => [type, category])));
const finite = Number.isFinite;

/** Anlageklasse einer Tranche oder Belegquelle (equity, bonds, money_market, gold), sonst null.
 * @param {{category?: string, type?: string, kind?: string}|null|undefined} item @returns {string|null} */
export function annualActionAssetClass(item) {
    if (item?.category && Object.hasOwn(TRANCHE_CATEGORY_TYPES, item.category)) return item.category;
    return CLASS_BY_TYPE[item?.type ?? item?.kind] ?? null;
}

/** Lokaler Kalendertag eines Zeitpunkts als JJJJ-MM-TT, sonst null. @param {string} value @returns {string|null} */
export function annualActionDecisionDay(value) {
    const date = new Date(value);
    if (!finite(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const sourceNet = source => finite(source.netto) ? source.netto : finite(source.brutto) && finite(source.steuer) ? source.brutto - source.steuer : NaN;
const planSource = source => source && typeof source === 'object' && !source.internalCashRebalance
    && !['liquiditaet', 'cash'].includes(source.kind) && source.source !== 'Liquidität';

/** Planzeilen des Belegs: je verkaufte Quelle eine Zeile mit Person, Anlageklasse und Nettobetrag.
 * @param {any} action Aktion des Jahresbelegs. @param {string|null} [defaultProfileId] Person bei Einzelplänen ohne Quellenperson. */
export function annualActionPlanLines(action, defaultProfileId = null) {
    return (Array.isArray(action?.quellen) ? action.quellen : []).flatMap((source, index) => {
        const planNet = planSource(source) ? sourceNet(source) : NaN;
        return planNet > 0 ? [{ index, profileId: source.sourceProfileId ?? defaultProfileId, profileName: source.sourceProfileName ?? null,
            assetClass: annualActionAssetClass(source), trancheId: source.trancheId ?? null, security: source.name ?? null, planNet }] : [];
    });
}

/** Bestätigte Verkäufe der Personen mit Nettoerlös, Anlageklasse und offener Gutschrift. Die Anlageklasse kommt aus der
 * heutigen Tranche oder, nach einem Totalverkauf, aus der gespeicherten Verlaufskopie derselben Tranche.
 * @param {any} registry Personenregistry. @param {string[]} profileIds Personen des Plans. */
export function readAnnualActionSales(registry, profileIds = []) {
    const ids = new Set(profileIds);
    const parse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
    const classes = new Map([...ids].map(id => {
        const data = registry?.profiles?.[id]?.data || {}, known = new Map();
        for (const lot of Object.values(parse(data[PROFILE_WEALTH_LOTS_KEY])?.lots || {})) {
            if (lot?.tranche?.trancheId) known.set(lot.tranche.trancheId, annualActionAssetClass(lot.tranche));
        }
        const tranches = parse(data[PROFILE_TRANCHES_KEY]);
        for (const tranche of Array.isArray(tranches) ? tranches : []) if (tranche?.trancheId) known.set(tranche.trancheId, annualActionAssetClass(tranche));
        return [id, known];
    }));
    const pending = new Set(projectReconciliationCashStatuses(registry).filter(status => status.isPending).map(status => status.targetActionId));
    return confirmedHistorySales(/** @type {any[]} */ ([...readReconciliationHistory(registry)])).filter(sale => ids.has(sale.profileId)).map(sale => ({
        profileId: sale.profileId, trancheId: sale.trancheId, executedAt: sale.executedAt,
        netProceeds: /** @type {any} */ (sale.actual)?.netProceeds, assetClass: classes.get(sale.profileId)?.get(sale.trancheId) ?? null,
        creditPending: pending.has(sale.actionId) }));
}

/**
 * Umsetzungsstand je Planzeile. Gezählt werden bestätigte Verkäufe derselben Person und Anlageklasse ab dem Beschlusstag
 * im Planjahr, netto. Mehrere Zeilen derselben Person und Klasse füllen sich in Belegreihenfolge.
 * @param {{action: any, year: number, decidedOn?: string|null, sales?: ReturnType<typeof readAnnualActionSales>, defaultProfileId?: string|null}} options
 */
export function projectAnnualActionProgress({ action, year, decidedOn = null, sales = [], defaultProfileId = null }) {
    const lines = annualActionPlanLines(action, defaultProfileId).map(line => ({ ...line, soldNet: 0, restNet: line.planNet, creditPendingNet: 0,
        status: 'offen', lastSaleAt: /** @type {string|null} */ (null) }));
    const key = (profileId, assetClass) => JSON.stringify([profileId, assetClass]);
    const counted = sales.filter(sale => finite(sale.netProceeds) && sale.netProceeds > 0 && sale.assetClass
        && typeof sale.executedAt === 'string' && sale.executedAt.slice(0, 4) === String(year) && (!decidedOn || sale.executedAt >= decidedOn));
    const groups = new Map(), pendingSales = [];
    for (const line of lines) {
        if (!line.profileId || !line.assetClass) continue;
        const id = key(line.profileId, line.assetClass);
        if (!groups.has(id)) groups.set(id, { lines: [], sold: 0, pending: 0, lastSaleAt: null });
        groups.get(id).lines.push(line);
    }
    for (const sale of counted) {
        const group = groups.get(key(sale.profileId, sale.assetClass));
        if (!group) continue;
        group.sold += sale.netProceeds;
        if (!group.lastSaleAt || sale.executedAt > group.lastSaleAt) group.lastSaleAt = sale.executedAt;
        if (sale.creditPending) {
            group.pending += sale.netProceeds;
            pendingSales.push({ profileId: sale.profileId, executedAt: sale.executedAt, netProceeds: sale.netProceeds });
        }
    }
    for (const group of groups.values()) {
        const plan = group.lines.reduce((sum, line) => sum + line.planNet, 0);
        const allDone = group.sold >= ANNUAL_ACTION_DONE_SHARE * plan;
        let rest = group.sold;
        for (const line of group.lines) {
            line.soldNet = Math.min(rest, line.planNet);
            rest -= line.soldNet;
            line.restNet = allDone || line.soldNet >= ANNUAL_ACTION_DONE_SHARE * line.planNet ? 0 : line.planNet - line.soldNet;
            line.creditPendingNet = group.sold > 0 ? group.pending * line.soldNet / group.sold : 0;
            line.status = line.restNet === 0 ? 'erledigt' : line.soldNet > 0 ? 'teilweise' : 'offen';
            line.lastSaleAt = line.soldNet > 0 ? group.lastSaleAt : null;
        }
    }
    const total = field => lines.reduce((sum, line) => sum + line[field], 0);
    const planNet = total('planNet'), soldNet = total('soldNet'), restNet = total('restNet');
    const lastSaleAt = lines.reduce((last, line) => line.lastSaleAt && (!last || line.lastSaleAt > last) ? line.lastSaleAt : last, null);
    return { year, decidedOn, lines, planNet, soldNet, restNet, creditPendingNet: total('creditPendingNet'), lastSaleAt,
        creditPendingSales: pendingSales.sort((a, b) => a.executedAt.localeCompare(b.executedAt)),
        status: !lines.length || restNet === 0 ? 'erledigt' : soldNet > 0 ? 'teilweise' : 'offen' };
}

/** Belegaktion auf den offenen Rest gekürzt: Quellen je Zeile anteilig, Verwendungen im Verhältnis offener Rest zu Plan.
 * Der Beleg selbst bleibt unverändert. @param {any} action @param {ReturnType<typeof projectAnnualActionProgress>|null} progress */
export function remainingAnnualAction(action, progress) {
    if (!action || !progress || !progress.lines.length || progress.restNet === progress.planNet) return action;
    const result = structuredClone(action), lines = new Map(progress.lines.map(line => [line.index, line]));
    const removed = { brutto: 0, steuer: 0, netto: 0 };
    result.quellen = (action.quellen || []).flatMap((source, index) => {
        const line = lines.get(index);
        if (!line) return [structuredClone(source)];
        const share = line.restNet / line.planNet, scaled = { ...structuredClone(source) };
        for (const field of /** @type {(keyof typeof removed)[]} */ (['brutto', 'steuer', 'netto'])) {
            if (!finite(source[field])) continue;
            scaled[field] = source[field] * share;
            removed[field] += source[field] - scaled[field];
        }
        return share > 0 ? [scaled] : [];
    });
    const share = progress.planNet > 0 ? progress.restNet / progress.planNet : 0;
    for (const [field, part] of /** @type {[string, keyof typeof removed][]} */ ([['nettoErlös', 'netto'], ['nettoErlösPlan', 'netto'],
        ['steuer', 'steuer'], ['steuerPlanGesamt', 'steuer'], ['bruttoVerkaufGesamt', 'brutto']])) {
        if (finite(action[field])) result[field] = Math.max(0, action[field] - removed[part]);
    }
    if (action.verwendungen && typeof action.verwendungen === 'object') {
        result.verwendungen = Object.fromEntries(Object.entries(action.verwendungen).map(([field, amount]) => [field, finite(amount) ? amount * share : amount]));
    }
    if (progress.restNet === 0) result.type = 'NONE';
    return result;
}

/** Herkunft mit Umsetzungsstand am Beleg (`confirmed.progress`). Ist der Verlauf nicht lesbar, bleibt der Stand leer
 * und Reserven rechnen mit dem ganzen Beleg. @param {any} origin @param {()=>any} readRegistry @param {string[]} [profileIds] */
export function withAnnualActionProgress(origin, readRegistry, profileIds = []) {
    const confirmed = origin?.confirmed;
    if (!confirmed?.action) return origin;
    let progress = null;
    try {
        progress = projectAnnualActionProgress({ action: confirmed.action, year: confirmed.year, decidedOn: annualActionDecisionDay(confirmed.committedAt),
            sales: readAnnualActionSales(readRegistry(), profileIds), defaultProfileId: profileIds.length === 1 ? profileIds[0] : null });
    } catch { progress = null; }
    return { ...origin, confirmed: { ...confirmed, progress } };
}

/** Umsetzungsstand eines gespeicherten Jahresbelegs (Jahresabschluss, Schritt „Plan“): derselbe Weg wie in der Balance.
 * @param {{entry: any, year: number, registry: any, profileIds?: string[]}} options Beleg aus `readAnnualPlanRecord`.
 * @returns {ReturnType<typeof projectAnnualActionProgress>|null} */
export function annualPlanEntryProgress({ entry, year, registry, profileIds = [] }) {
    const action = entry && !entry.status ? entry.adopted?.action : null;
    if (!action) return null;
    try {
        return projectAnnualActionProgress({ action, year, decidedOn: annualActionDecisionDay(entry.committedAt),
            sales: readAnnualActionSales(registry, profileIds), defaultProfileId: profileIds.length === 1 ? profileIds[0] : null });
    } catch { return null; }
}
