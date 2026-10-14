import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

// Opt-in for repeated mutation probes in one test process. The complete source
// string and all semantic arguments form the key; changed/missing sources miss.
let sourceValidationCache;
export async function withSourceValidationCache(run) {
    const previous = sourceValidationCache;
    sourceValidationCache = new Map();
    try { return await run(); } finally { sourceValidationCache = previous; }
}
function cachedSourceCheck(operation, source, argumentsKey, check) {
    if (!sourceValidationCache) return check();
    if (!sourceValidationCache.has(operation)) sourceValidationCache.set(operation, new Map());
    const sources = sourceValidationCache.get(operation);
    if (!sources.has(source)) sources.set(source, new Map());
    const results = sources.get(source);
    if (!results.has(argumentsKey)) results.set(argumentsKey, check());
    return results.get(argumentsKey);
}

export const PAGE_PATHS = ['index.html', 'Ausgaben.html', 'Balance.html', 'Simulator.html', 'depot-tranchen-manager.html', 'Handbuch.html', 'Daten-Sicherung.html'];
export const PACKAGE_ORDER = ['1', '2', '6.2', '3.1', '3.2', '3.3', '4.1', '4.2', '4.3', '5', '6.3'];
// Historisches Ausgangsregister des ersten Inventars; unabhängig vom aktuellen Bestand.
export const BASELINE_IDS = Object.freeze([
    'I01', 'I02', 'I03', 'I04', 'I05', 'I06', 'I07', 'I08', 'I09', 'I10', 'I11',
    'B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B09', 'B10', 'B11', 'B12',
    'B13', 'B14', 'B15', 'B16', 'B17', 'B18', 'B19', 'B20', 'B21', 'B22', 'B23', 'B24',
    'B25', 'B26', 'B27', 'B28', 'B29', 'B30', 'B31', 'B32', 'B33', 'B34', 'B35', 'B36',
    'B37', 'B38', 'B39', 'B40', 'B41', 'B42',
    'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10', 'S11', 'S12',
    'S13', 'S14', 'S15', 'S16', 'S17', 'S18', 'S19', 'S20', 'S21', 'S22', 'S23', 'S24',
    'S25', 'S26', 'S27', 'S28', 'S29', 'S30', 'S31', 'S32', 'S33', 'S34', 'S35', 'S36',
    'S37', 'S38', 'S39', 'S40', 'S41', 'S42', 'S43', 'S44', 'S45', 'S46', 'S47', 'S48',
    'S49', 'S50', 'S51', 'S52', 'S53', 'S54', 'S55', 'S56', 'S57', 'S58', 'S59', 'S60',
    'S61', 'S62', 'S63', 'S64', 'S65', 'S66', 'S67', 'S68', 'S69', 'S70', 'S71', 'S72',
    'V01', 'V02', 'V03', 'V04', 'V05', 'V06', 'V07', 'V08', 'V09', 'V10', 'V11', 'V12',
    'V13', 'V14', 'V15', 'V16', 'V17', 'V18', 'V19', 'V20', 'V21', 'V22', 'V23', 'V24',
    'H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08', 'H09', 'H10', 'H11', 'H12',
    'H13',
]);
const root = fileURLToPath(new URL('../', import.meta.url));
const nonempty = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
export function isRepositoryPath(value) {
    return nonempty(value) && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value)
        && value.split('/').every(part => part && part !== '.' && part !== '..') && value !== '.orchestrator' && !value.startsWith('.orchestrator/');
}
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const names = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (names[entity.toLowerCase()]) return names[entity.toLowerCase()];
    const hex = /^&#x/i.test(entity);
    const point = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\uFFFD';
});

/** Elementbaum ohne Kommentar-, Text-, Script- oder Style-Scheinmarkup. */
export function tokenizeHTML(html) {
    const document = { tag: '', attrs: {}, parent: null, children: [] };
    const elements = [];
    const stack = [document];
    const voids = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
    const tags = /<!--(?:[\s\S]*?-->|[\s\S]*$)|<![^>]*>|<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/g;
    let match;
    while ((match = tags.exec(html))) {
        const raw = match[0];
        if (raw.startsWith('<!')) continue;
        const originalTag = /^<\/?([\w-]+)/.exec(raw)[1];
        const tag = originalTag.toLowerCase();
        if (raw.startsWith('</')) {
            const index = stack.findLastIndex(node => node.tag === tag);
            if (index > 0) stack.length = index;
            continue;
        }
        // Häufige implizite Endtags; keine allgemeine Browser-HTML-Reparatur.
        if (['li', 'dt', 'dd', 'option', 'tr', 'td', 'th', 'p'].includes(tag) && stack.at(-1).tag === tag) stack.pop();
        const attrs = {};
        const rest = raw.slice(raw.indexOf(originalTag) + originalTag.length, -1).replace(/\/$/, '');
        const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
        let attr;
        while ((attr = attrPattern.exec(rest))) attrs[attr[1].toLowerCase()] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
        const node = { tag, attrs, parent: stack.at(-1), children: [] };
        node.parent.children.push(node);
        elements.push(node);
        if (['script', 'style', 'textarea', 'title'].includes(tag)) {
            const contentStart = tags.lastIndex;
            const closing = new RegExp(`</${tag}\\s*>`, 'ig');
            closing.lastIndex = tags.lastIndex;
            const end = closing.exec(html);
            node.content = html.slice(contentStart, end ? end.index : html.length);
            tags.lastIndex = end ? closing.lastIndex : html.length;
        } else if (!voids.has(tag) && !raw.endsWith('/>')) stack.push(node);
    }
    return { document, elements };
}

export function parseSelector(selector) {
    if (!nonempty(selector)) throw new Error('leerer Selektor');
    const parts = [];
    let offset = 0;
    let relation = null;
    while (offset < selector.length) {
        const space = /^\s+/.exec(selector.slice(offset));
        if (space) { offset += space[0].length; if (parts.length) relation = ' '; }
        if (selector[offset] === '>') {
            if (!parts.length || parts.at(-1).relation === 'pending') throw new Error(`Selektorsyntax nicht unterstützt: ${selector}`);
            relation = '>'; offset++; offset += /^\s*/.exec(selector.slice(offset))[0].length;
        }
        if (offset >= selector.length) throw new Error(`Selektorsyntax nicht unterstützt: ${selector}`);
        const tests = [];
        const tag = /^(\*|[A-Za-z][\w-]*)/.exec(selector.slice(offset));
        if (tag) { tests.push({ kind: 'tag', value: tag[0].toLowerCase() }); offset += tag[0].length; }
        while (offset < selector.length) {
            const token = /^(?:([#.])([\w-]+)|\[([\w-]+)(?:(\^?=)(?:"([^"]*)"|'([^']*)'|([\w-]+)))?\])/.exec(selector.slice(offset));
            if (!token) break;
            tests.push(token[1] ? { kind: token[1] === '#' ? 'id' : 'class', value: token[2] }
                : { kind: 'attr', name: token[3].toLowerCase(), op: token[4], value: token[5] ?? token[6] ?? token[7] });
            offset += token[0].length;
        }
        if (!tests.length || (parts.length && !relation)) throw new Error(`Selektorsyntax nicht unterstützt: ${selector}`);
        parts.push({ tests, relation }); relation = null;
        if (offset < selector.length && !/[\s>]/.test(selector[offset])) throw new Error(`Selektorsyntax nicht unterstützt: ${selector}`);
    }
    return parts;
}
function simpleMatches(node, tests) {
    return tests.every(test => {
        if (test.kind === 'tag') return test.value === '*' || node.tag === test.value;
        if (test.kind === 'id') return node.attrs.id === test.value;
        if (test.kind === 'class') return (node.attrs.class || '').split(/\s+/).includes(test.value);
        const value = node.attrs[test.name];
        return value !== undefined && (!test.op || (test.op === '=' ? value === test.value : value.startsWith(test.value)));
    });
}
export function matchesSelector(tree, selector) {
    const parts = parseSelector(selector);
    const visit = (node, index) => {
        if (!node || !simpleMatches(node, parts[index].tests)) return false;
        if (index === 0) return true;
        if (parts[index].relation === '>') return visit(node.parent, index - 1);
        for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) if (visit(ancestor, index - 1)) return true;
        return false;
    };
    return tree.elements.some(node => visit(node, parts.length - 1));
}

/** Begrenzter JS-Leser ohne Ausführung. Templates behalten rekursive Ausdruckstoken. */
export function tokenizeJS(source) {
    let i = 0;
    const error = message => { throw new SyntaxError(`${message} bei Zeichen ${i}`); };
    const read = (interpolation = false) => {
        const tokens = [];
        const stack = [];
        const push = (kind, start, extra = {}) => {
            const raw = source.slice(start, i);
            tokens.push({ kind, value: raw, raw, start, end: i,
                lineBreakBefore: /[\r\n]/.test(source.slice(tokens.at(-1)?.end ?? start, start)), ...extra });
        };
        const expressionStart = () => {
            const previous = tokens.at(-1);
            if (!previous) return true;
            if (previous.closesControl || previous.closesBlock) return true;
            return previous.kind === 'word'
                ? ['return', 'throw', 'case', 'delete', 'void', 'typeof', 'yield', 'await', 'in', 'of', 'else', 'do'].includes(previous.value)
                : previous.kind === 'punct' && /^(?:[({[=,:;!?&|+*/%<>~-])$/.test(previous.value);
        };
        while (i < source.length) {
            if (/\s/.test(source[i])) { i++; continue; }
            if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
            if (source.startsWith('/*', i)) {
                const end = source.indexOf('*/', i + 2);
                if (end < 0) error('Unbeendeter Kommentar');
                i = end + 2; continue;
            }
            if (interpolation && source[i] === '}' && !stack.length) { i++; return tokens; }
            const start = i;
            const quote = source[i];
            if (quote === '"' || quote === "'") {
                i++;
                while (i < source.length && source[i] !== quote) {
                    if (source[i] === '\\') i += 2;
                    else { if (/\r|\n/.test(source[i])) error('Zeilenumbruch im String'); i++; }
                }
                if (source[i] !== quote) error('Unbeendeter String');
                i++;
                push('string', start, { value: source.slice(start + 1, i - 1) });
                continue;
            }
            if (quote === '`') {
                i++;
                const expressions = [];
                const chunks = [];
                let chunkStart = i;
                while (i < source.length && source[i] !== '`') {
                    if (source[i] === '\\') { i += 2; continue; }
                    if (source.startsWith('${', i)) {
                        chunks.push(source.slice(chunkStart, i));
                        i += 2;
                        expressions.push(read(true));
                        chunkStart = i;
                    } else i++;
                }
                if (source[i] !== '`') error('Unbeendetes Template');
                chunks.push(source.slice(chunkStart, i));
                i++;
                push('template', start, { value: source.slice(start + 1, i - 1), chunks, expressions });
                continue;
            }
            if (quote === '/' && expressionStart()) {
                i++;
                let characterClass = false;
                while (i < source.length) {
                    if (/\r|\n/.test(source[i])) error('Zeilenumbruch im RegExp-Literal');
                    if (source[i] === '\\') { i += 2; continue; }
                    if (source[i] === '[') characterClass = true;
                    if (source[i] === ']') characterClass = false;
                    if (source[i] === '/' && !characterClass) break;
                    i++;
                }
                if (source[i] !== '/') error('Unbeendetes RegExp-Literal');
                i++;
                while (/[a-z]/i.test(source[i] || '') && i < source.length) i++;
                push('regexp', start);
                continue;
            }
            const identifier = /^[\w$]+/.exec(source.slice(i));
            if (identifier) { i += identifier[0].length; push('word', start); continue; }
            if (source.startsWith('++', i) || source.startsWith('--', i)) { i += 2; push('punct', start); continue; }
            i++;
            const previous = tokens.at(-1);
            if ('([{'.includes(quote)) {
                const control = quote === '(' && ['if', 'while', 'for', 'switch', 'catch', 'with'].includes(previous?.value);
                const block = quote === '{' && (!previous || previous.value === ')' || previous.value === '>'
                    || ['else', 'try', 'finally', 'do', ';', '}'].includes(previous.value)
                    || (previous.kind === 'word' && tokens.at(-2)?.value === 'class'));
                stack.push({ quote, control, block });
                push('punct', start);
            } else if (')]}'.includes(quote)) {
                const opening = stack.pop();
                if (!opening || '([{'.indexOf(opening.quote) !== ')]}'.indexOf(quote)) error('Unbalancierte Klammer');
                push('punct', start, { closesControl: opening.control, closesBlock: opening.block });
            } else push('punct', start);
        }
        if (interpolation || stack.length) error('Unbeendeter Ausdruck');
        return tokens;
    };
    return read();
}
export function registeredBrowserCases(source) {
    const tokens = tokenizeJS(source);
    const names = new Set();
    for (let i = 0; i < tokens.length - 4; i++) {
        if (!['const', 'let', 'var'].includes(tokens[i].value) || tokens[i + 1].value !== 'smokes'
            || tokens[i + 2].value !== '=' || tokens[i + 3].value !== '[') continue;
        let depth = 1;
        for (let j = i + 4; j < tokens.length && depth; j++) {
            const token = tokens[j];
            if (token.value === '[' && depth === 1 && tokens[j + 1]?.kind === 'string' && tokens[j + 2]?.value === ','
                && tokens[j + 3]?.kind === 'word' && tokens[j + 4]?.value === ']') names.add(tokens[j + 1].value);
            if (token.kind === 'punct' && token.value === '[') depth++;
            if (token.kind === 'punct' && token.value === ']') depth--;
        }
    }
    return names;
}

const punct = (token, value) => token?.kind === 'punct' && token.value === value;
function matchingEnd(tokens, start) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    for (let i = start; i < tokens.length; i++) {
        if (tokens[i].kind !== 'punct') continue;
        const value = tokens[i].value;
        if (pairs[value]) stack.push(pairs[value]);
        else if ([')', ']', '}'].includes(value) && stack.pop() !== value) throw new Error('Unbalancierte Tokengrenze');
        if (!stack.length) return i;
    }
    throw new Error('Unbeendete Tokengrenze');
}
function expressionEnd(tokens, start, delimiters = [';', ',', ')', ']', '}']) {
    let i = start;
    for (; i < tokens.length; i++) {
        if (tokens[i].kind !== 'punct') continue;
        if (delimiters.includes(tokens[i].value)) break;
        if (['(', '[', '{'].includes(tokens[i].value)) i = matchingEnd(tokens, i);
    }
    return i;
}

/** Alle unterstützten Rümpfe; Namenskollisionen werden vom Ortsprüfer abgewiesen. */
function functionRegions(tokens) {
    const regions = [];
    const bodies = new Set();
    const add = (name, start, body, end, block = true, parameters = []) => {
        if (block) bodies.add(body);
        regions.push({
            name, start: tokens[start].start, end: tokens[end].end,
            tokens: tokens.slice(body + (block ? 1 : 0), end + (block ? 0 : 1)), block,
            parameters: parameters.filter(token => token.kind === 'word').map(token => token.value)
        });
    };
    const assignedName = index => punct(tokens[index], '=') && tokens[index - 1]?.kind === 'word'
        && ['const', 'let', 'var'].includes(tokens[index - 2]?.value) ? tokens[index - 1].value : null;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        for (const expression of token.expressions || []) regions.push(...functionRegions(expression));
        if (token.kind !== 'word' && !punct(token, '=')) continue;
        if (token.value === 'function' && token.kind === 'word') {
            let parameter = i + 1;
            if (punct(tokens[parameter], '*')) parameter++;
            const declared = tokens[parameter]?.kind === 'word' ? tokens[parameter++].value : null;
            if (!punct(tokens[parameter], '(')) throw new Error('Funktionssyntax nicht unterstützt');
            const body = matchingEnd(tokens, parameter) + 1;
            if (!punct(tokens[body], '{')) throw new Error('Funktionsrumpf fehlt');
            let assignment = i - 1;
            if (tokens[assignment]?.value === 'async') assignment--;
            const assigned = assignedName(assignment);
            add(assigned || declared, assigned ? assignment - 1 : i, body, matchingEnd(tokens, body), true, tokens.slice(parameter + 1, body - 1));
        } else if (punct(token, '=') && punct(tokens[i + 1], '>')) {
            let parameter = i - 1;
            if (punct(tokens[parameter], ')')) {
                let depth = 1;
                while (--parameter >= 0) {
                    if (punct(tokens[parameter], ')')) depth++;
                    if (punct(tokens[parameter], '(') && !--depth) break;
                }
                if (parameter < 0) throw new Error('Pfeilparameter nicht unterstützt');
            }
            let assignment = parameter - 1;
            if (tokens[assignment]?.value === 'async') assignment--;
            const name = assignedName(assignment);
            const body = i + 2;
            const block = punct(tokens[body], '{');
            const end = block ? matchingEnd(tokens, body) : expressionEnd(tokens, body) - 1;
            if (end < body) throw new Error('Pfeilrumpf fehlt');
            add(name, name ? assignment - 1 : parameter, body, end, block, tokens.slice(parameter, i));
        } else if (token.kind === 'word' && punct(tokens[i + 1], '(')
            && !['if', 'for', 'while', 'switch', 'catch', 'with', 'function'].includes(token.value)) {
            const body = matchingEnd(tokens, i + 1) + 1;
            // Ein Aufruf hat keinen nachfolgenden Methodenrumpf. Schlüsselwort-Präfixe
            // (async/static/get/set) ändern den einzelnen Methodennamen nicht.
            if (punct(tokens[body], '{') && !punct(tokens[i - 1], '.') && tokens[i - 1]?.value !== 'function') {
                const previous = tokens[i - 1];
                if (previous && !(previous.kind === 'punct' && ['{', '}', ',', ';'].includes(previous.value))
                    && !['async', 'static', 'get', 'set', '*'].includes(previous.value)) continue;
                add(token.value, i, body, matchingEnd(tokens, body), true, tokens.slice(i + 2, body - 1));
            }
        }
    }
    // Nicht unterstützte (z. B. berechnete) Methoden dürfen an der
    // Moduloberfläche nicht versehentlich als normale Blöcke durchschlüpfen.
    for (let i = 0; i < tokens.length; i++) {
        if (punct(tokens[i], '(')) {
            const close = matchingEnd(tokens, i);
            if (punct(tokens[close + 1], '{') && !bodies.has(close + 1)
                && !['if', 'for', 'while', 'switch', 'catch', 'with'].includes(tokens[i - 1]?.value)) {
                throw new Error('Nicht unterstützte Methoden-/Funktionsform');
            }
        }
    }
    return regions;
}

/** producer: {kind, module, name? / block?}; Inline-Indizes beginnen bei 1. */
export function locateProducer(producer, source) {
    if (!producer || !isRepositoryPath(producer.module)) throw new Error('Ungültiger Erzeugerpfad');
    let code = source;
    if (producer.kind === 'inline-module') {
        if (!Number.isInteger(producer.block) || producer.block < 1) throw new Error('Inline-Blocknummer ab 1 erforderlich');
        const blocks = [];
        // Der HTML-Leser überspringt Kommentare und den Inhalt klassischer Skripte.
        for (const node of tokenizeHTML(source).elements) {
            if (node.tag === 'script' && node.attrs.type === 'module' && !Object.hasOwn(node.attrs, 'src')) blocks.push(node);
        }
        const node = blocks[producer.block - 1];
        if (!node) throw new Error('Inline-Modulblock fehlt');
        code = node.content;
    } else if (!['function', 'module-top-level'].includes(producer.kind)) throw new Error('Unbekannte Erzeugerortart');
    const tokens = tokenizeJS(code);
    const regions = functionRegions(tokens);
    if (producer.kind === 'function') {
        if (!/^[A-Za-z_$][\w$]*$/.test(producer.name || '')) throw new Error('Einzelner Funktionsname erforderlich');
        const found = regions.filter(region => region.name === producer.name);
        if (found.length !== 1) throw new Error(found.length ? `Mehrdeutiger Funktionsname: ${producer.name}` : `Funktionsrumpf fehlt: ${producer.name}`);
        if (!found[0].block) throw new Error('Benannter Ausdruckspfeil nicht unterstützt');
        return found[0].tokens;
    }
    if (producer.kind === 'inline-module') return tokens;
    // Ganze Funktionswerte entfernen, damit weder ihre Templates noch Parameter
    // oder verschachtelte Ausdruckspfeile als Moduloberfläche zählen.
    const surface = list => list.filter(token => !regions.some(region => token.start >= region.start && token.end <= region.end))
        .map(token => token.expressions ? { ...token, expressions: token.expressions.map(surface) } : token);
    return surface(tokens);
}

/** Definitionen und echte lokale Importbindungen, ohne Ausführung oder Wortsuche. */
export function functionBindings(source, module, origin = 'module') {
    return new Set(cachedSourceCheck('bindings', source, JSON.stringify([module, origin]),
        () => collectFunctionBindings(source, module, origin)));
}
function collectFunctionBindings(source, module, origin = 'module') {
    let blocks = [source];
    if (module.endsWith('.html')) {
        if (!['inline-module', 'inline-classic'].includes(origin)) throw new Error('HTML-Funktionsherkunft erforderlich');
        blocks = tokenizeHTML(source).elements.filter(node => node.tag === 'script'
            && !Object.hasOwn(node.attrs, 'src') && (origin === 'inline-module' ? node.attrs.type === 'module'
                : !node.attrs.type || ['text/javascript', 'application/javascript'].includes(node.attrs.type.toLowerCase())))
            .map(node => node.content);
    } else if (origin !== 'module') throw new Error('Funktionsherkunft passt nicht zum Modul');
    const names = new Set();
    for (const code of blocks) {
        const tokens = tokenizeJS(code);
        for (const region of functionRegions(tokens)) if (region.name) names.add(region.name);
        // Auch der interne Name eines zugewiesenen benannten Funktionswerts ist eine Definition.
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].kind !== 'word') continue;
            if (tokens[i].value === 'function') {
                const next = i + (punct(tokens[i + 1], '*') ? 2 : 1);
                if (tokens[next]?.kind === 'word' && punct(tokens[next + 1], '(')) names.add(tokens[next].value);
            }
            // Eigenschaften mit unmittelbar zugewiesenem Funktionswert (z. B. window.run).
            if (['=', ':'].includes(tokens[i + 1]?.value)) {
                let value = i + 2;
                if (tokens[value]?.value === 'async') value++;
                let arrow = value;
                if (punct(tokens[value], '(')) arrow = matchingEnd(tokens, value) + 1;
                else if (tokens[value]?.kind === 'word') arrow++;
                if (tokens[value]?.value === 'function' || (punct(tokens[arrow], '=') && punct(tokens[arrow + 1], '>'))) names.add(tokens[i].value);
            }
            if (tokens[i].value !== 'import' || ['(', '.'].includes(tokens[i + 1]?.value)) continue;
            let end = i + 1;
            while (end < tokens.length && tokens[end].value !== 'from' && !punct(tokens[end], ';')) end++;
            if (tokens[end]?.value !== 'from' || tokens[end + 1]?.kind !== 'string') continue;
            const clause = tokens.slice(i + 1, end);
            if (clause[0]?.kind === 'word') names.add(clause[0].value);
            for (let j = 0; j < clause.length; j++) {
                if (clause[j].value === 'as' && clause[j + 1]?.kind === 'word') names.add(clause[++j].value);
                else if (clause[j].kind === 'word' && ['{', ','].includes(clause[j - 1]?.value)
                    && clause[j + 1]?.value !== 'as') names.add(clause[j].value);
            }
        }
    }
    return names;
}

/** Alle Feldtreffer müssen unter ihrem Host liegen; dynamische Belege folgen expliziten Hostketten. */
export function validateDelegation(ref, page, tree, id) {
    const errors = [];
    const known = page.entries.flatMap(entry => entry.selectors.static);
    const dynamic = page.entries.flatMap(entry => entry.selectors.dynamic);
    for (const field of ref.delegates || []) {
        const at = `${id} | ${page.path} | Delegation | Feld ${field} | Host ${ref.ancestor}`;
        const fail = reason => errors.push(`${at} | ${reason}`);
        if (field === ref.ancestor) { fail('Host ist kein Ereignisfeld'); continue; }
        try {
            const nodes = tree.elements.filter(node => matchesSelector({ elements: [node] }, field));
            for (const node of nodes) {
                let within = false;
                for (let parent = node.parent; parent; parent = parent.parent) {
                    if (matchesSelector({ elements: [parent] }, ref.ancestor)) { within = true; break; }
                }
                if (!within) fail('Feldtreffer liegt außerhalb des Delegationshosts');
            }
            const records = dynamic.filter(record => record.selector === field);
            if (!known.includes(field) && !records.length) { fail('Feldbeleg fehlt auf dieser Seite'); continue; }
            if (known.includes(field) && !nodes.length && !records.length) fail('Statisches Ereignisfeld fehlt');
            const follows = (record, seen) => {
                if (!record.host || seen.has(record.selector)) return false;
                if (record.host === ref.ancestor) return true;
                const next = dynamic.filter(other => other.selector === record.host);
                return next.length > 0 && next.every(other => follows(other, new Set([...seen, record.selector])));
            };
            for (const record of records) if (!follows(record, new Set())) fail('Dynamischer Feldbeleg hat keine passende Hostkette');
        } catch (error) { fail(error.message); }
    }
    return { ok: !errors.length, errors };
}

function literalValue(token) {
    return token.value.replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|(\r\n|[\s\S]))/gi, (_, point, unicode, hex, char) => {
        if (point || unicode || hex) {
            const value = parseInt(point || unicode || hex, 16);
            if (value > 0x10ffff) throw new Error('Ungültiger Unicode-Escape');
            return String.fromCodePoint(value);
        }
        return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '', '\r': '', '\r\n': '' })[char] ?? char;
    });
}
function validAnchor(anchor) {
    if (!anchor || !['id', 'class', 'data'].includes(anchor.kind)) return false;
    const presence = anchor.kind === 'data' && !Object.hasOwn(anchor, 'value');
    if (!presence && (typeof anchor.value !== 'string' || (anchor.kind !== 'data' && !nonempty(anchor.value))
        || /[\r\n\0]/.test(anchor.value) || [...anchor.value].length > 80)) return false;
    return !(anchor.kind === 'class' && /\s/.test(anchor.value))
        && !(anchor.kind === 'data' && !/^data-[a-z][a-z0-9-]*$/.test(anchor.attribute || ''));
}
const anchorMatches = (attrs, anchor) => anchor.kind === 'class'
    ? (attrs.class || '').split(/\s+/).includes(anchor.value)
    : anchor.kind === 'data' && !Object.hasOwn(anchor, 'value')
        ? Object.hasOwn(attrs, anchor.attribute)
        : attrs[anchor.kind === 'id' ? 'id' : anchor.attribute] === anchor.value;

/** Enge Ausgabestellen und DOM-Schreibstellen; kein allgemeiner Datenflussbeweis. */
export function hasAnchorCreation(tokens, record) {
    const { anchor, selector } = record;
    parseSelector(selector);
    const nodeMatches = node => anchorMatches(node.attrs, anchor) && matchesSelector({ elements: [node] }, selector);
    const markupMatches = value => tokenizeHTML(value).elements.some(nodeMatches);
    const resolve = (expression, variables) => {
        if (expression.length !== 1) return null;
        const token = expression[0];
        if (token.kind === 'string') return { value: literalValue(token), nested: [] };
        if (token.kind === 'word') return variables.get(token.value) ?? null;
        if (token.kind !== 'template') return null;
        let value = literalValue({ value: token.chunks[0] });
        const nested = [];
        for (let i = 0; i < token.expressions.length; i++) {
            const resolved = resolve(token.expressions[i], variables);
            value += resolved?.value ?? '\0';
            value += literalValue({ value: token.chunks[i + 1] });
            nested.push({ tokens: token.expressions[i], variables: new Map(variables) });
            if (resolved) nested.push(...resolved.nested);
        }
        return { value, nested };
    };
    const assignment = (list, i) => punct(list[i], '=') && !punct(list[i + 1], '=') && !punct(list[i + 1], '>');
    const walk = (list, inherited = new Map(), allowMarkup = true) => {
        let variables = new Map(inherited);
        let receivers = new Map();
        const elements = [];
        const scopes = [];
        const receiver = name => {
            if (!receivers.has(name)) {
                const node = { tag: '', attrs: {}, parent: null, children: [] };
                receivers.set(name, node); elements.push(node);
            }
            return receivers.get(name);
        };
        const receiverName = index => {
            if (list[index]?.kind !== 'word') return null;
            let start = index;
            while (punct(list[start - 1], '.') && list[start - 2]?.kind === 'word') start -= 2;
            return list.slice(start, index + 1).map(token => token.value).join('');
        };
        const write = (name, attr, expression, visible) => {
            if (!name || !expression.length) return;
            receiver(name).attrs[attr] = resolve(expression, visible)?.value ?? '\0';
        };
        const regions = functionRegions(list);
        for (let i = 0; i < list.length; i++) {
            const token = list[i];
            const value = token.value;
            if (punct(token, '{')) {
                scopes.push({ variables, receivers });
                variables = new Map(variables);
                // Jeder Block erhält eigene Fakten; Geschwisterzweige dürfen keine
                // Attribute zu einem scheinbar vollständigen Element zusammenführen.
                const copies = new Map();
                const copyNode = node => {
                    if (!node) return null;
                    if (!copies.has(node)) {
                        const copy = { tag: node.tag, attrs: { ...node.attrs }, parent: null, children: [] };
                        copies.set(node, copy); elements.push(copy);
                        copy.parent = copyNode(node.parent);
                    }
                    return copies.get(node);
                };
                receivers = new Map([...receivers].map(([name, node]) => [name, copyNode(node)]));
                const region = regions.find(region => region.tokens[0]?.start === list[i + 1]?.start);
                for (const parameter of region?.parameters || []) {
                    variables.delete(parameter);
                    for (const name of receivers.keys()) if (name === parameter || name.startsWith(parameter + '.')) receivers.delete(name);
                }
            }
            if (punct(token, '}')) {
                const outer = scopes.pop();
                variables = outer?.variables || new Map(inherited);
                receivers = outer?.receivers || new Map();
            }
            // Parameter dürfen lokale Markupvariablen nicht als Scheinbeleg erben.
            const visible = new Map(variables);
            for (const region of regions) if (token.start >= region.start && token.end <= region.end) {
                for (const parameter of region.parameters) visible.delete(parameter);
            }
            for (const expression of token.expressions || []) if (walk(expression, visible, false)) return true;
            if (['const', 'let', 'var'].includes(value) && list[i + 1]?.kind === 'word') receivers.delete(list[i + 1].value);
            if (token.kind === 'word' && assignment(list, i + 1)) {
                const end = expressionEnd(list, i + 2);
                const resolved = resolve(list.slice(i + 2, end), visible);
                // Keine Zuweisung an eine Eigenschaft als lokale Markupvariable lesen.
                if (!punct(list[i - 1], '.')) {
                    // Eine neue Bindung ist ein neuer Empfänger; Aliase werden nicht aufgelöst.
                    receivers.delete(value);
                    const rhs = list.slice(i + 2, end);
                    const create = rhs.findIndex(t => t.kind === 'word' && t.value === 'createElement');
                    if (create >= 0 && rhs.slice(0, create).every((t, index) => index % 2 ? punct(t, '.') : t.kind === 'word')
                        && punct(rhs[create - 1], '.') && punct(rhs[create + 1], '(')
                        && rhs.length === create + 4
                        && rhs[create + 2]?.kind === 'string' && punct(rhs[create + 3], ')')) {
                        receivers.delete(value);
                        receiver(value).tag = literalValue(rhs[create + 2]).toLowerCase();
                    }
                    if (resolved === null) variables.delete(value); else variables.set(value, resolved);
                }
            }
            if (token.kind === 'word' && !punct(list[i - 1], '.') && punct(list[i + 1], '+') && assignment(list, i + 2)) {
                const appended = resolve(list.slice(i + 3, expressionEnd(list, i + 3)), visible);
                const previous = visible.get(value);
                if (appended === null || previous === undefined) variables.delete(value);
                else variables.set(value, { value: previous.value + appended.value, nested: [...previous.nested, ...appended.nested] });
            }
            let output = null;
            if (token.kind === 'word' && value === 'return' && !list[i + 1]?.lineBreakBefore) output = list.slice(i + 1, expressionEnd(list, i + 1));
            if (punct(token, '=') && punct(list[i + 1], '>') && !punct(list[i + 2], '{')) output = list.slice(i + 2, expressionEnd(list, i + 2));
            if (token.kind === 'word' && value === 'innerHTML' && punct(list[i - 1], '.') && assignment(list, i + 1)) output = list.slice(i + 2, expressionEnd(list, i + 2));
            if (token.kind === 'word' && value === 'insertAdjacentHTML' && punct(list[i - 1], '.') && punct(list[i + 1], '(')) {
                const comma = expressionEnd(list, i + 2, [',', ')']);
                if (punct(list[comma], ',')) output = list.slice(comma + 1, expressionEnd(list, comma + 1, [',', ')']));
            }
            if (allowMarkup && output) {
                const resolved = resolve(output, visible);
                if (resolved !== null) {
                    if (markupMatches(resolved.value)) return true;
                    const insertsInside = value === 'insertAdjacentHTML' && ['afterbegin', 'beforeend'].includes(
                        resolve(list.slice(i + 2, expressionEnd(list, i + 2, [',', ')'])), visible)?.value);
                    if (value === 'innerHTML' || insertsInside) {
                        const parentName = receiverName(i - 2);
                        if (parentName) {
                            const tree = tokenizeHTML(resolved.value);
                            const parent = receiver(parentName);
                            for (const child of tree.document.children) { child.parent = parent; parent.children.push(child); }
                            elements.push(...tree.elements);
                        }
                    }
                    for (const nested of resolved.nested) if (walk(nested.tokens, nested.variables)) return true;
                }
            }
            if (!punct(token, '.') || list[i + 1]?.kind !== 'word') continue;
            const name = receiverName(i - 1);
            if (!name) continue;
            const property = list[i + 1].value;
            const attributes = { id: 'id', className: 'class', title: 'title', ariaLabel: 'aria-label',
                tabIndex: 'tabindex', role: 'role', type: 'type' };
            if (attributes[property] && assignment(list, i + 2)) {
                write(name, attributes[property], list.slice(i + 3, expressionEnd(list, i + 3)), visible);
            }
            if (property === 'dataset' && punct(list[i + 2], '.') && list[i + 3]?.kind === 'word' && assignment(list, i + 4)) {
                const attr = 'data-' + list[i + 3].value.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
                write(name, attr, list.slice(i + 5, expressionEnd(list, i + 5)), visible);
            }
            if (property === 'classList' && punct(list[i + 2], '.') && list[i + 3]?.value === 'add' && punct(list[i + 4], '(')) {
                const end = matchingEnd(list, i + 4);
                let start = i + 5;
                while (start < end) {
                    const next = expressionEnd(list, start, [',', ')']);
                    const resolved = resolve(list.slice(start, next), visible);
                    if (resolved) receiver(name).attrs.class = [receiver(name).attrs.class, resolved.value].filter(Boolean).join(' ');
                    start = next + 1;
                }
            }
            if (property === 'setAttribute') {
                let open = i + 2;
                if (punct(list[open], '?') && punct(list[open + 1], '.')) open += 2;
                if (!punct(list[open], '(')) continue;
                const comma = expressionEnd(list, open + 1, [',', ')']);
                if (!punct(list[comma], ',')) continue;
                const attr = resolve(list.slice(open + 1, comma), visible);
                if (attr) write(name, attr.value.toLowerCase(), list.slice(comma + 1, expressionEnd(list, comma + 1, [',', ')'])), visible);
            }
            // Nur einfache lokale Empfänger und Argumente, keine Datenflussbehauptung.
            if (['appendChild', 'append', 'replaceChildren'].includes(property) && punct(list[i + 2], '(')) {
                const end = matchingEnd(list, i + 2);
                let start = i + 3;
                while (start < end) {
                    const next = expressionEnd(list, start, [',', ')']);
                    const argument = list.slice(start, next);
                    if (argument.length === 1 && argument[0].kind === 'word') {
                        const child = receiver(argument[0].value), parent = receiver(name);
                        // Zyklische Graphen sind kein unterstützter DOM-Nachweis.
                        let ancestor = parent;
                        while (ancestor && ancestor !== child) ancestor = ancestor.parent;
                        if (!ancestor) { child.parent = parent; parent.children.push(child); }
                    }
                    start = next + 1;
                }
            }
        }
        return elements.some(nodeMatches);
    };
    return walk(tokens);
}

export const DYNAMIC_STATUSES = ['geschützt', 'ungeschützt (Anker fehlt)', 'ungeschützt (Erzeugungsform vom Prüfer nicht unterstützt)'];

/** Lexikalisches Vorkommen ist nur für ausdrücklich ungeschützte Formen ausreichend. */
function mentionsAnchor(tokens, anchor) {
    if (anchor.kind === 'data' && !Object.hasOwn(anchor, 'value')) {
        const property = anchor.attribute.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        if (tokens.some((token, i) => token.value === 'dataset' && punct(tokens[i + 1], '.') && tokens[i + 2]?.value === property)) return true;
    }
    for (const token of tokens) {
        const values = token.kind === 'string' ? [literalValue(token)]
            : token.kind === 'template' ? [token.chunks.map(value => literalValue({ value })).join('\0')] : [];
        for (const value of values) {
            if (tokenizeHTML(value).elements.some(node => anchorMatches(node.attrs, anchor))) return true;
            if (anchor.kind === 'class' ? value.split(/\s+/).includes(anchor.value)
                : anchor.kind === 'data' && !Object.hasOwn(anchor, 'value') ? value === anchor.attribute : value === anchor.value) return true;
        }
        if ((token.expressions || []).some(expression => mentionsAnchor(expression, anchor))) return true;
    }
    return false;
}
export function validateAnchorEvidence(record, files, { id, page }) {
    const source = files instanceof Map ? files.get(record.producer?.module) : files?.[record.producer?.module];
    return cachedSourceCheck('anchor', source, JSON.stringify([record, id, page]),
        () => checkAnchorEvidence(record, files, { id, page }));
}
function checkAnchorEvidence(record, files, { id, page }) {
    const { producer, anchor } = record;
    const status = record.status;
    const where = `${id} | ${page} | ${record.selector || JSON.stringify(anchor)} | ${JSON.stringify(producer)}`;
    try {
        if (!DYNAMIC_STATUSES.includes(status)) throw new Error('Unbekannter Schutzstatus');
        if (status !== 'geschützt' && !nonempty(record.reason)) throw new Error('Begründung des ungeschützten Belegs fehlt');
        if (status === DYNAMIC_STATUSES[1]) {
            if (anchor !== undefined) throw new Error('Fehlender Anker darf keinen Ersatzanker enthalten');
        } else if (!validAnchor(anchor)) throw new Error('Ungültiger stabiler Anker');
        if (!producer || !isRepositoryPath(producer.module)) throw new Error('Ungültiger Erzeugerpfad');
        if ((producer.kind === 'inline-module') !== producer.module.endsWith('.html')) throw new Error('Erzeugerart passt nicht zum Dateityp');
        const source = files instanceof Map ? files.get(producer.module) : Object.hasOwn(files, producer.module) ? files[producer.module] : undefined;
        if (typeof source !== 'string') throw new Error(`Datei fehlt: ${producer.module}`);
        const tokens = locateProducer(producer, source);
        if (status === 'geschützt' && !hasAnchorCreation(tokens, record)) throw new Error('Anker-Erzeugung fehlt oder Form nicht unterstützt');
        if (status === DYNAMIC_STATUSES[2] && !mentionsAnchor(tokens, anchor)) throw new Error('Lexikalischer Anker am Erzeugerort fehlt');
        return { ok: true, errors: [] };
    } catch (error) { return { ok: false, errors: [`${where} | ${error.message}`] }; }
}

/** Explizite, typgeprüfte lokale Definitionen; keine externe Datenquelle. */
export function resolveInventory(inventory) {
    const definitions = inventory.definitions ?? {};
    if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) throw new Error('definitions | Definitionsobjekt erforderlich');
    const cache = new Map();
    const active = new Set();
    const reference = name => {
        if (!Object.hasOwn(definitions, name)) throw new Error(`definitions | Referenz fehlt: ${name}`);
        if (active.has(name)) throw new Error(`definitions | Zyklus: ${name}`);
        if (cache.has(name)) return structuredClone(cache.get(name));
        active.add(name);
        const value = resolve(definitions[name]);
        if (value === null || !['string', 'object'].includes(typeof value)) throw new Error(`definitions | Unerlaubter Typ: ${name}`);
        active.delete(name); cache.set(name, value);
        return structuredClone(value);
    };
    const resolve = value => {
        if (typeof value === 'string' && value.startsWith('@@')) return value.slice(1);
        if (typeof value === 'string' && value.startsWith('@')) return reference(value.slice(1));
        if (Array.isArray(value)) return value.map(resolve);
        if (value === null || typeof value !== 'object') return value;
        if (Object.hasOwn(value, 'join')) {
            if (Object.keys(value).length !== 1 || !Array.isArray(value.join) || !value.join.length) throw new Error('join | Textteile erforderlich');
            const parts = value.join.map(resolve);
            if (parts.some(part => typeof part !== 'string')) throw new Error('join | Nur Textreferenzen erlaubt');
            return parts.join('');
        }
        if (Object.hasOwn(value, 'columns') || Object.hasOwn(value, 'rows')) {
            if (Object.keys(value).length !== 2) throw new Error('Tabelle | Nur columns und rows erlaubt');
            const columns = resolve(value.columns), rows = resolve(value.rows);
            if (!Array.isArray(columns) || !columns.length || columns.some(column => !nonempty(column))
                || new Set(columns).size !== columns.length || !Array.isArray(rows)) throw new Error('Tabelle | Ungültige Spalten oder Zeilen');
            return rows.map(row => {
                if (!Array.isArray(row) || row.length !== columns.length) throw new Error('Tabelle | Zeilenbreite weicht ab');
                return Object.fromEntries(columns.flatMap((column, index) => row[index] === null ? [] : [[column, row[index]]]));
            });
        }
        const own = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'ref').map(([key, item]) => [key, resolve(item)]));
        if (!Object.hasOwn(value, 'ref')) return own;
        if (!nonempty(value.ref)) throw new Error('ref | Referenzname erforderlich');
        const base = reference(value.ref);
        if (!base || typeof base !== 'object' || Array.isArray(base)) throw new Error('ref | Ergänzungen verlangen eine Objektdefinition');
        return { ...base, ...own };
    };
    // Auch unbenutzte Definitionen müssen gültig und azyklisch sein.
    for (const name of Object.keys(definitions)) reference(name);
    const result = resolve(Object.fromEntries(Object.entries(inventory).filter(([key]) => key !== 'definitions')));
    for (const page of result.pages || []) for (const entry of (page.entries || []).flatMap(entry => [entry, ...(Array.isArray(entry.additionalOccurrences) ? entry.additionalOccurrences : [])])) {
        const audit = entry.auditEvidence;
        if (audit && !Array.isArray(audit) && Object.hasOwn(audit, 'records')) {
            if (!Array.isArray(audit.codeRefs) || !Array.isArray(audit.records) || Object.keys(audit).length !== 2) throw new Error(`${entry.id} | Ungültige Auditgruppe`);
            entry.auditEvidence = [...audit.codeRefs.map(codeRef => ({ codeRef })), ...audit.records];
        }
        if (Array.isArray(entry.auditEvidence)) entry.auditEvidence = entry.auditEvidence.map(record => {
            if (Object.hasOwn(record, 'codeRef')) {
                if (Object.keys(record).length !== 1 || !Number.isInteger(record.codeRef) || record.codeRef < 0 || !entry.codeRefs?.[record.codeRef]) throw new Error(`${entry.id} | Codebezug fehlt`);
                const ref = entry.codeRefs[record.codeRef];
                return { path: ref.path, location: ref.function, observation: ref.reason };
            }
            if (!Object.hasOwn(record, 'checkRef')) return record;
            if (!Number.isInteger(record.checkRef) || record.checkRef < 0 || !entry.checks?.[record.checkRef]) throw new Error(`${entry.id} | Prüfbezug fehlt`);
            const { checkRef, ...own } = record;
            return { ...own, observation: entry.checks[checkRef].expected };
        });
        for (const gap of entry.coverage?.gaps || []) if (gap.reason && typeof gap.reason === 'object') {
            const reason = gap.reason;
            if (reason.targetRef !== 'location' || Object.keys(reason).length !== 2 || !nonempty(entry.target?.location)) throw new Error(`${entry.id} | Zielbezug fehlt`);
            if (reason.change === 'verlagern/neu gestalten') gap.reason = `${entry.target.location} wird verlagert oder neu gestaltet; Nachweis des berührten Verhaltens fehlt.`;
            else if (reason.change === 'Anker vor Umbau ergänzen') gap.reason = `Umbau von ${entry.target.location}: zuerst data-* ergänzen, Beleg und Bediennachweis aktualisieren.`;
            else throw new Error(`${entry.id} | Unbekannter Änderungsgrund`);
        }
    }
    return result;
}
export function protectionCounts(inventory) {
    const resolved = occurrencePages(resolveInventory(inventory));
    const counts = Object.fromEntries(DYNAMIC_STATUSES.map(status => [status, 0]));
    for (const page of resolved.pages) for (const entry of page.entries) for (const record of entry.selectors.dynamic) {
        if (!DYNAMIC_STATUSES.includes(record.status)) throw new Error(`${entry.id} | ${page.path} | ${record.selector} | Unbekannter Schutzstatus`);
        counts[record.status]++;
    }
    return counts;
}

const occurrenceMarker = Symbol('additional-occurrence');
/** Virtuelle Seitenansichten für dieselben Schutzprüfungen, kein zweites Register. */
export function occurrencePages(inventory) {
    const pages = inventory.pages.map(page => ({ ...page, entries: [...page.entries] }));
    for (const page of inventory.pages) for (const entry of page.entries) {
        if (entry.additionalOccurrences === undefined) continue;
        if (!Array.isArray(entry.additionalOccurrences) || !entry.additionalOccurrences.length) throw new Error(`${entry.id} | Zusätzliche Orte verlangen eine nichtleere Liste`);
        const seen = new Set([page.path]);
        for (const place of entry.additionalOccurrences) {
            if (!place || place.canonicalId !== entry.id || !PAGE_PATHS.includes(place.page) || seen.has(place.page)) throw new Error(`${entry.id} | Unbekannter, doppelter oder falsch zugeordneter zusätzlicher Ort`);
            seen.add(place.page);
            const required = ['section', 'selectors', 'codeRefs', 'initialStates', 'checks', 'coverage', 'auditEvidence'];
            if (required.some(field => place[field] === undefined)
                || Object.keys(place).some(field => !['canonicalId', 'page', ...required].includes(field))) throw new Error(`${entry.id} | Unvollständiger oder unerlaubter zusätzlicher Ort`);
            const virtual = { ...entry, ...place, additionalOccurrences: undefined, [occurrenceMarker]: true };
            pages.find(target => target.path === place.page).entries.push(virtual);
        }
    }
    return { ...inventory, pages };
}

// Inklusive UTF-8-Bytegrenzen; Änderungen verlangen eine ausdrückliche Vertragsentscheidung.
// Nutzer-/Operatorentscheidung vom 06.10.2026 im Arbeitsplan: Quelle 1.500.000 B, Markdown 225.000 B.
export const INVENTORY_SIZE_LIMITS = Object.freeze({ source: 1500000, markdown: 225000, entry: 20000 });
const contractCommand = 'node tests/funktionsinventar-contract.mjs --check';
export const GENERATE_INVENTORY_COMMAND = 'node scripts/generate-funktionsinventar.mjs';
const bytes = value => Buffer.byteLength(value, 'utf8');

/** Dateigrößen und Eintragsgrößen sind getrennte Gates: Referenzen verkleinern nur die Quelle. */
export function checkInventorySizes(json, markdown) {
    const errors = [];
    const sourceBytes = bytes(json), markdownBytes = bytes(markdown);
    if (sourceBytes > INVENTORY_SIZE_LIMITS.source) errors.push(`docs/design/funktionsinventar.json | Ist: ${sourceBytes} B; Grenze: ${INVENTORY_SIZE_LIMITS.source} B. Quelle pflegen; Neu-Erzeugung allein behebt die Übergröße nicht. Prüfen: ${contractCommand}.`);
    if (markdownBytes > INVENTORY_SIZE_LIMITS.markdown) errors.push(`docs/design/funktionsinventar.md | Ist: ${markdownBytes} B; Grenze: ${INVENTORY_SIZE_LIMITS.markdown} B. Umfang der Lesefassung in Quelle/Generator pflegen und mit ${GENERATE_INVENTORY_COMMAND} neu erzeugen. Prüfen: ${GENERATE_INVENTORY_COMMAND} --check.`);
    return { ok: !errors.length, errors };
}

export const INVENTORY_LINE_LIMIT = 2000;
const narrativeFields = new Set(['reason', 'condition', 'observation', 'expected', 'proposal', 'evidence',
    'scope', 'effect', 'statement', 'boundary', 'actual', 'opening', 'focus', 'steps', 'preconditions']);

/** Quellformat separat vom Resolver prüfen; dessen allgemeine Schema-2-Syntax bleibt testbar. */
export function checkInventoryReadability(json) {
    const errors = [];
    const fail = (at, message) => errors.push(`docs/design/funktionsinventar.json | ${at} | ${message} Prüfen: ${contractCommand}.`);
    json.split('\n').forEach((line, index) => {
        const length = [...line.replace(/\r$/, '')].length;
        if (length > INVENTORY_LINE_LIMIT) fail(`Zeile ${index + 1}`, `Ist: ${length} Unicode-Zeichen; Grenze: ${INVENTORY_LINE_LIMIT}. Auf Feld-/Arraygrenzen umbrechen.`);
    });
    let inventory;
    try { inventory = JSON.parse(json); }
    catch (error) { return { ok: false, errors: [...errors, error.message] }; }
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
        fail('Inventar', 'Objekt erforderlich.');
        return { ok: false, errors };
    }
    const definitions = inventory.definitions ?? {};
    if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions)) {
        fail('definitions', 'Nur Textdefinitionen in einem Objekt erlaubt.');
        return { ok: false, errors };
    }
    const names = new Set(), uses = new Map();
    for (const [name, value] of Object.entries(definitions)) {
        if (!/^[a-z][a-zA-Z]+(?:\.[a-zA-Z][a-zA-Z]+)+$/.test(name) || names.has(name.toLowerCase())) {
            fail(`definitions.${name}`, 'Unterscheidbarer sprechender Name mit Inhaltsbereich erforderlich; keine Nummernkürzel oder bloßen Groß-/Kleinschreibungsvarianten.');
        }
        names.add(name.toLowerCase()); uses.set(name, 0);
        if (typeof value !== 'string' || [...(value.startsWith('@@') ? value.slice(1) : value)].length < 80
            || (value.startsWith('@') && !value.startsWith('@@'))) {
            fail(`definitions.${name}`, 'Nur wörtliche Langtexte ab 80 Unicode-Zeichen erlaubt; keine Objekte, Arrays, Kurzwerte oder Referenzketten.');
        }
    }
    const visit = (value, field, at) => {
        if (typeof value === 'string' && value.startsWith('@') && !value.startsWith('@@')) {
            const name = value.slice(1);
            if (!narrativeFields.has(field)) fail(at, 'Kritisches Feld muss unmittelbar ausgeschrieben sein; Textreferenz unzulässig.');
            if (!uses.has(name)) fail(at, `Referenz fehlt: ${name}.`);
            else uses.set(name, uses.get(name) + 1);
        } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, field, `${at}[${index}]`));
        else if (value && typeof value === 'object') {
            if (Object.hasOwn(value, 'ref') || Object.hasOwn(value, 'columns') || Object.hasOwn(value, 'rows')) {
                fail(at, 'Objekt-/Array-Kurzdefinitionen und Tabellen durch unmittelbar benannte Felder ersetzen.');
            }
            if (Object.hasOwn(value, 'join')) {
                if (!narrativeFields.has(field)) fail(at, 'Kritisches Feld muss unmittelbar ausgeschrieben sein; join unzulässig.');
                // Textteile behalten den Feldkontext; der Resolver prüft ihre Typen.
                visit(value.join, field, at + '.join');
            } else for (const [key, item] of Object.entries(value)) visit(item, key, at + '.' + key);
        }
    };
    for (const [key, value] of Object.entries(inventory)) if (key !== 'definitions') visit(value, key, key);
    for (const [name, count] of uses) if (count < 2) fail(`definitions.${name}`, `Langtext muss tatsächlich wiederholt sein; Verwendungen: ${count}.`);

    // Lexikalische Positionen statt Zeilensuche nach Text: auch umsortierte oder
    // maskierte JSON-Schlüssel und mehrfach gleiche Texte werden sicher erfasst.
    let depth = 0, inDefinitions = false, line = 1, offset = 0;
    const definitionLines = new Set();
    for (const token of json.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]]/g)) {
        line += (json.slice(offset, token.index).match(/\n/g) || []).length;
        offset = token.index + token[0].length;
        const raw = token[0];
        if (raw[0] === '"') {
            const isKey = /^\s*:/.test(json.slice(offset));
            if (depth === 1 && isKey && JSON.parse(raw) === 'definitions') inDefinitions = true;
            else if (inDefinitions && depth === 2 && isKey) {
                if (definitionLines.has(line)) fail(`Zeile ${line}`, 'Jede Definition braucht eine eigene Zeile.');
                definitionLines.add(line);
                const lineStart = json.lastIndexOf('\n', token.index - 1) + 1;
                if (!/^\s*$/.test(json.slice(lineStart, token.index))
                    || !/^[ \t]*:[ \t]*"(?:\\[^\r\n]|[^"\\\r\n])*"[ \t]*,?[ \t]*(?:\r?\n|$)/.test(json.slice(offset))) {
                    fail(`definitions.${JSON.parse(raw)}`, 'Definition mit Namen und Langtext auf einer eigenen Zeile angeben.');
                }
            }
        } else if (raw === '{' || raw === '[') depth++;
        else { depth--; if (inDefinitions && depth === 1) inDefinitions = false; }
    }
    return { ok: !errors.length, errors };
}
function resolvedEntrySizeErrors(inventory) {
    const errors = [];
    for (const page of Array.isArray(inventory.pages) ? inventory.pages : []) for (const entry of Array.isArray(page?.entries) ? page.entries : []) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const size = bytes(JSON.stringify(entry));
        if (size > INVENTORY_SIZE_LIMITS.entry) errors.push(`${entry.id} | ${page.path} | Aufgelöster Eintrag | Ist: ${size} B; Grenze: ${INVENTORY_SIZE_LIMITS.entry} B. Eintrag in docs/design/funktionsinventar.json pflegen; Referenzverdichtung oder Neu-Erzeugung allein behebt die Übergröße nicht. Prüfen: ${contractCommand}.`);
    }
    return errors;
}
export function checkInventoryEntrySizes(inventory) {
    try {
        const errors = resolvedEntrySizeErrors(resolveInventory(inventory));
        return { ok: !errors.length, errors };
    } catch (error) { return { ok: false, errors: [error.message] }; }
}

export function validateInventory(inventory, { reviewed = false } = {}) {
    const errors = [];
    const fail = (where, message) => errors.push(`${where} | ${message}`);
    const text = (value, where) => { if (!nonempty(value)) fail(where, 'nichtleerer Text erforderlich'); };
    const list = (value, where, allowEmpty = false) => { if (!Array.isArray(value) || (!allowEmpty && !value.length)) { fail(where, 'Liste erforderlich'); return []; } return value; };
    const records = (value, where, allowEmpty = false) => list(value, where, allowEmpty).filter((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { fail(`${where}[${index}]`, 'Objekt erforderlich'); return false; }
        return true;
    });
    const texts = (value, where, allowEmpty = false) => list(value, where, allowEmpty).forEach((item, i) => text(item, `${where}[${i}]`));
    const choice = (value, allowed, where) => { if (!allowed.includes(value)) fail(where, `Wert muss einer von ${allowed.join(', ')} sein`); };
    const refPath = (value, where) => { if (!isRepositoryPath(value)) fail(where, 'ungültiger Repositorypfad'); };
    if (!inventory || typeof inventory !== 'object') return { ok: false, errors: ['Inventar | Objekt erforderlich'] };
    const forbidden = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
            if (key === 'sourceSnippet') fail('Inventar', 'sourceSnippet ist rekursiv verboten');
            forbidden(item);
        }
    };
    forbidden(inventory);
    try { inventory = resolveInventory(inventory); } catch (error) { return { ok: false, errors: [...errors, error.message] }; }
    errors.push(...resolvedEntrySizeErrors(inventory));
    const canonicalIds = new Set();
    for (const page of inventory.pages || []) for (const entry of page.entries || []) {
        if (canonicalIds.has(entry.id)) fail(entry.id, 'ungültige oder doppelte Kennung');
        canonicalIds.add(entry.id);
    }
    try { inventory = occurrencePages(inventory); } catch (error) { return { ok: false, errors: [...errors, error.message] }; }
    if (inventory.schemaVersion !== 2) fail('schemaVersion', 'Version 2 erforderlich');
    if (!/^[\da-f]{40}$/.test(inventory.sourceRevision || '')) fail('sourceRevision', 'Commitkennung erforderlich');
    choice(inventory.auditStatus, reviewed ? ['in Prüfung', 'geprüft'] : ['geprüft'], 'auditStatus');
    if (JSON.stringify(inventory.packageOrder) !== JSON.stringify(PACKAGE_ORDER)) fail('packageOrder', 'Fahrplanreihenfolge weicht ab');
    const pages = records(inventory.pages, 'pages');
    if (pages.length !== PAGE_PATHS.length || new Set(pages.map(page => page.path)).size !== PAGE_PATHS.length || PAGE_PATHS.some(p => !pages.some(page => page.path === p))) fail('pages', 'genau die sechs Einstiegspunkte erforderlich');
    const ids = new Set();
    for (const page of pages) {
        const where = page.path;
        choice(page.auditStatus, reviewed ? ['offen', 'geprüft'] : ['geprüft'], where + '.auditStatus');
        const entries = records(page.entries, where + '.entries', page.auditStatus === 'offen');
        if (page.auditStatus === 'offen' && entries.length) fail(where, 'offene Seite darf keine Einträge enthalten');
        for (const field of ['keyboard', 'print', 'messages', 'dialogs', 'manualAnchors']) {
            const extra = page[field];
            if (!extra || typeof extra !== 'object') { fail(where + '.' + field, 'Seitenergänzung erforderlich'); continue; }
            text(extra.statement, where + '.' + field + '.statement');
            texts(extra.entryIds, where + '.' + field + '.entryIds', true);
            for (const id of Array.isArray(extra.entryIds) ? extra.entryIds : []) if (!entries.some(entry => entry.id === id)) fail(where + '.' + field, `unbekannte Kennung: ${id}`);
        }
        if (page.manualAnchors?.external !== undefined) for (const anchor of records(page.manualAnchors.external, where + '.manualAnchors.external', true)) {
            refPath(anchor.source, where + '.manualAnchors.external.source');
            if (typeof anchor.hash !== 'string' || (anchor.hash && !/^#[\w-]+$/.test(anchor.hash))) fail(where, 'ungültiger Handbuchhash');
            text(anchor.entryId, where + '.manualAnchors.external.entryId');
            choice(anchor.tab, ['manual', 'quickstart', 'start'], where + '.manualAnchors.external.tab');
            text(anchor.focus, where + '.manualAnchors.external.focus');
            text(anchor.opening, where + '.manualAnchors.external.opening');
        }
        for (const entry of entries) {
            const at = `${entry.id} | ${where}`;
            if (!/^[IBSVHDE]\d{2,}(?:\.\d+)?$/.test(entry.id || '') || (ids.has(entry.id) && !entry[occurrenceMarker])) fail(at + '.id', 'ungültige oder doppelte Kennung');
            ids.add(entry.id);
            const prefix = { 'index.html': 'I', 'Balance.html': 'B', 'Simulator.html': 'S', 'depot-tranchen-manager.html': 'V', 'Handbuch.html': 'H', 'Daten-Sicherung.html': 'D', 'Ausgaben.html': 'E' }[where];
            const transferred = (where === 'Ausgaben.html' && ['B25', 'B26', 'B27', 'B28', 'B43', 'B44', 'B50'].includes(entry.id))
                || (where === 'depot-tranchen-manager.html' && ['B29', 'B30'].includes(entry.id));
            if (!entry[occurrenceMarker] && !transferred && (typeof entry.id !== 'string' || !entry.id.startsWith(prefix))) fail(at + '.id', 'Kennungspräfix passt nicht zur Seite');
            if (entry.page !== where) fail(at + '.page', 'Seitenzuordnung weicht ab');
            if (entry.auditStatus !== 'geprüft') fail(at + '.auditStatus', 'jeder vorhandene Eintrag muss geprüft sein');
            for (const field of ['section', 'label']) text(entry[field], at + '.' + field);
            if (!entry.selectors) fail(at + '.selectors', 'Pflichtfeld fehlt');
            const statics = list(entry.selectors?.static, at + '.selectors.static', true);
            const dynamics = records(entry.selectors?.dynamic, at + '.selectors.dynamic', true);
            if (!statics.length && !dynamics.length) text(entry.selectors?.noneReason, at + '.selectors.noneReason');
            for (const selector of statics) { try { parseSelector(selector); } catch (error) { fail(at, error.message); } }
            if (new Set(statics).size !== statics.length) fail(at, 'doppelte statische Selektoren');
            for (const dynamic of dynamics) {
                text(dynamic.selector, at + '.selectors.dynamic.selector');
                try { parseSelector(dynamic.selector); } catch (error) { fail(at, error.message); }
                choice(dynamic.status, DYNAMIC_STATUSES, at + '.selectors.dynamic.status');
                const producer = dynamic.producer;
                if (!producer || typeof producer !== 'object') fail(at, 'Erzeugerort fehlt');
                else {
                    refPath(producer.module, at + '.producer.module');
                    choice(producer.kind, ['function', 'inline-module', 'module-top-level'], at + '.producer.kind');
                    const allowed = producer.kind === 'function' ? ['kind', 'module', 'name'] : producer.kind === 'inline-module' ? ['kind', 'module', 'block'] : ['kind', 'module'];
                    if (Object.keys(producer).some(key => !allowed.includes(key))) fail(at, 'Unzulässiges Erzeugerfeld');
                    if (producer.kind === 'function' && !/^[A-Za-z_$][\w$]*$/.test(producer.name || '')) fail(at, 'Einzelner Funktionsname erforderlich');
                    if (producer.kind === 'inline-module' && (!Number.isInteger(producer.block) || producer.block < 1)) fail(at, 'Inline-Blocknummer ab 1 erforderlich');
                    if ((producer.kind === 'inline-module') !== producer.module?.endsWith('.html')) fail(at, 'Erzeugerart passt nicht zum Dateityp');
                }
                if (dynamic.status !== 'geschützt') text(dynamic.reason, at + '.dynamic.reason');
                if (dynamic.status === DYNAMIC_STATUSES[1]) {
                    if (dynamic.anchor !== undefined) fail(at, 'Fehlender Anker darf keinen Ersatzanker enthalten');
                    if (!entry.coverage?.gaps?.some(gap => gap.kind === 'Änderungsrisiko' && gap.selector === dynamic.selector)) fail(at, `Ankerlücke ohne Änderungsrisiko: ${dynamic.selector}`);
                } else {
                    const anchor = dynamic.anchor;
                    if (!validAnchor(anchor)) fail(at, 'Ungültiger stabiler Anker');
                }
                if (dynamic.host && !page.entries.some(other => other.selectors?.static?.includes(dynamic.host)
                    || other.selectors?.dynamic?.some(candidate => candidate !== dynamic && candidate.selector === dynamic.host))) fail(at, 'Dynamischer Host fehlt im Inventar');
            }
            const refs = records(entry.codeRefs, at + '.codeRefs');
            for (const ref of refs) {
                refPath(ref.path, at + '.codeRefs.path'); text(ref.function, at + '.codeRefs.function');
                choice(ref.binding, ['direct', 'delegated', 'cached', 'inline', 'native', 'none'], at + '.codeRefs.binding');
                texts(ref.events, at + '.codeRefs.events', true);
                text(ref.reason, at + '.codeRefs.reason');
                texts(ref.functions, at + '.codeRefs.functions', true);
                if (Array.isArray(ref.functions)) {
                    if (new Set(ref.functions).size !== ref.functions.length) fail(at, 'Doppelte Funktionsnamen');
                    for (const name of ref.functions) if (!/^[A-Za-z_$][\w$]*$/.test(name)) fail(at, `Einzelner Funktionsname erforderlich: ${name}`);
                    if (!ref.functions.length) {
                        choice(ref.nonFunction?.kind, ['structure', 'style', 'native', 'anonymous-event'], at + '.codeRefs.nonFunction.kind');
                        text(ref.nonFunction?.reason, at + '.codeRefs.nonFunction.reason');
                    } else {
                        if (ref.nonFunction !== undefined) fail(at, 'Benannte Funktionen dürfen keine Nicht-Funktionsausnahme tragen');
                        if (ref.path?.endsWith('.html')) {
                            choice(ref.functionOrigin, ['inline-module', 'inline-classic'], at + '.codeRefs.functionOrigin');
                            if (ref.path !== where) fail(at, 'HTML-Funktionsbezug muss dieselbe Seite nennen');
                        }
                        else if (ref.functionOrigin !== undefined && ref.functionOrigin !== 'module') fail(at, 'Funktionsherkunft passt nicht zum Modul');
                    }
                }
                if (ref.binding === 'delegated') {
                    text(ref.ancestor, at + '.codeRefs.ancestor');
                    if (!statics.includes(ref.ancestor) && !dynamics.some(dynamic => dynamic.selector === ref.ancestor)) fail(at, 'Delegationsvorfahr fehlt in inventarisierten Selektoren');
                    texts(ref.delegates, at + '.codeRefs.delegates');
                    if (Array.isArray(ref.delegates)) {
                        if (new Set(ref.delegates).size !== ref.delegates.length) fail(at, 'Doppelte Delegationsfelder');
                        for (const field of ref.delegates) {
                            if (field === ref.ancestor) fail(at, `Delegation: Host ist kein Ereignisfeld: ${field}`);
                            if (!page.entries.some(other => other.selectors?.static?.includes(field)
                                || other.selectors?.dynamic?.some(record => record.selector === field))) fail(at, `Delegation: Feldbeleg fehlt: ${field} | Host ${ref.ancestor}`);
                        }
                    }
                }
                if (ref.binding === 'cached') {
                    for (const field of ['cacheField', 'host', 'initModule']) text(ref[field], at + '.codeRefs.' + field);
                    refPath(ref.initModule, at + '.codeRefs.initModule');
                    if (!statics.includes(ref.host)) fail(at, 'Cachehost fehlt in statischen Selektoren');
                }
            }
            const states = records(entry.initialStates, at + '.initialStates');
            for (const state of states) {
                texts(state.selectors, at + '.initialStates.selectors');
                for (const selector of Array.isArray(state.selectors) ? state.selectors : []) if (![...statics, ...dynamics.map(d => d.selector)].includes(selector)) fail(at, `Zustandsselektor nicht inventarisiert: ${selector}`);
                if (new Set(state.selectors).size !== state.selectors?.length) fail(at, 'Doppelte Zustandsselektoren');
                choice(state.kind, ['sichtbar', 'bedingt sichtbar', 'bewusst gesperrt', 'technisch verborgen'], at + '.initialStates.kind');
                text(state.condition, at + '.initialStates.condition'); text(state.reason, at + '.initialStates.reason');
            }
            for (const selector of [...statics, ...dynamics.map(d => d.selector)]) if (!states.some(state => state.selectors?.includes(selector))) fail(at, `Ausgangszustand fehlt: ${selector}`);
            for (const check of records(entry.checks, at + '.checks')) {
                text(check.name, at + '.checks.name'); texts(check.preconditions, at + '.checks.preconditions'); texts(check.steps, at + '.checks.steps'); text(check.expected, at + '.checks.expected');
            }
            for (const storage of records(entry.storage, at + '.storage')) {
                choice(storage.kind, ['persistent', 'nur Sitzung', 'keine'], at + '.storage.kind');
                text(storage.scope, at + '.storage.scope'); text(storage.effect, at + '.storage.effect');
                texts(storage.keys, at + '.storage.keys', storage.kind !== 'persistent');
                if (storage.kind === 'persistent') {
                    refPath(storage.writer?.path, at + '.storage.writer.path'); text(storage.writer?.function, at + '.storage.writer.function');
                }
            }
            if (!entry.coverage) fail(at + '.coverage', 'Pflichtfeld fehlt');
            const nodeTests = records(entry.coverage?.node, at + '.coverage.node', true);
            for (const test of nodeTests) { refPath(test.path, at + '.coverage.node.path'); text(test.evidence, at + '.coverage.node.evidence'); text(test.scope, at + '.coverage.node.scope'); }
            const browser = records(entry.coverage?.browser, at + '.coverage.browser', true);
            for (const test of browser) { text(test.name, at + '.coverage.browser.name'); text(test.scope, at + '.coverage.browser.scope'); }
            for (const gap of records(entry.coverage?.gaps, at + '.coverage.gaps', true)) {
                choice(gap.kind, ['Änderungsrisiko', 'Testschuld'], at + '.coverage.gaps.kind');
                choice(gap.package, PACKAGE_ORDER, at + '.coverage.gaps.package');
                const targetPackages = [entry.target?.firstPackage, ...(Array.isArray(entry.target?.laterPackages) ? entry.target.laterPackages : [])];
                if (!targetPackages.includes(gap.package)) fail(at + '.coverage.gaps.package', `Lückenpaket ${gap.package} gehört nicht zu den Zielpaketen: ${targetPackages.join(', ')}`);
                text(gap.evidence, at + '.coverage.gaps.evidence'); text(gap.reason, at + '.coverage.gaps.reason');
                if (gap.selector !== undefined && !dynamics.some(dynamic => dynamic.selector === gap.selector)) fail(at, 'Lückenbezug auf unbekannten dynamischen Selektor');
            }
            if (!nodeTests.length && !browser.length && !entry.coverage?.gaps?.length) fail(at, 'fehlender Nachweis verlangt Lücke');
            if (!entry.target) fail(at + '.target', 'Pflichtfeld fehlt');
            choice(entry.target?.firstPackage, PACKAGE_ORDER, at + '.target.firstPackage');
            text(entry.target?.location, at + '.target.location');
            texts(entry.target?.laterPackages, at + '.target.laterPackages', true);
            for (const pkg of Array.isArray(entry.target?.laterPackages) ? entry.target.laterPackages : []) if (!PACKAGE_ORDER.includes(pkg) || PACKAGE_ORDER.indexOf(pkg) <= PACKAGE_ORDER.indexOf(entry.target.firstPackage)) fail(at, `ungültiger späterer Paketbezug: ${pkg}`);
            if (entry.target?.laterPackages && (new Set(entry.target.laterPackages).size !== entry.target.laterPackages.length || entry.target.laterPackages.some((pkg, index, all) => index > 0 && PACKAGE_ORDER.indexOf(all[index - 1]) >= PACKAGE_ORDER.indexOf(pkg)))) fail(at, 'Spätere Pakete müssen eindeutig und geordnet sein');
            if (typeof entry.target?.missingInTarget !== 'boolean') fail(at + '.target.missingInTarget', 'Boolean erforderlich');
            text(entry.target?.proposal, at + '.target.proposal');
            for (const evidence of records(entry.auditEvidence, at + '.auditEvidence')) { refPath(evidence.path, at + '.auditEvidence.path'); text(evidence.location, at + '.auditEvidence.location'); text(evidence.observation, at + '.auditEvidence.observation'); }
        }
    }
    const baseline = records(inventory.baselineAudit, 'baselineAudit');
    const baselineIds = new Set();
    for (const item of baseline) {
        if (baselineIds.has(item.id)) fail('baselineAudit.' + item.id, 'doppelte historische Kennung');
        if (!BASELINE_IDS.includes(item.id)) fail('baselineAudit.' + item.id, 'unbekannte historische Kennung');
        baselineIds.add(item.id);
    }
    for (const id of BASELINE_IDS) if (!baselineIds.has(id)) fail('baselineAudit.' + id, 'historische Kennung fehlt');
    for (const item of baseline) {
        choice(item.status, reviewed ? ['offen', 'übernommen', 'korrigiert', 'aufgeteilt', 'entfallen'] : ['übernommen', 'korrigiert', 'aufgeteilt', 'entfallen'], 'baselineAudit.' + item.id);
        text(item.reason, 'baselineAudit.' + item.id + '.reason');
        texts(item.entryIds, 'baselineAudit.' + item.id + '.entryIds', ['offen', 'entfallen'].includes(item.status));
        if (['offen', 'entfallen'].includes(item.status) && item.entryIds?.length) fail(item.id, 'offener/entfallener Abgleich darf keine aktuellen Einträge zuordnen');
        for (const id of Array.isArray(item.entryIds) ? item.entryIds : []) if (!ids.has(id)) fail(item.id, `unbekannte aktuelle Kennung: ${id}`);
        if (ids.has(item.id) && item.status === 'offen') fail(item.id, 'vorhandene Kennung darf nicht offen bleiben');
        const baselinePage = pages.find(page => page.path === PAGE_PATHS[['I', 'B', 'S', 'V', 'H'].indexOf(item.id?.[0])]);
        if (baselinePage?.auditStatus === 'geprüft' && item.status === 'offen') fail(item.id, 'geprüfte Seite verlangt abgeschlossenen Ausgangsabgleich');
        if (baselinePage?.auditStatus === 'offen' && item.status !== 'offen') fail(item.id, 'offene Seite verlangt offenen Ausgangsabgleich');
    }
    const findingIds = new Set();
    for (const finding of records(inventory.findings, 'findings', true)) {
        // Befundkennungen: F- gefolgt von mindestens zwei Ziffern (auch F-100 zulässig).
        if (typeof finding.id !== 'string' || !/^F-\d{2,}$/.test(finding.id)) fail('findings.id', 'ungültige Befundkennung; F- mit mindestens zwei Ziffern erforderlich');
        if (findingIds.has(finding.id)) fail(finding.id, 'doppelte Befundkennung');
        if (ids.has(finding.id)) fail(finding.id, 'Befundkennung kollidiert mit Eintragskennung');
        findingIds.add(finding.id);
        for (const field of ['id', 'actual', 'boundary']) text(finding[field], 'findings.' + field);
        texts(finding.entryIds, 'findings.entryIds');
        for (const id of Array.isArray(finding.entryIds) ? finding.entryIds : []) if (!ids.has(id)) fail(finding.id, `unbekannte Kennung: ${id}`);
        refPath(finding.source?.path, 'findings.source.path'); text(finding.source?.location, 'findings.source.location');
    }
    return { ok: !errors.length, errors };
}

/** Dateiinhalte werden injiziert; Originale bleiben unverändert. */
export function validateSources(inventory, files, options = {}) {
    const result = validateInventory(inventory, options);
    if (!result.ok) return result;
    inventory = occurrencePages(resolveInventory(inventory));
    const errors = [];
    const requireInternalAudit = options.requireInternalAudit ?? fs.existsSync(path.join(root, 'docs/internal'));
    const get = (file, at) => {
        if (!isRepositoryPath(file)) { errors.push(`${at} | ungültiger Pfad: ${file}`); return null; }
        const content = files instanceof Map ? files.get(file) : Object.hasOwn(files, file) ? files[file] : undefined;
        if (typeof content !== 'string') { errors.push(`${at} | Datei fehlt: ${file}`); return null; }
        return content;
    };
    const browserSource = get('tests/browser-smoke.test.mjs', 'Browserregistrierung');
    const browserCases = registeredBrowserCases(browserSource || '');
    const bindings = new Map();
    for (const page of inventory.pages) {
        if (page.auditStatus === 'offen') continue;
        const html = get(page.path, page.path);
        const tree = tokenizeHTML(html || '');
        for (const entry of page.entries) {
            const at = `${entry.id} | ${page.path}`;
            for (const selector of entry.selectors.static) {
                try { if (!matchesSelector(tree, selector)) errors.push(`${at} | statischer Selektor fehlt: ${selector}`); }
                catch (error) { errors.push(`${at} | ${error.message}`); }
            }
            for (const dynamic of entry.selectors.dynamic) {
                errors.push(...validateAnchorEvidence(dynamic, files, { id: entry.id, page: page.path }).errors);
            }
            for (const ref of [...entry.codeRefs, ...entry.storage.filter(s => s.writer).map(s => s.writer)]) get(ref.path, at);
            for (const ref of entry.auditEvidence) {
                if (requireInternalAudit || !ref.path.startsWith('docs/internal/archive/')) get(ref.path, at);
            }
            for (const ref of entry.codeRefs.filter(ref => ref.initModule)) get(ref.initModule, at);
            for (const ref of entry.codeRefs) {
                if (ref.binding === 'delegated') errors.push(...validateDelegation(ref, page, tree, entry.id).errors);
                const source = get(ref.path, at);
                if (source === null || !/\.(?:m?js|html)$/.test(ref.path)) continue;
                const origins = ref.path.endsWith('.html') ? ref.functions.length ? [ref.functionOrigin]
                    : ['inline-module', 'inline-classic'] : ['module'];
                try {
                    const names = new Set();
                    for (const origin of origins) {
                        const key = ref.path + '|' + origin;
                        if (!bindings.has(key)) bindings.set(key, functionBindings(source, ref.path, origin));
                        for (const name of bindings.get(key)) names.add(name);
                    }
                    for (const name of ref.functions) if (!names.has(name)) errors.push(`${at} | Funktion fehlt: ${ref.path} | ${name} | ${origins.join(', ')}`);
                    const described = new Set(ref.function.match(/[A-Za-z_$][\w$]*/g) || []);
                    const describedNames = new Set(names);
                    if (ref.path.endsWith('.html')) for (const origin of ['inline-module', 'inline-classic']) {
                        const key = ref.path + '|' + origin;
                        if (!bindings.has(key)) bindings.set(key, functionBindings(source, ref.path, origin));
                        for (const name of bindings.get(key)) describedNames.add(name);
                    }
                    for (const name of describedNames) if (described.has(name) && !ref.functions.includes(name)) {
                        errors.push(`${at} | Benannte Funktion nicht zugeordnet: ${ref.path} | ${name}`);
                    }
                } catch (error) { errors.push(`${at} | Funktionsnachweis: ${ref.path} | ${ref.functions.join(', ')} | ${error.message}`); }
            }
            for (const test of entry.coverage.node) {
                const source = get(test.path, at);
                if (source !== null && !source.includes(test.evidence)) errors.push(`${at} | Testbeleg fehlt: ${test.path} | ${test.evidence}`);
            }
            for (const test of entry.coverage.browser) if (!browserCases.has(test.name)) errors.push(`${at} | Browserfall nicht registriert: ${test.name}`);
        }
        for (const anchor of page.manualAnchors.external || []) {
            const at = `Handbuchanker | ${anchor.source} | ${anchor.hash}`;
            const source = get(anchor.source, at);
            const entry = page.entries.find(entry => entry.id === anchor.entryId);
            if (!entry || (anchor.hash && !entry.selectors.static.includes(anchor.hash))) errors.push(`${at} | Zielkennung fehlt`);
            if (source !== null && !source.includes('Handbuch.html' + anchor.hash)) errors.push(`${at} | externer Linkbeleg fehlt`);
            if (!['manual', 'quickstart', 'start'].includes(anchor.tab)) errors.push(`${at} | Tabzuordnung fehlt`);
            if (!nonempty(anchor.focus)) errors.push(`${at} | Fokusbeschreibung fehlt`);
        }
    }
    for (const finding of inventory.findings) get(finding.source.path, finding.id);
    return { ok: !errors.length, errors };
}
export function checkMarkdown(inventory, markdown, render) {
    const expected = render(inventory);
    if (markdown === expected) return { ok: true, errors: [] };
    const actual = typeof markdown === 'string' ? `${bytes(markdown)} B` : 'Datei fehlt';
    return { ok: false, errors: [`docs/design/funktionsinventar.md | Lesefassung ist veraltet; Ist: ${actual}; erwartet: ${bytes(expected)} B; Grenze: ${INVENTORY_SIZE_LIMITS.markdown} B. Neu erzeugen: ${GENERATE_INVENTORY_COMMAND}.`] };
}
export function readRepositorySources(inventory, repositoryRoot = root) {
    inventory = occurrencePages(resolveInventory(inventory));
    const paths = new Set(['tests/browser-smoke.test.mjs']);
    for (const page of inventory.pages) {
        paths.add(page.path);
        for (const anchor of page.manualAnchors.external || []) paths.add(anchor.source);
        for (const entry of page.entries) {
            for (const ref of [...entry.codeRefs, ...entry.auditEvidence, ...entry.coverage.node, ...entry.storage.filter(s => s.writer).map(s => s.writer)]) paths.add(ref.path);
            for (const ref of entry.codeRefs.filter(ref => ref.initModule)) paths.add(ref.initModule);
            for (const dynamic of entry.selectors.dynamic) paths.add(dynamic.producer.module);
        }
    }
    for (const finding of inventory.findings) paths.add(finding.source.path);
    const files = new Map();
    const realRoot = fs.realpathSync(repositoryRoot);
    for (const file of paths) {
        if (!isRepositoryPath(file)) continue;
        const absolute = path.resolve(repositoryRoot, file);
        if (!fs.existsSync(absolute)) continue;
        const real = fs.realpathSync(absolute);
        if (!real.startsWith(realRoot + path.sep)) throw new Error(`Pfad außerhalb des Repositorys: ${file}`);
        files.set(file, fs.readFileSync(real, 'utf8'));
    }
    return files;
}

/** Unabhängige synthetische Daten; keine Produktdateien lesen oder verändern. */
export async function runSelfTests() {
    const module = 'app/synthetic.js';
    const record = { selector: '#stable', status: 'geschützt', producer: { kind: 'function', module, name: 'build' }, anchor: { kind: 'id', value: 'stable' } };
    const check = source => validateAnchorEvidence(record, new Map([[module, source]]), { id: 'I01', page: 'index.html' });
    assert.equal(check('function build() { return `<button id="stable">Auswahl</button>`; }').ok, true);
    assert.equal(check('function build() { document.querySelector("#stable"); }').ok, false);
    assert.equal(check('function build() {} function other() { node.id = "stable"; }').ok, false);
    assert.equal(check('function build() { return `<button id="stable">✨</button>`; }').ok, true);
    const fixture = { definitions: { text: 'Aussage', base: { kind: 'sichtbar' }, columns: ['selectors', 'kind'] },
        value: { ref: 'base', condition: '@text' }, list: { columns: '@columns', rows: [[['#stable'], 'sichtbar']] } };
    assert.deepEqual(resolveInventory(fixture), { value: { kind: 'sichtbar', condition: 'Aussage' }, list: [{ selectors: ['#stable'], kind: 'sichtbar' }] });
    assert.throws(() => resolveInventory({ definitions: { a: '@b', b: '@a' } }), /Zyklus/);
    assert.throws(() => resolveInventory({ value: '@absent' }), /Referenz fehlt/);
    assert.throws(() => resolveInventory({ definitions: { number: 2 } }), /Unerlaubter Typ/);
    assert.equal(checkInventorySizes('a'.repeat(INVENTORY_SIZE_LIMITS.source), '').ok, true);
    assert.equal(checkInventorySizes('a'.repeat(INVENTORY_SIZE_LIMITS.source + 1), '').ok, false);
    assert.equal(checkInventorySizes('', 'a'.repeat(INVENTORY_SIZE_LIMITS.markdown)).ok, true);
    assert.equal(checkInventorySizes('', 'a'.repeat(INVENTORY_SIZE_LIMITS.markdown + 1)).ok, false);
    const readableFixture = { definitions: { 'pruefung.modalDialog': 'Wiederholter ausführlicher Dialogprüffall. '.repeat(3) },
        checks: [{ expected: '@pruefung.modalDialog' }, { expected: '@pruefung.modalDialog' }] };
    assert.equal(checkInventoryReadability(JSON.stringify(readableFixture, null, 2)).ok, true);
    assert.equal(checkInventoryReadability(JSON.stringify(readableFixture)).ok, false);
    readableFixture.status = '@pruefung.modalDialog';
    assert.equal(checkInventoryReadability(JSON.stringify(readableFixture, null, 2)).ok, false);
    assert.equal(checkInventoryReadability(' '.repeat(INVENTORY_LINE_LIMIT - 2) + '{}').ok, true);
    assert.equal(checkInventoryReadability(' '.repeat(INVENTORY_LINE_LIMIT - 1) + '{}').ok, false);
    return 'Selbsttest bestanden: Erzeugerort, Erzeugung, Beschriftungsfreiheit, typisierte Referenzen, Tabellen, Zyklen, Bytegrenzen und lesbares Quellformat.';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    (async () => {
    try {
        if (process.argv.length !== 3 || !['--check', '--check-reviewed', '--self-test'].includes(process.argv[2])) throw new Error('Aufruf: node tests/funktionsinventar-contract.mjs --check-reviewed, --check oder --self-test');
        if (process.argv[2] === '--self-test') {
            console.log(await runSelfTests());
        } else {
            const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/design/funktionsinventar.json'), 'utf8'));
            const schema = validateInventory(inventory, { reviewed: process.argv[2] === '--check-reviewed' });
            if (!schema.ok) throw new Error(schema.errors.join('\n'));
            const result = validateSources(inventory, readRepositorySources(inventory), { reviewed: process.argv[2] === '--check-reviewed' });
            if (!result.ok) throw new Error(result.errors.join('\n'));
            const { renderInventory } = await import('../scripts/generate-funktionsinventar.mjs');
            const json = fs.readFileSync(path.join(root, 'docs/design/funktionsinventar.json'), 'utf8');
            const markdown = fs.readFileSync(path.join(root, 'docs/design/funktionsinventar.md'), 'utf8');
            const sizes = checkInventorySizes(json, markdown);
            if (!sizes.ok) throw new Error(sizes.errors.join('\n'));
            const readability = checkInventoryReadability(json);
            if (!readability.ok) throw new Error(readability.errors.join('\n'));
            const freshness = checkMarkdown(inventory, markdown, renderInventory);
            if (!freshness.ok) throw new Error(freshness.errors.join('\n'));
            console.log(`Inventarvertrag gültig: ${resolveInventory(inventory).pages.reduce((count, page) => count + page.entries.length, 0)} geprüfte Einträge; ${resolveInventory(inventory).baselineAudit.length} Ausgangskennungen.`);
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    })();
}
