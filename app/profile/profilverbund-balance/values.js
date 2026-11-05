import { resolveLiquidityRunwayYears } from '../../../types/liquidity-runway-contract.js';

export function readNumber(value, fallback = 0) {
    // PE-1/MP-1: Simulationswerte sind bereits Zahlen; kein Text-Roundtrip je Jahr.
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    if (value === null || value === undefined || value === '') return fallback;
    const n = Number(String(value).replace(',', '.'));
    return Number.isFinite(n) ? n : fallback;
}

export function normalizeBalanceInputs(inputs, overrides = {}) {
    if (!inputs || typeof inputs !== 'object') return null;
    const tagesgeldOverride = overrides.profileTagesgeld;
    const renteMonatlichOverride = overrides.profileRenteMonatlich;
    const renteAktivOverride = overrides.profileRenteAktiv;
    const sonstigeEinkuenfteOverride = overrides.profileSonstigeEinkuenfte;
    const goldAktivOverride = overrides.profileGoldAktiv;
    const goldZielOverride = overrides.profileGoldZiel;
    const goldFloorOverride = overrides.profileGoldFloor;
    const goldSteuerfreiOverride = overrides.profileGoldSteuerfrei;
    const goldRebalBandOverride = overrides.profileGoldRebalBand;
    const profileAlterOverride = overrides.profileAlter;
    const balanceAlter = readNumber(inputs.aktuellesAlter, null);
    const aktuellesAlter = Number.isFinite(profileAlterOverride)
        ? profileAlterOverride
        : balanceAlter;
    const renteMonatlich = Number.isFinite(renteMonatlichOverride)
        ? renteMonatlichOverride
        : readNumber(inputs.renteMonatlich, 0);
    const sonstigeEinkuenfte = Number.isFinite(sonstigeEinkuenfteOverride)
        ? sonstigeEinkuenfteOverride
        : 0;
    const renteSumme = renteMonatlich + sonstigeEinkuenfte;
    return {
        ...(Number.isFinite(aktuellesAlter) ? { aktuellesAlter } : {}),
        floorBedarf: readNumber(inputs.floorBedarf, 0),
        flexBedarf: readNumber(inputs.flexBedarf, 0),
        renteAktiv: typeof renteAktivOverride === 'boolean' ? renteAktivOverride : (renteSumme > 0),
        renteMonatlich: renteSumme,
        tagesgeld: Number.isFinite(tagesgeldOverride) ? tagesgeldOverride : readNumber(inputs.tagesgeld, 0),
        geldmarktEtf: readNumber(inputs.geldmarktEtf, 0),
        depotwertAlt: readNumber(inputs.depotwertAlt, 0),
        depotwertNeu: readNumber(inputs.depotwertNeu, 0),
        goldWert: readNumber(inputs.goldWert, 0),
        costBasisAlt: readNumber(inputs.costBasisAlt, 0),
        costBasisNeu: readNumber(inputs.costBasisNeu, 0),
        goldCost: readNumber(inputs.goldCost, 0),
        tqfAlt: readNumber(inputs.tqfAlt, 0),
        tqfNeu: readNumber(inputs.tqfNeu, 0),
        goldAktiv: typeof goldAktivOverride === 'boolean' ? goldAktivOverride : Boolean(inputs.goldAktiv),
        goldZielProzent: Number.isFinite(goldZielOverride) ? goldZielOverride : readNumber(inputs.goldZielProzent, 0),
        goldFloorProzent: Number.isFinite(goldFloorOverride) ? goldFloorOverride : readNumber(inputs.goldFloorProzent, 0),
        goldSteuerfrei: typeof goldSteuerfreiOverride === 'boolean' ? goldSteuerfreiOverride : Boolean(inputs.goldSteuerfrei),
        rebalancingBand: Number.isFinite(goldRebalBandOverride) ? goldRebalBandOverride : readNumber(inputs.rebalancingBand, 0),
        kirchensteuerSatz: readNumber(inputs.kirchensteuerSatz, 0),
        sparerPauschbetrag: readNumber(inputs.sparerPauschbetrag, 0),
        liquidityRunwayYears: resolveLiquidityRunwayYears(inputs).years
    };
}

export function profileAssetTotal(inputs) {
    if (!inputs) return 0;
    return (inputs.depotwertAlt || 0)
        + (inputs.depotwertNeu || 0)
        + (inputs.goldWert || 0)
        + (inputs.tagesgeld || 0)
        + (inputs.geldmarktEtf || 0);
}

export function profileLiquidity(inputs) {
    if (!inputs) return 0;
    return (inputs.tagesgeld || 0) + (inputs.geldmarktEtf || 0);
}
