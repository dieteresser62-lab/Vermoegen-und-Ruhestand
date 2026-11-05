import { derivePlanningStart, resolvePlanningPeriodSource } from '../app/shared/planning-start.js';
import { deriveOverviewPlanningStart, deriveOverviewOccasion } from '../app/overview/overview-model.js';
import { overviewScope, summaryEntryKey, readOverviewSummary, readOverviewSummaries } from '../app/overview/overview-storage.js';
import { projectFocusExpenses } from '../app/overview/overview-model.js';
import { createManualWealthHistoryEntry } from '../types/wealth-history-contract.js';

const now = new Date(2026, 0, 2), scope = overviewScope('single', ['a']);
const amounts = { tagesgeld: 100, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0 };
const options = { now, scope, states: [{ wealthHistory: { schemaVersion: 1,
    entries: [createManualWealthHistoryEntry(amounts, '2026-01-01')] } }] };
const before = JSON.stringify(options);
const planning = derivePlanningStart({ ...options, readSummary: readOverviewSummary,
    readSummaries: readOverviewSummaries, projectExpenses: projectFocusExpenses });
assertEqual(planning.firstPlanningYear, 2026, 'Gemeinsame Regel erkennt den ersten belegten Planungstag');
assertEqual(JSON.stringify(planning), JSON.stringify(deriveOverviewPlanningStart(options)), 'Übersichtsadapter enthält dieselbe Regel');
assertEqual(JSON.stringify(options), before, 'Planungsbeginn verändert keine Belege');
const occasion = deriveOverviewOccasion({ now, scope, planning, metadata: [null] });
assertEqual(occasion.kind, 'start', '02.01.2026 hat keinen Dezemberanlass');
assertEqual(occasion.monthApplicable, false, 'Keine Monatsbereitstellung vor dem Beginn');
assertEqual(occasion.annualState, 'not_applicable', 'Kein Abschluss 2025');
assertEqual(deriveOverviewOccasion({ now: new Date(2026, 1, 2), scope, planning, metadata: [null] }).kind, 'monthly', '02.02.2026 bietet Januar an');
assertEqual(deriveOverviewOccasion({ now: new Date(2027, 0, 2), scope, planning, metadata: [null] }).annualState, 'open', '02.01.2027 bietet ersten Abschluss 2026 an');
const closed = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2026', pendingCommit: null };
const records = [{ id: 'a', state: { status: 'valid', value: { annualPeriodMetadata: closed } } },
    { id: 'b', state: { status: 'missing', value: null } }];
const household = overviewScope('household', ['a', 'b']);
for (const writerId of ['a', 'b']) for (const ordered of [records, [...records].reverse()]) {
    const source = resolvePlanningPeriodSource({ writerId, scope: household, records: ordered });
    assertEqual(source.ids.join(), 'a', 'Ablageidentität unabhängig von Writerwechsel und Registryreihenfolge');
    assertEqual(source.metadata.length, 1, 'Fehlender persönlicher Stand bei B erzeugt keinen offenen Abschluss');
    assert(source.available, 'Eindeutiger Ablagestand ist lesbar');
}
assertEqual(resolvePlanningPeriodSource({ writerId: 'b', scope: household, records: [
    { ...records[0], state: { status: 'corrupt', value: null } }, records[1]
] }).available, false, 'Beschädigte Abschlussquelle bleibt gesperrt');

// P12c: Initialisierung ist unabhängig von späteren Anzeige-/Vermögensbelegen.
{
    const now = new Date(2027, 0, 15), scope = overviewScope('single', ['a']);
    const metadata = [{ schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null }];
    const store = { version: 1, activeYear: 2026, years: { 2026: { months: {} } } };
    const summary = year => JSON.stringify({ version: 1, entries: { [summaryEntryKey(year, scope)]: {
        year, scope, monthlyWithdrawal: 100, monthlyBudget: 200, createdAt: `${year}-01-15T12:00:00.000Z`, status: 'vorläufig'
    } } });
    const wealth = year => ({ wealthHistory: { schemaVersion: 1, entries: [createManualWealthHistoryEntry(amounts, `${year}-01-01`)] } });
    for (const sources of [ { states: [{}], summarySources: [summary(2027)] }, { states: [wealth(2027)] },
        { states: [wealth(2027)], summarySources: [summary(2027)] }, { states: [wealth(2027)], summarySources: [summary(2024)] } ]) {
        const input = { now, scope, metadata, store, ...sources }, bytes = JSON.stringify(input);
        const result = deriveOverviewPlanningStart(input);
        assertEqual(result.firstPlanningYear, sources.summarySources?.[0] === summary(2024) ? 2024 : 2026,
            'Gültiger früherer Beleg bleibt Minimum bei späteren Belegen');
        assert(result.evidence.some(e => e.kind === 'initialized' && e.year === 2026), 'Initialisierung zählt eigenständig');
        assertEqual(JSON.stringify(input), bytes, 'Stabilitätsmatrix bleibt lesend bytegleich');
    }
    for (const change of [ { store: { ...store, version: 99 } }, { store: { ...store, activeYear: 2027 } },
        { store: { ...store, years: { 2026: { months: [] } } } }, { summarySources: ['{broken'] },
        { sourceErrors: [{ id: 'a', source: 'period' }] }, { memberIds: ['foreign'] } ]) {
        const result = deriveOverviewPlanningStart({ now, scope, metadata, store, states: [{}], ...change });
        assert(!result.evidence.some(e => e.kind === 'initialized'), 'Ungültige/fehlende/fremde notwendige Quelle erzeugt keine Initialisierung');
    }
}
