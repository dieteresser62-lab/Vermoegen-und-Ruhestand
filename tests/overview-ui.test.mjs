import fs from 'node:fs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { bindProbelaufUI, renderProbelaufUI } from '../app/shared/probelauf-ui.js';
import { createPresentationTestDocument, rules } from './designsystem-source-contract.mjs';
import { renderOverview, bindOverviewBackupTargets, renderOverviewExampleActions } from '../app/overview/overview-renderer.js';
import { EXAMPLE_EXPENSES_ICON_HTML } from '../app/shared/designsystem-icons.js';
import { projectOverviewMonthSteps } from '../app/overview/overview-month-confirmation.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { deriveOverviewOccasion, projectOverview, projectOverviewWealth } from '../app/overview/overview-model.js';
import { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { formatDisplayNumber } from '../app/shared/designsystem-number-format.js';
import { functionSource } from './designsystem-selection-dom.mjs';
import { createBalancePageFixture } from './helpers/balance-page-fixture.mjs';
import { annualServiceFixture } from './helpers/balance-storage-fixtures.mjs';
import { initializeProfilePage } from '../app/profile/profile-navigation.js';
import { PersistenceFacade, persistenceStorage } from '../app/shared/persistence-facade.js';
import { addDirectHouseholdPlans } from '../app/profile/household-plan-migration.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { summaryEntryKey, OVERVIEW_SUMMARY_KEY } from '../app/overview/overview-storage.js';
import { getAppTestDate, setAppTestDate } from '../app/shared/app-clock.js';
import { completedComparisonFixture } from './household-plan-comparison.test.mjs?fixture';
import { ANNUAL_PLAN_RECORD_KEY } from '../app/profile/annual-plan-record.js';

// Zeilenlokale Inhaltsprüfung: Texte im Lead oder Kartenfuß können fehlende
// Schritttitel und Monatsbeträge hier nicht verdecken.
function assertCloseStepContents(markup, model) {
    const decode = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'")
        .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
    const rows = [...markup.matchAll(/<div\b[^>]*data-overview-close-step="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)]
        .map(([, id, content]) => ({ id,
            title: decode(content.match(/<b>([^<]*)<\/b>/)?.[1] || ''),
            detail: decode(content.match(/<span class="overview-step-detail">([^<]*)<\/span>/)?.[1] || '') }));
    const projected = projectOverviewMonthSteps(model);
    const annual = model.occasion.kind === 'annual';
    const expected = annual ? [...projected.slice(0, 3),
        { id: 'cash', title: 'Tagesgeld' }, { id: 'market', title: 'Marktdaten' },
        { id: 'plan', title: 'Plan ' + model.occasion.planningYear }, { id: 'month', title: 'Monatsbetrag' }] : projected;
    assertEqual(rows.length, expected.length, model.occasion.kind + ': jede Abschlusszeile vorhanden');
    for (const step of expected) {
        const label = model.occasion.kind + '/' + step.id;
        assertEqual(rows.filter(row => row.id === step.id).length, 1, label + ': genau eine Zeile');
        const row = rows.find(row => row.id === step.id);
        assertEqual(Boolean(step.title?.trim()) && !step.title.includes('undefined'), true, label + ': erwarteter Schrittname ist gültig');
        assertEqual(row.title, step.title, label + ': b-Element zeigt den vollständigen Schrittnamen');
        assertEqual(row.title.includes('undefined'), false, label + ': kein undefined im Titel');
        assertEqual(row.detail, step.result || 'Wird im Jahresdialog geprüft.', label + ': Detailtext bleibt in seiner Zeile erhalten');
        if (!annual && step.id === 'cash') {
            assertEqual(row.detail.includes(step.amountText), true, label + ': Monatsbetrag steht in der Tagesgeldzeile');
        }
    }
    return rows;
}

{
    const html = renderOverviewExampleActions({ expenses: { year: 2026, month: 12 }, members: [{ id: 'a', name: 'A & B' }] });
    assertEqual(html.split(EXAMPLE_EXPENSES_ICON_HTML).length - 1, 2, 'Startseitenbeispiele tragen dasselbe Kopiersymbol');
    assert(html.includes('ds-icon-button') && html.includes('<span>Beispiele für alle</span>'), 'Startseitenaktionen sind kompakt mit kurzem Sammelknopf');
    assert(html.includes('title="Beispielausgaben einspielen · Dezember 2026 · A &amp; B"')
        && html.includes('aria-label="Beispielausgaben einspielen · Dezember 2026 · alle Personen"'), 'Startseitentooltips nennen Abschlussmonat und Ziel mit sicherem Escaping');
    assert(renderOverviewExampleActions({ members: [{ id: 'a' }, { id: 'b' }] }).includes('Person auswählen'), 'Einzelaktion mit Haushalt kündigt die vorhandene Personenwahl an');
}
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assertEqual((html.match(/class="overview-pill"/g) || []).length, 4, 'Vier Kopfpillen');
assert(!html.match(/app-card|profileAdvanced|profileNameInput|⚖|📊|📖/), 'Keine alten Kacheln oder Dummyverwaltung');
assert(!html.includes('id="daten-sicherung"') && !html.includes('id="fullBackupBtn"') && !html.includes('id="fullBackupImportBtn"'), 'Keine entfernten Sicherungsanker auf der Startseite');
assert(!html.match(/<details id="kursdetails"[^>]*\bopen\b/), 'Kursaufklappfeld initial geschlossen');
assertEqual((html.match(/id="kursdetails"/g) || []).length, 1, 'Kursdetailhost bleibt eindeutig');
assertEqual((html.match(/id="startupPriceStatus"/g) || []).length, 1, 'Kursstatushost bleibt eindeutig');
assert(html.indexOf('id="kursdetails"') < html.indexOf('<header class="overview-heading ds-page-head">')
    && !html.includes('class="ds-card overview-details ds-startup-prices"'), 'Kursdetails liegen an der Kopfpille ohne untere Karte');
for (const card of ['overview-assets', 'overview-budget', 'overview-plan-metric']) {
    const section = html.match(new RegExp(`<section class="ds-card ${card}"[\\s\\S]*?<\\/section>`))[0];
    assert(section.indexOf('<h2') < section.indexOf('overview-metric-value')
        && section.indexOf('overview-metric-value') < section.indexOf('overview-metric-source')
        && section.indexOf('overview-metric-source') < section.indexOf('overview-card-link'), card + ': Titel, Hauptwert, Bezug und Navigation in gemeinsamer Reihenfolge');
    assert(section.match(/<a[^>]*class="overview-card-link[^>]*>[^<]+ →<\/a>/), card + ': Navigation endet mit Pfeil');
}
const doc = createPresentationTestDocument();
for (const id of [...html.matchAll(/id="(overview[^"]+|overviewTrial|probelaufControls|kursdetails)"/g)].map(m => m[1])) {
    const node = doc.createElement('div'); node.id = id; node.dataset = {}; node.focus = () => { doc.activeElement = node; }; doc.body.appendChild(node);
}
// Wie im Browser entfernt ein neuer Leadtext die Links des vorherigen Anlasses.
let leadText = '';
Object.defineProperty(doc.getElementById('overviewLead'), 'textContent', {
    get() { return leadText; },
    set(value) {
        leadText = String(value);
        this.innerHTML = leadText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }
});
const events = {}; const win = { location: { hash: '#fullBackupImportBtn' }, addEventListener: (name, fn) => { events[name] = fn; } };
let clickedTarget;
const createTarget = doc.createElement.bind(doc);
doc.createElement = tag => { const node = createTarget(tag); if (tag === 'a') node.click = () => { clickedTarget = node.getAttribute('href'); }; return node; };
bindOverviewBackupTargets(doc, win);
assertEqual(clickedTarget, 'Daten-Sicherung.html#fullBackupImportBtn', 'Alter Importanker erreicht zentrale Seite ohne entfernten Knopf');
const importLink = doc.nodes.at(-1);
assert(importLink.hasAttribute('data-profile-handoff') && importLink.getAttribute('data-profile-handoff-export') === 'false', 'Historischer Import verwendet geschützten lokalen Handoff');
assertEqual(importLink.parentNode, null, 'Kompatibilitätslink hinterlässt keinen versteckten Ersatzbereich');
win.location.hash = '#daten-sicherung'; events.hashchange();
assertEqual(clickedTarget, 'Daten-Sicherung.html#fullBackupBtn', 'Späterer Sicherungshash erreicht zentrale Seite');
doc.getElementById('overviewWelcomeImport').click();
assertEqual(clickedTarget, 'Daten-Sicherung.html#fullBackupImportBtn', 'Erststartimport funktioniert ohne alte Startseitenanker');
const dataHtml = fs.readFileSync(new URL('../Daten-Sicherung.html', import.meta.url), 'utf8');
assert(!dataHtml.includes('href="index.html#probelaufControls"'), 'Sicherungskarte verweist ausschließlich auf den Kopfzugang');
clickedTarget = null;
win.location.hash = '#probelaufControls'; events.hashchange();
assertEqual(doc.getElementById('overviewTrial'), null, 'Entfernte Steuerungszeile bleibt entfernt');
assertEqual(clickedTarget, null, 'Probelaufanker startet keine Sicherungsnavigation');
renderOverview(doc, { available: false, year: 2026, now: new Date(2026, 9, 6) });
assertEqual(doc.getElementById('overviewAssets').textContent, '—', 'Fehlender Bestand zeigt keinen Defaultwert');
assertEqual(doc.getElementById('overviewPlanStatus').textContent, '', 'Fehlende Summary löscht Status');
assertEqual(doc.getElementById('overviewPlanRows').hidden, true, 'Fehlende Summary blendet alle Planzeilen aus');
assertEqual(doc.getElementById('overviewPlanTitle').textContent, 'Dein Plan', 'Kartentitel bleibt ruhig');
assertEqual(doc.getElementById('overviewPricesValue').textContent, 'Kurszeit unbekannt', 'Kein Datum ohne Provenienz');
assert(doc.getElementById('overviewTitle').textContent.includes('Oktober'), 'Überschrift verwendet tatsächlichen Monat');
{
    const records = createMusterHaushaltRecords('2026-10-13');
    const view = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_active_profile,
        liveData: records, now: new Date(2026, 9, 13, 12) });
    const previousDate = getAppTestDate(), before = JSON.stringify(view);
    try {
        setAppTestDate('2026-10-13'); renderOverview(doc, view);
        assertEqual(doc.getElementById('overviewPricesValue').textContent, 'Testkurse, nicht echt', 'Kopfzeile kennzeichnet künstliche Kurse');
        assert(doc.getElementById('overviewQuoteDate').textContent.includes('Bestand am 13.10.2026 · Testkurse, nicht echt'), 'Vermögenskarte behält Bestandsdatum neben dem Testkurshinweis');
        assert(!doc.getElementById('overviewLead').textContent.includes('Kurse sind von heute'), 'Probelauflead behauptet keine echten heutigen Kurse');
        assertEqual(JSON.stringify(view), before, 'Testkursanzeige verändert keine Vermögens- oder Abschlusswerte');
    } finally { setAppTestDate(previousDate); }
}

for (const options of [{}, { adjusted: true }, { preview: 'missing' },
    { receipt: false }, { receipt: false, preview: 'stale' }, { receipt: false, preview: 'missing' }, { corruptReceipt: true }]) {
    const f = completedComparisonFixture(options);
    if (options.corruptReceipt) f.records[ANNUAL_PLAN_RECORD_KEY] = '{broken';
    const view = projectOverview({ registry: f.registry, activeId: 'z', liveData: f.records, now: f.now });
    const before = JSON.stringify(view);
    renderOverview(doc, view);
    const fixed = view.planComparison.recordStatus === 'valid';
    const provisional = !fixed && ['current', 'stale'].includes(view.planComparison.previewStatus);
    assertEqual(doc.getElementById('overviewBudgetTitle').textContent, provisional ? 'Vorläufiges Monatsbudget' : 'Monatsbudget', 'Vorläufigkeit steht direkt über dem Betrag');
    assertEqual(doc.getElementById('overviewBudgetValue').textContent, fixed ? moneyText(2000) : provisional ? moneyText(2100) : '—', 'Budgetkarte verwendet die passende Quelle ohne erfundenen Betrag');
    assertEqual(doc.getElementById('overviewPlanMetricValue').textContent, fixed ? 'Plan festgeschrieben' : options.corruptReceipt ? 'Planbeleg prüfen' : 'Noch kein Jahresplan', 'Plankarte zeigt den tatsächlichen Zustand als Hauptinhalt');
    assertEqual(doc.getElementById('overviewPlanMetricYear').textContent, '2026', 'Das Planjahr steht separat neben dem Zustand');
    if (!fixed && !options.corruptReceipt) assert(doc.getElementById('overviewBudgetLink').textContent.includes('Vorschau in Balance'), 'Vorschau verweist auf den vorhandenen Rechenweg');
    if (options.preview === 'stale') {
        assert(doc.getElementById('overviewBudgetSource').textContent.includes('veraltet')
            && doc.getElementById('overviewBudgetLink').textContent.includes('rechnen'), 'Veraltete Vorschau nennt Status und Aktualisierungsweg');
        assert(doc.getElementById('overviewYearBudget').textContent.includes('Vorschau veraltet'), 'Veraltete Budgetlinie nennt denselben Vorbehalt');
    }
    if (view.annual.budget !== null) {
        assertEqual(doc.getElementById('overviewYearBudget').textContent.startsWith('Vorläufiges'), provisional, 'Karte und Budgetlinie tragen denselben Status');
        assert(doc.getElementById('overviewYearChart').innerHTML.includes(`data-budget-status="${fixed ? 'adopted' : 'provisional'}"`), 'Linienzeichnung kennt die gewählte Quelle');
        assert(doc.getElementById('overviewYearLegend').innerHTML.includes(provisional ? 'Vorläufiges Monatsbudget' : 'Monatsbudget'), 'Legende erklärt den Linienstatus');
    }
    if (options.corruptReceipt) assertEqual(doc.getElementById('overviewBudgetLink').getAttribute('href'), 'Daten-Sicherung.html', 'Beschädigter Beleg behält den vorhandenen Sicherungsweg');
    assert(doc.getElementById('overviewBudgetSource').textContent.includes('2026') || options.corruptReceipt, 'Budgetquelle nennt das Planjahr oder den beschädigten Beleg');
    assert(doc.getElementById('overviewQuoteDate').textContent.includes('Bestand am ' + f.now.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })), 'Aktueller Bestand nennt das Ansichtsdatum');
    assertEqual(JSON.stringify(view), before, 'Die Kartenanzeige verändert keine Finanz- oder Abschlussdaten');
}

win.location.hash = '#kursdetails'; events.hashchange();
assertEqual(doc.getElementById('kursdetails').open, true, 'Kurspille öffnet die erhaltenen Kursdetails');
doc.getElementById('kursdetails').open = false;
doc.getElementById('overviewPrices').click();
assertEqual(doc.getElementById('kursdetails').open, true, 'Kurspille öffnet auch bei unverändertem Hash');
doc.getElementById('overviewBackup').click();
assertEqual(doc.getElementById('overviewTrial'), null, 'Sicherungspille benötigt keine Probelaufzeile');
assert(html.includes('id="overviewBackup" class="overview-pill" href="Daten-Sicherung.html" data-profile-handoff'), 'Sicherungspille hat geschützten echten Seitenlink');

const focusScope = overviewScope('single', ['a']);
const focusNow = new Date(2027, 0, 1);
const focusBase = { available: true, complete: true, members: [{ id: 'a', name: 'A', valid: true, assets: 100, householdRole: 'Einzelprofil' }], scope: focusScope,
    priceTranches: [{ profileId: 'a', trancheId: 'lot', asOf: focusNow.getTime() / 1000 }],
    now: focusNow, year: 2027, quoteDate: focusNow.toISOString(), priceReport: { status: 'complete', updated: 1, results: [{ profileId: 'a', trancheId: 'lot', status: 'updated' }] },
    lastBackup: '2026-11-01T12:00:00Z', expenses: { year: 2026, month: 12, rows: [{ id: 'a', present: false }], complete: false },
    summary: { monthlyWithdrawal: 500, monthlyBudget: 700, status: 'vorläufig', createdAt: focusNow.toISOString(), action: { verb: 'Nichts tun' } },
    occasion: deriveOverviewOccasion({ now: focusNow, scope: focusScope, metadata: [{ schemaVersion: 1, lastCommittedPeriod: 'calendar-year:2025', pendingCommit: null }] }) };
// B10: gespeicherter heutiger Kurs und bestätigter Abruf sind getrennte Aussagen.
for (const kind of ['annual', 'play']) {
    for (const [label, report, confirmed] of [
        ['gespeichert', null, false],
        ...['offline', 'timeout', 'partial', 'running', 'storage-failed'].map(status => [status, { status, updated: 0, results: [{ status: 'failed' }] }, false]),
        ['vollständig', focusBase.priceReport, true],
        ['gespeicherter älterer Abruf', { ...focusBase.priceReport, retrievedAt: focusNow.getTime() - 86400000 }, false],
        ['Abruf mit Zeitstempel null', { ...focusBase.priceReport, retrievedAt: 0 }, false],
        ['Teilfehler im vollständigen Bericht', { ...focusBase.priceReport, results: [{ profileId: 'a', trancheId: 'lot', status: 'failed' }] }, false]
    ]) {
        const model = { ...focusBase, priceReport: report, nextSteps: [], occasion: { ...focusBase.occasion, kind } };
        const before = JSON.stringify(model);
        renderOverview(doc, model);
        assertEqual(/Kurse sind von heute/i.test(doc.getElementById('overviewLead').textContent), confirmed, `${kind}/${label}: Lead belegt heutigen Abruf trotz heutigem Speicherstichtag`);
        assertEqual(JSON.stringify(model), before, `${kind}/${label}: Darstellung verändert keine Frische- oder Rechenquelle`);
    }
}
renderOverview(doc, focusBase);
const focus = doc.getElementById('overviewFocus');
let markup = focus.innerHTML;
assertCloseStepContents(markup, focusBase);
assertEqual((markup.match(/data-overview-close-step=/g) || []).length, 7, 'Kombinierte Jahreskarte hat sieben Schritte');
assert(markup.includes('mit Jahresabschluss') && markup.includes('Abschluss starten'), 'Kombinierte Karte erreicht Jahresstart trotz Ausgabenlücken');
assert(markup.includes('data-overview-annual') && !markup.includes('Balance.html?year=2026#abschluss') && !markup.includes('data-overview-month'), 'Jahreskarte öffnet den gemeinsamen Jahresdialog direkt auf der Startseite');
assert(markup.includes('data-state="done"') && !markup.includes('checkbox'), 'Datenhaken folgen Quellen und sind keine Schreibcheckboxen');
const monthly = { ...focusBase, now: new Date(2027, 9, 1), occasion: { kind: 'monthly', previousYear: 2027, previousMonth: 9, closingYear: 2026, month: '2027-09' },
    cashPeople: [{ id: 'a', name: 'A', value: 18000 }], cashWarnings: [{ id: 'a', name: 'A', date: '2027-08-01' }],
    expenses: { year: 2027, month: 9, rows: [{ id: 'a', present: false }], complete: false } };
renderOverview(doc, monthly);
markup = focus.innerHTML;
const monthlyRows = assertCloseStepContents(markup, monthly);
assertEqual(monthlyRows.find(row => row.id === 'cash').detail.includes('Vorläufige Entnahme aus dem Vermögen im Oktober: 500,00'), true,
    'Monatsbetrag Oktober bleibt mit seinem bisherigen Wert in der Detailzeile sichtbar');
assert(markup.includes('September abschließen') && markup.includes('Entnahme aus dem Vermögen im Oktober') && markup.includes('data-overview-month'), 'Monatsfokus benennt Abschlussmonat und Bereitstellungsmonat getrennt');
assert(markup.includes('Vorläufige Entnahme aus dem Vermögen im Oktober: 500,00') && markup.includes('Stand stimmt')
    && markup.includes('Tagesgeld prüfen') && !markup.includes('Tagesgeld A:') && !markup.includes('data-tagesgeld-warning')
    && !markup.includes('#profileTagesgeld'), 'Fällige Monatskarte zeigt Betrag und Tagesgeldhinweis ohne zusätzliche Tagesgeldzugänge');
assertEqual((markup.match(/data-overview-month(?:[ >])/g) || []).length, 1, 'Ein Startknopf erhält beide Monatsanker');
assert(markup.includes('data-overview-month-confirm>Abschluss starten</button>') && !markup.includes('>Bereitgestellt</button>'), 'Hauptaktion und direkte Bestätigung sind eindeutig');
for (const [complete, spent] of [[true, 0], [true, 900], [false, null]]) {
    const view = { ...monthly, expenseBudget: 700, expenses: { ...monthly.expenses, complete, spent } };
    const before = JSON.stringify(view);
    renderOverview(doc, view);
    assertCloseStepContents(focus.innerHTML, view);
    const comparison = projectOverviewMonthSteps(view)[2];
    assertEqual(comparison.done, complete, 'Budgetchip folgt vollständigen Ausgaben einschließlich Null');
    assert(focus.innerHTML.includes('data-overview-close-step="budget" data-state="' + comparison.state + '"'), 'Karte verwendet produktive Schrittprojektion');
    assertEqual(JSON.stringify(view), before, 'Vergleich verändert keine Modellwerte');
    assertEqual((focus.innerHTML.match(/data-overview-month(?:[ >])/g) || []).length, 1, 'Ausgabenstand ist keine neue Abschlusssperre');
}
const monthlyWithoutPlan = { ...monthly, summary: null };
renderOverview(doc, monthlyWithoutPlan);
assertCloseStepContents(focus.innerHTML, monthlyWithoutPlan);
assert(focus.innerHTML.includes('Noch kein passender Jahresplan') && focus.innerHTML.includes('data-overview-month'), 'Fehlender Plan erfindet keinen bedienbaren Betrag');
renderOverview(doc, { ...monthly, occasion: { ...monthly.occasion, kind: 'play' } });
assert(focus.innerHTML.includes('data-tagesgeld-warning="a"') && focus.innerHTML.includes('#profileTagesgeld'), 'Im ruhigen Anlass bleibt der Hinweis auf veraltetes Tagesgeld erreichbar');
assert(!focus.innerHTML.includes('overview-play') && !focus.innerHTML.includes('Durchspielen') && !focus.innerHTML.includes('Zwischendrin') && !focus.innerHTML.includes('nichts offen'), 'Ruhiger Anlass enthält keine Durchspielen-Karte');
assert(!focus.className.includes('ds-card') && !focus.innerHTML.includes('Simulator.html'), 'Tagesgeldwarnung bleibt schlicht ohne Ersatz-Simulatorlinks');
assert(focus.innerHTML.includes('Nächster Monatsabschluss: 1. November · Jahresabschluss: Januar.'), 'Nächste Abschlüsse bleiben als schlichte Zeile sichtbar');
renderOverview(doc, { ...monthly, cashWarnings: [], nextSteps: [], occasion: { ...monthly.occasion, kind: 'play' } });
assert(!focus.innerHTML.includes('data-tagesgeld-warning') && !focus.innerHTML.includes('overview-cash-warning'), 'Ohne Warnung bleibt kein leerer Tagesgeldkasten');
assertEqual(doc.getElementById('overviewTitle').textContent, 'Alles erledigt bis zum Monatsanfang.', 'Ruhige Überschrift bleibt erhalten');
for (const status of ['running', 'offline', 'storage-failed']) {
    renderOverview(doc, { ...focusBase, priceReport: { status, updated: 0, results: [{ status: 'failed' }] } });
    assert(focus.innerHTML.includes(doc.getElementById('overviewPricesValue').textContent), 'Kurspille und Schritt verwenden denselben Report: ' + status);
    assert(!focus.innerHTML.includes('overview-year-action'), 'Offene Jahreskarte bleibt kompakt: ' + status);
}
renderOverview(doc, { ...focusBase, occasion: { ...focusBase.occasion, annualState: 'recovery' } });
assert(focus.innerHTML.includes('Wiederherstellungspunkt') && !focus.innerHTML.includes('Abschluss starten'), 'Recovery erhält Klärungsweg ohne normalen Jahresstart');
const annualCases = {
    open: { badge: 'mit Jahresabschluss', action: 'Abschluss starten', stepTitle: 'Jahr 2026 abschließen',
        lead: 'Schließ 2026 ab – danach steht fest, was dir 2027 monatlich zur Verfügung steht und was zu tun ist.',
        stepDetail: 'Inflation, ETF-Schlusskurs und Alter holen, prüfen, abschließen. Danach stehen Monatsbetrag und Handlungsanweisung für 2027 fest.' },
    unclear: { badge: 'Klärung nötig', action: 'Jahresstatus klären', stepTitle: 'Jahresstatus klären',
        title: 'Jahresstatus 2026 klären.',
        lead: 'Für 2026 gibt es Daten, aber keinen Abschlussvermerk. Bitte den Jahresstatus im Abschlussdialog einmal bestätigen.' },
    recovery: { badge: 'Wiederherstellung nötig', action: 'Wiederherstellung öffnen', stepTitle: 'Wiederherstellung öffnen',
        title: 'Jahresabschluss 2026 wiederherstellen.',
        lead: 'Der Jahresabschluss ist unvollständig. Prüfe zuerst den vorhandenen Wiederherstellungspunkt unter Daten & Sicherung.' },
    unavailable: { badge: 'Daten fehlen', action: 'Daten prüfen', stepTitle: 'Daten prüfen',
        title: 'Daten für 2026 prüfen.',
        lead: 'Die Profildaten für den Jahresabschluss sind nicht verfügbar. Prüfe Personen und Haushalt & Plan.' }
};
function assertAnnualPresentation(model, label, fresh = false) {
    const annualState = model.occasion.annualState, expected = annualCases[annualState], open = annualState === 'open';
    const before = JSON.stringify(model);
    renderOverview(doc, model);
    const title = doc.getElementById('overviewTitle').textContent, lead = doc.getElementById('overviewLead').textContent;
    assertEqual(title, open ? `${new Date(model.occasion.previousYear, model.occasion.previousMonth - 1, 1).toLocaleDateString('de-DE', { month: 'long' })} und Jahr 2026 abschließen` : expected.title,
        label + ': zustandsgerechte Überschrift');
    assertEqual(lead, open ? (fresh ? 'Die Kurse sind von heute. ' : '') + expected.lead
        : 'Prüfe zuerst den Jahresstatus in der Karte unten.', label + ': zustandsgerechter Lead');
    if (open) assertCloseStepContents(focus.innerHTML, model);
    else {
        assert(focus.innerHTML.includes(expected.title.slice(0, -1) + '</h2>'), label + ': Kartentitel ohne Monatsnamen');
        assertEqual(focus.innerHTML.split(expected.lead.replaceAll('&', '&amp;')).length - 1, 1, label + ': Jahreshinweis genau einmal');
        for (const obsolete of ['overview-close-step', 'overview-expense-detail', 'overview-year-action', 'Import öffnen', 'Details ansehen', 'Kein Import nötig']) {
            assert(!focus.innerHTML.includes(obsolete), label + ': keine Abschlussmonatdarstellung ' + obsolete);
        }
        assert(!lead.includes('Monatsbetrag bereitstellen') && !doc.getElementById('overviewLead').innerHTML.includes('data-next-step'), label + ': Lead ohne nachgelagerte Monatslinks');
        assertEqual((focus.innerHTML.match(/<button /g) || []).length, 2, label + ': nur Hauptaktion und Sicherung');
        assert(focus.innerHTML.includes('Vorher eine Vollsicherung erstellen.') && focus.innerHTML.includes('data-overview-backup'), label + ': Sicherung bleibt erreichbar');
    }
    assertEqual(focus.innerHTML.includes('Inflation, ETF-Schlusskurs und Alter holen, prüfen, abschließen'), false, label + ': normale Abschlussdetails nur bei offen');
    if (!open) {
        for (const text of [title, lead, focus.innerHTML]) {
            assert(!text.includes('steht noch aus') && !text.includes('Schließ 2026 ab') && !text.includes('Januar: Zeit für den Jahresabschluss.')
                && !text.includes('Jahr 2026 abschließen') && !text.includes('Abschluss starten'), label + ': keine normale Abschlussaufforderung');
        }
    }
    assert(focus.innerHTML.includes(expected.badge) && focus.innerHTML.includes(expected.action), label + ': eigene Beschriftung');
    assertEqual(focus.innerHTML.includes('Abschluss starten'), open, label + ': nur offen hat normalen Start');
    assertEqual(focus.innerHTML.includes('Klärung nötig'), annualState === 'unclear', label + ': nur unklar hat Klärungsbadge');
    assertEqual(focus.innerHTML.includes('Jahresstatus klären'), annualState === 'unclear', label + ': nur unklar hat Klärungsaktion');
    assert(focus.innerHTML.includes('data-overview-annual'), label + ': gemeinsamer Jahresbinder bleibt erreichbar');
    assertEqual(focus.innerHTML.includes('data-overview-close-step="expenses"'), open, label + ': Monatsschritte nur im regulären Jahresabschluss');
    assert(!focus.innerHTML.includes('disabled'), label + ': Hauptaktion bleibt bedienbar');
    assertEqual(JSON.stringify(model), before, label + ': Darstellung verändert keinen Jahreszustand');
}
for (const now of [focusNow, monthly.now]) {
    // Dasselbe Dokument: Sonderzustände müssen alle alten Abschlussaufforderungen entfernen, open sie wiederherstellen.
    for (const annualState of ['open', 'unclear', 'recovery', 'unavailable', 'open']) {
        const model = { ...focusBase, now, quoteDate: now.toISOString(), firstStart: false, occasion: { ...focusBase.occasion, annualState } };
        assertAnnualPresentation(model, now.getMonth() + ':' + annualState, true);
    }
    assertAnnualPresentation({ ...focusBase, now, firstStart: false, priceReport: { status: 'offline', updated: 0, results: [{ status: 'failed' }] } },
        now.getMonth() + ': offen ohne Kurserfolg');
    const unavailableData = { depot_tranchen: '{broken', overview_balance_summary_v1: JSON.stringify({ version: 1, entries: {
        [JSON.stringify([2026, focusScope.key])]: { year: 2026, scope: focusScope, monthlyWithdrawal: 100, monthlyBudget: 200, createdAt: focusNow.toISOString() }
    } }) };
    const unavailable = projectOverview({ registry: { version: 1, profiles: { a: { meta: { name: 'A' }, data: unavailableData } } },
        activeId: 'a', liveData: unavailableData, now });
    assertEqual(unavailable.complete, false, 'Echte Projektion mit beschädigtem Profil ist nicht vollständig');
    assertEqual(unavailable.occasion.annualState, 'unavailable', 'Echte Projektion liefert fehlende Profildaten');
    assertAnnualPresentation(unavailable, now.getMonth() + ': echte Projektion ohne Profildaten');
}
const withoutRegistry = projectOverview({ registry: null, activeId: null, now: focusNow });
assertEqual(withoutRegistry.available, false, 'Ohne Registry bleiben Daten nicht verfügbar');
assertEqual(withoutRegistry.occasion.annualState, 'unavailable', 'Fehlende Registry bleibt Prüfbedarf und keine Entwarnung');
const priceCard = doc.getElementById('kursdetails');
const statusHost = doc.createElement('div'); statusHost.id = 'startupPriceStatus'; statusHost.textContent = 'Synthetischer Offlinebericht'; doc.body.appendChild(statusHost);
for (const model of [monthly, focusBase, monthly]) {
    renderOverview(doc, { ...model, priceReport: { status: 'offline' } });
    priceCard.open = false;
    focus.events.get('click')({ target: { closest: selector => selector === 'a[href="#kursdetails"]' ? {} : null } });
    assertEqual(priceCard.open, true, 'Delegierter Kursschritt öffnet nach erneutem Fokusrender');
    renderOverview(doc, model);
    assertEqual(priceCard.open, true, 'Rerender erhält geöffnetes Kursfeld');
    assertEqual(doc.getElementById('startupPriceStatus'), statusHost, 'Statushost wird nicht ersetzt');
    assertEqual(statusHost.textContent, 'Synthetischer Offlinebericht', 'Bestehender Bericht wird beim Rerender nicht zerstört');
}
const previousClick = focus.events.get('click');
bindOverviewBackupTargets(doc, win);
assertEqual(focus.events.get('click'), previousClick, 'Erneutes Binden erhält denselben delegierten Handler');
const css = fs.readFileSync(new URL('../css/overview.css', import.meta.url), 'utf8');
assert(css.includes('grid-template-columns: 34px minmax(0,1fr) auto') && css.includes('padding: 13px 0') && css.includes('gap: 14px'), 'Schrittliste folgt Referenzabständen');

const { projectOverviewYear } = await import('../app/overview/overview-model.js');
const bandStore = { years: { 2026: { months: {
    1: { profiles: { a: { categories: { total: -100 } } } },
    2: { profiles: { a: { categories: { total: -150 } } } }
} } } };
const yearArgs = { store: bandStore, scope: focusScope, now: new Date(2027, 0, 5), retrospective: true,
    budgetSummary: { year: 2026, scope: focusScope, monthlyBudget: 100, createdAt: '2026-01-07T12:00:00Z' }, budgetStatus: 'adopted' };
const annualView = { ...projectOverviewYear(yearArgs), comparison: { delta: null, reason: 'Kein vollständiger Vergleichsstand' }, sales: { count: 2, net: 100, unconfirmed: 1 } };
renderOverview(doc, { ...focusBase, annual: annualView });
const chart = doc.getElementById('overviewYearChart'), metrics = doc.getElementById('overviewYearMetrics');
function assertYearMetricPopovers(markup) {
    assert(!markup.includes('<small>'), 'Jahreskennzahlen haben keine offenen Detailzeilen');
    const rows = [...markup.matchAll(/<div class="overview-year-metric">([\s\S]*?)<\/div>/g)];
    assertEqual(rows.length, 4, 'Alle vier Jahreskennzahlen bleiben sichtbar');
    const ids = new Set();
    for (const [, row] of rows) {
        const id = row.match(/class="ds-info-pop" id="([^"]+)" role="tooltip"/)?.[1];
        assert(Boolean(id) && !ids.has(id), 'Jede Kennzahl hat ein eigenes Info-Popup');
        ids.add(id);
        assert(row.includes(`aria-controls="${id}"`) && row.includes(`aria-describedby="${id}"`), 'Detailtext bleibt über den benannten Info-Knopf für Bildschirmleser erreichbar');
        assert(/<strong>[^<]+<\/strong>/.test(row), 'Jede Kennzahl zeigt einen Wert oder einen Gedankenstrich');
    }
}
assertYearMetricPopovers(metrics.innerHTML);
assertEqual((chart.innerHTML.match(/data-overview-year-month=/g) || []).length, 12, 'Zwölf Monatszustände mit Textalternativen');
assert(chart.innerHTML.includes('vollständig') && chart.innerHTML.includes('Import fehlt') && chart.innerHTML.includes('is-over'), 'Balken zeigen Vollständigkeit und strikte Überschreitung');
assert(chart.innerHTML.includes('overview-budget-line') && chart.innerHTML.includes('ds-sr-only'), 'Budgetlinie und Textalternative statt reinem Farbcode');
assertEqual((metrics.innerHTML.match(/class="overview-year-metric"/g) || []).length, 4, 'Rückblick hat genau vier Kennzahlen');
assert(metrics.innerHTML.includes('Verkäufe') && metrics.innerHTML.includes('netto ins Tagesgeld') && metrics.innerHTML.includes('unbestätigt'), 'Verkaufskennzahl nennt nur belegtes Netto und fehlende Bestätigung');
assertEqual(doc.getElementById('overviewYearTitle').textContent, '2026 im Rückblick', 'Rückblicktitel zeigt Vorjahr');
assertEqual(doc.getElementById('overviewYearExpensesLink').getAttribute('href'), 'Ausgaben.html?year=2026#ausgaben', 'Rückblick verlinkt das Vorjahr direkt auf Ausgaben');
assertEqual(doc.getElementById('overviewYearBudget').textContent, 'Monatsbudget ' + moneyText(100) + ' · 2026', 'Belegter Monatsbetrag beschriftet Budgetlinie');
assertEqual(doc.getElementById('overviewYearBudget').style.top, `calc(150px * ${1 - 100 / (150 * 1.15)})`, 'Budgetbeschriftung folgt derselben unveränderten Skala wie die Linie');
assertEqual(doc.getElementById('overviewYearStand').textContent, '', 'Budgetjahr zeigt keine technische Speicherstandzeile');
for (const now of [new Date(2027, 0, 2), new Date(2027, 0, 31), new Date(2028, 0, 1)]) {
    for (const budgetStatus of ['adopted', 'provisional', 'missing', 'zero']) {
        const year = now.getFullYear();
        const startView = projectOverviewYear({ store: bandStore, scope: focusScope, now,
            budgetSummary: budgetStatus === 'missing' ? null : { year, scope: focusScope,
                monthlyBudget: budgetStatus === 'zero' ? 0 : 5000, createdAt: now.toISOString() },
            budgetStatus: budgetStatus === 'provisional' ? 'provisional' : 'adopted', budgetPreviewStatus: 'current' });
        const before = JSON.stringify(startView);
        renderOverview(doc, { ...focusBase, now, annual: startView });
        const note = doc.getElementById('overviewYearNote').textContent;
        assertEqual(note, `${year} hat begonnen. Die erste Monatsauswertung kommt nach dem Januarabschluss (ab 01.02.${year}).`, 'Jahresanfang nennt tatsächliches Jahr, Monat und nächsten Abschlusstermin');
        assert(!note.includes('fehlen') && !metrics.innerHTML.includes('Es fehlen noch Ausgaben'), 'Ohne fälligen Monat keine Aufforderung zu Ausgabenimports');
        assertEqual(metrics.innerHTML.includes('noch ohne Budget'), budgetStatus === 'missing', 'Budgethinweis unterscheidet fehlendes Budget von noch fehlendem Auswertungszeitraum');
        assertEqual(doc.getElementById('overviewYearStand').hidden, budgetStatus !== 'missing', 'Echter Budgetmangel bleibt am Jahresanfang sichtbar');
        if (budgetStatus !== 'missing') assert(metrics.innerHTML.includes((budgetStatus === 'provisional' ? 'Vorläufiges Monatsbudget ' : 'Monatsbudget ') + moneyText(startView.budget)), 'Kennzahl benennt vorhandenen Plan oder Vorschau auch ohne Prozentvergleich');
        assert(metrics.innerHTML.includes(`Für ${year} · Nach dem Januarabschluss`) && !metrics.innerHTML.includes('Noch nicht genug vollständige Monate'), 'Hochrechnung wartet ruhig auf den ersten Monatsabschluss');
        assertEqual((chart.innerHTML.match(/data-state="open"/g) || []).length, 12, 'Alle zwölf Monate bleiben offen');
        assertEqual(startView.total, null, 'Jahresanfang erfindet keine Nullausgaben');
        assertEqual(startView.budgetPercent, null, 'Jahresanfang erfindet keinen Budget-Prozentwert');
        assertEqual(JSON.stringify(startView), before, 'Jahresanfang verändert keine Rechen- oder Quelldaten');
    }
}
const missingFebruary = projectOverviewYear({ store: {}, scope: focusScope, now: new Date(2027, 1, 2),
    budgetSummary: { year: 2027, scope: focusScope, monthlyBudget: 5000 }, budgetStatus: 'adopted' });
renderOverview(doc, { ...monthly, annual: missingFebruary });
assert(doc.getElementById('overviewYearNote').textContent.includes('Für einige Monate fehlen noch Ausgaben')
    && metrics.innerHTML.includes('Es fehlen noch Ausgaben'), 'Sobald Januar fällig ist, bleiben fehlende Ausgaben sichtbar');
assert(!metrics.innerHTML.includes('noch ohne Budget') && metrics.innerHTML.includes('Monatsbudget ' + moneyText(5000)), 'Vorhandenes Budget bleibt auch bei fehlenden fälligen Imports erkennbar');
renderOverview(doc, { ...focusBase, annual: annualView });
assertEqual(doc.getElementById('overviewYearNote').textContent, 'Ausgaben je Monat · Für einige Monate fehlen noch Ausgaben. Fehlende Imports bedeuten nicht, dass nichts ausgegeben wurde.', 'Januar vor Jahresabschluss behält den Vorjahresrückblick mit seinen echten Lücken');
const currentView = { ...projectOverviewYear({ ...yearArgs, now: new Date(2026, 9, 1), retrospective: false, budgetSummary: null }), comparison: annualView.comparison };
renderOverview(doc, { ...monthly, annual: currentView });
assertEqual(doc.getElementById('overviewYearNote').textContent, 'Ausgaben bis einschließlich Vormonat · Für einige Monate fehlen noch Ausgaben. Fehlende Imports bedeuten nicht, dass nichts ausgegeben wurde.', 'Gewöhnlicher Monat behält bisherigen Hinweis auf echte Ausgabenlücken');
assertEqual((metrics.innerHTML.match(/class="overview-year-metric"/g) || []).length, 4, 'Laufendes Jahr hat genau vier Kennzahlen');
assertYearMetricPopovers(metrics.innerHTML);
assert(metrics.innerHTML.includes('01.01.2026 bis 30.09.2026') && metrics.innerHTML.includes('Januar 2027'), 'Ausgaben und nächster Abschluss nennen ihre Kalenderzeiträume');
assert(metrics.innerHTML.includes('Hochrechnung') && metrics.innerHTML.includes('Januar') && metrics.innerHTML.includes('für 2026 · in'), 'Laufendes Jahr zeigt Hochrechnung und ehrlichen nächsten Abschlusszeitraum');
assert(!chart.innerHTML.includes('overview-budget-line') && doc.getElementById('overviewYearStand').textContent === 'Noch kein Budget für 2026 – erscheint nach der ersten Balance-Rechnung.', 'Ohne historischen Record keine erfundene Budgetlinie');
assert(chart.innerHTML.includes('noch offen'), 'Laufender und zukünftige Monate bleiben offen');
assertEqual(doc.getElementById('overviewYearBudget').textContent, '', 'Fehlendes Budget löscht alten Linienbetrag');
assertEqual(doc.getElementById('overviewYearBudget').hidden, true, 'Fehlendes Budget verbirgt Linienbeschriftung');
assert(doc.getElementById('overviewYearLegend').innerHTML.includes('overview-year-key') && !doc.getElementById('overviewYearLegend').innerHTML.includes('Über Budget'), 'Kleine Farbfelder ohne unbelegtes Budget');
assert(metrics.innerHTML.includes('Für 2026 · aus 01.01.2026 bis 30.09.2026') && metrics.innerHTML.includes(moneyText(currentView.forecast)), 'Hochrechnung behält Betrag bei einfachem Text');
const zeroView = projectOverviewYear({ ...yearArgs, store: { years: { 2026: { months: { 1: { profiles: { a: { categories: { total: 0 } } } } } } } } });
renderOverview(doc, { ...focusBase, annual: zeroView });
assert(chart.innerHTML.includes('data-overview-year-month="1" data-state="complete" title="Januar: vollständig · ' + moneyText(0)), 'Nullausgaben behalten Betrag und vollständigen Importzustand');
renderOverview(doc, { ...monthly, firstStart: true, annual: currentView });
assertEqual(doc.getElementById('overviewWelcome').hidden, false, 'Erststart zeigt Willkommen');
assertEqual(doc.getElementById('overviewNormal').hidden, true, 'Erststart ersetzt normale Karten');
assertEqual(doc.getElementById('overviewYearBand').hidden, true, 'Erststart zeigt kein leeres Jahresdiagramm');
assertEqual(doc.getElementById('overviewTitle').textContent, 'Plane deinen Ruhestand Jahr für Jahr.', 'Erststart erhält eigenen Leitsatz');
assert(html.includes('href="depot-tranchen-manager.html#personen"') && html.includes('Eigene Daten anlegen'), 'Erststart öffnet vorhandenen Personendialog');
{
    const card = html.match(/<section[^>]*aria-labelledby="overviewWelcomeTitle">([\s\S]*?)<\/section>/)[1];
    assertEqual((card.match(/class="overview-welcome-option"/g) || []).length, 3, 'Linke Erststartkarte bietet drei Optionen im selben Stil');
    assert(card.includes('Erst ausprobieren – mit Max und Erika') && /id="overviewWelcomeDemo"[^>]*hidden[^>]*disabled/.test(card), 'Musteroption wartet auf sichere Probelaufbindung');
    const trialDoc = createPresentationTestDocument();
    const option = trialDoc.createElement('button'); option.id = 'overviewWelcomeDemo'; trialDoc.body.appendChild(option);
    option.click = () => option.events.get('click')?.({ currentTarget: option, target: option });
    let starts = 0, dialogs = 0, choice;
    const trial = { demoAvailable: true, runtime: { canStart: true }, state: null,
        async start(choose) { starts++; choice = await choose({ testDate: '2026-10-12', demoAvailable: true }); } };
    bindProbelaufUI(trialDoc, trial, { dateDialog: async () => { dialogs++; return null; } });
    assert(!option.hidden && !option.disabled, 'Verfügbares Muster ist beim Erststart bedienbar');
    option.click(); option.click();
    await Promise.resolve(); await Promise.resolve();
    assertEqual(starts, 1, 'Musteroption teilt Doppelklicks über den vorhandenen Startablauf');
    assertEqual(JSON.stringify(choice), JSON.stringify({ source: 'demo', testDate: null }), 'Erststartklick wählt Muster mit Stand heute ohne Testdatum');
    assertEqual(dialogs, 0, 'Erststartklick öffnet keinen Startdialog');
    for (const flag of ['busy', 'waiting', 'blocked']) {
        trial[flag] = true; renderProbelaufUI(trialDoc, trial);
        assert(option.disabled, `${flag}: Musteroption ist gesperrt`);
        option.click(); assertEqual(starts, 1, `${flag}: gesperrter Klick startet nichts`);
        trial[flag] = false;
    }
    trial.runtime.canStart = false; renderProbelaufUI(trialDoc, trial);
    assert(option.disabled, 'Gesperrte Laufzeit sperrt auch Musterstart');
    trial.runtime.canStart = true; trial.demoAvailable = false; renderProbelaufUI(trialDoc, trial);
    assert(option.hidden && option.disabled, 'Ohne Musterloader bleibt die dritte Option verborgen');
    trial.demoAvailable = true;
    for (const phase of ['active', 'starting', 'restoring']) {
        trial.state = { phase, testDate: '2026-10-12' }; renderProbelaufUI(trialDoc, trial);
        assert(option.hidden, `${phase}: vorhandener Spielbereich verbirgt die Musteroption`);
        option.click(); assertEqual(starts, 1, `${phase}: vorhandener Spielbereich wird nicht neu gestartet`);
    }
}
doc.getElementById('overviewWelcomeImport').click();
assertEqual(clickedTarget, 'Daten-Sicherung.html#fullBackupImportBtn', 'Willkommen delegiert an zentralen Sicherungsimport');
renderOverview(doc, { ...focusBase, firstStart: false, occasion: { ...focusBase.occasion, annualState: 'recovery' }, annual: annualView });
assertEqual(doc.getElementById('overviewWelcome').hidden, true, 'Recovery zeigt keinen normalen Erststart');
assertEqual(doc.getElementById('overviewNormal').hidden, false, 'Recovery behält Hinweise und Klärungsweg');
const rendererSource = fs.readFileSync(new URL('../app/overview/overview-renderer.js', import.meta.url), 'utf8');
assert(!/EngineAPI|runMonteCarlo|runBacktest|localStorage|setItem/.test(rendererSource), 'Renderer startet keinen fachlichen Rechenjob und schreibt keinen Store');

// Beide Regressionen kommen aus dem echten Modell, bei vollständigen Jahresgrenzen.
const comparisonReason = 'Kein eindeutiger Vergleichsstand für diesen Profil-/Haushaltsumfang';
const historyAmounts = total => ({ tagesgeld: total, geldmarktEtf: 0, depotwertAlt: 0, depotwertNeu: 0 });
const formerHouseholdState = { wealthHistory: { schemaVersion: 1, entries: [
    createManualWealthHistoryEntry(historyAmounts(1000), '2026-01-01'),
    createAnnualWealthHistoryEntry(historyAmounts(1000), 2026),
    createAnnualWealthHistoryEntry(historyAmounts(1100), 2027)
] } };
const householdScope = overviewScope('household', ['a', 'b']);
const regressionPeople = ['a', 'b'].map((id, index) => ({ id, name: id.toUpperCase(), valid: true,
    assets: index ? 600 : 400, householdRole: 'Haushaltsmitglied', allocation: { gold: 0, anleihe: 0 } }));
const wealthRow = () => metrics.innerHTML.match(/<div class="overview-year-metric"><span class="overview-year-metric-label"><span>Vermögen<\/span>([\s\S]*?)<\/div>/)?.[1];
for (const selectedScope of [householdScope, focusScope]) {
    for (const retrospective of [false, true]) {
        const members = selectedScope.kind === 'household' ? regressionPeople : [regressionPeople[0]];
        const currentAssets = members.reduce((sum, person) => sum + person.assets, 0);
        const now = retrospective ? new Date(2028, 0, 5) : new Date(2027, 9, 6);
        const annual = projectOverviewYear({ store: { years: { 2027: bandStore.years[2026] } }, scope: selectedScope, now, retrospective });
        const model = { ...focusBase, scope: selectedScope, members, now, year: 2027,
            household: { assets: currentAssets, allocation: { cash: currentAssets } }, firstStart: false };
        const oldComparison = { delta: -1000, percent: -50, reason: 'Alter synthetischer Vergleich' };
        renderOverview(doc, { ...model, comparison: oldComparison, annual: { ...annual, comparison: oldComparison } });
        assert(doc.getElementById('overviewComparison').textContent.includes('-1.000') && doc.getElementById('overviewComparison').textContent.includes('-50,0') && doc.getElementById('overviewComparison').textContent.includes('seit Jahresendstand 2026'), 'Vorherige Kartendifferenz und Prozent mit Zeitraum sind tatsächlich gerendert');
        assert(wealthRow().includes('%') && wealthRow().includes('€'), 'Vorherige Jahreskennzahl enthält Differenz und Prozent');
        const comparison = projectOverviewWealth({ states: members.map(() => structuredClone(formerHouseholdState)),
            members, scope: selectedScope, comparisonScope: selectedScope, year: 2027, retrospective, currentAssets });
        renderOverview(doc, { ...model, comparison, annual: { ...annual, comparison } });
        assertEqual(comparison.reason, comparisonReason, 'Modell verweigert weiterhin den unbelegten historischen Umfang');
        assertEqual(doc.getElementById('overviewComparison').textContent, 'Jahresendvergleich 2026 nicht belegbar', 'Vermögenskarte ersetzt alte Differenz und Prozent durch ehrlichen Leerhinweis');
        assert(wealthRow().includes('<strong>—</strong>') && wealthRow().includes('role="tooltip">Jahresendvergleich 2026 nicht belegbar</span>')
            && !wealthRow().includes('%'), 'Jahreskennzahl ersetzt Differenz und Prozent durch Gedankenstrich und Grund im Info-Popup');
        assertEqual(doc.getElementById('overviewAssets').textContent,
            formatDisplayNumber(currentAssets, { fractionDigits: 0 }), 'Aktueller Haushalt oder Einzelbestand bleibt sichtbar');
        assertEqual(doc.getElementById('overviewAssetUnit').hidden, false, 'Euroeinheit bleibt getrennt sichtbar');
        assert(metrics.innerHTML.includes('250') && metrics.innerHTML.includes(retrospective ? 'Verkäufe' : 'Hochrechnung'), 'Andere Jahreskennzahlen bleiben sichtbar');
        assertEqual(doc.getElementById('overviewYearExpensesLink').getAttribute('href'), 'Ausgaben.html?year=2027#ausgaben', 'Jahresband verlinkt den tatsächlichen Jahresbezug direkt');
        assertEqual(doc.getElementById('overviewYearTitle').textContent, '2027' + (retrospective ? ' im Rückblick' : ' bisher'), 'Beide Anzeigezeiträume sind geprüft');
    }
}

// Darstellungswechsel räumen alte Planwerte vollständig auf.
const populated = { ...focusBase, summary: { ...focusBase.summary, liquidityCoverage: 89.4, marketPhase: 'Stabiler Höchststand',
    action: { verb: 'Aktien verkaufen', amount: 11000, amountUnit: '€ netto', note: 'Liquidität auffüllen' } } };
for (const status of ['vorläufig', 'fest']) {
    renderOverview(doc, { ...populated, summary: { ...populated.summary, status } });
    assertEqual(doc.getElementById('overviewPlanRows').hidden, true, 'Alte Einzelprojektion bleibt verborgen: ' + status);
    assertEqual(doc.getElementById('overviewPlanEmpty').hidden, true, 'Gültiger Plan verbirgt Leertext');
    assertEqual(doc.getElementById('overviewPlanStatus').textContent, '', 'Alte Abschlussmetadaten ergeben keinen festgeschriebenen Plan');
    assertEqual(doc.getElementById('overviewWithdrawal').textContent, 'Vorschau: ' + moneyText(500), 'Gespeicherte Summary bleibt ausdrücklich Vorschau');
    assert(doc.getElementById('overviewPlanAction').textContent.startsWith('Vorschau:'), 'Unterjährige Handlung bleibt Vorschau');
    assertEqual(doc.getElementById('overviewLiquidity').textContent, 'Heute unbekannt · 89,4\u00a0% nach Umsetzung', 'Alte Summary gibt Nachherdeckung nicht als Ist aus');
    assertEqual(doc.getElementById('overviewMarket').textContent, 'Stabiler Höchststand', 'Vorhandene Marktphase bleibt unverändert');
    assert(doc.getElementById('overviewPlanBudget').textContent.includes(moneyText(700)), 'Budget bleibt getrennt von Entnahme');
    renderOverview(doc, { ...populated, summary: null });
    for (const id of ['overviewWithdrawal', 'overviewPlanBudget', 'overviewPlanAction', 'overviewPlanNote', 'overviewLiquidity', 'overviewLiquidityNote', 'overviewMarket', 'overviewPlanTime', 'overviewPlanStatus']) {
        assertEqual(doc.getElementById(id).textContent, '', 'Leerer Plan entfernt alten Wert: ' + id);
    }
    assertEqual(doc.getElementById('overviewPlanRows').hidden, true, 'Leerer Plan verbirgt Zeilen');
    assertEqual(doc.getElementById('overviewPlanEmpty').hidden, true, 'Gemeinsamer Vergleich übernimmt den Leerhinweis');
}
renderOverview(doc, populated);
assertEqual(doc.getElementById('overviewPlanRows').hidden, true, 'Gemeinsamer Vergleich ersetzt alte Einzelprojektion');
assertEqual((html.match(/class="overview-plan-row"/g) || []).length, 4, 'Plan hat genau vier Zeilen');
assert(html.includes('Noch kein festgeschriebener Plan – er entsteht im nächsten Jahresabschluss.')
    && /href="Balance.html" class="ds-button ds-button-secondary overview-plan-button" data-profile-handoff>Zur Balance/.test(html), 'Leertext und sekundäres Balanceziel');
assert(css.includes('.overview-plan-button { align-self: flex-start; }'), 'Balanceknopf bleibt in Inhaltsbreite');
for (const [days, expected] of [
    [-1, 'heute'],
    [0, 'heute'],
    [0.9, 'heute'],
    [1, 'vor 1 Tag'],
    [1.9, 'vor 1 Tag'],
    [2, 'vor 2 Tagen'],
    [29, 'vor 29 Tagen'],
    [30, 'vor 30 Tagen'],
    [34, 'vor 34 Tagen']
]) {
    renderOverview(doc, { ...focusBase, lastBackup: new Date(focusNow.getTime() - days * 86400000).toISOString() });
    assertEqual(doc.getElementById('overviewBackup').dataset.warning, String(days >= 30), 'Sicherungswarnung: ' + days);
    assertEqual(doc.getElementById('overviewBackupReminder').hidden, days < 30, 'Erinnerung folgt bestehender Schwelle: ' + days);
    assertEqual(doc.getElementById('overviewBackupValue').textContent, expected, 'Sicherungsalter sichtbar: ' + days);
}
renderOverview(doc, { ...focusBase, lastBackup: null });
assertEqual(doc.getElementById('overviewBackupValue').textContent, 'Noch keine Vollsicherung', 'Keine erfundene Sicherung');
const longName = 'Synthetische Anna Maria Mit Einem Sehr Langen Familiennamen';
const person = { ...focusBase.members[0], name: longName, values: { alter: 66, renteMonatlich: 1200 }, personDates: { todayAge: 67, todayAgeStatus: 'valid' } };
renderOverview(doc, { ...focusBase, members: [person], household: { assets: 100, allocation: { cash: 100 } } });
assertEqual(doc.getElementById('overviewHouseholdNames').getAttribute('title'), longName, 'Tooltip behält den vollständigen Namen');
const namesRule = css.match(/\.overview-pill-names\s*\{([^}]*)\}/)?.[1] || '';
assert(namesRule.includes('overflow-wrap: anywhere') && !namesRule.includes('overflow: hidden'), 'Lange Namen bleiben im gemeinsamen Kontext vollständig lesbar');
assertEqual(doc.getElementById('overviewAssetTitle').textContent, 'Dein Vermögen', 'Einzelperson erhält passende Überschrift');
assert(doc.getElementById('overviewPeople').innerHTML.includes('>SA</span>') && doc.getElementById('overviewPeople').innerHTML.includes('67 Jahre')
    && doc.getElementById('overviewPeople').innerHTML.includes(moneyText(1200) + ' Rente / Monat')
    && !doc.getElementById('overviewPeople').innerHTML.includes('Einzelprofil'), 'Zwei Initialen und belegte Personendetails statt Rolle');
assertEqual(doc.getElementById('overviewAssetStatus').hidden, true, 'Gültiger Bestand zeigt keine technische Erklärung');
renderOverview(doc, { ...focusBase, complete: false, members: [{ ...person, valid: false }, { ...person, id: 'b', name: '<b>Synthetisch</b>' }] });
assertEqual(doc.getElementById('overviewAssetTitle').textContent, 'Euer Vermögen · Haushalt', 'Haushalt erhält passende Überschrift');
assertEqual(doc.getElementById('overviewAssetStatus').hidden, false, 'Unvollständigkeit bleibt sichtbar');
assert(doc.getElementById('overviewPeople').innerHTML.includes('Bestand unvollständig') && doc.getElementById('overviewPeople').innerHTML.includes('&lt;b&gt;'), 'Unvollständige Person und sichere Namensausgabe');
renderOverview(doc, focusBase);
assertEqual(doc.getElementById('overviewTitle').textContent, 'Dezember und Jahr 2026 abschließen', 'Januarüberschrift');
assert(doc.getElementById('overviewLead').textContent.includes('Schließ 2026 ab') && doc.getElementById('overviewLead').textContent.includes('2027'), 'Jahreslead nennt Abschluss und Planung');
renderOverview(doc, { ...focusBase, now: monthly.now, occasion: { ...focusBase.occasion, previousYear: 2027, previousMonth: 9 } });
assertEqual(doc.getElementById('overviewTitle').textContent, 'September und Jahr 2026 abschließen', 'Offenes Vorjahr außerhalb Januar bleibt sichtbar');
renderOverview(doc, monthly);
assertEqual(doc.getElementById('overviewTitle').textContent, 'Monatsabschluss September.', 'Monatsüberschrift');
assertEqual(doc.getElementById('overviewLead').textContent, 'Vier kurze Schritte, dann ist der Monat erledigt. Danach siehst du, wie das Jahr bisher läuft.', 'Monatslead aus Referenz');
renderOverview(doc, { ...monthly, nextSteps: [], occasion: { ...monthly.occasion, kind: 'play', annualState: 'done' } });
assertEqual(doc.getElementById('overviewTitle').textContent, 'Alles erledigt bis zum Monatsanfang.', 'Zwischendrinüberschrift');
assertEqual(doc.getElementById('overviewLead').textContent, 'September ist abgeschlossen.', 'Keine frischen Kurse bei altem Kursdatum behauptet');
for (const status of ['running', 'offline', 'timeout', 'storage-failed']) {
    renderOverview(doc, { ...focusBase, priceReport: { status, updated: 0, results: [{ status: 'failed' }] } });
    assert(!doc.getElementById('overviewLead').textContent.includes('Die Kurse sind von heute'), 'Fehlbericht erzeugt keine Frischebehauptung: ' + status);
    assert(!focus.innerHTML.split('Ausgaben Dezember')[0].includes('is-done'), 'Fehlbericht erledigt Kursschritt nicht: ' + status);
}
function moneyText(value) { return formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 }); }

const pillMarkup = html.match(/<header class="suite-header">([\s\S]*?)<\/header>/)[1];
assertEqual((pillMarkup.match(/aria-hidden="true" focusable="false"/g) || []).length, 3, 'Haushalt, Abruf und Sicherung haben dekorative Symbole');
assertEqual((pillMarkup.match(/<b /g) || []).length, 4, 'Vier hervorgehobene Pillenwerte');
for (const href of ['depot-tranchen-manager.html#personen', '#kursdetails', 'Daten-Sicherung.html']) {
    assert(pillMarkup.includes(`href="${href}"`), 'Kopfpille behält Ziel: ' + href);
}
assert(css.includes('.overview-card-link { color: var(--accent)') && css.includes('.overview-card-link:focus-visible'), 'Messinglinks mit sichtbarem Fokus');
const allocations = { aktien_alt: 100, aktien_neu: 200, geldmarkt: 300, gold: 150, cash: 200, anleihe: 50 };
renderOverview(doc, { ...focusBase, household: { assets: 1000, allocation: allocations } });
for (const [key, amount] of Object.entries({ aktien: 300, geldmarkt: 300, gold: 150, cash: 200, anleihe: 50 })) {
    assert(doc.getElementById('overviewAllocation').innerHTML.includes(`overview-allocation-${key}" style="width:${amount / 1000 * 100}%"`), 'Allokationsanteil bleibt unverändert: ' + key);
    assert(doc.getElementById('overviewLegend').innerHTML.includes(`data-overview-allocation="${key}"`), 'Allokationslegende bleibt vorhanden: ' + key);
}
assert(!doc.getElementById('overviewAllocation').innerHTML.includes('aktien_alt') && !doc.getElementById('overviewLegend').innerHTML.includes('aktien_neu'), 'Übersicht besitzt nur eine Aktienanlage');
for (const [old, fresh, sum] of [[600000, 400000, 1000000], [600000, 0, 600000], [0, 400000, 400000], [0, 0, 0], [null, 400000, null]]) {
    const allocation = Object.freeze({ aktien_alt: old, aktien_neu: fresh, cash: 1000000 });
    const view = { ...focusBase, household: { assets: sum === null ? null : sum + 1000000, allocation } }, before = JSON.stringify(view);
    renderOverview(doc, view);
    const bar = doc.getElementById('overviewAllocation').innerHTML, legend = doc.getElementById('overviewLegend').innerHTML;
    assertEqual((bar.match(/overview-allocation-aktien/g) || []).length, sum > 0 ? 1 : 0, 'Ein Aktienbalken nur bei bekanntem positiven Bestand');
    assertEqual((legend.match(/data-overview-allocation="aktien"/g) || []).length, sum > 0 ? 1 : 0, 'Genau eine Aktienposition in Prozentlegende');
    if (sum > 0) assert(bar.includes(`style="width:${sum / (sum + 1000000) * 100}%" title="Aktien: ${formatDisplayNumber(sum, { unit: 'currency', fractionDigits: 0 })}"`), 'Balkenanteil und absoluter Aktientooltip');
    assertEqual(JSON.stringify(view), before, 'Anzeige mutiert keine Haushalts-/Personenwerte');
}

// D16: derselbe alte Jahresstand im Oktober erzeugt nur die Jahresklärung.
const octoberNow = new Date(2026, 9, 12);
const octoberOccasion = deriveOverviewOccasion({ now: octoberNow, scope: focusScope, metadata: [null],
    planning: { firstPlanningYear: 2026, errors: [], evidence: [{ id: 'a', kind: 'annual', year: 2025 }] } });
assertEqual(octoberOccasion.annualState, 'unclear', 'Oktober mit altem Jahresstand bleibt ungeklärt');
assertEqual(octoberOccasion.annualReason, 'missing_commit', 'Oktober reproduziert fehlenden Abschlussvermerk');
const octoberModel = { ...focusBase, now: octoberNow, occasion: octoberOccasion, firstPlanningYear: 2026,
    expenses: { year: 2025, month: 12, beforePlanning: true, complete: false, rows: [] },
    exampleExpensesAllowed: true, cashWarnings: [{ id: 'a', name: 'A', date: '2026-01-20' }] };
const octoberBefore = JSON.stringify(octoberModel);
renderOverview(doc, octoberModel);
assert(focus.innerHTML.includes('Jahresstatus 2025 klären</h2>') && !/September|Oktober|Dezember/.test(focus.innerHTML), 'Oktoberklärung benennt nur das Abschlussjahr');
assert(!focus.innerHTML.includes('overview-close-step') && !focus.innerHTML.includes('Import öffnen'), 'Oktoberklärung hat keine Monats-Schrittliste und keinen Importknopf');
const diagnosis2025 = 'Für 2025 gibt es Daten, aber keinen Abschlussvermerk. Bitte den Jahresstatus im Abschlussdialog einmal bestätigen.';
assertEqual((focus.innerHTML + doc.getElementById('overviewLead').textContent).split(diagnosis2025).length - 1, 1, 'Abschlusssatz steht insgesamt genau einmal');
assert(!doc.getElementById('overviewLead').innerHTML.includes('Monatsbetrag bereitstellen'), 'Oktoberlead bietet keinen verfrühten Monatsbetrag an');
assertEqual(JSON.stringify(octoberModel), octoberBefore, 'Oktoberdarstellung erhält Ausgaben, Jahreszustand und Datenwege');
// Rückkehr zum regulären Januar auf demselben DOM stellt alle sieben Schritte wieder her.
renderOverview(doc, focusBase);
assertCloseStepContents(focus.innerHTML, focusBase);
assert(focus.innerHTML.includes('Dezember und Jahr 2026 abschließen</h2>') && focus.innerHTML.includes('Rund 10 Minuten'), 'Regulärer Januar behält Titel und Dauerhinweis');
assert(!focus.innerHTML.includes('data-overview-backup'), 'Regulärer Januar erhält keinen zusätzlichen Sicherungsknopf');
const manyPeople = Array.from({ length: 8 }, (_, index) => ({ id: 'person-' + index, name: 'Sehr langer synthetischer Name '.repeat(4) + index }));
renderOverview(doc, { ...monthly, members: manyPeople, expenses: { year: 2027, month: 9, complete: false, rows: manyPeople.map(person => ({ id: person.id, present: false })) } });
assert(focus.innerHTML.includes('data-overview-close-step="expenses"') && !focus.innerHTML.includes('Sehr langer'), 'Monatskarte bleibt kompakt bei großen Haushalten');

const startStateKey = (await import('../app/balance/balance-config.js')).CONFIG.STORAGE.LS_KEY;
const startData = { depot_tranchen: '[]', profile_tagesgeld: '100', [startStateKey]: JSON.stringify({ wealthHistory: { schemaVersion: 1, entries: [
    createManualWealthHistoryEntry(historyAmounts(100), '2026-01-01')
] } }) };
const startRegistry = { version: 1, profiles: { a: { meta: { name: 'Alva' }, data: startData } } };
for (const now of [new Date(2026, 0, 5), new Date(2027, 0, 5)]) {
    const projected = projectOverview({ registry: startRegistry, activeId: 'a', liveData: startData, now });
    renderOverview(doc, projected);
    assert(!focus.innerHTML.includes('Klärung nötig'), 'Erstes Jahr und erster Abschluss zeigen keinen Klärungschip');
    assertEqual(doc.getElementById('overviewPlanningYearValue').textContent, now.getFullYear() + ' · Vorschau', 'Kopfpille bleibt aktuelles Planungsjahr');
    if (now.getFullYear() === 2026) {
        assertEqual(projected.occasion.kind, 'start', 'Januar zeigt ruhigen Planungsbeginn');
        assert(doc.getElementById('overviewLead').textContent.includes('Erstes Planungsjahr 2026'), 'Starttext nennt ersten relevanten Abschluss');
        assert(!focus.innerHTML.includes('Dezember') && !focus.innerHTML.includes('data-overview-month'), 'Kein Dezemberabschluss und keine Bereitstellung vor Planungsbeginn');
        assert(!focus.innerHTML.includes('Alle Personen sind importiert'), 'Kein unechter Importhaken vor Beginn');
        assertEqual(doc.getElementById('overviewYearTitle').textContent, '2026 bisher', 'Kein Rückblick auf 2025');
    } else {
        assert(focus.innerHTML.includes('Abschluss starten'), 'Erster Abschluss nutzt bisherigen Balanceweg');
        assertEqual(doc.getElementById('overviewYearTitle').textContent, '2026 im Rückblick', 'Erster regulärer Abschluss zeigt Rückblick');
    }
}
for (const [annualReason, snippet] of [
    ['missing_commit', 'Für 2026 gibt es Daten, aber keinen Abschlussvermerk. Bitte den Jahresstatus im Abschlussdialog einmal bestätigen.'],
    ['contradictory_metadata', 'Die Abschlussvermerke für 2026 widersprechen sich. Bitte den Jahresstatus in der Balance prüfen.'],
    ['invalid_evidence', 'Gespeicherte Belege für 2026 sind beschädigt. Bitte die Daten in der Balance prüfen.']
]) {
    renderOverview(doc, { ...focusBase, occasion: { ...focusBase.occasion, annualState: 'unclear', annualReason } });
    assert(!doc.getElementById('overviewLead').textContent.includes(snippet), 'Lead verdoppelt Klärungsgrund nicht: ' + annualReason);
    assertEqual((focus.innerHTML.match(new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1,
        'Fokus nennt den eigenen Jahresgrund genau einmal: ' + annualReason);
    assert(focus.innerHTML.includes('data-overview-annual') && focus.innerHTML.includes('Jahresstatus klären'), 'Klärung behält Jahresziel');
}

// P8: neue Kartenprojektion und Bindung bleiben ohne Speicherwrites.
const { evaluateWealthHistory } = await import('../app/tranches/tranchen-history-model.js');
const { bindOverviewHistory, renderOverviewHistory } = await import('../app/overview/overview-history.js');
const { historyDay } = await import('../app/tranches/tranchen-history-store.js');
const historyStart = historyDay('2026-01-01');
// Das Quell-DOM-Doppel parst innerHTML nicht; nur sichtbaren Text auslesen, keine Attribute.
const historyStatusText = () => doc.getElementById('overviewHistoryStatus').innerHTML.replace(/<[^>]*>/g, '');
const historyView = { ...focusBase, historyPeriod: 'all', history: { status: 'ready', startDate: '2026-01-01', hints: [], ...evaluateWealthHistory({
    startDate: '2026-01-01', today: '2026-01-06', profiles: [{ id: 'a', currentCash: 100, cashHistory: { version: 1, baselineValue: 100, entries: [] },
        lots: [{ trancheId: 'history-lot', purchaseDate: '2026-01-01', shares: 1, purchasePrice: 10, type: 'anleihe', ticker: 'BOND', name: '<Bond>' }] }],
    prices: { symbols: { BOND: { currency: 'EUR', days: [historyStart], closes: [10], queried: [[historyStart, historyStart + 1]], failures: 0, lastError: null } } }
}) } };
const historyBytes = JSON.stringify(historyView);
renderOverviewHistory(doc, historyView);
assertEqual(JSON.stringify(historyView), historyBytes, 'Übersicht erhält vollständige Tagesreihe und Kennzahlenbytes');
const historyCss = fs.readFileSync(new URL('../css/wealth-history.css', import.meta.url), 'utf8');
assert(css.includes('.overview-allocation-aktien { background: var(--history-aktien_alt); }')
    && historyCss.includes('.history-aktien { fill: var(--history-aktien_alt); background: var(--history-aktien_alt); }'), 'Gebündelte Aktien nutzen dunkles Messing');
for (const [old, fresh, expected] of [[600000, 400000, 1000000], [600000, 0, 600000], [0, 400000, 400000], [0, 0, 0], [null, 400000, null]]) {
    const points = historyView.history.points.map((p, i) => ({ ...p, total: expected === null ? null : expected + 100,
        known: expected === null ? 400100 : expected + 100, allocation: Object.freeze({ aktien_alt: old, aktien_neu: fresh, cash: 100 }) }));
    const source = { ...historyView.history, types: ['aktien_alt', 'aktien_neu', 'cash'], points, end: points.at(-1) };
    const before = JSON.stringify(source);
    renderOverviewHistory(doc, { ...historyView, history: source });
    const chart = doc.getElementById('overviewHistoryChart').innerHTML, legend = doc.getElementById('overviewHistoryLegend').innerHTML;
    assertEqual((chart.match(/class="history-area history-aktien"/g) || []).length, 0, 'Ausschnitt erzeugt keine Aktienfläche');
    assert(!legend.includes('<b>') && !legend.includes('overview-allocation-'), 'Aufteilung mit Beträgen ist in den Verlaufsreiter verschoben');
    assert(!chart.includes('history-aktien_alt') && !chart.includes('history-aktien_neu') && !/NaN|Infinity/.test(chart), 'Keine doppelten Aktienflächen oder ungültige Geometrie');
    assertEqual(JSON.stringify(source), before, 'Verlaufsrenderer erhält Fachbytes');
}
const overviewStyles = selector => Object.assign({}, ...rules('css/overview.css', css).filter(rule => rule.selector === selector).map(rule => rule.declarations));
for (const [sign, token] of [['positive', 'good'], ['negative', 'bad'], ['zero', 'text-main'], ['missing', 'text-muted']]) {
    assertEqual(overviewStyles(`.overview-history [data-history-sign="${sign}"]`).color, `var(--${token})`, 'Vorzeichenfarbe verwendet bestehenden Token: ' + sign);
}
assertEqual(overviewStyles('.overview-history .history-chart').height, '176px', 'Kompakte Übersichtshöhe unabhängig von Kartenbreite');
assert(!historyCss.includes('min-width: 700px'), 'Gemeinsame SVGklasse erzwingt keine Mindestbreite in Kleinverläufen');
for (const [value, sign] of [[25, 'positive'], [-25, 'negative'], [0, 'zero'], [null, 'missing']]) {
    renderOverviewHistory(doc, { ...historyView, history: { ...historyView.history,
        metrics: { ...historyView.history.metrics, change: value, adjusted: value } } });
    assertEqual((doc.getElementById('overviewHistoryMetrics').innerHTML.match(new RegExp(`data-history-sign="${sign}"`, 'g')) || []).length,
        1, 'Veränderung behält Vorzeichenstatus: ' + sign);
}
renderOverviewHistory(doc, historyView);
assertEqual((doc.getElementById('overviewHistoryMetrics').innerHTML.match(/class="history-metric"/g) || []).length, 2, 'Startseitenverlauf besitzt höchstens zwei Kennzahlen');
assert(doc.getElementById('overviewHistoryChart').innerHTML.includes('history-total-area'), 'Positive Anleihenreihe zeigt Gesamtfläche');
assert(!doc.getElementById('overviewHistoryLegend').innerHTML.includes('Anleihen') && doc.getElementById('overviewHistoryMetrics').innerHTML.includes(formatDisplayNumber(110, { unit: 'currency', fractionDigits: 0 })), 'Gesamtfläche erklärt die Gesamtlinie; Tagesendwert steht in der Kennzahl');
assert(historyStatusText().includes('Ungeprüfte Werktage') && historyStatusText().includes('rückwirkend angenommen'), 'Lücke und Cashbasis getrennt benannt');
assert(doc.getElementById('overviewHistoryStand').textContent.includes('05.01.2026') && !doc.getElementById('overviewHistoryStand').textContent.includes('Kurse von heute'), 'Schlusskursstichtag getrennt vom heutigen Bestand');
const holidayOverviewInput = { startDate: '2026-01-01', today: '2026-01-07',
    profiles: [{ id: 'a', currentCash: 100, cashHistory: { version: 1, baselineValue: 100, entries: [] },
        lots: [{ trancheId: 'holiday', purchaseDate: '2025-12-15', shares: 10, purchasePrice: 200, type: 'anleihe', ticker: 'BOND', name: 'Feiertag' }] }],
    prices: { symbols: { BOND: { currency: 'EUR', days: [historyStart + 1, historyStart + 4, historyStart + 5],
        closes: [100, 120, 110], queried: [[historyStart, historyStart + 5]] } } }
};
for (const period of ['all', 'year', '12m']) {
    renderOverviewHistory(doc, { historyPeriod: period, history: { status: 'ready', startDate: '2026-01-01', hints: [],
        ...evaluateWealthHistory({ ...holidayOverviewInput, period }) } });
    const html = doc.getElementById('overviewHistoryMetrics').innerHTML;
    assert(html.includes('seit 02.01.2026 bis 06.01.2026'), period + ': Tagesvergleich nennt die tatsächliche Basis statt Jahresendstand');
    assert(historyStatusText().includes('Messbeginn 02.01.2026 · vorläufig'), period + ': sichtbarer tatsächlicher Messbeginn und Vorläufigkeit');
    assert(!doc.getElementById('overviewHistorySource').textContent.includes('Messbeginn') && doc.getElementById('overviewHistorySource').textContent.startsWith('Schlusskurse und bestätigte Bestände'), period + ': Fußzeile ohne zweiten Messbeginn');
    const hints = [...doc.getElementById('overviewHistoryStatus').innerHTML.matchAll(/<span class="history-measurement" title="([^"]+)">([^<]+)<\/span>/g)];
    assertEqual(hints.length, 1, period + ': genau ein sichtbarer gemeinsamer Hinweis');
    assertEqual(hints[0][2], 'Messbeginn 02.01.2026 · vorläufig', period + ': gemeinsame Basis ohne Duplikate');
    assert(hints[0][1].includes('ersten bewertbaren Tagesabschluss'), period + ': Titel erklärt verkürzte Messbasis');
    for (const value of [100, 1200]) assert(html.includes(formatDisplayNumber(value, { unit: 'currency', fractionDigits: 0 })), period + ': berechneter Kennzahlenwert ' + value);
    assert(html.includes('9,1') && html.includes('06.01.2026') && !html.includes('Größter Rückgang'), period + ': Prozent und Endtag sichtbar; Vertiefung im Verlaufsreiter');
    assert(!html.includes('Nicht verfügbar') && !html.includes('vorläufig'), period + ': beide Kennzahlen ohne Vorläufigkeitsanhänge');
    const values = [...html.matchAll(/<strong[^>]*>([^<]+)<\/strong>/g)].map(match => match[1].replace(/\s+/g, ' ').trim());
    assertEqual(JSON.stringify(values), JSON.stringify(['1.200 €', '+100 €']), period + ': Tagesabschluss und Feiertagsveränderung bleiben exakt');
}
const completeHistory = { status: 'ready', startDate: '2026-01-01', hints: [], ...evaluateWealthHistory({
    ...holidayOverviewInput, profiles: [{ ...holidayOverviewInput.profiles[0], cashHistory: { version: 1, baselineValue: 100, entries: [{ date: '2026-01-01', value: 100 }] } }],
    prices: { symbols: { BOND: { ...holidayOverviewInput.prices.symbols.BOND,
        days: [historyStart, ...holidayOverviewInput.prices.symbols.BOND.days], closes: [100, ...holidayOverviewInput.prices.symbols.BOND.closes] } } }
}) };
assertEqual(completeHistory.metrics.status, 'complete', 'Gegenprobe verwendet tatsächlich vollständig bewertbare Reihe');
for (const state of [completeHistory, { ...historyView.history, measurementStart: null, metrics: { status: 'unavailable' } },
    { status: 'corrupt', error: '<synthetischer Fehler>' }, { status: 'missing' }, completeHistory]) {
    renderOverviewHistory(doc, { history: state });
    const statusHtml = doc.getElementById('overviewHistoryStatus').innerHTML;
    assert(!statusHtml.includes('Verkürzte Messbasis') && !statusHtml.includes('vorläufig'), 'Statuswechsel entfernt alten vorläufigen Titel und Text');
    assert(!statusHtml.includes('<synthetischer Fehler>'), 'Fehlertext bleibt escaped');
    if (state.status !== 'ready') assert(!statusHtml.includes('history-measurement'), 'Fehlende oder beschädigte Historie behält keinen veralteten Hinweis');
}
assertEqual(doc.getElementById('overviewHistorySource').textContent,
    'Schlusskurse und bestätigte Bestände; Tagesgeld aus erfassten Ständen.', 'Fußzeile nennt die Grundlage; ausführliche Lesehilfe im Verlaufsreiter');
renderOverviewHistory(doc, { ...historyView, historyReport: { status: 'running' } });
assert(historyStatusText().includes('nachgeladen'), 'Laufender Abruf lässt Grafik sichtbar');
renderOverviewHistory(doc, { ...historyView, historyReport: { status: 'cancelled' } });
assert(historyStatusText().includes('abgebrochen'), 'Abbruchstatus bewahrt Tagesgrafik');
renderOverviewHistory(doc, { ...historyView, history: { status: 'missing' } });
assertEqual(doc.getElementById('overviewHistoryChart').innerHTML, '', 'Leerzustand löscht alte Grafik');
assert(historyStatusText().includes('Noch keine'), 'Keine Demohistorie im Leerzustand');
const historyEvents = {}, historyButtons = { addEventListener: (event, fn) => { historyEvents[event] = fn; } };
const bindingDoc = { getElementById: id => id === 'overviewHistoryPeriods' ? historyButtons : null };
const saved = { rs_daily_prices_v1: null, rs_wealth_history_start_v1: null };
let refreshes = 0, writes = 0, cleared = false, poll;
const historyWindow = { setInterval: fn => { poll = fn; return 1; }, clearInterval: () => { cleared = true; }, addEventListener() {}, removeEventListener() {} };
const historyStorage = { getItem: key => saved[key], setItem: () => { writes++; } };
const binding = bindOverviewHistory({ doc: bindingDoc, win: historyWindow, storage: historyStorage, refresh: () => { refreshes++; } });
for (const period of ['year', '12m', 'all']) {
    historyEvents.click({ target: { closest: () => ({ dataset: { historyPeriod: period } }) } });
    assertEqual(binding.period, period, 'Zeitraumwechsel ' + period);
}
assertEqual(writes, 0, 'Zeitraumwechsel schreibt nichts');
assertEqual(bindOverviewHistory({ doc: bindingDoc }), binding, 'Einmalige Bindung pro Dokument');
let complete;
const watched = new Promise(resolve => { complete = resolve; });
binding.watch(watched);
poll();
const unchanged = refreshes;
poll();
assertEqual(refreshes, unchanged, 'Unveränderter bestätigter Stand rendert nicht erneut');
saved.rs_daily_prices_v1 = JSON.stringify({ version: 1, symbols: {} }); poll();
assertEqual(refreshes, unchanged + 1, 'Bestätigter neuer Stand rendert lesend');
complete({ status: 'budget-ended' });
await watched; await Promise.resolve(); await Promise.resolve();
assert(cleared && binding.report.status === 'budget-ended', 'Jobende entfernt Aktualisierung und zeigt Restbudgetstatus');
assertEqual(writes, 0, 'Auch Nachladeprojektion schreibt nichts');

// Reale Renderer-/Binderpfade, nur Geometrie, Beobachter und Frames werden injiziert.
const { bindHistoryChartSize } = await import('../app/tranches/tranchen-history-svg.js');
function sizeWindow(withObserver = true) {
    const frames = new Map(), listeners = new Map(), observers = [], removals = [];
    let sequence = 0, requests = 0;
    class Observer {
        constructor(callback) { this.callback = callback; observers.push(this); }
        observe(host) { this.host = host; }
        disconnect() { this.disconnected = true; }
        emit(width, height = 292) { this.callback([{ target: this.host, contentRect: { width, height } }]); }
    }
    class Removal {
        constructor(callback) { this.callback = callback; removals.push(this); }
        observe() {}
        disconnect() { this.disconnected = true; }
    }
    return { frames, listeners, observers, removals, MutationObserver: Removal,
        ...(withObserver ? { ResizeObserver: Observer } : {}),
        requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
        cancelAnimationFrame: id => frames.delete(id),
        addEventListener: (name, callback) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(callback); },
        removeEventListener: (name, callback) => listeners.get(name)?.delete(callback),
        fetch: () => { requests++; }, get requests() { return requests; },
        frame() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); },
        event(name) { [...(listeners.get(name) || [])].forEach(callback => callback()); }
    };
}
const pixelDoc = createPresentationTestDocument(), pixelWin = sizeWindow();
pixelDoc.defaultView = pixelWin; pixelDoc.documentElement = pixelDoc.body;
for (const id of ['overviewHistoryChart', 'overviewHistoryPeriods', 'overviewHistoryMetrics', 'overviewHistoryLegend', 'overviewHistoryStatus', 'overviewHistoryStand']) {
    const node = pixelDoc.createElement('div'); node.id = id; pixelDoc.body.appendChild(node);
}
const pixelHost = pixelDoc.getElementById('overviewHistoryChart');
pixelHost.isConnected = true; pixelHost.clientWidth = 1200; pixelHost.clientHeight = 292;
const periodButton = pixelDoc.createElement('button'); periodButton.dataset = { historyPeriod: 'year' };
pixelDoc.querySelectorAll = () => [periodButton]; pixelDoc.activeElement = periodButton;
let pixelRefreshes = 0, pixelWrites = 0;
const pixelStorage = { getItem: () => null, setItem: () => { pixelWrites++; } };
const pixelInput = { startDate: '2025-01-01', today: '2026-01-06', profiles: [{ id: 'pixel', currentCash: 100, lots: [],
    cashHistory: { baselineValue: 100, entries: [] } }] };
const pixelView = period => ({ historyPeriod: period, history: { status: 'ready', startDate: pixelInput.startDate, hints: [],
    ...evaluateWealthHistory({ ...pixelInput, period }) } });
const pixelAll = pixelView('all'), pixelBytes = JSON.stringify(pixelAll);
const pixelBinding = bindOverviewHistory({ doc: pixelDoc, win: pixelWin, storage: pixelStorage, refresh: () => {
    pixelRefreshes++;
    renderOverviewHistory(pixelDoc, pixelView(pixelBinding.period));
} });
renderOverviewHistory(pixelDoc, pixelAll);
assert(pixelHost.innerHTML.includes('viewBox="0 0 1200 292"'), 'Erstmontage zeichnet gemessene Pixelgröße');
const initialSvg = pixelHost.innerHTML;
for (const width of [1200, 0, -1, NaN, Infinity]) pixelWin.observers[0].emit(width);
assertEqual(pixelWin.frames.size, 0, 'Gleiche und ungültige Größen planen keinen Frame');
pixelWin.frame();
assertEqual(pixelHost.innerHTML, initialSvg, 'Gleiche und ungültige Größen zeichnen nicht erneut');
for (const width of [1300, 1400, 1800]) pixelWin.observers[0].emit(width);
assertEqual(pixelWin.frames.size, 1, 'Mehrere Größenmeldungen belegen genau einen Frame');
pixelWin.frame();
assert(pixelHost.innerHTML.includes('viewBox="0 0 1800 292"'), 'Größenserie zeichnet nur letzte Meldung');
const coalescedSvg = pixelHost.innerHTML;
pixelWin.observers[0].emit(1900); pixelWin.observers[0].emit(1800); pixelWin.frame();
assertEqual(pixelHost.innerHTML, coalescedSvg, 'Rückkehr zur bestehenden Größe verwirft vorgemerkte Änderung');
assertEqual(pixelRefreshes + pixelWrites + pixelWin.requests, 0, 'Resize ohne Fachrefresh, Storagewrite oder Kursrequest');
const ancillary = ['overviewHistoryMetrics', 'overviewHistoryLegend', 'overviewHistoryStatus'].map(id => pixelDoc.getElementById(id).innerHTML || pixelDoc.getElementById(id).textContent);
pixelWin.observers[0].emit(2000); pixelWin.frame();
assertEqual(JSON.stringify(['overviewHistoryMetrics', 'overviewHistoryLegend', 'overviewHistoryStatus'].map(id => pixelDoc.getElementById(id).innerHTML || pixelDoc.getElementById(id).textContent)), JSON.stringify(ancillary), 'Resize ersetzt ausschließlich Grafik');
pixelHost.clientWidth = 2000;
pixelDoc.getElementById('overviewHistoryPeriods').events.get('click')({ target: { closest: () => periodButton } });
assertEqual(pixelRefreshes, 1, 'Zeitraumwahl behält bestehenden fachlichen Refresh');
assertEqual(periodButton.getAttribute('aria-pressed'), 'true', 'Zeitraumwahl aktualisiert Auswahlzustand');
assertEqual(pixelDoc.activeElement, periodButton, 'Resize und Zeitraumwahl erhalten Fokus');
assert(!pixelHost.innerHTML.includes('01.01.2025') && pixelHost.innerHTML.includes('01.01.2026'), 'Zeitraumwahl ersetzt tatsächlichen Zeichnungsbereich');
pixelWin.observers[0].emit(2050); pixelWin.frame();
assert(!pixelHost.innerHTML.includes('01.01.2025') && pixelHost.innerHTML.includes('01.01.2026'), 'Resize verwendet weiter die ausgewählte Zeitraumprojektion');
const replacement = { ...historyView, history: { ...historyView.history,
    points: historyView.history.points.map(point => ({ ...point, total: 777, known: 777, allocation: { anleihe: 0, cash: 777 } })) } };
renderOverviewHistory(pixelDoc, replacement);
pixelWin.observers[0].emit(2100); pixelWin.frame();
assert(pixelHost.innerHTML.includes('777 €'), 'Re-Render ersetzt flüchtige Projektion für folgenden Resize');
assertEqual(pixelWin.observers.length, 1, 'Re-Render bindet keinen zweiten Größenbeobachter');
assertEqual(pixelWrites + pixelWin.requests, 0, 'Zeitraumwechsel und Re-Render bleiben schreib-/abruffrei');
assertEqual(JSON.stringify(historyView), historyBytes, 'Größenbehandlung und Auswahl erhalten alle Fachbytes');
assertEqual(JSON.stringify(pixelAll), pixelBytes, 'Zeitraumwahl und Resize verändern vollständige Originalprojektion nicht');
pixelWin.observers[0].emit(2200);
pixelHost.isConnected = false; pixelWin.removals[0].callback();
assert(pixelWin.observers[0].disconnected && pixelWin.removals[0].disconnected && pixelWin.frames.size === 0,
    'Entfernter Host räumt Beobachter und vorgemerkten Frame auf');
assertEqual(pixelWin.listeners.get('pagehide').size, 0, 'Entfernter Host entfernt Seitenendlistener');
const removedSvg = pixelHost.innerHTML;
pixelWin.observers[0].emit(2300); pixelWin.frame();
assertEqual(pixelHost.innerHTML, removedSvg, 'Späte Meldung zeichnet entfernten Host nicht');
for (const withObserver of [true, false]) {
    const fallbackWin = sizeWindow(withObserver), fallbackHost = { ownerDocument: pixelDoc, isConnected: true, clientWidth: 900, clientHeight: 290 };
    const draws = [];
    const chart = bindHistoryChartSize(fallbackHost, (value, size) => draws.push([value, size]), { win: fallbackWin });
    chart.update('Detailprojektion');
    assertEqual(draws[0][1].height, 290, 'Gemeinsame Größenbindung erlaubt kompakte Detailhöhe');
    fallbackHost.clientWidth = 1000;
    if (withObserver) fallbackWin.observers[0].emit(1000, 290); else fallbackWin.event('resize');
    fallbackWin.frame();
    assertEqual(draws.at(-1)[1].width, 1000, 'Beobachter oder Resizefallback zeichnet neue Breite');
    fallbackHost.clientWidth = 1100;
    if (withObserver) fallbackWin.observers[0].emit(1100, 290); else { fallbackWin.event('resize'); fallbackWin.event('resize'); }
    assertEqual(fallbackWin.frames.size, 1, 'Auch Fallback bündelt Größenmeldungen');
    fallbackWin.event('pagehide');
    assert(fallbackWin.frames.size === 0 && fallbackWin.removals[0].disconnected
        && [...fallbackWin.listeners.values()].every(set => set.size === 0), 'Seitenende räumt Frames und alle Listener auf');
    if (withObserver) assert(fallbackWin.observers[0].disconnected, 'Seitenende trennt ResizeObserver');
}
assert(html.includes('data-history-period="all" aria-pressed="true"') && html.includes('role="group" aria-label="Zeitraum"'), 'Native Zeitraumknöpfe mit zugänglichem Auswahlzustand');

// Echte Flushgrenze statt eines künstlichen bestätigten Rohrecords.
const { commitHistoryRecords, readDailyPrices, DAILY_PRICES_KEY } = await import('../app/tranches/tranchen-history-store.js');
const oldPrices = JSON.stringify({ version: 1, symbols: {} });
const newPrices = JSON.stringify({ version: 1, symbols: { TEST: { currency: 'EUR', days: [historyStart], closes: [10], queried: [[historyStart, historyStart]], failures: 0, lastError: null } } });
let rawPrices = oldPrices, finishFlush;
const pendingStorage = { getItem: () => rawPrices, setItem: (_, raw) => { rawPrices = raw; }, removeItem: () => { rawPrices = null; } };
const committing = commitHistoryRecords([[DAILY_PRICES_KEY, newPrices]], { storage: pendingStorage, flush: () => new Promise(resolve => { finishFlush = resolve; }) });
assertEqual(rawPrices, newPrices, 'Flushkandidat liegt bereits im Livecache');
assertEqual(readDailyPrices(pendingStorage).raw, oldPrices, 'Verlaufsprojektion sieht keinen unbestätigten Kurskandidaten');
finishFlush(true); await committing;
assertEqual(readDailyPrices(pendingStorage).raw, newPrices, 'Erst bestätigter Flush gibt neuen Kursstand frei');

{
    const partial = evaluateWealthHistory({ ...holidayOverviewInput, profiles: [{ id: 'a', currentCash: 100,
        lots: [{ ...holidayOverviewInput.profiles[0].lots[0], shares: 2 },
            { status: 'unknown', remainingShares: 1, tranche: { ...holidayOverviewInput.profiles[0].lots[0], trancheId: 'unknown', purchaseDate: '2026-01-05' } }] }] });
    renderOverviewHistory(doc, { history: { status: 'ready', startDate: '2026-01-01', hints: [], ...partial } });
    const text = historyStatusText().replace(/\s+/g, ' ');
    assert(text.includes('Teilabdeckung · bekannter Betrag 320 €') && text.includes('Gesamtwert nicht vollständig bewertbar'),
        'Übersicht nennt echte bekannte Beiträge trotz unbekannter Tranche derselben Anlageform');
    assert(text.includes('ursprünglicher Kaufbeginn nicht gesichert'), 'Sichtbarer Altfallhinweis statt rückdatierter Nullannahme');
    assert(doc.getElementById('overviewHistoryMetrics').innerHTML.includes('nicht vollständig bewertbar') && partial.metrics.change === null,
        'Bekannter Teilbetrag ist kein vollständiger Kennzahlenwert');
}

// Aufteilung und Beträge stehen im Verlaufsreiter; die Übersicht behält den vollständigen Endwert.
for (const unknownEnd of [false, true]) {
    const points = historyView.history.points.map((p, i, all) => ({ ...p, total: unknownEnd && i === all.length - 1 ? null : 212000,
        known: 212000, allocation: { aktien_alt: 80000, aktien_neu: 20000, geldmarkt: 50000, cash: 42000, gold: unknownEnd && i === all.length - 1 ? null : 20000, anleihe: 0 } }));
    const mixed = { ...historyView.history, points, end: points.at(-1), types: ['aktien_alt', 'aktien_neu', 'geldmarkt', 'cash', 'gold', 'anleihe'] };
    const bytes = JSON.stringify(mixed);
    renderOverviewHistory(doc, { ...historyView, history: mixed });
    const legend = doc.getElementById('overviewHistoryLegend').innerHTML;
    assert(legend.includes('history-total-key') && !legend.includes('<b>'), 'Gesamtfläche erklärt Gesamtlinie ohne weitere Betragskennzahlen');
    assert(doc.getElementById('overviewHistoryMetrics').innerHTML.includes(unknownEnd ? '—' : '212.000'), 'Fehlender Endwert erhält keinen Ersatzbetrag');
    assertEqual(JSON.stringify(mixed), bytes, 'Kompakte Anzeige erhält Eingangsbytes');
}

// Umsetzen des wirklichen Knotens erhält die bereits gebundene Delegation.
const grid = doc.getElementById('overviewNormal');
const assetsCard = doc.createElement('section'); assetsCard.className = 'overview-assets';
const planCard = doc.createElement('section'); planCard.className = 'overview-plan';
grid.append(focus, assetsCard, doc.getElementById('overviewYearBand'), planCard);
const focusListener = focus.events.get('click');
for (const kind of ['play', 'monthly', 'annual', 'start', 'play']) {
    renderOverview(doc, { ...focusBase, nextSteps: [], occasion: { ...focusBase.occasion, kind } });
    assertEqual(grid.children.filter(node => node === focus).length, 1, kind + ': genau ein bestehender Fokusknoten');
    assertEqual(grid.children[0], focus, kind + ': tatsächliche DOM-Reihenfolge entspricht Anlass');
    assertEqual(focus.className.includes('ds-card'), ['monthly', 'annual'].includes(kind), kind + ': nur Abschlussanlässe haben eine Fokuskarte');
    assertEqual(focus.hasAttribute('aria-labelledby'), ['monthly', 'annual'].includes(kind), kind + ': Titelreferenz folgt der sichtbaren Karte');
    assertEqual(focus.events.get('click'), focusListener, kind + ': delegierter Listener bleibt am selben Knoten');
}
const playModel = { ...monthly, nextSteps: [{ id: 'cash', title: 'Cashstatus prüfen', href: 'depot-tranchen-manager.html' }], occasion: { ...monthly.occasion, kind: 'play', annualState: 'done' } };
renderOverview(doc, playModel);
assertEqual(doc.getElementById('overviewTitle').textContent, 'Ein Schritt offen: Cashstatus prüfen', 'Eine offene Cashbuchung verhindert Alles erledigt');
assert(doc.getElementById('overviewLead').innerHTML.includes('data-next-step="cash"') && doc.getElementById('overviewLead').innerHTML.includes('data-profile-handoff'), 'Offener Schritt hat bedienbaren Managerlink mit Profilhandoff');
renderOverview(doc, { ...playModel, summary: { ...monthly.summary, liquidityBefore: 67.5, liquidityAfter: 103.1, actionBasis: { material: true } } });
assertEqual(doc.getElementById('overviewLiquidity').textContent, '67,5\u00a0% heute · 103,1\u00a0% nach Umsetzung', 'Liquidität unterscheidet Ist und Planfolge ohne fachliche Abrundung');
renderOverview(doc, { ...playModel, summary: { ...monthly.summary, liquidityBefore: 103.1, liquidityAfter: 103.1, actionBasis: { material: false } } });
assertEqual(doc.getElementById('overviewLiquidity').textContent, '103,1\u00a0% des Ziels', 'Gleiche Werte ohne Handlung zeigen nur Zielstand');
// Echte Musterrecords durch den produktiven Projektor und Renderer.
{
    const records = createMusterHaushaltRecords('2027-07-01');
    const model = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_active_profile,
        liveData: records, now: new Date(2027, 6, 1, 12) });
    renderOverview(doc, model);
    assertEqual(model.occasion.kind, 'play', 'Echter Musterstart rendert ruhigen Anlass');
    assertEqual(doc.getElementById('overviewPlanStatus').textContent, 'festgeschrieben', 'Muster-Jahresbeleg zeigt den festgeschriebenen Plan');
    assert(doc.getElementById('overviewPlanComparison').innerHTML.includes('Plan 2027 · festgeschrieben am 01.01.2027'), 'Musterstart zeigt den Planvergleich mit Abschlussdatum');
    assert(!focus.innerHTML.includes('overview-play') && !focus.className.includes('ds-card'), 'Frischer Musterstart hat keine Durchspielen-Karte');
    assert(!focus.innerHTML.includes('data-overview-month-confirm') && !focus.innerHTML.includes('Abschluss starten'), 'Keine Abschlussaktion am Start');
    assertEqual(doc.getElementById('overviewHouseholdNames').textContent, 'Max + Erika', 'Musterkopf nennt beide Vornamen');
    const people = doc.getElementById('overviewPeople').innerHTML;
    for (const [id, name, initial] of [['muster_a', 'Max', 'M'], ['muster_b', 'Erika', 'E']]) {
        assert(people.includes(`data-overview-person="${id}"><span class="overview-avatar" aria-hidden="true">${initial}</span><div>${name}<small>`),
            name + ': eigene nicht leere Initiale am echten Profil');
    }
    for (const [now, kind] of [[new Date(2027, 6, 2, 12), 'play'], [new Date(2027, 7, 1, 12), 'monthly'], [new Date(2028, 0, 2, 12), 'annual']]) {
        const moved = projectOverview({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_active_profile, liveData: records, now });
        renderOverview(doc, moved);
        assertEqual(moved.occasion.kind, kind, 'Renderer folgt demselben gestarteten Bestand');
        if (kind === 'monthly') assert(focus.innerHTML.includes('Juli abschließen'), 'Folgemonat bietet echten Monatsweg');
        if (kind === 'annual') assert(focus.innerHTML.includes('data-overview-annual'), 'Jahreswechsel bietet echten Jahresweg');
    }
}

// P13b: Titel, Anlass und gemeinsame Kennungen aus echten Livequellen.
for (const now of [new Date(2027, 0, 15, 12), new Date(2027, 9, 15, 12)]) {
    const { CONFIG } = await import('../app/balance/balance-config.js');
    const source = { depot_tranchen: '[]', profile_tagesgeld: '100',
        [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ annualPeriodMetadata: { schemaVersion: 1, lastCommittedPeriod: null, pendingCommit: null } }),
        balance_expenses_v1: JSON.stringify({ version: 1, activeYear: 2026, years: { 2026: { months: {} } } }) };
    const actual = projectOverview({ registry: { version: 1, profiles: { a: { meta: { name: 'A' }, data: source } } }, activeId: 'a', liveData: source, now });
    const before = JSON.stringify(actual);
    renderOverview(doc, actual);
    assertEqual(actual.occasion.annualState, 'open', 'Echte Vorjahresinitialisierung zeigt fälligen Jahresfokus auch außerhalb Januar');
    assert(doc.getElementById('overviewTitle').textContent.includes('und Jahr 2026 abschließen'), 'Echte Projektion ersetzt Erledigtmeldung durch Jahresabschluss');
    assertEqual(doc.getElementById('overviewTitle').textContent, `${now.getMonth() === 0 ? 'Dezember' : 'September'} und Jahr 2026 abschließen`, 'Produktiver Kalender benennt tatsächlichen Vormonat');
    assert(focus.innerHTML.includes('data-overview-annual') && focus.innerHTML.includes('Abschluss starten'), 'Fälliger Jahresfokus bleibt mit bisherigem Ziel bedienbar');
    assert(!focus.innerHTML.includes('overview-year-action') && !focus.innerHTML.includes('Import öffnen'), 'Offene Jahreskarte enthält keine Inline-Schrittliste');
    assertEqual(JSON.stringify(actual), before, 'Startseitenrender verändert keine Quellen oder Enginewerte');
}

// Tagesveränderung und zugängliche Basisannahme bei fehlender Historie.
{
    const profiles = [{ id: 'a', currentCash: 80, lots: [], cashHistory: { version: 1, baselineValue: 100,
        entries: [{ date: '2026-01-02', value: 80 }] } }, { id: 'b', currentCash: 50, lots: [] }];
    for (const allMissing of [false, true]) {
        const history = { status: 'ready', startDate: '2026-01-01', hints: [], ...evaluateWealthHistory({ startDate: '2026-01-01', today: '2026-01-04',
            profiles: profiles.map(profile => allMissing ? { ...profile, cashHistory: null } : profile) }) };
        renderOverviewHistory(doc, { history });
        const html = doc.getElementById('overviewHistoryMetrics').innerHTML;
        const values = [...html.matchAll(/<strong[^>]*>([^<]+)<\/strong>/g)].map(match => match[1].replace(/\s+/g, ' ').trim());
        assertEqual(values[1], allMissing ? '0 €' : '-20 €', 'Veränderung bleibt nach Entnahmen gerechnet');
        assert(historyStatusText().includes('vorläufig'), 'Anzeige behauptet keinen vollständigen Verlauf');
        assert(doc.getElementById('overviewHistoryStatus').innerHTML.includes('rückwirkend angenommene Tagesgeldstände'), 'Basisannahme bleibt als zugänglicher Erklärungstitel erhalten');
    }
}

{
    const model = { available: true, year: 2026, now: new Date(2026, 9, 8), nextSteps: [],
        occasion: { kind: 'play', previousYear: 2026, previousMonth: 9 },
        cashWarnings: [{ id: 'a&b', name: '<A & B>', date: '2026-09-02' }] };
    const before = JSON.stringify(model);
    renderOverview(doc, model);
    const focus = doc.getElementById('overviewFocus').innerHTML;
    assert(focus.includes('Tagesgeld zuletzt am 02.09.2026 aktualisiert'), 'Ruhiger Fokus erhält namentlichen Tagesgeldhinweis');
    assert(focus.includes('class="overview-card-link"') && focus.includes('&lt;A &amp; B&gt;') && focus.includes('person=a%26b#profileTagesgeld'), 'Frischehinweis und passendes Personenziel sind text-sicher');
    assertEqual(JSON.stringify(model), before, 'Renderer verändert keine Fachquelle');
    renderOverview(doc, { ...model, cashWarnings: [{ ...model.cashWarnings[0], confirmedDate: '2026-09-10' }] });
    assert(doc.getElementById('overviewFocus').innerHTML.includes('aktualisiert · bestätigt am 10.09.2026'), 'Fälliger Hinweis nennt Wertänderung und Bestätigung getrennt');
}

renderOverview(doc, { ...focusBase, exampleExpensesAllowed: false });
assert(!focus.innerHTML.includes('data-overview-example'), 'Normalbetrieb erzeugt keine Beispielaktionen');
renderOverview(doc, { ...focusBase, occasion: { ...focusBase.occasion, annualState: 'unclear' }, exampleExpensesAllowed: true });
assert(!focus.innerHTML.includes('data-overview-example') && !focus.innerHTML.includes('Beispiele für alle'), 'Ungeklärter Jahresstatus bietet auch im Spielbereich keine Ausgabenaktionen an');

renderOverview(doc, monthly);
assertEqual((focus.innerHTML.match(/Rund 5 Minuten/g) || []).length, 1, 'Monatskarte enthält genau einen Dauerhinweis');
renderOverview(doc, focusBase);
assert(focus.innerHTML.includes('Zum Jahresanfang') && focus.innerHTML.includes('overview-year-badge') && focus.innerHTML.includes('overview-year-step'), 'Januarkarte zeigt Jahres-Eyebrow, Pille und Schritte');
assertEqual((focus.innerHTML.match(/Rund 10 Minuten/g) || []).length, 1, 'Jahreskarte enthält genau einen Dauerhinweis');

renderOverview(doc, { ...focusBase, lastBackup: new Date(focusNow.getTime() - 29 * 86400000).toISOString() });
assertEqual(doc.getElementById('overviewBackupReminder').hidden, true, '29 Tage: sichtbare Erinnerung bleibt verborgen');
renderOverview(doc, { ...focusBase, lastBackup: new Date(focusNow.getTime() - 30 * 86400000).toISOString() });
assertEqual(doc.getElementById('overviewBackupReminder').hidden, false, '30 Tage: sichtbare Erinnerung führt zur eigenen Sicherungsseite');
assert(html.includes('id="overviewBackupReminder"') && html.includes('href="Daten-Sicherung.html" data-profile-handoff>Jetzt sichern'), 'Erinnerung hat echten geschützten Seitenlink');

// Beide Renderer erhalten dieselbe lesende Vergleichsprojektion.
{
    const { projectHouseholdPlanComparison, householdPlanComparisonHtml } = await import('../app/profile/household-plan-comparison.js');
    const { PLAN_DEFAULTS, planScope } = await import('../app/profile/household-plan.js');
    const { annualPlanEntryKey } = await import('../app/profile/annual-plan-record.js');
    const area = planScope('household', ['a']);
    const outcome = { monthlyWithdrawal: 1500, monthlyBudget: 2000, liquidityBefore: 70, liquidityAfter: 80, flexRate: 100, marketPhase: 'Synthetisch',
        action: { type: 'NONE', title: 'Keine Transaktion' }, snapshot: { plan: structuredClone(PLAN_DEFAULTS), inflation: 2.1, ageByPerson: { a: 60 } } };
    const record = { year: 2026, periodId: 'calendar-year:2026', scope: area, committedAt: '2026-01-02T12:00:00Z', adjusted: true, adjustedFields: ['floorBedarf'], adopted: outcome, recommended: { ...outcome, monthlyWithdrawal: 9999 } };
    let raw = JSON.stringify({ version: 1, entries: { [annualPlanEntryKey(2026, area)]: record } });
    const view = () => projectHouseholdPlanComparison({ year: 2026, scope: area, storage: { getItem: () => raw },
        preview: { year: 2026, scope: area, monthlyWithdrawal: 1600, monthlyBudget: 2100, liquidityAfter: 85,
            createdAt: '2026-10-09T10:00:00Z', actionBasis: { fingerprintVersion: 1, sourceFingerprint: 'current' } },
        sourceFingerprint: 'current', now: new Date('2026-10-09T12:00:00Z') });
    let comparison = view();
    renderOverview(doc, { ...focusBase, planComparison: comparison });
    assert(doc.getElementById('overviewPlanComparison').innerHTML.startsWith(householdPlanComparisonHtml(comparison)), 'Startseitenrenderer verwendet denselben Vergleich wie Manager');
    assert(doc.getElementById('overviewPlanComparison').innerHTML.includes('data-action-origin') && doc.getElementById('overviewPlanComparison').innerHTML.includes('Balance.html#handlungsanweisung'), 'Lesender Herkunftshinweis erhält den Balance-Link mit Profilhandoff');
    assertEqual(doc.getElementById('overviewPlanStatus').textContent, 'festgeschrieben', 'Nur gültiger Beleg setzt sichtbaren Status');
    assert(doc.getElementById('overviewPlanComparison').innerHTML.includes('bewusst angepasst'), 'Startseite zeigt bewusste Anpassung');
    raw = '{broken'; comparison = view(); renderOverview(doc, { ...focusBase, planComparison: comparison });
    assert(doc.getElementById('overviewPlanComparison').innerHTML.includes('role="alert"'), 'Startseitenrenderer benennt beschädigten Beleg');
    raw = null; comparison = view(); renderOverview(doc, { ...focusBase, planComparison: comparison });
    assertEqual(doc.getElementById('overviewPlanStatus').textContent, '', 'Belegverlust entfernt früheren festen Status');
    assert(doc.getElementById('overviewPlanComparison').innerHTML.includes('Noch kein festgeschriebener Plan – er entsteht im nächsten Jahresabschluss.'), 'Startseite zeigt vorgeschriebenen ruhigen Hinweis');
    assert(!doc.getElementById('overviewPlanComparison').innerHTML.includes('nach Umsetzung'), 'Gemeinsame Karte unterstellt keine Ausführung');
}

// Echte Grundbedienungsfixture aus dem Browserfall, danach echter Profilstart.
// Gegenprobe: Nur personengebundene Metadaten können keinen Haushaltsabschluss belegen.
{
    const previousTestDate = getAppTestDate();
    const BALANCE_STATE_KEY = 'ruhestandsmodellValues_v29_guardrails', EXPENSES_KEY = 'balance_expenses_v1';
    const extract = (name, dependencies = {}, asyncFunction = false) => new Function(...Object.keys(dependencies),
        (asyncFunction ? 'async ' : '') + functionSource('tests/browser-smoke.test.mjs', name) + '\nreturn ' + name + ';')(...Object.values(dependencies));
    const currentPersonBalanceFixture = extract('currentPersonBalanceFixture');
    const createBalanceStorage = extract('createBalanceStorage', { currentPersonBalanceFixture, BALANCE_STATE_KEY, EXPENSES_KEY });
    const createBrowserProfileStorage = extract('createBrowserProfileStorage', { currentPersonBalanceFixture, BALANCE_STATE_KEY });
    let browserStorage;
    const captured = new Error('Fixture erfasst');
    const basics = extract('runCloseDialogBasics', { overviewScope, createBalanceStorage, createBrowserProfileStorage,
        summaryEntryKey, OVERVIEW_SUMMARY_KEY, BALANCE_STATE_KEY,
        openSmokePage: async (_browser, _base, _path, options) => { browserStorage = options.storage; throw captured; }
    }, true);
    try { await basics({}, 'http://suite.test'); } catch (error) { if (error !== captured) throw error; }
    assert(browserStorage, 'Regression verwendet die tatsächlich registrierte Browserfixture');
    for (const omitLiveState of [false, true]) {
        const records = addDirectHouseholdPlans(browserStorage, { now: () => new Date('2026-10-08T12:00:00+02:00') });
        if (omitLiveState) delete records[BALANCE_STATE_KEY];
        const fixture = createBalancePageFixture({ storage: { getItem: () => null }, url: 'http://localhost/index.html' });
        const { doc: startupDoc, win: startupWin } = fixture;
        try {
            startupDoc.documentElement = startupDoc.createElement('html'); startupDoc.documentElement.dataset.suitePage = 'index';
            startupWin.sessionStorage = globalThis.sessionStorage;
            await annualServiceFixture({ sample: { records } });
            assert(await initializeProfilePage({ doc: startupDoc, win: startupWin }), 'Fixture durchläuft den echten Profilstart');
            await PersistenceFacade.flush();
            const liveData = Object.fromEntries(Array.from({ length: persistenceStorage.length }, (_, i) => persistenceStorage.key(i))
                .map(key => [key, persistenceStorage.getItem(key)]));
            const model = projectOverviewFromRecords({ registry: JSON.parse(liveData.rs_profiles_v1), activeId: 'dialog-person',
                liveData, now: new Date('2026-10-08T12:00:00+02:00') });
            renderOverview(doc, model);
            if (omitLiveState) {
                assertEqual(model.occasion.kind, 'annual', 'Alte Fixture erzeugt einen Jahresanlass statt Monatsgrundbedienung');
                assertEqual(model.occasion.annualState, 'unclear', 'Personenmetadaten allein sind kein Haushaltsbeleg');
                assert(!doc.getElementById('overviewFocus').innerHTML.includes('data-overview-month-confirm'), 'Gegenprobe zeigt den fehlenden Monatsöffner');
            } else {
                assertEqual(model.occasion.kind, 'monthly', 'Live-Haushaltsmetadaten ergeben den fachlich gewünschten Monatsanlass');
                assertEqual(model.summary.monthlyWithdrawal, 500, 'Grundbedienung behält ihren gespeicherten Monatsbetrag');
                assert(doc.getElementById('overviewFocus').innerHTML.includes('data-overview-month-confirm'), 'Renderer erzeugt den echten Monatsöffner');
            }
        } finally { PersistenceFacade.resetPersistenceForTests(); fixture.restore(); setAppTestDate(previousTestDate); }
    }
}

// Derselbe Anzeigehelfer mit injiziertem Ansichtsdatum, unabhängig von der App-Uhr.
{
    const previous = getAppTestDate();
    try {
        setAppTestDate('2026-01-01');
        const registry = { profiles: {
            a: { meta: { name: 'Person A' }, data: { profile_geburtsdatum: '1962-06-02', profile_rente_monatlich: '1000', profile_tagesgeld: '200' } },
            b: { meta: { name: 'Person B' }, data: { profile_geburtsdatum: '1965-06-28', profile_rente_monatlich: '500' } },
            c: { meta: { name: 'Altprofil' }, data: { profile_aktuelles_alter: '70' } }
        } };
        const liveData = { ...registry.profiles.a.data }, raw = JSON.stringify({ registry, liveData });
        const view = projectOverview({ registry, activeId: 'a', liveData, now: new Date(2026, 9, 9, 12) });
        const before = JSON.stringify(view);
        renderOverview(doc, view);
        const people = doc.getElementById('overviewPeople').innerHTML;
        assert(people.includes('64 Jahre') && people.includes('61 Jahre'), 'Startseitenmitglieder zeigen heutige Alter 64/61');
        assert(people.includes('70 Jahre · Altalter, Geburtsdatum fehlt'), 'Startseite kennzeichnet festes Altalter');
        assertEqual(view.members[0].values.alter, 63, 'Startseite erhält Januarplanung von A');
        assertEqual(view.members[1].values.alter, 60, 'Startseite erhält Januarplanung von B');
        assertEqual(view.household.assets, 200, 'Anzeigedatum verändert keine Vermögenssumme');
        assertEqual(view.household.income, 1500, 'Anzeigedatum verändert keine Einkommenssumme');
        assertEqual(JSON.stringify(view), before, 'Rendering verändert keine Modellwerte');
        assertEqual(JSON.stringify({ registry, liveData }), raw, 'Ansichtsprojektion verändert keine Speicherrohwerte');
        const early = projectOverview({ registry, activeId: 'a', liveData, now: new Date(2026, 5, 1, 12) });
        assertEqual(early.members[0].personDates.todayAge, 63, 'Injiziertes Datum vor Geburtstag steuert Anzeige');
        assertEqual(early.members[0].values.alter, view.members[0].values.alter, 'Datumsprojektion ersetzt keine Fachwerte');
    } finally { setAppTestDate(previous); }
}
