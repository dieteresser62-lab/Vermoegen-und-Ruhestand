import { EngineAPI } from '../engine/index.mjs';
import { inputs as fixtureInputs, records } from './extended/parity-replay-fixture.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { calculateHouseholdPensionForYear, survivorIncomeOffset, CURRENT_PENSION_VALUE } from '../app/simulator/simulator-household-pension.js';
import { survivorFloorPercent, finishSurvivorYear } from '../app/simulator/simulator-survivor.js';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { normalizeWidowOptions } from '../app/simulator/simulator-sweep-utils.js';
import { rng } from '../app/simulator/simulator-utils.js';
import { readWidowOptions } from '../app/simulator/simulator-input-pension.js';
import { buildSimulatorInputsFromProfileData } from '../app/simulator/simulator-profile-inputs.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';

const inputs = { ...structuredClone(fixtureInputs), survivorFloorPercent: 70, survivorFlexPercent: 75, survivorMinimumFlexPercent: 75, startAlter: 75, renteMonatlich: 2000, renteStartOffsetJahre: 0, renteStartMonate: 12,
    partner: { ...fixtureInputs.partner, aktiv: true, startAlter: 70, brutto: 12000, monatsrente: 1000, startInJahren: 0, renteStartMonate: 12 },
    rentAdjMode: 'fix', rentAdjPct: 2, pflegefallLogikAktivieren: false };
inputs.simulationPeople.forEach((person, i) => { person.name = `Muster ${i === 0 ? 'A' : 'B'}`; });
const year = { jahr: 2000, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const widow = { p1FromP2: false, p2FromP1: true, p1FromP2Percent: .55, p2FromP1Percent: .55 };
const pensionArgs = { inputs, yearIndex: 0, currentAnnualPension: 24000, currentAnnualPension2: 12000,
    p1Alive: false, p2Alive: true, widowBenefits: widow };
assertEqual(CURRENT_PENSION_VALUE, 42.52, 'FR-22: dokumentierter Rentenwert ab Juli 2026');
assertEqual(survivorIncomeOffset(1000), 0, 'FR-22: eigene Rente unter Freibetrag');
assertClose(survivorIncomeOffset(2000), (2000 - 26.4 * 42.52) * .4, 1e-10, 'FR-22: Nettorente ohne Abzug, 40 % über Freibetrag');
const normal = calculateHouseholdPensionForYear(pensionArgs);
assertClose(normal.widowBenefitP2ThisYear, 13200, 1e-9, 'FR-22: ungekürzte Hinterbliebenenrente unter Freibetrag');
const high = calculateHouseholdPensionForYear({ ...pensionArgs, currentAnnualPension2: 24000 });
const offset = survivorIncomeOffset(2000) * 12;
assertClose(high.widowBenefitP2ThisYear, 13200 - offset, 1e-9, 'FR-22: eigene Monatsrente über Freibetrag');
const next = calculateHouseholdPensionForYear({ ...pensionArgs, yearIndex: 1, currentAnnualPension: 24480,
    currentAnnualPension2: 24480, widowPensionP2: high.nextWidowPensionP2 });
assertClose(next.pensionValue, 42.52 * 1.02, 1e-12, 'FR-22: Freibetrag wird wie die Renten angepasst');
assertClose(next.widowBenefitP2ThisYear, high.widowBenefitP2ThisYear * 1.02, 1e-8, 'FR-22: Anrechnung jedes Jahr neu, keine doppelte Kürzung');
assertEqual(calculateHouseholdPensionForYear({ ...pensionArgs, currentAnnualPension2: 240000 }).widowBenefitP2ThisYear, 0, 'FR-22: Untergrenze 0');
for (const entitled of [true, false]) {
    const death = calculateHouseholdPensionForYear({ ...pensionArgs, deathThisYear: true,
        widowBenefits: { ...widow, p2FromP1: entitled } });
    assertEqual(death.rente1BruttoEigen, 12000, 'FR-23: sechs Monate eigene Rente');
    assertEqual(death.bereavementQuarterP2, entitled ? 6000 : 0, 'FR-23: Sterbevierteljahr nur mit Anspruch');
    assertClose(death.widowBenefitP2ThisYear, entitled ? 3300 : 0, 1e-9, 'FR-23: drei Monate Hinterbliebenenrente nur mit Anspruch');
    assertEqual(death.pensionAnnual, entitled ? 33300 : 24000, 'FR-23: Todesjahr mit/ohne Anspruch');
}
const reverse = calculateHouseholdPensionForYear({ ...pensionArgs, deathThisYear: true, p1Alive: true, p2Alive: false,
    widowBenefits: { ...widow, p1FromP2: true, p2FromP1: false } });
assertEqual(reverse.rente2BruttoEigen, 6000, 'FR-23: auch Tod der zweiten Person wird halbjährig gerechnet');
assertEqual(reverse.bereavementQuarterP1, 3000, 'FR-23: Sterbevierteljahr bleibt ohne Anrechnung');
assertClose(reverse.widowIncomeOffsetP1, offset / 4, 1e-9, 'FR-23: Anrechnung nur auf die letzten drei Monate');

for (const percent of [undefined, 40, 70, 100, 150, 200]) assertEqual(survivorFloorPercent(percent), percent ?? 75, 'FR-21: Altbestand und gültige Grenzen');
for (const invalid of [39, 201, NaN, '']) {
    let threw = false;
    try { survivorFloorPercent(invalid); } catch { threw = true; }
    assert(threw, 'FR-21: ungültiger Anteil wird abgewiesen');
}
const doc = { getElementById: id => id === 'survivorFloorPercent' ? { value: '80' } : null };
assertEqual(readWidowOptions(doc).survivorFloorPercent, 80, 'FR-21: Formularfeld gelesen');
assertEqual(readWidowOptions({ getElementById: () => null }).survivorFloorPercent, 75, 'FR-55: altes Formular erhält 75 %');

// Exakter Nachlass: Aktien, Gold, Geldmarkt und Pflegereserve samt Kaufdaten.
const estate = { personAccounts: [
    { profileId: 'a', tagesgeld: 10000, geldmarktEtf: 0, sparerPauschbetrag: 1000, taxState: { lossCarry: 8000 } },
    { profileId: 'b', tagesgeld: 20000, geldmarktEtf: 0, sparerPauschbetrag: 1000, taxState: { lossCarry: 3000 } }
], simulationSourceProfileId: 'a', healthBucketCashOwners: [{ profileId: 'a', amount: 5000 }] };
const lot = { sourceProfileId: 'a', trancheId: 'lot-a', marketValue: 10000, costBasis: 4000,
    purchaseDate: '2010-01-02', shares: 100, type: 'aktien_neu' };
for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches']) estate[key] = [{ ...lot, trancheId: `${lot.trancheId}:${key}` }];
const inherited = finishSurvivorYear({ newState: { portfolio: estate, lastState: { taxState: { lossCarry: 8000 } } }, logData: {} },
    { survivor: { deathYearIndex: 0, deceasedProfileId: 'a', survivorProfileId: 'b' }, deathThisYear: true }, normal);
assertEqual(estate.personAccounts.length, 1, 'FR-24: nur das Konto der lebenden Person bleibt');
assertEqual(estate.personAccounts[0].tagesgeld, 30000, 'FR-24: Tagesgeld wird vollständig übertragen');
assertEqual(estate.personAccounts[0].geldmarktEtf, 10000, 'FR-24: Geldmarkt wird übertragen');
assertEqual(inherited.newState.lastState.taxState.lossCarry, 3000, 'FR-24: nur eigener Verlustvortrag bleibt');
assertEqual(estate.personAccounts[0].sparerPauschbetrag, 1000, 'FR-24: kein geerbter Pauschbetrag');
for (const key of ['depotTranchesAktien', 'depotTranchesGold', 'depotTranchesGeldmarkt', 'healthBucketTranches']) {
    assertEqual(JSON.stringify(estate[key][0]), JSON.stringify({ ...lot, trancheId: `${lot.trancheId}:${key}`, sourceProfileId: 'b' }), 'FR-24: Eigentümerwechsel erhält Kaufdatum, Anschaffungskosten und Stückzahl');
}
assertEqual(estate.healthBucketCashOwners[0].profileId, 'b', 'FR-24: auch reserviertes Bargeld gehört der lebenden Person');

// Fester Seed und erzwungener Sterblichkeitszug: beide Lebensereignispfade benutzen dieselbe Jahresrechnung.
const widowOptions = normalizeWidowOptions({ mode: 'percent', percent: .55, minMarriageYears: 1 });
const life = createMonteCarloLifeState(inputs, rng(12345), widowOptions);
let calls = 0;
const deathYear = updateMonteCarloLifeEventsForYear(life, inputs, widowOptions, 0, year, 0, null, false, () => calls++ === 0 ? 0 : .999999);
assert(!life.p1Alive && life.p2Alive, 'FR-21/23: synthetische Person A stirbt, B überlebt');
assertEqual(deathYear.householdContext.widowBenefits.p2FromP1, true, 'FR-23: Anspruch bereits im Sterbejahr');
const state = initMcRunState(inputs);
state.portfolio.personAccounts[0].taxState = { lossCarry: 8000 };
state.portfolio.personAccounts[1].taxState = { lossCarry: 3000 };
let captured;
const engine = { ...EngineAPI, simulateSingleYear(input, lastState) { captured = input; return EngineAPI.simulateSingleYear(input, lastState); } };
const first = simulateOneYear(state, inputs, year, 0, null, 0, deathYear.householdContext, .75, engine);
assertEqual(first.kind, 'success', 'FR-23/24: Todesjahr vollständig auswertbar');
assertEqual(first.logData.floor_brutto, inputs.startFloorBedarf * .85, 'FR-23: Todesjahr je zur Hälfte Paarbedarf und Bedarf danach');
assertClose(first.logData.flex_brutto_haushalt, inputs.startFlexBedarf * .875, 1e-8, 'FR-23: Flex im Todesjahr halbjährlich');
assertEqual(first.logData.renteSum, 33300, 'FR-23: gemeinsame Jahresrechnung erhält die Aufteilung');
assertEqual(first.ui.action.taxSettlement.profiles.find(p => p.profileId === inputs.simulationPeople[0].profileId).details.lossCarryStart, 0, 'FR-24: Verlustvortrag des Verstorbenen verfällt');
const second = simulateOneYear(first.newState, inputs, year, 1, null, 2000, deathYear.householdContext, .75, engine);
assertEqual(second.kind, 'success', 'FR-21/24: Folgejahr auswertbar');
assertClose(second.logData.floor_brutto, inputs.startFloorBedarf * 1.02 * .7 + 2000, 1e-8, 'FR-21: 70 % Paarwert mit Inflation plus Pflege der lebenden Person');
assertEqual(captured.sparerPauschbetrag, inputs.simulationPeople[1].sparerPauschbetrag, 'FR-24: ab Folgejahr nur eigener SPB im Engineeingang');
assert(second.logData.personAccounts.every(p => p.profileId === inputs.simulationPeople[1].profileId), 'FR-24: Folgeauszahlungen nur über lebende Person');
assert(!renderProtocolTable([first.logData, second.logData], { source: 'mc' }).includes('data-protocol-column="widow-income-offset"'), 'FR-22: Ohne Anrechnungsbetrag bleibt die Spalte ausgeblendet');
const highPensionInputs = { ...inputs, partner: { ...inputs.partner, brutto: 24000, monatsrente: 2000 } };
const highPensionYear = simulateOneYear(initMcRunState(highPensionInputs), highPensionInputs, year, 0, null, 0, deathYear.householdContext, .75, EngineAPI);
assertEqual(highPensionYear.kind, 'success', 'FR-22: Todesjahr mit anrechenbarer eigener Rente auswertbar');
assert(highPensionYear.logData.WidowIncomeOffset > 0, 'FR-22: Höhere eigene Rente erzeugt einen Anrechnungsbetrag');
assert(renderProtocolTable([highPensionYear.logData], { source: 'mc', logDetailLevel: 'detailed' }).includes('data-protocol-column="widow-income-offset"'), 'FR-22: Anrechnung im Szenarioprotokoll sichtbar');
const profileData = Object.values(JSON.parse(records.rs_profiles_v1).profiles)[0].data;
const baselineProfile = buildSimulatorInputsFromProfileData(profileData, { referenceYear: 2026 });
assertEqual(baselineProfile.survivorFloorPercent, 75, 'FR-55: fehlender Wert erhält 75 %');
assertEqual(buildSimulatorInputsFromProfileData({ ...profileData, sim_survivorFloorPercent: '80' }, { referenceYear: 2026 }).survivorFloorPercent, 80, 'FR-21: gespeicherter Feldwert wird geladen');
