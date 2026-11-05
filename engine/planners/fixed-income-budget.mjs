/** Unverbrauchte feste Einkünfte; gemeinsame FR-52-Grenze. */
/** @param {number} total
 * @param {number} floor
 * @param {number} flex
 * @param {boolean|undefined} dynamicFlex */
export function fixedIncomeSurplus(total, floor, flex, dynamicFlex) {
    const flexLimit = Math.max(0, flex) * (dynamicFlex ? 2 : 1);
    return Math.max(0, total - floor - flexLimit);
}

/** Einkommensanteil des beschlossenen Flex; FR-26 gilt für Einkommen und Depot zusammen. */
/** @param {{ui:{vpw?:{enabled?:boolean;dynamicFlexBeforeWishCap?:number;dynamicFlex?:number}|null}}} fullResult
 * @param {number} wishFlex
 * @param {number} netFloor
 * @param {number} annualWithdrawal */
export function decidedIncomeFlex(fullResult, wishFlex, netFloor, annualWithdrawal) {
    const vpw = fullResult.ui.vpw;
    if (vpw?.enabled !== true) return Math.max(0, wishFlex);
    const dynamicFlex = vpw.dynamicFlexBeforeWishCap ?? vpw.dynamicFlex;
    const portfolioFlex = Math.max(0, annualWithdrawal - netFloor);
    return Math.max(0, Math.min(/** @type {number} */ (dynamicFlex), 2 * wishFlex - portfolioFlex));
}

/** Jahresüberschuss nach der Budgetentscheidung, auch bei Pflege und Hinterbliebenen. */
/** @param {{input:import('../../typcheck/rechenkern').EngineInput;spending?:{monatlicheEntnahme?:number}|null;vpw?:{enabled?:boolean;dynamicFlexBeforeWishCap?:number;dynamicFlex?:number}|null}} options */
export function decidedFixedIncomeSurplus({ input, spending, vpw }) {
    const annualIncome = (input.renteAktiv ?? Number.isFinite(input.renteMonatlich)) && Number.isFinite(input.renteMonatlich) ? input.renteMonatlich * 12 : 0;
    const netFloor = Math.max(0, input.floorBedarf - annualIncome);
    const hasDecidedFlex = vpw?.enabled !== true
        || Number.isFinite(vpw.dynamicFlexBeforeWishCap ?? vpw.dynamicFlex);
    // Anzeigeobjekte ohne VPW gelten als statisch. Aktive Dynamik ohne beschlossene
    // Beträge verwendet dieselbe Vorgrenze wie die Simulatorgutschrift.
    const flex = hasDecidedFlex ? decidedIncomeFlex({ ui: { vpw } }, input.flexBedarf, netFloor,
        (Number.isFinite(spending?.monatlicheEntnahme) ? spending.monatlicheEntnahme * 12 : 0)) : input.flexBedarf;
    return fixedIncomeSurplus(annualIncome, input.floorBedarf, flex, !hasDecidedFlex && input.dynamicFlex);
}
