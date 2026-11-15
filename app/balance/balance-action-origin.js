import { comparisonScopeMatches } from '../profile/household-plan-comparison.js';
import { appNow } from '../shared/app-clock.js';
import { parseWithdrawalMode, ONE_CARRIES } from '../profile/household-withdrawal-mode.js';

/** VK-3b (Fable P3-8): Modus des Beschlusses wie der Stand der Käufe: Feld `householdWithdrawal`, sonst der Modus aus `snapshot.plan`
 * (Belege vor TRG-1c); nur bei „Eine Person trägt“. @param {any} confirmed @returns {any} */
export function confirmedCarrier(confirmed) {
    if (confirmed?.householdWithdrawal) return confirmed.householdWithdrawal;
    const parsed = parseWithdrawalMode(confirmed?.withdrawalMode);
    return parsed.kind === ONE_CARRIES ? { mode: confirmed.withdrawalMode, carrierId: parsed.carrierId } : null;
}

/** Lesende Herkunftsprojektion. Nur der passende Jahresbeleg ist festgeschrieben. */
/**
 * @param {{comparison?: ReturnType<typeof import('../profile/household-plan-comparison.js').projectHouseholdPlanComparison>|null,
 * year?: number, scope?: import('../../typcheck/datenvertraege.js').PlanScope|null,
 * occasion?: import('../../typcheck/balance-ui.js').Occasion|null}} [options] Optionen und Abhängigkeiten.
 * @returns Ergebnis der bestehenden Operation.
 */
export function projectBalanceActionOrigin({ comparison = null, year = appNow().getFullYear(), scope = null, occasion = null } = {}) {
    const confirmed = comparison?.confirmedAction;
    const valid = comparison?.recordStatus === 'valid' && comparison.year === year
        && comparisonScopeMatches(comparison.scope, scope) && confirmed?.year === year
        && Number.isFinite(Date.parse(confirmed.committedAt)) && confirmed.action;
    const label = valid
        ? `Handlungsanweisung ${year} · festgeschrieben im Jahresabschluss vom ${new Date(confirmed.committedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
        : 'Noch keine Handlungsanweisung aus dem Jahresabschluss';
    // Vorschau nennt das Abschlussjahr wie der Jahresknopf, nicht das Folgeplanjahr.
    const closingYear = occasion?.closingYear ?? year - 1;
    const firstYear = occasion?.annualState === 'not_applicable' ? occasion.firstPlanningYear : null;
    const previewYear = firstYear ?? (occasion && occasion.annualState !== 'done' ? closingYear : closingYear + 1);
    const firstNotice = Number.isInteger(firstYear)
        ? ` Erstes Planungsjahr ${firstYear} · erster Jahresabschluss Anfang ${firstYear + 1}.` : '';
    return {
        confirmed: valid ? { year, committedAt: confirmed.committedAt, text: confirmed.action.type === 'NONE'
            ? 'Nichts tun – kein Handlungsbedarf' : confirmed.text, action: structuredClone(confirmed.action), label,
            ...(comparison.confirmedSnapshot?.marketReading ? { marketReading: structuredClone(comparison.confirmedSnapshot.marketReading) } : {}),
            ...(confirmed.plannedPosts ? { plannedPosts: structuredClone(confirmed.plannedPosts) } : {}),
            ...(confirmed.withdrawalMode ? { withdrawalMode: confirmed.withdrawalMode } : {}),
            ...(confirmed.householdWithdrawal ? { householdWithdrawal: structuredClone(confirmed.householdWithdrawal) } : {}) } : null,
        label,
        notice: comparison?.recordStatus === 'invalid' ? comparison.notice : '',
        previewYear,
        previewLabel: `Vorläufige Vorschau · Jahresabschluss ${previewYear}`,
        previewNotice: `So sähe es aus, wenn heute Jahresabschluss wäre. Der Plan wird im Jahresabschluss ${previewYear} festgeschrieben.${firstNotice} Die Umsetzung bleibt deine Entscheidung.`
    };
}
