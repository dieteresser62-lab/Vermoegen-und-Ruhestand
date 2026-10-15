import { adjacent, finite } from './log-analysis-adapters.js';

/** Bündelt nur benachbarte belegte Jahre; Basiswechsel können die Phase teilen. */
export function collectPhases(rows, measure, { threshold = 1, splitBasis = false } = {}) {
    const phases = [];
    let phase = null;
    const finish = (endReason, next = null) => {
        if (!phase) return;
        phases.push({ ...phase, endReason, nextYear: next?.year ?? null,
            openAtEnd: endReason === 'end_of_observation' });
        phase = null;
    };
    for (const item of rows) {
        const observation = item.financial ? measure(item) : null;
        if (phase && !adjacent(phase.last, item)) finish('gap');
        if (!observation || !finite(observation.value)) {
            finish(item.financial ? 'missing_value' : 'terminal_or_not_evaluable', item);
            continue;
        }
        if (observation.value < threshold) { finish('below_threshold', item); continue; }
        if (phase && splitBasis && observation.basis !== phase.basis) finish('basis_change', item);
        phase ??= { first: item, last: item, durationYears: 0, maximumAnnualValue: 0,
            basis: observation.basis ?? null, observations: [] };
        phase.last = item;
        phase.durationYears++;
        phase.maximumAnnualValue = Math.max(phase.maximumAnnualValue, observation.value);
        phase.observations.push({ year: item.year, rowIndex: item.rowIndex, ...observation });
    }
    finish('end_of_observation');
    return phases;
}

export function phaseEvidence(phase) {
    return {
        startYear: phase.first.year, endYear: phase.last.year,
        endRowIndex: phase.last.rowIndex, durationYears: phase.durationYears,
        maximumAnnualValue: phase.maximumAnnualValue, endReason: phase.endReason,
        nextYear: phase.nextYear, openAtEnd: phase.openAtEnd,
        observations: phase.observations
    };
}
