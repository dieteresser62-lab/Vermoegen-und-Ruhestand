import fs from 'node:fs';
import { normalizeSearch, searchChapters, findSearchRange, handbookSearchText } from '../app/handbook/handbook.js';
const handbook = fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8');
const records = [...handbook.matchAll(/<article id="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, id, body]) => ({
    id, title: body.match(/<h2\b[^>]*>([^<]+)/)?.[1] || '',
    text: body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}));
assertEqual(records.length, 17, 'Suche erfasst alle neuen Kapitel');
assertEqual(normalizeSearch('KÜRZUNG abschließen'), 'kurzung abschliessen', 'Suche ignoriert Großschreibung und Umlaute und findet ß mit ss');
const spelling = 'Nach dem Abschließen die Kürzung prüfen';
const range = findSearchRange(spelling, 'KURZUNG');
assertEqual(spelling.slice(range.start, range.end), 'Kürzung', 'Suchmarke bleibt nach ß und bei Umlauten am richtigen Wort');
const closing = findSearchRange(spelling, 'ABSCHLIESSEN');
assertEqual(spelling.slice(closing.start, closing.end), 'Abschließen', 'ss-Suche markiert das vollständige Wort mit ß');
assert(searchChapters(records, 'Teilfreistellung').some(hit => hit.id === 'kauf'), 'Suche findet Fachtext im Kaufkapitel');
assert(searchChapters(records, 'Teilfreistellung').some(hit => hit.id === 'begriffe'), 'Suche findet auch Begriffe');
assert(searchChapters(records, '   Mindest-Flex   Laufstart  ').some(hit => hit.id === 'warum-gekuerzt'), 'Mehrere Suchwörter treffen auch innerhalb eines Kapitels');
assert(searchChapters(records, 'Rohtext').some(hit => hit.id === 'daten-sicherung'), 'Text außerhalb einer Kapitelüberschrift wird durchsucht');
assertEqual(searchChapters(records, '    ').length, 0, 'Leere Suche hat keine Treffer');
assertEqual(searchChapters(records, 'nichtvorhandenerMustermannbegriff').length, 0, 'Unbekannter Begriff hat keine Treffer');
assertEqual(searchChapters(records, '<script>alert(1)</script>').length, 0, 'HTML-artiger Suchtext wird als Text behandelt');
assertEqual(searchChapters([{ id: 'text', title: 'Andere Aufgabe', text: 'Tagesgeld korrigieren' },
    { id: 'title', title: 'Tagesgeld', text: 'Tagesgeld pflegen' }], 'Tagesgeld')[0].id, 'title', 'Passende Kapitelüberschrift erhält Vorrang');

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
assertEqual((handbook.match(/data-handbook-search-ignore>Zum Kapitel/g) || []).length, 33, 'Alle Begriff-Hilfslinks sind aus dem Suchindex ausgeschlossen');
assert(!/href="#[^"]+">Zum Kapitel/.test(handbook), 'Kein Begriff-Hilfslink bleibt unmarkiert');
const source = fs.readFileSync(new URL('../app/handbook/handbook.js', import.meta.url), 'utf8');
assert(!/innerHTML|localStorage|sessionStorage|PersistenceFacade/.test(source), 'Handbuchsuche fügt kein unkontrolliertes HTML ein und schreibt keine Fachdaten');
