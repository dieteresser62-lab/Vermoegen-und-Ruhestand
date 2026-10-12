"use strict";

import {
    renderManagerPersonData,
    renderManagerProfiles,
    renderManagerQuoteContext,
    buildEmptyTranchenHtml,
    buildReconciliationCashStatusesHtml,
    buildTranchenStatsHtml,
    buildTranchenTableHtml
} from '../app/tranches/tranchen-manager-renderer.js';
import { validateManagerMarkup } from './designsystem-source-contract.mjs';

console.log('--- Tranchen Manager Renderer Tests ---');

console.log('Test 1: stats renderer returns summary html');
{
    const html = buildTranchenStatsHtml([
        { marketValue: 1200, costBasis: 1000 },
        { marketValue: 800, costBasis: 900 }
    ]);
    assert(html.includes('Gesamtwert'), 'Stats html should include labels');
    assert(html.includes('2.000'), 'Stats html should include formatted total value');
    assert(!html.includes('Anzahl Tranchen'), 'Tranchensumme bleibt außerhalb der fünf Kennzahlen');
}
console.log('✓ stats renderer returns summary html OK');

console.log('Test 2: empty table renderer returns empty state');
{
    const html = buildEmptyTranchenHtml();
    assert(html.includes('Keine Tranchen vorhanden'), 'Empty html should include empty state');
}
console.log('✓ empty table renderer returns empty state OK');

console.log('Test 3: table renderer returns action markup');
{
    const html = buildTranchenTableHtml([{
        trancheId: 't1',
        purchaseDate: '2024-01-01',
        name: 'ETF',
        isin: 'DE000123',
        ticker: 'VWCE',
        shares: 10,
        purchasePrice: 100,
        currentPrice: 120,
        costBasis: 1000,
        marketValue: 1200,
        tqf: 0.3,
        type: 'aktien_neu'
    }]);
    assert(html.includes('data-action="edit-tranche"'), 'Table html should include edit action hooks');
    assert(html.includes('ETF'), 'Table html should include tranche name');
    assert(html.includes('1.200'), 'Table html should include formatted market value');
}
console.log('✓ table renderer returns action markup OK');

console.log('Test 4: classification, signs and accessibility are unambiguous');
{
    const html = buildTranchenTableHtml([{
        trancheId: 'gold-1',
        purchaseDate: '2025-01-01',
        name: 'Gold Reserve',
        isin: '',
        ticker: 'GOLD',
        shares: 2,
        purchasePrice: 100,
        currentPrice: 90,
        costBasis: 200,
        marketValue: 180,
        tqf: 1,
        category: 'gold',
        type: 'gold'
    }]);
    assert(html.includes('Gold-ETC'), 'Gold should be rendered as gold type');
    assert(!html.includes('>Geldmarkt</span>'), 'Gold should not be labelled as money market');
    assert(html.includes('-10,0\u00a0%'), 'Negative return should contain one leading minus sign');
    assert(!html.includes('+-'), 'Negative values must never contain plus-minus output');
    assert(html.includes('aria-label="Tranche Gold Reserve bearbeiten"'), 'Edit icon should have an accessible name');
    assert(html.includes('aria-label="Tranche Gold Reserve löschen"'), 'Delete icon should have an accessible name');
    assert(html.includes('class="table-scroll ds-table-scroll"'), 'Table should render inside its dedicated scroll container');
}
console.log('✓ classification and accessible actions OK');

console.log('Test 5: empty state does not claim FIFO activity');
{
    const html = buildEmptyTranchenHtml();
    assert(!html.includes('FIFO aktiv'), 'Empty state must not report FIFO as active');
}
console.log('✓ empty FIFO semantics OK');

console.log('Test 6: cash-status renderer distinguishes pending, corrected and legacy evidence safely');
{
    const html = buildReconciliationCashStatusesHtml([
        {
            targetActionId: 'sale-<unsafe>',
            cashStatus: 'pending_manual_posting',
            statusLabel: 'Offen – manuell nachführen',
            confirmedNetProceedsEur: 500,
            cashBalanceAfterPostingEur: null,
            effectiveActionId: null,
            correctionRevision: 0,
            isPending: true,
            isLegacy: false,
            canConfirm: true,
            canCorrect: false
        },
        {
            targetActionId: 'sale-2',
            cashStatus: 'confirmed_corrected',
            statusLabel: 'Cash bestätigt – korrigiert',
            confirmedNetProceedsEur: 95,
            cashBalanceAfterPostingEur: 10090,
            effectiveActionId: 'cash-correction:v1:sale-2:1',
            correctionRevision: 1,
            correctionReason: 'Zahlendreher',
            isPending: false,
            isLegacy: false,
            canConfirm: false,
            canCorrect: true
        },
        {
            targetActionId: 'legacy-sale',
            cashStatus: 'legacy_unknown',
            statusLabel: 'Abgeschlossen (Altfall – Cashstatus nicht dokumentiert)',
            confirmedNetProceedsEur: 42,
            cashBalanceAfterPostingEur: null,
            effectiveActionId: null,
            correctionRevision: 0,
            isPending: false,
            isLegacy: true,
            canConfirm: true,
            canCorrect: false
        }
    ]);
    assert(html.includes('1 Verkauf/Verkäufe mit offener manueller Cashbuchung'),
        'Renderer should count only true pending sales');
    assert(html.includes('data-cash-action="confirm"') && html.includes('data-cash-action="correct"'),
        'Renderer should expose explicit append-only workflow actions');
    assert(html.includes('Revision 1') && html.includes('10.090'),
        'Renderer should show only the effective corrected balance and revision');
    assert(html.includes('Altfall – Cashstatus nicht dokumentiert'),
        'Renderer should keep legacy evidence distinct from confirmed cash');
    assert(html.includes('1 Altverkauf/Altverkäufe ohne dokumentierten Cashstatus')
        && html.includes('nicht als cashbestätigt'),
    'Renderer summary must disclose legacy sales instead of implying confirmed cash');
    assert(!html.includes('sale-<unsafe>') && html.includes('sale-&lt;unsafe&gt;'),
        'Cash target ids must be HTML-escaped in text and attributes');

    const errorHtml = buildReconciliationCashStatusesHtml([], {
        errorMessage: 'Audit <nicht lesbar>'
    });
    assert(errorHtml.includes('Cashstatus-Audit nicht lesbar – die Liste ist unvollständig'),
        'Unreadable audit should render a dedicated incomplete-list state');
    assert(!errorHtml.includes('Noch keine dokumentierten Realverkäufe'),
        'Unreadable audit must never masquerade as an empty history');
    assert(errorHtml.includes('Audit &lt;nicht lesbar&gt;') && !errorHtml.includes('Audit <nicht lesbar>'),
        'Audit error details must be HTML-escaped');
}
console.log('✓ cash-status rendering contract OK');

for (const gain of [0, -0, 100, -100]) {
    const rows = [{ name: 'R8-Nullgegenprobe', marketValue: 1000 + gain, costBasis: 1000 }];
    const before = JSON.stringify(rows), html = buildTranchenTableHtml(rows);
    assert(html.includes(`<td class="${gain === 0 ? '' : gain > 0 ? 'positive' : 'negative'}">`), 'Gewinnzelle trennt exakte Null von Vorzeichen');
    if (gain === 0) assert(html.includes('0\u00a0€<small class="pv-gain-percent">0,0\u00a0%</small>'), 'Nullgewinn behält seine deutschen Anzeigezeichen');
    assertEqual(/class="[^"]*(?:positive|negative)/.test(buildTranchenStatsHtml(rows)), gain !== 0, 'Kennzahlenfarbe folgt dem ungerundeten Gewinn');
    assertEqual(JSON.stringify(rows), before, 'Gewinnrenderer verändert keine Rohdaten');
}

console.log('Test: Gruppen, Steuermarker, Kursdatum und unveränderte Reihenfolge');
{
    const lot = { shares: 2, purchasePrice: 100, currentPrice: 120, marketValue: 240, costBasis: 200,
        purchaseDate: '2024-01-02', tqf: 0, taxExempt: false, isin: '', ticker: '' };
    const lots = [
        { ...lot, trancheId: 'gold', name: 'Gold ohne TQF', type: 'gold', taxExempt: true, asOf: 1700000000 },
        { ...lot, trancheId: 'new', name: 'Hohe TQF', type: 'aktien_neu', tqf: 1, asOf: 1700000000 },
        { ...lot, trancheId: 'bond', name: 'Anleihe', type: 'anleihe', marketValue: 180, purchaseDate: '' },
        { ...lot, trancheId: 'old', name: 'Altbestand ohne Datum', type: 'aktien_alt', purchaseDate: '' },
        { ...lot, trancheId: 'money', name: 'Geldmarkt', type: 'geldmarkt' },
        { ...lot, trancheId: 'tie', name: 'Gleicher Kauftag', type: 'aktien_neu' }
    ].map(Object.freeze);
    Object.freeze(lots);
    const before = JSON.stringify(lots), html = buildTranchenTableHtml(lots);
    const groups = [...html.matchAll(/data-depot-group="([^"]+)"/g)].map(m => m[1]);
    assertEqual(groups.join(','), 'equity,money_market,gold,bonds', 'Anlageformen folgen der festen Vorlagenreihenfolge');
    const rows = [...html.matchAll(/<tr class="tranche-row" data-tranche-id="([^"]+)">([\s\S]*?)<\/tr>/g)];
    assertEqual(rows.map(row => row[1]).join(','), 'old,new,tie,money,gold,bond', 'Kaufdatumfallback und Gleichstand erhalten stabile Reihenfolge innerhalb jeder Gruppe');
    const row = id => rows.find(row => row[1] === id)[2];
    assert(row('gold').includes('Steuerfrei'), 'Explizite Steuerfreiheit braucht keine hohe TQF');
    assert(!row('new').includes('Steuerfrei') && row('new').includes('Teilfreistellung 1,00'), 'Hohe TQF ist keine Steuerfreiheit');
    assert(row('old').includes('Altbestand') && row('old').includes('Datum fehlt') && !row('old').includes('Steuerfrei'), 'Altbestand folgt Typ ohne Kaufdatumsannahme oder Steuerinferenz');
    assert(row('gold').includes('Kurs 14.11.'), 'Kursdatum stammt aus UTC-Sekunden statt Kaufdatum');
    assert(row('old').includes('Kursdatum unbekannt'), 'Fehlende Zeit wird nicht ersetzt');
    const equity = html.match(/<tr class="pv-depot-group" data-depot-group="equity">([\s\S]*?)<\/tr>/)[1];
    assert(equity.includes('3 Tranchen') && equity.includes('720') && equity.includes('+120'), 'Gruppensummen sind Marktwert und Buchgewinn des Gruppenbestands');
    assert(buildTranchenStatsHtml(lots).includes('Teilweise unbekannt · 14.11.2023'), 'Teilweise Kursbelege werden kenntlich gemacht');
    assertEqual(JSON.stringify(lots), before, 'Gruppierung, Sortierung und Datumsanzeige verändern weder Objekte noch Speicherreihenfolge');
    const mixed = buildTranchenStatsHtml([{ ...lot, asOf: 1700000000 }, { ...lot, asOf: 1700086400 }]);
    assert(mixed.includes('Gemischte Kursstände · 14.11.2023 – 15.11.2023'), 'Gemischte Kursdaten werden als Bereich ausgegeben');
    assert(buildTranchenStatsHtml([{ ...lot, asOf: 1700000000 }, { ...lot, asOf: 1700000001 }]).includes('Gemischte Kursstände'), 'Auch verschiedene Zeiten am selben UTC-Tag bleiben gemischt');
    assert(buildTranchenStatsHtml([{ ...lot, asOf: '1700000000' }]).includes('Kursdatum unbekannt'), 'Zeitstrings werden nicht still konvertiert');
    assert(buildTranchenStatsHtml([]).includes('Keine Kurse vorhanden'), 'Leerer Bestand erhält vollständigen Kursleerzustand');
    const unsafe = buildTranchenTableHtml([{ ...lot, type: 'aktien_neu', trancheId: 'id"<probe>', name: '<script>Probe</script>' }]);
    assert(!unsafe.includes('<script>') && unsafe.includes('id&quot;&lt;probe&gt;'), 'Dynamische Namen und IDs werden escaped');
}

{
    const utcMidnight = Date.parse('2024-01-01T23:59:59Z') / 1000;
    const distant = Date.parse('+010000-01-01T00:00:00Z') / 1000;
    const input = [{ trancheId: 'utc', name: 'UTC', type: 'aktien_neu', asOf: utcMidnight },
        { trancheId: 'distant', name: 'Weiter gültiger Stichtag', type: 'gold', asOf: distant }];
    const html = buildTranchenTableHtml(input);
    assert(html.includes('Kurs 01.01.'), 'Kurze Kursanzeige benutzt das lokale gespeicherte Datum');
    assert(html.includes('Kurs 01.01.'), 'Strukturell gültige erweiterte Jahre werden nicht abgeschnitten oder umgedeutet');
    assert(buildTranchenStatsHtml(input).includes(`${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(utcMidnight * 1000))} – ${new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(distant * 1000))}`), 'Kursbereich sortiert tatsächliche Sekunden statt ISO-Text');
}

console.log('Personenkarten: Einzelprofil, unvollständiger Haushalt und sichere Datenprojektion');
{
    const hosts = Object.fromEntries(['managerHousehold', 'managerPageTitle', 'managerSectionNav'].map(id => [id, { innerHTML: '', textContent: '' }]));
    const doc = { getElementById: id => hosts[id] };
    const profile = { id: 'p"<', name: 'Lina <Nord>', active: true, belongs: true, valid: true,
        householdRole: 'Hauptprofil im Haushalt', assets: 150.75, cost: 50.25, gain: 50.5, count: 1,
        income: 15.75, currentIncome: { status: 'im Monat', missing: false }, incomeSteps: [], allocation: { aktien_neu: 100.75, cash: 50 }, values: { alter: 68, renteMonatlich: 10.5, sonstigeEinkuenfte: 5.25, tagesgeld: 50, healthBucket: { enabled: false } } };
    const projection = { profiles: [profile], household: { ...profile, income: 15.75, careTarget: 25 } };
    const before = JSON.stringify(projection);
    renderManagerProfiles(doc, projection);
    const nav = hosts.managerSectionNav.innerHTML;
    assert(nav.includes('data-manager-profile="p&quot;&lt;"') && nav.includes('Lina &lt;Nord&gt;'), 'Abschnittsnavigation schützt Personenname und Kennung');
    assertEqual(validateManagerMarkup(nav).join('\n'), '', 'Gerenderte Abschnittsnavigation erfüllt die Managerrollen');
    const withoutButtonRole = nav.replace('class="ds-button pv-tab"', 'class="pv-tab"');
    assert(withoutButtonRole !== nav, 'Gegenprobe entfernt die Buttonrolle aus dem tatsächlich erzeugten Reiter');
    assert(validateManagerMarkup(withoutButtonRole).includes('Managerrolle fehlt: button ds-button'), 'Gegenprobe erkennt fehlende Buttonrolle in der Ansichtsreiterliste');
    assertEqual(hosts.managerPageTitle.textContent, 'Alles über dich, an einem Ort.', 'Einzelprofil besitzt den passenden Titel');
    const card = hosts.managerHousehold.innerHTML;
    assert(card.includes('pv-avatar') && card.includes('Lina &lt;Nord&gt;'), 'Avatar und Name werden sicher ausgegeben');
    assert(card.includes('aria-label="Person Lina &lt;Nord&gt; verwalten"') && !card.includes('data-manager-people="p"<'), 'Kartenmenü schützt Name und Kennung');
    assert(card.includes('Sonstige Einkünfte') && card.includes('Rente netto') && card.includes('Vermögen'), 'Personenkarte zeigt alle drei Kennzahlen');
    assert(card.includes('11 €') && card.includes('5 €') && card.includes('151'), 'Einzelprofil zeigt getrennte Einkommen und Vermögen');
    assert(!card.includes('pv-household-card'), 'Einzelprofil zeigt keine redundante Haushaltskarte');
    assertEqual(JSON.stringify(projection), before, 'Kartenrendern verändert weder Zahlen noch Rollenprojektion');
    renderManagerProfiles(doc, { ...projection, profiles: [profile, { ...profile, id: 'b', active: false }], household: null });
    assertEqual(hosts.managerPageTitle.textContent, 'Alles über euch beide, an einem Ort.', 'Mehrprofilansicht besitzt den gemeinsamen Titel');
    assert(hosts.managerHousehold.innerHTML.includes('Haushaltssumme nicht verfügbar'), 'Ungültiger Haushalt wird nicht zu einer Vollsumme');
    assert(hosts.managerSectionNav.innerHTML.includes('data-manager-profile="b" aria-selected="false"'), 'Inaktive Person bleibt über dieselbe Ansichtsreiterliste erreichbar');
}

console.log('Kurskontext: automatisch verlangt eindeutigen gespeicherten Sitzungsbeleg');
{
    const host = { textContent: '', title: '' }, label = { dataset: { profileId: 'a' } };
    let reads = 0, writes = 0;
    const asOf = Math.floor(Date.now() / 1000) - 60;
    const lots = [{ trancheId: 'a-lot', asOf, currentPrice: 120 }];
    let report = { status: 'complete', updated: 1, results: [{ profileId: 'a', trancheId: 'a-lot', status: 'updated', asOf }] };
    const session = { getItem: () => { reads++; return JSON.stringify(report); }, setItem: () => { writes++; } };
    const doc = { defaultView: { sessionStorage: session }, querySelector: () => ({}), getElementById: id => id === 'suiteProfileContext' ? label : host };
    const before = JSON.stringify(lots);
    renderManagerQuoteContext(doc, lots);
    assert(host.textContent.includes('automatisch'), 'Passender Sitzungsbeleg kennzeichnet automatisch geladene Kurse');
    for (const change of [{ profileId: 'b' }, { trancheId: 'fremd' }, { status: 'failed' }, { asOf: asOf - 1 }]) {
        report.results = [{ profileId: 'a', trancheId: 'a-lot', status: 'updated', asOf, ...change }];
        renderManagerQuoteContext(doc, lots);
        assert(!host.textContent.includes('automatisch'), 'Fremder oder abweichender Kursbeleg behauptet keine Automatik');
    }
    report = { status: 'complete', updated: 1, results: [{ profileId: 'a', trancheId: 'a-lot', status: 'updated', asOf }] };
    renderManagerQuoteContext(doc, [...lots, { trancheId: 'unbekannt', currentPrice: 10 }]);
    assert(host.textContent.includes('Teilweise unbekannt') && !host.textContent.includes('automatisch'), 'Teilweise unbekannter Kursstand wird ehrlich dargestellt');
    renderManagerQuoteContext(doc, [{ ...lots[0], asOf: asOf - 8 * 86400 }]);
    assert(host.textContent.includes('ältere Kurse') && !host.textContent.includes('automatisch'), 'Alter Kursstand behauptet keine automatische Frische');
    session.getItem = () => { throw new Error('synthetic-unavailable'); };
    renderManagerQuoteContext(doc, lots);
    assert(!host.textContent.includes('automatisch'), 'Nicht lesbare Sitzung bleibt ohne Automatikbehauptung');
    assert(reads > 0 && writes === 0, 'Kurskontext liest den Bericht ohne Sessionwrite');
    assertEqual(JSON.stringify(lots), before, 'Kurskontext verändert keine gespeicherten Kurswerte');
}

console.log('Ganze Euro sind ausschließlich Ausgabe; Gruppensummen und Prozentnenner bleiben exakt');
{
    const lots = Object.freeze([
        Object.freeze({ trancheId: 'decimal-a', name: 'Bruch A', type: 'aktien_neu', costBasis: 100.49, marketValue: 110.76, purchasePrice: 67.13, currentPrice: 73.84 }),
        Object.freeze({ trancheId: 'decimal-b', name: 'Bruch B', type: 'aktien_neu', costBasis: 100.49, marketValue: 89.61, purchasePrice: 67.13, currentPrice: 59.74 })
    ]);
    const before = JSON.stringify(lots), stats = buildTranchenStatsHtml(lots), table = buildTranchenTableHtml(lots);
    assert(stats.includes('201\u00a0€') && stats.includes('200\u00a0€') && stats.includes('-1\u00a0€') && stats.includes('-0,3\u00a0%'), 'Summen und Prozentnenner werden vor der Ausgabe aus Bruchwerten gebildet');
    const group = table.match(/data-depot-group="equity">([\s\S]*?)<\/tr>/)[1];
    assert(group.includes('200\u00a0€') && group.includes('-1\u00a0€'), 'Gruppenausgabe rundet die rohe Summe statt einzelne Kartenwerte');
    assert(table.includes('67,13') && table.includes('+10,2\u00a0%'), 'Einzelpreis behält Cent; Gewinnprozent verwendet den rohen Einstand');
    assertEqual(JSON.stringify(lots), before, 'Gerundete Finanzanzeige erhält sämtliche Rohbytes');
    const cash = buildReconciliationCashStatusesHtml([{ targetActionId: 'dezimal', confirmedNetProceedsEur: 95.49, cashBalanceAfterPostingEur: 10090.75 }]);
    assert(cash.includes('95\u00a0€') && cash.includes('10.091\u00a0€') && cash.includes('95,49 €') && cash.includes('10.090,75 €'), 'Cashkarte zeigt ganze Euro und hält den centgenauen Nachweis zugänglich');
}

{
    const hosts = Object.fromEntries(['managerHousehold', 'managerSectionNav', 'managerPageTitle'].map(id => [id, { innerHTML: '' }]));
    const profile = { id: 'a', name: 'Person', active: true, valid: true, assets: 123, cost: 100, gain: 23,
        income: 120, currentIncome: { status: 'im Monat', missing: false }, incomeSteps: [], count: 1, allocation: { cash: 123 }, values: { alter: 67, renteMonatlich: 100, sonstigeEinkuenfte: 20, tagesgeld: 123 } };
    renderManagerProfiles({ getElementById: id => hosts[id] }, { profiles: [profile], household: { ...profile, income: 120, careTarget: 0 } });
    const html = hosts.managerHousehold.innerHTML;
    assert(/pv-hero-number[\s\S]*?<\/div>\s*<div class="pv-person-history"/.test(html), 'Haushaltsverlauf folgt unmittelbar auf die Vermögenshauptzahl');
    assert(/pv-person-wealth[\s\S]*?<\/dl>\s*<div class="pv-person-history"/.test(html), 'Personenverlauf folgt unmittelbar auf die Vermögenshauptzahl');
    assert((html.match(/pv-history-placeholder/g) || []).length === 2 && !html.includes('0 € · 0,0'), 'Beide Karten ohne Historie behalten ehrlichen Leerzustand');
}

console.log('Personendaten: echte Kernwerte, Datumshinweise und sichere Textknoten');
{
    const { describePersonDates } = await import('../app/profile/profile-person-data.js');
    const ids = ['managerPersonProfileName', 'managerPersonSummary', 'managerAssetsSummary', 'managerCareSummary', 'profilePersonDateStatus', 'managerPensionStatus', 'profileAlter', 'managerBirthSupplement', 'managerBirthSuggestion', 'managerBirthDate', 'managerBirthError'];
    const hosts = Object.fromEntries(ids.map(id => [id, { textContent: '', value: '', dataset: {}, hidden: false }]));
    const doc = { getElementById: id => hosts[id] };
    const data = { profile_geburtsdatum: '1958-03-14', profile_rentenbeginn: '2023-04-01' };
    const values = { renteMonatlich: 1500, kirchensteuerPct: 8, tagesgeld: 61000, goldAktiv: true, goldZiel: 7.5, healthBucket: { enabled: true, initialAmount: 40000, triggerMinGrade: 3 } };
    const now = new Date(2026, 9, 9, 12);
    const profile = { id: 'a', name: 'Lange Person <script>&"'.repeat(8), valid: true, values, currentIncome: { status: 'im Monat', pensionStatus: 'Rente läuft seit 01.04.2023' }, personDates: describePersonDates(data, 2026, now) };
    const before = JSON.stringify(profile);
    renderManagerPersonData(doc, profile);
    assertEqual(hosts.managerPersonProfileName.textContent, profile.name, 'Sonderzeichen und lange Namen erscheinen ausschließlich als Text');
    assert(hosts.managerPersonSummary.textContent.includes('geb. 14.03.1958 · 68 Jahre') && hosts.managerPersonSummary.textContent.includes('1.500 €'), 'Geschlossene Personzeile enthält echte Kernwerte');
    assert(hosts.managerAssetsSummary.textContent.includes('61.000 €') && hosts.managerAssetsSummary.textContent.includes('7,5 %'), 'Geschlossene Vermögenszeile enthält echte Beträge und Goldstrategie');
    assert(hosts.managerCareSummary.textContent.includes('40.000 €') && hosts.managerCareSummary.textContent.includes('Pflegegrad 3'), 'Geschlossene Pflegezeile enthält echtes Ziel und Trigger');
    assert(hosts.managerBirthSupplement.hidden && hosts.profileAlter.value === 67, 'Vollständiges Datum ersetzt Ergänzung durch Januaralter');
    assertEqual(JSON.stringify(profile), before, 'Darstellung lässt sämtliche Fachbytes unverändert');
    renderManagerPersonData(doc, { ...profile, personDates: describePersonDates(data, 2027) });
    assertEqual(hosts.profileAlter.value, 68, 'Neue Jahresbasis projiziert Alter erneut');
    renderManagerPersonData(doc, { ...profile, id: 'b', personDates: describePersonDates({ profile_aktuelles_alter: '64' }, 2026), values: { ...values, goldAktiv: false, healthBucket: { enabled: false } } });
    assert(!hosts.managerBirthSupplement.hidden && hosts.managerAssetsSummary.textContent.includes('aus') && hosts.managerCareSummary.textContent.includes('inaktiv'), 'Personenwechsel projiziert Datumslücke und Strategiezustände neu');
    assert(hosts.profilePersonDateStatus.textContent.includes('festes Altalter') && hosts.managerBirthSuggestion.textContent.includes('1961'), 'Fallback bleibt mit reinem Jahresvorschlag sichtbar');
    renderManagerPersonData(doc, { id: 'corrupt', name: 'Unvollständige Person', valid: false });
    assert(hosts.profileAlter.value === '' && hosts.managerBirthSupplement.hidden && hosts.profilePersonDateStatus.textContent.includes('unvollständig'), 'Ungültiger Personenwechsel hinterlässt keine fremden Kalenderhinweise');
}

{
    const nodes = Object.fromEntries(['profileGenderStatus', 'profileGenderConfirm', 'managerRenteHelp', 'managerBirthSupplement', 'managerBirthDate'].map(id => [id, { textContent: '', hidden: false, dataset: {} }]));
    const tax = { hidden: false }, doc = { getElementById: id => nodes[id], querySelector: () => tax };
    const profile = { id: 'a', name: 'Muster A', valid: true, householdRole: 'Hauptprofil im Haushalt', currentIncome: { status: 'im Monat', pensionStatus: '' }, values: {
        genderAssumed: true, renteAktiv: true, renteMonatlich: 1000, kirchensteuerPct: 0, tagesgeld: 0, goldAktiv: false }, personDates: { birthMissing: true } };
    renderManagerPersonData(doc, profile);
    assert(nodes.profileGenderStatus.textContent.includes('bitte prüfen'), 'Angenommenes Geschlecht zeigt bitte prüfen');
    assert(!nodes.profileGenderConfirm.hidden, 'Auch derselbe wirksame Wert kann bewusst bestätigt werden');
    assert(tax.hidden, 'Steuerquote ist im Hauptprofilkontext verborgen');
    assert(!nodes.managerBirthSupplement.hidden, 'Aktuelles Profil ohne Geburtstag zeigt Ergänzungsband');
    renderManagerPersonData(doc, { ...profile, householdRole: 'Partnerprofil', values: { ...profile.values, genderAssumed: false } });
    assertEqual(nodes.profileGenderStatus.textContent, '', 'Explizites m zeigt keine Herkunftswarnung');
    assert(!tax.hidden, 'Steuerquote bleibt beim wirksamen Partner sichtbar');
}

// Ein einziger alltagssprachlicher Kalenderhinweis unter Rentenbeginn.
{
    const { describePersonDates } = await import('../app/profile/profile-person-data.js');
    const nodes = Object.fromEntries(['managerPensionStatus', 'managerRenteHelp'].map(id => [id, { textContent: '' }]));
    const doc = { getElementById: id => nodes[id] };
    for (const monthly of [0, 1000]) {
        renderManagerPersonData(doc, { valid: true, currentIncome: { status: 'im Monat', pensionStatus: monthly ? 'Ohne Rentenbeginn zählt die Rente als bereits laufend. Läuft sie noch nicht, bitte Beginn eintragen.' : '' }, values: { renteMonatlich: monthly }, personDates: describePersonDates({ profile_rente_monatlich: String(monthly) }, 2026) });
        assertEqual(nodes.managerPensionStatus.textContent, monthly ? 'Ohne Rentenbeginn zählt die Rente als bereits laufend. Läuft sie noch nicht, bitte Beginn eintragen.' : '', 'Fehlender Beginn zeigt genau den vorgegebenen Text oder keinen Hinweis');
        assertEqual(nodes.managerRenteHelp.textContent, '', 'Unter Rentenanpassung wird kein zweiter Rentenstatus erzeugt');
    }
    for (const [year, expected] of [[2026, 'Rente ab 01.07.2028'], [2028, 'Rente läuft seit 01.07.2028'], [2029, 'Rente läuft seit 01.07.2028']]) {
        renderManagerPersonData(doc, { valid: true, currentIncome: { status: year < 2028 ? 'ab 01.07.2028' : 'im Monat', pensionStatus: expected }, values: { renteMonatlich: 1000 }, personDates: describePersonDates({ profile_rentenbeginn: '2028-07-01' }, year) });
        assertEqual(nodes.managerPensionStatus.textContent, expected, 'Kalendertext für ' + year);
        assertEqual(nodes.managerRenteHelp.textContent, '', 'Datierter Rentenbeginn bleibt ein einzelner Hinweis');
    }
}

// Produktionsprojektion: Karten und geschlossene Details zeigen heute, Wertträger Januar.
{
    const { projectManagerProfiles } = await import('../app/tranches/tranchen-manager-profiles.js');
    const { getAppTestDate, setAppTestDate } = await import('../app/shared/app-clock.js');
    const previous = getAppTestDate();
    try {
        setAppTestDate('2026-10-09');
        const registry = { profiles: Object.fromEntries([
            ['a', '1962-06-02'], ['b', '1965-06-28'], ['j', '1962-01-01']
        ].map(([id, birth]) => [id, { meta: { name: id }, data: { profile_geburtsdatum: birth, profile_rente_monatlich: '1000' } }])) };
        const raw = JSON.stringify(registry);
        const projection = projectManagerProfiles(registry, 'a');
        const hosts = Object.fromEntries(['managerHousehold', 'managerPageTitle', 'managerSectionNav', 'managerPersonSummary', 'profilePersonDateStatus', 'profileAlter'].map(id => [id, { innerHTML: '', textContent: '', value: '', dataset: {} }]));
        const doc = { getElementById: id => hosts[id] };
        const before = JSON.stringify(projection);
        renderManagerProfiles(doc, projection);
        assert(hosts.managerHousehold.innerHTML.includes('geb. 02.06.1962 · 64 Jahre') && hosts.managerHousehold.innerHTML.includes('geb. 28.06.1965 · 61 Jahre'), 'Karten zeigen heutige Alter 64/61');
        assert(!hosts.managerHousehold.innerHTML.includes('Planung') && !hosts.managerHousehold.innerHTML.includes('Geburtstag am Stichtag'), 'Kartenkopf bleibt ohne zusätzlichen Planungshinweis');
        for (const [id, today, january] of [['a', 64, 63], ['b', 61, 60], ['j', 64, 64]]) {
            const person = projection.profiles.find(p => p.id === id);
            assert(person.valid, 'Produktionsprofil ist gültig');
            renderManagerPersonData(doc, person);
            assert(hosts.managerPersonSummary.textContent.includes(`${today} Jahre`), 'Geschlossene Zusammenfassung zeigt heutiges Alter');
            assertEqual(person.values.alter, january, 'values.alter bleibt Planungswert');
            assertEqual(hosts.profileAlter.value, january, 'Verborgenes profileAlter bleibt Planungswert');
            assert(hosts.profilePersonDateStatus.textContent.includes(`Planung 2026 zählt das Alter am 01.01.: ${january} Jahre`) && hosts.profilePersonDateStatus.textContent.includes(`Planung 2027: ${january + 1}`), 'Detail erklärt Januarregel und Folgeplanung');
        }
        assertEqual(JSON.stringify(projection), before, 'Rendering lässt alle Eingangsobjekte unverändert');
        assertEqual(JSON.stringify(registry), raw, 'Projektion und Rendering erhalten sämtliche Speicherrohwerte');
    } finally { setAppTestDate(previous); }
}
