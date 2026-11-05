/** @import * as AnalysisTypes from '../../../typcheck/simulator-analysis.js' */
/** @import * as CoreTypes from '../../../typcheck/rechenkern.js' */
/** @typedef {AnalysisTypes.KpiDescriptor} KpiDescriptor */
import { DEFAULT_EURO_MODE, euroBasisLabel } from '../euro-display.js';
import { observationCount } from './display-values.js';
import { formatWholeEuro, formatPercentage } from '../results-formatting.js';

export const LEGACY_FLEX_RESTRICTION_LABEL = 'mehr als 10 % unter Wunsch-Flex';

const amount = value => Number.isFinite(value) && value >= 0;

const share = value => Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * @param result - Laufergebnis.
 * @returns {boolean}
 */
export function hasTechnicalFinancialError(result) {
    return result?.outcomeInventory?.technical_error > 0 || result?.batchStatus === 'technical_error'
        || result?.financialMetricsValid === false || (result?.outcome && !['completed', 'ruin'].includes(result.outcome.kind));
}

/** Gemeinsame lesende FR-6-Projektion; nur eingefrorene Laufdaten.
 * @param {object} result @param {{backtest?: boolean; moneyBasis?: string; inputs?: Partial<CoreTypes.SimulatorInputs>}} [options] @returns {object} */
export function projectMinimumFlexDisplay(result, { backtest = false, moneyBasis = DEFAULT_EURO_MODE, inputs = {} } = {}) {
    const block = backtest ? result?.metrics?.minimumFlexRestriction ?? result?.minimumFlexRestriction : result?.minimumFlexRestriction;
    const present = Object.hasOwn(result || {}, 'minimumFlexRestriction')
        || (backtest && Object.hasOwn(result?.metrics || {}, 'minimumFlexRestriction'));
    const technical = hasTechnicalFinancialError(result);
    const legacy = !present || block?.startMinimumFlexAnnual === 0;
    if (legacy) return { legacy: true, technical, title: LEGACY_FLEX_RESTRICTION_LABEL,
        basisNote: present ? 'Mindest-Flex war im Lauf nicht gesetzt.' : 'Älteres Ergebnis: ältere Grundlage ohne Mindest-Flex-Messung.' };
    const path = backtest ? block?.path : block;
    const pct = backtest ? path?.yearSharePct : block?.yearSharePctP50;
    const valid = !technical && block?.definitionVersion === 'MinimumFlexRestrictionV1'
        && block.priceBasis === 'nominal' && block.population === 'completed_decumulation_years'
        && block.comparison === 'paid_household_flex_lt_applied_positive_minimum'
        && amount(block.startMinimumFlexAnnual) && block.startMinimumFlexAnnual > 0
        && block.missingReason === null && path?.missingReason === null && share(pct)
        && (backtest ? Number.isInteger(path.observationCount) && path.observationCount > 0
            && Number.isInteger(path.affectedYearCount) && path.affectedYearCount >= 0
            && path.affectedYearCount <= path.observationCount
            && Math.abs(pct - path.affectedYearCount / path.observationCount * 100) < 1e-8
            : Number.isInteger(block.sampleSize) && block.sampleSize > 0 && share(block.affectedRunSharePct));
    const reason = technical ? 'Wegen technischer Fehler ist diese Antwort nicht auswertbar.'
        : 'Nicht auswertbar: vollständige Mindest-Flex-Messdaten fehlen.';
    const minimumNote = amount(block?.startMinimumFlexAnnual)
        ? `Mindest-Flex zum Laufstart: ${formatWholeEuro(block.startMinimumFlexAnnual)}; im Lauf jährlich fortgeschrieben. Vergleich mit dem jeweils angewandten Jahresbetrag.`
        : 'Der Mindest-Flex zum Laufstart fehlt; aktuelle Eingaben ersetzen keinen Laufwert.';
    const realAmounts = result?.euroMetrics?.real?.minimumFlexAmounts;
    const real = !backtest && moneyBasis === 'real';
    const paid = backtest ? path?.paidMedianNominalEur : real ? realAmounts?.paidMedianRealEurP50 : block?.paidMedianNominalEurP50;
    const desired = backtest ? path?.desiredMedianNominalEur : real ? realAmounts?.desiredMedianRealEurP50 : block?.desiredMedianNominalEurP50;
    const lowest = backtest ? path?.paidMinimumNominalEur : real ? realAmounts?.paidMinimumRealEurP50 : block?.paidMinimumNominalEurP50;
    const euros = value => valid && amount(value) ? formatWholeEuro(value) : '—';
    const basis = euroBasisLabel(real ? 'real' : 'nominal');
    const amountNote = `${backtest ? 'Nominale Jahresbeträge' : `Jahresbeträge · ${basis}`}: typisch bezahlt ${euros(paid)}, Wunsch ${euros(desired)}, schwächstes Jahr ${euros(lowest)}.${valid && ![paid, desired, lowest].every(amount) ? ' Betragsangaben fehlen; bitte neu rechnen.' : ''}`;
    const populationNote = backtest ? 'Beobachtete abgeschlossene Entnahmejahre bis Laufende.'
        : `Anteil betroffener Läufe: ${valid ? formatPercentage(block.affectedRunSharePct) : '—'} (mindestens ein Jahr unter Mindest-Flex). Mediane der Laufstatistiken, keine gepoolten Jahre; ${Number.isInteger(block?.sampleSize) ? block.sampleSize : 0} auswertbare Läufe.`;
    const paidAbovePlan = valid && amount(paid) && amount(desired) && paid > desired;
    const desiredLabel = backtest ? 'Wunsch-Flex im Lauf' : 'Wunsch-Flex im typischen Lauf';
    const compactAmounts = paidAbovePlan
        ? `Typisch ${euros(paid)} · ${desiredLabel} ${euros(desired)}`
        : `Typisch ${euros(paid)} von ${euros(desired)} ${desiredLabel}`;
    const note = valid ? `${backtest ? 'Nominale Jahresbeträge' : `Jahresbeträge · ${basis}`} · ${compactAmounts} · schwächstes Jahr ${euros(lowest)}` : '';
    const desiredFlex = valid && !backtest ? {
        label: desiredLabel, value: euros(desired),
        plan: amount(inputs.startFlexBedarf) ? formatWholeEuro(inputs.startFlexBedarf) : '—',
        tooltip: `Der Wunsch-Flex wird nach dem Tod einer Person auf ${Number.isFinite(inputs.survivorFlexPercent) ? `${inputs.survivorFlexPercent} % laut Modellannahmen` : 'den Prozentsatz aus den Modellannahmen'} und durch den Flex-Level bei Pflege angepasst.`,
        note: `Jahresbeträge · ${basis} · Typisch bezahlt ${euros(paid)} · schwächstes Jahr ${euros(lowest)}`
    } : null;
    return { legacy: false, valid, title: backtest ? 'Jahre unter Mindest-Flex' : 'Anteil Jahre unter Mindest-Flex',
        value: valid ? formatPercentage(pct) : '—', count: valid && backtest ? path.affectedYearCount : null,
        affectedRunValue: valid && !backtest ? formatPercentage(block.affectedRunSharePct) : '—',
        observationCount: valid && backtest ? path.observationCount : null,
        text: !valid ? reason : pct === 0
            ? `Im typischen Lauf liegt dein Flex in keinem ausgewerteten Entnahmejahr unter deinem Mindest-Flex (zum Laufstart ${euros(block.startMinimumFlexAnnual)}).`
            : `In typisch ${formatPercentage(pct)} der Entnahmejahre liegt dein Flex unter deinem Mindest-Flex (zum Laufstart ${euros(block.startMinimumFlexAnnual)}).`,
        note, desiredFlex, tooltip: `${minimumNote} ${populationNote} ${amountNote} Wunsch-Flex im Lauf und bezahlter Haushalts-Flex enthalten den Rentenbeitrag zum Flex. Dynamic Flex (VPW) kann mehr als den Wunsch-Flex im Lauf auszahlen. Das ist keine Garantie für alle Läufe oder die gesamte Lebenszeit.`,
        reason: valid ? '' : reason };
}
