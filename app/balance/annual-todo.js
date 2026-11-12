// FR-77: Karte „Was zu tun ist“ in Balance und Jahresabschluss. Reine Projektionen ohne DOM, Speicher oder Engine:
// Plan aus dem Jahresbeleg mit Status (Punkt 2) und Hinweis „Tagesgeld auffüllen“ (Punkt 3). Speicher wird nur gelesen.
import { describePlanAction } from './balance-action-summary.js';
import { annualActionPlanLines, annualActionAssetClass } from './annual-action-progress.js';
import { resolveTargetTagesgeld, ironCashReserve } from './balance-play-execution.js';
import { personalCashTargetEntries } from './balance-reserves.js';
import { PROFILE_TRANCHES_KEY } from '../profile/profile-state.js';
import { resolveLiquidityRunwayYears } from '../../types/liquidity-runway-contract.js';

/** Unter so vielen Monaten Entnahme im Tagesgeld erscheint „Tagesgeld auffüllen“ (FR-77 Punkt 3). */
export const CASH_REFILL_MIN_MONTHS = 6;

const finite = Number.isFinite;
const KIND_NAMES = /** @type {Record<string, string>} */ ({ aktien_alt: 'Aktien (Altbestand)', aktien_neu: 'Aktien (Neubestand)', aktien: 'Aktien',
    gold: 'Gold', anleihe: 'Anleihen', bonds: 'Anleihen', geldmarkt: 'Geldmarkt', liquiditaet: 'Tagesgeld', cash: 'Tagesgeld' });
const USE_NAMES = /** @type {Record<string, string>} */ ({ gold: 'In Gold', aktien: 'In Aktien', bonds: 'In Anleihen', geldmarkt: 'In den Geldmarkt', cash: 'Aufs Tagesgeld' });

/** Kalendertag JJJJ-MM-TT (auch am Anfang eines Zeitstempels) als TT.MM.JJJJ. @param {string|null|undefined} value */
export const todoDate = value => /^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0, 10).split('-').reverse().join('.') : '';

/** Belegquellen tragen die Tranche mit Personenpräfix („person:tranche“), der Bestand ohne (WT-1b).
 * @param {string|null|undefined} trancheId @param {string|null|undefined} profileId */
export function stockTrancheId(trancheId, profileId) {
    if (!trancheId) return null;
    const prefix = profileId ? `${profileId}:` : null;
    return prefix && String(trancheId).startsWith(prefix) ? String(trancheId).slice(prefix.length) : String(trancheId);
}

/** Verkaufslink in Personen & Vermögen: Verkaufsdialog für Person und Tranche, sonst die Seite.
 * @param {{profileId?: string|null, trancheId?: string|null}|null|undefined} target */
export function saleEntryHref(target) {
    if (!target?.profileId) return 'depot-tranchen-manager.html';
    const tranche = target.trancheId ? `&tranche=${encodeURIComponent(target.trancheId)}` : '';
    return `depot-tranchen-manager.html?person=${encodeURIComponent(target.profileId)}${tranche}#verkauf`;
}

/** Plan des Jahresbelegs für die Karte. Status und Beträge stammen aus `projectAnnualActionProgress`; ohne Stand gilt alles als offen.
 * @param {{confirmed: {year: number, committedAt?: string, action: any, text?: string, progress?: any, marketReading?: any}|null|undefined,
 * people?: {id: string, name: string}[], routing?: {tagesgeld: number, geldmarkt: number}|null, cashMonths?: number|null}} options */
export function projectAnnualTodoPlan({ confirmed, people = [], routing = null, cashMonths = null }) {
    if (!confirmed?.action) return null;
    const action = confirmed.action, sources = Array.isArray(action.quellen) ? action.quellen : [];
    const summary = describePlanAction(action);
    const progress = confirmed.progress?.lines ? confirmed.progress : null;
    const single = people.length === 1 ? people[0].id : null;
    const lines = progress ? progress.lines : annualActionPlanLines(action, single).map(line => ({ ...line, soldNet: 0, restNet: line.planNet,
        creditPendingNet: 0, status: 'offen', lastSaleAt: null }));
    const person = (/** @type {any} */ source, /** @type {string|null} */ profileId) => source?.sourceProfileName
        || people.find(entry => entry.id === (source?.sourceProfileId ?? profileId))?.name || (people.length === 1 ? people[0].name : 'nicht zugeordnet');
    const security = (/** @type {any} */ source) => source?.name && source.name !== source.isin ? source.name : KIND_NAMES[source?.kind] || source?.kind || 'Wertpapier';
    const rows = lines.map(line => ({ who: person(sources[line.index], line.profileId), security: security(sources[line.index]),
        planNet: line.planNet, soldNet: line.soldNet, restNet: line.restNet, status: line.status, lastSaleAt: line.lastSaleAt ?? null,
        profileId: line.profileId ?? null, trancheId: stockTrancheId(line.trancheId, line.profileId) }));
    const planNet = rows.reduce((sum, row) => sum + row.planNet, 0);
    const soldNet = rows.reduce((sum, row) => sum + row.soldNet, 0);
    const restNet = rows.reduce((sum, row) => sum + row.restNet, 0);
    const status = !rows.length ? null : progress ? progress.status : 'offen';
    const tax = sources.filter(source => !['liquiditaet', 'cash'].includes(source.kind) && !source.internalCashRebalance)
        .reduce((sum, source) => sum + (finite(source.steuer) ? source.steuer : 0), 0);
    const open = rows.find(row => row.status !== 'erledigt') || null;
    const uses = Object.entries(action.verwendungen || {}).filter(([, amount]) => finite(amount) && amount > 0);
    const months = Number.isInteger(cashMonths) && cashMonths > 0 ? cashMonths : 12;
    // RD-1e: `purchase` kennzeichnet Käufe (Gold, Aktien, Anleihen); die Anzeige rundet sie ab.
    const PURCHASE_KEYS = ['gold', 'aktien', 'bonds'];
    /** @type {{label: string, amount: number, purchase?: boolean}[]} */
    const destinations = [];
    for (const [key, amount] of uses) {
        if (key !== 'liquiditaet') { destinations.push({ label: USE_NAMES[key] || `In ${key}`, amount, purchase: PURCHASE_KEYS.includes(key) }); continue; }
        if (routing && finite(routing.tagesgeld) && finite(routing.geldmarkt)) {
            if (routing.geldmarkt > 0.5) destinations.push({ label: `Aufs Tagesgeld, bis es ${months} Monate Entnahme deckt`, amount: routing.tagesgeld },
                { label: 'Der Rest in den Geldmarkt', amount: routing.geldmarkt });
            else destinations.push({ label: `Alles aufs Tagesgeld, bis es ${months} Monate Entnahme deckt`, amount });
        } else destinations.push({ label: 'Aufs Tagesgeld bis zum Tagesgeldziel, der Rest in den Geldmarkt', amount });
    }
    // Käufe tragen im Beleg keine Person (Verwendungen des Haushalts); ihr Stand ist ohne Raten nicht ableitbar.
    const purchases = uses.filter(([key]) => key !== 'liquiditaet' && key !== 'cash').map(([key, amount]) => ({ label: USE_NAMES[key] || `In ${key}`, amount, purchase: PURCHASE_KEYS.includes(key) }));
    const credits = (progress?.creditPendingSales || []).map((/** @type {any} */ sale) => ({ profileId: sale.profileId, date: todoDate(sale.executedAt),
        amount: sale.netProceeds, who: people.find(entry => entry.id === sale.profileId)?.name || null }));
    const securities = [...new Set(rows.filter(row => row.restNet > 0).map(row => row.security))];
    return { year: confirmed.year, decidedOn: todoDate(confirmed.committedAt ? annualDay(confirmed.committedAt) : null),
        verb: summary.verb, amount: summary.amount, nothing: action.type === 'NONE' || summary.verb === 'Nichts tun', text: confirmed.text || '',
        status, rows, planNet, soldNet, restNet, share: planNet > 0 ? Math.min(1, soldNet / planNet) : 0, tax,
        lastSaleDate: todoDate(progress?.lastSaleAt), credits, destinations, purchases, openSecurities: securities,
        saleTarget: open ? { profileId: open.profileId, trancheId: open.trancheId } : null, marketReading: confirmed.marketReading || null };
}

/** Lokaler Kalendertag eines Zeitstempels. @param {string} value */
function annualDay(value) {
    const date = new Date(value);
    if (!finite(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Statuswort des alten Plans im Jahresabschluss (FR-77 Punkt 6). @param {string|null} status */
export const annualPlanStatusText = status => status === 'erledigt' ? 'umgesetzt' : status === 'teilweise' ? 'teilweise umgesetzt' : 'nicht umgesetzt';

/**
 * FR-77 Punkt 3: Tagesgeld auffüllen. Deckt das Tagesgeld des Haushalts weniger als sechs Monate Entnahme und ist aus dem Plan
 * kein Verkauf mehr offen oder teilweise, wird je Person bis zu ihrem Tagesgeldziel aus ihrem Geldmarkt umgeschichtet.
 * Ziel je Person wie beim Routing der Planerlöse (`resolveTargetTagesgeld`, im Haushalt mit `withProfileLiquidityTargets`).
 * WT-1b: Schwelle und Ziel rechnen mit derselben Monatsbasis wie die Reservekarte (`cashRefillMonthlyBase`):
 * Schwelle 6 × Basis, Haushaltsziel Tagesgeldmonate × Basis. Die Summe der Personen liegt nie über dem Haushaltsziel;
 * reicht der Platz bis dorthin nicht für alle, sinkt jeder Personenbetrag im selben Verhältnis.
 * WT-1c (Gutachten WT1B-FABLE Befund 2): Liegt die eiserne Reserve des Haushalts (`ironReserve`) über Tagesgeldmonate × Basis
 * (Ansparphase, Renten decken fast alles), gilt sie wie in der Reservekarte als Tagesgeldziel: Der Hinweis erscheint, sobald
 * das Tagesgeld darunter liegt, und füllt bis zu ihr auf.
 * @param {{people: {profileId?: string|null, name?: string|null, tagesgeld: number, geldmarkt: number, target: number, moneyMarketTrancheId?: string|null}[],
 * monthlyBase: number|null|undefined, cashMonths?: number|null, planOpen: boolean, ironReserve?: number|null}} options
 */
export function projectCashRefill({ people, monthlyBase, cashMonths = null, planOpen, ironReserve = null }) {
    if (planOpen || !Array.isArray(people) || !people.length || !finite(monthlyBase) || !(/** @type {number} */ (monthlyBase) > 0)) return null;
    const base = /** @type {number} */ (monthlyBase);
    const months = Number.isInteger(cashMonths) && /** @type {number} */ (cashMonths) > 0 ? /** @type {number} */ (cashMonths) : 12;
    if (people.some(person => !finite(person.tagesgeld) || !finite(person.geldmarkt) || !finite(person.target))) return null;
    const tagesgeld = people.reduce((sum, person) => sum + person.tagesgeld, 0);
    const reserve = finite(ironReserve) && /** @type {number} */ (ironReserve) > months * base + 0.5 ? /** @type {number} */ (ironReserve) : null;
    if (!(tagesgeld < (reserve ?? CASH_REFILL_MIN_MONTHS * base))) return null;
    const target = reserve ?? months * base, room = Math.max(0, target - tagesgeld);
    const wanted = people.map(person => Math.max(0, Math.min(person.target - person.tagesgeld, person.geldmarkt)));
    const total = wanted.reduce((sum, amount) => sum + amount, 0);
    const scale = total > room ? room / total : 1;
    const rows = people.map((person, index) => ({ profileId: person.profileId ?? null, name: person.name ?? null, moneyMarketTrancheId: person.moneyMarketTrancheId ?? null,
        amount: wanted[index] * scale }));
    const amount = rows.reduce((sum, row) => sum + row.amount, 0);
    if (!(amount >= 0.5)) return null;
    const shown = rows.filter(row => row.amount >= 0.5).map(row => ({ ...row, saleTarget: { profileId: row.profileId, trancheId: row.moneyMarketTrancheId } }));
    return { amount, tagesgeld, target, months: Math.floor(tagesgeld / base + 1e-9), targetMonths: months, monthlyBase: base,
        ironReserve: reserve !== null, household: people.length > 1, rows: shown, saleTarget: shown[0]?.saleTarget ?? null };
}

/** Eiserne Reserve des Haushalts für „Tagesgeld auffüllen“ (WT-1c), dieselbe Rechnung wie die Tagesgeldziele: im Haushalt
 * Bruttobedarf des Haushalts je Monat × Mindest-Liquidität (`withProfileLiquidityTargets`), sonst `ironCashReserve`.
 * Persönlich festgelegte Tagesgeldziele ersetzen sie; dann `null`. @param {any} currentYear @returns {number|null} */
export function cashRefillIronReserve(currentYear) {
    const entries = Array.isArray(currentYear?.profileActionResults) && currentYear.profileActionResults.length > 1 ? currentYear.profileActionResults : null;
    const positive = (/** @type {unknown} */ value) => finite(value) && /** @type {number} */ (value) > 0 ? /** @type {number} */ (value) : 0;
    if (entries) {
        if (entries.some(entry => !entry?.input) || entries.every(entry => finite(entry.input.personalTagesgeldTarget))) return null;
        const first = entries[0].input;
        const value = (positive(first.floorBedarf) + positive(first.flexBedarf)) / 12 * (first.minCashBufferMonths ?? 2);
        return finite(value) ? value : null;
    }
    const input = currentYear?.input || {};
    if (finite(input.personalTagesgeldTarget)) return null;
    const value = ironCashReserve(currentYear?.spending, input);
    return finite(value) ? value : null;
}

/** Monatsbasis für „Tagesgeld auffüllen“ wie in der Reservekarte: Liquiditätsziel ÷ Reichweite in Monaten (WT-1b).
 * Max und Erika: 162.000 € ÷ 60 = 2.700 €. @param {{zielLiquiditaet?: number|null, input?: any}} currentYear */
export function cashRefillMonthlyBase(currentYear) {
    const target = currentYear?.zielLiquiditaet;
    if (!finite(target) || !(/** @type {number} */ (target) > 0)) return null;
    const years = finite(currentYear?.input?.liquidityRunwayYears) ? currentYear.input.liquidityRunwayYears : resolveLiquidityRunwayYears(currentYear?.input || {}).years;
    return finite(years) && years > 0 ? /** @type {number} */ (target) / (years * 12) : null;
}

/** Personen für „Tagesgeld auffüllen“: Tagesgeld, Geldmarkt und Tagesgeldziel wie beim Routing der Planerlöse.
 * Im Haushalt die Personeneinträge des laufenden Jahres, sonst die Haushaltseingaben. Die Geldmarkt-Tranche je Person
 * kommt aus den gespeicherten Tranchen (nur gelesen) für den Verkaufslink.
 * @param {any} currentYear @param {()=>any} readRegistry @param {string|null} [activeId] aktive Person bei Einzelplänen */
export function cashRefillPeople(currentYear, readRegistry, activeId = null) {
    const entries = Array.isArray(currentYear.profileActionResults) && currentYear.profileActionResults.length > 1 ? currentYear.profileActionResults : null;
    const registry = (() => { try { return readRegistry(); } catch { return null; } })();
    const moneyMarket = (/** @type {string|null|undefined} */ profileId) => {
        try {
            const tranches = JSON.parse(registry?.profiles?.[profileId || '']?.data?.[PROFILE_TRANCHES_KEY] || '[]');
            return (Array.isArray(tranches) ? tranches : []).find(tranche => annualActionAssetClass(tranche) === 'money_market' && tranche.shares > 0)?.trancheId ?? null;
        } catch { return null; }
    };
    if (entries) {
        const targets = personalCashTargetEntries(entries, currentYear.zielLiquiditaet);
        if (!targets) return [];
        return entries.map((entry, index) => ({ profileId: entry.profileId ?? null, name: entry.name ?? null, tagesgeld: entry.input?.tagesgeld,
            geldmarkt: entry.input?.geldmarktEtf, target: targets[index]?.tagesgeldTarget, moneyMarketTrancheId: moneyMarket(entry.profileId) }));
    }
    const input = currentYear.input || {}, entry = currentYear.profileActionResults?.[0];
    const profileId = entry?.profileId ?? activeId ?? null;
    return [{ profileId, name: entry?.name ?? input.profilName ?? null, tagesgeld: input.tagesgeld, geldmarkt: input.geldmarktEtf,
        target: resolveTargetTagesgeld(currentYear.spending, currentYear.zielLiquiditaet, input), moneyMarketTrancheId: moneyMarket(profileId) }];
}
