import { expenseDeviation, expenseNeedsCoverage } from '../expenses/expenses-needs.js';
const money = value => Number.isFinite(value) ? value.toLocaleString('de-DE', { maximumFractionDigits: 0 }).replace(/^-/, '−') + ' €' : '—';
export const ANNUAL_NEED_PATHS = ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual'];
/**
 * @param value Zu verarbeitender Wert.
 * @returns {number} Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export const roundAnnualSuggestion = value => Number.isFinite(value) ? Math.ceil(value / 1000) * 1000 : null;

/** Ist-Ausgaben sind ausschließlich Vergleichsdaten und niemals ein automatischer Planpatch.
 *
 * @param preview Wert für den bestehenden Aufrufvertrag.
 * @param annual Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function annualNeedsComparison(preview, annual) {
    const before = id => preview.needs?.find(need => need.id === id)?.before;
    const review = annual?.needsReview;
    const need = review?.plans.total ?? before('floorBedarf') + before('flexBedarf');
    const expenses = review?.monthsWithBreakdown ? review.annualForecast.total : annual?.complete && Number.isFinite(annual.total) ? annual.total : null;
    const difference = expenses !== null && Number.isFinite(need) ? expenses - need : null;
    return { need, expenses, difference, percent: difference !== null && need > 0 ? difference / need * 100 : null };
}

/**
 * @param preview Wert für den bestehenden Aufrufvertrag.
 * @param annual Wert für den bestehenden Aufrufvertrag.
 * @param path Feldpfad.
 * @param projected Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function annualNeedSuggestions(preview, annual, path, projected) {
    const review = annual?.needsReview, key = path === 'floorBedarf' ? 'floor' : 'flex';
    const actual = path !== 'minimumFlexAnnual' && review?.monthsWithBreakdown ? review.annualForecast[key] : null;
    const plan = path === 'floorBedarf' ? review?.plans.floor : review?.plans.flex;
    return { plan: roundAnnualSuggestion(projected), actual,
        fromActual: actual === null ? null : roundAnnualSuggestion(actual * (1 + (preview.inflation?.rate ?? 0) / 100)),
        comparison: actual === null ? '—' : expenseDeviation(actual, plan, money).replace('über Plan', path === 'flexBedarf' ? 'über Flex nach Regeln' : 'über Plan').replace('unter Plan', path === 'flexBedarf' ? 'unter Flex nach Regeln' : 'unter Plan') };
}

/**
 * @param preview Wert für den bestehenden Aufrufvertrag.
 * @param annual Wert für den bestehenden Aufrufvertrag.
 * @returns Rückgabe gemäß bestehendem Ablauf; Typ aus der Implementierung abgeleitet.
 */
export function annualNeedsTiles(preview, annual) {
    const { need, expenses, difference, percent } = annualNeedsComparison(preview, annual);
    const review = annual?.needsReview, split = review?.monthsWithBreakdown;
    return [
        { label: `Ausgaben ${preview.targetYear}`, value: money(expenses), detail: split ? `Floor ${money(review.annualForecast.floor)} · Flex ${money(review.annualForecast.flex)}${review.monthsWithoutBreakdown ? ' · ' + expenseNeedsCoverage(review) : ''}` : expenses === null ? 'unvollständig' : 'laut Monatsabschlüssen' },
        { label: `Bedarf ${preview.targetYear}`, value: money(need), detail: review ? `Grundbedarf ${money(review.plans.floor)} + Flex nach Regeln ${money(review.plans.flex)}` : 'Grundbedarf + Flex' },
        { label: 'Abweichung', value: difference === null ? '—' : (difference > 0 ? '+' : '') + money(difference),
            detail: split ? ['floor', 'flex'].map(key => `${key === 'floor' ? 'Floor' : 'Flex'} ${review.comparisons[key].difference > 0 ? '+' : ''}${money(review.comparisons[key].difference)}`).join(' · ')
                : percent === null ? '—' : `${Math.abs(percent).toLocaleString('de-DE', { maximumFractionDigits: 1 })} % ${percent < 0 ? 'unter' : 'über'} Bedarf`, tone: difference > 0 ? 'warning' : '' }
    ];
}
