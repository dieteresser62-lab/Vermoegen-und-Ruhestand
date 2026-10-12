import { addDirectHouseholdPlans } from '../profile/household-plan-migration.js';
import { buildPlanRecord, planScope, projectPlanToBalance } from '../profile/household-plan.js';
import { CONFIG } from '../balance/balance-config.js';
import { parseCalendarDate } from '../shared/app-clock.js';
import { syntheticQuote, syntheticChart, syntheticDay, syntheticAnnualQuote } from '../shared/probelauf-prices.js';
import { normalizeTrancheCollection } from '../../types/tranche-contract.js';
import { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry } from '../../types/wealth-history-contract.js';
import { captureWealthLots } from '../profile/profile-wealth-history.js';
import { overviewScope, summaryEntryKey } from '../overview/overview-storage.js';
import { previousOverviewMonth } from '../overview/overview-model.js';
import { validatePersistenceDomainRecords } from '../shared/persistence-backup.js';
import { isProbelaufRecordKey } from '../shared/persistence-key-policy.js';

export const MUSTER_PROFILE_IDS = Object.freeze(['muster_a', 'muster_b']);
export function validateMusterTestDate(testDate) {
    const now = parseCalendarDate(testDate);
    if (testDate < '2026-01-01') throw new Error('Der Muster-Haushalt ist ab 01.01.2026 verfügbar.');
    return now;
}

/** Neue Kursgeneration für Kopie/Datumssprung; keine Veränderung bestätigter Abschlüsse. */
export function rebuildSyntheticPriceRecords(records, testDate) {
    const next = { ...records };
    const registry = records.rs_profiles_v1 ? JSON.parse(records.rs_profiles_v1) : null;
    const active = records.rs_active_profile;
    const start = records.rs_wealth_history_start_v1 ? JSON.parse(records.rs_wealth_history_start_v1).startDate : null;
    const prices = { version: 1, symbols: {} };
    const projectLots = raw => JSON.stringify(normalizeTrancheCollection(JSON.parse(raw || '[]'), { mode: 'persisted' }).map(lot => {
        if (!lot.ticker && !lot.isin) { const copy = { ...lot, currentPrice: lot.purchasePrice }; delete copy.asOf; return copy; }
        let quote;
        try { quote = syntheticQuote(lot.ticker || lot.isin, testDate); }
        catch { const copy = { ...lot, currentPrice: lot.purchasePrice }; delete copy.asOf; return copy; }
        if (start && start <= testDate && !prices.symbols[quote.symbol]) {
            const chart = syntheticChart(quote.symbol, [syntheticDay(start), syntheticDay(testDate)], testDate);
            prices.symbols[quote.symbol] = { currency: 'EUR', days: chart.days, closes: chart.closes,
                queried: [chart.interval], failures: 0, lastError: null };
        }
        return { ...lot, ticker: quote.symbol, currentPrice: quote.price, asOf: quote.asOf };
    }));
    if (registry) {
        for (const [id, profile] of Object.entries(registry.profiles)) {
            const raw = id === active ? records.depot_tranchen : profile.data.depot_tranchen;
            if (raw !== undefined) profile.data.depot_tranchen = projectLots(raw);
            if (id === active && raw !== undefined) next.depot_tranchen = profile.data.depot_tranchen;
        }
        next.rs_profiles_v1 = JSON.stringify(registry);
    } else if (records.depot_tranchen !== undefined) next.depot_tranchen = projectLots(records.depot_tranchen);
    next.rs_daily_prices_v1 = JSON.stringify(prices);
    return addDirectHouseholdPlans(next, { now: () => parseCalendarDate(testDate) });
}

/** Reproduzierbare Records, ohne echte Daten, Migration, Netzwerk oder Schreibzugriff. */
export function createMusterHaushaltRecords(testDate) {
    const now = validateMusterTestDate(testDate), year = now.getFullYear(), offset = year - 2026;
    const shiftedDate = date => `${Number(date.slice(0, 4)) + offset}${date.slice(4)}`;
    const startDate = `${year - 1}-01-01`, scope = overviewScope('household', MUSTER_PROFILE_IDS);
    const januaryDate = `${year}-01-01`, confirmationDate = `${year}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const completedAt = new Date(year, now.getMonth(), 1, 12).toISOString();
    const month = previousOverviewMonth(now).month;
    const registry = { version: 1, profiles: {} };
    const expenses = { version: 1, activeYear: year, years: {} };
    // Vollständige Musterentscheidung mit den bisher effektiv gelesenen Werten.
    // Keine abweichenden Altaliase oder Ergänzung durch globale Planvorgaben.
    const planValues = {
        floorBedarf: 30000, flexBedarf: 30000, minimumFlexAnnual: 7500,
        flexBudgetAnnual: 0, flexBudgetYears: 0, flexBudgetRecharge: 0,
        liquidityRunwayYears: 5, minCashBufferMonths: 2, maxSkimPctOfEq: 0, maxBearRefillPctOfEq: 0,
        decumulation: { mode: 'standard', bondTargetFactor: 5, drawdownTrigger: 15, bondRefillThreshold: null },
        dynamicFlex: false, horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: 0.85,
        goGoActive: false, goGoMultiplier: 1, longevityMode: 'none', longevityQuantileShift: 0.05,
        longevityRelativePct: 0.05, longevityBufferYears: 2, householdWithdrawalMode: 'tax_optimized',
        cape: { value: 25, asOf: null, source: null }
    };
    // Der historische Balance-Dateivertrag bleibt flach. Nur Zahlen, die dort
    // bisher fehlten und abweichende Readerdefaults hatten, werden ergänzt.
    const planInputs = Object.fromEntries(Object.entries(projectPlanToBalance(planValues)).filter(([key]) => [
        'floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'flexBudgetAnnual', 'flexBudgetYears', 'flexBudgetRecharge',
        'liquidityRunwayYears', 'maxSkimPctOfEq', 'maxBearRefillPctOfEq', 'goGoMultiplier', 'capeRatio'
    ].includes(key)));
    // Vorjahr und abgelaufene Monate sind vorbereitet; der Startmonat bleibt offen.
    for (let y = year - 1; y <= year; y++) {
        const months = {};
        for (let month = 1; month <= (y < year ? 12 : now.getMonth()); month++) months[month] = { profiles:
            Object.fromEntries(MUSTER_PROFILE_IDS.map(id => [id, { categories: { Wohnen: -1250, Alltag: -850, Reisen: -400 }, importedAt: `${y}-${String(month).padStart(2, '0')}-28T12:00:00Z` }])) };
        expenses.years[y] = { months };
    }
    for (const [index, id] of MUSTER_PROFILE_IDS.entries()) {
        const name = index === 0 ? 'Max' : 'Erika', cash = index === 0 ? 18000 : 12000;
        const tranches = [
            ['aktien_alt', 'VWRL.DE', 'IE00B3RBWM25', index === 0 ? 180000 : 160000, '2016-06-15'],
            ['aktien_neu', 'VWCE.DE', 'IE00BK5BQT80', 180000, index === 0 ? '2020-05-18' : '2025-02-14'],
            ['geldmarkt', 'XEON.DE', 'LU0290358497', index === 0 ? 36000 : 24000, '2024-04-12']
        ].map(([type, ticker, isin, value, purchaseDate], n) => {
            if (type !== 'aktien_alt') purchaseDate = shiftedDate(purchaseDate);
            const quote = syntheticQuote(ticker, testDate);
            return { schemaVersion: 2, trancheId: `${id}_lot_${n + 1}`, name: type === 'geldmarkt' ? 'Muster Geldmarkt' : 'Muster Aktien-ETF',
                type, category: type === 'geldmarkt' ? 'money_market' : 'equity', ticker, isin,
                shares: value / quote.price, purchasePrice: syntheticQuote(ticker, purchaseDate).price,
                currentPrice: quote.price, asOf: quote.asOf, purchaseDate, tqf: type === 'geldmarkt' ? 0 : 0.3,
                taxExempt: false, notes: 'Synthetischer Musterbestand' };
        });
        normalizeTrancheCollection(tranches, { mode: 'persisted' });
        const market = type => tranches.filter(lot => lot.type === type).reduce((sum, lot) => sum + lot.shares * lot.currentPrice, 0);
        const inputs = { profilName: name, tagesgeld: cash, geldmarktEtf: market('geldmarkt'), depotwertAlt: market('aktien_alt'), depotwertNeu: market('aktien_neu'),
            ...planInputs, inflation: 2,
            endeVJ: 0, endeVJ_1: 0, endeVJ_2: 0, endeVJ_3: 0, ath: 0, jahreSeitAth: 0,
            goldAktiv: false, goldBestand: 0, goldZielProzent: 0, goldFloorProzent: 0,
            rebalancingBand: 25 };
        for (let n = 0; n < 4; n++) inputs[n ? `endeVJ_${n}` : 'endeVJ'] = Math.round(syntheticAnnualQuote('VWCE.DE', year - 1 - n, testDate).price);
        inputs.ath = Math.max(inputs.endeVJ, inputs.endeVJ_1, inputs.endeVJ_2, inputs.endeVJ_3);
        // Historische Stände verwenden dieselben Stücke, aber die damaligen Kurse und Cashwerte.
        const historicalInputs = (date, historicalCash) => {
            const value = type => tranches.filter(lot => lot.type === type && lot.purchaseDate <= date)
                .reduce((sum, lot) => sum + lot.shares * syntheticQuote(lot.ticker, date).price, 0);
            return { tagesgeld: historicalCash, geldmarktEtf: value('geldmarkt'),
                depotwertAlt: value('aktien_alt'), depotwertNeu: value('aktien_neu'), goldBestand: 0 };
        };
        const entries = [];
        if (year > 2026) entries.push(createAnnualWealthHistoryEntry(historicalInputs(`${year - 1}-12-31`, cash - 1000), year - 1));
        entries.push(createManualWealthHistoryEntry(historicalInputs(januaryDate, cash), januaryDate));
        const summary = { year, scope, monthlyWithdrawal: 2700, monthlyBudget: 5000, status: 'fest', createdAt: now.toISOString() };
        const state = { inputs, profilverbundHouseholdInputs: { ...inputs, tagesgeld: 30000, geldmarktEtf: 60000, depotwertAlt: 340000, depotwertNeu: 360000 },
            annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${year - 1}`, pendingCommit: null },
            lastState: { cumulativeInflationFactor: 1 },
            wealthHistory: { schemaVersion: 1, entries } };
        const data = { profile_person_schema_version: '1', profile_geburtsdatum: shiftedDate(index === 0 ? '1958-03-14' : '1961-08-22'),
            profile_geschlecht: index === 0 ? 'm' : 'w', profile_rentenbeginn: shiftedDate(index === 0 ? '2023-01-01' : '2027-07-01'),
            profile_rentenanpassung_art: 'wage', profile_rentenanpassung_pct: '0', profile_kirchensteuer_pct: '0',
            profile_sparer_pauschbetrag: '1000', profile_rente_steuerquote_pct: '80',
            profile_rente_monatlich: index === 0 ? '2300' : '1600', profile_sonstige_einkuenfte: '0', profile_tagesgeld: String(cash),
            profile_gold_aktiv: 'false', profile_gold_steuerfrei: 'false', profile_gold_ziel_pct: '0', profile_gold_floor_pct: '0', profile_gold_rebal_band: '25',
            profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: cash - 2000, entries: [
                { date: startDate, value: cash - 1000 }, { date: januaryDate, value: cash },
                ...(confirmationDate === januaryDate ? [] : [{ date: confirmationDate, value: cash }])] }),
            profile_wealth_history_lots_v1: JSON.stringify(captureWealthLots(null, tranches, startDate)),
            depot_tranchen: JSON.stringify(tranches), [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state),
            overview_balance_summary_v1: JSON.stringify({ version: 1, entries: { [summaryEntryKey(year, scope)]: summary } }),
            overview_month_provision_v1: JSON.stringify({ version: 1, entries: { [JSON.stringify([month, scope.key])]: { month, scope, completedAt } } }) };
        registry.profiles[id] = { meta: { id, name, belongsToHousehold: true, createdAt: `${startDate}T12:00:00Z`, updatedAt: `${startDate}T12:00:00Z` }, data };
    }
    const records = rebuildSyntheticPriceRecords({ rs_profiles_v1: JSON.stringify(registry), rs_current_profile: MUSTER_PROFILE_IDS[0], rs_active_profile: MUSTER_PROFILE_IDS[0],
        household_plan_v1: buildPlanRecord(null, [{ scope: planScope('household', MUSTER_PROFILE_IDS), values: planValues }], { now: () => now }).raw,
        ...registry.profiles[MUSTER_PROFILE_IDS[0]].data, rs_wealth_history_start_v1: JSON.stringify({ version: 1, startDate }), balance_expenses_v1: JSON.stringify(expenses),
        household_simulator_needs_v1: JSON.stringify({ schemaVersion: 1, mode: 'override', source: 'manual', overriddenFields: ['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual'],
            values: { startFloorBedarf: '30000', startFlexBedarf: '30000', minimumFlexAnnual: '7500' } }) }, testDate);
    const validation = validatePersistenceDomainRecords(records, { requireProfileContext: true });
    if (!validation.ok) throw new Error(`Muster-Haushalt ungültig: ${validation.message}`);
    return records;
}
export async function loadMusterHaushalt({ persistence, testDate, ...options }) {
    const records = createMusterHaushaltRecords(testDate);
    await persistence.replaceRecordsTransactional(records, { ...options, allowKey: isProbelaufRecordKey,
        postValidate: actual => { const validation = validatePersistenceDomainRecords(actual, { requireProfileContext: true }); if (!validation.ok) throw new Error(validation.message); } });
}
