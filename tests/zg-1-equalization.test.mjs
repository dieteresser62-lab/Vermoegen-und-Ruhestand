import { readEV1bReferences } from './helpers/ev-1b-expectations.mjs';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readPartnership, migratePartnershipRecord, equalizationAllowance, inheritancePreview, testamentEstate, PARTNERSHIP_KEY } from '../app/profile/household-partnership.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio-init.js';
import { syncPersonalLiquidity } from '../app/simulator/simulator-personal-accounts.js';
import { applyUnmarriedInheritance } from '../app/simulator/simulator-inheritance.js';
import { beginPersonalTaxYear } from '../app/simulator/simulator-personal-tax.js';
import { payResidenceTaxForYear } from '../app/simulator/simulator-residence-tax.js';
import { inheritanceCase, deathYear, zg1bControlCase } from './helpers/zg-1-cases.mjs';
import { applyPlannedInflows } from '../app/simulator/planned-inflows.js';
import { summarizeProbelaufChanges } from '../app/shared/probelauf-records.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-wrapper.js';
import { EngineAPI } from '../engine/index.mjs';
import { renderProtocolTable } from '../app/simulator/protocol-renderer.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { exportProfilesBundle, importProfilesBundle } from '../app/profile/profile-bundle-io.js';
import { buildFullPersistenceBackup, normalizeFullPersistenceBackup, validatePersistenceDomainRecords } from '../app/shared/persistence-backup.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const controls = JSON.parse(readFileSync(new URL('./fixtures/zg-1-byte-controls.json', import.meta.url)));
for (const status of ['married', 'unmarried']) {
    const { inputs, state } = inheritanceCase(status);
    assertEqual(hash(deathYear(inputs, state)), readEV1bReferences(controls[status]), `${status}: vollständiges Todesjahr bytegleich zum Ausgangsstand`);
}
const married = { status: 'married', maritalPropertyRegime: 'community' };
const zg1bControls = JSON.parse(readFileSync(new URL('./fixtures/zg-1b-byte-controls.json', import.meta.url)));
for (const kind of Object.keys(zg1bControls.hashes)) {
    const { inputs, state } = zg1bControlCase(kind);
    assertEqual(hash(deathYear(inputs, state)), zg1bControls.hashes[kind], `ZG-1b ${kind}: vollständiges Todesjahr bytegleich`);
}
function estate({ regime = 'community', deceased = 2200000, survivor = 400000, factor = 2, percent = 100, rule, homes = [], inflows = [] } = {}) {
    const inputs = { partnership: { schemaVersion: 1, status: 'married', maritalPropertyRegime: regime, inheritance: {},
        marriedInheritance: { max: percent }, ...(rule ? { testament: { max: rule } } : {}) },
        tagesgeld: 600000, detailledTranches: [], simulationPeople: [{ profileId: 'max', tagesgeld: 500000 }, { profileId: 'erika', tagesgeld: 100000 }],
        home: homes, homeReferenceYear: 2026, referenceYear: 2026, startAlter: 70, geschlecht: 'm', partner: { aktiv: true, startAlter: 65, geschlecht: 'w' } };
    const portfolio = initializePortfolio(inputs);
    portfolio.personAccounts[0].tagesgeld = deceased; portfolio.personAccounts[1].tagesgeld = survivor;
    for (const inflow of inflows) applyPlannedInflows(portfolio, { ...inputs, plannedInflows: [inflow], plannedInflowsReferenceYear: 2026 },
        inflow.year - 2026, inflow.factor ?? 1);
    syncPersonalLiquidity(portfolio);
    const result = applyUnmarriedInheritance({ portfolio, inputs, inflationFactor: factor,
        transition: { deathThisYear: true, survivor: { deceasedProfileId: 'max', survivorProfileId: 'erika', deathYearIndex: 10 } },
        pension: { rente1BruttoEigen: 0 }, personalInterest: { items: [] }, actionResult: { steuer: 0 }, household: { p1Alive: false, p2Alive: true } });
    return { result, portfolio, inputs };
}
{
    // Variante: Hinterbliebene 300.000, Zugewinn 100.000; Ausgleich 250.000.
    for (const [cash, value, survivor, allowance, expected] of [
        [2200000, 1000000, 400000, 500000, 273238.09523809527], [1600000, 800000, 300000, 250000, 185250]
    ]) {
        const homes = [{ id: 'familienheim', profileId: 'max', wert: value, nutzung: 'selbst', stand: '2026-10' }];
        const result = estate({ deceased: cash, survivor, homes }).result;
        const reduced = allowance * cash / (cash + value * 2);
        assertClose(result.inheritance.exemptGain, reduced, 1e-8, 'Satz 6: Ausgleich nur im Verhältnis des nicht befreiten Endvermögens');
        assertClose(result.erbschaftsteuer, expected, 1e-8, 'Satz 6: Gegenrechnung Haupt- und Variantenfall');
        for (const rule of [{ home: 'money' }, { home: 'life-estate' }]) {
            const testament = estate({ deceased: cash, survivor, homes, rule }).result;
            assertClose(testament.erbschaftsteuer, expected, 1e-8, 'Satz 6 gilt auch beim Testament');
        }
        const partial = estate({ deceased: cash, survivor, homes, percent: 50 }).result;
        assertClose(partial.inheritance.exemptGain, allowance * (cash + value) / (cash + value * 2), 1e-8,
            'Teilquote: nur tatsächlich befreiter Familienheimanteil kürzt den Ausgleich');
        const gains = { deceasedAssets: cash + value * 2, deceasedInitialAssets: 500000 + value,
            survivorAssets: survivor, survivorInitialAssets: 100000, inflationFactor: 2 };
        for (const testament of [undefined, { home: 'life-estate' }]) {
            const preview = inheritancePreview(cash, value * 2, 100, { ...married, exemptHome: value * 2, gains, testament });
            assertClose(preview.tax, expected, 1e-8, 'Vorschau und Simulator verwenden dieselbe Satz-6-Rechnung');
            assertClose(preview.taxable, cash - 500000 - reduced, 1e-8, 'Vorschau-Bemessung enthält den gekürzten Zugewinnabzug');
            assertEqual(preview.rate, .19, 'Vorschausatz folgt der Bemessung mit Zugewinnabzug');
        }
    }
    assertEqual(equalizationAllowance(married, { deceasedAssets: 1000000, deceasedInitialAssets: 0, acquisition: 1000000, exemptHome: 1000000 }),
        0, 'Vollständig befreites Endvermögen: kein zusätzlicher Zugewinnabzug');
    for (const testament of [undefined, { home: 'money', maximumPercent: 100 }]) {
        const preview = inheritancePreview(900000, 0, 100, { ...married, testament,
            gains: { deceasedAssets: 900000, deceasedInitialAssets: 500000 } });
        assertEqual(preview.taxable, 200000, 'Vorschau mit Zugewinn: Bemessung sinkt über eine Tarifgrenze');
        assertEqual(preview.rate, .11, 'Vorschau mit Zugewinn: Satz sinkt von 15 auf 11 Prozent');
        assertEqual(preview.tax, 22000, 'Vorschausteuer folgt derselben Bemessung');
    }
    const inherited = estate({ inflows: [{ profileId: 'max', amount: 300000, year: 2030, factor: 2, label: 'Erbschaft' }] }).result;
    assertEqual(inherited.inheritance.exemptGain, 500000, 'Erbschaft 300.000 erhöht das Anfangsvermögen statt des Zugewinns');
    assertEqual(inherited.erbschaftsteuer, 285000, 'Erbschaft 300.000: Steuer 285.000 statt 256.500');
    const receivedBySurvivor = estate({ inflows: [{ profileId: 'erika', amount: 300000, year: 2030, factor: 2, label: 'Schenkung' }] }).result;
    assertEqual(receivedBySurvivor.inheritance.exemptGain, 500000, 'Zufluss an die hinterbliebene Person wird ebenfalls bereinigt');
    const indexed = estate({ inflows: [
        { profileId: 'max', amount: 300000, year: 2028, factor: 1.5, label: 'Erbschaft' },
        { profileId: 'max', amount: 60000, year: 2031, factor: 2, label: 'Rückzahlung' }
    ] }).result;
    assertClose(indexed.inheritance.exemptGain, 450000, 1e-8, 'Mehrere Zuflüsse: individuelle Pfadinflation ab jedem Zuflussjahr');
    const previousInflows = { max: 1000 };
    const isolatedPortfolio = initializePortfolio({ tagesgeld: 10000, detailledTranches: [],
        simulationPeople: [{ profileId: 'max', tagesgeld: 10000 }, { profileId: 'erika', tagesgeld: 0 }] });
    isolatedPortfolio.equalizationInflows = previousInflows;
    applyPlannedInflows(isolatedPortfolio, { partnership: married, simulationPeople: [{ profileId: 'max' }, { profileId: 'erika' }],
        plannedInflowsReferenceYear: 2026, plannedInflows: [{ profileId: 'max', year: 2026, amount: 50000 }] }, 0);
    assertEqual(previousInflows.max, 1000, 'Neue Zuflüsse verändern keinen erhaltenen Vorjahreszustand');
    const { inputs, state } = inheritanceCase('married', 'community');
    inputs.plannedInflowsReferenceYear = 2026;
    inputs.plannedInflows = [{ profileId: 'muster_a', amount: 300000, year: 2027, label: 'Erbschaft' },
        { profileId: 'muster_a', amount: 700000, year: 2028, label: 'Später' }];
    const first = simulateOneYear(state, inputs, { jahr: 2000, inflation: 50, rendite: 0, gold_eur_perf: 0, zinssatz: 0 },
        0, null, 0, { p1Alive: true, p2Alive: true }, 1, EngineAPI);
    assertEqual(first.kind, 'success', 'Echter Pfad vor dem Zufluss bleibt ausführbar');
    const next = deathYear(inputs, first.newState, 1, 20);
    assertEqual(next.kind, 'success', 'Echter Zuflusspfad im Todesjahr bleibt ausführbar');
    assertClose(next.newState.portfolio.equalizationInflows.muster_a, 200000, 1e-8, 'Echter Pfad übergibt Inflation vor dem Zuflussjahr; spätere Zuflüsse fehlen');
    assertClose(next.logData.portfolio_flow_delta, 0, .05, 'Zufluss und Zugewinnkorrektur bleiben bilanziert');
}
{
    const community = estate().result, separation = estate({ regime: 'separation' }).result;
    // Anfang 500.000/100.000; Inflation ×2; Tod 2.200.000/400.000.
    // Zugewinn 1.200.000/200.000; Ausgleich 500.000; steuerpflichtig 1.200.000 ×19 %.
    assertEqual(community.inheritance.exemptGain, 500000, '(a) Handrechnung: halbe Zugewinndifferenz');
    assertEqual(community.erbschaftsteuer, 228000, '(a) Handrechnung: 228.000 Euro Steuer nach Ausgleich');
    assertEqual(separation.erbschaftsteuer, 323000, '(a) Gütertrennung: 1.700.000 ×19 Prozent');
    assertEqual(community.inheritance.inherited, separation.inheritance.inherited, 'Ausgleich ändert den Erwerb nicht');
}
{
    const community = estate({ deceased: 1000000, survivor: 200000 }).result;
    const separation = estate({ regime: 'separation', deceased: 1000000, survivor: 200000 }).result;
    assertEqual(JSON.stringify(community), JSON.stringify(separation), '(b) Reine Inflation: gesamter Nachlass bytegleich');
    assertEqual(JSON.stringify(estate({ deceased: 1200000, survivor: 500000 }).result),
        JSON.stringify(estate({ regime: 'separation', deceased: 1200000, survivor: 500000 }).result), '(c) Höherer Zugewinn beim Hinterbliebenen: kein Abzug');
}
assertEqual(equalizationAllowance(married, { deceasedAssets: 3000000, deceasedInitialAssets: 0, acquisition: 75000 }), 75000, 'Abzug höchstens Erwerb');
assertEqual(equalizationAllowance(married, { deceasedAssets: 0, deceasedInitialAssets: 100000, survivorAssets: 100000, survivorInitialAssets: 500000, acquisition: 100000 }), 0, 'Negative Zugewinne werden auf null begrenzt');
for (const testament of [undefined, { home: 'residence', residenceTax: 'annual' }, { home: 'life-estate' }]) {
    const options = { status: 'married', exemptHome: 600000, partnerAge: 65, testament };
    assertEqual(JSON.stringify(inheritancePreview(2200000, 600000, 50, { ...options, maritalPropertyRegime: 'community' })),
        JSON.stringify(inheritancePreview(2200000, 600000, 50, { ...options, maritalPropertyRegime: 'separation' })), '(f) Vorschau heute in beiden Güterständen bytegleich');
}
{
    const { inputs, state } = inheritanceCase('married', 'community'), death = deathYear(inputs, state);
    assert(death.logData.inheritance.exemptGain > 0, 'Echter Simulatorpfad verwendet den Ausgleich');
    assert(death.logData.erbschaftsteuer < (() => { const control = inheritanceCase(); return deathYear(control.inputs, control.state); })().logData.erbschaftsteuer, 'Echtes Todesjahr: Steuer sinkt');
    assertClose(death.logData.portfolio_flow_delta, 0, .05, 'Ausgleich samt Steuerzahlung bleibt bilanziert');
    const html = renderProtocolTable([death.logData], { source: 'mc', inputs });
    assert(html.includes('. Steuerfrei als Zugewinnausgleich') && html.includes('Heirat = heute') && html.includes('Ehejahre davor zählen nicht') && html.includes('Steuerberater fragen'), 'Todesjahr-ⓘ nennt Betrag als eigenen Satz und Modellgrenze');
}
{
    // §23: Erwerb Geld 450.000 + Wohnrecht. Ausgleich 100.000, Rest 150.000.
    const gains = { deceasedAssets: 3450000, deceasedInitialAssets: 3250000 };
    const annual = testamentEstate(450000, 3000000, 3000000, 100, { home: 'residence', residenceTax: 'annual' },
        { status: 'married', partnerAge: 50, maritalPropertyRegime: 'community', gains, residenceValue: 100000 });
    assertEqual(annual.exemptGain, 100000, '(h) Ausgleich mindert auch den Gesamterwerb des Wohnrechts');
    assertEqual(annual.tax, 0, '(h) Geldanteil ist im Todesjahr steuerfrei');
    assertEqual(annual.residenceTax.allowanceRemaining, 150000, '(h) Persönlicher Freibetrag plus Ausgleich minus Geldanteil');
    const { inputs: logInputs, state: logState } = inheritanceCase('married', 'community');
    const row = deathYear(logInputs, logState).logData;
    const html = renderProtocolTable([{ ...row, inheritance: { ...row.inheritance,
        exemptGain: annual.exemptGain, residenceTax: annual.residenceTax } }], { source: 'mc', inputs: logInputs });
    assert(html.includes('500.000 € persönlicher Freibetrag plus 100.000 € Zugewinnausgleich'),
        'Jahressteuer-ⓘ nennt den persönlichen Freibetrag und den Zugewinnanteil getrennt');
    for (const status of ['married', 'unmarried']) {
        const withoutGain = renderProtocolTable([{ ...row, inheritance: { ...row.inheritance,
            exemptGain: 0, residenceTax: annual.residenceTax } }], { source: 'mc', inputs: { ...logInputs,
                partnership: { ...logInputs.partnership, status, maritalPropertyRegime: 'separation' } } });
        assert(!withoutGain.includes('plus 0 € Zugewinnausgleich') && withoutGain.includes('persönlicher Freibetrag)'),
            status + ': Jahressteuer-ⓘ nennt ohne Zugewinn nur den persönlichen Freibetrag');
    }
    const portfolio = initializePortfolio({ tagesgeld: 1000000, detailledTranches: [], simulationPeople: [{ profileId: 'erika', tagesgeld: 1000000 }] });
    portfolio.personAccounts[0].sparerPauschbetrag = 1000; beginPersonalTaxYear(portfolio);
    portfolio.residenceTax = { ...annual.residenceTax, profileId: 'erika' };
    portfolio.homeInheritance = { haus: { mode: 'residence', residenceActive: true, share: 0 } };
    const inputs = { simulationPeople: [{ profileId: 'erika' }] }, household = { p1Alive: true };
    const first = payResidenceTaxForYear(portfolio, inputs, {}, household), second = payResidenceTaxForYear(portfolio, inputs, {}, household), third = payResidenceTaxForYear(portfolio, inputs, {}, household);
    assertEqual(first.wohnrechtsteuer, 0, '(h) Erster Jahreswert 100.000 steuerfrei');
    assertEqual(first.residenceTaxPayment.allowanceRemaining, 50000, '(h) Nach erstem Jahr noch 50.000 frei');
    assertClose(second.wohnrechtsteuer, 50000 * annual.residenceTax.rate, 1e-8, '(h) Zweiter Jahreswert zur Hälfte steuerpflichtig');
    assertClose(third.wohnrechtsteuer, 100000 * annual.residenceTax.rate, 1e-8, '(h) Danach voller Jahreswert');
    const integrated = estate({ rule: { home: 'residence', residenceTax: 'annual' }, homes: [{ id: 'haus', profileId: 'max', wert: 1000000, nutzung: 'selbst', stand: '2026-10' }] });
    assertEqual(integrated.result.inheritance.exemptGain, 500000, 'Immobilien wachsen nur mit Inflation; Ausgleich bleibt 500.000');
    assertEqual(integrated.result.inheritance.residenceTax.allowanceRemaining, 0, 'Simulator übernimmt Aufzehrung nach Geldanteil');
}
const storageOf = records => ({ records, get length() { return Object.keys(this.records).length; }, key(i) { return Object.keys(this.records)[i] ?? null; },
    getItem(k) { return this.records[k] ?? null; }, setItem(k,v) { this.records[k] = String(v); }, removeItem(k) { delete this.records[k]; } });
for (const regime of ['community', 'separation']) {
    const records = createMusterHaushaltRecords('2026-10-28');
    records[PARTNERSHIP_KEY] = JSON.stringify({ schemaVersion: 1, status: 'married', maritalPropertyRegime: regime, inheritance: {}, marriedInheritance: { muster_a: 50 } });
    const storage = storageOf(records), target = storageOf({});
    assert(importProfilesBundle(exportProfilesBundle({ storage }), { storage: target }).ok, '(g) Export/Import gültig');
    assertEqual(target.records[PARTNERSHIP_KEY], records[PARTNERSHIP_KEY], '(g) Profilbundle erhält Güterstand bytegleich');
    for (const schemaVersion of [1,2]) {
        const backup = buildFullPersistenceBackup({ storage }); backup.schemaVersion = schemaVersion;
        const normalized = normalizeFullPersistenceBackup(backup);
        assert(normalized.ok, '(g) Sicherung einlesbar');
        assertEqual(normalized.backup.records[PARTNERSHIP_KEY], records[PARTNERSHIP_KEY], '(g) Sicherung erhält Güterstand');
    }
    const legacy = { schemaVersion: 1, status: 'married', inheritance: { muster_a: 33 }, marriedInheritance: { muster_a: 50 } };
    records[PARTNERSHIP_KEY] = JSON.stringify(legacy);
    assertEqual(readPartnership(records[PARTNERSHIP_KEY]).maritalPropertyRegime, 'community', '(g) Alte Schlüssel lesen Vorgabe Zugewinngemeinschaft');
    assertEqual(readPartnership(migratePartnershipRecord(records[PARTNERSHIP_KEY])).marriedInheritance.muster_a, 50, '(g) Migration erhält alte Ehequote');
    const imported = storageOf({});
    assert(importProfilesBundle(exportProfilesBundle({ storage }), { storage: imported }).ok, '(g) Altbundle importierbar');
    assertEqual(imported.records[PARTNERSHIP_KEY], records[PARTNERSHIP_KEY], '(g) Altimport erhält Rohbytes ohne Güterstand');
    assertEqual(readPartnership(imported.records[PARTNERSHIP_KEY]).maritalPropertyRegime, 'community', '(g) Altimport liest Vorgabe');
    const normalized = normalizeFullPersistenceBackup(buildFullPersistenceBackup({ storage }));
    assertEqual(normalized.backup.records[PARTNERSHIP_KEY], records[PARTNERSHIP_KEY], '(g) Altsicherung erhält Rohbytes ohne Güterstand');
    assertEqual(readPartnership(normalized.backup.records[PARTNERSHIP_KEY]).maritalPropertyRegime, 'community', '(g) Altsicherung liest Vorgabe');
    for (const invalid of ['unknown', null, 0]) assertEqual(validatePersistenceDomainRecords({ ...records,
        [PARTNERSHIP_KEY]: JSON.stringify({ ...legacy, maritalPropertyRegime: invalid }) }).ok, false, 'Ungültiger Güterstand verhindert Import');
}
assertEqual(readPartnership(null).maritalPropertyRegime, 'community', 'Auch ohne Record gilt Zugewinngemeinschaft');
{
    const raw = ' { "schemaVersion": 1, "status": "married", "marriedInheritance": {"max":50}, "inheritance": {"max":33}, "testament": {"max":{"home":"money"}}, "altschluessel": {"wert":7} } ';
    assertEqual(migratePartnershipRecord(raw), raw, 'Migration erhält alte Schlüssel, leere Testamentregeln, Reihenfolge und Rohbytes');
    const legacy = { ...JSON.parse(raw), status: 'unmarried', homeAndTaxInheritance: { max: true },
        testament: { max: { minimum: 200000, minimumStand: '2026-10' }, erika: { home: 'money' } } };
    assertEqual(migratePartnershipRecord(JSON.stringify(legacy)), JSON.stringify({ ...legacy, activeInheritanceRule: { max: 'testament' } }),
        'Nötige Vorrangmigration ergänzt ausschließlich das fehlende Feld und erhält sämtliche Altschlüssel');
    assertEqual(migratePartnershipRecord(''), '', 'Leerer Altstring bleibt bytegleich');
    const records = regime => ({ ...createMusterHaushaltRecords('2026-10-28'),
        [PARTNERSHIP_KEY]: JSON.stringify({ schemaVersion: 1, status: 'married', maritalPropertyRegime: regime, inheritance: {} }) });
    const changes = summarizeProbelaufChanges(records('community'), records('separation'));
    assertEqual(changes.count, 1, 'Spielübernahme erkennt den Güterstandswechsel');
    assert(changes.groups[0].rows[0].before.includes('Zugewinngemeinschaft')
        && changes.groups[0].rows[0].after.includes('Gütertrennung'), 'Spielübernahme benennt beide Güterstände in Klartext');
}
