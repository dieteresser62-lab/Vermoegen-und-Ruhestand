// NK-1b: kleine synthetische Jahresfälle (erfundene Beträge) auf Basis der Max-und-Erika-Eingaben, unverheiratet oder verheiratet.
import { EngineAPI } from '../../engine/index.mjs';
import { inputs as fixture } from '../extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../../app/simulator/simulator-engine-wrapper.js';

export const A = 'muster_a', B = 'muster_b';
export const YEAR = { jahr: 2000, inflation: 0, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 };

/** Wertpapierposten einer Person. @param {string} profileId @param {number} value @param {number} cost @param {string} [category] */
export const lot = (profileId, value, cost, category = 'money_market') => ({ schemaVersion: 2, sourceProfileId: profileId,
    trancheId: `${profileId}-${category}`, name: `${category} ${profileId}`, isin: '', marketValue: value, costBasis: cost,
    shares: value, purchasePrice: cost / value, currentPrice: 1, purchaseDate: '2020-01-01', tqf: 0, taxExempt: false, category,
    type: category === 'money_market' ? 'geldmarkt' : 'aktien_neu' });

/** Paar ohne Renten und Flex. @param {{status?: 'unmarried'|'married', mode?: string, floor?: number, flex?: number,
 * cash?: [number, number], lots?: any[], pensionA?: number, home?: any[], healthBucket?: any}} [options] */
export function couple({ status = 'unmarried', mode = 'proportional', floor = 12000, flex = 0, cash = [0, 0], lots = [], pensionA = 0,
    home = [], healthBucket = null } = {}) {
    const inputs = { ...structuredClone(fixture), partnership: { schemaVersion: 1, status, inheritance: { [A]: 0, [B]: 0 } },
        householdWithdrawalMode: mode, startVermoegen: cash[0] + cash[1] + lots.reduce((sum, row) => sum + row.marketValue, 0),
        depotwertAlt: 0, depotwertNeu: 0, einstandAlt: 0, einstandNeu: 0, tagesgeld: cash[0] + cash[1], geldmarktEtf: 0,
        detailledTranches: lots, startFloorBedarf: floor, startFlexBedarf: flex, minimumFlexAnnual: 0, renteMonatlich: pensionA / 12,
        partner: { ...fixture.partner, monatsrente: 0, brutto: 0, startInJahren: 0, renteStartMonate: 12 }, goldStrategyDiagnostics: [],
        home, homeReferenceYear: 2026, plannedExpenses: [], fixedIncome: [] };
    if (healthBucket) Object.assign(inputs, { healthBucket: { ...fixture.healthBucket, ...healthBucket }, healthBucketEnabled: true,
        healthBucketInitialAmount: healthBucket.initialAmount });
    inputs.simulationPeople[0].tagesgeld = cash[0];
    inputs.simulationPeople[1].tagesgeld = cash[1];
    return inputs;
}

/** Ein Jahr mit eigener Pflege von B (zu Hause, Grad 3). @param {any} inputs @param {number} [careB] @param {any} [state] @param {number} [yearIndex] */
export function yearWithCare(inputs, careB = 0, state = null, yearIndex = 0) {
    const household = { p1Alive: true, p2Alive: true, ...(careB > 0 ? { care: { p2: { active: true, grade: 3, zusatzFloorZiel: careB, zusatzFloorDelta: careB } } } : {}) };
    return simulateOneYear(state || initMcRunState(inputs), inputs, YEAR, yearIndex, null, careB, household, 1, EngineAPI);
}

/** Alleinstehende Person ohne Rente, Flex und Pflegelogik. @param {{cash?: number, floor?: number, reserve?: number, lots?: any[]}} [options] */
export function single({ cash = 0, floor = 12000, reserve = 0, lots = [] } = {}) {
    const total = cash + reserve;
    const input = { ...structuredClone(fixture), startVermoegen: total + lots.reduce((sum, row) => sum + row.marketValue, 0), depotwertAlt: 0,
        depotwertNeu: 0, einstandAlt: 0, einstandNeu: 0, tagesgeld: total, geldmarktEtf: 0, detailledTranches: lots, startFloorBedarf: floor,
        startFlexBedarf: 0, minimumFlexAnnual: 0, renteMonatlich: 0, renteStartOffsetJahre: 0, renteStartMonate: 12, rentAdjMode: 'fix',
        rentAdjPct: 0, pflegefallLogikAktivieren: false, dynamicFlex: false, goldAktiv: false, plannedExpenses: [], fixedIncome: [], home: [],
        healthBucket: reserve > 0 ? { ...fixture.healthBucket, enabled: true, initialAmount: reserve, assetSource: 'cash' } : { enabled: false },
        healthBucketEnabled: reserve > 0, ...(reserve > 0 ? { healthBucketInitialAmount: reserve } : {}), partner: { aktiv: false } };
    input.simulationPeople = input.simulationPeople.slice(0, 1).map(person => ({ ...person, tagesgeld: total }));
    return input;
}

/** Ein Jahr ohne Lebensereignisse (wie der Backtest). @param {any} inputs @param {any} [state] @param {number} [yearIndex] */
export const plainYear = (inputs, state = null, yearIndex = 0) => simulateOneYear(state || initMcRunState(inputs), inputs, YEAR, yearIndex, null, 0, null, 1, EngineAPI);
