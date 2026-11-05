import { measurementInputs } from './helpers/ek-1b-measurement.mjs';
import { initMcRunState, simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { EngineAPI } from '../engine/index.mjs';
import { readPartnership, PARTNERSHIP_KEY, inheritancePreview, inheritanceTax } from '../app/profile/household-partnership.js';
import { personDisplayAge } from '../app/profile/profile-person-data.js';
import { lifetimeUseMultiplier } from '../app/shared/life-expectancy.js';
import { homeValueAtDeath } from '../app/simulator/simulator-inheritance.js';
import { homeValueAtYearEnd, sellHomesForEmergency, sellHomesForExternalCare, endResidenceRights } from '../app/simulator/simulator-home-sale.js';
import { calculateFixedIncomeForYear } from '../app/simulator/simulator-fixed-income.js';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { getProtocolColumns, readProtocolValue } from '../app/simulator/protocol-columns.js';
import { projectScenarioLogV2, serializeScenarioLogCsvV2 } from '../app/simulator/monte-carlo-export.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';

const inputs = await measurementInputs(0, 'martin-petra', '2026-10-23', 'testament');
const year = { jahr: 2000, inflation: 2, rendite: 0, gold_eur_perf: 0, zinssatz: 0 };
const household = { p1Alive: false, p2Alive: true };
const annual = current => simulateOneYear(initMcRunState(current), current, year, 0, null, 0, household, 1, EngineAPI);
for (const [minimum, branch] of [[0, 'Drittel'], [250000, 'Mindestbetrag'], [1000000, 'Höchstanteil']]) {
    const current = structuredClone(inputs); current.partnership.testament.muster_martin.minimum = minimum;
    const result = annual(current), row = result.logData, estate = row.inheritance;
    assertEqual(result.kind, 'success', `${branch}: echte Jahresrechnung`);
    const expected = branch === 'Drittel' ? estate.assets / 3 : branch === 'Mindestbetrag' ? minimum * 1.02 : estate.assets / 2;
    assertClose(estate.inherited, expected, 1e-7, `${branch}: wirklicher Geldanteil im Todesjahr`);
    assertEqual(estate.inheritedHome, 0, 'Wohnrecht überträgt kein Immobilieneigentum');
    assertClose(estate.residenceCapital, 612000 * .04 * lifetimeUseMultiplier(personDisplayAge({ profile_geburtsdatum: inputs.simulationPeople[1].geburtsdatum }, new Date(2026, 6, 1)).age), 1e-7, 'Kapitalwert nutzt Frauenwerte auch unabhängig vom Geschlecht des Erben');
    assertClose(estate.tax, inheritanceTax(expected + estate.residenceCapital), 1e-7, 'Wohnrecht zählt zur Erbschaftsteuer');
    assertClose(row.immobilien_wert_end, 240000 * 1.02, .001, 'Nur Petras eigene Wohnung verbleibt im Haushalt');
    assertClose(row.portfolio_flow_delta, 0, .05, 'Nachlass und Steuer bilanzieren in der echten Zeile');
    const preview = inheritancePreview(estate.assets, 612000, 100 / 3, { exemptHome: 612000, testament: current.partnership.testament.muster_martin,
        minimumFactor: 1.02, partnerAge: personDisplayAge({ profile_geburtsdatum: inputs.simulationPeople[1].geburtsdatum }, new Date(2026, 6, 1)).age });
    assertClose(preview.tax, estate.tax, 1e-7, 'Karte und Simulator rechnen denselben Erwerb');
    const html = renderProtocolTable([row], { source: 'mc', inputs: current });
    for (const text of ['Geldanteil', 'Immobilien', 'Kapitalwert Wohnrecht', 'Erbschaftsteuer']) assert(html.includes(text), `Todesjahr-Info enthält ${text}`);
}

const residence = annual(inputs), portfolio = residence.newState.portfolio, survivor = residence.newState.survivor;
// Echte Erbzeile liefert den Zustand für Pflege- und Notverkaufsprüfung.
const onlyHouse = { ...inputs, home: inputs.home.filter(home => home.profileId === 'muster_martin') };
const options = { portfolio: structuredClone(portfolio), state: residence.newState, inputs: onlyHouse, household,
    yearIndex: 1, inflationFactor: 1.02, requiredFloor: 1e9, beforeRuin: true };
assertEqual(sellHomesForEmergency(options), null, 'Wohnrecht: kein Notverkauf des Hauses');
const care = { ...household, care: { p2: { active: true, grade: 4 } } };
const residential = { ...onlyHouse, partner: { ...onlyHouse.partner, careForm: 'residential' }, pflegeStufe4Form: 'residential' };
assertEqual(sellHomesForExternalCare({ ...options, inputs: residential, household: care }), null, 'Wohnrecht: kein Heimverkauf');
assert(!options.portfolio.homeRent, 'Wohnrecht erzeugt keine Ersatzmiete');
endResidenceRights(options.portfolio, residential, survivor, care);
assert(Object.values(options.portfolio.homeInheritance).every(rule => rule.residenceActive !== true), 'Heimpflege beendet das Wohnrecht ohne Geldwirkung');
assert(Object.values(portfolio.homeInheritance).some(rule => rule.residenceActive === true), 'Vorheriger Jahreszustand bleibt erhalten');

const married = structuredClone(inputs);
married.partnership.status = 'married'; married.partnership.marriedInheritance = { muster_martin: 0 };
married.partnership.testament.muster_martin = { home: 'life-estate' };
const marriage = annual(married), estate = marriage.logData.inheritance;
assertEqual(estate.inheritedHome, 612000, 'Eigentum auf Lebenszeit: das ganze selbst genutzte Familienheim');
assertEqual(estate.tax, 0, 'Verheiratet: Familienheim steuerfrei');
assertClose(marriage.logData.immobilien_wert_end, 856800, .001, 'Lebenszeiteigentum zählt in der Immobilienspalte');
const marriageOptions = { ...options, portfolio: structuredClone(marriage.newState.portfolio), state: marriage.newState,
    inputs: { ...residential, partnership: married.partnership }, household: care };
assertEqual(sellHomesForEmergency(marriageOptions), null, 'Lebenszeiteigentum ist im Notfall unverkäuflich');
assertEqual(sellHomesForExternalCare(marriageOptions), null, 'Lebenszeiteigentum ist bei Heimpflege unverkäuflich');

// Vermietete Immobilien der verstorbenen Person gehen bei beiden Lebenszeitregeln ab.
for (const home of ['residence', 'life-estate']) {
    const current = structuredClone(inputs); current.partnership.testament.muster_martin.home = home;
    current.home.push({ id: 'muster-mietwohnung', profileId: 'muster_martin', nutzung: 'vermietet', wert: 100000, stand: '2026-10' });
    const result = annual(current);
    const income = calculateFixedIncomeForYear({ inputs: { ...current, fixedIncome: [{ id: 'muster_martin:immobilie:muster-mietwohnung', profileId: 'muster_martin', art: 'sonstige', betragMonat: 500, anpassung: 'keine' }] },
        state: result.newState, household, yearIndex: 1, inflationFactor: 1.02, deathThisYear: false });
    assertEqual(income.total, 0, `${home}: keine weiterlaufende Miete der abgegangenen Mietwohnung`);
}

// Vorgabe ohne neue Felder und explizit leere Erweiterung erzeugen dieselben Ergebnisbytes.
const legacy = structuredClone(inputs); delete legacy.partnership.testament;
const explicit = structuredClone(legacy); explicit.partnership.testament = { muster_martin: { home: 'money' } };
assertEqual(JSON.stringify(annual(legacy)), JSON.stringify(annual(explicit)), 'Vorgabe: ganze Jahresrechnung bytegleich');
const partial = simulateOneYear(initMcRunState(legacy), legacy, year, 0, null, 0, { p1Alive: false }, 1, EngineAPI);
assert(partial.logData.immobilien_wert_end > 0, 'Unvollständiger Haushaltskontext wird normalisiert');
// Ruin vor der Erbverteilung: echte Zeile zeigt bereits den Anteil statt 100 %.
const ruinInputs = { ...structuredClone(inputs), home: onlyHouse.home, startFloorBedarf: 1e8, startFlexBedarf: 0, minimumFlexAnnual: 0 };
const ruin = annual(ruinInputs);
assertEqual(ruin.kind, 'ruin', 'Echter Ruin im Todesjahr vor der Erbverteilung');
assertEqual(ruin.logData.inheritance, undefined, 'Ruin tritt vor der Nachlassbuchung auf');
assertEqual(ruin.logData.immobilien_wert_end, 0, 'Wohnrecht zählt auch beim vorzeitigen Ruin als 0 € Immobilie');
const quarter = structuredClone(ruinInputs); delete quarter.partnership.testament; quarter.partnership.inheritance.muster_martin = 25;
// Derselbe Anzeigehelfer berücksichtigt auch eine alte 25-%-Quote ohne Erbstatus.
const ruinPortfolio = ruin.newState.portfolio;
assertEqual(homeValueAtYearEnd({ inputs: quarter, portfolio: ruinPortfolio, household, inflationFactor: 1.02 }), 153000, 'Anzeigehelfer erkennt 25-%-Todesjahr auch ohne gespeicherten Erbstatus');

const mc = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { anzahl: 8, maxDauer: 35, blockSize: 5, seed: 12345, methode: 'regime_markov', rngMode: 'per-run-seed', startYearMode: 'UNIFORM' },
    widowOptions: inputs.widowOptions, useCapeSampling: false, runRange: { start: 0, count: 8 }, logIndices: [0, 7] });
assertEqual(mc.technicalInventory.technicalError, 0, 'Echte MC-Pfade ohne technischen Fehler');
const deathRows = mc.runMeta.flatMap(run => run.logDataRows || []).filter(row => row.recordType === 'terminal_death');
assert(deathRows.length > 0, 'Echte Abschlusszeile nach Tod aller Personen vorhanden');
for (const row of deathRows) {
    const options = { source: 'mc', inputs, rows: [row] }, columns = getProtocolColumns(options);
    for (const id of ['total', 'home-value', 'total-with-homes']) assertEqual(readProtocolValue(columns.find(column => column.id === id), row, options), undefined, 'Alle drei Endbestandsspalten in der Todesabschlusszeile leer');
}
for (const run of mc.runMeta.filter(run => run.logDataRows?.some(row => row.recordType === 'terminal_death'))) {
    const rows = run.logDataRows, index = rows.findIndex(row => row.recordType === 'terminal_death');
    const csv = serializeScenarioLogCsvV2(projectScenarioLogV2(rows)).split('\r\n'), headers = csv[0].split(';');
    assert(headers.slice(-2).join(';') === 'Immobilien;Gesamtvermögen', 'Vollständiger Lauf exportiert beide Immobilienköpfe');
    const cells = csv[index + 1].split(';');
    assert(cells.slice(-2).every(value => value === ''), 'Echte Todesabschlusszeile im vollständigen CSV hat leere Immobilien-/Gesamtwerte');
    assertEqual(cells[headers.indexOf('portfolio_total_end')], '', 'Auch Geldvermögen ist in derselben CSV-Zeile leer');
}

const records = createMusterHaushaltRecords('2026-10-23', 'martin-petra', 'testament');
records[PARTNERSHIP_KEY] = JSON.stringify(readPartnership(records[PARTNERSHIP_KEY]));
const storage = { records: { ...records }, get length() { return Object.keys(this.records).length; }, key(index) { return Object.keys(this.records)[index] ?? null; },
    getItem(key) { return this.records[key] ?? null; }, setItem(key, value) { this.records[key] = String(value); }, removeItem(key) { delete this.records[key]; } };
const target = { ...storage, records: {} };
assert(importProfilesBundle(exportProfilesBundle({ storage }), { storage: target }).ok, 'Profilbundle mit FR-64 importierbar');
assertEqual(target.getItem(PARTNERSHIP_KEY), records[PARTNERSHIP_KEY], 'Profilbundle erhält alle Testamentbytes');
for (const schemaVersion of [1, 2]) {
    const backup = buildFullPersistenceBackup({ storage }); backup.schemaVersion = schemaVersion;
    const restored = normalizeFullPersistenceBackup(backup);
    assert(restored.ok, `Sicherung mit älteren Schlüsseln, Schema ${schemaVersion}`);
    assertEqual(restored.backup.records[PARTNERSHIP_KEY], records[PARTNERSHIP_KEY], 'Sicherung erhält alle Testamentbytes');
}
for (const raw of [null, '{"schemaVersion":1,"status":"unmarried","inheritance":{"muster_martin":33}}', '{"schemaVersion":1,"status":"married","inheritance":{},"marriedInheritance":{"muster_martin":50}}']) {
    const migrated = readPartnership(raw);
    assertEqual(migrated.testament, undefined, 'Altbestand erhält keine neuen gespeicherten Felder');
    if (raw) { const { maritalPropertyRegime, ...oldFields } = migrated; assertEqual(JSON.stringify(oldFields), raw, 'Migration erhält alte Partnerschaftsfelder'); assertEqual(maritalPropertyRegime, 'community', 'Migration ergänzt Vorgabe Zugewinngemeinschaft'); }
}
for (const rule of [{ minimum: -1, minimumStand: '2026-10' }, { minimum: 2 }, { maximumPercent: 101 }, { home: 'verkaufen' }]) {
    assertEqual(validatePersistenceDomainRecords({ ...records, [PARTNERSHIP_KEY]: JSON.stringify({ ...inputs.partnership, testament: { muster_martin: rule } }) }).ok, false, 'Import weist ungültige Testamentangaben ab');
}
