// @ts-check
/** NK-2d: Haushalts-Engine mit gekürztem Flex, bis die Entnahme dem verteilbaren Betrag entspricht (lineare Näherung zwischen Flex 0 und
 * dem bisherigen Flex, höchstens vier Schritte). @param {any} engineApi @param {any} input @param {any} lastState @param {number} target
 * @param {number} decided @returns {{input: any, result: any, annual: number}} */
export function capHouseholdFlex(engineApi, input, lastState, target, decided) {
    const run = (/** @type {number} */ flex) => {
        const next = { ...input, flexBedarf: flex, minimumFlexAnnual: Math.min(Number(input.minimumFlexAnnual) || 0, flex) };
        const result = engineApi.simulateSingleYear(next, lastState);
        if (result?.error) throw result.error;
        return { input: next, result, annual: Number(result?.ui?.spending?.monatlicheEntnahme) * 12 };
    };
    const base = run(0);
    if (target <= base.annual + 0.5) return base;
    let flex = Number(input.flexBedarf) || 0, annual = decided, best = null;
    for (let step = 0; step < 4 && Math.abs(annual - target) > 0.5 && annual > base.annual + 0.005; step++) {
        flex = Math.max(0, flex * (target - base.annual) / (annual - base.annual));
        best = run(flex);
        annual = best.annual;
    }
    return best || base;
}
