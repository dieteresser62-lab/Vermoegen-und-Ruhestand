import { annualServiceFixture, readyAnnualFixture, annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { projectOverviewFromRecords, projectAnnualClosePreparation } from '../app/overview/overview-model.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { readOverviewSummary } from '../app/overview/overview-storage.js';

for (const explicit of [true, false]) {
    const sample = readyAnnualFixture();
    const registry = JSON.parse(sample.records.rs_profiles_v1);
    const change = data => {
        const state = JSON.parse(data[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2024', pendingCommit: null };
        data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    };
    change(sample.records); Object.values(registry.profiles).forEach(profile => change(profile.data));
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    const env = await annualServiceFixture({ sample });
    const calls = [];
    const coordinator = env.create({
        snapshotId: undefined,
        confirmAnnual: async ({ targetYear }) => { calls.push(['dialog', targetYear]); return {}; },
        prepareMarketData: async ({ targetYear }) => {
            calls.push(['market', targetYear]);
            const data = structuredClone(annualTestMarketData);
            data.inflation.year = targetYear;
            Object.assign(data.etf, { targetYear, asOf: `${targetYear}-12-31`, date: new Date(`${targetYear}-12-31`) });
            data.cape.capeAsOf = `${targetYear}-12-01`;
            return { ok: true, marketData: data, results: data };
        },
        prepareAnnualDraft: options => { calls.push(['draft', options.targetYear]); return computeAnnualPlanUpdate(options); }
    });
    for (const year of [2025, 2026]) {
        const model = projectOverviewFromRecords({ registry: JSON.parse(env.storage.getItem('rs_profiles_v1')),
            activeId: env.storage.getItem('rs_current_profile'), liveData: env.persistence.exportAllSync().records,
            now: new Date('2027-01-02T12:00:00Z') });
        assertEqual(model.occasion.annualState, 'open', 'QS-I 5: Übersicht bietet das offene Anschlussjahr an');
        assertEqual(model.occasion.closingYear, year, 'QS-I 5: Übersicht nennt das nächste offene Jahr');
        const prepared = projectAnnualClosePreparation(model, { store: JSON.parse(env.storage.getItem('balance_expenses_v1')) });
        assertEqual(prepared.annual.year, year, 'QS-I 5: Rückblick liest die Ausgaben des Abschlussjahres');
        const result = await coordinator.close(explicit ? { targetYear: year } : {});
        assertEqual(result.status, 'already_committed', 'QS-I 5: verpasstes Jahr lässt sich abschließen');
        assertEqual(result.periodId, `calendar-year:${year}`, 'QS-I 5: genau das offene Jahr wird abgeschlossen');
        assertEqual(JSON.parse(env.storage.getItem(CONFIG.STORAGE.LS_KEY)).annualMarketDataMeta.targetYear, year,
            'QS-I 5: gespeicherte Marktdaten gehören zum Abschlussjahr');
        assertEqual(readOverviewSummary(env.storage.getItem('overview_balance_summary_v1'), year + 1, model.scope)?.year, year + 1,
            'QS-I 5: Summary bestätigt das Folgejahr des Abschlusses statt das heutige Jahr');
    }
    assertEqual(JSON.stringify(calls), JSON.stringify([2025, 2026].flatMap(year => ['dialog', 'market', 'draft'].map(step => [step, year]))),
        'QS-I 5: Dialog, Jahresdaten und Entwurf erhalten durchgängig dasselbe Jahr');
    assertEqual((await coordinator.close()).status, 'already_committed', 'QS-I 5: Wiederholung bleibt ohne erneuten Abschluss');
    assertEqual(env.snapshots.size, 2, 'QS-I 5: je Abschluss genau ein Rückkehrpunkt');
    env.persistence.resetPersistenceRuntimeForTests();
}

// Echter Startseitenbinder mit Dialog, Jahresbeschluss und historischem Dezemberbeleg.
const { overviewAnnualFixture, annualUntil } = await import('./overview-annual-close.test.mjs?fixture');
const { prepareCloseFixture } = await import('./close-dialog.test.mjs?fixture');
const { installAnnualLocks } = await import('./helpers/balance-storage-fixtures.mjs');
const { setAppTestDate, getAppTestDate } = await import('../app/shared/app-clock.js');
const { prepareAnnualMarketData } = await import('../app/shared/annual-marketdata.js');
const saved = { doc: globalThis.document, win: globalThis.window, date: getAppTestDate() }, unlock = installAnnualLocks();
try {
    setAppTestDate('2027-01-02');
    const sample = readyAnnualFixture(), registry = JSON.parse(sample.records.rs_profiles_v1);
    const change = data => {
        const state = JSON.parse(data[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2024', pendingCommit: null };
        data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    };
    change(sample.records); Object.values(registry.profiles).forEach(profile => change(profile.data));
    sample.records.rs_profiles_v1 = JSON.stringify(registry);
    sample.records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: Object.fromEntries([2025, 2026].map(year =>
        [year, { months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { profiles: Object.fromEntries(sample.scope.ids.map(id =>
            [id, { categories: { Alltag: -1200 } }])) }])) }])) });
    const years = [];
    const readers = Object.fromEntries(['Inflation', 'ETF', 'Cape'].map((type, i) => [`prepare${type}`, async ({ targetYear }) => {
        years.push(targetYear);
        return i === 0 ? { ...annualTestMarketData.inflation, year: targetYear }
            : i === 1 ? { ...annualTestMarketData.etf, targetYear, asOf: `${targetYear}-12-31`, date: new Date(`${targetYear}-12-31`) }
                : { ...annualTestMarketData.cape, capeAsOf: `${targetYear}-12-01` };
    }]));
    const f = await overviewAnnualFixture({ sample, readers, coordinatorOptions: {
        snapshotId: undefined,
        prepareMarketData: options => prepareAnnualMarketData({ ...options, readers, now: () => new Date('2027-01-02T12:00:00Z') })
    } });
    for (const year of [2025, 2026]) {
        const close = f.open();
        await annualUntil(() => f.doc.getElementById('annualConfirmBtn'));
        await prepareCloseFixture(f.doc);
        await annualUntil(() => !f.doc.getElementById('annualConfirmBtn').disabled);
        assertEqual(f.doc.getElementById('annualConfirmBtn').textContent, `Jahr ${year} abschließen`, 'QS-I 5: sichtbarer Dialog nennt das offene Jahr');
        await f.doc.getElementById('annualConfirmBtn').fire('click');
        const result = await close;
        assertEqual(result.periodId, `calendar-year:${year}`, 'QS-I 5: Startseite schließt das angezeigte Jahr ab');
        assertEqual(f.doc.getElementById('annualConfirmBtn').textContent, 'Fertig', 'QS-I 5: historischer Dezemberbeleg wird bestätigt');
        assert(Boolean(f.doc.querySelector('[data-annual-action-result]')), 'QS-I 5: bestätigte Handlungsanweisung erscheint im Ergebnis');
        assertEqual(readOverviewSummary(f.storage.getItem('overview_balance_summary_v1'), year + 1, f.model.scope)?.status, 'fest',
            'QS-I 5: Monatsbereitstellung verwendet den richtigen Jahresplan');
        const historical = projectOverviewFromRecords({ registry: JSON.parse(f.storage.getItem('rs_profiles_v1')), activeId: f.model.activeId,
            liveData: f.persistence.exportAllSync().records, now: new Date('2027-01-02T12:00:00Z'), annualTargetYear: year });
        assertEqual(historical.occasion.monthCompleted, true, 'QS-I 5: Wiederholung erkennt auch den historischen Dezemberbeleg');
        await f.doc.getElementById('annualCloseBtn').fire('click');
    }
    assert(years.includes(2025) && years.includes(2026), 'QS-I 5: Startseitenabrufe verwenden beide historischen Jahre');
    f.close(); f.persistence.resetPersistenceRuntimeForTests();
} finally { unlock(); globalThis.document = saved.doc; globalThis.window = saved.win; setAppTestDate(saved.date); }
