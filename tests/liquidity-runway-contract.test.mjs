import {
    LIQUIDITY_RUNWAY_CONTRACT_V1,
    deriveLiquidityRunwayPolicy,
    isValidLiquidityRunwayYears,
    resolveLiquidityRunwayYears
} from '../types/liquidity-runway-contract.js';

console.log('--- Liquidity Runway Contract Tests ---');

assertEqual(LIQUIDITY_RUNWAY_CONTRACT_V1.version, 'LiquidityRunwayContractV1', 'contract version is explicit');
assertEqual(LIQUIDITY_RUNWAY_CONTRACT_V1.requestKey, 'liquidityRunwayYears', 'canonical request key is explicit');
assertEqual(LIQUIDITY_RUNWAY_CONTRACT_V1.defaultYears, 5, 'default runway is five years');
{
    const resolved = resolveLiquidityRunwayYears({
        liquidityRunwayYears: 6,
        runwayTargetMonths: 36,
        runwayMinMonths: 24
    });
    assertEqual(resolved.years, 6, 'canonical years win over every legacy value');
    assertEqual(resolved.source, 'canonical', 'canonical source is diagnosed');
}

{
    const resolved = resolveLiquidityRunwayYears({
        liquidityRunwayYears: 'not-a-number'
    });
    assert(Number.isNaN(resolved.years), 'non-empty invalid canonical value must fail closed');
    assertEqual(resolved.source, 'canonical_invalid', 'invalid canonical value is diagnosed explicitly');
}

{
    const resolved = resolveLiquidityRunwayYears({});
    assertEqual(resolved.years, 5, 'missing runway uses the new five-year default');
    assertEqual(resolved.source, 'default', 'default source is diagnosed');
}

for (const emptyCanonical of [undefined, null, '']) {
    const resolved = resolveLiquidityRunwayYears({ liquidityRunwayYears: emptyCanonical, runwayTargetMonths: 42, runwayMinMonths: 24 });
    assertEqual(resolved.years, 5, 'old month values are ignored and the default applies');
}

{
    const policy = deriveLiquidityRunwayPolicy(5);
    assertEqual(policy.targetMonths, 60, 'five years become a 60-month target');
    assertEqual(policy.hardMinimumMonths, 24, 'hard minimum is derived engine policy');
    assertEqual(policy.hardMinimumSource, 'engine_policy_cap_24_months', 'hard minimum is not represented as a user input');
}

{
    const policy = deriveLiquidityRunwayPolicy(1);
    assertEqual(policy.targetMonths, 12, 'one year becomes a 12-month target');
    assertEqual(policy.hardMinimumMonths, 12, 'derived hard minimum never exceeds the configured target');
}

for (const validYears of [1, 1.5, 5, 9.5, 10]) {
    assert(isValidLiquidityRunwayYears(validYears), `${validYears} years should satisfy range and step contract`);
}

for (const invalidYears of [0, 1.25, 10.5, -4, NaN, Infinity]) {
    assert(!isValidLiquidityRunwayYears(invalidYears), `${invalidYears} years should violate range or step contract`);
    let threw = false;
    try {
        deriveLiquidityRunwayPolicy(invalidYears);
    } catch (error) {
        threw = error instanceof RangeError;
    }
    assert(threw, `${invalidYears} years must fail closed before deriving an engine hard minimum`);
}

console.log('✅ Liquidity runway contract tests passed');
