import { computeHouseholdFlexFactor } from './simulator-engine-helpers.js';

/** Jahrespflege: im Sterbejahr halbe Zusatzkosten, danach keine Altwerte.
 *
 * @param {object} options
 * @param options.hasPartner
 * @param options.p1Alive
 * @param options.p2Alive
 * @param options.careMetaP1
 * @param options.careMetaP2
 * @param {boolean} [options.deathThisYear]
 * @param options.effectiveFlexFactor
 * @returns Ergebnis der Operation.
 */
export function buildCareLogFields({ hasPartner, p1Alive, p2Alive, careMetaP1, careMetaP2,
    deathThisYear = false, effectiveFlexFactor }) {
    const annualCare = (care, alive) => {
        if (!care?.active || (!alive && !deathThisYear)) return null;
        return alive ? care : { ...care, zusatzFloorZiel: (Number(care.zusatzFloorZiel) || 0) * .5,
            zusatzFloorDelta: (Number(care.zusatzFloorDelta) || 0) * .5,
            log_delta_flex: (Number(care.log_delta_flex) || 0) * .5,
            // Die Vorjahre bleiben voll; nur der laufende Jahreszuwachs zählt halb.
            kumulierteKosten: (Number(care.kumulierteKosten) || 0)
                - ((Number(care.zusatzFloorDelta) || 0) + (Number(care.log_delta_flex) || 0)) * .5 };
    };
    const p1 = annualCare(careMetaP1, p1Alive);
    const p2 = hasPartner ? annualCare(careMetaP2, p2Alive) : null;
    const active = [p1, p2].filter(Boolean);
    const sum = key => active.reduce((total, care) => total + (Number(care[key]) || 0), 0);
    const highest = active.reduce((selected, care) => !selected || care.grade > selected.grade ? care : selected, null);
    const survivorFactor = computeHouseholdFlexFactor({ hasPartner, p1Alive, p2Alive,
        careMetaP1: p1, careMetaP2: p2 });
    const annualFactor = deathThisYear && hasPartner
        ? (computeHouseholdFlexFactor({ hasPartner, p1Alive: true, p2Alive: true,
            careMetaP1, careMetaP2 }) + survivorFactor) / 2 : survivorFactor;
    return {
        pflege_aktiv: active.length > 0,
        pflege_zusatz_floor: sum('zusatzFloorZiel'),
        pflege_zusatz_floor_delta: sum('zusatzFloorDelta'),
        pflege_flex_faktor: active.length ? (effectiveFlexFactor ?? annualFactor) : 1,
        pflege_kumuliert: sum('kumulierteKosten'),
        pflege_grade: highest?.grade ?? null,
        pflege_grade_label: highest?.gradeLabel ?? '',
        pflege_delta_flex: sum('log_delta_flex'),
        pflege_floor_anchor: sum('log_floor_anchor'),
        pflege_maxfloor_anchor: sum('log_maxfloor_anchor'),
        pflege_cap_zusatz: sum('log_cap_zusatz'),
        CareP1_Active: p1 ? 1 : 0,
        CareP1_Cost: p1?.zusatzFloorZiel ?? 0,
        CareP1_Grade: p1?.grade ?? null,
        CareP1_GradeLabel: p1?.gradeLabel ?? '',
        CareP2_Active: p2 ? 1 : 0,
        CareP2_Cost: p2?.zusatzFloorZiel ?? 0,
        CareP2_Grade: p2?.grade ?? null,
        CareP2_GradeLabel: p2?.gradeLabel ?? '',
        ...(p1?.familyCareFallback && p1.grade <= 3 ? { CareP1_FamilyFallback: { ...p1.familyCareFallback } } : {}),
        ...(p2?.familyCareFallback && p2.grade <= 3 ? { CareP2_FamilyFallback: { ...p2.familyCareFallback } } : {})
    };
}
