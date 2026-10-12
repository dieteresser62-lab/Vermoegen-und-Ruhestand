import { projectHouseholdPlanComparison, householdPlanComparisonHtml } from '../app/profile/household-plan-comparison.js';
import { PLAN_DEFAULTS, planScope, buildPlanRecord, HOUSEHOLD_PLAN_KEY } from '../app/profile/household-plan.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { overviewScope, summaryEntryKey, OVERVIEW_SUMMARY_KEY } from '../app/overview/overview-storage.js';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { annualPlanEntryKey, ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';
import { renderManagerPlanComparison } from '../app/tranches/tranchen-manager-renderer.js';
import { formatDisplayNumber } from '../app/shared/designsystem-number-format.js';

/** Gemeinsame synthetische Abschlussbasis für Modell und echten Managercontroller. */
export function completedComparisonFixture({ adjusted = false, receipt = true, preview = 'current' } = {}) {
    const now = new Date('2026-10-09T12:00:00Z'), scope = planScope('household', ['a', 'z']);
    const metadata = { schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null };
    const data = { depot_tranchen: '[]', profile_tagesgeld: '100', [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: metadata }) };
    const registry = { version: 1, profiles: Object.fromEntries(['a', 'z', 'out'].map(id => [id, {
        meta: { name: id.toUpperCase(), belongsToHousehold: id !== 'out' }, data: { ...data }
    }])) };
    const records = { ...data, rs_profiles_v1: JSON.stringify(registry), rs_current_profile: 'z', rs_active_profile: 'z',
        [HOUSEHOLD_PLAN_KEY]: buildPlanRecord(null, [{ scope, values: structuredClone(PLAN_DEFAULTS) },
            { scope: planScope('single', ['out']), values: structuredClone(PLAN_DEFAULTS) }], { now: () => new Date('2026-01-01') }).raw };
    const outcome = { monthlyWithdrawal: 1500, monthlyBudget: 2000, liquidityBefore: 70, liquidityAfter: 80, flexRate: 100,
        marketPhase: 'Synthetisch', action: { type: 'NONE', title: 'Keine Transaktion', quellen: [], verwendungen: {}, steuer: 0 },
        snapshot: { plan: structuredClone(PLAN_DEFAULTS), inflation: 2.1, ageByPerson: { a: 60, z: 62 } } };
    if (receipt) records[ANNUAL_PLAN_RECORD_KEY] = JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2026, scope)]: {
        year: 2026, periodId: 'calendar-year:2025', scope, committedAt: '2026-01-02T12:00:00Z', adjusted,
        adjustedFields: adjusted ? ['floorBedarf'] : [], recommended: adjusted ? { ...outcome, monthlyWithdrawal: 9999 } : outcome, adopted: outcome
    } } });
    if (preview !== 'missing') {
        const previewScope = overviewScope('household', scope.ids);
        const summary = { year: 2026, scope: previewScope, monthlyWithdrawal: 1600, monthlyBudget: 2100,
            liquidityBefore: 75, liquidityAfter: 85, status: 'vorläufig', marketPhase: 'Synthetisch',
            createdAt: preview === 'stale' ? '2026-10-08T12:00:00Z' : now.toISOString(),
            action: { verb: 'Aktien verkaufen', amount: 2000, amountUnit: '€ netto', note: 'Heutige materielle Vorschau' },
            actionBasis: { material: true, fingerprintVersion: 1, sourceFingerprint: sourceFingerprint({ registry, activeId: 'z', liveData: records, scope: previewScope, kind: 'balance' }) } };
        const raw = preview === 'invalid' ? '{broken' : JSON.stringify({ version: 1, entries: { [summaryEntryKey(2026, previewScope)]: summary } });
        records[OVERVIEW_SUMMARY_KEY] = raw;
        for (const id of scope.ids) registry.profiles[id].data[OVERVIEW_SUMMARY_KEY] = raw;
    }
    records.rs_profiles_v1 = JSON.stringify(registry);
    return { now, scope, registry, records };
}

if (!import.meta.url.endsWith('?fixture')) {
const scope = planScope('household', ['z', 'a']);
const action = { type: 'NONE', title: 'Keine Transaktion', quellen: [], verwendungen: {}, steuer: 0 };
const snapshot = { plan: structuredClone(PLAN_DEFAULTS), inflation: 2.1, ageByPerson: { a: 60, z: 62 } };
const outcome = { monthlyWithdrawal: 1500, monthlyBudget: 2000, liquidityBefore: 70, liquidityAfter: 80, flexRate: 100,
    marketPhase: 'Synthetisch', action, snapshot };
const record = { year: 2026, periodId: 'calendar-year:2026', scope, committedAt: '2026-01-02T12:00:00Z',
    adjusted: true, adjustedFields: ['floorBedarf'], recommended: { ...outcome, monthlyWithdrawal: 9999 }, adopted: outcome };
let raw = JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2026, scope)]: record } });
let reads = 0;
const storage = { getItem: key => { reads++; return key === ANNUAL_PLAN_RECORD_KEY ? raw : null; }, setItem: () => { throw new Error('Anzeige darf nicht schreiben'); } };
const preview = { year: 2026, scope, monthlyWithdrawal: 1600, monthlyBudget: 2100, liquidityBefore: 75, liquidityAfter: 85,
    createdAt: '2026-10-09T10:00:00Z', action: { verb: 'Nichts tun', amount: null, amountUnit: '€', note: 'Keine Transaktion empfohlen.' },
    actionBasis: { fingerprintVersion: 1, sourceFingerprint: 'current' } };
const options = { year: 2026, scope, storage, preview, sourceFingerprint: 'current', now: new Date('2026-10-09T12:00:00Z') };
const project = extra => projectHouseholdPlanComparison({ ...options, ...extra });
const view = project();
assertEqual(view.planLabel, 'Plan 2026 · festgeschrieben am 02.01.2026', 'Planjahr kommt aus Beleg, nicht Commitdatum');
assertEqual(view.previewLabel, 'Vorschau heute', 'Unterjährige Ebene heißt Vorschau heute');
assertEqual(view.rows[0].plan, formatDisplayNumber(1500, { unit: 'currency', fractionDigits: 0 }), 'Beschlossene adopted-Werte, keine Empfehlung');
assertEqual(view.rows[0].delta, '+' + formatDisplayNumber(100, { unit: 'currency', fractionDigits: 0 }), 'Vorschau minus Plan: +100 €/Monat');
assertEqual(view.rows[3].delta, ' +5,0 Prozentpunkte'.trim(), 'Liquiditätsdeckung: +5 Prozentpunkte, kein Verhältnis');
assertEqual(view.rows[2].delta, 'unverändert', 'Gleiche Handlungstexte bleiben unverändert');
assert(householdPlanComparisonHtml(view).includes('bewusst angepasst'), 'Bewusste Anpassung wird kenntlich gemacht');
assertEqual(project({ preview: { ...preview, monthlyWithdrawal: 1500 } }).rows[0].delta, formatDisplayNumber(0, { unit: 'currency', fractionDigits: 0 }), 'Identische Zahlen zeigen null');
assertEqual(project({ preview: { ...preview, monthlyWithdrawal: null } }).rows[0].delta, '—', 'Fehlende Werte erzeugen kein falsches Delta');
assertEqual(project({ preview: { ...preview, monthlyWithdrawal: 1500.6 } }).rows[0].delta, '+' + formatDisplayNumber(0.6, { unit: 'currency', fractionDigits: 0 }), 'Delta wird vor der Anzeige-Rundung gebildet');
assertEqual(project({ preview: { ...preview, action: { verb: 'Aktien verkaufen', amount: 2000, amountUnit: '€ netto' } } }).rows[2].delta, 'geändert', 'Anderer Handlungstext erzeugt kein künstliches Handelsdelta');
assertEqual(project({ preview: null }).rows[0].plan, view.rows[0].plan, 'Fehlende Vorschau erhält beschlossenen Plan');
assertEqual(project({ preview: null }).previewNotice, 'Noch nicht gerechnet', 'Fehlende Vorschau ist ausdrücklich benannt');
assertEqual(project({ preview: { ...preview, year: 2027 } }).previewStatus, 'missing', 'Anderes Planjahr wird nicht verglichen');
assertEqual(project({ preview: { ...preview, scope: planScope('single', ['a']) } }).previewStatus, 'missing', 'Fremder Scope wird nicht verglichen');
assertEqual(project({ scope: { ...scope, ids: ['z', 'a'] } }).recordStatus, 'valid', 'ID-Reihenfolge wird nach Planvertrag normalisiert');
for (const extra of [{ sourceFingerprint: null }, { sourceFingerprint: 'changed' }, { planUpdatedAt: '2026-10-09T11:00:00Z' }, { now: new Date('2026-10-10T12:00:00Z') }]) {
    const stale = project(extra);
    assertEqual(stale.previewStatus, 'stale', 'Veraltete Vorschau bleibt sichtbar, aber ausdrücklich markiert');
    assertEqual(stale.rows[0].delta, '—', 'Veraltete Basis erzeugt kein aktuelles Delta');
}
const bytes = raw;
const managerHost = { innerHTML: '' };
renderManagerPlanComparison({ getElementById: () => managerHost }, view);
assertEqual(managerHost.innerHTML, householdPlanComparisonHtml(view), 'Manager verwendet gemeinsamen escaped Vergleich');
assertEqual(raw, bytes, 'Lesen und Rendern verändern keine Belegbytes');
assert(reads > 0, 'Beleg wird am bestehenden globalen Schlüssel gelesen');
raw = null;
assertEqual(project().notice, 'Noch kein festgeschriebener Plan – er entsteht im nächsten Jahresabschluss.', 'Ruhiger vorgeschriebener Hinweis ohne Beleg');
raw = '{broken';
assertEqual(project().recordStatus, 'invalid', 'Beschädigter Beleg ist kein fehlender Beleg');
assert(householdPlanComparisonHtml(project()).includes('role="alert"'), 'Beschädigter Beleg ist sichtbar fehlerhaft');
const singleHousehold = planScope('household', ['a']);
const singleRecord = { ...record, scope: singleHousehold, adopted: { ...outcome, snapshot: { ...snapshot, ageByPerson: { a: 60 } } } };
raw = JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2026, singleHousehold)]: singleRecord } });
assertEqual(project({ scope: singleHousehold, preview: { ...preview, scope: planScope('single', ['a']) } }).previewStatus, 'current', 'Einpersonenhaushalt darf bestehende Overview-Single-Vorschau lesen');
assertEqual(project({ scope: planScope('single', ['a']) }).recordStatus, 'missing', 'Außenbereich liest niemals fremden Einpersonenhaushaltsbeleg');
const escaped = householdPlanComparisonHtml({ ...view, rows: [{ label: '<img>', plan: '<script>', preview: '&', delta: '—' }] });
assert(escaped.includes('&lt;script&gt;') && !escaped.includes('<script>'), 'Synthetische Texte werden in beiden Oberflächen escaped');

assert(householdPlanComparisonHtml(view).includes('class="plan-comparison-label"') && householdPlanComparisonHtml(view).includes('class="ds-table"'), 'Gemeinsamer Vergleich erhält gestaltete feste Labels und semantische Tabelle');
const rendered = householdPlanComparisonHtml(view);
assert(rendered.includes('class="plan-comparison-plan"') && rendered.includes('class="plan-comparison-preview"'), 'Plan und heutige Vorschau haben getrennte Darstellungsblöcke');
assert(rendered.includes('class="ds-plan-chip">bewusst angepasst') && rendered.includes('data-preview-status="current"'), 'Pille und Aktualitätsstatus bleiben im gemeinsamen Renderer sichtbar');
assert(rendered.includes('scope="col"') && rendered.includes('scope="row"'), 'Vergleich behält semantische Tabellenköpfe');
}
