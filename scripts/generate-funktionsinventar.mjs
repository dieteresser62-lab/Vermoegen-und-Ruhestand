import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveInventory, protectionCounts, DYNAMIC_STATUSES, validateInventory, validateSources, readRepositorySources, checkInventorySizes, checkInventoryReadability, checkMarkdown, INVENTORY_SIZE_LIMITS, INVENTORY_LINE_LIMIT } from '../tests/funktionsinventar-contract.mjs';

const escape = value => String(value).replace(/\r\n?/g, '\n').replace(/\\/g, '\\\\')
    .replace(/([`*_{}\[\]<>#|])/g, '\\$1').replace(/\n/g, ' ⏎ ').trimEnd();
const short = (value, limit = 90) => [...value].length <= limit ? value : [...value].slice(0, limit - 1).join('') + '…';
const pageNames = { 'index.html': 'Übersicht', 'Balance.html': 'Balance',
    'Ausgaben.html': 'Ausgaben', 'Simulator.html': 'Simulator',
    'depot-tranchen-manager.html': 'Personen & Vermögen',
    'Handbuch.html': 'Handbuch', 'Daten-Sicherung.html': 'Daten & Sicherung' };
const extras = { keyboard: 'Tastatur', print: 'Druck', messages: 'Meldungen', dialogs: 'Dialoge', manualAnchors: 'Handbuchanker' };

/** Aufgabenhauptort für die Handbuchpflicht jedes Funktionseintrags. */
export function handbookChapter(entry) {
    const text = `${entry.section} ${entry.label}`.toLowerCase();
    if (/probelauf/.test(text)) return 'probelauf';
    if (entry.page === 'Daten-Sicherung.html') return 'daten-sicherung';
    if (entry.page === 'Ausgaben.html' || /ausgaben/.test(text)) return 'ausgaben';
    if (/verlauf|vermögenshistorie/.test(text)) return 'vermoegensverlauf';
    if (/jahresabschluss|jahres-update|jahresupdate/.test(text)) return 'jahr-abschliessen';
    if (/monatsabschluss|monatsbetrag bereitstellen/.test(text)) return 'monat-abschliessen';
    if (entry.page === 'Handbuch.html') return ({ H01: 'erste-schritte', H02: 'erste-schritte', H03: 'haeufige-fragen',
        H04: 'erste-schritte', H05: 'simulator', H06: 'monte-carlo', H07: 'balance', H08: 'balance',
        H09: 'haushalt-plan', H10: 'erste-schritte', H11: 'begriffe', H12: 'haeufige-fragen',
        H13: 'haeufige-fragen', H14: 'haeufige-fragen', H15: 'daten-sicherung' })[entry.id] || 'erste-schritte';
    if (/sicherung|backup|restore|import|export|recovery/.test(text)) return 'daten-sicherung';
    if (entry.page === 'depot-tranchen-manager.html') return /verkauf|ausführung|cashstatus|abgleich/.test(text)
        ? 'verkauf' : /tranche|depot|kurs/.test(text) ? 'kauf' : 'haushalt-plan';
    if (entry.page === 'Simulator.html') return /replay|sweep|optimi|werkstatt/.test(text) ? 'werkstatt'
        : /monte|szenario|protokoll|risiko|verteilung/.test(text) ? 'monte-carlo' : 'simulator';
    if (entry.page === 'Balance.html') return /flex|kürzung/.test(text) ? 'warum-gekuerzt' : 'balance';
    return 'erste-schritte';
}

/** Kompakte, deterministische Übersicht; Detailprüffälle bleiben in der JSON-Quelle. */
export function renderInventory(source) {
    const inventory = resolveInventory(source);
    const entries = inventory.pages.flatMap(page => page.entries);
    const counts = protectionCounts(source);
    const lines = ['# Funktionsinventar', '',
        'Generiert aus [funktionsinventar.json](funktionsinventar.json). Änderungen und vollständige Detailprüffälle ausschließlich in der JSON-Quelle.', '',
        `Prüfstatus: ${escape(inventory.auditStatus)} · Anwendungscode-Basis (sourceRevision): ${inventory.sourceRevision} · Schema: ${inventory.schemaVersion}`, '',
        '## Grenzen', '',
        'Das statische Gate prüft Struktur, Erzeugerort und unterstützte Erzeugung. Es beweist weder Laufzeitaufruf oder DOM-Anfügen noch Bedienung, Optik und fachliche Semantik. Identische Anker können mehrere Elemente bezeichnen.', '',
        'Geschützte Belege verlangen den vollständigen Selektor und den eigenen Anker an demselben Element. Eltern liefern nur Selektorkontext. Data-Anker ohne value prüfen Attributpräsenz, explizite Werte einschließlich leerer Werte bleiben exakt.', '',
        'Delegierte Codebezüge nennen eindeutige Ereignisfelder in delegates: jeder statische Treffer liegt unter ancestor, dynamische Felder folgen inventarisierten Hostketten. functions erfasst alle benannten Definitionen oder echten lokalen Importbindungen; leere Listen verlangen eine begründete nonFunction-Klassifikation. HTML-Definitionen stammen ausdrücklich aus inline-module oder gemäß Operatorentscheidung vom 04.10.2026 aus inline-classic. Kommentare, Strings, Aufrufe und externe Scriptattribute liefern keinen Definitionsnachweis. Der Nachweis prüft weder importierte Laufzeittypen noch Funktionskörperidentität.', '',
        '## Arbeitsbereiche', ''];
    for (const page of inventory.pages) {
        lines.push(`### ${pageNames[page.path] || page.path}`, '', `Quelle: \`${page.path}\``, '',
            '| Kennung | Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket | Handbuch |',
            '|---|---|---|---|---|---|---|---|---|');
        for (const entry of page.entries) {
            const states = [...new Set(entry.initialStates.map(state => state.kind))].join(', ');
            const storage = [...new Set(entry.storage.map(record => record.kind + (record.keys.length ? ': ' + short(record.keys.join(', '), 65) : '')))].join('; ');
            const gaps = entry.coverage.gaps;
            const coverage = `Node ${entry.coverage.node.length}; Browser ${entry.coverage.browser.length}; Risiko ${gaps.filter(g => g.kind === 'Änderungsrisiko').length}; Schuld ${gaps.filter(g => g.kind === 'Testschuld').length}`;
            const packages = [entry.target.firstPackage, ...entry.target.laterPackages].join(', ');
            lines.push('| ' + [entry.id, entry.page, entry.section, entry.label, states, short(storage, 110), coverage, packages].map(escape).join(' | ')
                + ` | [Kapitel](../../Handbuch.html#${handbookChapter(entry)}) |`);
        }
        lines.push('', '#### Seitenzusätze', '');
        for (const [field, label] of Object.entries(extras)) {
            const extra = page[field];
            lines.push(`- **${label}:** ${escape(extra.statement)} (${extra.entryIds.join(', ') || 'keine Kennung'})`);
            if (extra.opening) lines.push(`- **Öffnungsart:** ${escape(extra.opening)}`);
        }
        for (const anchor of page.manualAnchors.external || []) lines.push(`- **Externer Anker:** ${escape(anchor.source)} → ${escape(anchor.hash || 'kein Kapitelhash')}; ${anchor.entryId}; Tab ${anchor.tab}; ${escape(anchor.focus)}; ${escape(anchor.opening)}`);
        lines.push('');
    }
    lines.push('', '### Zusätzliche Auftretensorte', '');
    for (const entry of entries) for (const place of entry.additionalOccurrences || []) {
        lines.push(`- **${entry.id} → ${escape(place.page)} · ${escape(place.section)}:** ${escape([...place.selectors.static, ...place.selectors.dynamic.map(record => record.selector)].join(', '))}; Node ${place.coverage.node.length}, Browser ${place.coverage.browser.length}.`);
    }
    lines.push('', '## Schutz und Risiken', '',
        '### Dynamische Schutzstatistik', '',
        `${entries.length} Funktionseinträge; ${Object.values(counts).reduce((a, b) => a + b, 0)} dynamische Belege:`, '',
        ...DYNAMIC_STATUSES.map(status => `- ${status}: **${counts[status]}**`), '',
        'Gemischte Einträge sind nur für ihre einzeln als geschützt ausgewiesenen Belege geschützt. Beide ungeschützten Kategorien zählen separat.', '',
        '### Funktionen ohne vollständigen Zielbildplatz', '');
    const missing = entries.filter(entry => entry.target.missingInTarget);
    if (!missing.length) lines.push('Keine.', '');
    for (const entry of missing) lines.push(`- **${entry.id}:** ${escape(entry.target.location)} — ${escape(entry.target.proposal)}`);
    lines.push('');
    for (const kind of ['Änderungsrisiko', 'Testschuld']) {
        lines.push(`### ${kind}`, '', kind === 'Änderungsrisiko'
            ? 'Nachweise gelten für das durch das genannte Paket berührte Verhalten. Jedes Lückenpaket gehört zum Zielpaketsatz des Eintrags. Generische spätere Zuordnungen tragen „vorläufig – wird in der Paket-Idee eingeordnet“. Bei fehlendem Anker zuerst data-* ergänzen, Beleg und Bediennachweis aktualisieren, danach umbauen.'
            : 'Vorhandene Nachweislücken ohne durch diesen Umbau geändertes Verhalten. Der Paketbezug dient der Einordnung und begründet keine Pflicht vor diesem Paket.', '',
            'Schrift- und Farbänderungen allein verlangen keinen pauschalen Bediennachweis.', '');
        for (const pkg of inventory.packageOrder) {
            const gaps = entries.flatMap(entry => entry.coverage.gaps.filter(gap => gap.kind === kind && gap.package === pkg).map(gap => ({ entry, gap })));
            if (!gaps.length) continue;
            lines.push(`#### Zuordnung ${pkg}`, '', `Paketbezug: ${pkg}.`, '');
            for (const { entry, gap } of gaps) lines.push(`- **${entry.id}${gap.selector ? ' · ' + escape(gap.selector) : ''}:** ${escape(gap.evidence)} — ${escape(gap.reason)}`);
            lines.push('');
        }
    }
    lines.push('### Prüfergrenzen', '', 'Nicht unterstützte Erzeugungsformen sind kein automatischer Auftrag zur Produktänderung. Ihr stabiler Anker ist nur lexikalisch am genannten Ort geprüft.', '');
    for (const entry of entries) for (const record of entry.selectors.dynamic.filter(record => record.status === DYNAMIC_STATUSES[2])) {
        lines.push(`- **${entry.id} · ${escape(record.selector)}:** ${escape(record.producer.module)} / ${escape(record.producer.name || record.producer.kind)} — ${escape(record.reason)}`);
    }
    lines.push('', '### Befunde außerhalb des Inventars', '');
    for (const finding of inventory.findings) lines.push(`#### ${finding.id}`, '',
        `Kennungen: ${finding.entryIds.join(', ')} · Quelle: ${escape(finding.source.path)} / ${escape(finding.source.location)}`, '',
        escape(finding.actual), '', escape(finding.boundary), '');
    lines.push('', '## Herkunft', '',
        'sourceRevision bezeichnet dauerhaft den Anwendungscode vor der Design-Grundlage, nicht den aktuellen Inventarcommit. Die historische Registerprovenienz ist die erste Inventarerhebung (d0418d2 bis db728d0); baselineAudit erhält deren Ausgangskennungen unabhängig davon. Der Fortsetzungscommit 0f4ebce bezeichnet den Inventarstand vor dieser Nachschärfung. Die Basisrevision behauptet kein dort vorhandenes Inventar; das Schutzgate benötigt keinen Live-Git-Zugriff.', '',
        'Fahrplanreihenfolge: ' + inventory.packageOrder.join(' → '), '',
        '### Entfallen auf Nutzerentscheid', '', 'Nutzerentscheid vom 05.10.2026.', '');
    for (const entry of inventory.baselineAudit.filter(entry => entry.status === 'entfallen')) {
        lines.push(`- **${entry.id}:** ${escape(entry.reason)}`);
    }
    lines.push('');
    lines.push('### Ausgangsregister und Detailquelle', '',
        `${inventory.baselineAudit.length} Ausgangskennungen bleiben mit Status, Begründung und aktuellen Kennungsbezügen in der JSON-Quelle nachvollziehbar. Zustandsgruppen benennen ihre Selektoren ausdrücklich; Prüf-, Speicher-, Bindungs- und Testdetails stehen dort vollständig.`, '',
        'Die lesbare Schema-2-Quelle schreibt Status, Modul-/Dateipfade, Speicherkeys, Zielpakete und Selektoren unmittelbar aus. Gemeinsame Definitionen enthalten ausschließlich tatsächlich wiederholte Langtexte ab 80 Unicode-Zeichen mit unterscheidbaren sprechenden Namen; jede Definition steht auf einer eigenen Zeile. `@bereich.inhalt` verweist auf einen Langtext, `@@` erhält ein wörtliches @; `join` verbindet ausschließlich Textteile in beschreibenden Feldern. Lokale Audit-/Prüfbezüge nennen den Index im eigenen Eintrag; Zielbezüge benennen den konkreten Zielort und Änderungsgrund. Der allgemeine Resolver unterstützt weiterhin Objektbezüge und Tabellen für Vertragsproben, das lesbare Quellformat erlaubt sie nicht. Fehlende Referenzen, falsche Typen und Zyklen sind Vertragsfehler.', '',
        `Inklusive UTF-8-Bytegrenzen: Quelle ${INVENTORY_SIZE_LIMITS.source} B (ausdrückliche Nutzer-/Operatorentscheidung vom 06.10.2026), Lesefassung ${INVENTORY_SIZE_LIMITS.markdown} B, kompakt serialisierter aufgelöster Eintrag ${INVENTORY_SIZE_LIMITS.entry} B. Höchstens ${INVENTORY_LINE_LIMIT} Unicode-Zeichen je Quellzeile.`, '');
    return lines.join('\n').trimEnd() + '\n';
}

/** Gemeinsamer Generatorpfad für CLI und injizierte Prüfkopien ohne Dateischreibzugriff. */
export function generateInventory(json, markdown, { check = false, files } = {}) {
    const inventory = JSON.parse(json);
    const validation = validateInventory(inventory);
    if (!validation.ok) throw new Error(validation.errors.join('\n'));
    if (files) {
        const sources = validateSources(inventory, files);
        if (!sources.ok) throw new Error(sources.errors.join('\n'));
    }
    const rendered = renderInventory(inventory);
    const sizes = checkInventorySizes(json, rendered);
    if (!sizes.ok) throw new Error(sizes.errors.join('\n'));
    const readability = checkInventoryReadability(json);
    if (!readability.ok) throw new Error(readability.errors.join('\n'));
    if (check) {
        const freshness = checkMarkdown(inventory, markdown, renderInventory);
        if (!freshness.ok) throw new Error(freshness.errors.join('\n'));
    }
    return rendered;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== '--check')) throw new Error('Aufruf: node scripts/generate-funktionsinventar.mjs [--check]');
        const root = fileURLToPath(new URL('../', import.meta.url));
        const json = fs.readFileSync(path.join(root, 'docs/design/funktionsinventar.json'), 'utf8');
        const output = path.join(root, 'docs/design/funktionsinventar.md');
        const check = process.argv[2] === '--check';
        const markdown = check && fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : undefined;
        const rendered = generateInventory(json, markdown, { check, files: readRepositorySources(JSON.parse(json), root) });
        if (check) {
            console.log('Lesefassung ist aktuell.');
        } else { fs.writeFileSync(output, rendered, 'utf8'); console.log('Lesefassung erzeugt.'); }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
