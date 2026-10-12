import { readAnnualPlanRecord } from './annual-plan-record.js';
import { planScope } from './household-plan.js';
import { summarizeBalanceAction, describeBalanceActionSummary } from '../balance/balance-action-summary.js';
import { formatDisplayNumber } from '../shared/designsystem-number-format.js';
import { escapeHtml } from '../shared/security-utils.js';

const money = value => Number.isFinite(value) ? formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }) : '—';
const number = value => formatDisplayNumber(value, { fractionDigits: 1 });
const date = value => new Date(value).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const actionNames = { aktien_alt: 'Aktien (Altbestand)', aktien_neu: 'Aktien (Neubestand)', aktien: 'Aktien',
    gold: 'Gold', anleihe: 'Anleihen', bonds: 'Anleihen', geldmarkt: 'Geldmarkt', liquiditaet: 'Tagesgeld', cash: 'Tagesgeld' };
const idsMatch = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

/** Overview nennt einen einzelnen Haushaltsangehörigen single; nur im belegten
 * Haushaltskontext ist dieser Alias zulässig. Außenpersonen bleiben single. */
export function comparisonScopeMatches(scope, previewScope) {
    if (!scope || !previewScope || !idsMatch(scope.ids, previewScope.ids)) return false;
    return scope.kind === previewScope.kind || scope.kind === 'household' && scope.ids.length === 1 && previewScope.kind === 'single';
}
function actionView(action, full = false) {
    if (!action) return { text: '—', comparable: null, detail: '' };
    const summary = full ? summarizeBalanceAction(action, action) : action;
    const text = describeBalanceActionSummary(summary, money);
    const comparable = JSON.stringify([summary.verb, summary.amount ?? null, summary.amountUnit || '€', summary.note || '']);
    const sources = full ? (action.quellen || []).map(source => `${actionNames[source.kind] || source.kind}${source.source ? ' (' + source.source + ')' : ''}: ${money(source.brutto)} brutto, ${money(source.netto)} netto, ${money(source.steuer)} Steuer`) : [];
    const uses = full ? Object.entries(action.verwendungen || {}).map(([key, value]) => `${actionNames[key] || key}: ${money(value)}`) : [];
    return { text, comparable, detail: [full ? action.title : null, summary.note, ...sources, ...uses,
        full && Number.isFinite(action.steuer) ? `Steuer gesamt: ${money(action.steuer)}` : null].filter(Boolean).join(' · ') };
}
const delta = (plan, preview, percent = false) => {
    if (!Number.isFinite(plan) || !Number.isFinite(preview)) return '—';
    const value = preview - plan;
    return `${value > 0 ? '+' : ''}${percent ? number(value) + ' Prozentpunkte' : money(value)}`;
};

/** Lesende Anzeigeprojektion: Beleg und Vorschau bleiben getrennte Quellen.
 * Kein Engineaufruf, kein Write, kein Rückfall auf Abschluss-Metadaten. */
export function projectHouseholdPlanComparison({ year, scope, storage, preview = null, sourceFingerprint = null,
    planUpdatedAt = null, now = new Date() } = {}) {
    const normalized = planScope(scope?.kind, scope?.ids);
    const record = normalized ? readAnnualPlanRecord({ year, scope: normalized, storage }) : null;
    const invalid = record?.status === 'invalid';
    const adopted = record && !invalid ? record.adopted : null;
    const today = preview?.year === year && comparisonScopeMatches(normalized, preview.scope) ? preview : null;
    const stale = Boolean(today && (!sourceFingerprint || today.actionBasis?.fingerprintVersion !== 1
        || today.actionBasis.sourceFingerprint !== sourceFingerprint
        || !Number.isFinite(Date.parse(today.createdAt)) || Date.parse(today.createdAt) > now.getTime()
        || new Date(today.createdAt).toDateString() !== now.toDateString()
        || planUpdatedAt && Date.parse(today.createdAt) < Date.parse(planUpdatedAt)));
    const a = actionView(adopted?.action, true), b = actionView(today?.action);
    const rows = [
        { label: 'Monatsbetrag', plan: money(adopted?.monthlyWithdrawal), preview: money(today?.monthlyWithdrawal), delta: delta(adopted?.monthlyWithdrawal, today?.monthlyWithdrawal) },
        { label: 'Monatsbudget', plan: money(adopted?.monthlyBudget), preview: money(today?.monthlyBudget), delta: delta(adopted?.monthlyBudget, today?.monthlyBudget) },
        { label: 'Handlungsanweisung', plan: a.text, preview: b.text, planDetail: a.detail, previewDetail: b.detail,
            delta: a.comparable && b.comparable ? a.comparable === b.comparable ? 'unverändert' : 'geändert' : '—' },
        { label: 'Liquidität (Rechenergebnis nachher)', plan: Number.isFinite(adopted?.liquidityAfter) ? number(adopted.liquidityAfter) + ' %' : '—',
            preview: Number.isFinite(today?.liquidityAfter) ? number(today.liquidityAfter) + ' %' : '—', delta: delta(adopted?.liquidityAfter, today?.liquidityAfter, true) }
    ];
    if (stale) rows.forEach(row => { row.delta = '—'; });
    return { year, scope: normalized ? structuredClone(normalized) : null,
        confirmedAction: adopted ? { year: record.year, committedAt: record.committedAt, text: a.text, action: structuredClone(adopted.action) } : null,
        confirmedSnapshot: adopted ? structuredClone(adopted.snapshot) : null,
        recordStatus: invalid ? 'invalid' : adopted ? 'valid' : 'missing', adjusted: Boolean(adopted && record.adjusted),
        adjustedFields: adopted ? record.adjustedFields : [],
        planLabel: adopted ? `Plan ${record.year} · festgeschrieben am ${date(record.committedAt)}` : `Plan ${year}`,
        notice: invalid ? 'Der Jahresbeleg ist beschädigt. Bitte die Sicherung prüfen.' : adopted ? '' : 'Noch kein festgeschriebener Plan – er entsteht im nächsten Jahresabschluss.',
        previewLabel: 'Vorschau heute', previewStatus: !today ? 'missing' : stale ? 'stale' : 'current',
        previewNotice: !today ? 'Noch nicht gerechnet' : `${stale ? 'Vorschau noch nicht mit dem aktuellen Plan gerechnet · ' : ''}Gerechnet am ${new Date(today.createdAt).toLocaleString('de-DE')}`,
        rows };
}

/** Gemeinsame, escaped Darstellung in beiden lesenden Oberflächen. */
export function householdPlanComparisonHtml(view) {
    const e = escapeHtml;
    return `<div class="plan-comparison" data-plan-record-status="${e(view.recordStatus)}">
        <div class="plan-comparison-plan">
            <h3 class="plan-comparison-label">${e(view.planLabel)}${view.adjusted ? ' <span class="ds-plan-chip">bewusst angepasst</span>' : ''}</h3>
            ${view.notice ? `<p${view.recordStatus === 'invalid' ? ' role="alert"' : ''}>${e(view.notice)}</p>` : ''}
        </div>
        <div class="plan-comparison-preview" data-preview-status="${e(view.previewStatus)}">
            <h3 class="plan-comparison-label">${e(view.previewLabel)}</h3><p class="ds-source">${e(view.previewNotice)}</p>
            <p class="plan-comparison-note">So sähe es aus, wenn heute Jahresabschluss wäre. Daraus entsteht keine neue Handlungsaufgabe.</p>
        </div>
        <div class="plan-comparison-table"><table class="ds-table"><thead><tr><th scope="col">Wert</th><th scope="col">Beschlossener Plan</th><th scope="col">Vorschau heute</th><th scope="col">Δ</th></tr></thead><tbody>
        ${view.rows.map(row => `<tr><th scope="row">${e(row.label)}</th><td>${e(row.plan)}${row.planDetail ? `<small>${e(row.planDetail)}</small>` : ''}</td><td>${e(row.preview)}${row.previewDetail ? `<small>${e(row.previewDetail)}</small>` : ''}</td><td>${e(row.delta)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
}
