import { balanceStorageFixture, recordStorage } from './helpers/balance-storage-fixtures.mjs';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { PLANNED_EXPENSES_KEY } from '../app/profile/household-planned-expenses.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { setAppTestDate, getAppTestDate } from '../app/shared/app-clock.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { projectHouseholdPlanComparison } from '../app/profile/household-plan-comparison.js';

const old = getAppTestDate();
try {
    setAppTestDate('2026-10-27');
    for (const kind of ['Einzelprofil', 'ein ausgewähltes Fremdmitglied']) {
        const fixture = balanceStorageFixture(kind), records = fixture.records;
        const registry = JSON.parse(records.rs_profiles_v1), activeId = records.rs_current_profile;
        const scope = kind === 'Einzelprofil' ? fixture.scope : overviewScope('household', fixture.scope.ids);
        const state = JSON.parse(records[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2026', pendingCommit: null };
        records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        const input = () => buildBalanceEngineInputFromStorage({ storage: recordStorage(records) });
        const context = { registry, activeId, scope, kind: 'balance', liveData: records };
        const plain = input(), before = sourceFingerprint(context);
        records[PLANNED_EXPENSES_KEY] = JSON.stringify({ version: 1, entries: { [plain.scope.key]: { scope: plain.scope,
            items: [{ id: 'auto', monat: '2027-04', betrag: 25000, priceYear: 2027, bezeichnung: 'Auto' }] } } });
        const open = input(), openFingerprint = sourceFingerprint(context);
        assert(before && openFingerprint && before !== openFingerprint, 'QS-I 7: tatsächlich berechneter Planbereich ändert Fingerabdruck');
        assertEqual(open.inputData.plannedPosts.year, 2027, 'QS-I 7: Balance rechnet trotz Fachdatum 2026 für 2027');
        assertEqual(open.inputData.plannedPosts.reserve, 25000, 'QS-I 7: offene Reserve beträgt 25.000 Euro');
        records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2027, years: { 2027: { months: { 4: { profiles: {
            [plain.scope.ids[0]]: { categories: { Auto: -25000 }, plannedExpenses: [
                { id: 'auto', scopeKey: plain.scope.key, month: '2027-04', label: 'Auto', amount: 25000 }] }
        } } } } } });
        const paidFingerprint = sourceFingerprint(context);
        assertEqual(input().inputData.plannedPosts.reserve, 0, 'QS-I 7: Zahlungsnachweis im Planjahr hebt die Reserve auf');
        assert(paidFingerprint && paidFingerprint !== openFingerprint, 'QS-I 7: Zahlungsnachweis des tatsächlichen Planjahres ändert Fingerabdruck');
        const preview = { year: 2027, scope, createdAt: '2026-10-27T12:00:00Z', monthlyBudget: 1000,
            actionBasis: { fingerprintVersion: 1, sourceFingerprint: openFingerprint } };
        assertEqual(projectHouseholdPlanComparison({ year: 2027, scope, storage: recordStorage(records), preview,
            sourceFingerprint: paidFingerprint, now: new Date('2026-10-27T12:00:00Z') }).previewStatus, 'stale',
            'QS-I 7: alte Vorschau ist nach Zahlung veraltet');
    }
} finally { setAppTestDate(old); }
