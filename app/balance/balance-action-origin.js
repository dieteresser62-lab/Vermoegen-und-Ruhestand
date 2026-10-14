import { comparisonScopeMatches } from '../profile/household-plan-comparison.js';
import { appNow } from '../shared/app-clock.js';

/** Lesende Herkunftsprojektion. Nur der passende Jahresbeleg ist festgeschrieben. */
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
            ? 'Nichts tun – kein Handlungsbedarf' : confirmed.text, action: structuredClone(confirmed.action), label } : null,
        label,
        notice: comparison?.recordStatus === 'invalid' ? comparison.notice : '',
        previewYear,
        previewLabel: `Vorläufige Vorschau · Jahresabschluss ${previewYear}`,
        previewNotice: `So sähe es aus, wenn heute Jahresabschluss wäre. Der Plan wird im Jahresabschluss ${previewYear} festgeschrieben.${firstNotice} Die Umsetzung bleibt deine Entscheidung.`
    };
}
