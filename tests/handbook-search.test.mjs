import fs from 'node:fs';
import { normalizeSearch, searchChapters, findSearchRange, handbookSearchText, searchMarkRanges } from '../app/handbook/handbook.js';
const handbook = fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8');
const records = [...handbook.matchAll(/<article id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, id, body]) => ({
    id, title: body.match(/<h2\b[^>]*>([^<]+)/)?.[1] || '',
    text: body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}));
assertEqual(records.length, 19, 'Suche erfasst auch das Kapitel vor dem Ruhestand');
assertEqual(normalizeSearch('KÜRZUNG abschließen'), 'kurzung abschliessen', 'Suche ignoriert Großschreibung und Umlaute und findet ß mit ss');
const spelling = 'Nach dem Abschließen die Kürzung prüfen';
const range = findSearchRange(spelling, 'KURZUNG');
assertEqual(spelling.slice(range.start, range.end), 'Kürzung', 'Suchmarke bleibt nach ß und bei Umlauten am richtigen Wort');
const closing = findSearchRange(spelling, 'ABSCHLIESSEN');
assertEqual(spelling.slice(closing.start, closing.end), 'Abschließen', 'ss-Suche markiert das vollständige Wort mit ß');
assert(searchChapters(records, 'Teilfreistellung').some(hit => hit.id === 'kauf'), 'Suche findet Fachtext im Kaufkapitel');
assert(searchChapters(records, 'Teilfreistellung').some(hit => hit.id === 'begriffe'), 'Suche findet auch Begriffe');
assert(searchChapters(records, '   Mindest-Flex   Laufstart  ').some(hit => hit.id === 'balance'), 'Mehrere Suchwörter treffen auch innerhalb eines Kapitels');
assert(searchChapters(records, 'Rohtext').some(hit => hit.id === 'daten-sicherung'), 'Text außerhalb einer Kapitelüberschrift wird durchsucht');
assertEqual(searchChapters(records, '    ').length, 0, 'Leere Suche hat keine Treffer');
assertEqual(searchChapters(records, 'nichtvorhandenerMustermannbegriff').length, 0, 'Unbekannter Begriff hat keine Treffer');
assertEqual(searchChapters(records, '<script>alert(1)</script>').length, 0, 'HTML-artiger Suchtext wird als Text behandelt');
assertEqual(searchChapters([{ id: 'text', title: 'Andere Aufgabe', text: 'Tagesgeld korrigieren' },
    { id: 'title', title: 'Tagesgeld', text: 'Tagesgeld pflegen' }], 'Tagesgeld')[0].id, 'title', 'Passende Kapitelüberschrift erhält Vorrang');

// KS-1: Mehrere Suchwörter setzen den Ausschnitt an die gesuchte Stelle statt an das erste Füllwort.
const marked = (snippet, query) => searchMarkRanges(snippet, query).map(range => snippet.slice(range.start, range.end));
// Nutzertest 19.11. suchte „im Seitenkopf auf“; den Satz hat SV-1 aus dem Handbuch genommen. Gleiches Muster mit echtem Text:
const header = searchChapters(records, 'im Kopf an der Stelle');
assertEqual(header[0]?.id, 'probelauf', 'Echte Wortgruppe „im Kopf an der Stelle“ führt zuerst zum Spielbereich-Kapitel');
assert(header[0].phrase && header[0].snippet.includes('im Kopf an der Stelle'), 'Ausschnitt zeigt den gesuchten Satz: ' + header[0]?.snippet);
assertEqual(marked(header[0].snippet, 'im Kopf an der Stelle').join('|'), 'im Kopf an der Stelle', 'Markiert wird die ganze Wortgruppe');
const filler = 'Im Spielbereich bleibt alles getrennt. ' + 'Weitere Erklärungen zu Sicherungen und Punkten. '.repeat(8);
const phraseHits = searchChapters([
    { id: 'verstreut', title: 'Seitenkopf und Spielbereich', text: 'Im Kopf steht der Seitenkopf. Wir klicken darauf. ' + filler },
    { id: 'gruppe', title: 'Sichern', text: filler + 'Klicke im Seitenkopf auf „Spielbereich beenden“. Danach ist alles wie vorher.' }
], 'im Seitenkopf auf');
assertEqual(phraseHits.map(hit => hit.id).join(','), 'gruppe,verstreut', 'Wortgruppe: zusammenhängender Treffer steht vor besserer Titelgewichtung mit verstreuten Wörtern');
assert(phraseHits[0].snippet.startsWith('… ') && phraseHits[0].snippet.includes('Klicke im Seitenkopf auf'), 'Wortgruppe: Ausschnitt sitzt an der Gruppe, nicht am ersten „Im“');
assertEqual(marked(phraseHits[0].snippet, 'im Seitenkopf auf').join('|'), 'im Seitenkopf auf', 'Wortgruppe: genau die Gruppe ist markiert');
const lone = searchChapters([{ id: 'lang', title: 'Text', text: 'Im Jahr gilt immer der Plan. ' + filler + 'Der Jahresabschluss steht am Ende.' }], 'im Jahresabschluss');
assert(!lone[0].phrase && lone[0].snippet.includes('Der Jahresabschluss steht'), 'Verstreute Wörter: ohne Nachbarn sitzt der Ausschnitt am längsten Wort: ' + lone[0].snippet);
const dense = searchChapters([{ id: 'dicht', title: 'Text', text: 'Pflege beginnt früh. ' + filler + 'Im Heim steigen die Kosten der Pflege. ' + filler + 'Kosten am Ende.' }], 'Kosten Pflege Heim');
assert(dense[0].snippet.includes('Im Heim steigen die Kosten der Pflege.'), 'Verstreute Wörter: Ausschnitt sitzt dort, wo die meisten Suchwörter nahe beieinander stehen: ' + dense[0].snippet);
assertEqual(marked(dense[0].snippet, 'Kosten Pflege Heim').join('|'), 'Heim|Kosten|Pflege', 'Verstreute Wörter: jedes Suchwort im Ausschnitt ist markiert');
assertEqual(marked('Immer im Heim', 'im Heim').join('|'), 'im Heim', 'Wortgruppe wird auch in kurzen Ausschnitten als Ganzes markiert');
assertEqual(marked('Das Zimmer im Heim, dazu der Plan', 'Plan Heim im').join('|'), 'im|Heim|Plan', 'Treffer am Wortanfang gehen vor Treffern mitten im Wort, ohne Überlappung');
assertEqual(marked('<b>Heim</b>', '<b>').join('|'), '<b>', 'Markierungen sind nur Textbereiche; der Aufrufer setzt sie als Textknoten');

// Benachbarte DOM-Blöcke ohne Quell-Leerraum bilden die Browserbefunde nach.
function element(tag, children, attributes = {}) {
    const childNodes = children.map(child => typeof child === 'string' ? { nodeType: 3, nodeValue: child, textContent: child } : child);
    return { nodeType: 1, tagName: tag.toUpperCase(), childNodes, hidden: Object.hasOwn(attributes, 'hidden'),
        getAttribute: name => attributes[name] ?? null, hasAttribute: name => Object.hasOwn(attributes, name),
        classList: { contains: name => (attributes.class || '').split(/\s+/).includes(name) },
        textContent: childNodes.map(child => child.textContent || '').join('') };
}
const steps = element('ol', [
    element('li', [element('p', ['Der Gesamtwert ergibt sich aus Stückzahl und Preisen.'])]),
    element('li', [element('span', ['3'], { class: 'step-number', 'aria-hidden': 'true' }),
        element('div', [element('h4', ['Kategorie und Teilfreistellung prüfen']), element('p', ['Aktien passen zur Kategorie.'])])])
]);
assert(steps.textContent.includes('Preisen.3Kategorie'), 'Fixture bildet die Verkettung durch textContent ab');
const stepText = handbookSearchText(steps);
assertEqual(stepText, 'Der Gesamtwert ergibt sich aus Stückzahl und Preisen. Kategorie und Teilfreistellung prüfen Aktien passen zur Kategorie.',
    'Suchtext trennt Schritte, Überschrift und Absatz und lässt Schrittnummern weg');
const glossary = element('dl', [element('div', [element('dt', ['Teilabdeckung']), element('dd', [
    element('p', ['Die bekannte Summe ist kein vollständiger Gesamtwert.']),
    element('a', ['Zum Kapitel'], { 'data-handbook-search-ignore': '' })])]),
    element('div', [element('dt', ['Teilfreistellung']), element('dd', [element('p', ['Der steuerfreie Anteil von Fondserträgen.'])])])]);
const glossaryText = handbookSearchText(glossary);
assertEqual(glossaryText, 'Teilabdeckung Die bekannte Summe ist kein vollständiger Gesamtwert. Teilfreistellung Der steuerfreie Anteil von Fondserträgen.',
    'Suchtext trennt Begriffe und Erklärungen und lässt Hilfslinks weg');
for (const [id, text] of [['kauf', stepText], ['begriffe', glossaryText]]) {
    assertEqual(searchChapters([{ id, title: id, text }], 'Teilfreistellung')[0].snippet, text,
        id + ': Trefferausschnitt bewahrt die lesbaren Blockgrenzen');
}
const inline = element('p', ['Die Teil', element('strong', ['freistellung']), ' beträgt 30', element('span', [' %']), '.', element('br', []), 'Wert prüfen.']);
assertEqual(handbookSearchText(inline), 'Die Teilfreistellung beträgt 30 %. Wert prüfen.', 'Inline-Auszeichnung und echte Zahlen bleiben erhalten; Zeilenumbruch trennt Sätze');
const hidden = element('section', [element('p', ['Sichtbarer Text.']), element('div', [element('p', ['VerborgenerUnterbaum'])], { hidden: '' }),
    element('span', ['UnsichtbareHilfe'], { 'aria-hidden': 'true' }), element('span', ['9'], { class: 'step-number' }),
    element('nav', ['Navigationshilfe']), { nodeType: 8, textContent: 'Kommentarhilfe' }, element('script', ['Skripthilfe'])]);
const visibleText = handbookSearchText(hidden);
assertEqual(visibleText, 'Sichtbarer Text.', 'Verborgene Unterbäume, Nummern, Navigation, Kommentare und Skripte fehlen im Index');
assertEqual(searchChapters([{ id: 'sichtbar', title: 'Text', text: visibleText }], 'UnsichtbareHilfe').length, 0, 'Unsichtbare Hilfstexte erzeugen keine Suchtreffer');
// DK-2A (18.11.): +2 Glossareinträge „Hilfe zur Pflege“ und „Steuerschuld“ (Doku-Prüfung Befund 24).
// AP-1: Glossareintrag Außenperson entfernt.
assertEqual((handbook.match(/<tr><th scope="row"><a href="docs\/reference\//g) || []).length, 49, 'Alle alphabetischen Kurzdefinitionen führen zum zuständigen Thema');
assert(!/href="#[^"]+">Zum Kapitel/.test(handbook), 'Kein Begriff-Hilfslink bleibt unmarkiert');
const source = fs.readFileSync(new URL('../app/handbook/handbook.js', import.meta.url), 'utf8');
assert(!/innerHTML|localStorage|sessionStorage|PersistenceFacade/.test(source), 'Handbuchsuche fügt kein unkontrolliertes HTML ein und schreibt keine Fachdaten');

// Gelieferter ID-Vertrag vor dem Aufgabenumbau: alle Aliase bleiben erreichbar.
const legacyIdsByChapter = {
    "erste-schritte": [
        "erste-schritte",
        "ueberblick",
        "manual",
        "erste-schritte-title",
        "start-oeffnen",
        "installation-start",
        "ansparer-jung",
        "onboarding-playbook",
        "onboarding-woche",
        "erste-schritte-fehler",
        "erste-schritte-weiter"
    ],
    "noch-nicht-im-ruhestand": [
        "noch-nicht-im-ruhestand",
        "noch-nicht-im-ruhestand-title",
        "ansparen-schritte",
        "ansparen-rechnung",
        "ansparen-balance",
        "ansparen-weiter"
    ],
    "monat-abschliessen": [
        "monat-abschliessen",
        "monat-abschliessen-title",
        "monat-start",
        "monatsabschluss",
        "monat-schritte",
        "monat-ergebnis",
        "monat-abschliessen-fehler",
        "monat-abschliessen-weiter"
    ],
    "jahr-abschliessen": [
        "jahr-abschliessen",
        "jahr-abschliessen-title",
        "jahr-start",
        "balance-jahresupdate",
        "balance-jahresupdate-guide",
        "onboarding-jahr",
        "jahrespflege",
        "jahr-schritte",
        "jahr-ergebnis",
        "jahr-personen",
        "jahr-abschliessen-fehler",
        "jahr-abschliessen-weiter"
    ],
    "ausgaben": [
        "ausgaben",
        "ausgaben-title",
        "ausgaben-import",
        "balance-ausgaben-check",
        "ausgaben-jahr",
        "ausgaben-fehler",
        "ausgaben-weiter"
    ],
    "kauf": [
        "kauf",
        "kauf-title",
        "kauf-schritte",
        "balance-tranchen",
        "simulator-tranchen",
        "kauf-korrigieren",
        "kauf-fehler",
        "kauf-weiter"
    ],
    "verkauf": [
        "verkauf",
        "verkauf-title",
        "verkauf-schritte",
        "tranchen-lebenszyklus",
        "tranchen-abgleich-checkliste",
        "verkauf-cash",
        "verkauf-fehler",
        "verkauf-weiter"
    ],
    "haushalt-plan": [
        "haushalt-plan",
        "haushalt-plan-title",
        "person-pflegen",
        "profilverbund",
        "profilverbund-profilverwaltung",
        "profilverbund-personendaten",
        "person-rente",
        "haushalt-auswahl",
        "profilverbund-haushalt",
        "profilverbund-balance",
        "profilverbund-simulator",
        "plan-pflegen",
        "geplante-ausgaben",
        "plan-beschliessen",
        "haushalt-plan-fehler",
        "haushalt-plan-weiter"
    ],
    "immobilien": [
        "immobilien-eintragen"
    ],
    "tod-und-erbe": [
        "partnerschaft-todesfall"
    ],
    "balance": [
        "balance",
        "balance-title",
        "balance-lesen",
        "balance-app",
        "balance-handlungsschritte",
        "balance-diagnose",
        "balance-vorschlag",
        "balance-reserve",
        "balance-pflegebucket",
        "balance-fehler",
        "balance-weiter",
        "monatsbetrag",
        "monatsbetrag-title",
        "monatsbetrag-bausteine",
        "monatsbetrag-treppe",
        "monatsbetrag-beispiele",
        "monatsbetrag-weiter",
        "handlungsanweisung",
        "handlungsanweisung-title",
        "handlungsanweisung-bausteine",
        "balance-fluss",
        "balance-kapitalfluss",
        "balance-kapitalfluss-guide",
        "balance-verlusttopf",
        "handlungsanweisung-beispiel",
        "handlungsanweisung-weiter",
        "warum-gekuerzt",
        "warum-gekuerzt-title",
        "flex-schritte",
        "flex-auswertung",
        "flex-alt",
        "warum-gekuerzt-fehler",
        "warum-gekuerzt-weiter"
    ],
    "vermoegensverlauf": [
        "vermoegensverlauf",
        "vermoegensverlauf-title",
        "verlauf-bild",
        "balance-vermoegensverlauf",
        "verlauf-kennzahlen",
        "verlauf-depotkennzahlen",
        "verlauf-staende",
        "verlauf-tranche",
        "verlauf-luecken",
        "vermoegensverlauf-fehler",
        "vermoegensverlauf-weiter"
    ],
    "simulator": [
        "simulator",
        "simulator-title",
        "simulator-eingaben",
        "simulator-parameter",
        "simulator-renten",
        "simulator-backtest",
        "simulator-ergebnisse",
        "simulator-tranchen-hilfe",
        "simulator-pflegebucket",
        "simulator-start",
        "simulator-best-practices",
        "simulator-fehler",
        "simulator-weiter"
    ],
    "monte-carlo": [
        "mc-vergleich",
        "mc-zielwertsuche",
        "monte-carlo",
        "monte-carlo-title",
        "mc-einstellungen",
        "simulator-stresstest",
        "mc-ueberblick",
        "mc-risiko",
        "mc-pflege",
        "simulator-szenario-log",
        "monte-carlo-fehler"
    ],
    "daten-sicherung": [
        "daten-sicherung",
        "daten-sicherung-title",
        "sicherung-voll",
        "datensicherheit",
        "sicherung-import",
        "sicherung-punkte",
        "balance-snapshots",
        "sicherung-person",
        "sicherung-speicher",
        "sicherung-neu",
        "daten-sicherung-fehler",
        "daten-sicherung-weiter"
    ],
    "probelauf": [
        "probelauf",
        "probelauf-title",
        "probelauf-start",
        "probelauf-testversionen",
        "probelauf-testversionen-title",
        "probelauf-haushalt",
        "probelauf-fehler",
        "probelauf-weiter"
    ],
    "haeufige-fragen": [
        "haeufige-fragen",
        "haeufige-fragen-title",
        "hilfe-abschluss",
        "faq",
        "haeufige-probleme",
        "hilfe-offline",
        "balance-marktdaten-csv",
        "hilfe-verlassen",
        "hilfe-tranchen",
        "tranchen-zustaende",
        "hilfe-ansparphase",
        "ansparphase",
        "hilfe-kuerzel",
        "hilfe-neuigkeiten",
        "anhang",
        "anhang-versionen",
        "anhang-dokumente",
        "hilfe-quellen",
        "anhang-datenquellen",
        "anhang-support",
        "haeufige-fragen-fehler",
        "haeufige-fragen-weiter"
    ],
    "begriffe": [
        "begriffe",
        "glossar",
        "begriffe-title",
        "begriffe-a",
        "begriffe-b",
        "begriffe-c",
        "begriffe-d",
        "begriffe-e",
        "begriffe-f",
        "begriffe-g",
        "begriffe-h",
        "begriffe-i",
        "begriffe-j",
        "begriffe-l",
        "begriffe-m",
        "begriffe-n",
        "begriffe-o",
        "begriffe-p",
        "begriffe-r",
        "begriffe-s",
        "begriffe-t",
        "begriffe-v",
        "begriffe-w",
        "begriffe-fehler",
        "begriffe-weiter"
    ]
};
const legacyFrameIds = ["suiteContext", "suiteProfileContext", "probelaufStart", "probelaufStatus", "suiteNavigationStatus", "suiteNavigation", "suiteSidebarToggle", "suiteMain", "probelaufBand", "probelaufBandText", "handbookSearch", "handbookContext", "handbookContextText", "handbookReturn", "handbookContextClose", "inhaltsverzeichnis", "handbuch-start", "quickstart", "hbStartTitle", "handbookResults", "handbookResultsTitle", "handbookHits", "handbookToc", "handbookTocLinks", "handbookAppLink", "navigationGuardDialog", "navigationGuardTitle", "navigationGuardDescription", "navigationGuardStay", "navigationGuardLeave"];
const ids = [...handbook.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
for (const id of [...legacyFrameIds, ...Object.values(legacyIdsByChapter).flat()]) {
    assertEqual(ids.filter(value => value === id).length, 1, 'Alter Hilfeanker existiert genau einmal: ' + id);
}
for (const [chapter, aliases] of Object.entries(legacyIdsByChapter)) {
    const article = records.find(record => record.id === chapter);
    const source = handbook.match(new RegExp('<article id="' + chapter + '"[^>]*>([\\s\\S]*?)</article>'))?.[0] || '';
    assert(Boolean(article) && aliases.every(id => source.includes('id="' + id + '"')), 'Alte Aliase im erreichbaren Zielkapitel: ' + chapter);
}
