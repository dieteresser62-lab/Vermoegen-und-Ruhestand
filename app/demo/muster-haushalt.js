import { WEALTH_CAPTURES_KEY, CAPTURE_AMOUNT_FIELDS, assertWealthCaptures } from '../../types/wealth-capture-contract.js';
import { INCOME_KEY, INCOME_MIGRATION_KEY, writeIncome } from '../profile/profile-income.js';
import { rebuildSyntheticPriceRecords, validateMusterTestDate } from './muster-haushalt-prices.js';
export { rebuildSyntheticPriceRecords, validateMusterTestDate } from './muster-haushalt-prices.js';
import { buildPlanRecord, planScope, projectPlanToBalance } from '../profile/household-plan.js';
import { CONFIG } from '../balance/balance-config.js';
import { parseCalendarDate } from '../shared/app-clock.js';
import { syntheticQuote, syntheticAnnualQuote, withSyntheticMarketScenario } from '../shared/probelauf-prices.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry } from '../../types/wealth-history-contract.js';
import { captureWealthLots } from '../profile/profile-wealth-history.js';
import { overviewScope, summaryEntryKey } from '../overview/overview-storage.js';
import { previousOverviewMonth } from '../overview/overview-model.js';
import { validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { ANNUAL_PLAN_RECORD_KEY, buildAnnualPlanRecord } from '../profile/annual-plan-record.js';
import { projectPerson } from '../profile/profile-person-data.js';
import { evaluateAnnualDraft } from '../balance/balance-annual-storage-commit.js';
import { EngineAPI } from '../../engine/index.mjs';
import { musterHaushalt, musterVariante, musterMarktverlauf, DEFAULT_MUSTER_HAUSHALT } from './muster-haushalte.js';
import { DEFAULT_PROFILE_HEALTH_BUCKET, PROFILE_HEALTH_BUCKET_KEY } from '../profile/profile-state.js';
import { IMMOBILIEN_KEY, writeImmobilien } from '../profile/profile-immobilien.js';
import { PARTNERSHIP_KEY } from '../profile/household-partnership.js';
import { PLANNED_EXPENSES_KEY } from '../profile/household-planned-expenses.js';
import { splitExampleExpenseNeeds } from './beispielausgaben-needs.js';

const STECKBRIEFE = {
    'max-erika': {
        floorBedarf: 30000, flexBedarf: 30000, minimumFlexAnnual: 7500,
        categories: { Wohnen: 50, Alltag: 34, Reisen: 16 },
        people: [
            { id: 'muster_a', name: 'Max', birthDate: '1958-03-14', sex: 'm', pensionStart: '2023-01-01', pension: 2300,
                cash: 18000, lots: [180000, 180000, 36000], newPurchaseDate: '2020-05-18' },
            { id: 'muster_b', name: 'Erika', birthDate: '1961-08-22', sex: 'w', pensionStart: '2027-07-01', pension: 1600,
                cash: 12000, lots: [160000, 180000, 24000], newPurchaseDate: '2025-02-14' }
        ]
    },
    renate: {
        floorBedarf: 24000, flexBedarf: 12000, minimumFlexAnnual: 3000,
        decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null },
        categories: { Wohnen: 50, Alltag: 40, Reisen: 10 },
        people: [
            { id: 'muster_renate', name: 'Renate', birthDate: '1959-01-01', sex: 'w', pensionStart: '2025-01-01', pension: 1400,
                cash: 15000, lots: [70000, 75000, 45000], bonds: 145000, newPurchaseDate: '2020-05-18' }
        ]
    },
    'jan-lena': {
        // Ein Viertel des Wunsch-Flex bleibt geschützt; schlechte Jahre erlauben geringere Ausgaben.
        floorBedarf: 36000, flexBedarf: 27000, minimumFlexAnnual: 6750,
        householdWithdrawalMode: 'proportional',
        // Feste Januarstücke halten die vorbereitete Jahresrechnung bei jedem Startdatum gleich.
        // Dynamic Flex berechnet das Startbudget aus dieser festen Januarbewertung.
        valuationAtYearStart: true,
        dynamicFlex: true, gold: { target: 10, floor: 5, band: 20 },
        categories: { Wohnen: 45, Alltag: 30, Reisen: 25 },
        people: [
            { id: 'muster_jan', name: 'Jan', birthDate: '1968-01-01', sex: 'm', pensionStart: '2035-01-01', pension: 2100,
                inflows: [{ offset: 2, amount: 40000, label: 'Erbe' }],
                cash: 35000, lots: [300000, 285000, 0], gold: 65000, newPurchaseDate: '2020-05-18' },
            { id: 'muster_lena', name: 'Lena', birthDate: '1970-01-01', sex: 'w', pensionStart: '2037-01-01', pension: 1500,
                inflows: [{ offset: 5, amount: 60000, label: 'Nettozahlung aus vereinbartem Verkauf' }],
                cash: 25000, lots: [220000, 200793.2, 0], gold: 46754.8, newPurchaseDate: '2021-02-14' }
        ]
    },
    sophie: {
        // Der Rentenwechsel bleibt innerhalb der höchstens 15 Zeilen der Planübersicht sichtbar.
        floorBedarf: 22000, flexBedarf: 8000, minimumFlexAnnual: 2000,
        maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
        categories: { Wohnen: 50, Alltag: 35, Reisen: 15 },
        // GA-2: Der Ratenkredit zeigt feste geplante Ausgaben im Grundbedarf. Er endet vor der Teilzeitvariante,
        // damit deren Frage (Teilzeit leistbar?) gleich bleibt.
        plannedExpenses: [{ id: 'muster-auto', monat: '2029-04', betrag: 25000, bezeichnung: 'Auto' },
            { id: 'muster-kredit', bezeichnung: 'Ratenkredit', betragMonat: 300, ab: null, bis: '2032-12', anpassung: 'keine' }],
        people: [
            { id: 'muster_sophie', name: 'Sophie', birthDate: '1971-01-01', sex: 'w', pensionStart: '2038-01-01', pension: 1500,
                income: [{ id: 'muster-gehalt', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: 3400,
                    ab: null, bis: '2037-12', anpassung: 'lohn' }],
                cash: 15000, lots: [0, 90000, 0], newPurchaseDate: '2020-05-18' }
        ]
    },
    'martin-petra': {
        floorBedarf: 36000, flexBedarf: 12000, minimumFlexAnnual: 3000,
        categories: { Wohnen: 50, Alltag: 40, Reisen: 10 },
        partnership: { schemaVersion: 1, status: 'unmarried', inheritance: { muster_martin: 0, muster_petra: 0 },
            homeAndTaxInheritance: { muster_martin: true, muster_petra: true } },
        people: [
            { id: 'muster_martin', name: 'Martin', birthDate: '1959-02-20', sex: 'm', pensionStart: '2024-03-01', pension: 2300,
                cash: 100000, lots: [0, 500000, 0], equityCostBasis: 300000, newPurchaseDate: '2020-05-18',
                properties: [{ id: 'muster-haus', bezeichnung: 'Haus', nutzung: 'selbst', wert: 600000, mieteNetto: 0, anpassung: 'keine' }] },
            { id: 'muster_petra', name: 'Petra', birthDate: '1964-06-15', sex: 'w', pensionStart: '2031-06-01', pension: 1200,
                cash: 30000, lots: [0, 70000, 0], newPurchaseDate: '2020-05-18',
                income: [{ id: 'muster-gehalt', art: 'sonstige', bezeichnung: 'Gehalt', betragMonat: 2200,
                    ab: null, bis: '2031-05', anpassung: 'lohn' }],
                properties: [{ id: 'muster-wohnung', bezeichnung: 'Vermietete Wohnung', nutzung: 'vermietet', wert: 240000, mieteNetto: 600, anpassung: 'inflation' }] }
        ]
    },
    'helga-werner': {
        jointAssessment: true,
        floorBedarf: 36000, flexBedarf: 12000, minimumFlexAnnual: 6000,
        householdWithdrawalMode: 'proportional',
        decumulation: { mode: '3_bucket_jilge', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null },
        gold: { target: 20, floor: 10, band: 20 }, churchTax: 9, careReserve: 30000,
        categories: { Wohnen: 50, Alltag: 40, Reisen: 10 },
        people: [
            { id: 'muster_helga', name: 'Helga', birthDate: '1952-01-01', sex: 'w', pensionStart: '2017-01-01', pension: 900,
                cash: 40000, lots: [60000, 65000, 10000], bonds: 75000, gold: 50000, newPurchaseDate: '2020-05-18' },
            { id: 'muster_werner', name: 'Werner', birthDate: '1950-01-01', sex: 'm', pensionStart: '2015-01-01', pension: 1900,
                cash: 40000, lots: [60000, 65000, 10000], bonds: 75000, gold: 50000, newPurchaseDate: '2021-02-14' }
        ]
    }
};
/** Varianten verändern nur die benannten Vorgaben, alle übrigen Daten stammen aus dem Grundfall. */
function householdVariant(householdId, variantId) {
    const base = STECKBRIEFE[musterHaushalt(householdId).id];
    const variant = musterVariante(householdId, variantId);
    if (variant.id === 'grund') return base;
    const next = structuredClone(base);
    if (householdId === 'max-erika' && variant.id === 'immobilien') {
        next.people[0].properties = [{ id: 'muster-haus', bezeichnung: 'Haus', nutzung: 'selbst', wert: 450000, mieteNetto: 0, anpassung: 'keine' }];
        next.people[1].properties = [{ id: 'muster-mietwohnung', bezeichnung: 'Vermietete Wohnung', nutzung: 'vermietet', wert: 210000, mieteNetto: 650, anpassung: 'inflation' }];
    }
    if (householdId === 'renate') {
        Object.assign(next.people[0], { cash: 15000, lots: [0, 75000, 0], bonds: 0 });
        next.decumulation = { ...next.decumulation, mode: 'standard' };
    }
    if (householdId === 'jan-lena') next.minimumFlexAnnual = next.flexBedarf;
    if (householdId === 'helga-werner') {
        next.floorBedarf = variant.floorBedarf;
        next.people.forEach(person => { person.properties = [{ id: 'muster-haus', bezeichnung: 'Haus (½ Eigentum)',
            nutzung: 'selbst', wert: 225000, mieteNetto: 0, anpassung: 'keine' }]; });
        next.people[1].careGrade = 3;
        next.people[1].careForm = 'family';
        next.careForms = { 3: 'home-support' };
    }
    if (householdId === 'sophie') next.people[0].income = [
        { ...next.people[0].income[0], bis: '2032-12' },
        { ...next.people[0].income[0], id: 'muster-teilzeit', betragMonat: 2600, ab: '2033-01' }
    ];
    if (householdId === 'martin-petra') next.partnership = { schemaVersion: 1,
        status: variant.id === 'ehe' ? 'married' : 'unmarried',
        inheritance: { muster_martin: 100, muster_petra: 100 },
        ...(variant.id === 'ehe' ? { marriedInheritance: { muster_martin: 100, muster_petra: 100 } } : {}) };
    if (householdId === 'martin-petra' && variant.id === 'testament') next.partnership = { schemaVersion: 1, status: 'unmarried',
        inheritance: { muster_martin: 100 / 3, muster_petra: 0 },
        testament: { muster_martin: { minimum: 200000, minimumStand: '2026-10', maximumPercent: 50, home: 'residence' } } };
    return next;
}

// Der bisherige Export bezeichnet weiter die Voreinstellung.
export const MUSTER_PROFILE_IDS = Object.freeze(STECKBRIEFE[DEFAULT_MUSTER_HAUSHALT].people.map(person => person.id));

/** Musterbeleg aus derselben Jahresrechnung wie im Abschluss, nur in privaten Records. */
function addMusterAnnualPlan(records, year, values, scope) {
    const asOf = `${year}-01-01`, committedAt = parseCalendarDate(asOf).toISOString();
    const registry = JSON.parse(records.rs_profiles_v1), historical = { ...records };
    for (const profile of Object.values(registry.profiles)) {
        const lots = JSON.parse(profile.data.depot_tranchen).map(lot => {
            const quote = syntheticQuote(lot.ticker, asOf);
            return { ...lot, currentPrice: quote.price, asOf: quote.asOf };
        });
        profile.data.depot_tranchen = JSON.stringify(lots);
    }
    historical.rs_profiles_v1 = JSON.stringify(registry);
    historical.depot_tranchen = registry.profiles[records.rs_active_profile].data.depot_tranchen;
    const ageByPerson = Object.fromEntries(Object.entries(registry.profiles)
        .map(([id, profile]) => [id, projectPerson(profile.data, year).startAlter]));
    const { outcome } = /** @type {(draft: Pick<import("../../typcheck/speicher-integration.js").AnnualDraft, "records"|"planningYear"|"scope"|"values"|"ageByPerson">, options: import("../../typcheck/speicher-integration.js").AnnualOptions)=>ReturnType<typeof evaluateAnnualDraft>} */ (evaluateAnnualDraft)({ records: historical, planningYear: year, scope, values, ageByPerson },
        { engineApi: EngineAPI, now: () => parseCalendarDate(asOf) });
    /** @type {typeof outcome.snapshot & {source?: string; asOf?: string}} */ (outcome.snapshot).source = 'Beispieldaten (Spielbereich)';
    /** @type {typeof outcome.snapshot & {source?: string; asOf?: string}} */ (outcome.snapshot).asOf = asOf;
    outcome.action.title += ' · Beispieldaten (Spielbereich)';
    for (const source of outcome.action.quellen || []) {
        const name = registry.profiles[/** @type {string} */ (source.sourceProfileId)]?.meta.name;
        if (name) source.sourceProfileName ||= name;
    }
    records[ANNUAL_PLAN_RECORD_KEY] = buildAnnualPlanRecord(null, { targetYear: year - 1, scope,
        committedAt, recommended: outcome }).raw;
    // Die vorbereiteten Monatsinformationen verwenden denselben festen Jahresbetrag.
    const currentRegistry = JSON.parse(records.rs_profiles_v1);
    for (const [id, profile] of Object.entries(currentRegistry.profiles)) {
        const raw = profile.data.overview_balance_summary_v1, summaries = JSON.parse(raw);
        Object.assign(summaries.entries[summaryEntryKey(year, scope)], {
            monthlyWithdrawal: outcome.monthlyWithdrawal, monthlyBudget: outcome.monthlyBudget, createdAt: committedAt
        });
        profile.data.overview_balance_summary_v1 = JSON.stringify(summaries);
        if (id === records.rs_active_profile) records.overview_balance_summary_v1 = profile.data.overview_balance_summary_v1;
    }
    records.rs_profiles_v1 = JSON.stringify(currentRegistry);
}

/** WT-1 (FR-77): Variante „Plan teilweise umgesetzt“. Die erste Person hat ihre Planzeile verkauft und gutgeschrieben, die zweite
 * ein gutes Drittel ihrer Zeile, die Gutschrift aufs Tagesgeld ist noch offen. Verkaufsbelege wie nach „Verkauf eintragen“
 * (Stücke weniger, bestätigter Verkauf in der Registry); Datum spätestens am Testdatum.
 * @param {Record<string, string>} records @param {string} testDate */
function addMusterPlanSales(records, testDate) {
    const year = testDate.slice(0, 4), registry = JSON.parse(records.rs_profiles_v1);
    const entry = Object.values(JSON.parse(records[ANNUAL_PLAN_RECORD_KEY]).entries)[0];
    const lines = (entry.adopted.action.quellen || []).filter(source => source.sourceProfileId && source.trancheId && source.netto > 0
        && !['liquiditaet', 'cash'].includes(source.kind));
    const day = date => date < testDate ? date : testDate;
    // Belegquellen tragen die Tranche mit Personenpräfix („person:tranche“).
    const sales = lines.slice(0, 2).map((source, index) => ({ profileId: source.sourceProfileId, trancheId: String(source.trancheId).split(':').pop(),
        net: index === 0 ? Math.round(source.netto) : Math.round(source.netto * 0.38), executedAt: day(index === 0 ? `${year}-03-12` : `${year}-09-02`), pending: index > 0 }));
    const actions = [];
    for (const [index, sale] of sales.entries()) {
        const data = registry.profiles[sale.profileId].data;
        const cash = Number(data.profile_tagesgeld) + (sale.pending ? 0 : sale.net);
        data.profile_tagesgeld = String(cash);
        const tranches = JSON.parse(data.depot_tranchen), lot = tranches.find((/** @type {any} */ item) => item.trancheId === sale.trancheId);
        if (!lot) continue;
        const sold = sale.net / lot.currentPrice, before = lot.shares;
        lot.shares = before - sold;
        if ('marketValue' in lot) lot.marketValue = lot.shares * lot.currentPrice;
        data.depot_tranchen = JSON.stringify(tranches);
        actions.push({ schemaVersion: 1, eventType: 'sale_reconciled', actionId: `muster-plan-verkauf-${index + 1}`, profileId: sale.profileId, trancheId: sale.trancheId,
            executedAt: sale.executedAt, actual: { sharesSold: sold, grossProceeds: sale.net, fees: 0, taxes: 0, netProceeds: sale.net },
            ...(sale.pending ? { cashStatus: 'pending_manual_posting' } : { cashStatus: 'confirmed_already_reflected', cashBalanceAfterPostingEur: cash,
                cashConfirmedAt: `${sale.executedAt}T10:00:00.000Z` }),
            result: { beforeShares: before, remainingShares: lot.shares, trancheRemoved: false }, reconciledAt: `${sale.executedAt}T10:00:00.000Z` });
    }
    registry.trancheReconciliation = { schemaVersion: 1, actions };
    const active = registry.profiles[records.rs_current_profile].data;
    records.profile_tagesgeld = active.profile_tagesgeld; records.depot_tranchen = active.depot_tranchen;
    records.rs_profiles_v1 = JSON.stringify(registry);
}

/** Reproduzierbare Records, ohne echte Daten, Migration, Netzwerk oder Schreibzugriff.
 *
 * @param {string} testDate
 * @param {string} [householdId]
 * @param {string} [variantId]
 * @returns Ergebnis der bestehenden Projektion.
 */
export function createMusterHaushaltRecords(testDate, householdId = DEFAULT_MUSTER_HAUSHALT, variantId = 'grund') {
    // Die Variante bestimmt auch den Marktverlauf der Spielkurse (AR-3); andere Varianten bleiben bytegleich.
    return withSyntheticMarketScenario(musterMarktverlauf(householdId, variantId), () => createRecords(testDate, householdId, variantId));
}

/** @param {string} testDate @param {string} householdId @param {string} variantId */
function createRecords(testDate, householdId, variantId) {
    let household = householdVariant(householdId, variantId);
    const ids = household.people.map(person => person.id), mode = ids.length === 1 ? 'single' : 'household';
    const now = validateMusterTestDate(testDate), year = now.getFullYear(), offset = year - 2026;
    const shiftedDate = date => `${Number(date.slice(0, 4)) + offset}${date.slice(4)}`;
    const startDate = `${year - 1}-01-01`, scope = overviewScope(mode, ids);
    const januaryDate = `${year}-01-01`, confirmationDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    if (household.valuationAtYearStart) {
        const valueToday = (value, ticker) => value * syntheticQuote(ticker, testDate).price / syntheticQuote(ticker, januaryDate).price;
        household = { ...household, people: household.people.map(person => ({ ...person,
            lots: person.lots.map((value, index) => valueToday(value, ['VWRL.DE', 'VWCE.DE', 'XEON.DE'][index])),
            ...(person.gold ? { gold: valueToday(person.gold, '4GLD.DE') } : {}),
            ...(person.bonds ? { bonds: valueToday(person.bonds, 'EUNH.DE') } : {}) })) };
    }
    const completedAt = new Date(year, now.getMonth(), 1, 12).toISOString();
    const month = previousOverviewMonth(now).month;
    const registry = { version: 1, profiles: {} };
    const expenses = { version: 1, activeYear: year, years: {} };
    // Vollständige Musterentscheidung mit den bisher effektiv gelesenen Werten.
    // Keine abweichenden Altaliase oder Ergänzung durch globale Planvorgaben.
    /** @type {import("../../typcheck/datenvertraege.js").PlanValues} */
    const planValues = {
        ...(household.jointAssessment ? { jointAssessment: true } : {}),
        floorBedarf: household.floorBedarf, flexBedarf: household.flexBedarf, minimumFlexAnnual: household.minimumFlexAnnual,
        flexBudgetAnnual: 0, flexBudgetYears: 0, flexBudgetRecharge: 0,
        liquidityRunwayYears: 5, minCashBufferMonths: 2,
        maxSkimPctOfEq: household.maxSkimPctOfEq ?? 0, maxBearRefillPctOfEq: household.maxBearRefillPctOfEq ?? 0,
        decumulation: household.decumulation || { mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null },
        dynamicFlex: household.dynamicFlex === true, horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: 0.85,
        goGoActive: false, goGoMultiplier: 1, longevityMode: 'none', longevityQuantileShift: 0.05,
        longevityRelativePct: 0.05, longevityBufferYears: 2, householdWithdrawalMode: household.householdWithdrawalMode || 'tax_optimized',
        cape: { value: 25, asOf: null, source: null }
    };
    // Der historische Balance-Dateivertrag bleibt flach. Nur Zahlen, die dort
    // bisher fehlten und abweichende Readerdefaults hatten, werden ergänzt.
    const planInputs = Object.fromEntries(Object.entries(projectPlanToBalance(planValues)).filter(([key]) => [
        'floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetYears', 'flexBudgetRecharge',
        'liquidityRunwayYears', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq', 'goGoMultiplier', 'capeRatio'
    ].includes(key)));
    const totals = household.people.reduce((sum, person) => ({ tagesgeld: sum.tagesgeld + person.cash,
        depotwertAlt: sum.depotwertAlt + person.lots[0], depotwertNeu: sum.depotwertNeu + person.lots[1] + (person.bonds || 0),
        geldmarktEtf: sum.geldmarktEtf + person.lots[2] }), { tagesgeld: 0, depotwertAlt: 0, depotwertNeu: 0, geldmarktEtf: 0 });
    if (household.gold) Object.assign(totals, { goldBestand: household.people.reduce((sum, person) => sum + person.gold, 0),
        goldWert: household.people.reduce((sum, person) => sum + person.gold, 0) });
    const capturesByDate = new Map();
    for (const person of household.people) {
        const { id, name, cash } = person;
        const tranches = [
            ['aktien_alt', 'VWRL.DE', 'IE00B3RBWM25', person.lots[0], '2016-06-15'],
            ['aktien_neu', 'VWCE.DE', 'IE00BK5BQT80', person.lots[1], person.newPurchaseDate],
            ['geldmarkt', 'XEON.DE', 'LU0290358497', person.lots[2], '2024-04-12'],
            ['anleihe', 'EUNH.DE', 'IE00B4WXJJ64', person.bonds || 0, '2020-05-18'],
            ['gold', '4GLD.DE', 'DE000A0S9GB0', person.gold || 0, '2022-03-15']
        ].filter(([, , , value]) => value > 0).map(([type, ticker, isin, value, purchaseDate], n) => {
            if (type !== 'aktien_alt') purchaseDate = shiftedDate(purchaseDate);
            const quote = syntheticQuote(ticker, testDate);
            const category = { geldmarkt: 'money_market', anleihe: 'bonds', gold: 'gold' }[type] || 'equity';
            const lotName = { geldmarkt: 'Muster Geldmarkt', anleihe: 'iShares Core € Govt Bond ETF', gold: 'Xetra-Gold ETC' }[type] || 'Muster Aktien-ETF';
            return { schemaVersion: 2, trancheId: `${id}_lot_${n + 1}`, name: lotName,
                type, category, ticker, isin,
                shares: value / quote.price, purchasePrice: person.equityCostBasis !== undefined && category === 'equity'
                    ? person.equityCostBasis / (value / quote.price) : syntheticQuote(ticker, purchaseDate).price,
                currentPrice: quote.price, asOf: quote.asOf, purchaseDate, tqf: category === 'equity' ? 0.3 : 0,
                taxExempt: category === 'gold', notes: 'Synthetischer Musterbestand' };
        });
        normalizeTrancheCollection(tranches, { mode: 'persisted' });
        const market = type => tranches.filter(lot => lot.type === type).reduce((sum, lot) => sum + lot.shares * lot.currentPrice, 0);
        const inputs = { profilName: name, tagesgeld: cash, geldmarktEtf: market('geldmarkt'), depotwertAlt: market('aktien_alt'), depotwertNeu: market('aktien_neu') + market('anleihe'),
            ...planInputs, inflation: 2,
            endeVJ: 0, endeVJ_1: 0, endeVJ_2: 0, endeVJ_3: 0, ath: 0, jahreSeitAth: 0,
            goldAktiv: Boolean(household.gold), goldBestand: market('gold'), goldZielProzent: household.gold?.target || 0, goldFloorProzent: household.gold?.floor || 0,
            rebalancingBand: household.gold?.band || 25,
            ...(household.gold ? { goldWert: market('gold'), goldSteuerfrei: true } : {}) };
        for (let n = 0; n < 4; n++) inputs[n ? `endeVJ_${n}` : 'endeVJ'] = Math.round(syntheticAnnualQuote('VWCE.DE', year - 1 - n, testDate).price);
        inputs.ath = Math.max(inputs.endeVJ, inputs.endeVJ_1, inputs.endeVJ_2, inputs.endeVJ_3);
        // Historische Stände verwenden dieselben Stücke, aber die damaligen Kurse und Cashwerte.
        const historicalInputs = (date, historicalCash) => {
            const value = type => tranches.filter(lot => lot.type === type && lot.purchaseDate <= date)
                .reduce((sum, lot) => sum + lot.shares * syntheticQuote(lot.ticker, date).price, 0);
            return { tagesgeld: historicalCash, geldmarktEtf: value('geldmarkt'),
                depotwertAlt: value('aktien_alt'), depotwertNeu: value('aktien_neu') + value('anleihe'), goldBestand: value('gold'),
                ...(household.gold ? { goldWert: value('gold') } : {}) };
        };
        const entries = [];
        const historicalEntry = (date, historicalCash, annualYear = null) => {
            const historical = historicalInputs(date, historicalCash);
            const entry = annualYear === null ? createManualWealthHistoryEntry(historical, date)
                : createAnnualWealthHistoryEntry(historical, annualYear);
            if (!person.bonds && !person.gold) return entry;
            const anleihen = tranches.filter(lot => lot.category === 'bonds' && lot.purchaseDate <= date)
                .reduce((sum, lot) => sum + lot.shares * syntheticQuote(lot.ticker, date).price, 0);
            return { ...entry, depotwertNeu: entry.depotwertNeu - anleihen, aktienEtf: entry.aktienEtf - anleihen,
                goldWert: historical.goldBestand, anleihen, total: entry.total + historical.goldBestand };
        };
        if (year > 2026) entries.push(historicalEntry(`${year - 1}-12-31`, cash - 1000, year - 1));
        entries.push(historicalEntry(januaryDate, cash));
        for (const entry of entries) {
            if (!capturesByDate.has(entry.asOf)) capturesByDate.set(entry.asOf, { capturedAt: now.toISOString(), people: {} });
            capturesByDate.get(entry.asOf).people[id] = entry;
        }
        const summary = { year, scope, monthlyWithdrawal: 0, monthlyBudget: 0, status: 'fest', createdAt: now.toISOString() };
        const state = { inputs, profilverbundHouseholdInputs: { ...inputs, ...totals },
            annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${year - 1}`, pendingCommit: null },
            lastState: { cumulativeInflationFactor: 1 },
            wealthHistory: { schemaVersion: 1, entries: [] } };
        const data = { [INCOME_KEY]: writeIncome([
            ...(person.income || []).map(entry => ({ ...entry, ab: entry.ab && shiftedDate(entry.ab), bis: entry.bis && shiftedDate(entry.bis) })),
            ...(person.inflows || []).map(({ offset, amount, label }, index) => ({
                id: `muster-einmalig-${index + 1}`, monat: `${year + offset}-01`, betrag: amount, bezeichnung: label }))]),
            [INCOME_MIGRATION_KEY]: '1',
            ...(person.properties ? { [IMMOBILIEN_KEY]: writeImmobilien(person.properties.map(entry => ({ ...entry, stand: testDate.slice(0, 7) }))) } : {}),
            ...(person.careGrade ? { profile_care_grade_today: String(person.careGrade), profile_care_form_today: person.careForm || 'family' } : {}),
            profile_person_schema_version: '1', profile_geburtsdatum: shiftedDate(person.birthDate),
            profile_geschlecht: person.sex, profile_rentenbeginn: shiftedDate(person.pensionStart),
            profile_rentenanpassung_art: 'cpi', profile_rentenanpassung_pct: '0', profile_kirchensteuer_pct: String(household.churchTax || 0),
            profile_sparer_pauschbetrag: '1000', profile_rente_steuerquote_pct: '80',
            profile_rente_monatlich: String(person.pension), profile_tagesgeld: String(cash),
            profile_gold_aktiv: String(Boolean(household.gold)), profile_gold_steuerfrei: String(Boolean(household.gold)),
            profile_gold_ziel_pct: String(household.gold?.target || 0), profile_gold_floor_pct: String(household.gold?.floor || 0), profile_gold_rebal_band: String(household.gold?.band || 25),
            ...(household.careReserve ? { [PROFILE_HEALTH_BUCKET_KEY]: JSON.stringify({ ...DEFAULT_PROFILE_HEALTH_BUCKET,
                enabled: true, initialAmount: household.careReserve }) } : {}),
            profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: cash - 2000, entries: [
                { date: startDate, value: cash - 1000 }, { date: januaryDate, value: cash },
                ...(confirmationDate === januaryDate ? [] : [{ date: confirmationDate, value: cash }])] }),
            profile_wealth_history_lots_v1: JSON.stringify(captureWealthLots(null, tranches, startDate)),
            depot_tranchen: JSON.stringify(tranches), [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state),
            overview_balance_summary_v1: JSON.stringify({ version: 1, entries: { [summaryEntryKey(year, scope)]: summary } }),
            overview_month_provision_v1: JSON.stringify({ version: 1, entries: { [JSON.stringify([month, scope.key])]: { month, scope, completedAt } } }) };
        registry.profiles[id] = { meta: { id, name, belongsToHousehold: true, createdAt: `${startDate}T12:00:00Z`, updatedAt: `${startDate}T12:00:00Z` }, data };
    }
    const annualScope = planScope(mode, ids);
    const records = rebuildSyntheticPriceRecords({ rs_profiles_v1: JSON.stringify(registry), rs_current_profile: ids[0], rs_active_profile: ids[0],
        household_plan_v1: buildPlanRecord(null, [{ scope: annualScope, values: planValues }], { now: () => now }).raw,
        ...registry.profiles[ids[0]].data, rs_wealth_history_start_v1: JSON.stringify({ version: 1, startDate }), balance_expenses_v1: JSON.stringify(expenses),
        household_simulator_needs_v1: JSON.stringify({ schemaVersion: 1, mode: 'override', source: 'manual', overriddenFields: ['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual'],
            values: { startFloorBedarf: String(planValues.floorBedarf), startFlexBedarf: String(planValues.flexBedarf), minimumFlexAnnual: String(planValues.minimumFlexAnnual) } }) }, testDate);
    records[WEALTH_CAPTURES_KEY] = JSON.stringify(assertWealthCaptures({ schemaVersion: 1,
        captures: [...capturesByDate.values()].map(capture => {
            const first = Object.values(capture.people)[0];
            // Alt-Eintragskonstruktoren lassen optionale Anlagearten weg.
            for (const person of Object.values(capture.people)) for (const field of CAPTURE_AMOUNT_FIELDS) person[field] ??= 0;
            return { ...capture, household: { ...first, ...Object.fromEntries(CAPTURE_AMOUNT_FIELDS.map(field =>
                [field, Object.values(capture.people).reduce((sum, person) => sum + person[field], 0)])) } };
        }) }));
    if (household.plannedExpenses) records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: {
        [annualScope.key]: { scope: annualScope, items: household.plannedExpenses.map(entry => entry.monat ? { ...entry, monat: shiftedDate(entry.monat) }
            : { ...entry, ab: entry.ab && shiftedDate(entry.ab), bis: entry.bis && shiftedDate(entry.bis) }) }
    } });
    if (household.partnership) {
        const partnership = structuredClone(household.partnership);
        for (const rule of Object.values(partnership.testament || {})) if (rule.minimumStand) rule.minimumStand = shiftedDate(rule.minimumStand);
        records[PARTNERSHIP_KEY] = JSON.stringify(partnership);
    }
    for (const [grade, form] of Object.entries(household.careForms || {})) records[`sim_pflegeStufe${grade}Form`] = form;
    addMusterAnnualPlan(records, year, planValues, annualScope);
    if (householdId === 'max-erika' && variantId === 'teilweise') addMusterPlanSales(records, testDate);
    // Vorjahr und abgelaufene Monate zeigen das Wunschbudget; der Startmonat bleibt offen.
    const categoryEntries = Object.entries(household.categories), weight = categoryEntries.reduce((sum, [, value]) => sum + value, 0);
    const personBudget = Math.round((planValues.floorBedarf + planValues.flexBedarf) / 12 * 100 / ids.length);
    const categories = Object.fromEntries(categoryEntries.map(([name, value]) => [name, -Math.round(personBudget * value / weight) / 100]));
    const categoryNeeds = splitExampleExpenseNeeds(categories, household.floorBedarf * 1.06 / (household.floorBedarf + household.flexBedarf));
    for (let y = year - 1; y <= year; y++) {
        const months = {};
        for (let month = 1; month <= (y < year ? 12 : now.getMonth()); month++) months[month] = { profiles:
            Object.fromEntries(ids.map(id => [id, { categories: { ...categories }, categoryNeeds: structuredClone(categoryNeeds), importedAt: `${y}-${String(month).padStart(2, '0')}-28T12:00:00Z` }])) };
        expenses.years[y] = { months };
    }
    records.balance_expenses_v1 = JSON.stringify(expenses);
    const validation = validatePersistenceDomainRecords(records, { requireProfileContext: true });
    if (!validation.ok) throw new Error(`Muster-Haushalt ungültig: ${validation.message}`);
    return records;
}
