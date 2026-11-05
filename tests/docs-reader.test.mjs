import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { renderReaderPage, buildReaderFiles, validateReaderFiles, headingSlug, localReference, READER_PAGES } from '../scripts/docs-reader.mjs';
import { isDistRuntimePath } from '../scripts/sync-dist.mjs';

const readRepo = file => {
    const url = new URL('../' + file, import.meta.url);
    return fs.existsSync(url) && fs.statSync(url).isFile() ? fs.readFileSync(url) : null;
};
const pages = buildReaderFiles({ read: readRepo, runtime: isDistRuntimePath });
assertEqual([...pages.keys()].filter(file => file.endsWith('.html')).length, READER_PAGES.length, 'Alle freigegebenen vorhandenen Quellen liefern fertige HTML-Seiten');
const readerCss = String(pages.get('css/docs-reader.css'));
assert(/\.docs-heading:target\s*\{[^}]*border-inline-start: 4px solid var\(--accent\)[^}]*background: var\(--accent-soft\)/.test(readerCss), 'Sprungziel erhält den vorhandenen 4px-Akzentstrich und Messingtönung');
assert(/\.docs-target-note\s*\{[^}]*display: none/.test(readerCss)
    && /\.docs-target-note:has\(\+ \.docs-heading:target\)\s*\{[^}]*display: block/.test(readerCss), 'Hinweis erscheint ausschließlich direkt vor der Zielüberschrift');
for (const file of READER_PAGES) {
    const page = String(pages.get(file.replace(/\.md$/, '.html')));
    assert(page.includes('<header id="top">') && page.includes('<a href="#top">zum Seitenanfang ↑</a>'), 'Gültige Rückkehr zum Seitenkopf: ' + file);
    const title = readRepo(file).toString().match(/^#\s+(.+)$/m)?.[1] || file;
    const escapedTitle = title.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    assert(page.includes(`Abschnitt aus: ${escapedTitle} · <a href="#top">zum Seitenanfang ↑</a>`), 'Hinweis nennt die aktuelle Seite: ' + file);
    assert(!page.includes('Abschnitt aus: ‹'), 'Seitentitel ohne Platzhalterzeichen: ' + file);
    assert(!page.includes('<script'), 'Sprunghilfe braucht kein JavaScript: ' + file);
}
const contracts = String(pages.get('docs/reference/DATENVERTRAEGE.html'));
assert(contracts.includes('href="#top">zum Seitenanfang ↑</a></p><h2 class="docs-heading" id="austausch">'), 'Herkunftshinweis steht direkt vor dem Austauschziel');
assert(contracts.includes('.docs-reader:has(.docs-heading[id="austausch"]:target) nav a[href="#austausch"]'), 'Inhaltsverzeichnis folgt dem gewählten Abschnitt mit CSS');
const guide = String(pages.get('docs/guides/EINRICHTUNG_UND_BETRIEB.html'));
assert(guide.includes('href="../../QUICKSTART.html"') && guide.includes('href="../../Handbuch.html#jahr-abschliessen"'), 'Betriebsanleitung erreicht QUICKSTART und den richtigen Handbuchabschnitt offline');
assert(guide.includes('href="../reference/TECHNICAL.html#start"'), 'Betriebsanleitung erreicht die fertige Technikreferenz offline');
const technical = String(pages.get('docs/reference/TECHNICAL.html'));
assert(technical.includes('Repository: engine/README.md') && !technical.includes('href="../../engine/README.md'), 'Nicht ausgelieferte Entwicklerbelege sind lesbare Repository-Pfade');
assert(technical.includes('src="../../assets/handbook/technik-architektur.svg"')
    && technical.includes('src="../../assets/handbook/technik-speichern.svg"'), 'Technikreferenz liefert Architektur und Schreibsequenz offline');
const design = String(pages.get('docs/reference/DESIGNSYSTEM.html'));
assert(design.includes('src="images/designsystem-regelweg.svg"') && design.includes('Pfeile bedeuten konkretisiert'), 'Mermaid wird durch zugehöriges vorgerendertes SVG samt Legende dargestellt');
assert(!/<script\b|https?:\/\/[^"\s]+\.(?:js|css)/.test(design), 'Lesefassung braucht kein Script und kein CDN');
assert(design.includes('class="ds-table"') && design.includes('class="ds-table-scroll"'), 'Tabellen verwenden bestehende Bausteine');
assert(design.includes('Repository: app/shared/field-state.js') && !design.includes('href="../../app/shared/field-state.js"'), 'Auch mitgelieferter Fachcode wird als Repository-Beleg statt als Leserziel geführt');
for (const [name, diagram] of [['JAHRESBUDGET', 'jahresbudget-ablauf'], ['HANDLUNGSANWEISUNG', 'handlungsanweisung-geldfluss']]) {
    const topic = String(pages.get(`docs/reference/${name}.html`));
    assert(topic.includes(`src="images/${diagram}.svg"`) && topic.includes('class="ds-table"'), 'Fertiges Rechenthema liefert Diagramm und Lesertabellen offline: ' + name);
    assert(!topic.includes('<code>SPENDING_MODEL.') && !topic.includes('<code>THRESHOLDS.'), 'Codeparameter stehen außerhalb der Leseransicht: ' + name);
}
assert(String(pages.get('docs/README.html')).includes('href="reference/STRATEGIEN.html"'), 'Wegweiser erreicht die fertige Strategieseite offline');
const simulation = String(pages.get('docs/reference/SIMULATION_LESEN.html'));
assert(String(pages.get('docs/README.html')).includes('href="reference/SIMULATION_LESEN.html"'), 'Wegweiser erreicht die Ergebnisdeutung offline');
assert(simulation.includes('src="images/simulation-laufende.svg"') && simulation.includes('id="mindest-flex"')
    && simulation.includes('href="PFLEGE.html"'), 'Ergebnisdeutung liefert Laufende-Grafik, Messanker und lokale Themenlinks');
assert(!/<script\b|https?:\/\/[^"\s]+\.(?:js|css)/.test(simulation), 'Ergebnisdeutung hat keine Script- oder CDN-Abhängigkeit');
assertEqual(headingSlug('Werte & Größen'), 'werte--größen', 'Unicode- und Interpunktionsanker entsprechen der Dokuprüfung');

const fixtures = new Map([
    ['docs/README.md', '# Wegweiser\n'], ['Handbuch.html', '<h1 id="begriffe">Handbuch</h1>'],
    ['app/code.js', 'export const value = 1;'], ['docs/picture (1).svg', '<svg xmlns="http://www.w3.org/2000/svg"/>']
]);
const read = file => fixtures.get(file) ?? null;
const render = source => renderReaderPage({ file: 'docs/README.md', source, read, runtime: file => file === 'Handbuch.html' });
const html = render('# Werte & Größen\n\n## `API`\n\n## `API`\n\n<a id="alias"></a>\n\n[Begriff](../Handbuch.html#begriffe) [Quelle](../app/code.js)\n\n[Eigenes Ziel][r]\n\n[r]: README.md?leser=1#api-1\n\n![Bild](<picture%20(1).svg>)\n\n`[kein Link](fehlt.md)`\n\n```html\n<script>alert(1)</script>\n```\n\nText <script>alert(2)</script> **fett**.').html;
assert(html.includes('id="api"') && html.includes('id="api-1"') && html.includes('id="alias"'), 'Wiederholte Überschriften und explizite Aliase erhalten eindeutige Anker');
assert(html.includes('href="README.html?leser=1#api-1"'), 'Referenzlinks erhalten Query und Abschnitt nach dem HTML-Umzug');
assert(html.includes('src="picture%20(1).svg"'), 'Lokale Bildpfade mit Leerzeichen und Klammern werden umgeschrieben');
assert(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !html.includes('<script>'), 'Code und rohes HTML werden nicht ausgeführt');
assert(html.includes('<code>[kein Link](fehlt.md)</code>'), 'Linkbeispiele in Inline-Code werden nicht als Ziele behandelt');
assert(html.includes('<strong>fett</strong>'), 'Einfache Hervorhebung bleibt lesbar');
assert(render('# Oben\n\n## Top').html.includes('id="top-1"'), 'Seitenkopfanker kollidiert nicht mit einer Überschrift Top');
let failed = false;
try { render('[Fehlt](missing.md)'); } catch { failed = true; }
assert(failed, 'Fehlende echte Linkziele stoppen die Ausgabe');
for (const url of ['javascript:alert(1)', 'data:text/html,x', '//remote.invalid/x', '../../outside.md', '%2e%2e/%2e%2e/outside.md', 'x%5cy.md']) {
    failed = false; try { localReference('docs/README.md', url); } catch { failed = true; }
    assert(failed, 'Unzulässiges Ziel wird abgewiesen: ' + url);
}
failed = false; try { render('![Bild](https://example.invalid/picture.png)'); } catch { failed = true; }
assert(failed, 'Externe Bildabhängigkeiten werden abgewiesen');
failed = false; try { render('```mermaid\nflowchart LR\nA --> B\n```'); } catch { failed = true; }
assert(failed, 'Mermaid ohne geliefertes SVG wird nicht als gerenderte Grafik ausgegeben');
const metadata = '{"src":"graph.svg","title":"Ablauf","alt":"A führt zu B","legend":"Pfeil ist die Reihenfolge"}';
const code = 'flowchart LR\n    %% docs:diagram ' + metadata + '\nA --> B';
const hash = createHash('sha256').update(code).digest('hex');
const diagram = '```mermaid\n' + code + '\n```';
fixtures.set('docs/graph.svg', '<svg data-source-sha256="alter-Stand"/>');
failed = false; try { render(diagram); } catch { failed = true; }
assert(failed, 'Veraltete SVG-Zuordnung stoppt den Build');
fixtures.set('docs/graph.svg', `<svg data-source-sha256="${hash}"/>`);
const renderedDiagram = render(diagram).html;
assert(renderedDiagram.includes('alt="A führt zu B"'), 'Verborgene Metadaten erhalten die Textalternative als alt');
assert(renderedDiagram.includes('<figcaption>Ablauf. Pfeil ist die Reihenfolge</figcaption>')
    && !renderedDiagram.includes('docs:diagram') && !renderedDiagram.includes('%%'), 'Lesefassung zeigt nur Grafik, Titel und Legende');
assert(render(diagram.replaceAll('\n', '\r\n')).html === renderedDiagram, 'CRLF und LF ergeben dieselbe SVG-Zuordnung');
for (const invalid of [
    diagram.replace('A führt zu B', 'A führt über B'),
    diagram.replace('A --> B', 'A --> C'),
    diagram.replace('    %% docs:diagram ' + metadata + '\n', ''),
    diagram.replace('A --> B', '%% docs:diagram ' + metadata + '\nA --> B'),
    diagram.replace(metadata, '{kaputt}'),
    diagram.replace(metadata, metadata.replace('"alt":"A führt zu B",', '')),
    '<!-- docs:diagram ' + metadata + ' -->\n' + diagram,
    diagram + '\n```mermaid\nflowchart LR\nA --> B\n```'
]) {
    failed = false; try { render(invalid); } catch { failed = true; }
    assert(failed, 'Fehlende, doppelte oder veränderte Diagrammzuordnungen stoppen die Ausgabe');
}
const legacyCode = 'flowchart LR\nA --> B';
fixtures.set('docs/graph.svg', `<svg data-source-sha256="${createHash('sha256').update(legacyCode).digest('hex')}"/>`);
assert(render('<!-- docs:diagram ' + metadata + ' -->\n```mermaid\n' + legacyCode + '\n```').html.includes('alt="A führt zu B"'),
    'Explizite Builds historischer Commits behalten ihre ältere SVG-Zuordnung');
const onePage = new Map([['docs/page.html', Buffer.from('<a href="../Handbuch.html#fehlt">Handbuch</a>')]]);
failed = false; try { validateReaderFiles({ files: onePage, read, runtime: file => file === 'Handbuch.html' }); } catch { failed = true; }
assert(failed, 'Erreichbare fehlende HTML-Anker werden erkannt');
const broken = new Map(pages); broken.delete('docs/reference/images/designsystem-regelweg.svg');
failed = false; try { validateReaderFiles({ files: broken, read: readRepo, runtime: isDistRuntimePath }); } catch { failed = true; }
assert(failed, 'Eine fehlende ausgelieferte Grafik wird auch bei vorhandener Quelldatei erkannt');
const activeSvg = new Map([['docs/page.html', Buffer.from('<img src="active.svg">')], ['docs/active.svg', Buffer.from('<svg><script/></svg>')]]);
failed = false; try { validateReaderFiles({ files: activeSvg, read, runtime: () => false }); } catch { failed = true; }
assert(failed, 'Aktive Inhalte in SVGs werden abgewiesen');
