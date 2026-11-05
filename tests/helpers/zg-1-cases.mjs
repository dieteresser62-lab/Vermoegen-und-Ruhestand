import { inputs as fixture } from '../extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../../engine/index.mjs';
export function inheritanceCase(status = 'married', regime = 'separation') {
    const inputs = { ...structuredClone(fixture), partnership: { schemaVersion: 1, status, maritalPropertyRegime: regime,
        inheritance: { muster_a: 50 }, marriedInheritance: { muster_a: 50 } },
        home: [{ id: 'zg-home', profileId: 'muster_a', wert: 900000, nutzung: 'vermietet', stand: '2026-10' }], homeReferenceYear: 2026 };
    const state = initMcRunState(inputs);
    for (const lot of state.portfolio.depotTranchesAktien) if (lot.sourceProfileId === 'muster_a') lot.marketValue += 2000000;
    return { inputs, state };
}
export function deathYear(inputs, state = initMcRunState(inputs), index = 0, inflation = 0) {
    return simulateOneYear(state, inputs, { jahr: 2000 + index, inflation, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        index, null, 0, { p1Alive: false, p2Alive: true }, 1, EngineAPI);
}

export function zg1bControlCase(kind) {
    const { inputs, state } = inheritanceCase(kind === 'unmarried' ? 'unmarried' : 'married',
        kind === 'separation' ? 'separation' : 'community');
    if (kind === 'no-home') inputs.home = [];
    if (['separation', 'unmarried'].includes(kind)) {
        inputs.home[0].nutzung = 'selbst';
        inputs.plannedInflowsReferenceYear = 2026;
        inputs.plannedInflows = [{ profileId: 'muster_a', year: 2026, amount: 300000, label: 'Synthetischer Zufluss' }];
    }
    return { inputs, state };
}
