import { projectPerson } from '../profile/profile-person-data.js';
import { resolvePlanningHorizon } from '../shared/planning-horizon.js';
import { ValidationError } from './balance-config.js';

/** Nur Rechenprojektion: gespeicherte Planjahre und Personenrecords bleiben erhalten. */
export function projectBalancePlanningHorizon(input, status) {
    if (!input.dynamicFlex) return input;
    const people = status.status === 'demo'
        ? [{ startAlter: input.aktuellesAlter, geschlecht: 'm' }]
        : [...status.entries].sort((a, b) => Number(b.profileId === status.calculationProfileId)
            - Number(a.profileId === status.calculationProfileId))
            .map(entry => projectPerson(entry.data, status.referenceYear));
    const [primary, partner] = people;
    const resolved = resolvePlanningHorizon({ ...input,
        startAlter: primary.startAlter, geschlecht: primary.geschlecht,
        partner: partner ? { ...partner, aktiv: true } : { aktiv: false }
    });
    if (!resolved.valid) throw new ValidationError(resolved.errors);
    return { ...input, guardrailPlanHorizonYears: input.horizonYears,
        horizonYears: resolved.horizonYears,
        ...(resolved.diagnostics.longevityMode !== 'none'
            ? { longevityHorizonDiagnostics: resolved.diagnostics } : {}) };
}
