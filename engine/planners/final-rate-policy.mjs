/** @import {Needs, EngineInput, EngineState, SpendingParameters, Market, RunwayProfile, AddDecision, Trace, AlarmStatus, PlannerState, KeyParams} from '../../typcheck/rechenkern' */
import { CONFIG } from '../config.mjs';


/** @param {number} prevFlexRate
 * @param {number} nextFlexRate
 * @param {Market} market
 * @param {AddDecision} addDecision
 * @param {number} wealthFactor
 * @param {Trace} [trace]
 * @param {number|null|undefined} withdrawalRate */
export function applyFinalRateLimits(prevFlexRate, nextFlexRate, market, addDecision, wealthFactor = 1, trace, withdrawalRate = null) {
    const limits = CONFIG.SPENDING_MODEL?.FLEX_RATE_FINAL_LIMITS;
    if (!limits) {
        trace?.record('final_smoothing', nextFlexRate, nextFlexRate, 'Finale Glättung', { aktiviert: false });
        return { rate: nextFlexRate, applied: false };
    }

    const baseMaxUp = limits.MAX_UP_PP ?? 0;
    const baseMaxDown = (market?.sKey === 'bear_deep')
        ? (limits.MAX_DOWN_IN_BEAR_PP ?? limits.MAX_DOWN_PP ?? 0)
        : (limits.MAX_DOWN_PP ?? 0);
    const w = Number.isFinite(wealthFactor) ? Math.min(1, Math.max(0, wealthFactor)) : 1;
    // FR-29 muss auch die finale Glättung passieren; nachfolgende Safety-Caps
    // bleiben unverändert. Ohne belegte niedrige Quote gilt die bisherige Grenze.
    const maxUp = prevFlexRate < 100 && nextFlexRate > prevFlexRate && Number.isFinite(withdrawalRate)
        && withdrawalRate <= CONFIG.SPENDING_MODEL.RATE_CHANGE_RELAX_UP_WITHDRAWAL_RATE
        ? Math.max(baseMaxUp, CONFIG.SPENDING_MODEL.RATE_CHANGE_RELAX_MAX_UP_PP) : baseMaxUp;
    const relaxCap = Number.isFinite(limits.RELAX_MAX_DOWN_PP)
        ? limits.RELAX_MAX_DOWN_PP
        : 20;
    const relaxScale = 1 - w;
    const relax = relaxScale * relaxScale;
    const maxDown = baseMaxDown + (relax * (relaxCap - baseMaxDown));
    const delta = nextFlexRate - prevFlexRate;
    let rate = nextFlexRate;

    if (maxUp > 0 && delta > maxUp) {
        rate = prevFlexRate + maxUp;
        addDecision(
            'Glättung (Final-Guardrail)',
            `Anstieg nach Guardrails auf max. ${maxUp} pp begrenzt.`,
            'active',
            'guardrail'
        );
    } else if (maxDown > 0 && delta < -maxDown) {
        rate = prevFlexRate - maxDown;
        addDecision(
            'Glättung (Final-Guardrail)',
            `Rückgang nach Guardrails auf max. ${maxDown} pp begrenzt.`,
            'active',
            'guardrail'
        );
    }

    trace?.record('final_smoothing', nextFlexRate, rate, 'Finale Glättung', {
        vorjahresrateProzent: prevFlexRate,
        anstiegMaxProzentpunkte: maxUp,
        abfallMaxProzentpunkte: maxDown,
        vermoegensfaktorRatio: w
    });
    return { rate, applied: rate !== nextFlexRate };
}
