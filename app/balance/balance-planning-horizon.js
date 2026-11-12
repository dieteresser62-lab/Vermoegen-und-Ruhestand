import { projectPerson, personBirthYear } from '../profile/profile-person-data.js';
import { resolvePlanningHorizon } from '../shared/planning-horizon.js';
import { ValidationError } from './balance-config.js';

/** Nur Rechenprojektion: gespeicherte Planjahre und Personenrecords bleiben erhalten. */
/** @param {import('../../typcheck/balance-ui.js').Input} input @param {import('../../typcheck/balance-ui.js').PersonStatus} status @returns {import('../../typcheck/balance-ui.js').Input & {guardrailPlanHorizonYears?: number}} */
export function projectBalancePlanningHorizon(input, status) {
    if (!input.dynamicFlex) return input;
    // FR-75: Geburtsjahr für die Kohortentafel; ohne Geburtsdatum Planungsjahr − Alter.
    const people = status.status === 'demo'
        ? [{ startAlter: input.aktuellesAlter, geschlecht: 'm',
            ...(Number.isInteger(status.referenceYear) ? { geburtsjahr: status.referenceYear - input.aktuellesAlter } : {}) }]
        : [...status.entries].sort((a, b) => Number(b.profileId === status.calculationProfileId)
            - Number(a.profileId === status.calculationProfileId))
            .map(entry => ({ ...projectPerson(entry.data, status.referenceYear),
                geburtsjahr: personBirthYear(entry.data, status.referenceYear) }));
    const [primary, partner] = people;
    const resolved = resolvePlanningHorizon({ ...input,
        startAlter: primary.startAlter, geschlecht: primary.geschlecht, geburtsjahr: primary.geburtsjahr,
        partner: partner ? { ...partner, aktiv: true } : { aktiv: false }
    });
    if (!resolved.valid) throw new ValidationError(resolved.errors);
    return { ...input, guardrailPlanHorizonYears: input.horizonYears,
        horizonYears: resolved.horizonYears,
        ...(resolved.diagnostics.longevityMode !== 'none'
            ? { longevityHorizonDiagnostics: resolved.diagnostics } : {}) };
}
