import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { checkDocs, runCli, phrasePatterns, ACTIVE_FILES, FINISHED_FILES, IMAGE_FILES, LOCAL_RULE_FILES } from '../scripts/docs-pruefen.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-pruefen-'));
const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
};
const options = { root, activeFiles: ['guide.md'], finishedFiles: ['guide.md'],
    transitionFiles: [], appPages: [], scanAppHelp: false, handbookAnchors: [], checkImages: false };
const check = overrides => checkDocs({ ...options, ...overrides });
const has = (result, code, severity = 'error') => result.diagnostics.some(d => d.code === code && d.severity === severity);
const rules = '# Schreibregeln\n\n## Verbotene Muster\n- Floskeln: „Im Folgenden“, „Es ist wichtig zu beachten“, „Zusammenfassend“, „spielt eine zentrale/entscheidende Rolle“, „ermöglicht es Ihnen“, „nahtlos“, „umfassend“, „ganzheitlich“, „robust“, „intuitiv“, „optimal“, „leistungsstark“, „im Wesentlichen“, „grundsätzlich“, „gegebenenfalls“, „nicht nur …, sondern auch“, „Egal ob … oder …“.\n';

try {
    assertEqual(ACTIVE_FILES.length, 45, 'Zielstruktur enthält 42 Dokumente, Bildmanifest und zwei Ablaufseiten');
    assertEqual(IMAGE_FILES.length, 40, 'Bilderliste enthält die 40 geplanten Aufnahmen');
    for (const file of ACTIVE_FILES) {
        assert(FINISHED_FILES.includes(file), file + ': volle Dokuprüfung einschließlich Handbuch und Bildern');
    }
    write('docs/internal/design/schreibregeln.md', rules);
    write('docs/internal/design/fachregeln.md', '# Fachregeln\n');
    write('docs/internal/design/entwicklungsgrundsaetze.md', '# Entwicklung\n');
    assert(LOCAL_RULE_FILES.every(file => ACTIVE_FILES.includes(file) && FINISHED_FILES.includes(file)), 'Alle drei lokalen Regeldateien bleiben in der vollen Prüfung');
    const ruleOptions = { activeFiles: LOCAL_RULE_FILES, finishedFiles: LOCAL_RULE_FILES };
    assertEqual(check(ruleOptions).errors, 0, 'Vorhandene lokale Regeln werden geprüft');
    fs.unlinkSync(path.join(root, 'docs/internal/design/fachregeln.md'));
    assert(has(check(ruleOptions), 'file'), 'Ein unvollständiger lokaler Regelbestand bleibt ein Fehler');
    write('docs/internal/design/fachregeln.md', '# Fachregeln\n[Anker](../../page.html#known)');
    write('page.html', '<div id="known"></div>');
    assertEqual(check(ruleOptions).errors, 0, 'Bytegleich verschobene Regeln behalten die relative Linkbasis docs/design');
    write('page.html', '<div id="other"></div>');
    assert(has(check(ruleOptions), 'anchor'), 'Anker in verschobenen Regeln werden weiterhin geprüft');
    write('docs/internal/design/fachregeln.md', '# Fachregeln\n');
    const agentLinks = LOCAL_RULE_FILES.map(file => `[Regel](${file})`).join('\n');
    write('AGENTS.md', '# Arbeitsregeln\n' + agentLinks);
    assertEqual(check({ activeFiles: ['AGENTS.md'], finishedFiles: ['AGENTS.md'] }).errors, 0, 'Agentendateien dürfen auf die drei lokalen Regeln verweisen');
    write('.agent/workflows/run-tests.md', '# Prüfung\n[Regel](../../docs/internal/design/fachregeln.md)');
    assertEqual(check({ activeFiles: ['.agent/workflows/run-tests.md'], finishedFiles: ['.agent/workflows/run-tests.md'] }).errors, 0, 'Auch .agent-Workflows dürfen lokale Regeln verlinken');
    write('guide.md', '# Fachkonzept\n[Regel](docs/internal/design/fachregeln.md)');
    assert(has(check(), 'archive-link'), 'Aktive Leserdoku darf weiterhin nicht von lokalen Regeln abhängen');
    const publicRoot = path.join(root, 'public');
    fs.mkdirSync(publicRoot);
    fs.writeFileSync(path.join(publicRoot, 'AGENTS.md'), '# Arbeitsregeln\n' + agentLinks);
    fs.writeFileSync(path.join(publicRoot, 'guide.md'), '# Wortwahl\nIm Folgenden nahtlos, robust und im Wesentlichen intuitiv.\nDie App spielt eine entscheidende Rolle.\nNicht nur Max, sondern auch Erika. Egal ob heute oder morgen.');
    const publicFiles = ['AGENTS.md', 'guide.md', ...LOCAL_RULE_FILES];
    const publicOptions = { root: publicRoot, activeFiles: publicFiles, finishedFiles: publicFiles };
    const publicResult = check(publicOptions);
    assertEqual(publicResult.errors, 0, 'Öffentlicher Stand benötigt keine lokalen Regeldateien');
    assertEqual(publicResult.diagnostics.filter(d => d.code === 'local-rule').length, 3, 'Nur Agentenlinks auf fehlende lokale Regeln werden als Hinweis gemeldet');
    assertEqual(publicResult.diagnostics.filter(d => d.code === 'phrase').length, 8, 'Öffentliche Doku behält die vollständige Floskelprüfung');
    assertEqual(runCli({ ...options, ...publicOptions }, () => {}), 0, 'Öffentliche Dokuprüfung bleibt erfolgreich');
    const inventoryFile = 'docs/design/funktionsinventar.json';
    const archivedEvidence = { auditEvidence: [{ path: 'docs/internal/archive/entwurf.html' }] };
    write(inventoryFile, JSON.stringify(archivedEvidence));
    const inventoryFiles = { activeFiles: [inventoryFile], finishedFiles: [inventoryFile] };
    assert(has(check(inventoryFiles), 'link'), 'Historische Inventarbelege bleiben im lokalen Baum Pflicht');
    fs.mkdirSync(path.join(publicRoot, 'docs/design'), { recursive: true });
    fs.writeFileSync(path.join(publicRoot, inventoryFile), JSON.stringify(archivedEvidence));
    assertEqual(check({ ...inventoryFiles, root: publicRoot }).errors, 0, 'Öffentlicher Stand braucht historische Inventarbelege nicht');
    fs.writeFileSync(path.join(publicRoot, inventoryFile), JSON.stringify({ codeRefs: archivedEvidence.auditEvidence }));
    assert(has(check({ ...inventoryFiles, root: publicRoot }), 'link'), 'Quellverweise bleiben auch ohne Archiv Pflicht');
    write('docs/internal/design/schreibregeln.md', '# Schreibregeln\n\n## Verbotene Muster\n- Floskeln: „Sonderwort“.\n');
    write('guide.md', '# Wortwahl\nSonderwort');
    assert(has(check(), 'phrase', 'warning'), 'Lokale Schreibregeln bestimmen weiterhin die Wortliste');
    write('docs/internal/design/schreibregeln.md', rules);
    write('target.md', '# Werte & Größen\n\n# Werte & Größen\n\n## `API`\n\nUnterkapitel\n-----------\n\n## [Verknüpft](page.html)\n');
    write('page.html', '<div id="known"></div>');
    write('space (file).md', '# Ziel');
    write('guide.md', '# Einstieg\n[Ziel](target.md#werte--größen) [Doppel](target.md#werte--größen-1)\n[Code](target.md#api) [Unterkapitel](target.md#unterkapitel) [Verknüpft](target.md#verknüpft)\n[HTML](page.html#known) [Datei](<space%20(file).md#ziel>)\n[Referenz][r]\n[r]: target.md#api\n[Web](https://example.invalid/path)\n`[Code](fehlt.md)`\n```md\n[Beispiel](fehlt.md)\n```\n');
    assertEqual(check().errors, 0, 'Markdown, Entities, Unicode, doppelte Überschriften, Referenzen und Codebeispiele');
    write('depot-tranchen-manager.html', '<div id="history"></div>');
    write('app/tranches/tranchen-manager-page.js', "const managerTargets = {\n    verlauf: { kind: 'history', focus: 'history' }\n};");
    write('guide.md', '# Verlauf\n[Verlauf](depot-tranchen-manager.html#verlauf)');
    assertEqual(check().errors, 0, 'Hash-Routen prüfen Quelltabelle und vorhandenes Fokusziel');
    write('depot-tranchen-manager.html', '<div id="other"></div>');
    assert(has(check(), 'anchor'), 'Hash-Routen mit fehlendem Fokusziel sind kaputt');
    write('guide.md', '# Einstieg\n[Fehlt](missing.md)\n[Anker](page.html#missing)\n[Referenz][undef]\n[HTTP](https://)\n');
    const broken = check();
    for (const code of ['link', 'anchor', 'reference', 'url']) assert(has(broken, code), `Gegenprobe meldet ${code}`);
    assert(broken.diagnostics.every(d => d.file === 'guide.md' && d.line > 1 && d.expected && d.reason), 'Fehler nennen Pfad, Fundstelle, Erwartung und Grund');
    assertEqual(runCli(options, () => {}), 1, 'Linkfehler setzen den Fehlercode');
    write('page.html', '<div id="same"></div><p id="same"></p>');
    assert(has(check({ activeFiles: ['page.html'], finishedFiles: [] }), 'duplicate-id'), 'Doppelte HTML-IDs sind schon beim Linkcheck Fehler');

    write('docs/internal/archive/old.md', '# Alt');
    write('guide.md', '# Paket 1\n## Slice 2\n## Nachtrag\n## 12.10.2026\nBalance-App, Profil-Assets-Manager, Depot-Tranchen-Manager.\n[Archiv](docs/internal/archive/old.md)\n');
    const strict = check();
    assert(has(strict, 'heading') && has(strict, 'page-name') && has(strict, 'archive-link'), 'Fertige Dateien prüfen Überschriften, Seitennamen und Archivlinks');
    assertEqual(check({ finishedFiles: [] }).errors, 0, 'Altbestand bekommt nur Link-/Ankerprüfung');
    assertEqual(check({ activeFiles: ['future.md'], finishedFiles: [] }).errors, 0, 'Spätere Zieldateien dürfen noch fehlen');
    assert(has(check({ activeFiles: ['future.md'], finishedFiles: ['future.md'] }), 'file'), 'Fertige Zieldateien müssen existieren');
    write('guide.md', '# Dokument\n`Balance-App`, `legacy_2026-10-12`, `path/Depot-Tranchen-Manager`.');
    assertEqual(check().errors, 0, 'Technische Pfade und Legacy-Kennungen in Code bleiben erlaubt');

    write('guide.md', '# Wortwahl\nIm Folgenden nahtlos, robust und im Wesentlichen intuitiv.\nDie App spielt eine entscheidende Rolle.\nNicht nur Max, sondern auch Erika. Egal ob heute oder morgen.');
    const phrases = check();
    assertEqual(phrases.errors, 0, 'Floskeln ändern den Fehlercode nicht');
    assertEqual(phrases.diagnostics.filter(d => d.code === 'phrase').length, 8, 'Liste und Satzmuster aus Schreibregeln liefern einzelne Warnungen');
    assertEqual(phrasePatterns(rules).length, 17, 'Floskelfixture enthält die vollständige Wortliste');
    assertEqual(JSON.stringify(phrasePatterns(null).map(item => item.phrase)), JSON.stringify(phrasePatterns(rules).map(item => item.phrase)), 'Öffentlicher Ersatz enthält dieselben 17 Floskeln');
    assertEqual(runCli(options, () => {}), 0, 'Warnungen allein ergeben Exit 0');

    write('guide.md', '# Stand\nCommit abcdef12\nBasis `0123456789abcdef0123456789abcdef01234567`\n```text\nABCDEF12\n```\nKennung 12345678\n[Quelle](https://example.invalid/commit/abcdef123456)\nKurz abcdef1, lang ' + 'f'.repeat(41) + ', SHA-256 ' + 'e'.repeat(64));
    const hex = check();
    const hexWarnings = hex.diagnostics.filter(d => d.code === 'reader-hex');
    assertEqual(hex.errors, 0, 'Hex-Kennungen sind Warnungen, keine Fehler');
    assertEqual(hexWarnings.length, 5, '8 bis 40 Hex-Zeichen werden in Text, Code und Links erkannt, auch Großbuchstaben und reine Ziffern');
    assert(hexWarnings.every(d => d.severity === 'warning' && d.file === 'guide.md' && d.expected && d.reason), 'Hex-Warnungen nennen Datei, Erwartung und Begründung');
    assertEqual(hexWarnings.map(d => d.line).join(','), '2,3,5,7,8', 'Hex-Warnungen behalten die genauen Zeilen einschließlich Codeblöcken');
    assertEqual(runCli(options, () => {}), 0, 'Hex-Warnungen allein behalten Exit 0');
    write('guide.md', '# Stand\nStand: Oktober 2026. App-Stand geprüft am 13.10.2026.');
    assertEqual(check().warnings, 0, 'Leserdaten lösen keine Hex-Warnung aus');
    fs.writeFileSync(path.join(publicRoot, 'guide.md'), '# Stand\nBasis `abcdef12`');
    assert(has(check({ root: publicRoot }), 'reader-hex', 'warning'), 'Hex-Prüfung bleibt ohne lokale Schreibregeln aktiv');

    const researchFile = 'docs/reference/FORSCHUNGSABGLEICH_EVIDENZREGISTER.md';
    const researchOptions = { activeFiles: [researchFile], finishedFiles: [researchFile] };
    write(researchFile, '# Belege\nMD5: `' + 'a'.repeat(32) + '`; SHA-1: ' + 'b'.repeat(40) + '; SHA-256: ' + 'c'.repeat(64) + '\n[Datei](https://example.invalid/pdf?md5=' + 'd'.repeat(32) + ')');
    assertEqual(check(researchOptions).warnings, 0, 'Benannte Register-Prüfsummen einschließlich URL-Parametern bleiben erlaubt');
    fs.appendFileSync(path.join(root, researchFile), '; Commit abcdef12');
    assertEqual(check(researchOptions).warnings, 1, 'Eine Commit-Kennung neben Prüfsummen im Register wird weiterhin gemeldet');
    write('guide.md', '# Stand\nMD5: ' + 'a'.repeat(32));
    assert(has(check(), 'reader-hex', 'warning'), 'Die Register-Ausnahme gilt nicht pauschal in Haupttexten');
    write(researchFile, '# Belege\nDOI 10.1080/01621459.1994.10476870\n[Artikel](https://example.invalid/pii/0304407686900631/pdf?md5=' + 'a'.repeat(32) + '&pid=1-s2.0-0304407686900631-main.pdf)\nKennung 10476870');
    const exactExceptions = check(researchOptions).diagnostics.filter(d => d.code === 'reader-hex');
    assertEqual(exactExceptions.length, 1, 'Nur die belegten DOI-/Quellenstellen werden ausgenommen, nicht dieselbe Kennung als Text');
    assertEqual(exactExceptions[0].line, 4, 'Maskierte Ausnahmen verschieben die Warnungszeile nicht');
    write('docs/reference/DATA_SOURCES.md', '# Gold\n32.15074656862798\nKennung abcdef12');
    const dataFiles = ['docs/reference/DATA_SOURCES.md'];
    assertEqual(check({ activeFiles: dataFiles, finishedFiles: dataFiles }).warnings, 1, 'Der genaue Umrechnungsfaktor nimmt weitere Kennungen im Daten-Haupttext nicht aus');
    for (const file of ['docs/design/funktionsinventar.md', 'AGENTS.md', '.agent/workflows/pruefen.md', 'docs/internal/alt.md', 'docs/neuaufbau/auftrag.md']) {
        write(file, '# Technischer Stand\nsourceRevision: ' + 'a'.repeat(40));
        assertEqual(check({ activeFiles: [file], finishedFiles: [file] }).warnings, 0, file + ': Inventar, Agentenanweisungen und lokale Arbeitsdoku bleiben ausgenommen');
    }

    const diagram = (type, body, fence = '```') => `${fence}mermaid\n${type}\n${body}\n${fence}\n`;
    write('guide.md', '# Ablauf\n' + diagram('flowchart TD', 'A["Bedarf (EUR) -> Ziel"] -->|"Ja"| B{"Prüfen?"}\nB --> A'));
    assertEqual(check().errors, 0, 'Mermaid erlaubt zitierte Labels, Kantenlabels und wiederverwendete Knoten');
    write('guide.md', diagram('flowchart LR', 'A --> B --> C\nC -.-> A', '~~~'));
    assertEqual(check().errors, 0, 'Mermaid prüft auch LR, Ketten, implizite Knoten und Tilde-Blöcke');
    write('guide.md', diagram('sequenceDiagram', 'participant A as Nutzer\nparticipant B as Dienst\nA->>B: Prüfen\nB-->>A: Bestätigt'));
    assertEqual(check().errors, 0, 'Mermaid zählt Sequenzteilnehmer und erlaubt Nachricht und Antwort');
    write('guide.md', '````md\n```mermaid\ngraph XY\nA -->\n```\n````\n');
    assertEqual(check().errors, 0, 'Mermaid-Beispiele in anderen Codeblöcken bleiben ausgenommen');
    write('guide.md', diagram('flowchart TD', 'A --> B') + diagram('sequenceDiagram', 'A->>B: Prüfen'));
    assertEqual(check().errors, 0, 'Mehrere Mermaid-Blöcke werden getrennt geprüft');
    for (const type of ['graph TD', 'flowchart TB', 'pie', '', '\nflowchart TD']) {
        write('guide.md', diagram(type, 'A --> B'));
        assert(has(check(), 'mermaid-type'), `Mermaid weist fehlenden oder nicht erlaubten Typ ${JSON.stringify(type)} zurück`);
    }
    write('guide.md', '# Ablauf\n\n```mermaid\nflowchart TD\nA --> B\n');
    const unclosed = check();
    assert(has(unclosed, 'mermaid-unclosed'), 'Offener Mermaid-Block wird gemeldet');
    assertEqual(unclosed.diagnostics.find(d => d.code === 'mermaid-unclosed').line, 3, 'Offener Block nennt die Zeile des öffnenden Zauns');
    write('guide.md', '````mermaid\nflowchart TD\nA --> B\n```\n');
    assert(has(check(), 'mermaid-unclosed'), 'Ein kürzerer Zaun schließt den Mermaid-Block nicht');
    write('guide.md', '```mermaid\nflowchart TD\nA --> B\n```js\n');
    assert(has(check(), 'mermaid-unclosed'), 'Ein Zaun mit Sprachkennung ist kein schließender Zaun');
    for (const body of ['A -->', '--> B', 'A --> B -->', 'A -->|| B', 'A -->|  | B']) {
        write('guide.md', diagram('flowchart TD', body));
        assert(has(check(), 'mermaid-edge'), 'Leere Ablaufkante wird gemeldet: ' + body);
    }
    for (const body of ['A->>: Prüfen', '->>B: Prüfen', 'A->>B:', 'A->>B']) {
        write('guide.md', diagram('sequenceDiagram', body));
        assert(has(check(), 'mermaid-edge'), 'Leere Sequenzkante wird gemeldet: ' + body);
    }
    const nodeLines = count => Array.from({ length: count }, (_, i) => `N${i}["Knoten ${i}"]`).join('\n');
    write('guide.md', diagram('flowchart TD', nodeLines(25)));
    assertEqual(check().errors, 0, '25 eindeutige Ablaufknoten liegen innerhalb der Grenze');
    write('guide.md', diagram('flowchart TD', nodeLines(26)));
    assert(has(check(), 'mermaid-nodes'), '26 Ablaufknoten überschreiten die Grenze');
    write('guide.md', diagram('flowchart\tLR', Array.from({ length: 25 }, (_, i) => `N${i}`).join('\n')));
    assertEqual(check().errors, 0, 'Einzelne Knoten ohne Label und Leerraum im Diagrammtyp sind gültig');
    write('guide.md', diagram('flowchart TD', Array.from({ length: 26 }, (_, i) => `N${i}`).join('\n')));
    assert(has(check(), 'mermaid-nodes'), 'Die Knotengrenze gilt für einzelne Knoten ohne Label');
    write('guide.md', diagram('flowchart TD', Array.from({ length: 26 }, (_, i) => `N${i}`).join(' --> ')));
    assert(has(check(), 'mermaid-nodes'), 'Die Knotengrenze gilt auch für reine Referenzen');
    write('guide.md', diagram('flowchart TD', 'A --> B\nB --> A\nA --> B'));
    assertEqual(check().errors, 0, 'Wiederholte Knotenreferenzen erhöhen die Knotenzahl nicht');
    write('guide.md', diagram('sequenceDiagram', Array.from({ length: 25 }, (_, i) => `participant N${i} as Weg -> Ziel`).join('\n')));
    assertEqual(check().errors, 0, '25 deklarierte Sequenzteilnehmer sind gültig; Pfeile im Alias sind keine Kanten');
    write('guide.md', diagram('sequenceDiagram', Array.from({ length: 26 }, (_, i) => `participant N${i}`).join('\n')));
    assert(has(check(), 'mermaid-nodes'), 'Die Knotengrenze gilt auch für Sequenzteilnehmer');
    write('guide.md', diagram('sequenceDiagram', Array.from({ length: 26 }, (_, i) => `N${i}->>Common: Prüfen`).join('\n')));
    assert(has(check(), 'mermaid-nodes'), 'Auch implizite Sequenzteilnehmer werden gezählt');
    write('guide.md', diagram('flowchart TD', '%% Nur ein Kommentar'));
    assert(has(check(), 'mermaid-nodes'), 'Ein Diagramm ohne Knoten wird gemeldet');
    assertEqual(runCli(options, () => {}), 1, 'Mermaid-Strukturfehler setzen den Fehlercode');

    write('control.html', '<button id="save">Daten &amp;\n Sicherung</button>');
    write('renderer.js', 'return `<button data-action="open">Plan öffnen</button>`;');
    write('guide.md', '# Speichern\n<!-- docs:control {"source":"control.html","selector":"#save","text":"Daten & Sicherung"} -->\n<!-- docs:control {"source":"renderer.js","selector":"[data-action=open]","text":"Plan öffnen"} -->\n```html\n<!-- docs:control {"source":"missing.html","selector":"#save","text":"Beispiel"} -->\n```');
    assertEqual(check().errors, 0, 'Bedienelemente prüfen HTML und Renderer-Templates mit normalisiertem Text; Beispiele bleiben ausgenommen');
    write('constructed.js', "const commit = doc.createElement('button'); commit.id = 'commit'; commit.textContent = 'Fertig'; commit.dataset.confirm = ''; const other = doc.createElement('button'); other.textContent = 'Andere Aktion';");
    write('guide.md', '# Abschluss\n<!-- docs:control {"source":"constructed.js","selector":"#commit","text":"Fertig"} -->\n<!-- docs:control {"source":"constructed.js","selector":"[data-confirm]","text":"Fertig"} -->');
    assertEqual(check().errors, 0, 'DOM-Erzeugung belegt Text am selben ID- und Data-Element');
    write('guide.md', '# Abschluss\n<!-- docs:control {"source":"constructed.js","selector":"#commit","text":"Andere Aktion"} -->');
    assert(has(check(), 'control-text'), 'Text an einer anderen DOM-Variablen ist kein Beleg');
    write('guide.md', '# Abschluss\n<!-- docs:control {"source":"constructed.js","selector":"#missing","text":"Fertig"} -->');
    assert(has(check(), 'control'), 'DOM-Erzeugung braucht den tatsächlichen ID-Anker');
    write('control.html', '<label><input id="switch" type="checkbox"><span>Alternative verwenden</span></label>');
    write('guide.md', '# Alternative\n<!-- docs:control {"source":"control.html","selector":"#switch","text":"Alternative verwenden"} -->');
    assertEqual(check().errors, 0, 'Beschriftung eines verschachtelten Schalters ist belegbar');
    write('lookup.js', "const leave = doc?.getElementById?.('leave'); leave.textContent = discard ? 'Verwerfen' : 'Trotzdem wechseln'; const other = doc.getElementById('other'); other.textContent = 'Andere Aktion';");
    write('guide.md', '# Schutz\n<!-- docs:control {"source":"lookup.js","selector":"#leave","text":"Verwerfen"} -->');
    assertEqual(check().errors, 0, 'Ternäre Knopftexte sind an der gelesenen ID belegbar');
    write('guide.md', '# Schutz\n<!-- docs:control {"source":"lookup.js","selector":"#leave","text":"Andere Aktion"} -->');
    assert(has(check(), 'control-text'), 'Ternäre Texte einer anderen ID sind kein Beleg');
    write('control.html', '<button id="save">Daten &amp; Sicherung</button>');
    write('guide.md', '# Speichern\n<!-- docs:control {"source":"control.html","selector":"#save","text":"Daten & Sicherung"} -->');
    write('control.html', '<button id="save">Anderer Text</button>');
    assert(has(check(), 'control-text'), 'Geänderter Knopftext wird erkannt');
    write('control.html', '<button id="other">Daten &amp; Sicherung</button>');
    assert(has(check(), 'control'), 'Entfernter ID-Anker wird erkannt');
    write('control.html', '<button id="save">${label}</button>');
    assert(has(check(), 'control-manual', 'warning'), 'Dynamischer Knopftext braucht manuelle Prüfung');
    assertEqual(check().errors, 0, 'Unklarer Text ist kein behaupteter Fehler');

    write('Handbuch.html', '<h1 id="alt">Handbuch</h1>');
    write('guide.md', '# Hilfe\n[Handbuch](Handbuch.html#neu)\n![Bild](missing.png)');
    const deferred = check({ handbookAnchors: ['neu'], finishedFiles: [] });
    assertEqual(deferred.errors, 0, 'Handbuch-Anker und Bilder bleiben bis Block 2 Warnungen');
    assert(has(deferred, 'anchor', 'warning') && has(deferred, 'image', 'warning') && has(deferred, 'handbook-plan', 'warning'), 'Übergangswarnungen bleiben konkret');
    const fullHandbook = check({ activeFiles: ['Handbuch.html'], finishedFiles: ['Handbuch.html'], handbookAnchors: ['neu'] });
    assert(has(fullHandbook, 'handbook-plan'), 'Fertiges Handbuch behandelt fehlende Hauptanker als Fehler');
    assert(has(check({ finishedFiles: ['guide.md', 'Handbuch.html'] }), 'anchor'), 'Fehlender Handbuchanker ist nach Fertigstellung ein Fehler');
    write('Handbuch.html', '<h1 id="alt">Handbuch</h1><p id="alt"></p>');
    assert(has(check({ activeFiles: ['Handbuch.html'], finishedFiles: ['Handbuch.html'] }), 'duplicate-id'), 'Fertiges Handbuch verbietet doppelte IDs');
    write('app/help.js', 'const url = "Handbuch.html#app-hilfe";');
    assert(has(check({ scanAppHelp: true }), 'anchor', 'warning'), 'App-Hilfelinks werden ebenfalls geprüft');
    write('inventory.json', JSON.stringify({ entries: [{ path: 'missing.js', text: 'Handbuch.html#inventar-hilfe' }] }));
    const inventory = check({ activeFiles: ['inventory.json'] });
    assert(has(inventory, 'link') && has(inventory, 'anchor', 'warning'), 'Inventar prüft Dateibelege und Handbuchziele');

    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(800, 16); png.writeUInt32BE(400, 20);
    write('docs/ui/crop.png', png);
    const entry = { path: 'docs/ui/crop.png', width: 800, height: 400,
        date: '2026-10-20', caption: 'Max und Erika', household: 'Max und Erika Mustermann',
        viewport: { width: 1920, height: 1080 }, scale: 1, crop: { x: 100, y: 100, width: 800, height: 400 } };
    const imageOptions = { activeFiles: [], checkImages: true, imageFiles: [entry.path] };
    write('docs/ui/manifest.json', JSON.stringify({ images: [entry] }));
    assertEqual(check(imageOptions).warnings, 0, 'Bildmanifest prüft synthetischen PNG-Kopf, Maße, Mustermann und Ausschnitt');
    write('docs/ui/manifest.json', JSON.stringify({ images: [{ ...entry, width: 900, household: 'falsch', crop: null }] }));
    const imageResult = check(imageOptions);
    for (const code of ['image-size', 'image-origin', 'image-crop']) assert(has(imageResult, code, 'warning'), `Bildgegenprobe meldet ${code}`);
    assertEqual(imageResult.errors, 0, 'Bildprüfungen setzen vorerst keinen Fehlercode');
    write('docs/ui/manifest.json', JSON.stringify({ images: [] }));
    assert(has(check(imageOptions), 'image-manifest', 'warning'), 'Leeres Manifest meldet das fehlende geplante Bild');

    // Fertige Bilder sind verbindlich: Größe, Herkunft und Bytes dürfen nicht auseinanderlaufen.
    const complete = { ...entry, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'),
        source: { page: 'page.html', state: 'Musteransicht', commit: 'a'.repeat(40) } };
    const fullImageOptions = { ...imageOptions, activeFiles: ['docs/ui/manifest.json'],
        finishedFiles: ['docs/ui/manifest.json'] };
    const manifest = images => JSON.stringify({ imageCount: images.length,
        totalBytes: new Set(images.map(item => item.path)).size * png.length, images });
    write('docs/ui/manifest.json', manifest([complete]));
    assertEqual(check(fullImageOptions).errors, 0, 'Vollständiges Manifest mit Quellseite, Zustand, Commit, Bytes und Prüfsumme ist gültig');
    for (const [change, code] of [
        [{ width: 900 }, 'image-size'], [{ household: 'falsch' }, 'image-origin'],
        [{ source: null }, 'image-origin'], [{ bytes: 1 }, 'image-bytes'],
        [{ sha256: 'f'.repeat(64) }, 'image-hash'],
        [{ crop: { ...entry.crop, x: 1900 } }, 'image-crop']
    ]) {
        write('docs/ui/manifest.json', manifest([{ ...complete, ...change }]));
        assert(has(check(fullImageOptions), code), `Volle Bildprüfung meldet ${code} als Fehler`);
        assertEqual(runCli({ ...options, ...fullImageOptions }, () => {}), 1, code + ' setzt Exit 1');
    }
    write('docs/ui/manifest.json', manifest([complete, complete]));
    assert(has(check(fullImageOptions), 'image-duplicate'), 'Doppelte Bilder sind in der vollen Prüfung Fehler');
    write('docs/ui/manifest.json', manifest([]));
    assert(has(check(fullImageOptions), 'image-manifest'), 'Fehlendes Pflichtbild ist in der vollen Prüfung ein Fehler');
    write('docs/ui/manifest.json', JSON.stringify({ imageCount: 1, totalBytes: 1, images: [complete] }));
    assert(has(check(fullImageOptions), 'image-total'), 'Falsche Gesamtgröße wird erkannt');
    write('docs/ui/manifest.json', manifest([complete]));
    write('docs/ui/unlisted.png', png);
    assert(has(check(fullImageOptions), 'image-manifest'), 'Unverzeichnetes PNG wird erkannt');
    fs.unlinkSync(path.join(root, 'docs/ui/unlisted.png'));
    write('docs/ui/crop.png', Buffer.concat([png, Buffer.alloc(8000001)]));
    assert(has(check(fullImageOptions), 'image-budget'), 'Bilder über 8 MB sind ein Fehler');
    write('docs/ui/crop.png', png);
    write('docs/ui/flow.html', '<h1>Monat abschließen</h1><img src="missing.png">');
    assert(has(check({ activeFiles: ['docs/ui/flow.html'], finishedFiles: ['docs/ui/flow.html'] }), 'image'), 'Fehlende Bilder in fertigen Ablaufseiten sind Fehler');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
