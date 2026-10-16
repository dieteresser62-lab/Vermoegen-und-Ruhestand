import { rebuildSyntheticPriceRecords, validateMusterTestDate } from './muster-haushalt-prices.js';
export { rebuildSyntheticPriceRecords, validateMusterTestDate } from './muster-haushalt-prices.js';
import { buildPlanRecord, planScope, projectPlanToBalance } from '../profile/household-plan.js';
import { CONFIG } from '../balance/balance-config.js';
import { parseCalendarDate } from '../shared/app-clock.js';
import { syntheticQuote, syntheticAnnualQuote } from '../shared/probelauf-prices.js';
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
import { musterHaushalt, DEFAULT_MUSTER_HAUSHALT } from './muster-haushalte.js';
import { DEFAULT_PROFILE_HEALTH_BUCKET, PROFILE_HEALTH_BUCKET_KEY } from '../profile/profile-state.js';

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
        categories: { Wohnen: 50, Alltag: 40, Reisen: 10 },
        people: [
            { id: 'muster_renate', name: 'Renate', birthDate: '1959-01-01', sex: 'w', pensionStart: '2025-01-01', pension: 1400,
                cash: 15000, lots: [70000, 75000, 45000], bonds: 145000, newPurchaseDate: '2020-05-18' }
        ]
    },
    'jan-lena': {
        // Geschützter Flex hält den Start ungekürzt; anteilige Entnahme versorgt beide Tagesgeldkonten.
        floorBedarf: 36000, flexBedarf: 27000, minimumFlexAnnual: 27000,
        householdWithdrawalMode: 'proportional',
        // Feste Januarstücke halten die vorbereitete Jahresrechnung bei jedem Startdatum gleich.
        // Die Depotgröße finanziert auch mit Dynamic Flex die gerundeten 5.250 € monatlich.
        valuationAtYearStart: true,
        dynamicFlex: true, gold: { target: 10, floor: 5, band: 20 },
        categories: { Wohnen: 45, Alltag: 30, Reisen: 25 },
        people: [
            { id: 'muster_jan', name: 'Jan', birthDate: '1968-01-01', sex: 'm', pensionStart: '2035-01-01', pension: 2100,
                cash: 35000, lots: [300000, 285000, 0], gold: 65000, newPurchaseDate: '2020-05-18' },
            { id: 'muster_lena', name: 'Lena', birthDate: '1970-01-01', sex: 'w', pensionStart: '2037-01-01', pension: 1500,
                cash: 25000, lots: [220000, 200793.2, 0], gold: 46754.8, newPurchaseDate: '2021-02-14' }
        ]
    },
    'helga-werner': {
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
    const { outcome } = evaluateAnnualDraft({ records: historical, planningYear: year, scope, values, ageByPerson },
        { engineApi: EngineAPI, now: () => parseCalendarDate(asOf) });
    outcome.snapshot.source = 'Beispieldaten (Spielbereich)';
    outcome.snapshot.asOf = asOf;
    outcome.action.title += ' · Beispieldaten (Spielbereich)';
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

/** Reproduzierbare Records, ohne echte Daten, Migration, Netzwerk oder Schreibzugriff. */
export function createMusterHaushaltRecords(testDate, householdId = DEFAULT_MUSTER_HAUSHALT) {
    let household = STECKBRIEFE[musterHaushalt(householdId).id];
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
    const planValues = {
        floorBedarf: household.floorBedarf, flexBedarf: household.flexBedarf, minimumFlexAnnual: household.minimumFlexAnnual,
        flexBudgetAnnual: 0, flexBudgetYears: 0, flexBudgetRecharge: 0,
        liquidityRunwayYears: 5, minCashBufferMonths: 2, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0,
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
                shares: value / quote.price, purchasePrice: syntheticQuote(ticker, purchaseDate).price,
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
        const summary = { year, scope, monthlyWithdrawal: 0, monthlyBudget: 0, status: 'fest', createdAt: now.toISOString() };
        const state = { inputs, profilverbundHouseholdInputs: { ...inputs, ...totals },
            annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${year - 1}`, pendingCommit: null },
            lastState: { cumulativeInflationFactor: 1 },
            wealthHistory: { schemaVersion: 1, entries } };
        const data = { profile_person_schema_version: '1', profile_geburtsdatum: shiftedDate(person.birthDate),
            profile_geschlecht: person.sex, profile_rentenbeginn: shiftedDate(person.pensionStart),
            profile_rentenanpassung_art: 'wage', profile_rentenanpassung_pct: '0', profile_kirchensteuer_pct: String(household.churchTax || 0),
            profile_sparer_pauschbetrag: '1000', profile_rente_steuerquote_pct: '80',
            profile_rente_monatlich: String(person.pension), profile_sonstige_einkuenfte: '0', profile_tagesgeld: String(cash),
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
    addMusterAnnualPlan(records, year, planValues, annualScope);
    // Vorjahr und abgelaufene Monate zeigen das Wunschbudget; der Startmonat bleibt offen.
    const categoryEntries = Object.entries(household.categories), weight = categoryEntries.reduce((sum, [, value]) => sum + value, 0);
    const personBudget = Math.round((planValues.floorBedarf + planValues.flexBedarf) / 12 * 100 / ids.length);
    const categories = Object.fromEntries(categoryEntries.map(([name, value]) => [name, -Math.round(personBudget * value / weight) / 100]));
    for (let y = year - 1; y <= year; y++) {
        const months = {};
        for (let month = 1; month <= (y < year ? 12 : now.getMonth()); month++) months[month] = { profiles:
            Object.fromEntries(ids.map(id => [id, { categories: { ...categories }, importedAt: `${y}-${String(month).padStart(2, '0')}-28T12:00:00Z` }])) };
        expenses.years[y] = { months };
    }
    records.balance_expenses_v1 = JSON.stringify(expenses);
    const validation = validatePersistenceDomainRecords(records, { requireProfileContext: true });
    if (!validation.ok) throw new Error(`Muster-Haushalt ungültig: ${validation.message}`);
    return records;
}
