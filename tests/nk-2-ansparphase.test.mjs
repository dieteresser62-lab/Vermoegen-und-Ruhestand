// NK-2 Punkt 6 (FR-84 Punkte 13 und 17, Nachtrag 6): Auch in der gesonderten Ansparphase (`accumulationPhase`, nicht das Ansparen aus dem
// Gehaltsüberschuss) beendet eine Steuerlücke den Lauf nicht; sie bleibt als Schuld und wird später bezahlt. Beispielhaushalt Martin und
// Petra (Testament mit Wohnrecht), Martin stirbt im ersten Jahr, Geld 10.000 €, Grundbedarf und Flex null. Erfundene Beträge.
import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { EngineAPI } from '../engine/index.mjs';

const close = (actual, expected, label, tolerance = 0.01) => assert(Math.abs(actual - expected) <= tolerance, `${label} (${actual} statt ${expected})`);
const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
Object.assign(inputs, { startFloorBedarf: 0, startFlexBedarf: 0, minimumFlexAnnual: 0, accumulationPhase: { enabled: true, sparrate: 0 }, transitionYear: 5 });
const state = initMcRunState(inputs);
for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt']) state.portfolio[key] = [];
state.portfolio.personAccounts.forEach(account => { account.tagesgeld = 5000; account.geldmarktEtf = 0; });
state.portfolio.liquiditaet = 10000;
const year = { jahr: 2000, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0, lohn: 0 }, alive = { p1Alive: false, p2Alive: true };
const death = simulateOneYear(state, inputs, year, 0, null, 0, alive, 1, EngineAPI);
assertEqual(`${death.kind} · ${death.logData.Regime}`, 'success · accumulation', 'Ansparphase: Todesjahr mit ungedeckter Erbschaftsteuer endet nicht als Ruin');
assert(death.logData.erbschaftsteuer > 0 && death.logData.steuer_offen > 0, `Ansparphase: offene Erbschaftsteuer bleibt Schuld (${death.logData.steuer_offen})`);
assert(!death.logData.immobilien_notverkauf, 'Ansparphase: im Entstehungsjahr kein Notverkauf');
close(death.logData.portfolio_flow_delta, 0, 'Ansparphase: Jahresbilanz stimmt, die offene Steuer fließt nicht ab');
close(death.logData.portfolio_total_end, portfolioTotal(death.newState.portfolio), 'Ansparphase: Jahresendvermögen netto');
// Im Folgejahr kommt Geld dazu (100.000 € Tagesgeld): Die Schuld wird bezahlt.
const next = structuredClone(death.newState);
next.portfolio.personAccounts.forEach(account => { account.tagesgeld += 100000; });
next.portfolio.liquiditaet += 100000 * next.portfolio.personAccounts.length;
const paid = simulateOneYear(next, inputs, year, 1, null, 0, alive, 1, EngineAPI);
assertEqual(`${paid.kind} · ${paid.logData.Regime} · ${paid.logData.steuer_offen ?? 0}`, 'success · accumulation · 0', 'Ansparphase: Folgejahr bezahlt die Schuld');
close(paid.logData.steuer_schuld_vorjahr, death.logData.steuer_offen, 'Ansparphase: Vorjahresschuld fällig');
