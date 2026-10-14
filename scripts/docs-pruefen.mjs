import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const LOCAL_RULE_FILES = Object.freeze(['fachregeln.md', 'entwicklungsgrundsaetze.md',
    'schreibregeln.md'].map(name => `docs/internal/design/${name}`));
const AGENT_FILES = new Set(['AGENTS.md', 'CODEX.md', 'CLAUDE.md', 'GEMINI.md']);
const isAgentFile = file => AGENT_FILES.has(file) || file.startsWith('.agent/');
// Die öffentliche Dokuprüfung braucht ihre Wortliste auch ohne lokale Regeldateien.
const STYLE_PHRASES = Object.freeze(['Im Folgenden', 'Es ist wichtig zu beachten',
    'Zusammenfassend', 'spielt eine zentrale/entscheidende Rolle', 'ermöglicht es Ihnen',
    'nahtlos', 'umfassend', 'ganzheitlich', 'robust', 'intuitiv', 'optimal', 'leistungsstark',
    'im Wesentlichen', 'grundsätzlich', 'gegebenenfalls', 'nicht nur …, sondern auch',
    'Egal ob … oder …']);

// Genaue Quellenkennungen und Zahlen, die wie kurze Git-Hashes aussehen.
// Nur diese Textstellen in diesen Dateien ausnehmen, keine ganzen Register/URLs.
const HEX_EXCEPTIONS = Object.freeze({
    'data/historical/gold-german-investor-chain/README.md': ['32.15074656862798'],
    'docs/reference/DATA_SOURCES.md': ['32.15074656862798'],
    'docs/reference/MARKTVERGLEICH_EVIDENZREGISTER.md': [
        '/articles/10563826-how-do-i-account-for-rate-of-return-assumptions'
    ],
    'docs/reference/FORSCHUNGSABGLEICH_EVIDENZREGISTER.md': [
        // DOI, auch im sichtbaren Linktext und in der kodierten AEA-Adresse.
        '10.1257/000282805775014281', '10.1257%2F000282805775014281',
        '10.1214/aos/1176344552', '10.1214/aos/1176347265',
        '10.1080/01621459.1994.10476870', '10.1080/713665670',
        '10.1093/0198296940.001.0001',
        // Artikel- und Publikationskennungen der verlinkten Quellen.
        '/pii/0304407686900631/pdf', 'pid=1-s2.0-0304407686900631-main.pdf',
        '/pii/016518899290044F',
        '/safe-withdrawal-rate-evidence-from-a-broad-sample-of-developed-markets/5D6C1EBBAFE135FC27D236C9F46E677F',
        '/kohortensterbetafeln-5126101209004.pdf',
        '/statistischer-bericht-pflege-deutschlandergebnisse-5224001239005.html'
    ]
});
const EVIDENCE_REGISTERS = new Set([
    'docs/reference/MARKTVERGLEICH_EVIDENZREGISTER.md',
    'docs/reference/FORSCHUNGSABGLEICH_EVIDENZREGISTER.md'
]);

// Vollständige aktive Zielstruktur aus GLIEDERUNG.md.
export const ACTIVE_FILES = Object.freeze([
    'README.md', 'QUICKSTART.md', 'CHANGELOG.md', 'AGENTS.md', 'CODEX.md',
    'CLAUDE.md', 'GEMINI.md', 'LICENSE.md', 'Handbuch.html', 'docs/README.md',
    'tests/README.md', 'engine/README.md', 'assets/README-schriften-symbole.md',
    'scripts/dev/README.md',
    ...['global-equity-research-chain', 'german-cpi-chain',
        'german-cash-money-market-chain', 'gold-german-investor-chain',
        'us-shiller-cape-chain', 'german-gross-wage-growth-chain']
        .map(name => `data/historical/${name}/README.md`),
    'data/static/german-demography-care-survivor-contract/README.md',
    ...['TECHNICAL', 'FACHKONZEPT', 'BALANCE_MODULES_README',
        'SIMULATOR_MODULES_README', 'TRANCHEN_MODULES_README', 'DATENVERTRAEGE',
        'ENGINE_DECISION_LOGIC', 'AUTO_OPTIMIZE_DETAILS', 'WISSENSCHAFTLICHER_RAHMEN',
        'MARKTVERGLEICH', 'MARKTVERGLEICH_EVIDENZREGISTER',
        'FORSCHUNGSABGLEICH_EVIDENZREGISTER', 'DATA_SOURCES']
        .map(name => `docs/reference/${name}.md`),
    'docs/guides/EINRICHTUNG_UND_BETRIEB.md',
    ...['designsystem.md', 'funktionsinventar.json', 'funktionsinventar.md']
        .map(name => `docs/design/${name}`),
    ...LOCAL_RULE_FILES,
    'docs/ui/README.md', 'docs/ui/manifest.json',
    'docs/ui/monatsabschluss.html', 'docs/ui/jahresabschluss.html'
]);

// Handbuch, Bildverzeichnis, Manifest und Abläufe sind vollständig geprüft.
export const FINISHED_FILES = ACTIVE_FILES;
export const TRANSITION_FILES = Object.freeze([]);
export const HANDBOOK_ANCHORS = Object.freeze([
    'erste-schritte', 'monat-abschliessen', 'jahr-abschliessen', 'ausgaben', 'kauf',
    'verkauf', 'haushalt-plan', 'balance', 'warum-gekuerzt', 'vermoegensverlauf',
    'simulator', 'monte-carlo', 'werkstatt', 'daten-sicherung', 'probelauf',
    'haeufige-fragen', 'begriffe'
]);
export const IMAGE_FILES = Object.freeze([
    'uebersicht', 'personen-haushalt-plan', 'personen-max', 'personen-erika',
    'verlauf-haushalt', 'verlauf-max', 'verlauf-erika', 'ausgaben',
    'balance-ueberblick', 'balance-bedarf-strategie', 'balance-diagnose',
    'simulator-ergebnis', 'simulator-annahmen', 'simulator-backtest',
    'monte-carlo-einstellungen', 'monte-carlo-ueberblick', 'monte-carlo-risiko-verteilung',
    'monte-carlo-pflege', 'monte-carlo-szenario-logs', 'werkstatt', 'werkstatt-replay',
    'werkstatt-sweep', 'werkstatt-auto-optimize', 'daten-sicherung', 'probelauf-band',
    'handbuch-start',
    ...['01-faellig', '02-kurse', '03-ausgaben', '04-budget', '05-tagesgeld', '06-ergebnis']
        .map(name => `monatsabschluss/${name}`),
    ...['01-faellig', '02-kurse', '03-ausgaben', '04-budget', '05-tagesgeld',
        '06-marktdaten', '07-plan', '08-ergebnis'].map(name => `jahresabschluss/${name}`)
].map(name => `docs/ui/${name}.png`));
const APP_PAGES = ['index.html', 'depot-tranchen-manager.html', 'Ausgaben.html',
    'Balance.html', 'Simulator.html', 'Daten-Sicherung.html'];
// Hash-Routen sind gültige Anker, wenn Quellzuordnung und reales Fokusziel existieren.
const HASH_ROUTES = { 'depot-tranchen-manager.html': {
    source: 'app/tranches/tranchen-manager-page.js', table: 'managerTargets'
} };
const ARCHIVE = /^(?:docs\/internal\/|docs\/neuaufbau\/|dist\/)/;
const blank = value => value.replace(/[^\n]/g, ' ');

function decodeEntities(value) {
    const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
    return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (all, code) => {
        if (code.startsWith('#')) {
            const number = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
            return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : all;
        }
        return entities[code.toLowerCase()] || all;
    });
}
const visibleText = value => decodeEntities(value.replace(/<[^>]*>/g, '').replace(/[`*_~]/g, ''))
    .replace(/\s+/g, ' ').trim();
const slug = value => visibleText(value.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')).toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;

function readerHexMatches(file, source) {
    if (ARCHIVE.test(file) || isAgentFile(file) || file === 'docs/design/funktionsinventar.md') return [];
    // Codebeispiele und Inline-Code mitprüfen; dort standen auch die Commit-Kennungen.
    let clean = source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, blank);
    for (const text of HEX_EXCEPTIONS[file] || []) clean = clean.replaceAll(text, blank(text));
    if (EVIDENCE_REGISTERS.has(file)) {
        // Nur benannte Prüfsummen mit passender Länge, auch in URL-Parametern.
        clean = clean.replace(/\bMD5(?:[ \t]*[=:][ \t]*|[ \t]+)[`"']?[a-f\d]{32}\b/gi, blank)
            .replace(/\b(?:SHA-1|sha1)(?:[ \t]*[=:][ \t]*|[ \t]+)[`"']?[a-f\d]{40}\b/gi, blank);
    }
    return [...clean.matchAll(/\b[0-9a-f]{8,40}\b/gi)];
}

// Kleine, belegbare DOM-Erzeugungsformen der App. Keine Ausführung des Quellcodes.
// Ein Text muss an derselben Variablen wie der ID-/Data-Anker gesetzt werden.
export function programmaticControlTexts(source, selector) {
    const id = selector.match(/^#([\w:-]+)$/)?.[1];
    const data = selector.match(/^\[(data-[\w-]+)\]$/)?.[1];
    if (!id && !data) return [];
    const quote = "(['\"`])([^'\"`]*?)\\1";
    const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const variables = new Set();
    const code = source.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^\s*\/\/.*$/gm, blank);
    if (id) {
        for (const m of code.matchAll(new RegExp(`(\\w+)\\.id\\s*=\\s*['\"]${escaped(id)}['\"]`, 'g'))) variables.add(m[1]);
        for (const m of code.matchAll(new RegExp(`(\\w+)\\s*=\\s*[^;\\n]*?\\.getElementById(?:\\?\\.)?\\(\\s*['\"]${escaped(id)}['\"]\\)`, 'g'))) variables.add(m[1]);
    }
    if (data) {
        const key = data.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        for (const m of code.matchAll(new RegExp(`(\\w+)\\.dataset\\.${escaped(key)}\\s*=`, 'g'))) variables.add(m[1]);
    }
    const texts = [];
    for (const variable of variables) {
        // Nur tatsächlich erzeugte Elemente; zufällige Text-/Ankerstrings zählen nicht.
        const creation = new RegExp(`\\b${variable}\\s*=\\s*(?:[^;\\n]*?\\.createElement\\(['\"](?:button|a|input)['\"]\\)|button\\(|node\\(['\"]button['\"]\\))`);
        const lookup = id && new RegExp(`\\b${variable}\\s*=\\s*[^;\\n]*?\\.getElementById(?:\\?\\.)?\\(\\s*['\"]${escaped(id)}['\"]\\)`);
        if (!creation.test(code) && !lookup?.test(code)) continue;
        for (const assignment of code.matchAll(new RegExp(`\\b${escaped(variable)}\\.textContent\\s*=\\s*([^;\\n]+)`, 'g'))) {
            const expression = assignment[1].trim();
            // Literal oder einfache ternäre Literalalternativen; keine zufälligen Argumentstrings.
            if (!/^(?:['\"`]|[\w.]+\s*\?)/.test(expression)) continue;
            for (const m of expression.matchAll(new RegExp(quote, 'g'))) texts.push(visibleText(m[2]));
        }
    }
    if (id) {
        // Der Jahresadapter hat den lokalen Helfer button(text, id).
        for (const m of code.matchAll(new RegExp(`(\\w+)\\s*=\\s*button\\(\\s*${quote.replace('\\1', '\\2')}\\s*,\\s*['\"]${escaped(id)}['\"]\\s*\\)`, 'g'))) {
            if (variables.has(m[1]) && /const button = \(text, id\) =>/.test(code)) texts.push(visibleText(m[3]));
        }
    }
    return texts;
}

function withoutFences(source) {
    let fence = null;
    return source.split('\n').map(line => {
        const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (fence) {
            if (match && match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
            return blank(line);
        }
        if (match) { fence = match[1]; return blank(line); }
        return line;
    }).join('\n');
}

// Bewusst nur Strukturprüfungen für einfache Mermaid-Blöcke, kein Syntaxparser.
function mermaidDiagnostics(source) {
    const diagnostics = [];
    const report = (code, offset, expected, reason) => diagnostics.push({ code, offset, expected, reason });
    const identifier = '[A-Za-z_][A-Za-z0-9_]*';
    const inspect = block => {
        const type = block.lines[0]?.text.trim() || '';
        if (!/^(?:flowchart[ \t]+(?:TD|LR)|sequenceDiagram)$/.test(type)) {
            report('mermaid-type', block.lines[0]?.offset ?? block.offset,
                'flowchart TD / flowchart LR / sequenceDiagram als erste Zeile', 'Nicht erlaubter oder fehlender Diagrammtyp');
            return;
        }
        const nodes = new Set();
        for (const { text, offset } of block.lines.slice(1)) {
            const line = text.trim();
            if (!line || line.startsWith('%%')) continue;
            if (type === 'sequenceDiagram') {
                const participant = line.match(new RegExp(`^(?:participant|actor)\\s+(${identifier})(?:\\s+as\\s+.+)?$`));
                if (participant) { nodes.add(participant[1]); continue; }
                const arrow = line.match(/--?(?:>>?|\))/);
                if (!arrow) continue;
                const from = line.slice(0, arrow.index).trim();
                const rest = line.slice(arrow.index + arrow[0].length);
                const colon = rest.indexOf(':');
                const to = (colon < 0 ? rest : rest.slice(0, colon)).trim();
                const isId = value => new RegExp(`^${identifier}$`).test(value);
                if (isId(from)) nodes.add(from);
                if (isId(to)) nodes.add(to);
                if (!isId(from) || !isId(to) || colon < 0 || !rest.slice(colon + 1).trim()) {
                    report('mermaid-edge', offset, 'Absender, Empfänger und Nachricht', 'Leere oder unvollständige Sequenzkante');
                }
            } else {
                // Beschriftungen können selbst Pfeile oder Knotennamen enthalten.
                const clean = line.replace(/"(?:\\.|[^"\\])*"/g, '""');
                for (const match of clean.matchAll(new RegExp(`\\b(${identifier})\\s*(?:\\[|\\{|\\()`, 'g'))) nodes.add(match[1]);
                const parts = clean.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, '')
                    .replace(/\|[^|]*\|/g, '').split(/(?:<-->|-->|---|==>|-\.->)/);
                if (parts.length < 2) {
                    const standalone = parts[0].trim().replace(/;$/, '').match(new RegExp(`^(${identifier})$`));
                    if (standalone && standalone[1] !== 'end') nodes.add(standalone[1]);
                    continue;
                }
                const emptyLabel = /\|\s*\|/.test(line);
                for (const part of parts) {
                    // Einfache Ketten und reine Knotenreferenzen zählen jeweils nur einmal.
                    const id = part.trim().replace(/;$/, '').match(new RegExp(`^(${identifier})$`));
                    if (id) nodes.add(id[1]);
                    else report('mermaid-edge', offset, 'Knoten an beiden Kantenenden', 'Leere oder unvollständige Ablaufkante');
                }
                if (emptyLabel) report('mermaid-edge', offset, 'Nicht leere Kantenbeschriftung', 'Leere Kantenbeschriftung');
            }
        }
        if (nodes.size < 1 || nodes.size > 25) report('mermaid-nodes', block.offset,
            '1 bis 25 Knoten; bei Sequenzen eindeutige Teilnehmer', `${nodes.size} Knoten im Diagramm`);
    };
    let block = null, offset = 0;
    for (const line of source.replace(/<!--[\s\S]*?-->/g, blank).split('\n')) {
        const fence = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (block) {
            if (fence && fence[1][0] === block.fence[0] && fence[1].length >= block.fence.length && !fence[2].trim()) {
                if (block.mermaid) inspect(block);
                block = null;
            } else if (block.mermaid) block.lines.push({ text: line, offset });
        } else if (fence) {
            block = { fence: fence[1], mermaid: fence[2].trim() === 'mermaid', offset, lines: [] };
        }
        offset += line.length + 1;
    }
    if (block?.mermaid) {
        report('mermaid-unclosed', block.offset, 'Passender schließender Markdown-Zaun', 'Mermaid-Block nicht geschlossen');
        inspect(block);
    }
    return diagnostics;
}

function withoutCode(source, markdown) {
    let result = source.replace(/<!--[\s\S]*?-->/g, blank);
    if (markdown) {
        result = withoutFences(result);
        result = result.replace(/(`+)([^\n]*?)\1/g, blank);
    }
    return result.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, blank);
}

function attributes(tag) {
    const result = new Map();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
        result.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3] ?? match[4]));
    }
    const bare = tag.replace(/([\w:-]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, '');
    for (const match of bare.matchAll(/\s(data-[\w-]+)(?=\s|\/?>)/g)) result.set(match[1], '');
    return result;
}

function anchors(source, markdown) {
    const ids = new Map(), duplicates = [], headings = [], counts = new Map();
    const add = (id, offset) => {
        if (ids.has(id)) duplicates.push({ id, offset });
        else ids.set(id, offset);
    };
    const clean = withoutCode(source, markdown);
    for (const match of clean.matchAll(/<[a-z][^>]*>/gi)) {
        const attrs = attributes(match[0]);
        const id = attrs.get('id') || (/^<a\b/i.test(match[0]) && attrs.get('name'));
        if (id) add(id, match.index);
    }
    if (markdown) {
        // Heading code spans are part of the slug; only fences/comments are masked here.
        const lines = clean.split('\n'), original = source.split('\n');
        let offset = 0;
        for (let i = 0; i < lines.length; i++) {
            const atx = lines[i].match(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
            const setext = i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1]) && lines[i].trim();
            if (atx || setext) {
                const title = atx ? original[i].replace(/^ {0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '') : original[i].trim();
                const base = slug(title);
                let id = base, n = counts.get(base) || 0;
                if (n) id = `${base}-${n}`;
                while (ids.has(id)) id = `${base}-${++n}`;
                counts.set(base, n + 1);
                add(id, offset); headings.push({ title, offset });
            }
            offset += lines[i].length + 1;
        }
    } else {
        for (const match of clean.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
            headings.push({ title: visibleText(match[1]), offset: match.index });
        }
    }
    return { ids, duplicates, headings };
}

function links(source, markdown) {
    const clean = withoutCode(source, markdown), result = [];
    for (const match of clean.matchAll(/<[a-z][^>]*>/gi)) {
        const attrs = attributes(match[0]);
        for (const key of ['href', 'src']) if (attrs.has(key)) {
            result.push({ url: attrs.get(key), image: /^<img\b/i.test(match[0]), offset: match.index });
        }
    }
    if (!markdown) return result;
    const definitions = new Map();
    for (const match of clean.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) {
        definitions.set(match[1].trim().toLowerCase(), match[2].replace(/^<|>$/g, ''));
    }
    // Balanced destinations support spaces in <...>, parentheses and optional titles.
    const pattern = /(?<!\\)(!?)\[((?:\\.|[^\]\\])*)\](\(|\[([^\]]*)\])?/g;
    for (const match of clean.matchAll(pattern)) {
        // Attributselektoren in technischen Tabellen sind keine Referenzlinks.
        if (/^(?:data-|aria-)/.test(match[2]) || /[.=#]/.test(clean[match.index - 1] || '')) continue;
        let url;
        if (match[3] === '(') {
            let i = match.index + match[0].length;
            while (/\s/.test(clean[i] || '') && i < clean.length) i++;
            if (clean[i] === '<') {
                const end = clean.indexOf('>', i + 1);
                if (end >= 0) url = clean.slice(i + 1, end);
            } else {
                const start = i; let depth = 0;
                for (; i < clean.length; i++) {
                    if (clean[i] === '\\') { i++; continue; }
                    if (clean[i] === '(') depth++;
                    if (clean[i] === ')') { if (!depth) break; depth--; }
                    if (/\s/.test(clean[i]) && !depth) break;
                }
                url = clean.slice(start, i).replace(/\\([()])/g, '$1');
            }
        } else {
            if (clean[match.index + match[0].length] === ':') continue;
            const name = (match[4] || match[2]).trim().toLowerCase();
            url = definitions.get(name);
            if (url === undefined && match[3]) result.push({ url: null, reference: name, offset: match.index });
        }
        if (url !== undefined) result.push({ url, image: Boolean(match[1]), offset: match.index });
    }
    for (const match of clean.matchAll(/<(https?:\/\/[^<>\s]+)>/gi)) result.push({ url: match[1], offset: match.index });
    return result;
}

// Read the quoted phrases from the permanent rules, including the two sentence patterns.
export function phrasePatterns(rules) {
    const list = rules?.split(/## Verboten[^\n]*\n/)[1]?.split('\n').find(line => line.startsWith('- Floskeln')) || '';
    const phrases = rules === null ? STYLE_PHRASES : [...list.matchAll(/„([^“]+)“/g)].map(([, phrase]) => phrase);
    return phrases.map(phrase => {
        let pattern = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = pattern.replace('zentrale/entscheidende', '(?:zentrale|entscheidende)')
            .replace(/\s*…\s*/g, '[^.!?\\n]{0,160}').replace(/ /g, '\\s+');
        return { phrase, regex: new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'giu') };
    });
}

export function checkDocs({ root = REPO_ROOT, activeFiles = ACTIVE_FILES,
    finishedFiles = FINISHED_FILES, transitionFiles = TRANSITION_FILES,
    appPages = APP_PAGES, scanAppHelp = true, handbookAnchors = HANDBOOK_ANCHORS,
    imageManifest = 'docs/ui/manifest.json', imageFiles = IMAGE_FILES, checkImages = true } = {}) {
    root = path.resolve(root);
    const diagnostics = [], cache = new Map(), finished = new Set(finishedFiles);
    const hasInternalDocs = fs.existsSync(path.join(root, 'docs/internal'));
    const emit = (severity, code, file, source, offset, expected, reason) => diagnostics.push({
        severity, code, file, line: lineAt(source, offset), expected, reason
    });
    const read = file => {
        if (!cache.has(file)) {
            const full = path.resolve(root, file);
            cache.set(file, fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : null);
        }
        return cache.get(file);
    };
    const inside = full => full === root || full.startsWith(root + path.sep);
    const targetAnchors = new Map();
    const getAnchors = file => {
        if (!targetAnchors.has(file)) {
            const found = anchors(read(file) || '', file.endsWith('.md'));
            const route = HASH_ROUTES[file];
            if (route) {
                const table = read(route.source)?.match(new RegExp(`const ${route.table} = \\{([\\s\\S]*?)\\n\\};`))?.[1] || '';
                for (const m of table.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):\s*\{[^\n]*?focus:\s*'([^']+)'/gm)) {
                    if (found.ids.has(m[3])) found.ids.set(m[1] || m[2], 0);
                }
            }
            targetAnchors.set(file, found);
        }
        return targetAnchors.get(file);
    };
    function checkLink(file, source, link, fromRoot = false, evidence = false) {
        const { url, offset = 0, image = false } = link;
        const severity = image && !finished.has(file) ? 'warning' : 'error';
        if (url === null) { emit('error', 'reference', file, source, offset, link.reference, 'Linkdefinition fehlt'); return; }
        if (!url) return;
        if (/\$\{|\{\{|<%/.test(url)) {
            emit('warning', 'dynamic-link', file, source, offset, url, 'Dynamisches Ziel manuell prüfen'); return;
        }
        if (/^(?:https?:)?\/\//i.test(url)) {
            try { const u = new URL(url.startsWith('//') ? 'https:' + url : url); if (!u.hostname) throw new Error(); }
            catch { emit(severity, 'url', file, source, offset, url, 'Ungültige HTTP-Adresse'); }
            return;
        }
        if (/^(?:mailto|tel|data):/i.test(url)) return;
        if (/^[a-z][\w+.-]*:/i.test(url)) {
            emit(severity, 'url', file, source, offset, url, 'Nicht unterstütztes lokales oder externes Ziel'); return;
        }
        let filename, fragment;
        const hash = url.indexOf('#');
        try {
            filename = decodeURIComponent((hash < 0 ? url : url.slice(0, hash)).split('?')[0]);
            fragment = hash < 0 ? '' : decodeURIComponent(url.slice(hash + 1));
        } catch { emit(severity, 'url', file, source, offset, url, 'Ungültige Prozentkodierung'); return; }
        // K-1 verschiebt die Regeln bytegleich; ihre relativen Links behalten den Ursprungsort.
        const linkBase = LOCAL_RULE_FILES.includes(file) ? file.replace('docs/internal/design/', 'docs/design/') : file;
        const full = filename ? path.resolve(filename.startsWith('/') || fromRoot ? root : path.dirname(path.join(root, linkBase)), filename.replace(/^\//, '')) : path.join(root, file);
        const target = path.relative(root, full).split(path.sep).join('/');
        if (!inside(full)) { emit(severity, 'link', file, source, offset, url, 'Ziel liegt außerhalb des Repositorys'); return; }
        const agentRule = isAgentFile(file) && LOCAL_RULE_FILES.includes(target);
        if (!evidence && finished.has(file) && ARCHIVE.test(target) && !agentRule) emit(severity, 'archive-link', file, source, offset, url, 'Aktive Leserlinks dürfen nicht ins Archiv oder in Aufträge führen');
        if (agentRule && !hasInternalDocs && !fs.existsSync(full)) {
            emit('warning', 'local-rule', file, source, offset, url, 'Lokale Regeldatei fehlt im veröffentlichten Stand'); return;
        }
        if (!fs.existsSync(full)) { emit(severity, image ? 'image' : 'link', file, source, offset, url, 'Lokales Ziel fehlt'); return; }
        if (fragment && /\.(?:md|html?)$/i.test(target) && !getAnchors(target).ids.has(fragment)) {
            emit(target === 'Handbuch.html' && !finished.has(target) ? 'warning' : severity, 'anchor', file, source, offset, url, 'Anker fehlt im Ziel');
        }
    }
    function metadata(file, source) {
        const clean = file.endsWith('.md') ? withoutFences(source) : source;
        for (const match of clean.matchAll(/<!--\s*docs:(control|image)\s+([\s\S]*?)-->/g)) {
            const kind = match[1], severity = kind === 'image' && !finished.has(file) ? 'warning' : 'error';
            let data;
            try { data = JSON.parse(match[2]); }
            catch { emit(severity, 'metadata', file, source, match.index, 'JSON-Objekt', 'Metadaten sind kein gültiges JSON'); continue; }
            if (kind === 'image') { checkImage(file, source, match.index, data); continue; }
            if (!data || typeof data.source !== 'string' || typeof data.selector !== 'string' || typeof data.text !== 'string') {
                emit('error', 'control', file, source, match.index, 'source, selector, text', 'Bedienelement-Metadaten unvollständig'); continue;
            }
            checkLink(file, source, { url: data.source, offset: match.index }, true);
            const code = read(data.source);
            if (code === null) continue;
            const id = data.selector.match(/^#([\w:-]+)$/);
            const attr = data.selector.match(/^\[(data-[\w-]+)(?:=["']?([^\]"']+)["']?)?\]$/);
            if (!id && !attr) { emit('warning', 'control-manual', file, source, match.index, data.selector, 'Nur ID- und Data-Anker statisch prüfbar'); continue; }
            const clean = code.replace(/<!--[\s\S]*?-->/g, blank);
            const candidates = [...clean.matchAll(/<([a-z][\w-]*)\b[^>]*>/gi)].filter(item => {
                const a = attributes(item[0]);
                return id ? a.get('id') === id[1] : a.has(attr[1]) && (attr[2] === undefined || a.get(attr[1]) === attr[2]);
            });
            const texts = candidates.map(item => {
                const end = clean.indexOf(`</${item[1]}>`, item.index + item[0].length);
                const a = attributes(item[0]);
                if (item[1].toLowerCase() === 'input') {
                    const label = [...clean.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].find(label =>
                        attributes(label[0].slice(0, label[0].indexOf('>') + 1)).get('for') === a.get('id')
                        || label.index <= item.index && label.index + label[0].length > item.index);
                    if (label) return visibleText(label[0]);
                }
                return visibleText(a.get('value') || (end < 0 ? a.get('aria-label') || '' : clean.slice(item.index + item[0].length, end)));
            });
            texts.push(...programmaticControlTexts(clean, data.selector));
            if (!texts.length) { emit('error', 'control', file, source, match.index, `${data.source} ${data.selector}`, 'Bedienelement-Anker fehlt'); continue; }
            if (!texts.includes(visibleText(data.text))) {
                const unclear = texts.some(text => /\$\{|\{\{|<%/.test(text)) || texts.every(text => !text);
                emit(unclear ? 'warning' : 'error', unclear ? 'control-manual' : 'control-text', file, source, match.index,
                    data.text, `${data.source} ${data.selector}: ${unclear ? 'Text wird dynamisch gesetzt; manuell prüfen' : 'Quelltext lautet ' + texts.join(' / ')}`);
            }
        }
    }
    function checkImage(file, source, offset, data) {
        const severity = finished.has(file) ? 'error' : 'warning';
        if (!data || typeof data.path !== 'string') { emit(severity, 'image-metadata', file, source, offset, 'path', 'Bildmetadaten unvollständig'); return; }
        checkLink(file, source, { url: data.path, image: true, offset }, true);
        const full = path.resolve(root, data.path);
        if (!inside(full) || !fs.existsSync(full)) return;
        if (!fs.statSync(full).isFile()) { emit(severity, 'image-format', file, source, offset, 'PNG-Datei', `${data.path}: Ziel ist ein Ordner`); return; }
        const buffer = fs.readFileSync(full);
        if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
            emit(severity, 'image-format', file, source, offset, 'PNG', `${data.path}: kein lesbarer PNG-Kopf`); return;
        }
        const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
        if (width !== data.width || height !== data.height || width < 1 || height < 1 || width > 1920 || height > 1080) emit(severity, 'image-size', file, source, offset,
            `${data.width}×${data.height}`, `${data.path}: tatsächliche Maße ${width}×${height}`);
        if (data.household !== 'Max und Erika Mustermann' || data.viewport?.width !== 1920 || data.viewport?.height !== 1080
            || data.scale !== 1 || typeof data.caption !== 'string' || !data.caption.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(data.date || '')) {
            emit(severity, 'image-origin', file, source, offset, 'Mustermann, 1920×1080, Skalierung 1, Datum, Bildunterschrift', `${data.path}: Herkunft unvollständig`);
        }
        if (width !== 1920 || height !== 1080 || data.crop) {
            const c = data.crop;
            if (!c || ![c.x, c.y, c.width, c.height].every(Number.isInteger) || c.x < 0 || c.y < 0
                || c.width !== width || c.height !== height || c.x + width > 1920 || c.y + height > 1080) {
                emit(severity, 'image-crop', file, source, offset, 'Gültiger Ausschnitt aus 1920×1080', `${data.path}: Ausschnitt nicht belegt`);
            }
        }
        if (severity === 'error') {
            if (!data.path.startsWith('docs/ui/') || !data.path.endsWith('.png')
                || !data.source || typeof data.source.page !== 'string' || !data.source.page.trim()
                || typeof data.source.state !== 'string' || !data.source.state.trim()
                || !/^[a-f0-9]{40}$/.test(data.source.commit || '')) {
                emit('error', 'image-origin', file, source, offset, 'PNG-Pfad, Seite, Zustand und vollständiger Git-Commit', `${data.path}: Quellherkunft unvollständig`);
            } else checkLink(file, source, { url: data.source.page, offset }, true, true);
            if (!Number.isSafeInteger(data.bytes) || data.bytes !== buffer.length) {
                emit('error', 'image-bytes', file, source, offset, `${buffer.length} Bytes`, `${data.path}: Dateigröße stimmt nicht mit dem Manifest überein`);
            }
            if (data.sha256 !== createHash('sha256').update(buffer).digest('hex')) {
                emit('error', 'image-hash', file, source, offset, 'SHA-256 der PNG-Datei', `${data.path}: Datei und Manifest stammen nicht aus derselben Aufnahme`);
            }
        }
    }
    const rules = read('docs/internal/design/schreibregeln.md');
    const phrases = phrasePatterns(rules);
    const files = [...new Set([...activeFiles, ...transitionFiles])];
    for (const file of files) {
        const source = read(file);
        if (source === null) {
            if (LOCAL_RULE_FILES.includes(file) && !hasInternalDocs) continue;
            if (finished.has(file)) emit('error', 'file', file, '', 0, file, 'Fertige Datei fehlt');
            continue;
        }
        if (file.endsWith('.json')) {
            let data;
            try { data = JSON.parse(source); }
            catch { emit('error', 'json', file, source, 0, 'Gültiges JSON', 'Inventar nicht lesbar'); continue; }
            function visit(value, auditEvidence = false) {
                if (Array.isArray(value)) return value.forEach(item => visit(item, auditEvidence));
                if (!value || typeof value !== 'object') return;
                for (const [key, item] of Object.entries(value)) {
                    if ((key === 'path' || key === 'module') && typeof item === 'string') {
                        // Historische Auditbelege fehlen im Schnappschuss ohne internes Archiv.
                        if (!(file === 'docs/design/funktionsinventar.json' && auditEvidence && key === 'path'
                            && item.startsWith('docs/internal/archive/') && !hasInternalDocs)) {
                            checkLink(file, source, { url: item, offset: source.indexOf(JSON.stringify(item)) }, true, true);
                        }
                    } else if (typeof item === 'string') {
                        for (const m of item.matchAll(/Handbuch\.html(?:#[\w-]+)?/g)) checkLink(file, source, { url: m[0], offset: source.indexOf(JSON.stringify(item)) }, true);
                    }
                    visit(item, key === 'auditEvidence');
                }
            }
            visit(data); continue;
        }
        const markdown = file.endsWith('.md'), a = getAnchors(file);
        if (markdown) for (const d of mermaidDiagnostics(source)) {
            emit('error', d.code, file, source, d.offset, d.expected, d.reason);
        }
        for (const duplicate of a.duplicates) emit(file === 'Handbuch.html' && !finished.has(file) ? 'warning' : 'error', 'duplicate-id', file, source, duplicate.offset, duplicate.id, 'HTML-ID mehrfach vergeben');
        for (const link of links(source, markdown)) checkLink(file, source, link);
        if (!finished.has(file)) continue;
        for (const m of readerHexMatches(file, source)) {
            emit('warning', 'reader-hex', file, source, m.index, 'Leserdatum statt Commit-Kennung',
                `${m[0]}: Hex-Kennung gegenlesen; technische Ausnahme nur mit Begründung aufnehmen`);
        }
        for (const heading of a.headings) {
            if (/\b(?:Paket(?:e)?|Slice(?:s)?|Nachtr[aä]g(?:e)?)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{4}\b|\b\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+\d{4}\b/i.test(heading.title)) {
                emit('error', 'heading', file, source, heading.offset, 'Thematische Überschrift', heading.title);
            }
        }
        const clean = withoutCode(source, markdown);
        for (const m of clean.matchAll(/\b(?:Balance-App|Profil-Assets-Manager|Depot-Tranchen-Manager)\b/g)) {
            emit('error', 'page-name', file, source, m.index, 'Balance / Personen & Vermögen', `Alter Seitenname: ${m[0]}`);
        }
        if (file !== 'docs/internal/design/schreibregeln.md') for (const { phrase, regex } of phrases) {
            for (const m of clean.matchAll(regex)) emit('warning', 'phrase', file, source, m.index, phrase, 'Floskel gegenlesen und umschreiben oder einzeln begründen');
        }
        metadata(file, source);
    }
    if (scanAppHelp) {
        const sources = [...appPages];
        function walk(dir) {
            if (!fs.existsSync(path.join(root, dir))) return;
            for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
                const file = `${dir}/${entry.name}`;
                if (entry.isDirectory()) walk(file);
                else if (/\.m?js$/.test(file)) sources.push(file);
            }
        }
        walk('app');
        for (const file of sources) {
            const source = read(file); if (!source) continue;
            for (const m of source.matchAll(/Handbuch\.html(?:#[\w-]+)?/g)) checkLink(file, source, { url: m[0], offset: m.index }, true);
        }
    }
    const handbook = read('Handbuch.html');
    if (handbook !== null) for (const id of handbookAnchors) {
        if (!getAnchors('Handbuch.html').ids.has(id)) emit(finished.has('Handbuch.html') ? 'error' : 'warning', 'handbook-plan', 'Handbuch.html', handbook, 0, id, 'Hauptanker fehlt');
    }
    if (checkImages) {
        const severity = finished.has(imageManifest) ? 'error' : 'warning';
        const manifest = read(imageManifest);
        if (manifest === null) emit(severity, 'image-manifest', imageManifest, '', 0, 'Bildmanifest', 'Bildmanifest fehlt');
        else {
            try {
                const data = JSON.parse(manifest);
                if (!Array.isArray(data.images)) throw new Error('images muss ein Array sein');
                const seen = new Set();
                for (const item of data.images) {
                    if (!item || typeof item.path !== 'string') { checkImage(imageManifest, manifest, 0, item); continue; }
                    if (seen.has(item.path)) emit(severity, 'image-duplicate', imageManifest, manifest, 0, item.path, 'Bild im Manifest mehrfach genannt');
                    seen.add(item.path); checkImage(imageManifest, manifest, 0, item);
                }
                for (const file of imageFiles) if (!seen.has(file)) emit(severity, 'image-manifest', imageManifest, manifest, 0, file, 'Geplantes Bild fehlt im Manifest');
                if (severity === 'error') {
                    let totalBytes = 0;
                    for (const file of seen) {
                        const full = path.resolve(root, file);
                        if (inside(full) && fs.existsSync(full) && fs.statSync(full).isFile()) totalBytes += fs.statSync(full).size;
                    }
                    if (data.imageCount !== data.images.length || data.totalBytes !== totalBytes) emit('error', 'image-total', imageManifest, manifest, 0,
                        `${data.images.length} Bilder, ${totalBytes} Bytes`, 'Bildzahl oder Gesamtgröße stimmt nicht mit den Dateien überein');
                    if (totalBytes > 8000000) emit('error', 'image-budget', imageManifest, manifest, 0, 'Höchstens 8 MB', `${totalBytes} Bytes überschreiten die Obergrenze`);
                    else if (totalBytes > 4000000) emit('warning', 'image-budget', imageManifest, manifest, 0, 'Möglichst etwa 4 MB', `${totalBytes} Bytes; weitere Ausschnitte prüfen`);
                    function checkUnlisted(dir) {
                        if (!fs.existsSync(path.join(root, dir))) return;
                        for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
                            const file = `${dir}/${entry.name}`;
                            if (entry.isDirectory()) checkUnlisted(file);
                            else if (file.endsWith('.png') && !seen.has(file)) emit('error', 'image-manifest', imageManifest, manifest, 0, file, 'PNG im Bildordner fehlt im Manifest');
                        }
                    }
                    checkUnlisted('docs/ui');
                }
                for (const file of files.filter(file => /\.(?:md|html)$/.test(file))) {
                    const source = read(file); if (!source) continue;
                    for (const link of links(source, file.endsWith('.md')).filter(link => link.image && link.url?.includes('.png'))) {
                        const target = path.relative(root, path.resolve(path.dirname(path.join(root, file)), link.url)).split(path.sep).join('/');
                        if (target.startsWith('docs/ui/') && !seen.has(target)) emit(severity, 'image-manifest', file, source, link.offset, target, 'Bild fehlt im Manifest');
                    }
                }
            } catch (error) { emit(severity, 'image-manifest', imageManifest, manifest, 0, 'images mit Bildmetadaten', error.message); }
        }
    }
    const unique = [...new Map(diagnostics.map(d => [JSON.stringify(d), d])).values()];
    unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.code.localeCompare(b.code));
    return { diagnostics: unique, errors: unique.filter(d => d.severity === 'error').length,
        warnings: unique.filter(d => d.severity === 'warning').length,
        checkedFiles: files.filter(file => read(file) !== null).length };
}

export function runCli(options, write = console.log) {
    const result = checkDocs(options);
    for (const d of result.diagnostics) write(`${d.severity === 'error' ? 'FEHLER' : 'WARNUNG'} ${d.file}:${d.line} [${d.code}] Erwartet: ${d.expected} — ${d.reason}`);
    write(`Doku-Prüfung: ${result.checkedFiles} Dateien, ${result.errors} Fehler, ${result.warnings} Warnungen.`);
    return result.errors ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli();
