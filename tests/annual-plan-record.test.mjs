import { ANNUAL_PLAN_RECORD_KEY, annualPlanEntryKey, assertAnnualPlanRecord, readAnnualPlanRecord, buildAnnualPlanRecord } from '../app/profile/annual-plan-record.js';
import { PLAN_DEFAULTS, planScope } from '../app/profile/household-plan.js';
const scope = planScope('household', ['a', 'b']);
const outcome = { monthlyWithdrawal: 1500, monthlyBudget: 3000, action: { type: 'TRANSACTION', title: 'Liquidität bereitstellen', steuer: 0, quellen: [{ kind: 'liquiditaet', brutto: 18000, netto: 18000, steuer: 0 }], verwendungen: { liquiditaet: 18000 } }, liquidityBefore: 100, liquidityAfter: 80, marketPhase: 'Bär', flexRate: 70 };
const item = { year: 2027, scope, periodId: 'calendar-year:2027', committedAt: '2026-12-31T12:00:00Z',
    recommended: structuredClone(outcome), adopted: { ...structuredClone(outcome), snapshot: { plan: structuredClone(PLAN_DEFAULTS), inflation: 2, ageByPerson: { a: 68, b: 65 } } }, adjusted: false, adjustedFields: [] };
const key = annualPlanEntryKey(2027, scope);
const raw = JSON.stringify({ version: 1, entries: { [key]: item } });
assertAnnualPlanRecord(raw);
const storage = { getItem: name => name === ANNUAL_PLAN_RECORD_KEY ? raw : null };
assertEqual(readAnnualPlanRecord({ year: 2026, scope, storage }), null, 'Fehlender historischer Beleg bleibt fehlend');
assertEqual(JSON.stringify(readAnnualPlanRecord({ year: 2027, scope, storage })), JSON.stringify(item), 'Empfehlung und beschlossener Plan werden vollständig gelesen');
const adjusted = structuredClone(item); adjusted.adjusted = true; adjusted.adjustedFields = ['flexBedarf', 'cape.value']; adjusted.adopted.monthlyBudget = 3500;
assertAnnualPlanRecord({ version: 1, entries: { [key]: adjusted } });
assertEqual(adjusted.recommended.monthlyBudget, 3000, 'Bewusste Anpassung erhält vorherige Empfehlung');
const noAction = structuredClone(item);
noAction.adopted.action = { type: 'NONE', title: 'Kein Handlungsbedarf', zielLiquiditaet: 90000 };
assertAnnualPlanRecord({ version: 1, entries: { [key]: noAction } });
assertEqual(noAction.adopted.action.type, 'NONE', 'Vollständige Engineanweisung ohne Transaktion bleibt lesbar');
const badItems = [
    { ...item, year: 2026 }, { ...item, scope: planScope('single', ['a']) }, { ...item, adjustedFields: ['floorBedarf'] },
    { ...item, adjusted: true, adjustedFields: ['inflation'] }, { ...adjusted, adjustedFields: ['flexBedarf', 'flexBedarf'] },
    { ...item, adopted: outcome }, { ...item, recommended: { ...outcome, action: {} } },
    { ...item, recommended: { ...outcome, action: { type: 'TRANSACTION', title: 'Unvollständig' } } },
    { ...item, adopted: { ...item.adopted, snapshot: { ...item.adopted.snapshot, ageByPerson: { a: 68 } } } },
    { ...item, adopted: { ...item.adopted, snapshot: { ...item.adopted.snapshot, plan: { ...PLAN_DEFAULTS, minimumFlexAnnual: 999999 } } } }
];
for (const bad of badItems) {
    const badRaw = JSON.stringify({ version: 1, entries: { [key]: bad } });
    assertEqual(readAnnualPlanRecord({ year: 2027, scope, storage: { getItem: () => badRaw } }).status, 'invalid', 'Ungültiger vorhandener Beleg ist von Abwesenheit unterscheidbar');
}
assertEqual(readAnnualPlanRecord({ year: 2027, scope, storage: { getItem: () => '{"version":2,"entries":{}}' } }).status, 'invalid', 'Zukünftiges Schema bleibt geschützt');

const next = buildAnnualPlanRecord(raw, { targetYear: 2027, scope, committedAt: '2028-01-02T12:00:00Z',
    recommended: item.adopted });
assertEqual(next.entry.year, 2028, 'Neuer Beleg gehört zum Folgeplanungsjahr');
assertEqual(next.entry.periodId, 'calendar-year:2027', 'Neuer Beleg bindet tatsächliche Abschlussperiode');
assertEqual(JSON.stringify(next.entry.recommended), JSON.stringify(next.entry.adopted), 'Unangepasster neuer Beleg enthält bytegleiche Zweige');
assertEqual(JSON.stringify(next.record.entries[key]), JSON.stringify(item), 'Neue Belegbildung erhält vorhandenen H1-Eintrag unverändert');
const foreignPeriod = { ...next.entry, periodId: 'calendar-year:2025' };
assertEqual(readAnnualPlanRecord({ year: 2028, scope, storage: { getItem: () => JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2028, scope)]: foreignPeriod } }) } }).status,
    'invalid', 'Fremder Jahresabstand bleibt ungültig');
let duplicateRejected = false;
try { buildAnnualPlanRecord(next.raw, { targetYear: 2027, scope, committedAt: '2028-01-03T12:00:00Z', recommended: item.adopted }); } catch { duplicateRejected = true; }
assert(duplicateRejected, 'Vorhandener Jahresbeleg kann nicht überschrieben werden');
