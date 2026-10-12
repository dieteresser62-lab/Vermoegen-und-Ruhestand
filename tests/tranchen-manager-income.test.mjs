import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { renderManagerProfiles } from '../app/tranches/tranchen-manager-renderer.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';

function person(name, pension, start = '', other = 0, extra = {}) {
    return { meta: { name }, data: { profile_person_schema_version: '1', profile_geburtsdatum: '1958-03-14',
        depot_tranchen: '[]', profile_tagesgeld: '100', profile_rente_monatlich: String(pension),
        profile_rentenbeginn: start, profile_sonstige_einkuenfte: String(other), ...extra } };
}
function render(registry, active = 'a') {
    const hosts = Object.fromEntries(['managerHousehold', 'managerProfileTabs', 'managerPageTitle', 'managerPersonSummary', 'managerPensionStatus'].map(id => [id, { innerHTML: '', textContent: '' }]));
    const projection = projectManagerProfiles(registry, active);
    renderManagerProfiles({ getElementById: id => hosts[id] }, projection);
    return { projection, html: hosts.managerHousehold.innerHTML, hosts };
}
const previous = getAppTestDate();
try {
    setAppTestDate('2026-10-08');
    const registry = { version: 1, profiles: { a: person('Person A', 650, '2028-07-01'), b: person('Person B', 1650, '', 750) } };
    const before = JSON.stringify(registry);
    const { projection, html } = render(registry);
    assertEqual(projection.household.income, 2400, 'Haushalt zählt heute nur laufende Rente und sonstige Einkünfte');
    assert(html.includes('2.400 €') && html.includes('ab 07/2028: 3.050 €'), 'Produktiver Renderer zeigt heutigen Betrag und kommende Stufe');
    assertEqual(JSON.stringify(registry), before, 'Lesen und Rendern erhalten alle Registrybytes');
} finally { setAppTestDate(previous); }

try {
    const registry = { version: 1, profiles: { a: person('A <script>', 650, '2028-07-15'), b: person('B', 1650, '', 750),
        outside: { ...person('Außenprofil', 9000, '2027-01-01'), meta: { name: 'Außenprofil', belongsToHousehold: false } } } };
    const original = JSON.stringify(registry);
    for (const [date, amount, stages] of [['2028-06-30', 2400, 1], ['2028-07-01', 3050, 0], ['2026-10-08', 2400, 1], ['2028-07-31', 3050, 0]]) {
        setAppTestDate(date);
        const result = render(registry, 'outside');
        assertEqual(result.projection.household.income, amount, 'Zentrale Uhr und Beginnmonat: ' + date);
        assertEqual(result.projection.household.incomeSteps.length, stages, 'Erreichte Stufen verschwinden, Rücksprung stellt sie wieder her');
        assert(!result.html.includes('A <script>') && result.html.includes('A &lt;script&gt;'), 'Personennamen bleiben sichere Ausgabe');
    }
    assertEqual(JSON.stringify(registry), original, 'Datumssprünge und aktives Außenprofil schreiben keine Fachbytes');
    setAppTestDate('2026-10-08');
    for (const belongs of [true, false]) {
        const single = { version: 1, profiles: { a: { ...person('Einzel', 650, '2028-07-15', 200), meta: { name: 'Einzel', belongsToHousehold: belongs } } } };
        const result = render(single);
        assertEqual(result.projection.profiles[0].income, 200, 'Sonstige Einkünfte gelten vor Rentenbeginn auch im Einzelprofil');
        assert(result.html.includes('<strong>200 €</strong>') && result.html.includes('ab 07/2028: 850 €'), 'Einzelansicht verwendet denselben Projektionspfad, auch außerhalb des Haushalts');
        assert(result.hosts.managerPersonSummary.textContent.includes('ab 15.07.2028'), 'Kompakte Rente trägt ihren Zukunftsstatus');
    }
    const stages = { version: 1, profiles: { a: person('A', 100, '2028-10-01', 50), b: person('B', 200, '2028-07-01'),
        c: person('C', 300, '2028-07-15'), d: person('D', 400, '2029-02-01'), e: person('E', 0, '2027-03-01') } };
    const result = render(stages);
    assertEqual(JSON.stringify(result.projection.household.incomeSteps), JSON.stringify([{ month: '2028-07', income: 550 }, { month: '2028-10', income: 650 }, { month: '2029-02', income: 1050 }]), 'Gleiche Monate gruppieren, Nullrenten entfallen und spätere Stufen kumulieren chronologisch');
    const visible = result.html.match(/id="managerIncomeSteps">([\s\S]*?)<\/div>/)[1];
    assert((visible.match(/<p>/g) || []).length === 2 && !visible.includes('02/2029'), 'Genau die nächsten zwei Stufen stehen sichtbar');
    assert(result.html.includes('aria-describedby="managerIncomeHelp"') && result.html.includes('role="tooltip">weitere Änderungen: ab 02/2029: 1.050 €'), 'Übrige Stufen besitzen fokussierbare Hilfe mit eindeutigem Bezug');
    const migration = JSON.stringify({ referenceYear: 2026, renteStartOffsetJahre: 2, suggestions: { rentenbeginn: '2028-01-01' } });
    const legacy = { version: 1, profiles: { a: person('Altbeginn', 650, '', 200, { profile_person_migration_v1: migration }) } };
    const missing = render(legacy);
    assertEqual(missing.projection.profiles[0].income, 200, 'Fehlender bestätigter Beginn mit künftigem Altbeginn zählt heute nicht');
    assert(missing.html.includes('Rentenbeginn fehlt') && !missing.html.includes('ab 01/2028:'), 'Vorschlag bleibt unbestätigt und erscheint nicht als datierte Stufe');
    assertEqual(missing.hosts.managerPensionStatus.textContent, 'Rentenbeginn fehlt', 'Fehlbeginn wird auch am Formular angezeigt');
    setAppTestDate('2028-01-01');
    assertEqual(render(legacy).projection.profiles[0].income, 850, 'Erreichter datierter Altbeginn folgt bestehendem Jahresvertrag');
    setAppTestDate('2026-10-08');
    for (const extra of [{ profile_rentenbeginn: '2028-02-30' }, { profile_person_migration_v1: '{' },
        { profile_person_migration_v1: JSON.stringify({ renteStartOffsetJahre: 2 }) },
        { profile_person_migration_v1: JSON.stringify({ referenceYear: 2026, renteStartOffsetJahre: -1 }) }]) {
        const invalid = render({ version: 1, profiles: { a: person('Fehler', 650, '', 0, extra), b: person('B', 1650) } });
        assertEqual(invalid.projection.household, null, 'Fehlerhafte Kalender-/Herkunftsangaben erzeugen keine scheinbare Vollsumme');
        assert(!invalid.projection.profiles[0].valid, 'Beschädigte Person wird nicht als laufende Rente umgedeutet');
    }
    const noAge = person('Ohne Alter', 650, '2028-07-01', 10); delete noAge.data.profile_geburtsdatum;
    const data = { version: 1, profiles: { a: noAge, b: person('B', 1650, '', 750) } };
    const baseline = render(data).projection;
    assert(baseline.profiles[0].valid && baseline.profiles[0].assets === 100, 'Neue Rentengrenze verlangt kein belegtes Alter für Vermögen');
    // Das tatsächliche Balanceformat wird wie bei den übrigen Managerproben gelesen.
    const { CONFIG } = await import('../app/balance/balance-config.js');
    data.profiles.a.data[CONFIG.STORAGE_KEY] = JSON.stringify({ inputs: {}, annualPeriodMetadata: { lastCommittedPeriod: 'calendar-year:2035' } });
    const before = JSON.stringify(data);
    const advanced = render(data).projection;
    assertEqual(advanced.household.income, baseline.household.income, 'Vorgezogenes Planungsjahr beeinflusst heutigen Betrag nicht');
    assertEqual(JSON.stringify(advanced.household.incomeSteps), JSON.stringify(baseline.household.incomeSteps), 'Vorgezogenes Planungsjahr beeinflusst Zukunftsstufen nicht');
    assertEqual(JSON.stringify(data), before, 'Metadaten, Profile, Tranchen und Balancezustand bleiben bytegleich');
} finally { setAppTestDate(previous); }
