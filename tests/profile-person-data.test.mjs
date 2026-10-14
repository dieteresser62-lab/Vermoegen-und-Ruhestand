import { alterAmStichtag, validateIsoDate, personAge, projectPerson, personReferenceYear } from '../app/profile/profile-person-data.js';
import { planningYear } from '../app/overview/overview-model.js';
for (const [date, year, expected] of [['1958-01-01', 2026, 68], ['1958-03-14', 2026, 67], ['1960-02-29', 2026, 65], ['2000-12-31', 2026, 25], ['2000-12-31', 2027, 26], ['2000-01-01', 2027, 27]]) {
    assertEqual(alterAmStichtag(date, year).age, expected, `${date}: Januarstichtag ${year}`);
    for (let index = 0; index < 12; index++) assertEqual(alterAmStichtag(date, year + index).age, expected + index, 'Jahresindex stimmt mit numerischem Runneralter überein');
}
for (const date of [null, undefined, '']) assertEqual(alterAmStichtag(date, 2026).status, 'missing', 'Fehlendes Datum ist kein Alter 0');
for (const date of ['1958', '1958-03', '1958-3-14', '1900-02-29', '2100-02-29', '2000-02-30', '0000-01-01', '2026-13-01']) assertEqual(validateIsoDate(date).status, 'invalid', 'Ungültiges Kalenderdatum wird abgewiesen');
assertEqual(validateIsoDate('2000-02-29').status, 'valid', 'Jahrhundertschaltjahr 2000');
assertEqual(alterAmStichtag('2026-01-02', 2026).status, 'future', 'Vor Geburt ist die Person im Bezugsjahr ungültig');
const legacy = { profile_aktuelles_alter: '67' };
assertEqual(personAge(legacy, 2026).suggestedBirthYear, 1958, 'Nur ein Geburtsjahrvorschlag');
assertEqual(personAge(legacy, 2040).age, 67, 'Fallback bleibt fest');
assertEqual(personAge({ ...legacy, profile_geburtsdatum: '1958-03-14' }, 2027).age, 68, 'Vollständiges Datum ersetzt Fallback');
for (const now of [new Date('2026-01-01T00:00:00Z'), new Date('2026-12-31T12:00:00Z')]) {
    for (const metadata of [null, { lastCommittedPeriod: 'calendar-year:2026' }, { pendingCommit: { periodId: 'calendar-year:2027' } }]) assertEqual(personReferenceYear(metadata, now), planningYear(metadata, now), 'Personen- und Overviewjahr stimmen überein');
}
const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rentenbeginn: '2028-11-30', profile_kirchensteuer_pct: '9', profile_rente_monatlich: '1234.567', profile_sparer_pauschbetrag: '0' };
const person = projectPerson(data, 2026);
assertEqual(person.kirchensteuerSatz, .09, 'P1-Kirchensteuer bleibt Verhältnis');
assertEqual(person.renteStartOffsetJahre, 2, 'Rentenbeginn bleibt jährlicher Offset');
assertEqual(person.renteMonatlich, 1234.567, 'Rohpräzision bleibt erhalten');
assertEqual(person.startSPB, 0, 'Explizite Null bleibt Null');

const previousTZ = process.env.TZ;
try {
    for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = timezone;
        const december = new Date(2026, 11, 31, 23, 59), january = new Date(2027, 0, 1, 0, 0);
        assertEqual(personAge(data, personReferenceYear(null, december)).age, 67, timezone + ': lokaler 31.12.');
        assertEqual(personAge(data, personReferenceYear(null, january)).age, 68, timezone + ': lokaler 01.01.');
        assertEqual(alterAmStichtag('1960-02-29', 2027).age, 66, timezone + ': reine Schaltjahrfunktion');
    }
} finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }

// SHA-256 über sämtliche JSON.stringify-Bytes, vorab aus dfc8311 gesichert.
// Vollständige produktive Adapter, keine Auswahl nur alter Personenkeys.
{
const { createHash } = await import('node:crypto');

function projectLegacyFinancialBytes(result) {
    const projection = JSON.parse(JSON.stringify(result));
    // Nur additive Mindest-Flex-Messfelder ausnehmen; alle Altpfadbytes bleiben gepinnt.
    for (const key of Object.keys(projection.buffers)) {
        if (key.startsWith('__mcChunkV1Path_minimumFlex') || key === '__mcChunkV1Missing_minimumFlexRestriction') {
            delete projection.buffers[key];
        }
    }
    for (const key of Object.keys(projection.pathSummaries)) {
        if (key.startsWith('minimumFlex')) delete projection.pathSummaries[key];
    }
    delete projection.pathMissingness.minimumFlexRestriction;
    function removeAnnualFields(value) {
        if (!value || typeof value !== 'object') return;
        delete value.flex_wunsch_haushalt_nominal;
        delete value.flex_unter_mindestflex;
        for (const child of Object.values(value)) removeAnnualFields(child);
    }
    removeAnnualFields(projection);
    return projection;
}

const { EngineAPI } = await import('../engine/index.mjs');
const { buildSimulatorInputsFromProfileData } = await import(`../app/simulator/simulator-profile-inputs.js`);
const { runMonteCarloChunk } = await import(`../app/simulator/monte-carlo-runner.js`);
const { prepareHistoricalDataOnce } = await import(`../app/simulator/simulator-engine-helpers.js`);
prepareHistoricalDataOnce();
const base = { startVermoegen: 900000, depotwertAlt: 300000, einstandAlt: 250000, zielLiquiditaet: 50000,
    startFloorBedarf: 24000, startFlexBedarf: 12000, rebalancingBand: 25, maxSkimPctOfEq: 10, maxBearRefillPctOfEq: 5,
    liquidityRunwayYears: 3, goldAktiv: false, goldZielProzent: 0, goldFloorProzent: 0, goldSteuerfrei: true,
    dynamicFlex: false, horizonMethod: 'survival_quantile', horizonYears: 30, survivalQuantile: .85,
    goGoActive: false, goGoMultiplier: 1, capeRatio: 0, marketCapeRatio: 0, partner: { aktiv: false },
    healthBucket: { enabled: true, initialAmount: 10000, assetSource: 'money_market_first_then_cash', triggerMinGrade: 2,
        triggerMode: 'OR', coverageMode: 'care_additional_floor_only', returnMode: 'cash_return', targetMode: 'nominal_fixed' } };
const options = { engine: EngineAPI, useCapeSampling: false, widowOptions: { mode: 'none', percent: 0 },
    monteCarloParams: { anzahl: 2, maxDauer: 4, blockSize: 1, seed: 42, methode: 'block', rngMode: 'per-run-seed' } };
for (const date of ['', '2026-01-01', '2024-07-15']) {
    const data = { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14', profile_rentenbeginn: date,
        profile_kirchensteuer_pct: '9', profile_rente_monatlich: '1234.567', profile_rentenanpassung_art: 'fix', profile_rentenanpassung_pct: '2' };
    const input = { ...buildSimulatorInputsFromProfileData(data, { referenceYear: 2026 }), ...base };
    const before = JSON.stringify(input);
    const result = await runMonteCarloChunk({ ...options, inputs: input });
    if (result.totals.failCount || JSON.stringify(input) !== before) throw new Error('Ungültiger Referenzlauf');
    assertEqual(createHash('sha256').update(JSON.stringify(projectLegacyFinancialBytes(result))).digest('hex'), 'a9ccf4d36104c783eb9a34d8f447cb84cfb8eac8b6890ae6f0605414f87dfc3d', 'Gleiche numerische Personenparameter: vollständiger JSON.stringify-Altpfad bytegleich zur vorab gesicherten Quelle: ' + (date || 'fehlender Beginn'));
    assertEqual(JSON.stringify(input), before, 'Vollständige Adaptereingaben unverändert');
}
const legacy = { ...base, startAlter: 67, geschlecht: 'm', startSPB: 0, kirchensteuerSatz: .09,
    renteMonatlich: 1234.567, renteStartOffsetJahre: 2, rentAdjMode: 'fix', rentAdjPct: 2,
    accumulationPhase: { enabled: true, sparrate: 500, sparrateIndexing: 'none' }, transitionYear: 2 };
const result = await runMonteCarloChunk({ ...options, inputs: legacy });
assertEqual(result.totals.failCount, 0, 'Alter Offsetrequest durchläuft Ansparen und Übergang ohne Fehler');
assertEqual(createHash('sha256').update(JSON.stringify(projectLegacyFinancialBytes(result))).digest('hex'), '775393f6abec4c4095789b8506ac953542748e1c1be875c14cf22f9939ad48cc', 'Vollständiger alter Offset-/Ansparrequest bytegleich zur vorherigen Quelle');
}

{
    const { personDateInputToIso, personDateDisplay, personGenderAssumed } = await import('../app/profile/profile-person-data.js');
    for (const [text, iso] of [['14.03.1958', '1958-03-14'], ['29.02.2000', '2000-02-29'], ['01.01.1960', '1960-01-01'], ['', '']]) {
        assertEqual(personDateInputToIso(text), iso, 'Deutsche Datumseingabe wird rein in ISO konvertiert');
        assertEqual(personDateDisplay(iso), text, 'ISO-Datum wird deutsch angezeigt');
    }
    for (const invalid of ['14.03.', '1.1.1960', '31.04.1960', '29.02.1900', '2026-01-01']) assertEqual(personDateInputToIso(invalid), null, 'Ungültige/partielle Formularangabe wird abgewiesen');
    const assumed = { ...data, profile_geschlecht: 'm', profile_person_migration_v1: JSON.stringify({ sources: { geschlecht: ['angenommen'] } }) };
    assert(personGenderAssumed(assumed), 'Angenommen ist ausschließlich Herkunft');
    assert(!personGenderAssumed({ ...data, profile_geschlecht: 'm' }), 'Explizites m ist keine Annahme');
    assertEqual(JSON.stringify(projectPerson(assumed, 2026)), JSON.stringify(projectPerson({ ...data, profile_geschlecht: 'm' }, 2026)), 'Angenommene und explizite gleiche Geschlechtswerte sind bitgleich projiziert');
}

{
    const { deriveAnnualPension } = await import('../app/profile/profile-person-data.js');
    const previousTZ = process.env.TZ;
    try {
        for (const tz of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
            process.env.TZ = tz;
            for (const [date, months] of [['', 12], ['2024-07-15', 12], ['2026-01-01', 12], ['2026-07-01', 6], ['2026-07-15', 6], ['2026-12-01', 1], ['2028-07-01', 0]]) {
                const actual = deriveAnnualPension(date, 2026, 1000);
                assertEqual(JSON.stringify(actual), JSON.stringify({ monateImJahr: months, renteImJahr: months * 1000 }), tz + ': reine Rentenmonate ' + date);
            }
        }
    } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
    for (const args of [['2026-02-30', 2026, 1000], ['2026-7-01', 2026, 1000], ['', 2026.5, 1000], ['', 0, 1000], ['', 2026, -1], ['', 2026, NaN], ['', 2026, Infinity], ['', 2026, true], ['', 2026, '1000'], ['', 2026, Number.MAX_VALUE]]) {
        let error; try { deriveAnnualPension(...args); } catch (cause) { error = cause; }
        assert(error, 'Ungültiger Rentenvertrag wird abgewiesen');
    }
    assertEqual(projectPerson({ ...data, profile_rentenbeginn: '2028-07-15' }, 2026).renteStartMonate, 6, 'Zentrale Projektion transportiert sechs Startmonate');
    assertEqual(projectPerson({ ...data, profile_rentenbeginn: '2024-07-15' }, 2026).renteStartMonate, 12, 'Vergangener Juli kürzt das neue Bezugsjahr nicht');
}

// Der datierte Migrationsbeginn schreitet kalenderbezogen fort.
{
    const unknown = { ...data, profile_rentenbeginn: '', profile_rente_monatlich: '1000',
        profile_person_migration_v1: JSON.stringify({ referenceYear: 2026, renteStartOffsetJahre: 2, suggestedRentenbeginn: '2028-01-01' }) };
    for (const year of [2026, 2027, 2028, 2029]) {
        const person = projectPerson(unknown, year);
        assertEqual(person.monateImJahr, year < 2028 ? 0 : 12, 'Datierter Beginn bestimmt Budgetmonate');
        assertEqual(person.renteImJahr, year < 2028 ? 0 : 12000, 'Ab datiertem Start volle Jahresrente');
        assertEqual(person.renteMonatlich, 1000, 'Erwartete Monatsrente bleibt erhalten');
        assertEqual(person.renteStartMonate, 12, 'Simulatorstartmonate bleiben zwölf');
        assertEqual(person.renteStartOffsetJahre, Math.max(0, 2028 - year), 'Versatz folgt gespeichertem Startjahr');
    }
    for (const date of ['2024-07-15', '2026-01-01', '2026-07-15', '2028-07-15']) {
        const withOffset = projectPerson({ ...unknown, profile_rentenbeginn: date }, 2026);
        const withoutOffset = projectPerson({ ...unknown, profile_rentenbeginn: date, profile_person_migration_v1: '' }, 2026);
        assertEqual(JSON.stringify(withOffset), JSON.stringify(withoutOffset), 'Bestätigtes ISO-Datum hat Vorrang vor Offset und Vorschlag: ' + date);
    }
    for (const offset of [undefined, 0]) for (const suggestion of [undefined, '2028-01-01']) {
        assertEqual(JSON.stringify(projectPerson({ ...unknown, profile_person_migration_v1: JSON.stringify({ renteStartOffsetJahre: offset, suggestedRentenbeginn: suggestion }) }, 2026)),
            JSON.stringify(projectPerson({ ...unknown, profile_person_migration_v1: '' }, 2026)), 'Fehlender/nullwertiger Offset und bloßer Januarvorschlag behalten sämtliche Altpfadwerte');
    }
    for (const invalid of [{ profile_rentenbeginn: '2026-02-30' }, { profile_rente_monatlich: '-1' },
        { profile_rente_monatlich: String(Number.MAX_VALUE) }, { profile_sonstige_einkuenfte: '-1' }]) {
        let error; try { projectPerson({ ...unknown, ...invalid }, 2026); } catch (cause) { error = cause; }
        assert(error, 'Budgetausnahme verdeckt keine Kalender- oder Einkommensfehler');
    }
}

// Positive Altversätze brauchen belegte, gültige Herkunft; explizite Daten haben Vorrang.
for (const migration of [null, [], { renteStartOffsetJahre: -1 }, { renteStartOffsetJahre: 1.5 },
    { renteStartOffsetJahre: '2', referenceYear: 2026 }, { renteStartOffsetJahre: 2 },
    ...[0, -1, 2026.5, '2026', 9999].map(referenceYear => ({ referenceYear, renteStartOffsetJahre: 2 }))]) {
    let error;
    try { projectPerson({ ...data, profile_rentenbeginn: '', profile_person_migration_v1: JSON.stringify(migration) }, 2026); } catch (caught) { error = caught; }
    assert(error, 'Ungültige datierte Herkunft bleibt kontrollierter Fehler');
}

{
    const { projectPersonPension } = await import('../app/profile/profile-person-data.js');
    for (const start of ['', '2026-07-15', '2028-01-01']) {
        for (const year of [2026, 2028, 2029]) {
            const data = { profile_person_schema_version: '1', profile_aktuelles_alter: '67', profile_rente_monatlich: '123.45',
                profile_sonstige_einkuenfte: '10', profile_rentenbeginn: start,
                profile_person_migration_v1: JSON.stringify({ referenceYear: 2026, renteStartOffsetJahre: 2 }) };
            const before = JSON.stringify(data), annual = projectPerson(data, year), pension = projectPersonPension(data, year);
            for (const key of ['renteMonatlich', 'sonstigeEinkuenfte', 'monateImJahr', 'renteImJahr', 'renteStartMonate', 'renteKalenderbeginn', 'renteStartOffsetJahre']) {
                assertEqual(pension[key], annual[key], 'Gemeinsame Jahres-/Migrationsableitung unverändert: ' + key);
            }
            const { profile_aktuelles_alter, profile_person_schema_version, ...withoutAge } = data;
            assertEqual(JSON.stringify(projectPersonPension(withoutAge, year)), JSON.stringify(pension), 'Rentenleser ist unabhängig von Alter und Personenschema');
            assertEqual(JSON.stringify(data), before, 'Gemeinsame Exportgrenze liest ausschließlich');
        }
    }
}

// Anzeige und Planung verwenden getrennte Stichtage, dieselben unveränderten Quellen.
{
    const { personDisplayAge, describePersonDates } = await import('../app/profile/profile-person-data.js');
    const { getAppTestDate, setAppTestDate, parseCalendarDate } = await import('../app/shared/app-clock.js');
    const previous = getAppTestDate();
    try {
        setAppTestDate('2026-10-09');
        for (const [birth, todayAge, januaryAge] of [['1962-06-02', 64, 63], ['1965-06-28', 61, 60]]) {
            const source = { profile_person_schema_version: '1', profile_geburtsdatum: birth };
            const before = JSON.stringify(source);
            assertEqual(personDisplayAge(source).age, todayAge, 'Probelauftag steuert heutiges Alter ohne Datumsargument');
            const dates = describePersonDates(source, 2026);
            assertEqual(dates.todayAge, todayAge, 'Additives Anzeigealter');
            assertEqual(dates.age, januaryAge, 'Detailprojektion behält Januaralter');
            assertEqual(projectPerson(source, 2026).startAlter, januaryAge, 'Rechenprojektion behält Januaralter');
            assertEqual(personAge(source, 2027).age, todayAge, 'Folgeplanung behält ihren Januarwert');
            assert(dates.hint.includes(`Planung 2026`) && dates.hint.includes(`01.01.: ${januaryAge}`)
                && dates.hint.includes(`Planung 2027: ${todayAge}`), 'Detailhinweis benennt Planungsjahre und Stichtag');
            assertEqual(JSON.stringify(source), before, 'Anzeige schreibt keine Personenwerte');
        }
        for (const [birth, day, age] of [
            ['1962-06-02', '2026-06-01', 63], ['1962-06-02', '2026-06-02', 64],
            ['1964-02-29', '2026-02-28', 61], ['1964-02-29', '2026-03-01', 62],
            ['1964-02-29', '2028-02-28', 63], ['1964-02-29', '2028-02-29', 64],
            ['1962-01-01', '2026-01-01', 64], ['2026-10-09', '2026-10-09', 0]
        ]) assertEqual(personDisplayAge({ profile_geburtsdatum: birth }, parseCalendarDate(day)).age, age, `${birth} am ${day}`);
        const january = describePersonDates({ profile_geburtsdatum: '1962-01-01' }, 2026, parseCalendarDate('2026-01-01'));
        assertEqual(january.age, january.todayAge, 'Geburtstag am Januarstichtag zählt auch in der Planung');
        assert(january.hint.includes('bereits in diesem Planungsjahr berücksichtigt') && !january.identity.includes('Planung'), 'Januarhinweis steht nur im Detail');
        const fallback = { profile_aktuelles_alter: '67' }, before = JSON.stringify(fallback);
        assertEqual(personDisplayAge(fallback).status, 'fallback', 'Festes Altalter ist gekennzeichnet');
        assertEqual(personDisplayAge(fallback).age, 67, 'Altalter bleibt unverändert');
        assert(describePersonDates(fallback, 2026).identity.includes('Altalter, Geburtsdatum fehlt'), 'Ehrlicher Identitätstext');
        assert(describePersonDates(fallback, 2026).hint.includes('Für die Planung 2026: 67 Jahre als festes Altalter'), 'Auch der Altalterhinweis nennt das Planungsjahr');
        assertEqual(JSON.stringify(fallback), before, 'Fallback schreibt keine Daten');
        for (const [source, status] of [[{}, 'missing'], [{ ...fallback, profile_geburtsdatum: '1964-02-30' }, 'invalid'], [{ profile_geburtsdatum: '2026-10-10' }, 'future']]) {
            assertEqual(personDisplayAge(source).status, status, 'Fehlende, ungültige und künftige Geburtstage bleiben erkennbar');
            assertEqual(personDisplayAge(source).age, null, 'Keine erfundene Alterszahl');
        }
        const savedTZ = process.env.TZ;
        try {
            for (const zone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
                process.env.TZ = zone;
                assertEqual(personDisplayAge({ profile_geburtsdatum: '1962-06-02' }, new Date(2026, 5, 2, 0, 0)).age, 64, zone + ': lokaler Geburtstag');
            }
        } finally { if (savedTZ === undefined) delete process.env.TZ; else process.env.TZ = savedTZ; }
    } finally { setAppTestDate(previous); }
}
