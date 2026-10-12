import { renderOverviewPersistenceRecovery } from '../app/overview/overview-renderer.js';
import vm from 'node:vm';
import fs from 'node:fs';
import { readSources, createPresentationTestDocument, rules, contrast } from './designsystem-source-contract.mjs';
import { createTauriJsonFileAdapter } from '../app/shared/persistence-adapter-tauri.js';
import { PERSON_VALUE_KEYS } from '../app/profile/profile-person-data.js';
import { personDataCsvFields } from '../app/simulator/simulator-person-overrides.js';
const sources = readSources();
const index = sources['index.html'];
const handbook = sources['Handbuch.html'];
const renderer = sources['app/overview/overview-renderer.js'];
function render(warning) {
    const document = createPresentationTestDocument();
    const host = document.createElement('div'); host.id = 'overviewPersistenceRecovery'; document.body.appendChild(host);

    const status = { migrationWarning: warning };
    const banner = renderOverviewPersistenceRecovery(document, warning);
    return { document, status, host, banner };
}
const warning = { code: 'tauri-state-corrupt', message: 'Synthetischer Speicherfehler', quarantinePath: 'synthetic-quarantine.json' };
const view = render(warning);
assert(view.banner.className.includes('ds-note-warning'), 'I10: Quarantänehinweis verwendet gemeinsame Warnrolle');
assertEqual(view.host.children[0], view.banner, 'I10: Recovery steht im oberen Host außerhalb der Sicherungskarte');
assertEqual(view.banner.children[0].textContent, 'Speicher-Wiederherstellung (Recovery-Modus)', 'I10: vorhandener Recoverytitel bleibt');
assertEqual(view.banner.children[1].textContent, 'Synthetischer Speicherfehler (Sicherungsdatei unter: synthetic-quarantine.json)', 'I10: Quarantänehinweis wird vollständig dargestellt');
const [importButton, dismissButton] = view.banner.children[2].children;
assert(importButton.className.split(' ').includes('profile-button') && dismissButton.className.split(' ').includes('secondary'), 'I10: ursprüngliche Klassenanker bleiben');
importButton.click();
const recoveryLink = view.document.nodes.at(-1);
assertEqual(recoveryLink.clickCount, 1, 'I10: Recoveryimport klickt einen echten zentralen Zielverweis');
assertEqual(recoveryLink.getAttribute('href'), 'Daten-Sicherung.html#fullBackupImportBtn', 'I10: Ziel ist der zentrale Sicherungsimport');
assert(recoveryLink.hasAttribute('data-profile-handoff') && recoveryLink.getAttribute('data-profile-handoff-export') === 'false', 'I10: Recoveryimport behält geschützten Handoff ohne kaputten Export');
assertEqual(recoveryLink.parentNode, null, 'I10: Recoveryimport benötigt keinen entfernten DOM-Anker');
dismissButton.click();
assertEqual(view.banner.style.display, 'none', 'I10: Schließen verbirgt nur den aktuellen Banner');
assert(view.status.migrationWarning === warning, 'I10: Schließen ändert keinen Backendwarnstatus');
assert(render(warning).banner.style.display !== 'none', 'I10: neue Sitzung zeigt die bestehende Warnung erneut');
assert(!render(null).banner, 'I10: ohne Backendwarnung kein Recoverybanner');
assertEqual(render({ message: 'Warnung ohne Pfad' }).banner.children[1].textContent, 'Warnung ohne Pfad', 'I10: optionaler Quarantänepfad erzeugt keinen Leerzusatz');
for (const id of ['overviewHousehold', 'overviewPersistenceRecovery', 'overviewProfileRecovery', 'fullBackupStatus']) assert(index.includes(`id="${id}"`), `Übersichtsanker ${id}`);
for (const path of ['index.html', 'depot-tranchen-manager.html', 'Ausgaben.html', 'Balance.html', 'Simulator.html', 'Handbuch.html']) {
    const source = fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    const appText = source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
    assert(!/persistenceBackupInfo|Speicher:|gespeicherte Eintr(?:ae|ä)ge:|IndexedDB|localStorage|Tauri JSON File|ruhestand_suite_(?:data|snapshots)\.json/.test(appText),
        path + ': keine Speicher-/Backup-Technikangaben im normalen App-Text');
}
const overviewMain = fs.readFileSync(new URL('../app/overview/overview-main.js', import.meta.url), 'utf8');
const backupSource = fs.readFileSync(new URL('../app/shared/persistence-backup.js', import.meta.url), 'utf8');
assert(!overviewMain.includes('renderPersistenceBackupInfo') && !/getPersistenceBackupInfo|renderPersistenceBackupInfo/.test(backupSource), 'Ungenutzter Übersichtsrenderer und Infohelfer sind entfernt');
assert(handbook.includes('Daten-Sicherung.html#dataStorageTitle'), 'Handbuch verweist für Speichertechnik auf Daten & Sicherung');
const suiteHeader = index.match(/<header class="suite-header">([\s\S]*?)<\/header>/)?.[1] || '';
assertEqual((index.match(/id="probelaufStart"/g) || []).length, 1, 'Probelauf besitzt genau einen Startzugang');
assert(/<button\b[^>]*id="probelaufStart"[^>]*disabled[^>]*>Probelauf …<\/button>/.test(suiteHeader)
    && suiteHeader.indexOf('id="probelaufStart"') > suiteHeader.indexOf('id="suiteProfileContext"'),
    'Probelauf startet nach sicherer Initialisierung rechts vom Profilkontext in der Kopfzeile');
assert(!index.includes('id="overviewTrial"') && !index.includes('id="probelaufControls"'), 'Entfernte Probelaufkarte erhält keine Ersatzhosts');
const statusPosition = index.indexOf('id="probelaufStatus"');
assert(statusPosition > index.indexOf('</header>') && statusPosition < index.indexOf('<main class="suite-content"')
    && index.includes('id="probelaufStatus" class="suite-probelauf-status" role="status" aria-live="polite" hidden'),
    'Probelaufstatus bleibt außerhalb eingeklappter Inhaltscontainer am Kopfzugang erreichbar');
assert(!index.includes('app-card') && !index.includes('profileAdvanced'), 'Übersicht besitzt echte Ersatzorte ohne Alt-/Dummyfelder');
for (const id of ['inhaltsverzeichnis', 'quickstart', 'manual', 'ueberblick', 'installation-start', 'datensicherheit', 'profilverbund', 'simulator', 'balance-app', 'faq', 'glossar', 'anhang']) assert(handbook.includes(`id="${id}"`), `Handbuchanker ${id}`);
for (const image of ['system_overview', 'engine_pipeline', 'monte_carlo_workers', 'diagnose_panel_mock', 'kapitalfluss_mock', 'profilverbund_aggregation']) assert(handbook.includes(`src="assets/images/${image}.svg"`), `Vorhandene Handbuchabbildung ${image}`);
assert(handbook.includes('function switchTab(tabId)') && handbook.includes('function setupTocNavigation()'), 'Vorhandene Reiter- und TOC-Handler bleiben');
assert(handbook.includes("anchorElement.focus({ preventScroll: true })") && handbook.includes("history.replaceState(null, '', anchorId)"), 'TOC bewahrt Fokus- und Hashvertrag');
assert(handbook.includes('ds-tab') && handbook.includes('ds-card') && handbook.includes('ds-note-warning') && handbook.includes('ds-table'), 'Handbuch nutzt gemeinsame Reiter-, Karten-, Hinweis- und Tabellenrollen');
const browser = fs.readFileSync(new URL('./browser-smoke.test.mjs', import.meta.url), 'utf8');
assert(browser.includes("['Designsystem recovery banner', runDesignsystemRecoveryBanner]"), 'I10: Browserfall ist registriert');
assert(browser.includes("['Handbuch.html', runManualSmoke]"), 'Handbuch: Browserfall ist registriert');
assert(browser.includes("['Suite frame navigation replacement', runSuiteFrameNavigationReplacement]"), 'Endgültige Rückwege, Hilfe, Karten und Handbuch-TOC: Browserfall ist registriert');
assert(index.includes('href="Handbuch.html" data-profile-handoff'), 'I06: Handbuch bleibt über den geschützten Rahmenlink erreichbar');
assert(!/class="(?:navbar|nav-brand|back-link)"/.test(handbook) && handbook.includes('class="suite-navigation"'), 'H01: Rahmen ersetzt die alte Handbuchnavigation');

// Die tatsächliche Browserfixture bildet das Entfernen der defekten Datei ab;
// nach Quarantäne müssen normale Schreibvorgänge ohne künstlichen Dauerfehler gehen.
const fixtureBegin = browser.indexOf('    await page.addInitScript(() => {', browser.indexOf('async function runDesignsystemRecoveryBanner('));
const fixtureEnd = browser.indexOf('\n    });', fixtureBegin);
const fixture = browser.slice(fixtureBegin + '    await page.addInitScript(() => {'.length, fixtureEnd);
const fixtureWindow = {};
vm.runInNewContext(fixture, { window: fixtureWindow });
const adapter = createTauriJsonFileAdapter({ invoke: fixtureWindow.__TAURI__.core.invoke });
let corrupt;
try { await adapter.open(); } catch (error) { corrupt = error; }
assertEqual(corrupt?.code, 'tauri-state-corrupt', 'I10: Browserfixture löst echten Adapter-Recoveryfehler aus');
assertEqual(corrupt?.quarantinePath, 'synthetic-quarantine.json', 'I10: Browserfixture liefert Quarantänepfad');
await adapter.open();
assertEqual(Object.keys(await adapter.loadAll()).length, 0, 'I10: nach Quarantäne liegt leerer Backendzustand vor');
await adapter.saveBatch({ deletes: [], upserts: [['synthetic-test-key', 'fixture-value']] });
const reopened = createTauriJsonFileAdapter({ invoke: fixtureWindow.__TAURI__.core.invoke });
await reopened.open();
assertEqual((await reopened.loadAll())['synthetic-test-key'], 'fixture-value', 'I10: Browserfixture bewahrt normales Schreiben nach Quarantäne');
assertEqual(fixtureWindow.__recoveryCommands.filter(command => command === 'quarantine_app_state').length, 1, 'I10: kein künstlich wiederholter Quarantänefehler im selben Seitenstart');

// Der erhaltene Altanker erläutert den Wegfall, verspricht keinen CSV-Button.
const marketChapter = handbook.slice(handbook.indexOf('id="balance-marktdaten-csv"'), handbook.indexOf('id="balance-snapshots"'));
assert(marketChapter.includes('historische CSV-Provenienz') && marketChapter.includes('sind aus Balance entfernt'), 'Handbuch beschreibt historische Markt-CSV als Kompatibilität bei erhaltenem Anker');
assert(!marketChapter.includes('Der CSV-Button') && !handbook.includes('„🗓️ Nachr.“'), 'Handbuch verspricht keine entfernten Markt-CSV-/Nachrückenknöpfe');
assert(handbook.includes('Alt+N entfällt') && handbook.includes('Alt+J') && handbook.includes('Alt+I') && handbook.includes('Alt+E'), 'Handbuch nennt aktive Kürzel und den Wegfall von Alt+N');
assert(!handbook.includes('„Auswertung“ ist der vierte Haupttab') && !handbook.includes('Diagnose-Drawer'), 'Handbuch beschreibt vier Balance-Reiter und den Diagnosereiter');
const expensesChapter = handbook.slice(handbook.indexOf('id="ausgaben"'), handbook.indexOf('id="balance-jahresupdate-guide"'));
assert(expensesChapter.includes('id="balance-ausgaben-check"') && expensesChapter.includes('Ausgaben.html'), 'AU1: Eigenständiges Handbuchkapitel erhält den alten Ausgabenanker und den neuen Seitenweg');
assert(handbook.includes('data-tab-target="manual" href="#ausgaben">Ausgaben</a>') && expensesChapter.includes('übernommenen Jahresbeleg'), 'AU1: Handbuch-TOC und Budgetherkunft verweisen auf das eigenständige Ausgabenkapitel');

assert(handbook.includes('Mit diesem Kurs erneut abschließen') && handbook.includes('Während Commit, Finalisierung und Restore'), 'Handbuch erhält Handkursretry und geschützten Jahresabschluss');
assert(handbook.includes('Historisches Layoutmockup') && handbook.includes('alle Planbeträge centgenau'), 'Historische Abbildungen und centgenaue Handlungsplan-Kopie sind eingeordnet');

// Ersatzorte bleiben trotz Erststart und ohne historische Budgetdaten erreichbar.
for (const id of ['overviewWelcome', 'overviewWelcomeImport', 'overviewNormal', 'overviewYearBand', 'overviewYearChart', 'overviewYearMetrics']) {
    assert(index.includes(`id="${id}"`), 'Jahresband-/Erststartanker ' + id);
}
assert(index.indexOf('id="kursdetails"') < index.indexOf('<header class="overview-heading ds-page-head">'), 'I14: eindeutiger Statushost liegt im Kursaufklappfeld am Kopf');
assertEqual((index.match(/id="startupPriceStatus"/g) || []).length, 1, 'I14: Kursstatushost wird nicht dupliziert');
assert(!/<details id="kursdetails"[^>]*\bopen\b/.test(index) && index.includes('Kursdetails schließen'), 'I14: geschlossenes Kursfeld besitzt sichtbaren nativen Schließweg nach Öffnung');
assert(index.includes('href="depot-tranchen-manager.html#personen"') && !index.includes('Demo ansehen'), 'Eigene Daten öffnen vorhandenen Personendialog ohne Demo');
assert(renderer.includes("openOverviewBackupTarget(doc, '#fullBackupImportBtn')"), 'Erststart verwendet denselben Sicherungsimport');
const readDoc = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const concept = readDoc('docs/design/umsetzungskonzept.md');
assert(concept.includes('6.3 ist im Quellenstand umgesetzt') && concept.includes('6.2a bleibt ein')
    && concept.includes('6.2 bleibt vorerst eine geschlossene Karte'), 'Dokumentation trennt Übersicht, temporäre Sicherungskarte und Archivpaket');
for (const path of ['README.md', 'docs/reference/TRANCHEN_MODULES_README.md']) {
    assert(!readDoc(path).includes('Profile > Erweitert'), path + ': Sicherung verweist auf vorhandenen Ersatzort');
}
for (const key of ['overview_balance_summary_v1', 'overview_month_provision_v1', 'overview_last_full_backup_v1']) {
    assert(concept.includes(key) && readDoc('README.md').includes(key), 'Übersichtsschlüssel dokumentiert: ' + key);
}
assert(concept.includes('01–06/08 bei 1920 und 2560 px') && concept.includes('Nutzerprüfung der Kandidaten-EXE vor lokalem'), 'Externe Bild- und EXE-Gates bleiben dokumentiert');

// Der dokumentierte Pflegeweg muss die tatsächliche Speicher-/Kalendergrenze erklären.
const chapter = id => {
    const start = handbook.indexOf(`id="${id}"`);
    assert(start >= 0, 'Handbuchkapitel existiert: #' + id);
    return handbook.slice(start).split('<div class="detail-block"')[0];
};
const personChapter = chapter('profilverbund-personendaten');
assert(personChapter.includes('Personendaten einmal zentral pflegen')
    && personChapter.includes('Abbrechen oder Escape') && personChapter.includes('fachlichen Rohwerte')
    && personChapter.includes('67 Jahre am 01.01.2026') && personChapter.includes('01.01.2027'),
    'P10: Handbuch erklärt zentrale Pflege, Abbruch und Januarregel');
assert(personChapter.includes('Tag oder Monat') && personChapter.includes('Sitzung')
    && personChapter.includes('jahresbezogen ohne anteilige Monatskürzung'),
    'P10: Handbuch erfindet kein Datum und erklärt Sitzungs- und Rentengrenze');
assert(handbook.includes('href="#profilverbund-personendaten"')
    && handbook.includes('In Personen &amp; Vermögen ändern')
    && handbook.includes('Für diese Rechnung abweichend ansetzen'),
    'P10: Handbuchanker und Bedienungsnamen entsprechen dem zentralen Workflow');
const simulatorChapter = chapter('simulator-renten');
assert(simulatorChapter.includes('schreibfreie Liste')
    && simulatorChapter.includes('Ausschalten, Profilwechsel, Zurücksetzen oder Seitenreload')
    && simulatorChapter.includes('beim Lauf verwendeten Werte') && simulatorChapter.includes('JSON-/CSV-Downloads'),
    'P10: Handbuch erklärt flüchtige Alternativen und eingefrorene Downloads');
const scenarioChapter = chapter('simulator-szenario-log');
const answerChapter = chapter('simulator-ergebnisse');
assert(answerChapter.includes('Ist mein Grundbedarf gedeckt?') && answerChapter.includes('Muss ich mich einschränken?')
    && answerChapter.includes('Zeitraumende ist kein nachgewiesenes Lebensende')
    && answerChapter.includes('Anteil') && answerChapter.includes('abgeschlossener Entnahmejahre')
    && answerChapter.includes('endlicher Kürzungsentscheidung') && answerChapter.includes('frei planbare Ausgaben')
    && answerChapter.includes('beide bestehenden p50-Werte') && answerChapter.includes('Annahmen seitdem geändert'),
    'P16: Ergebniskapitel erklärt Kernantworten, bestehende Mediane und Veraltetstatus');
assert(scenarioChapter.includes('„Detailliert“') && scenarioChapter.includes('„Pflege-Spalten“')
    && scenarioChapter.includes('nie im Backtest') && scenarioChapter.includes('ausschließlich im vollständigen Export'),
    'P16: Protokollkapitel erklärt echte Schalter und exportexklusive Rechenspuren');
assert(scenarioChapter.includes('Finanzannahmen des abgeschlossenen Laufs samt dessen Personenbeleg')
    && scenarioChapter.includes('JSON herunterladen') && scenarioChapter.includes('CSV herunterladen'),
    'P10: Szenario-Log erklärt Finanzannahmen und Personenbeleg des abgeschlossenen Laufs');
const annualChapter = chapter('balance-jahresupdate');
const snapshotChapter = chapter('balance-snapshots');
assert(annualChapter.includes('erhöht kein gespeichertes Alter') && annualChapter.includes('Altalter')
    && snapshotChapter.includes('gesamte Profilregistry einschließlich Außenprofilen')
    && snapshotChapter.includes('geschützten Reload'),
    'P10: Handbuch erklärt Jahresabschluss ohne Alterswrite und vollständigen Restore');

const technical = readDoc('docs/reference/TECHNICAL.md');
for (const key of Object.values(PERSON_VALUE_KEYS)) {
    assert(technical.includes('`' + key + '`'), 'P10: technische Referenz enthält tatsächlichen Personenschlüssel ' + key);
}
const csvFields = personDataCsvFields({ schemaVersion: 1, referenceYear: 2026,
    ageRule: 'january-1-completed-years', deviationApplied: false,
    persons: [{ profileId: 'synthetisch-a', role: 'primary', changes: [] }] });
for (const path of ['README.md', 'docs/reference/TECHNICAL.md', 'docs/reference/SIMULATOR_MODULES_README.md']) {
    const doc = readDoc(path);
    for (const field of Object.keys(csvFields)) assert(doc.includes('`' + field + '`'), path + ': tatsächliches additives CSV-Feld ' + field);
    assert(doc.includes('personDataContext') && /(?:eingefroren|Laufbeleg)/.test(doc), path + ': Personenbeleg bleibt laufgebunden');
}
for (const path of ['Handbuch.html', 'README.md', 'docs/reference/TECHNICAL.md',
    'docs/reference/BALANCE_MODULES_README.md', 'docs/reference/PROFILVERBUND_FEATURES.md',
    'docs/reference/SIMULATOR_MODULES_README.md', 'docs/reference/TRANCHEN_MODULES_README.md']) {
    const doc = readDoc(path);
    assert(!doc.includes('die Altersfortschreibung schreibt')
        && !doc.includes('Anpassung und merkt sich den Aktivierungsstatus im `localStorage`')
        && !doc.includes('liest/migriert Rentenfelder')
        && !doc.includes('danach werden Inflation, Alter, Ausgabenjahr')
        && !doc.includes('Automatische Fortschreibung:</strong> Alter'), path + ': keine alte Personenpersistenz oder Altersfortschreibung zugesagt');
}

const simulatorInputs = chapter('simulator-eingaben');
assert(simulatorInputs.includes('Monte-Carlo neu rechnen') && simulatorInputs.includes('Einstellungen anzeigen') && simulatorInputs.includes('Erweitert'), 'P16: Handbuch erklärt Kopfstart und geschlossene technische Optionen');
assert(!simulatorInputs.includes('Aktivierung, Dauer, Monatsrate'), 'P16: Handbuch verspricht keine Ansparbedienung');


const monthChapter = chapter('monatsabschluss');
assert(monthChapter.includes('Abschluss starten') && monthChapter.includes('vier Schritte')
    && monthChapter.includes('Alles gespeichert') && monthChapter.includes('Fertig')
    && monthChapter.includes('Erneut versuchen'), 'Monatskapitel erklärt echten Dialog, Ergebnis und Retry');
assert(monthChapter.includes('Bleiben') && monthChapter.includes('Verwerfen')
    && monthChapter.includes('nur ungespeichertes Tagesgeld') && monthChapter.includes('Vermögenspunkte bleiben erhalten')
    && monthChapter.includes('Jahresabschluss'), 'Monatskapitel erklärt Importpersistenz, Cashentwurf und erhaltenen Jahresweg');

assert(monthChapter.includes('Tagesgeld &lt;Name&gt;') && !monthChapter.includes('Tagesgeld-Stand jetzt'), 'Abschlusskapitel beschreibt die sichtbaren Personenlabels');

// Lokale Quellprüfung: Kommalisten getrennt und Reihenfolge gegen die realen Kopfregeln.
const splitRules = (path, source) => rules(path, source).flatMap((rule, order) =>
    rule.selector.split(',').map(selector => ({ ...rule, selector: selector.trim(), order })));
function validateAnnualCascade(source) {
    const errors = [];
    const entries = splitRules('css/overview.css', source);
    const badge = entries.find(rule => rule.selector.includes('.overview-year-badge'));
    const chip = entries.find(rule => rule.selector === '.overview-year-step > b');
    const general = entries.find(rule => rule.selector === '.overview-focus-top .ds-badge');
    const warning = entries.find(rule => rule.selector === '.is-annual .overview-focus-top .ds-badge');
    // Diese relevanten Selektoren enthalten ausschließlich Klassen und Nachfahrenkombinatoren.
    const specificity = selector => /^\.[\w-]+(?:\s+\.[\w-]+)*$/.test(selector)
        ? (selector.match(/\.[\w-]+/g) || []).length : -1;
    for (const competitor of [general, warning]) {
        if (!badge || !competitor || specificity(badge.selector) < specificity(competitor.selector)) errors.push('Jahrespille: Spezifität');
        else if (specificity(badge.selector) === specificity(competitor.selector) && badge.order <= competitor.order) errors.push('Jahrespille: Reihenfolge');
    }
    for (const [role, rule] of [['Jahrespille', badge], ['Jahreschip', chip]]) {
        for (const [property, value] of [['color', 'var(--year)'], ['background', 'var(--year-soft)'], ['border-color', 'var(--year)']]) {
            if (rule?.declarations[property] !== value) errors.push(`${role}: ${property}`);
        }
    }
    if (warning?.declarations.color !== 'var(--warn)' || warning?.declarations.background !== 'var(--warn-soft)') errors.push('Diagnose: Warnrolle');
    return errors;
}
function validateAnnualTokens(source) {
    const errors = [];
    const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
    // Nur ein unbedingter :root-Block zählt als Basis; Medienblöcke werden nicht zusammengefasst.
    const baseBlocks = [...clean.matchAll(/:root\s*\{([^{}]*)\}/g)].filter(match => {
        const prefix = clean.slice(0, match.index);
        return prefix.slice(Math.max(prefix.lastIndexOf('{'), prefix.lastIndexOf('}')) + 1).trim() === ''
            && (prefix.match(/\{/g) || []).length === (prefix.match(/\}/g) || []).length;
    });
    if (baseBlocks.length !== 1) errors.push('Jahrestokens: unbedingte Basis');
    const base = Object.fromEntries([...((baseBlocks[0]?.[1] || '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g))]
        .map(match => [match[1], match[2].trim()]));
    for (const [name, expected] of [['--year', '#3f5a7a'], ['--year-soft', '#e5ecf4']]) {
        if ([...clean.matchAll(new RegExp(`${name}\\s*:`, 'g'))].length !== 1) errors.push(`Jahrestokens: ${name} genau einmal`);
        if (base[name] !== expected) errors.push(`Jahrestokens: ${name} Basiswert`);
    }
    for (const background of ['--surface', '--year-soft']) {
        if (!/^#[\da-f]{6}$/i.test(base['--year'] || '') || !/^#[\da-f]{6}$/i.test(base[background] || '')
            || contrast(base['--year'], base[background]) < 4.5) errors.push(`Jahreskontrast: ${background}`);
    }
    return errors;
}
const overviewCss = sources['css/overview.css'];
const tokenCss = sources['css/tokens.css'];
assertEqual(validateAnnualCascade(overviewCss).join('\n'), '', 'Jahrespille gewinnt die reale Kopfkaskade; Jahresschritte und Diagnose verwenden ihre Rollen');
assertEqual(validateAnnualTokens(tokenCss).join('\n'), '', 'Unbedingte zentrale Jahreswerte erreichen auf beiden Flächen mindestens 4,5:1');
const annualBadgeSelector = '.is-annual .overview-focus-top .overview-year-badge';
assert(splitRules('css/overview.css', overviewCss).some(rule => rule.selector === annualBadgeSelector), 'Jahrespille besitzt die drei vorgesehenen Klassenanker');
assert(renderer.includes("(annual && occasion.annualState === 'open' ? ' overview-year-badge' : '')")
    && (renderer.match(/overview-year-badge/g) || []).length === 1, 'Nur der offene Jahreszustand erhält die Jahrespillenklasse');
const componentRules = splitRules('css/components.css', sources['css/components.css']);
for (const selector of ['.close-dialog-year', '#balanceAnnualClose .close-dialog-group']) {
    assert(componentRules.some(rule => rule.selector === selector && rule.declarations.color === 'var(--year)'), selector + ': zentrale Jahresfarbe');
}
assert(componentRules.some(rule => rule.selector === '.close-dialog' && rule.declarations.background === 'var(--surface)'), 'Jahresdialog verwendet die zentrale Fläche');
function rejectAnnual(source, mutate, validate, expected, label) {
    const mutated = mutate(source);
    assert(mutated !== source, label + ': echte flüchtige Gegenprobe');
    assert(validate(mutated).includes(expected), label + ': gezielte Ablehnung');
}
rejectAnnual(overviewCss, s => s.replace(annualBadgeSelector, '.overview-year-badge'), validateAnnualCascade,
    'Jahrespille: Spezifität', 'Abgeschwächte Pillenspezifität');
rejectAnnual(overviewCss, s => {
    const yearRule = s.match(/\.is-annual \.overview-focus-top \.overview-year-badge,[^{}]+\{[^{}]*\}/)[0];
    return s.replace(yearRule, '').replace('.is-annual .overview-focus-top .ds-badge {', yearRule + '\n.is-annual .overview-focus-top .ds-badge {');
}, validateAnnualCascade, 'Jahrespille: Reihenfolge', 'Gleich spezifische Jahresregel vor Warnregel');
for (const [property, value] of [['color', 'var(--year)'], ['background', 'var(--year-soft)'], ['border-color', 'var(--year)']]) {
    rejectAnnual(overviewCss, s => s.replace(/(\.is-annual \.overview-focus-top \.overview-year-badge,[^{}]+\{)([^{}]*)\}/,
        (_, head, body) => head + body.replace(`${property}: ${value}`, `${property}: var(--warn)`) + '}'),
    validateAnnualCascade, `Jahrespille: ${property}`, 'Verfälschte Jahresdeklaration ' + property);
}
for (const [block, label] of [
    ['@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --year: #9db8d8; --year-soft: #1f2a36; } }', 'Dunkler Medienblock'],
    [':root[data-theme="dark"] { --year: #9db8d8; --year-soft: #1f2a36; }', 'Dunkler Attributblock']
]) rejectAnnual(tokenCss, s => s + '\n' + block, validateAnnualTokens, 'Jahrestokens: --year genau einmal', label);
rejectAnnual(tokenCss, s => '@media (prefers-color-scheme: dark) {\n' + s + '\n}', validateAnnualTokens,
    'Jahrestokens: unbedingte Basis', 'Nur bedingte Basis statt unbedingter Rollen');
rejectAnnual(tokenCss, s => s.replace(':root {', '.probe :root {'), validateAnnualTokens,
    'Jahrestokens: unbedingte Basis', 'Qualifizierter Selektor statt zentraler Basis');
rejectAnnual(tokenCss, s => s.replace('--year: #3f5a7a;', '--year: #9db8d8;'), validateAnnualTokens,
    'Jahreskontrast: --surface', 'Kontrastschwache Basistextfarbe');
