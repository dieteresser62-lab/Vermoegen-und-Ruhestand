import strictAssert from 'node:assert/strict';
import vm from 'node:vm';
import {
    withSourceValidationCache, tokenizeJS, locateProducer, validateAnchorEvidence, checkInventorySizes, functionBindings, validateDelegation,
    checkInventoryEntrySizes, checkInventoryReadability, INVENTORY_LINE_LIMIT, INVENTORY_SIZE_LIMITS, BASELINE_IDS, GENERATE_INVENTORY_COMMAND
} from './funktionsinventar-contract.mjs';

await withSourceValidationCache(async () => {

// Kleine injizierte Quellkopien; keine Produktdatei, kein Browser, kein App-Import.
const module = 'app/synthetic.js';
const context = { id: 'I01', page: 'index.html' };
const anchor = { kind: 'id', value: 'stable' };
const producer = { kind: 'function', module, name: 'build' };
const creation = 'return `<button id="stable">Auswahl</button>`;';
const anchorSelector = selected => selected.kind === 'class' ? '.' + selected.value
    : selected.kind === 'id' ? `[id=${JSON.stringify(selected.value)}]`
        : `[${selected.attribute}${Object.hasOwn(selected, 'value') ? '=' + JSON.stringify(selected.value) : ''}]`;
const evidence = (source, options = {}) => validateAnchorEvidence({
    selector: options.selector || anchorSelector(options.anchor || anchor),
    status: 'geschützt', anchor: options.anchor || anchor, producer: options.producer || producer
}, options.files || new Map([[options.producer?.module || module, source]]), context);
const passes = (source, name, options) => assertEqual(evidence(source, options).ok, true, name);
const fails = (source, name, options) => {
    const result = evidence(source, options);
    assertEqual(result.ok, false, name);
    assertEqual(result.errors.length, 1, `${name}: genau eine Diagnose`);
    for (const text of ['I01', 'index.html', options?.selector || 'stable', options?.producer?.module || module]) {
        assert(result.errors[0].includes(text), `${name}: Diagnose enthält ${text}`);
    }
};

for (const [name, source] of [
    ['Funktionsdeklaration', `export async function build() { ${creation} }`],
    ['Blockpfeil', `export const build = async (items) => { ${creation} };`],
    ['Funktionswert', `const build = async function privateName() { ${creation} };`],
    ['Objektmethode', `const view = { async build() { ${creation} } };`],
    ['Klassenmethode', `export class View { static async build() { ${creation} } }`],
    ['Pfeil mit Einzelparameter', `const build = item => { ${creation} };`]
]) passes(source, name);

for (const [name, source] of [
    ['Geschwisterfunktion', `function build() {} function sibling() { ${creation} }`],
    ['Außerhalb des Rumpfs', `function build() {} node.innerHTML = '<button id="stable"></button>';`],
    ['Nur im Aufrufer', `function build() {} function caller() { build(); ${creation} }`],
    ['Ausgelagerter Helfer', `function build() { return helper(); } function helper() { ${creation} }`],
    ['Doppelter Methodenname', `const a = { build() { ${creation} } }; class B { build() {} }`],
    ['Doppelte Deklaration', `function build() {} function build() { ${creation} }`],
    ['Unbenutztes Markup', 'function build() { const unused = `<button id="stable"></button>`; }'],
    ['Markup nur als Aufrufargument', 'function build() { return ignore(`<button id="stable"></button>`); }'],
    ['Markup nur in RegExp', 'function build() { return /<button id="stable">/; }']
]) fails(source, name);

passes('function build(items) { return `<ul>${items.map(item => `<li id="stable">${item.label}</li>`).join("")}</ul>`; }',
    'Verschachteltes Template im map-Ausdruck');
passes('function build(items) { return `<ul>${items.map(item => { return `<li id="stable">${`${item.label}`}</li>`; }).join("")}</ul>`; }',
    'Verschachtelter Callback mit Block und weiterer Interpolation');
passes('function build(items) { items.forEach(item => { item.node.id = "stable"; }); }', 'DOM-Schreibstelle im Callback');

const boundaryCases = [
    ['Strings und Escapes', String.raw`const a = "} { \\\""; const b = '}';`],
    ['Kommentare', '/* } { */ const n = 1; // }\n'],
    ['RegExp mit Zeichenklasse und Escape', String.raw`const re = /[{}\/]\}+/g;`],
    ['RegExp nach Kontrollbedingung', String.raw`if (ready) /[}]/.test(text);`],
    ['Division und RegExp', String.raw`const n = total / count / 2; const r = /[{}]/; const x = ({n: 2}).n / 2;`],
    ['RegExp nach Block', String.raw`if (ready) { tick(); } /[{}]/.test(text);`],
    ['Template-Text', 'const t = `} { \\` ${value} Ende`;'],
    ['Verschachtelte Interpolationen', 'const t = `}${({ label: `${items.map(item => `${item.value}`).join("")}` }).label}{`;']
];
for (const [name, noise] of boundaryCases) {
    const source = `function build() { ${noise} ${creation} } function sibling() { node.id = "stable"; }`;
    passes(source, `${name}: Erzeuger im richtigen Rumpf`);
    fails(source.replace(creation, ''), `${name}: Geschwister schützt nicht`);
    const body = locateProducer(producer, source);
    assert(body.every(token => token.end <= source.indexOf('function sibling')), `${name}: Grenze vor Geschwister`);
}
const divisionTokens = tokenizeJS('const a = total / count; const b = /[{}]/g;');
assertEqual(divisionTokens.filter(token => token.kind === 'regexp').length, 1, 'Genau ein RegExp statt Division');
assertEqual(divisionTokens.filter(token => token.kind === 'punct' && token.value === '/').length, 1, 'Division bleibt Operator');
for (const source of [
    'function build() { const r = /[}]/;', 'function build() { /* ohne Ende',
    'function build() { return `a${`${x}`}`;', 'function build() { return "offen; }'
]) fails(source, 'Unbeendete Quelle liefert Diagnose');

for (const [name, statement, selectedAnchor] of [
    ['Markup-Rückgabe', creation, anchor],
    ['innerHTML', 'node.innerHTML = `<button id="stable"></button>`;', anchor],
    ['insertAdjacentHTML', 'node.insertAdjacentHTML("beforeend", `<button id="stable"></button>`);', anchor],
    ['Lokale Markupvariable', 'const html = `<button id="stable"></button>`; return html;', anchor],
    ['Lokaler Templatebezug', 'const part = `<button id="stable"></button>`; node.innerHTML = `<section>${part}</section>`;', anchor],
    ['id', 'node.id = "stable";', anchor],
    ['className', 'node.className = "other stable selected";', { kind: 'class', value: 'stable' }],
    ['classList.add', 'node.classList.add("other", "stable");', { kind: 'class', value: 'stable' }],
    ['dataset', 'node.dataset.testAnchor = "stable";', { kind: 'data', attribute: 'data-test-anchor', value: 'stable' }],
    ['setAttribute-id', 'node.setAttribute("id", "stable");', anchor],
    ['setAttribute-class', 'node.setAttribute("class", "other stable");', { kind: 'class', value: 'stable' }],
    ['setAttribute-data', 'node.setAttribute("data-test-anchor", "stable");', { kind: 'data', attribute: 'data-test-anchor', value: 'stable' }],
    ['Markup-Klasse', 'return `<div class="other stable"></div>`;', { kind: 'class', value: 'stable' }],
    ['Markup-data', 'return `<div data-test-anchor="stable"></div>`;', { kind: 'data', attribute: 'data-test-anchor', value: 'stable' }],
    ['String-Escape', String.raw`node.id = "sta\u0062le";`, anchor],
    ['HTML-Entity', 'return `<div id="sta&#98;le"></div>`;', anchor]
]) {
    passes(`function build() { ${statement} }`, `${name}: Erzeugung`, { anchor: selectedAnchor });
    fails(`function build() { ${statement.replaceAll('stable', 'renamed').replace('sta\\u0062le', 'renamed').replace('sta&#98;le', 'renamed')} }`,
        `${name}: Umbenennung`, { anchor: selectedAnchor });
}

// Jede Restform bleibt nach isolierter Entfernung des Erzeugers allein zurück.
for (const rest of [
    'node.addEventListener("stable", handler);', 'document.querySelector("#stable");',
    'document.querySelectorAll("#stable");', 'document.getElementById("stable");',
    'node.closest("#stable");', 'node.matches("#stable");', '/* id="stable" */',
    'if (node.id === "stable") { tick(); }', 'const markup = `<button id="stable"></button>`;'
]) {
    passes(`function build() { node.id = "stable"; ${rest} }`, `Erzeuger plus Rest: ${rest}`);
    fails(`function build() { ${rest} }`, `Nur Rest: ${rest}`);
}
for (const source of [
    'node.id = "stable-suffix";', 'node.id = "stable" + suffix;',
    'node.id == "stable";', 'node.id === "stable";', 'node.className = "unstable";',
    'node.classList.contains("stable");', 'return `<div title="stable"></div>`;',
    'return `<div id="stable${suffix}"></div>`;', 'return `<!-- <div id="stable"></div> -->`;'
]) fails(`function build() { ${source} }`, `Keine exakte Erzeugung: ${source}`);
fails('function build() { node.className = "unstable stable-other"; }', 'Klassen-Präfix reicht nicht', { anchor: { kind: 'class', value: 'stable' } });
fails('function build() { node.dataset.other = "stable"; }', 'Falsches data-Attribut', { anchor: { kind: 'data', attribute: 'data-test-anchor', value: 'stable' } });
passes(`function build() { ${creation.replace('Auswahl', 'Andere Beschriftung ✨')} }`, 'Beschriftung und Emoji dürfen wechseln');
passes(`function build() { ${creation} }`, 'Injiziertes Objekt statt Map', { files: { [module]: `function build() { ${creation} }` } });
fails('', 'Fehlende Quelldatei', { files: new Map() });

const inline = { kind: 'inline-module', module: 'index.html', block: 1 };
const html = `<script src="external.js" type="module"></script>
<!-- <script type="module">node.id = "stable";</script> -->
<script>const fake = '<script type="module">';</script>
<script type="module">node.id = "stable";</script>
<script type="module">node.id = "other";</script>`;
passes(html, 'Inline-Modul: Index zählt nur echte Inline-Module', { producer: inline });
fails(html.replace('\n<script type="module">node.id = "stable";</script>', '<script type="module"></script>'), 'Inline-Modul: Erzeuger entfernt', { producer: inline });
fails(html.replace('\n<script type="module">node.id = "stable";</script>', '<script type="module"></script>').replace('<script type="module">node.id = "other";</script>', '<script type="module">node.id = "stable";</script>'),
    'Inline-Modul: Erzeuger ausschließlich im zweiten Block', { producer: inline });
fails(html, 'Inline-Modul: falscher Block', { producer: { ...inline, block: 2 } });
fails(html, 'Inline-Modul: fehlender Block', { producer: { ...inline, block: 3 } });
fails(html, 'Inline-Modul: Index 0 unzulässig', { producer: { ...inline, block: 0 } });

const top = { kind: 'module-top-level', module };
passes('node.id = "stable"; function helper() {}', 'Moduloberfläche: eigene Schreibstelle', { producer: top });
for (const source of [
    `function helper() { ${creation} }`, `const helper = () => { ${creation} };`,
    `const helper = function() { ${creation} };`, `const view = { helper() { ${creation} } };`,
    `class View { helper() { ${creation} } }`, 'const helper = () => `<div id="stable"></div>`;',
    'const html = `${items.map(item => `<div id="stable"></div>`)}`; node.innerHTML = html;',
    'function helper(arg = `<div id="stable"></div>`) { return arg; }'
]) fails(source, 'Moduloberfläche: Funktionswert ausgeschlossen', { producer: top });
passes('node.innerHTML = `<div id="stable"></div>`;', 'Moduloberfläche: Markup-Ausgabe', { producer: top });
assertEqual(JSON.stringify(INVENTORY_SIZE_LIMITS), JSON.stringify({ source: 1500000, markdown: 225000, entry: 20000 }),
    'Verbindliche inklusive Grenzen für Slice 1');
for (const [kind, limit, character] of [['source', INVENTORY_SIZE_LIMITS.source, 'ä'], ['markdown', INVENTORY_SIZE_LIMITS.markdown, '✨']]) {
    const check = value => kind === 'source' ? checkInventorySizes(value, '') : checkInventorySizes('', value);
    for (const fill of ['a', character]) {
        const width = Buffer.byteLength(fill, 'utf8');
        const atLimit = fill.repeat(Math.floor(limit / width)) + 'a'.repeat(limit % width);
        assertEqual(check(atLimit).ok, true, `${kind}: exakt ${limit} UTF-8-Bytes mit ${fill}`);
        const result = check(atLimit + 'a');
        assertEqual(result.ok, false, `${kind}: ein Byte über Grenze mit ${fill}`);
        for (const fragment of [String(limit + 1), String(limit), 'docs/design/funktionsinventar.', 'pflegen', 'node ']) {
            assert(result.errors[0].includes(fragment), `${kind}: Größenfehler nennt ${fragment}`);
        }
    }
}


passes('function build() { let html = ""; html += `<button id="stable"></button>`; return html; }', 'Lokal aufgebautes Markup wird ausgegeben');
passes('function build(items) { const html = `<ul>${items.map(item => `<li id="stable"></li>`)}</ul>`; return html; }',
    'Verbrauchte lokale Templatevariable mit Callback');
passes('function build() { const html = `<button id="stable"></button>`; { const html = ""; } return html; }',
    'Blockvariable überschreibt äußeren Beleg nicht');
passes('function build(items) { const unused = `${items.map(item => { item.node.id = "stable"; })}`; }',
    'DOM-Schreibstelle in unbenutztem Template bleibt tatsächliche Schreibstelle');
for (const [name, source] of [
    ['Unbenutztes Template mit Callback', 'function build(items) { const unused = `<ul>${items.map(item => `<li id="stable"></li>`)}</ul>`; }'],
    ['Unbenutzter lokaler Callbackbezug', 'function build(items) { const part = `<ul>${items.map(item => `<li id="stable"></li>`)}</ul>`; const unused = `${part}`; }'],
    ['Blocklokaler Beleg entweicht nicht', 'function build() { const html = ""; { const html = `<button id="stable"></button>`; } return html; }'],
    ['Parameter überschattet lokalen Beleg', 'function build() { const html = `<button id="stable"></button>`; function nested(html) { return html; } }'],
    ['Ausdruckspfeilparameter überschattet Beleg', 'function build() { const html = `<button id="stable"></button>`; items.map(html => html); }'],
    ['return-Zeilenumbruch', 'function build() { return\n`<button id="stable"></button>`; }'],
    ['Benannter Ausdruckspfeil nicht im Kernvertrag', 'const build = () => `<button id="stable"></button>`;'],
    ['Eigenschaft ist keine benannte Variable', 'view.build = () => { return `<button id="stable"></button>`; };'],
    ['Berechnete Methode', 'const view = { [method]() { return `<button id="stable"></button>`; } };'],
    ['Nichtverbrauchtes append-Markup', 'function build() { let html = ""; html += `<button id="stable"></button>`; }']
]) fails(source, name);
fails('const view = { [method]() { node.id = "stable"; } };', 'Berechnete Methode schützt Moduloberfläche nicht', { producer: top });
passes('function build() { const ratio = total / /[}]/.exec(text).length; count++; const n = count / 2; node.id = "stable"; }',
    'Division direkt vor RegExp sowie nach Postfixoperator');
assert(evidence('const a = { build() {} }; class B { build() {} }').errors[0].includes('Mehrdeutiger Funktionsname'),
    'Namenskollision hat eigene Diagnose');
for (const selectedAnchor of [
    { kind: 'id', value: 'stable' + 'a'.repeat(75) },
    { kind: 'id', value: 'stable\ntext' },
    { kind: 'class', value: 'stable other' },
    { kind: 'data', value: 'stable', attribute: 'data-' }
]) fails(`function build() { ${creation} }`, 'Ungültiger Ankervertrag', { anchor: selectedAnchor });
assertEqual(evidence(`function build() { ${creation} }`, {
    producer: { ...producer, module: '../synthetic.js' }
}).ok, false, 'Erzeugerpfad mit Traversierung wird abgewiesen');
passes(`function build() { node.id = "${'✨'.repeat(80)}"; }`,
    'Ankergrenze zählt Unicode-Zeichen', { anchor: { kind: 'id', value: '✨'.repeat(80) } });

// Eigener Anker und vollständiger Selektor müssen denselben Knoten bezeichnen.
const ownField = { selector: 'input[data-profile-id]', anchor: { kind: 'class', value: 'stable' } };
for (const [name, statement] of [
    ['Eigenes Markup', 'return `<label><input class="stable" data-profile-id="${id}"></label>`;'],
    ['Eigener DOM-Empfänger', 'const n = doc.createElement("input"); n.className = "stable"; n.dataset.profileId = id;']
]) passes(`function build() { ${statement} }`, name, ownField);
for (const [name, statement] of [
    ['Elternanker', 'return `<label class="stable"><input data-profile-id="${id}"></label>`;'],
    ['Nachbaranker', 'return `<span class="stable"></span><input data-profile-id="${id}">`;'],
    ['Falscher Tag', 'return `<label class="stable" data-profile-id="${id}"></label>`;'],
    ['Verteilte DOM-Attribute', 'const a = doc.createElement("input"); a.className = "stable"; b.dataset.profileId = id;'],
    ['Blocklokale Namensgleichheit', '{ const n = doc.createElement("input"); n.className = "stable"; } { const n = doc.createElement("input"); n.dataset.profileId = id; }'],
    ['Parameter überschattet Empfänger', 'const n = doc.createElement("input"); n.className = "stable"; function nested(n) { n.dataset.profileId = id; }'],
    ['Eigenschaft am überschatteten Parameter', 'item.node.className = "stable"; function nested(item) { item.node.dataset.profileId = id; }'],
    ['Uninitialisierte Schattenvariable', 'const n = doc.createElement("input"); n.className = "stable"; { let n; n.dataset.profileId = id; }'],
    ['Neu zugewiesener Empfänger', 'let n = doc.createElement("input"); n.className = "stable"; n = other; n.dataset.profileId = id;'],
    ['Getrennte Zweige', 'const n = doc.createElement("input"); if (ready) { n.className = "stable"; } else { n.dataset.profileId = id; }']
]) fails(`function build() { ${statement} }`, name, ownField);

const actionField = { selector: '.actions > button[title][aria-label]', anchor: { kind: 'class', value: 'stable' } };
const actionDOM = 'const actions = doc.createElement("div"); actions.className = "actions"; const n = doc.createElement("button"); n.className = "stable"; n.title = title; n.ariaLabel = label; actions.appendChild(n);';
passes(`function build() { ${actionDOM} }`, 'Lokaler Elternkontext und ariaLabel', actionField);
fails(`function build() { ${actionDOM.replace('actions.appendChild(n)', 'other.appendChild(n)')} }`, 'Fremder Elternkontext', actionField);
fails(`function build() { ${actionDOM.replace('n.ariaLabel = label;', 'other.ariaLabel = label;')} }`, 'aria-label am Nachbarn', actionField);
passes('function build() { const actions = doc.createElement("div"); actions.className = "actions"; actions.innerHTML = `<button class="stable" title="" aria-label="${label}"></button>`; }',
    'Markupausgabe am lokalen Elternempfänger', actionField);
const adjacentDOM = 'const actions = doc.createElement("div"); actions.className = "actions"; actions.insertAdjacentHTML("beforeend", `<button class="stable" title="" aria-label="${label}"></button>`);';
passes(`function build() { ${adjacentDOM} }`, 'Innen eingefügtes Markup hat lokalen Elternkontext', actionField);
fails(`function build() { ${adjacentDOM.replace('beforeend', 'beforebegin')} }`,
    'Außen eingefügtes Markup darf den Empfänger nicht als Elternteil verwenden', actionField);
passes('function build() { return `<div class="actions"><button class="stable" title="" aria-label="${label}"></button></div>`; }',
    'Markup mit vollständigem Elternkontext', actionField);
fails('function build() { return `<div class="actions"><section><button class="stable" title="" aria-label="${label}"></button></section></div>`; }',
    'Direktes Kind ist kein Enkel', actionField);
const prefixField = { selector: '[id^="known-"]', anchor: { kind: 'class', value: 'stable' } };
passes('function build() { n.id = `known-${id}`; n.className = "stable"; }', 'Eigener bekannter ID-Präfix', prefixField);
fails('function build() { other.id = `known-${id}`; n.className = "stable"; }', 'ID-Präfix am Nachbarn', prefixField);
fails('function build() { n.id = `known-${id}`; n.className = "stable"; }', 'Berechneter ID-Rest ist kein exakter Wert',
    { ...prefixField, selector: '[id="known-fixed"]' });
const cellField = { selector: 'td[data-month][data-profile]', anchor: { kind: 'class', value: 'stable' } };
const cellDOM = 'const cell = doc.createElement("td"); cell.className = "stable"; cell.dataset.month = month; cell.dataset.profile = profile;';
passes(`function build() { ${cellDOM} }`, 'Mehrere Attribute am eigenen Zellenempfänger', cellField);
fails(`function build() { ${cellDOM.replace('cell.dataset.profile', 'other.dataset.profile')} }`,
    'Selektorattribute auf mehrere Empfänger verteilt', cellField);

const presenceAnchor = { kind: 'data', attribute: 'data-profile-id' };
for (const [name, statement, renamed, reader] of [
    ['Berechnetes dataset', 'n.dataset.profileId = profile.id;', 'n.dataset.other = profile.id;', 'const id = n.dataset.profileId;'],
    ['Berechnetes setAttribute', 'n.setAttribute("data-profile-id", profile.id);', 'n.setAttribute("data-other", profile.id);', 'n.getAttribute("data-profile-id");'],
    ['Interpoliertes Markup', 'return `<input data-profile-id="${profile.id}">`;', 'return `<input data-other="${profile.id}">`;', 'const unused = `<input data-profile-id="${profile.id}">`;'],
    ['Leeres Markupattribut', 'return `<input data-profile-id="">`;', 'return `<input data-other="">`;', 'const unused = `<input data-profile-id="">`;'],
    ['Wertloses Markupattribut', 'return `<input data-profile-id>`;', 'return `<input data-other>`;', '/* <input data-profile-id> */']
]) {
    const check = code => evidence(`function build() { ${code} }`, { anchor: presenceAnchor });
    assertEqual(check(statement).ok, true, name + ': gültige Präsenzkontrolle');
    for (const [mutation, code] of [['Entfernung', ''], ['Umbenennung', renamed], ['Leser/Scheinmarkup', reader]]) {
        const result = check(code);
        assertEqual(result.ok, false, name + ': ' + mutation);
        assert(result.errors.some(error => ['I01', 'index.html', '[data-profile-id]', module, 'Anker-Erzeugung'].every(part => error.includes(part))),
            name + ': gezielte Präsenzdiagnose ' + mutation);
    }
}
for (const value of ['', 'fixed']) {
    const selected = { ...presenceAnchor, value };
    assertEqual(evidence(`function build() { n.dataset.profileId = ${JSON.stringify(value)}; }`, { anchor: selected }).ok, true,
        'Expliziter Wert einschließlich leerem Wert bleibt exakt: ' + JSON.stringify(value));
    for (const statement of ['n.dataset.profileId = profile.id;', 'n.dataset.profileId = "other";']) {
        assertEqual(evidence(`function build() { ${statement} }`, { anchor: selected }).ok, false, 'Präsenz ersetzt keinen expliziten Wert');
    }
}
for (const attribute of ['data-profile-id', 'data-profile-id=""']) {
    assertEqual(evidence(`function build() { return '<input ${attribute}>'; }`, { anchor: { ...presenceAnchor, value: '' } }).ok, true,
        'Explizit leerer Wert ist auch im Markup exakt');
}
assertEqual(evidence('function build() { return `<input data-profile-id="${id}">`; }',
    { anchor: { ...presenceAnchor, value: '' } }).ok, false, 'Interpolierter Wert ist kein explizit leerer Wert');
for (const value of [undefined, null, 7]) {
    assertEqual(evidence('function build() { n.dataset.profileId = id; }', { anchor: { ...presenceAnchor, value } }).ok, false,
        'Explizites ungültiges value wird nicht als Präsenz umgedeutet');
}
const lexicalPresence = { selector: '[data-profile-id]', producer, anchor: presenceAnchor,
    status: 'ungeschützt (Erzeugungsform vom Prüfer nicht unterstützt)', reason: 'Nur lexikalisch belegt.' };
for (const reader of ['const id = n.dataset.profileId;', 'n.getAttribute("data-profile-id");']) {
    assertEqual(validateAnchorEvidence(lexicalPresence, new Map([[module, `function build() { ${reader} }`]]), context).ok, true,
        'Lexikalische Präsenz bleibt ausdrücklich ungeschützt');
}
assertEqual(validateAnchorEvidence(lexicalPresence, new Map([[module, 'function build() {}']]), context).ok, false,
    'Entfernter lexikalischer Präsenzbeleg scheitert');
for (const renamed of ['n.getAttribute("data-profile-id-other");', 'return `<input data-profile-id-other="">`;']) {
    assertEqual(validateAnchorEvidence(lexicalPresence, new Map([[module, `function build() { ${renamed} }`]]), context).ok, false,
        'Fremder Attributname ersetzt auch keinen lexikalischen Präsenzbeleg');
}

// Bestandsvertrag und Migration: injizierte Kopien, keine Produktmutation.
const fs = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const {
    resolveInventory, validateInventory, validateSources, readRepositorySources,
    protectionCounts, DYNAMIC_STATUSES, PACKAGE_ORDER, checkMarkdown, runSelfTests,
    tokenizeHTML, matchesSelector, registeredBrowserCases
} = await import('./funktionsinventar-contract.mjs');
const { renderInventory, generateInventory } = await import('../scripts/generate-funktionsinventar.mjs');
const inventoryPath = fileURLToPath(new URL('../docs/design/funktionsinventar.json', import.meta.url));
const markdownPath = fileURLToPath(new URL('../docs/design/funktionsinventar.md', import.meta.url));
const json = fs.readFileSync(inventoryPath, 'utf8');
const markdown = fs.readFileSync(markdownPath, 'utf8');
const inventory = JSON.parse(json);
const courseEntry = inventory.pages.flatMap(page => page.entries).find(entry => entry.id === 'I14');
assert(courseEntry.target.location.includes('Kursaufklappfeld an der Kurspille'), 'I14 nennt den erreichbaren Statusersatzort am Kopf');
assert(courseEntry.initialStates.some(state => state.condition.includes('Fokusschritt') && state.condition.includes('#kursdetails')), 'I14 führt Pille, Fokusschritt und direkten Hash');
assertEqual(JSON.stringify(courseEntry.storage.map(record => record.keys)), JSON.stringify([['rs_startup_prices_session_v1'], ['depot_tranchen', 'rs_profiles_v1']]), 'I14 behält Sitzungs- und Fachspeicherverträge');
const resolved = resolveInventory(inventory);
const simulatorPage = resolved.pages.find(page => page.path === 'Simulator.html');
for (const text of ['S02', 'Schrittknöpfe', 'Enter/Space', 'aria-expanded', 'Weiter/Zurück', 'details', 'Segmentknöpfe']) {
    assert(simulatorPage.keyboard.statement.includes(text), `Simulator-Tastaturinventar beschreibt ${text}`);
}
assert(!simulatorPage.keyboard.statement.includes('Legenden nur Klick'), 'S02 enthält keine veraltete Legendenaussage');
assert(simulatorPage.print.statement.includes('geschlossene Annahmenschritte und Detailklappen')
    && !simulatorPage.print.statement.includes('Rahmendatenklappen'), 'Simulator-Druckinventar beschreibt aktuelle Annahmenschritte und Detailklappen');
const entries = resolved.pages.flatMap(page => page.entries);
const coreAnswers = entries.find(entry => entry.id === 'S33');
assert(coreAnswers.selectors.static.includes('#monteCarloAnswers')
    && coreAnswers.selectors.dynamic.some(ref => ref.selector === '.sim-mc-answer'
        && ref.producer.name === 'renderMonteCarloAnswers'), 'P16: Kernantworten besitzen tatsächlichen Host und Erzeugeranker');
for (const path of ['tests/results-metrics.test.mjs', 'tests/results-renderers.test.mjs', 'tests/simulator-result-overview.test.mjs']) {
    assert(coreAnswers.coverage.node.some(ref => ref.path === path), 'P16: Kernantworten haben konkreten Node-Nachweis ' + path);
}
const answerBrowserRefs = coreAnswers.coverage.browser.filter(ref => ['Simulator Kernantworten', 'Simulator Kopfaktion'].includes(ref.name));
assert(answerBrowserRefs.length === 2 && answerBrowserRefs.every(ref => ref.scope.includes('Registriert, nicht ausgeführt')),
    'P16: Browserregistrierung wird nicht als ausgeführte Abnahme ausgegeben');
const centralHandbook = entries.find(entry => entry.id === 'H09');
assert(centralHandbook.selectors.static.includes('#profilverbund-personendaten')
    && centralHandbook.initialStates.some(state => state.selectors.includes('#profilverbund-personendaten')),
    'P10: zentraler Handbuchanker besitzt inventarisierten Ausgangszustand');

// Die tatsächlichen Kapitelassertions isoliert ausführen: erst includes() gilt
// als Inhaltsread, nicht bereits eine Kapiteldeklaration oder ein Evidenztext.
function traceHandbookAssertions(testSource, handbook) {
    const helperStart = testSource.indexOf('const chapter =');
    const assertionsStart = testSource.indexOf('const personChapter =', helperStart);
    const assertionsEnd = testSource.indexOf('\nconst technical =', assertionsStart);
    strictAssert.ok(helperStart >= 0 && assertionsStart > helperStart && assertionsEnd > assertionsStart,
        'P10-Kapitelassertions und Kapitelhelfer müssen im Test vorhanden sein');
    const chapter = vm.runInNewContext(testSource.slice(helperStart, assertionsStart) + '\nchapter;',
        { handbook, assert: strictAssert.ok }, { timeout: 1000 });
    const reads = new Set(), assertions = new Map();
    vm.runInNewContext(testSource.slice(assertionsStart, assertionsEnd), {
        handbook,
        chapter: id => {
            const text = chapter(id);
            return { includes: needle => { reads.add('#' + id); return text.includes(needle); } };
        },
        assert: (condition, evidence) => {
            strictAssert.ok(condition, evidence);
            strictAssert.ok(!assertions.has(evidence), 'Eindeutige Kapitelassertion: ' + evidence);
            assertions.set(evidence, [...reads]);
            reads.clear();
        }
    }, { timeout: 1000 });
    return assertions;
}
const handbookTestPath = 'tests/designsystem-start-handbook.test.mjs';
const handbookTestSource = fs.readFileSync(new URL('../' + handbookTestPath, import.meta.url), 'utf8');
const handbookSource = fs.readFileSync(new URL('../Handbuch.html', import.meta.url), 'utf8');
const chapterAssertions = traceHandbookAssertions(handbookTestSource, handbookSource);
const hasChapterRead = (entry, ref, assertions = chapterAssertions) => ref.path === handbookTestPath
    && (assertions.get(ref.evidence) || []).some(selector => entry.selectors.static.includes(selector));
const browserSource = fs.readFileSync(new URL('./browser-smoke.test.mjs', import.meta.url), 'utf8');
const manualBrowserSource = browserSource.slice(browserSource.indexOf('async function runManualSmoke('))
    .split('\nasync function ')[0];
const hasBrowserAnchor = (entry, ref) => ref.name === 'Handbuch.html' && ref.scope.includes('extern offen')
    && (ref.scope.match(/#[\w-]+/g) || []).some(selector => entry.selectors.static.includes(selector)
        && manualBrowserSource.includes(`page.locator('${selector}')`));
for (const id of ['H05', 'H06', 'H07', 'H09']) {
    const entry = entries.find(record => record.id === id);
    const refs = entry.coverage.node.filter(ref => ref.evidence.startsWith('P10:'));
    assert(refs.length > 0, id + ': dokumentierter Personenvertrag hat einen P10-Inhaltsnachweis');
    for (const ref of refs) assert(hasChapterRead(entry, ref),
        id + ': referenzierte Assertion liest tatsächlich einen Selektor des Eintrags: ' + ref.evidence);
    for (const ref of entry.coverage.browser) assert(hasBrowserAnchor(entry, ref),
        id + ': Browserbezug benennt einen tatsächlich bedienten eigenen Anker und bleibt extern offen');
}
assert(centralHandbook.coverage.browser.some(ref => hasBrowserAnchor(centralHandbook, ref)),
    'H09: registrierter zentraler TOC-/Fokusnachweis bleibt vorhanden');
const advancedHandbook = entries.find(entry => entry.id === 'H06');
const advancedRef = advancedHandbook.coverage.node.find(ref => ref.evidence.startsWith('P10:'));
assert(!hasChapterRead(advancedHandbook, entries.find(entry => entry.id === 'H05').coverage.node[0]),
    'R-06: H05-Kapitelassertion kann H06 nicht absichern');
assert(!hasChapterRead(advancedHandbook, { ...advancedRef, evidence: 'P10: Nur behaupteter Inhaltsnachweis' }),
    'R-06: Evidenztext ohne ausgeführte Assertion wird abgewiesen');
assert(!hasChapterRead(advancedHandbook, advancedRef, traceHandbookAssertions(
    handbookTestSource.replace(/const scenarioChapter =[\s\S]*?(?=const annualChapter =)/, ''), handbookSource)),
    'R-06: entfernte H06-Assertion wird trotz erhaltenem Inventarbezug erkannt');
strictAssert.throws(() => traceHandbookAssertions(handbookTestSource,
    handbookSource.replace('samt dessen Personenbeleg', 'ohne Laufbeleg')), /abgeschlossenen Laufs/,
    'R-06: geänderter H06-Lauftext wird von der referenzierten Assertion erkannt');
assert(!hasBrowserAnchor(advancedHandbook, centralHandbook.coverage.browser[0]),
    'R-06: zentraler H09-Browseranker kann H06 nicht absichern');
for (const id of ['S31', 'S55']) {
    assert(entries.find(entry => entry.id === id).auditEvidence.some(ref =>
        ref.path === 'app/simulator/simulator-person-overrides.js'
        && ['personDataReferenceYear', 'personDataDeviationApplied', 'personDataChanges', 'Pflicht-/Finanzspalten'].every(field => ref.observation.includes(field))),
        id + ': additive Kontextfelder und erhaltene Altspalten haben einen Quellenbeleg');
}
const sources = readRepositorySources(inventory);
const validInventory = validateInventory(inventory);
assertEqual(validInventory.ok, true, 'Bestand: Schema 2, Pflichtfelder und sämtliche Bezüge: ' + validInventory.errors.join('; '));
const validSources = validateSources(inventory, sources);
assertEqual(validSources.ok, true, 'Bestand: alle geschützten Erzeuger und Ortsbelege: ' + validSources.errors.join('; '));
const withoutInternalAudit = new Map(sources);
const internalAuditPaths = [...new Set(entries.flatMap(entry => entry.auditEvidence)
    .map(ref => ref.path).filter(file => file.startsWith('docs/internal/archive/')))];
for (const file of internalAuditPaths) withoutInternalAudit.delete(file);
assertEqual(internalAuditPaths.length, 4, 'Vier historische Entwürfe sind die lokalen Auditbelege');
const missingLocalAudit = validateSources(inventory, withoutInternalAudit, { requireInternalAudit: true });
assert(internalAuditPaths.every(file => missingLocalAudit.errors.some(error => error.includes('Datei fehlt: ' + file))), 'Jeder fehlende lokale Entwurf bleibt ein Quellenfehler');
assertEqual(validateSources(inventory, withoutInternalAudit, { requireInternalAudit: false }).ok, true, 'Öffentlicher Bestand bewahrt den Quellvertrag ohne lokale Entwürfe');
const missingPublicCode = new Map(withoutInternalAudit);
missingPublicCode.delete('app/balance/balance-renderer-summary.js');
assert(!validateSources(inventory, missingPublicCode, { requireInternalAudit: false }).ok, 'Auch im öffentlichen Bestand bleibt eine fehlende aktive Quelle ein Fehler');
const categories = entries.find(entry => entry.id === 'E01');
assert(categories.page === 'Ausgaben.html' && categories.selectors.dynamic.some(record => record.selector === '.expense-category' && record.status === 'geschützt'),
    'AU1: Kategorien besitzen den tatsächlichen neuen Host und einen geschützten Erzeuger');
const missingCategoryProducer = new Map(sources);
missingCategoryProducer.set('app/expenses/expenses-renderer.js', sources.get('app/expenses/expenses-renderer.js').replace("row.className = 'expense-category'", "row.className = 'entfernt'"));
assert(!validateSources(inventory, missingCategoryProducer).ok, 'AU1: Entfernte Kategorieerzeugung wird durch die Quellenprüfung erkannt');

// Verdichtete Belege müssen vor der wörtlichen Quellprüfung aufgelöst werden.
const referencedNodeProofs = [];
const collectNodeProofs = value => {
    if (Array.isArray(value)) value.forEach(collectNodeProofs);
    else if (value && typeof value === 'object') {
        if (value.path?.startsWith('tests/') && value.evidence?.startsWith('@')) referencedNodeProofs.push(value);
        Object.values(value).forEach(collectNodeProofs);
    }
};
collectNodeProofs(inventory.pages);
assert(referencedNodeProofs.length > 0, 'Textreferenzen in Node-Belegen werden ausdrücklich geprüft');
for (const proof of referencedNodeProofs) {
    const { evidence: literal } = resolveInventory({ definitions: inventory.definitions, evidence: proof.evidence });
    assert(!literal.startsWith('@') && sources.get(proof.path).includes(literal),
        `Aufgelöster Node-Beleg kommt wörtlich in ${proof.path} vor: ${proof.evidence}`);
}
const referencedProof = referencedNodeProofs[0];
const { evidence: referencedLiteral } = resolveInventory({ definitions: inventory.definitions, evidence: referencedProof.evidence });
const missingLiteralSources = new Map(sources);
missingLiteralSources.set(referencedProof.path, sources.get(referencedProof.path).replaceAll(referencedLiteral, 'entfernter Beleg'));
assert(validateSources(inventory, missingLiteralSources).errors.some(error =>
    error.includes('Testbeleg fehlt') && error.includes(referencedProof.path) && error.includes(referencedLiteral)),
    'Gate erkennt verlorenen wörtlichen Beleg auch hinter einer Textreferenz');
const focusInventory = entries.find(entry => entry.id === 'I01');
assert(focusInventory.storage.some(record => record.keys.includes('overview_month_provision_v1'))
    && focusInventory.selectors.dynamic.some(record => record.selector === '[data-overview-month]'), 'I01: Monatshaken besitzt expliziten Speicher- und Erzeugerbeleg');
for (const attribute of ['data-overview-month', 'data-overview-backup']) {
    const files = new Map(sources);
    const path = 'app/overview/overview-renderer.js';
    files.set(path, files.get(path).replace(new RegExp(attribute + '(?=[ >])', 'g'), attribute + '-entfernt'));
    const result = validateSources(inventory, files);
    assert(!result.ok && result.errors.some(error => error.includes('I01') && error.includes('[' + attribute + ']')), 'I01: isolierter Fokusanker-Verlust wird erkannt: ' + attribute);
}
for (const id of ['I02', 'I09']) {
    const entry = inventory.pages.flatMap(page => page.entries).find(entry => entry.id === id);
    assertEqual(entry.additionalOccurrences[0].canonicalId, id, `${id}: zusätzlicher Ort referenziert kanonische Kennung`);
    assert(markdown.includes(`**${id} → depot-tranchen-manager.html`), `${id}: Generator zeigt zusätzlichen Manager-Ort`);
}
for (const [name, change] of [
    ['Unbekannte Zusatzseite', place => { place.page = 'unbekannt.html'; }],
    ['Falsche kanonische Kennung', place => { place.canonicalId = 'I01'; }],
    ['Fehlende Zusatzbelege', place => { delete place.codeRefs; }],
    ['Fehlender dynamischer Zusatzhost', place => { place.selectors.dynamic[0].host = '#unbekannterHost'; }],
    ['Falscher Zusatzanker', place => { place.selectors.dynamic[0].anchor.attribute = 'falsch'; }]
]) {
    const copy = structuredClone(inventory);
    change(copy.pages[0].entries.find(entry => entry.id === 'I02').additionalOccurrences[0]);
    assertEqual(validateInventory(copy).ok, false, name);
}
{
    const copy = structuredClone(inventory), entry = copy.pages[0].entries.find(entry => entry.id === 'I02');
    entry.additionalOccurrences.push(structuredClone(entry.additionalOccurrences[0]));
    assertEqual(validateInventory(copy).ok, false, 'Doppelter Zusatzort wird abgewiesen');
}
{
    const files = new Map(sources);
    const module = 'app/tranches/tranchen-manager-profiles.js';
    files.set(module, files.get(module).replace('export function bindManagerProfileSwitch(', 'export function entfernteBindung('));
    assertEqual(validateSources(inventory, files).ok, false, 'Fehlende Zusatzfunktion wird am Erzeuger geprüft');
    strictAssert.throws(() => generateInventory(json, markdown, { check: true, files }), /Funktion fehlt/, 'Generator prüft zusätzliche Funktionsbindungen');
}
for (const entry of entries) for (const ref of entry.codeRefs) {
    assert(Array.isArray(ref.functions), entry.id + ': explizite Funktionsliste für ' + ref.path);
    assert(ref.functions.length > 0 || Boolean(ref.nonFunction?.reason.trim()), entry.id + ': Definitionen oder begründete Nicht-Funktionsklassifikation');
}
for (const [id, excluded] of [['B12', '#marketDataProvenance'],
    ['B15', '#dynamicFlexAdvancedToggleRow'], ['B16', '#dynamicFlexConfigGroup'], ['B18', '#threeBucketConfigGroup'],
    ['B20', '#balanceContractInputs'], ['B26', '#expensesCsvInput'], ['B26', 'td[data-month][data-profile]'],
    ['V09', '#clearTranchesBtn'], ['V12', '.tranche-row'], ['V22', '[data-cash-status]']]) {
    assert(!entries.find(entry => entry.id === id).codeRefs.find(ref => ref.binding === 'delegated').delegates.includes(excluded),
        id + ': direktes Nachbarcontrol oder passiver Container ist kein Delegationsfeld: ' + excluded);
}
for (const id of ['B06', 'B10', 'B11', 'B24']) {
    const baseline = inventory.baselineAudit.find(entry => entry.id === id);
    assertEqual(baseline.status, 'entfallen', `${id}: Entfall bleibt historisch belegt`);
    assertEqual(baseline.entryIds.length, 0, `${id}: kein entfallener aktueller Bedienbezug`);
    assert(!entries.some(entry => entry.id === id), `${id}: Altbedienung fehlt im aktuellen Inventar`);
    assert(markdown.includes(`**${id}:**`), `${id}: Generator zeigt die historische Entfallbegründung`);
}
assert(markdown.includes('### Entfallen auf Nutzerentscheid') && markdown.includes('Nutzerentscheid vom 05.10.2026.'), 'Generator erhält Entfallenabschnitt und Entscheidungsdatum aus der Baseline');
assertEqual(inventory.baselineAudit.length, 162, 'Alle 162 historischen Kennungen bleiben nachvollziehbar');
// Derselbe Assertionpfad wird unten mit einem lokalen Runnerkontext abgefangen.
const assertGate = (result, expected, name, assertion = assertEqual) =>
    assertion(result.ok, expected, name + (result.errors.length ? ': ' + result.errors.join('; ') : ''));
assertGate(checkInventorySizes(json, markdown), true, 'Bestand: tatsächliche UTF-8-Dateigrößen innerhalb beider inklusiven Grenzen');
assertGate(checkInventoryEntrySizes(inventory), true, 'Bestand: aufgelöste Einträge innerhalb der inklusiven Grenze');
assertEqual(checkInventoryReadability(json).ok, true, 'Bestand: lesbare Quelle mit ausgeschriebenen kritischen Feldern');
assertGate(checkInventorySizes(json + ' '.repeat(INVENTORY_SIZE_LIMITS.source), markdown), false, 'Bestand: synthetische Quellübergröße scheitert');
assertGate(checkInventorySizes(json, markdown + ' '.repeat(INVENTORY_SIZE_LIMITS.markdown)), false, 'Bestand: synthetische Lesefassungsübergröße scheitert');
assertGate(checkMarkdown(inventory, markdown, renderInventory), true, 'Bestand: Lesefassung exakt aktuell');
assertGate(checkMarkdown(inventory, markdown + '\n', renderInventory), false, 'Bestand: veraltete Lesefassung scheitert');
assertEqual(inventory.sourceRevision, '0e39685f2d01c4964e2f64c9bbad69e22afea4a1',
    'sourceRevision ist die dauerhafte Anwendungscode-Basis, unabhängig von Live-Git');
assert(!entries.some(entry => entry.initialStates.some(state => state.reason === 'Statischer Host oder Control bleibt erhalten.')),
    'Kein Ausgangszustand verwendet den alten Vorlagensatz');
const i02 = entries.find(entry => entry.id === 'I02');
assert(i02.initialStates.some(state => state.kind === 'sichtbar' && state.selectors.includes('#overviewHousehold'))
    && i02.coverage.node.some(ref => ref.path === 'tests/tranchen-manager-profiles.test.mjs'),
    'I02: Haushaltspille und geschützter Managerwechsel ersetzen den entfernten Profilselect');
assert(i02.coverage.node.some(ref => ref.path === 'tests/profile-ui-contract.test.mjs' && ref.evidence.includes('Sofortiger Reload')),
    'I02: dauerhafte Profilbestätigung hat eigenen Handler-/Reloadbeleg');
for (const id of ['V05', 'V06', 'V14', 'V18', 'V21']) {
    assert(entries.find(entry => entry.id === id).coverage.node.some(ref => ref.path === 'tests/designsystem-selection-text.test.mjs'),
        `${id}: Managerauswahl hat Kürzungs-/Resetbeleg`);
}
const i10 = entries.find(entry => entry.id === 'I10');
assertEqual(i10.coverage.gaps.map(gap => gap.package).join(','), '2',
    'I10: Nachweislücke für Paket 1 geschlossen; gemeinsamer Rahmen bleibt Paket 2');
assert(i10.coverage.node.some(ref => ref.path === 'tests/designsystem-start-handbook.test.mjs'
    && ref.evidence === 'I10: Quarantänehinweis wird vollständig dargestellt'),
    'I10: tatsächlicher Recoveryrenderer hat konkreten Node-Nachweis');
assert(i10.coverage.browser.some(ref => ref.name === 'Designsystem recovery banner'),
    'I10: registrierter Browserfall belegt Quarantäne, Dateiwahl, Schließen und Reload');
const v15 = entries.find(entry => entry.id === 'V15');
assert(v15.target.firstPackage === '5' && v15.coverage.gaps.some(gap =>
    gap.package === '5' && ['Rückfokus', 'Zeilenbutton', 'F-06'].every(fragment => gap.evidence.includes(fragment))),
    'V15 erhält späteres Cashziel sowie Rückfokus-/F-06-Nachweis');
assertEqual([...resolved.baselineAudit.map(item => item.id)].sort().join(','), [...BASELINE_IDS].sort().join(','),
    'Historisches Ausgangsregister stimmt mit der unabhängigen Kennungsmenge überein');
assertEqual(resolved.packageOrder.join(','), PACKAGE_ORDER.join(','), 'Konzept-v3-Reihenfolge verbindlich');
const counts = protectionCounts(inventory);
for (const status of DYNAMIC_STATUSES) assertEqual(counts[status],
    entries.flatMap(entry => [...entry.selectors.dynamic, ...(entry.additionalOccurrences || []).flatMap(place => place.selectors.dynamic)]).filter(record => record.status === status).length,
    `${status}: aus tatsächlichen Belegen berechnete Schutzkategorie`);
assertEqual(Object.values(counts).reduce((a, b) => a + b, 0), entries.flatMap(entry => [...entry.selectors.dynamic, ...(entry.additionalOccurrences || []).flatMap(place => place.selectors.dynamic)]).length,
    'Summe aller Schutzkategorien entspricht der tatsächlichen Belegmenge');
assert(!json.includes('sourceSnippet'), 'Kein Ausschnittfeld in Quelle oder Definitionen');
assert(!json.includes('6.2a'), 'Kein alter 6.2a-Paketbezug');
for (const id of ['V08', 'V09', 'V13', 'V14', 'V15', 'V23']) {
    assertEqual(entries.find(e => e.id === id).target.firstPackage, '5', `${id}: korrigierte erste Paketzuordnung`);
}
assert(entries.find(e => e.id === 'B42').coverage.gaps.some(g => g.kind === 'Testschuld' && g.evidence.includes('Telemetrie') || g.kind === 'Testschuld' && g.evidence.includes('worker-telemetry')), 'B42-Telemetrie ausdrücklich als Testschuld');
assert(entries.find(e => e.id === 'B42').coverage.gaps.some(g => g.kind === 'Änderungsrisiko' && g.package === '2'), 'B42-Kontext-/Druckumbau getrennt von Telemetrieschuld');
for (const entry of entries) for (const dynamic of entry.selectors.dynamic) {
    assertEqual(validateAnchorEvidence(dynamic, sources, { id: entry.id, page: entry.page }).ok, true, `${entry.id}: Einzelprüfung ${dynamic.selector} (${dynamic.status})`);
    if (dynamic.status === DYNAMIC_STATUSES[1]) assert(entry.coverage.gaps.some(gap => gap.kind === 'Änderungsrisiko' && gap.selector === dynamic.selector), `${entry.id}: fehlender Anker mit konkretem Änderungsrisiko`);
}
const assertOverview = (source, rendered, name) => {
    const ids = resolveInventory(source).pages.flatMap(page => page.entries).map(entry => entry.id);
    const rows = rendered.split('\n').filter(line => line.startsWith('| ') && !line.startsWith('| Kennung |')).map(line => line.split(' | ')[0].slice(2));
    assertEqual(rows.join(','), ids.join(','), name + ': genau eine Übersichtszeile pro tatsächlicher Kennung');
    assert(rendered.includes(`${ids.length} Funktionseinträge;`), name + ': Übersichtszahl aus Inventar');
    const stats = protectionCounts(source);
    for (const status of DYNAMIC_STATUSES) assert(rendered.includes(`${status}: **${stats[status]}**`), name + ': Schutzstatistik ' + status);
};
assertOverview(inventory, markdown, 'Bestand');
for (const text of ['Seite | Bereich | Bezeichnung | Zustand | Speicherwirkung | Testabdeckung | Paket', '### Änderungsrisiko', '### Testschuld', '### Prüfergrenzen', '### Befunde außerhalb des Inventars']) assert(markdown.includes(text), 'Lesefassung enthält ' + text);
for (const page of resolved.pages) for (const label of ['Tastatur', 'Druck', 'Meldungen', 'Dialoge', 'Handbuchanker']) {
    const section = markdown.split(`Quelle: \`${page.path}\`\n`)[1].split('\n### ')[0];
    assert(section.includes(`**${label}:**`), `${page.path}: vollständiger Zusatz ${label}`);
}
assert(!markdown.includes('Geordnete Schritte') && !markdown.includes('```'), 'Lesefassung druckt weder Detailprüffälle noch Codekörper ab');

// Voll expandierte Mutationsdaten erhalten wörtliche @-Texte durch das Escape.
const literalSource = value => typeof value === 'string' ? value.startsWith('@') ? '@' + value : value
    : Array.isArray(value) ? value.map(literalSource)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, literalSource(item)])) : value;

// Reale Kontroll-/Verlustpaare; nur injizierte Quellen beziehungsweise Belege ändern.
const realEvidence = (id, selector) => entries.find(entry => entry.id === id).selectors.dynamic.find(record => record.selector === selector);
const realLoss = (id, selector, change) => {
    const record = realEvidence(id, selector), files = new Map(sources);
    const control = validateSources(inventory, files);
    assertEqual(control.ok, true, id + ': vollständige SOURCE-Kontrolle: ' + control.errors.join('; '));
    assertEqual(validateAnchorEvidence(record, files, { id, page: entries.find(entry => entry.id === id).page }).ok, true,
        id + ': gültiger eigener Elementnachweis');
    const before = files.get(record.producer.module), after = change(before);
    assert(before !== after, id + ': isolierte Mutation hat eine Schreibstelle geändert');
    files.set(record.producer.module, after);
    const result = validateSources(inventory, files);
    assertEqual(result.ok, false, id + ': isolierter Erzeugungsverlust');
    assert(result.errors.some(error => [id, entries.find(entry => entry.id === id).page, selector,
        record.producer.module, 'Anker-Erzeugung'].every(part => error.includes(part))), id + ': zusammenhängende Erzeugungsdiagnose');
};
const importSelector = '.recovery-actions button.profile-button.ds-button-primary';
realLoss('I10', importSelector, source => {
    const begin = source.indexOf("    const importButton = doc.createElement('button');");
    const end = source.indexOf("    const dismissButton = doc.createElement('button');", begin);
    assert(begin >= 0 && end > begin, 'I10: Import-Erzeugungsblock ist isoliert vorhanden');
    const after = (source.slice(0, begin) + source.slice(end)).replace('actions.appendChild(importButton); ', '');
    assert(after.includes('actions.appendChild(dismissButton)'), 'I10: Schließen behält seinen eigenen Anfügeort');
    assertEqual(validateAnchorEvidence(realEvidence('I10', '.recovery-actions button.secondary'),
        new Map([['app/overview/overview-renderer.js', after]]), { id: 'I10', page: 'index.html' }).ok, true, 'I10: Schließen bleibt geschützt');
    return after;
});
realLoss('I09', '[data-profile-recovery]', source => {
    const marker = '    statusEl.dataset.profileRecovery = recovery.status;';
    assertEqual(source.split(marker).length, 2, 'I09: genau ein Recovery-Marker');
    const after = source.replace(marker, '');
    assert(after.includes("statusEl.dataset.kind = 'error';"), 'I09: data-kind=error bleibt vorhanden');
    return after;
});
realLoss('B26', 'td[data-month][data-profile]', source => {
    const marker = 'td.dataset.month = String(m);';
    assertEqual(source.split(marker).length, 2, 'B26: genau eine Zellenzuweisung');
    const after = source.replace(marker, 'td.dataset.otherMonth = String(m);');
    const buttons = text => [...text.matchAll(/const (?:importBtn|detailBtn|deleteBtn) = doc\.createElement\('button'\);[\s\S]*?(?=\n\s*const |\n\s*actions\.append)/g)].map(match => match[0]);
    assertEqual(buttons(source).length, 3, 'B26: alle drei Aktionsknopfblöcke erfasst');
    assertEqual(JSON.stringify(buttons(after)), JSON.stringify(buttons(source)), 'B26: Aktionsknöpfe samt Monats-/Profilattributen bytegleich');
    return after;
});
const s03Copy = literalSource(structuredClone(resolved));
assertEqual(validateSources(s03Copy, sources).ok, true, 'S03: vollständige gültige Belegkontrolle');
const s03Field = s03Copy.pages.flatMap(page => page.entries).find(entry => entry.id === 'S03').selectors.dynamic[0];
s03Field.anchor = { kind: 'class', value: 'profilverbund-profile-row' };
assertEqual(validateInventory(s03Copy).ok, true, 'S03: Fremdankerprobe bleibt strukturell gültig');
const s03Loss = validateSources(s03Copy, sources);
assertEqual(s03Loss.ok, false, 'S03: fremde Labelklasse ersetzt keinen eigenen Feldanker');
assert(s03Loss.errors.some(error => ['S03', 'Simulator.html', 'input[data-profile-id]', s03Field.producer.module,
    'Anker-Erzeugung'].every(part => error.includes(part))), 'S03: Feldselektor und Erzeugermodul in derselben Diagnose');

for (const [id, selector, expectedStatus] of [
    ['I09', '[data-profile-recovery]', DYNAMIC_STATUSES[0]], ['I10', importSelector, DYNAMIC_STATUSES[0]],
    ['B26', 'td[data-month][data-profile]', DYNAMIC_STATUSES[0]], ['B26', '[data-month-total]', DYNAMIC_STATUSES[0]],
    ['B46', '[id^="balance-action-error-text-"]', DYNAMIC_STATUSES[0]], ['S60', 'svg', DYNAMIC_STATUSES[0]],
    ['S66', '[id^="ao_param_"]', DYNAMIC_STATUSES[0]], ['V24', 'button[title][aria-label]', DYNAMIC_STATUSES[0]],
    ['B03', 'input[data-profile-id]', DYNAMIC_STATUSES[0]], ['S03', 'input[data-profile-id]', DYNAMIC_STATUSES[0]],
    ['B28', '[data-action]', DYNAMIC_STATUSES[0]], ['S69', '[data-auto-optimize-model-warning]', DYNAMIC_STATUSES[0]],
    ['S69', '[data-auto-optimize-model-status]', DYNAMIC_STATUSES[0]], ['V01', '[data-profile-id]', DYNAMIC_STATUSES[0]],
    ['V22', '[data-cash-status]', DYNAMIC_STATUSES[0]], ['V22', '[data-target-action-id]', DYNAMIC_STATUSES[2]]
]) {
    const record = realEvidence(id, selector);
    assertEqual(record.status, expectedStatus, id + ': begründete Einstufung ' + selector);
    assertEqual(validateAnchorEvidence(record, sources, { id, page: entries.find(entry => entry.id === id).page }).ok, true,
        id + ': tatsächlicher SOURCE-Beleg ' + selector);
}
for (const [id, selector, className] of [['S60', 'svg', 'heatmap-v4-svg'], ['V24', 'button[title][aria-label]', 'icon-action']]) {
    assertEqual(realEvidence(id, selector).anchor.value, className, id + ': eigener Klassenanker am passenden Element');
}

// Prüfkopien werden lesbar serialisiert, ohne Pretty-Printing aller einzelnen
// Textlisten; sonst würde die Testformatierung selbst das Bytebudget verbrauchen.
const readableSource = (value, depth = 0, field = '') => {
    const compact = JSON.stringify(value);
    const force = depth === 0 || ['pages', 'entries', 'definitions'].includes(field);
    if (!force && [...compact].length + depth * 2 <= 1800) return compact;
    const pad = '  '.repeat(depth), indent = pad + '  ';
    if (Array.isArray(value)) return '[\n' + value.map(item => indent + readableSource(item, depth + 1)).join(',\n') + '\n' + pad + ']';
    if (value && typeof value === 'object') return '{\n' + Object.entries(value).map(([key, item]) =>
        indent + JSON.stringify(key) + ': ' + readableSource(item, depth + 1, key)).join(',\n') + '\n' + pad + '}';
    return compact;
};

const { createAssertionContext } = await import('./run-tests.mjs');

// Echte Runner-Assertions, jedoch mit isolierten Zählern und abgefangener Ausgabe.
const sameLengthStale = markdown.replace('Funktionsinventar', 'Funktionsinventaz');
const runnerOversized = structuredClone(inventory);
runnerOversized.pages[0].entries[0].label = 'a'.repeat(INVENTORY_SIZE_LIMITS.entry);
const runnerEntryBytes = Buffer.byteLength(JSON.stringify(resolveInventory(runnerOversized).pages[0].entries[0]));
for (const [name, result, fragments] of [
    ['Quellübergröße', checkInventorySizes('a'.repeat(INVENTORY_SIZE_LIMITS.source + 1), ''),
        ['1500001 B', '1500000 B', 'Quelle pflegen', 'Neu-Erzeugung allein', 'node tests/funktionsinventar-contract.mjs --check']],
    ['Markdownübergröße', checkInventorySizes('', 'a'.repeat(INVENTORY_SIZE_LIMITS.markdown + 1)),
        ['225001 B', '225000 B', GENERATE_INVENTORY_COMMAND, '--check']],
    ['Aufgelöste Eintragsübergröße', checkInventoryEntrySizes(runnerOversized),
        ['I01', 'index.html', runnerEntryBytes + ' B', '20000 B', 'pflegen', 'Neu-Erzeugung allein', 'node tests/funktionsinventar-contract.mjs --check']],
    ['Gleichlange veraltete Lesefassung', checkMarkdown(inventory, sameLengthStale, renderInventory),
        ['Ist: ' + Buffer.byteLength(sameLengthStale) + ' B', 'erwartet: ' + Buffer.byteLength(markdown) + ' B', GENERATE_INVENTORY_COMMAND]],
    ['Fehlende Lesefassung', checkMarkdown(inventory, undefined, renderInventory),
        ['Ist: Datei fehlt', 'erwartet: ' + Buffer.byteLength(markdown) + ' B', GENERATE_INVENTORY_COMMAND]]
]) {
    const localRunner = createAssertionContext();
    const output = [];
    const originalError = console.error;
    try {
        console.error = message => output.push(String(message));
        strictAssert.throws(() => assertGate(result, true, name, localRunner.assertEqual),
            error => error.isTestAssertionError === true && fragments.every(fragment => error.message.includes(fragment)),
            name + ': Runnerfehler enthält die vollständige Vertragsdiagnose');
    } finally { console.error = originalError; }
    assertEqual(localRunner.counters.failedAssertions, 1, name + ': genau eine isolierte Runner-Fehlassertion');
    assert(output.some(line => fragments.every(fragment => line.includes(fragment))), name + ': auch ausgegebene Runnerdiagnose vollständig');
}
assertEqual(Buffer.byteLength(sameLengthStale), Buffer.byteLength(markdown), 'Runnerprobe ändert Inhalt bei gleicher Bytezahl');

// Gültige Folgeänderungen gegen injizierte SOURCE-Kopien, ohne reviewed-Ausweichmodus.
const assertFollowUp = (copy, files, name) => {
    const schema = validateInventory(copy);
    assertEqual(schema.ok, true, name + ': normaler Vertrag: ' + schema.errors.join('; '));
    const sourceResult = validateSources(copy, files);
    assertEqual(sourceResult.ok, true, name + ': SOURCE: ' + sourceResult.errors.join('; '));
    const rendered = renderInventory(copy);
    assertEqual(checkMarkdown(copy, rendered, renderInventory).ok, true, name + ': aktuelle Lesefassung');
    assertEqual(generateInventory(readableSource(copy), rendered, { check: true }), rendered, name + ': Generatorcheck');
    assertOverview(copy, rendered, name);
};
// Bekannte Paketnummer, aber falscher Eintragsbezug: allein das Mitgliedschaftsgate greift.
const packageControl = structuredClone(inventory);
const packageEntry = packageControl.pages[0].entries.find(entry => entry.id === 'I01');
packageEntry.coverage.gaps[0].package = packageEntry.target.laterPackages[0];
assertFollowUp(packageControl, sources, 'Gültiges späteres Lückenpaket am vollständigen Bestand');
const foreignPackage = structuredClone(packageControl);
foreignPackage.pages[0].entries.find(entry => entry.id === 'I01').coverage.gaps[0].package = '2';
const foreignResult = validateInventory(foreignPackage);
assertEqual(foreignResult.ok, false, 'Eintragsfremdes bekanntes Lückenpaket scheitert');
assertEqual(foreignResult.errors.length, 1, 'Paketprobe scheitert ausschließlich am Mitgliedschaftsgate');
assert(['I01', 'index.html', 'Lückenpaket 2', 'Zielpaketen: 1, 6.3'].every(fragment => foreignResult.errors[0].includes(fragment)),
    'Mitgliedschaftsdiagnose nennt Eintrag, Seite, Paket und Zielpaketsatz');
const extended = structuredClone(inventory);
const newEntry = literalSource(structuredClone(entries[0]));
Object.assign(newEntry, {
    id: 'I100', section: 'Synthetische Folgefunktion', label: 'Neue Auswahl',
    selectors: { static: [], dynamic: [{ selector: '#stable', status: 'geschützt', producer, anchor }] },
    codeRefs: [{ path: module, function: 'build', functions: ['build'], binding: 'direct', events: ['click'], reason: 'Lokale Auswahl erzeugen.' }],
    initialStates: [{ selectors: ['#stable'], kind: 'sichtbar', condition: 'Nach Aufbau.', reason: 'Erzeugte Auswahl.' }],
    checks: [{ name: 'Neue Auswahl bedienen', preconditions: ['Seite ist aufgebaut.'], steps: ['Auswahl anklicken.'], expected: 'Auswahl bleibt erreichbar.' }],
    auditEvidence: [{ path: module, location: 'build', observation: 'Erzeugt die Auswahl mit stabilem Anker.' }],
    coverage: { node: [], browser: [], gaps: [{ kind: 'Testschuld', package: '1', evidence: 'Synthetischer Prüffall.', reason: 'Bediennachweis noch offen.' }] }
});
extended.pages[0].entries.push(newEntry);
const extendedFiles = new Map(sources);
extendedFiles.set(module, `function build() { ${creation} }`);
assertFollowUp(extended, extendedFiles, 'Neue vollständig integrierte Funktion I100');

// Funktionsdefinitionen: gleicher Tokenleser, ohne Erweiterung des Erzeugerortvertrags.
const functionForms = [
    ['declaration', 'export async function declaration() {}'],
    ['assigned', 'const assigned = async function privateName() {};'],
    ['privateName', 'const assigned = async function privateName() {};'],
    ['blockArrow', 'const blockArrow = async () => {};'],
    ['expressionArrow', 'const expressionArrow = () => 1;'],
    ['singleArrow', 'const singleArrow = input => input;'],
    ['objectMethod', 'const object = { async objectMethod() {} };'],
    ['classMethod', 'class Example { static async classMethod() {} }'],
    ['getter', 'class Example { get getter() { return 1; } }'],
    ['setter', 'class Example { set setter(value) {} }'],
    ['nested', 'function outer() { function nested() {} }'],
    ['local', 'import { remote as local } from "./other.js";'],
    ['defaultLocal', 'import defaultLocal from "./other.js";'],
    ['namedLocal', 'import { namedLocal } from "./other.js";'],
    ['namespaceLocal', 'import * as namespaceLocal from "./other.js";'],
    ['propertyFunction', 'window.propertyFunction = function () {};'],
    ['propertyArrow', 'const object = { propertyArrow: value => value };']
];
for (const [name, source] of functionForms) assert(functionBindings(source, module).has(name), 'Definitionsform: ' + name);
for (const source of ['// function handler() {}', 'const text = "function handler() {}";',
    'const text = `function handler() {}`;', 'const pattern = /function handler/;',
    'handler();', 'object.handler();', 'import("handler");', 'export { handler };']) {
    assertEqual(functionBindings(source, module).has('handler'), false, 'Kein Definitionsnachweis: ' + source);
}
assertEqual(functionBindings('import { remote as local } from "./other.js";', module).has('remote'), false,
    'Importalias beweist ausschließlich die lokale Bindung');
for (const origin of ['inline-module', 'inline-classic']) {
    const type = origin === 'inline-module' ? ' type="module"' : '';
    assert(functionBindings(`<script${type}>function handler() {}</script>`, 'index.html', origin).has('handler'),
        'Echte HTML-Definition mit ausdrücklicher Herkunft ' + origin);
    for (const html of [`<!-- <script${type}>function handler() {}</script> -->`,
        `<script${type} src="handler.js">function handler() {}</script>`,
        `<script${type}>// function handler() {}\nhandler(); const text = "handler";</script>`,
        '<script type="application/json">{"handler":"function handler() {}"}</script>']) {
        assertEqual(functionBindings(html, 'index.html', origin).has('handler'), false, 'Kein HTML-Definitionsnachweis: ' + origin + ' ' + html);
    }
}
assertEqual(functionBindings('<script>function handler() {}</script>', 'index.html', 'inline-module').has('handler'), false,
    'Klassisches Skript beweist keine Inline-Moduldefinition');
assertEqual(functionBindings('<script type="module">function handler() {}</script>', 'index.html', 'inline-classic').has('handler'), false,
    'Modulskript beweist keine klassische Herkunft');

const proofModule = 'app/function-proof.js';
const functionCopy = structuredClone(extended);
const proofEntry = functionCopy.pages[0].entries.at(-1);
const proofRef = { path: proofModule, function: 'handler / second / handler / DOMContentLoaded', functions: ['handler', 'second'],
    binding: 'none', events: [], reason: 'Gemischte Beschreibung mit zwei benannten Definitionen und anonymem Ereignisanteil.' };
proofEntry.codeRefs.push(proofRef);
const proofFiles = new Map(extendedFiles);
proofFiles.set(proofModule, 'function handler() {} const second = value => value;');
assertFollowUp(functionCopy, proofFiles, 'Mehrnamige gemischte Funktionskontrolle');
const assertSourceFailure = (copy, files, name, fragments) => {
    const result = validateSources(copy, files);
    assertEqual(result.ok, false, name);
    assert(result.errors.some(error => fragments.every(fragment => error.includes(fragment))), name + ': gezielte Diagnose ' + fragments.join(', '));
};
const renamedProof = new Map(proofFiles);
renamedProof.set(proofModule, 'function renamedHandler() {} const second = value => value; // handler\nconst text = "handler"; handler();');
assertSourceFailure(functionCopy, renamedProof, 'Handlerverlust trotz Kommentar, String und Aufruf', ['I100', 'index.html', proofModule, 'handler', 'Funktion fehlt']);
const consistentProof = structuredClone(functionCopy);
const consistentRef = consistentProof.pages[0].entries.at(-1).codeRefs.at(-1);
consistentRef.function = consistentRef.function.replaceAll('handler', 'renamedHandler');
consistentRef.functions[0] = 'renamedHandler';
assertFollowUp(consistentProof, renamedProof, 'Konsistente Quellen-/Funktionsumbenennung');
const lostSecond = new Map(proofFiles);
lostSecond.set(proofModule, 'function handler() {} const other = value => value; second();');
assertSourceFailure(functionCopy, lostSecond, 'Zweiter Name einer mehrnamigen Beschreibung fehlt', ['I100', 'index.html', proofModule, 'second', 'Funktion fehlt']);
const omittedSecond = structuredClone(functionCopy);
omittedSecond.pages[0].entries.at(-1).codeRefs.at(-1).functions.pop();
assertSourceFailure(omittedSecond, proofFiles, 'Metadaten vergessen zweiten Namen', ['I100', 'index.html', proofModule, 'second', 'nicht zugeordnet']);
const hiddenHandlers = structuredClone(functionCopy);
Object.assign(hiddenHandlers.pages[0].entries.at(-1).codeRefs.at(-1), {
    functions: [], nonFunction: { kind: 'anonymous-event', reason: 'Synthetische missbräuchliche Ausnahme.' }
});
assertSourceFailure(hiddenHandlers, proofFiles, 'Nicht-Funktionsausnahme verdeckt keine benannten Handler', ['I100', 'index.html', proofModule, 'handler', 'nicht zugeordnet']);
const allFormsCopy = structuredClone(functionCopy);
const allFormsRef = allFormsCopy.pages[0].entries.at(-1).codeRefs.at(-1);
allFormsRef.function = [...new Set(functionForms.map(([name]) => name))].join(' / ');
allFormsRef.functions = [...new Set(functionForms.map(([name]) => name))];
const allFormsFiles = new Map(proofFiles);
allFormsFiles.set(proofModule, [...new Set(functionForms.map(([, source]) => source))]
    .map(source => source.startsWith('import ') ? source : `{ ${source.replace(/^export /, '')} }`).join('\n'));
// Isolierte Formen statt Ausführung: der statische Leser prüft weder Laufzeittypen noch Körperidentität.
assertFollowUp(allFormsCopy, allFormsFiles, 'Alle Definitionsformen im normalen Quellenvertrag');

for (const origin of ['inline-module', 'inline-classic']) {
    const copy = structuredClone(functionCopy);
    const ref = copy.pages[0].entries.at(-1).codeRefs.at(-1);
    Object.assign(ref, { path: 'index.html', function: 'inlineHandler / inlineSecond', functions: ['inlineHandler', 'inlineSecond'], functionOrigin: origin });
    const files = new Map(extendedFiles);
    const type = origin === 'inline-module' ? ' type="module"' : '';
    const appended = `<script${type}>function inlineHandler() {} const inlineSecond = input => input;</script></body>`;
    files.set('index.html', sources.get('index.html').replace('</body>', appended));
    assertFollowUp(copy, files, 'HTML-Funktionskontrolle im normalen Vertrag: ' + origin);
    const renamedFiles = new Map(files);
    renamedFiles.set('index.html', files.get('index.html').replace('function inlineHandler()', 'function inlineRenamed()')
        .replace('const inlineSecond =', '/* inlineHandler */ const old = "inlineHandler"; inlineHandler(); const inlineSecond ='));
    assertSourceFailure(copy, renamedFiles, 'HTML-Definitionsverlust: ' + origin, ['I100', 'index.html', 'inlineHandler', 'Funktion fehlt', origin]);
    const renamedCopy = structuredClone(copy);
    const renamedRef = renamedCopy.pages[0].entries.at(-1).codeRefs.at(-1);
    renamedRef.function = renamedRef.function.replace('inlineHandler', 'inlineRenamed');
    renamedRef.functions[0] = 'inlineRenamed';
    assertFollowUp(renamedCopy, renamedFiles, 'Konsistente HTML-Funktionsumbenennung: ' + origin);
    const wrongOrigin = structuredClone(copy);
    wrongOrigin.pages[0].entries.at(-1).codeRefs.at(-1).functionOrigin = origin === 'inline-module' ? 'inline-classic' : 'inline-module';
    assertSourceFailure(wrongOrigin, files, 'Falsche HTML-Herkunft: ' + origin, ['I100', 'index.html', 'inlineHandler', 'Funktion fehlt']);
    const wrongPage = structuredClone(copy);
    wrongPage.pages[0].entries.at(-1).codeRefs.at(-1).path = 'Handbuch.html';
    assertSourceFailure(wrongPage, files, 'Fremde HTML-Seite: ' + origin, ['I100', 'index.html', 'dieselbe Seite']);
}

// Reale Handler: nur die Definition ändern, alten Namen in drei Scheinbelegen erhalten.
for (const [id, file, name, before, after] of [
    ['B13', 'app/balance/balance-binder.js', 'handleFormInput', '    handleFormInput(e) {', '    renamedFormInput(e) {'],
    ['H02', 'app/handbook/handbook.js', 'searchChapters', 'function searchChapters(records, query)', 'function renamedSearch(records, query)'],
    ['H03', 'app/handbook/handbook.js', 'initHandbook', 'function initHandbook(doc =', 'function renamedInitHandbook(doc ='],
    ['S02', 'app/simulator/simulator-assumptions-ui.js', 'refreshAssumptionFillStatus', 'function refreshAssumptionFillStatus(', 'function renamedAssumptionFillStatus('],
    ['S70', 'Simulator.html', 'initializeUnifiedTooltips', 'function initializeUnifiedTooltips()', 'function renamedUnifiedTooltips()']
]) {
    const ref = entries.find(entry => entry.id === id).codeRefs.find(ref => ref.functions.includes(name));
    assert(ref !== undefined, id + ': konkrete Funktion ist inventarisiert');
    const original = sources.get(file);
    assertEqual(original.split(before).length, 2, id + ': isolierte eindeutige Definitionsmutation');
    const files = new Map(sources);
    let changed = original.replace(before, after);
    const decoys = `\n// ${name}\nconst oldNameProof = "${name}"; ${name}();\n`;
    changed = file.endsWith('.html') ? changed.replace('</body>', `<script>${decoys}</script></body>`) : changed + decoys;
    files.set(file, changed);
    assertSourceFailure(inventory, files, id + ': reale Handlerumbenennung', [id, entries.find(entry => entry.id === id).page, file, name, 'Funktion fehlt']);
}

// Ereignisfelder statt Hosts/Ergebnisfelder: jeder tatsächliche Treffer zählt.
const delegationPage = { path: 'Balance.html', entries: [{ selectors: { static: ['.form-column', '#field'], dynamic: [] } }] };
const delegationRef = { ancestor: '.form-column', delegates: ['#field'] };
for (const html of ['<div class="form-column"><input id="field"></div>',
    '<div class="form-column"><section><input id="field"></section></div>',
    '<div class="form-column"><input id="field"></div><div class="form-column"><input id="field"></div>']) {
    assertEqual(validateDelegation(delegationRef, delegationPage, tokenizeHTML(html), 'B13').ok, true, 'Statische Delegationskontrolle: ' + html);
}
for (const html of ['<div class="form-column"></div><input id="field">',
    '<div class="form-column"><input id="field"></div><input id="field">']) {
    const result = validateDelegation(delegationRef, delegationPage, tokenizeHTML(html), 'B13');
    assertEqual(result.ok, false, 'Ausgelagerte Feldkopie scheitert: ' + html);
    assert(result.errors.some(error => ['B13', 'Balance.html', '#field', '.form-column', 'Delegation'].every(fragment => error.includes(fragment))),
        'Delegationsdiagnose nennt Kennung, Seite, Feld und Host');
}
const dynamicPage = { path: 'Balance.html', entries: [{ selectors: { static: ['#host'], dynamic: [
    { selector: '#nested', host: '#host' }, { selector: '[data-field]', host: '#nested' }
] } }] };
const dynamicRef = { ancestor: '#host', delegates: ['[data-field]'] };
const emptyHost = tokenizeHTML('<div id="host"></div>');
assertEqual(validateDelegation(dynamicRef, dynamicPage, emptyHost, 'B13').ok, true, 'Dynamische Hostkette ohne initiales Feld');
for (const change of [page => { delete page.entries[0].selectors.dynamic[1].host; },
    page => { page.entries[0].selectors.dynamic[1].host = '#foreign'; },
    page => { page.entries[0].selectors.dynamic[0].host = '[data-field]'; },
    page => { page.entries[0].selectors.dynamic = []; }]) {
    const copy = structuredClone(dynamicPage); change(copy);
    const result = validateDelegation(dynamicRef, copy, emptyHost, 'B13');
    assertEqual(result.ok, false, 'Fehlende, fremde oder zyklische dynamische Zuordnung');
    assert(result.errors.some(error => ['B13', 'Balance.html', '[data-field]', '#host', 'Delegation'].every(fragment => error.includes(fragment))),
        'Dynamische Delegationsdiagnose enthält vollständigen Bezug');
}
const getRef = (copy, id) => copy.pages.flatMap(page => page.entries).find(entry => entry.id === id).codeRefs.find(ref => ref.binding === 'delegated');
for (const [name, change, fragment] of [
    ['fehlende Liste', ref => { delete ref.delegates; }, 'delegates'],
    ['leere Liste', ref => { ref.delegates = []; }, 'delegates'],
    ['doppelte Liste', ref => { ref.delegates.push(ref.delegates[0]); }, 'Doppelte Delegationsfelder'],
    ['Host als Feld', ref => { ref.delegates = [ref.ancestor]; }, 'Host ist kein Ereignisfeld'],
    ['unbekanntes Feld', ref => { ref.delegates = ['#foreign']; }, 'Feldbeleg fehlt']
]) {
    const copy = structuredClone(inventory); change(getRef(copy, 'B13'));
    assertSourceFailure(copy, sources, 'Delegationsmetadaten: ' + name, ['B13', 'Balance.html', fragment]);
}
for (const [name, change, fragment] of [
    ['fehlende Funktionsliste', ref => { delete ref.functions; }, 'functions'],
    ['doppelte Funktionsnamen', ref => { ref.functions.push(ref.functions[0]); }, 'Doppelte Funktionsnamen'],
    ['Satz statt Namen', ref => { ref.functions = ['handleFormInput / handleFormChange']; }, 'Einzelner Funktionsname'],
    ['fehlende Ausnahmebegründung', ref => { ref.functions = []; ref.nonFunction = { kind: 'anonymous-event' }; }, 'nonFunction.reason'],
    ['gemischte Ausnahme', ref => { ref.nonFunction = { kind: 'anonymous-event', reason: 'Unzulässige Pauschalausnahme.' }; }, 'Nicht-Funktionsausnahme']
]) {
    const copy = structuredClone(inventory); change(getRef(copy, 'B13'));
    assertSourceFailure(copy, sources, 'Funktionsmetadaten: ' + name, ['B13', 'Balance.html', fragment]);
}

const balanceSource = sources.get('Balance.html');
const moveFields = (html, ids, target, inside = false) => {
    const controls = [];
    for (const id of ids) {
        const pattern = new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`, 'g');
        const matches = [...html.matchAll(pattern)];
        assertEqual(matches.length, 1, 'Ein eindeutiges Originalfeld für Verlagerung: ' + id);
        controls.push(matches[0][0]); html = html.replace(pattern, '');
    }
    return html.replace(target, inside ? target + controls.join('\n') : controls.join('\n') + target);
};
const movedIds = ['floorBedarf', 'flexBedarf', 'minimumFlexAnnual', 'endeVJ', 'flexBudgetAnnual'];
const insideFiles = new Map(sources);
insideFiles.set('Balance.html', moveFields(balanceSource, movedIds, '<div class="form-column panel">', true));
assertFollowUp(inventory, insideFiles, 'Positiver Formularumbau innerhalb des Delegationshosts');
const outsideFiles = new Map(sources);
outsideFiles.set('Balance.html', moveFields(balanceSource, movedIds, '</body>'));
for (const [id, field] of [['B13', '#floorBedarf'], ['B13', '#flexBedarf'], ['B13', '#minimumFlexAnnual'], ['B12', '#endeVJ'], ['B14', '#flexBudgetAnnual']]) {
    assertSourceFailure(inventory, outsideFiles, 'Reale Feldverlagerung ' + field, [id, 'Balance.html', field, '.form-column', 'Delegation']);
}
const duplicateFiles = new Map(sources);
duplicateFiles.set('Balance.html', balanceSource.replace('</body>', '<input id="floorBedarf"></body>'));
assertSourceFailure(inventory, duplicateFiles, 'Gültiger Feldtreffer verdeckt keine ausgelagerte Kopie', ['B13', 'Balance.html', '#floorBedarf', '.form-column', 'Delegation']);
const cashCopy = structuredClone(inventory);
const cashEntry = cashCopy.pages.flatMap(page => page.entries).find(entry => entry.id === 'V22');
cashEntry.selectors.dynamic.find(record => record.selector === '[data-cash-action="confirm"]').host = '#reconciliationForm';
assertSourceFailure(cashCopy, sources, 'Reales dynamisches Feld hat falschen Host', ['V22', 'depot-tranchen-manager.html', '[data-cash-action="confirm"]', '#reconciliationCashStatuses', 'Delegation']);

extended.findings.push({ id: 'F-100', entryIds: ['I100'], source: { path: module, location: 'build' },
    actual: 'Synthetische Beobachtung.', boundary: 'Kein produktiver Befund.' });
assertFollowUp(extended, extendedFiles, 'Zusätzlicher wohlgeformter Befund F-100');
const renamed = JSON.parse(JSON.stringify(inventory).replaceAll('recovery-banner', 'recovery-renamed'));
const renamedFiles = new Map(sources);
renamedFiles.set('app/overview/overview-renderer.js', sources.get('app/overview/overview-renderer.js').replaceAll('recovery-banner', 'recovery-renamed'));
assertFollowUp(renamed, renamedFiles, 'Konsistente Ankerumbenennung einschließlich Selektorbezügen');

// Aktualität wird nach Inhalt beurteilt; gleiche UTF-8-Länge ist kein Nachweis.
for (const stale of [markdown + '\n', markdown.replace('Funktionsinventar', 'Funktionsinventaz'), undefined]) {
    const result = checkMarkdown(inventory, stale, renderInventory);
    assertEqual(result.ok, false, 'Veraltete oder fehlende Lesefassung scheitert');
    for (const fragment of ['Ist:', 'erwartet:', '225000', GENERATE_INVENTORY_COMMAND]) {
        assert(result.errors[0].includes(fragment), 'Aktualitätsdiagnose nennt ' + fragment);
    }
    strictAssert.throws(() => generateInventory(json, stale, { check: true }),
        error => error.message === result.errors[0], 'Generator meldet dieselbe Aktualitätsdiagnose');
}
assertEqual(Buffer.byteLength(markdown.replace('Funktionsinventar', 'Funktionsinventaz')), Buffer.byteLength(markdown),
    'Gleichlange Aktualitätsprobe hat tatsächlich dieselbe Bytezahl');
// Gültige Formatierung auch am Bytelimit: Auffüllung auf mehrere kurze Zeilen verteilen.
const paddingLength = INVENTORY_SIZE_LIMITS.source - Buffer.byteLength(json, 'utf8');
const jsonAtLimit = json + (' '.repeat(1999) + '\n').repeat(Math.floor(paddingLength / 2000)) + ' '.repeat(paddingLength % 2000);
assertEqual(generateInventory(jsonAtLimit, markdown, { check: true }), markdown, 'Generator akzeptiert Quelle exakt am Grenzwert');
strictAssert.throws(() => generateInventory(jsonAtLimit + ' ', markdown, { check: true }),
    new RegExp(`Ist: ${INVENTORY_SIZE_LIMITS.source + 1} B; Grenze: ${INVENTORY_SIZE_LIMITS.source} B`),
    'Generator lehnt Quelle ein Byte über Grenze ab');

// Formatverluste werden unabhängig von Quellbelegen und Lesefassungsaktualität geprüft.
const longText = 'Wiederholter ausführlicher Text mit unveränderter Prüfaussage. '.repeat(2);
const formatFixture = { definitions: { 'pruefung.wiederholteAussage': longText },
    checks: [{ expected: '@pruefung.wiederholteAussage' }, { expected: '@pruefung.wiederholteAussage' }] };
const readable = value => JSON.stringify(value, null, 2) + '\n';
assertEqual(checkInventoryReadability(readable(formatFixture)).ok, true, 'Wiederholter sprechender Langtext ist lesbar');
const formatFailure = (name, change, fragment) => {
    const copy = structuredClone(formatFixture);
    change(copy);
    const result = checkInventoryReadability(readable(copy));
    assertEqual(result.ok, false, name);
    assert(result.errors.some(error => error.includes(fragment)), name + ': gezielte Diagnose ' + fragment);
};
for (const [key, value] of [['status', 'geschützt'], ['module', 'app/synthetic.js'], ['path', 'index.html'],
    ['page', 'index.html'], ['initModule', 'app/synthetic.js'], ['firstPackage', '1'], ['laterPackages', ['2']],
    ['package', '2'], ['selector', '#stable'], ['static', ['#stable']], ['host', '#host'], ['ancestor', '#host'],
    ['attribute', 'data-profile-id'], ['keys', ['storage_key']]]) {
    formatFailure('Verdecktes kritisches Feld ' + key, copy => {
        copy.definitions['bezug.verdeckterWert'] = value;
        copy[key] = '@bezug.verdeckterWert';
    }, 'Kritisches Feld');
}
formatFailure('Kritisches Feld in join verborgen', copy => { copy.status = { join: ['gesch', 'ützt'] }; }, 'join unzulässig');
formatFailure('Ganzes Eintragsobjekt ausgelagert', copy => {
    copy.definitions['eintrag.ausgelagerteDaten'] = { status: 'geschützt' };
    copy.entries = [{ ref: 'eintrag.ausgelagerteDaten' }];
}, 'Objekt-/Array-Kurzdefinitionen');
formatFailure('Tabellenkurzform statt benannter Felder', copy => { copy.codeRefs = { columns: ['path'], rows: [['index.html']] }; }, 'Tabellen');
formatFailure('Kurzer Text als Definition', copy => { copy.definitions['pruefung.wiederholteAussage'] = 'Kurztext'; }, 'ab 80');
formatFailure('Unbenutzte Definition', copy => { copy.definitions['pruefung.unbenutzteAussage'] = longText; }, 'Verwendungen: 0');
formatFailure('Nur einmal benutzte Definition', copy => { copy.checks.pop(); }, 'Verwendungen: 1');
formatFailure('Nummernkürzel als Definitionsname', copy => { copy.definitions.t01 = longText; }, 'sprechender Name');
formatFailure('Nur Großschreibung unterscheidet Namen', copy => { copy.definitions['pruefung.WiederholteAussage'] = longText; }, 'Groß-/Kleinschreibungsvarianten');
formatFailure('Textalias statt wörtlichem Langtext', copy => { copy.definitions['pruefung.wiederholteAussage'] = '@pruefung.andereAussage'; }, 'Referenzketten');
formatFailure('Unbekannte Textreferenz', copy => { copy.checks[0].expected = '@pruefung.fehlendeAussage'; }, 'Referenz fehlt');
assertEqual(checkInventoryReadability(JSON.stringify(formatFixture)).ok, false, 'Einzeilige Definitionssammlung scheitert');
const secondDefinition = structuredClone(formatFixture);
secondDefinition.definitions['pruefung.zweiteAussage'] = longText + 'Zusatz';
secondDefinition.checks.push({ expected: '@pruefung.zweiteAussage' }, { expected: '@pruefung.zweiteAussage' });
const multiDefinitionLine = readable(secondDefinition).replace(/(Aussage": "[^\n]+",)\n\s*("pruefung.zweiteAussage")/, '$1 $2');
assertEqual(checkInventoryReadability(readable(secondDefinition)).ok, true, 'Zwei getrennte Definitionszeilen sind gültig');
assert(checkInventoryReadability(multiDefinitionLine).errors.some(error => error.includes('Jede Definition braucht eine eigene Zeile')),
    'Zwei Definitionen auf derselben kurzen Zeile scheitern gezielt');
assertEqual(checkInventoryReadability(readable(formatFixture).replace(': "Wiederholter', ':\n "Wiederholter')).ok, false,
    'Definitionsname und Wert auf verschiedenen Zeilen scheitern');
const joined = structuredClone(formatFixture);
joined.checks[0].expected = { join: ['Präfix: ', '@pruefung.wiederholteAussage'] };
assertEqual(checkInventoryReadability(readable(joined)).ok, true, 'join darf lange Textteile in beschreibenden Feldern wiederverwenden');
for (const character of ['a', '✨']) {
    const prefix = '{"label":"', suffix = '"}';
    const line = prefix + character.repeat(INVENTORY_LINE_LIMIT - [...prefix + suffix].length) + suffix;
    assertEqual(checkInventoryReadability(line).ok, true, 'Exakt 2.000 Unicode-Zeichen sind gültig: ' + character);
    const result = checkInventoryReadability(line.replace(suffix, character + suffix));
    assertEqual(result.ok, false, '2.001 Unicode-Zeichen scheitern: ' + character);
    assert(result.errors.some(error => ['Zeile 1', '2001', '2000', '--check'].every(part => error.includes(part))),
        'Zeilendiagnose nennt Ort, Ist-Wert, Grenze und Prüfbefehl');
}
strictAssert.throws(() => generateInventory(JSON.stringify(inventory), markdown, { check: true }), /Unicode-Zeichen/,
    'Generator erzwingt Lesbarkeit auch bei inhaltlich aktueller Lesefassung');

// Eintragsgrenze nach Auflösung, kompakt serialisiert und inklusive Unicode-Bytes.
for (const fill of ['a', '✨']) {
    const sized = structuredClone(inventory);
    sized.pages[0].entries[0].label = '';
    const emptySize = Buffer.byteLength(JSON.stringify(resolveInventory(sized).pages[0].entries[0]), 'utf8');
    const remaining = 20000 - emptySize;
    const width = Buffer.byteLength(fill, 'utf8');
    sized.pages[0].entries[0].label = fill.repeat(Math.floor(remaining / width)) + 'a'.repeat(remaining % width);
    assertEqual(Buffer.byteLength(JSON.stringify(resolveInventory(sized).pages[0].entries[0])), 20000,
        'Künstlicher gültiger Eintrag hat exakt 20.000 B mit ' + fill);
    assertEqual(validateInventory(sized).ok, true, 'Eintrag am Grenzwert ist gültig');
    assertEqual(checkInventoryEntrySizes(sized).ok, true, 'Eintragsgrößengate am Grenzwert');
    sized.pages[0].entries[0].label += 'a';
    const result = checkInventoryEntrySizes(sized);
    assertEqual(result.ok, false, 'Ein Byte über Eintragsgrenze scheitert');
    for (const fragment of ['I01', 'index.html', '20001', '20000', 'pflegen', 'Neu-Erzeugung allein', '--check']) {
        assert(result.errors[0].includes(fragment), 'Eintragsdiagnose nennt ' + fragment);
    }
    assert(validateInventory(sized).errors.includes(result.errors[0]), 'Normaler Vertrag erzwingt Eintragsgrößengate');
    strictAssert.throws(() => generateInventory(JSON.stringify(sized)), /Aufgelöster Eintrag/, 'Generator erzwingt Eintragsgrenze');
}
const inflated = structuredClone(inventory);
inflated.definitions.syntheticPadding = '✨'.repeat(3000);
inflated.pages[0].entries[0].label = { join: ['@syntheticPadding', '@syntheticPadding', '@syntheticPadding'] };
assertEqual(checkInventorySizes(JSON.stringify(inflated), markdown).ok, true, 'Referenzprobe bleibt unter Dateigrenzen');
assertEqual(checkInventoryEntrySizes(inflated).ok, false, 'Kurze Referenzen verbergen keinen übergroßen Eintrag');
assert(validateInventory(inflated).errors.some(error => error.includes('Aufgelöster Eintrag')), 'Referenzaufblähung scheitert im normalen Vertrag');
strictAssert.throws(() => generateInventory(JSON.stringify(inflated)), /Aufgelöster Eintrag/, 'Generator erkennt Referenzaufblähung');

const mutate = (name, change, diagnosis) => {
    const copy = literalSource(structuredClone(resolved));
    change(copy);
    const result = validateInventory(copy);
    assertEqual(result.ok, false, name);
    if (diagnosis) assert(result.errors.some(error => error.includes(diagnosis)), `${name}: ${diagnosis}`);
};
mutate('Referenzierte Kennung fehlt', copy => { copy.pages[0].entries = copy.pages[0].entries.filter(entry => entry.id !== 'I01'); }, 'unbekannte aktuelle Kennung: I01');
mutate('Noch referenzierter dynamischer Beleg fehlt', copy => copy.pages[0].entries.find(entry => entry.id === 'I10').selectors.dynamic.pop(), 'Zustandsselektor nicht inventarisiert');
mutate('Rekursives Ausschnittfeld schlägt fehl', copy => { copy.definitions = { hidden: { sourceSnippet: 'verboten' } }; });
mutate('Nicht inventarisierter Zustandsselektor schlägt fehl', copy => { copy.pages[0].entries[0].initialStates[0].selectors = ['#absent']; });
mutate('Fehlender Zustand schlägt fehl', copy => { copy.pages[0].entries[0].initialStates = []; });
mutate('Unbekannter Delegationshost schlägt fehl', copy => { copy.pages.flatMap(page => page.entries).flatMap(e => e.codeRefs).find(r => r.binding === 'delegated').ancestor = '#absent'; });
mutate('Fehlende Referenz schlägt fehl', copy => { copy.pages[0].entries[0].label = '@absent'; });
mutate('Falscher Texttyp schlägt fehl', copy => { copy.definitions = { wrong: ['Liste'] }; copy.pages[0].entries[0].label = '@wrong'; });
mutate('Zyklus schlägt fehl', copy => { copy.definitions = { a: '@b', b: '@a' }; });
mutate('Ungültige Tabellenbreite schlägt fehl', copy => { copy.pages[0].entries[0].initialStates = { columns: ['selectors', 'kind'], rows: [[['#activeProfileBadge']]] }; });
mutate('Doppelte Tabellenspalten schlagen fehl', copy => { copy.pages[0].entries[0].initialStates = { columns: ['kind', 'kind'], rows: [['sichtbar', 'sichtbar']] }; });
mutate('Code-Auditindex außerhalb des Eintrags schlägt fehl', copy => { copy.pages[0].entries[0].auditEvidence = [{ codeRef: 999 }]; });
mutate('Prüf-Auditindex außerhalb des Eintrags schlägt fehl', copy => { copy.pages[0].entries[0].auditEvidence = [{ path: 'index.html', location: 'host', checkRef: 999 }]; });
mutate('Unsortierte Paketliste schlägt fehl', copy => { copy.pages[0].entries[0].target.laterPackages = ['6.3', '2']; });
mutate('6.2a ist kein Designziel', copy => { copy.pages[0].entries[0].target.firstPackage = '6.2a'; });
mutate('Fehlender Lückengrund schlägt fehl', copy => { delete copy.pages[0].entries[0].coverage.gaps[0].reason; });
mutate('Ankerlücke ohne Änderungsrisiko schlägt fehl', copy => { copy.pages.flatMap(page => page.entries).find(entry => entry.selectors.dynamic.some(record => record.status === DYNAMIC_STATUSES[1])).coverage.gaps = []; });
mutate('Fehlender Registerbezug schlägt fehl', copy => { copy.baselineAudit[0].entryIds = ['I99']; });
mutate('Ungültiger Befundbezug schlägt fehl', copy => { copy.findings[0].entryIds = ['I999']; }, 'unbekannte Kennung: I999');
mutate('Doppelte Eintragskennung', copy => { copy.pages[0].entries[1].id = 'I01'; }, 'doppelte Kennung');
mutate('Doppelte Befundkennung', copy => { copy.findings[1].id = 'F-01'; }, 'doppelte Befundkennung');
for (const id of ['F-1', 'F-AA', 'F-100.x']) mutate('Ungültige Befundkennung ' + id,
    copy => { copy.findings[0].id = id; }, 'ungültige Befundkennung');
mutate('Ungültige Eintragskennung', copy => { copy.pages[0].entries[0].id = 'Ibad'; }, 'ungültige oder doppelte Kennung');
mutate('Verlorene historische Kennung', copy => { copy.baselineAudit.shift(); }, 'baselineAudit.I01 | historische Kennung fehlt');
mutate('Doppelte historische Kennung', copy => { copy.baselineAudit[1].id = 'I01'; }, 'doppelte historische Kennung');
mutate('Unbekannte historische Kennung', copy => { copy.baselineAudit[0].id = 'I999'; }, 'unbekannte historische Kennung');
mutate('Fehlendes Befundpflichtfeld', copy => { delete copy.findings[0].actual; }, 'findings.actual');
for (const status of [undefined, 'unbekannt', ['geschützt'], { value: 'geschützt' }, ['geschützt', DYNAMIC_STATUSES[1]]]) {
    mutate('Fehlender oder mehrdeutiger Schutzstatus ' + JSON.stringify(status), copy => {
        copy.pages[0].entries.find(entry => entry.id === 'I10').selectors.dynamic[0].status = status;
    }, 'selectors.dynamic.status');
    const invalidCount = { pages: [{ entries: [{ id: 'I01', selectors: { dynamic: [{ selector: '#stable', status }] } }] }] };
    strictAssert.throws(() => protectionCounts(invalidCount), /Unbekannter Schutzstatus/,
        'Schutzstatistik akzeptiert keinen zusätzlichen/unbekannten Status');
    assertEqual(validateAnchorEvidence({ selector: '#stable', producer, anchor, status },
        new Map([[module, `function build() { ${creation} }`]]), context).ok, false,
        'Auch Einzelbeleg verlangt explizit genau einen gültigen Status');
}
mutate('Kollision zwischen Befund und Eintrag', copy => { copy.findings[0].id = 'I01'; }, 'kollidiert mit Eintragskennung');
mutate('Fehlendes Pflichtfeld', copy => { delete copy.pages[0].entries[0].label; }, 'I01 | index.html.label');
assert(resolved.baselineAudit.some(item => entries.some(entry => entry.id === item.id) && item.entryIds.includes(item.id)),
    'Historisches Register verweist zulässig auf dieselbe aktuelle Kennung');
assertEqual(validateInventory(inventory, { reviewed: true }).ok, true, 'Registerbezüge bleiben auch im Teilprüfmodus gültig');
for (const [id, diagnosis] of [['F-01', 'doppelte Befundkennung'], ['I01', 'kollidiert mit Eintragskennung']]) {
    const copy = literalSource(structuredClone(resolved));
    copy.findings[1].id = id;
    assert(validateInventory(copy, { reviewed: true }).errors.some(error => error.includes(diagnosis)),
        `Kennungsgate gilt auch ohne feste Bestandszahlen: ${id}`);
}
const special = structuredClone(inventory);
special.pages[0].entries[0].label = 'Wert | zweite Zeile\nZusatz';
assert(renderInventory(special).includes('Wert \\| zweite Zeile ⏎ Zusatz'), 'Tabellenwerte maskieren Pipe und Zeilenumbruch');

const missingRecord = entries.flatMap(e => e.selectors.dynamic).find(d => d.status === DYNAMIC_STATUSES[1]);
assertEqual(validateAnchorEvidence(missingRecord, new Map([[missingRecord.producer.module, 'function unrelated() {}']]), context).ok, false, 'Auch fehlender Anker benötigt einen bestehenden Erzeugerort');
const unsupportedRecord = entries.flatMap(e => e.selectors.dynamic).find(d => d.status === DYNAMIC_STATUSES[2]);
const unsupportedFiles = new Map(sources);
unsupportedFiles.set(unsupportedRecord.producer.module, sources.get(unsupportedRecord.producer.module).replaceAll(unsupportedRecord.anchor.value, 'renamed'));
assertEqual(validateAnchorEvidence(unsupportedRecord, unsupportedFiles, context).ok, false, 'Nicht unterstützte Form ohne lexikalischen Anker scheitert');
const protectedEntry = entries.find(e => e.id === 'I10');
const protectedFiles = new Map(sources);
protectedFiles.set('app/overview/overview-renderer.js', sources.get('app/overview/overview-renderer.js').replaceAll('recovery-banner', 'renamed'));
const changedSources = validateSources(inventory, protectedFiles);
assertEqual(changedSources.ok, false, 'Entfernter realer geschützter Erzeuger wird zum Fehler');
assert(changedSources.errors.some(error => ['I10', 'index.html', 'recovery-banner'].every(text => error.includes(text))), 'Realer Schutzfehler nennt Kennung, Seite und Anker');
assertEqual(protectionCounts(inventory)['geschützt'], counts['geschützt'], 'Quellprüfung stuft geschützte Belege niemals automatisch herab');
assertEqual(matchesSelector(tokenizeHTML('<div id="host"><!-- <button id="fake"></button> --></div>'), '#fake'), false, 'Statischer Anker nicht aus Kommentar');
assertEqual(matchesSelector(tokenizeHTML('<div id="host"><script>const html = \'<button id="fake"></button>\';</script></div>'), '#fake'), false, 'Statischer Anker nicht aus Script');
assertEqual(registeredBrowserCases("const smokes = []; // ['fake', runFake]").size, 0, 'Browserfall muss tatsächlich registriert sein');
assert((await runSelfTests()).startsWith('Selbsttest bestanden'), 'CLI-Selbsttest verwendet Schema-2-Referenzen und Anker');

// Dateigates am vollständigen Bestand: nur die injizierte Map wird verändert.
const sourceMutation = (name, change, fragments) => {
    const files = new Map(sources);
    change(files);
    const result = validateSources(inventory, files);
    assertEqual(result.ok, false, name);
    assert(result.errors.some(error => fragments.every(fragment => error.includes(fragment))),
        name + ': zusammenhängende Diagnose mit ' + fragments.join(', '));
};
sourceMutation('Statisches Element entfernt', files => files.set('index.html',
    files.get('index.html').replace('id="overviewAssets"', 'id="renamed"')),
    ['I01', 'index.html', '#overviewAssets', 'statischer Selektor fehlt']);
sourceMutation('Statischer Delegationshost entfernt trotz erhaltener Aktionsrenderer', files => files.set('index.html',
    files.get('index.html').replace('id="overviewFocus"', 'id="renamed"')),
    ['I01', 'index.html', '#overviewFocus', 'statischer Selektor fehlt']);
sourceMutation('Codemodul fehlt', files => files.delete('app/overview/overview-model.js'),
    ['I01', 'index.html', 'Datei fehlt', 'app/overview/overview-model.js']);
const nodeEntry = entries.find(entry => entry.coverage.node.length);
const nodeRef = nodeEntry.coverage.node[0];
sourceMutation('Node-Testdatei fehlt', files => files.delete(nodeRef.path),
    [nodeEntry.id, nodeEntry.page, 'Datei fehlt', nodeRef.path]);
sourceMutation('Node-Testbeleg fehlt trotz vorhandener Datei', files => files.set(nodeRef.path,
    files.get(nodeRef.path).replaceAll(nodeRef.evidence, 'umbenannter Testbeleg')),
    [nodeEntry.id, nodeEntry.page, 'Testbeleg fehlt', nodeRef.path, nodeRef.evidence]);
sourceMutation('Browserfall nicht registriert', files => files.set('tests/browser-smoke.test.mjs', 'const smokes = [];'),
    ['I01', 'index.html', 'Browserfall nicht registriert']);
sourceMutation('Browserregistrierungsdatei fehlt', files => files.delete('tests/browser-smoke.test.mjs'),
    ['Browserregistrierung', 'Datei fehlt', 'tests/browser-smoke.test.mjs']);
const dynamicEntry = entries.find(entry => entry.selectors.dynamic.length);
const mutationDynamicRef = dynamicEntry.selectors.dynamic[0];
sourceMutation('Erzeugermodul fehlt', files => files.delete(mutationDynamicRef.producer.module),
    [dynamicEntry.id, dynamicEntry.page, mutationDynamicRef.selector, mutationDynamicRef.producer.module]);
const initEntry = entries.find(entry => entry.codeRefs.some(ref => ref.initModule));
const initRef = initEntry.codeRefs.find(ref => ref.initModule);
sourceMutation('Initialisierungsmodul fehlt', files => files.delete(initRef.initModule),
    [initEntry.id, initEntry.page, 'Datei fehlt', initRef.initModule]);
const writerEntry = entries.find(entry => entry.storage.some(storage => storage.writer));
const writer = writerEntry.storage.find(storage => storage.writer).writer;
sourceMutation('Schreibmodul fehlt', files => files.delete(writer.path),
    [writerEntry.id, writerEntry.page, 'Datei fehlt', writer.path]);
const finding = resolved.findings[0];
sourceMutation('Befundquelle fehlt', files => files.delete(finding.source.path),
    [finding.id, 'Datei fehlt', finding.source.path]);

// Synthetischer dynamischer Delegationshost im ansonsten vollständigen Inventar.
// Auch synthetische Erweiterungen verwenden den normalen Struktur-/Quellvertrag.
const hostInventory = literalSource(structuredClone(resolved));
const hostEntry = hostInventory.pages[0].entries.find(entry => entry.id === 'I21');
hostEntry.selectors.static = hostEntry.selectors.static.filter(selector => selector !== '#overviewFocus');
hostEntry.selectors.dynamic.push({
    selector: '#overviewFocus', status: 'geschützt', producer, anchor: { kind: 'id', value: 'overviewFocus' }
});
const hostFiles = new Map(sources);
hostFiles.set(module, 'function build() { node.id = "overviewFocus"; }');
const hostResult = validateSources(hostInventory, hostFiles);
assertEqual(hostResult.ok, true, 'Dynamischer Delegationshost mit eigener Erzeugung: ' + hostResult.errors.join('; '));
hostFiles.set(module, 'function build() { document.querySelector("#overviewFocus"); }');
const absentHost = validateSources(hostInventory, hostFiles);
assertEqual(absentHost.ok, false, 'Dynamischer Delegationshost: Leser ersetzt keinen Erzeuger');
assert(absentHost.errors.some(error => ['I21', 'index.html', 'overviewFocus'].every(text => error.includes(text))),
    'Dynamischer Hostfehler nennt Kennung, Seite und Anker');

// Ungeschützt bedeutet Ortsprüfung, niemals Erzeugungsschutz oder Schein-Grün.
const unprotected = {
    selector: '#stable', producer, status: DYNAMIC_STATUSES[1], reason: 'Anker vor Umbau ergänzen.'
};
const unsupported = {
    ...unprotected, status: DYNAMIC_STATUSES[2], anchor, reason: 'Bedingte Markupzuweisung.'
};
const categoryInventory = { pages: [{ entries: [{ selectors: { dynamic: [
    { ...unsupported, status: DYNAMIC_STATUSES[0] }, unprotected, unsupported
] } }] }] };
assertEqual(DYNAMIC_STATUSES.map(status => protectionCounts(categoryInventory)[status]).join(','), '1,1,1',
    'Beide ungeschützten Arten zählen separat und erhöhen den Schutzbestand nicht');
const categoryCheck = (record, source) => validateAnchorEvidence(record, new Map([[module, source]]), context);
assertEqual(categoryCheck(unprotected, 'function build() {}').ok, true,
    'Anker fehlt: bestehender Ort genügt nur für den offenen Status');
assertEqual(categoryCheck({ ...unprotected, status: 'geschützt', anchor }, 'function build() {}').ok, false,
    'Anker fehlt: gleicher Ort erhält keinen Erzeugungsschutz');
assertEqual(categoryCheck(unsupported, 'function build() { document.getElementById("stable"); }').ok, true,
    'Prüfergrenze: lexikalischer Anker am Ort bleibt ungeschützt gültig');
assertEqual(categoryCheck({ ...unsupported, status: 'geschützt' }, 'function build() { document.getElementById("stable"); }').ok, false,
    'Prüfergrenze: bloßer Leser darf nicht auf geschützt umgestellt werden');
assertEqual(categoryCheck(unsupported, 'function build() {}').ok, false,
    'Prüfergrenze: entfernter lexikalischer Anker scheitert');
for (const record of [unprotected, unsupported]) {
    assertEqual(validateAnchorEvidence(record, new Map(), context).ok, false,
        record.status + ': fehlende Erzeugerdatei scheitert');
    assertEqual(categoryCheck(record, 'function sibling() { node.id = "stable"; }').ok, false,
        record.status + ': fehlender beschriebener Rumpf scheitert');
}
const openHost = hostEntry.selectors.dynamic.at(-1);
openHost.status = DYNAMIC_STATUSES[1];
delete openHost.anchor;
openHost.reason = 'Stabilen Anker vor dem konkreten Umbau ergänzen.';
hostEntry.coverage.gaps.push({ kind: 'Änderungsrisiko', package: hostEntry.target.firstPackage, selector: '#overviewFocus',
    evidence: 'Anker des dynamischen Delegationshosts fehlt.', reason: 'Host wird beim Umbau ersetzt.' });
assertEqual(validateSources(hostInventory, hostFiles).ok, true,
    'Ungeschützter dynamischer Host bleibt mit eigenem Änderungsrisiko gültig');
assertEqual(protectionCounts(hostInventory)[DYNAMIC_STATUSES[0]], counts[DYNAMIC_STATUSES[0]],
    'Offener dynamischer Host erhöht die geschützte Zahl nicht');
hostEntry.coverage.gaps = hostEntry.coverage.gaps.filter(gap => gap.selector !== '#overviewFocus');
assertEqual(validateInventory(hostInventory).ok, false,
    'Ungeschützter dynamischer Host ohne eigenes Änderungsrisiko scheitert');

const runnerDirectory = fileURLToPath(new URL('./', import.meta.url));
const { getTestFiles } = await import('./run-tests.mjs');
assert(getTestFiles(runnerDirectory).includes('funktionsinventar.test.mjs'),
    'Runner-Dateierkennung entdeckt den Schutztest automatisch');

// V03 migriert den entfernten statischen Hinweis zum geschützten dynamischen Grund.
const v03 = entries.find(entry => entry.id === 'V03');
assert(!JSON.stringify(v03).includes('profileRenteHelp'), 'V03 besitzt keinen entfernten statischen Hinweis');
assertEqual(v03.selectors.dynamic.find(record => record.selector === '.ds-field-reason').status, 'geschützt', 'V03-Grund behält geschützten Erzeugerbeleg');
realLoss('V03', '.ds-field-reason', source => source.replace("presentation.node.className = 'ds-field-reason';", "presentation.node.className = 'entfernt';"));

// Neue Jahresbandanker sind am eigenen Erzeuger geschützt, nicht nur am Host.
realLoss('I01', '[data-overview-year-month]', source => source.replace('data-overview-year-month="${month.month}"', 'data-entfernter-monat="${month.month}"'));
realLoss('I01', '.overview-year-metric', source => source.replace('class="overview-year-metric"', 'class="entfernte-kennzahl"'));

// Beide Monatsaktionen bleiben an ihrem tatsächlichen Erzeuger geschützt.
realLoss('I01', '[data-overview-month-confirm]', source => source.replace('data-overview-month-confirm>', 'data-entfernter-abschluss>'));

// P16: historische Kennungen bleiben nachvollziehbar, entfernte Bedienknoten nicht zugesagt.
const simulatorInventory = inventory.pages.find(page => page.path === 'Simulator.html');
const s18History = inventory.baselineAudit.find(entry => entry.id === 'S18');
assert(s18History.status === 'entfallen' && s18History.entryIds.length === 0 && s18History.reason.includes('Ansparbedienung'), 'P16: S18 dokumentiert die entfernte Ansparbedienung historisch');
assert(!simulatorInventory.entries.some(entry => entry.id === 'S18'), 'P16: S18 besitzt keinen aktuellen Bedienvertrag');
const simulatorSelectors = simulatorInventory.entries.flatMap(entry => entry.selectors.static);
for (const selector of ['#mcRecalculateButton', '#overviewRunMonteCarlo', '#enableAccumulationPhase', '#accumulationPhaseDetails']) {
    assert(!simulatorSelectors.includes(selector), 'P16: Inventar sagt entfernten Bedienknoten nicht zu: ' + selector);
}
for (const selector of ['#mcButton', '#mcAdvancedDisclosure', '#mcAdvancedSummary', '#p1PersonValues', '#r2PersonValues', '#sharedPensionValues']) {
    assert(simulatorSelectors.includes(selector), 'P16: Inventar enthält aktuellen Bedien-/Wertelistenanker: ' + selector);
}

// pT1: Alle acht Appbefunde haben konkrete Node-Belege an tatsächlichen Bedienhosts.
for (const [finding, ids, file] of [
    [1, ['B29', 'B30'], 'tests/wealth-history-navigation.test.mjs'],
    [1, ['B26', 'B44'], 'tests/balance-expenses-wealth-capture.test.mjs'],
    [2, ['S03', 'S13', 'S14', 'S15', 'S16', 'S54'], 'tests/simulator-household-context-regression.test.mjs'],
    [3, ['B39', 'S03', 'S29', 'S73', 'I09'], 'tests/simulator-profile-recovery-regression.test.mjs'],
    [4, ['S31', 'S43', 'S55'], 'tests/monte-carlo-export-contract.test.mjs'],
    [5, ['S60'], 'tests/designsystem-selection-text.test.mjs'],
    [6, ['S73'], 'tests/profile-storage.test.mjs'],
    [6, ['S73'], 'tests/profile-navigation.test.mjs'],
    [7, ['S32', 'S55'], 'tests/protocol-columns.test.mjs'],
    [8, ['S32'], 'tests/protocol-renderer.test.mjs']
]) {
    for (const id of ids) {
        const entry = entries.find(e => e.id === id);
        const proof = entry.coverage.node.find(test => test.path === file && test.scope.startsWith(`Befund ${finding}:`));
        assert(proof && fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes(proof.evidence),
            `pT1 Befund ${finding}: ${id} besitzt konkreten Node-Verhaltensbeleg`);
    }
}

assertEqual(inventory.pages.length, 7, 'AU1: Inventar erfasst alle sieben Quellseiten');
const dataPage = inventory.pages.find(page => page.path === 'Daten-Sicherung.html');
assert(dataPage && dataPage.entries.every(entry => /^D\d{2,}$/.test(entry.id)), 'P14: eigene Seite hat D-Kennungen');
const dataBackupChecks = entries.find(entry => entry.id === 'D01').checks;
const dataBackupCheckText = JSON.stringify(dataBackupChecks);
for (const selector of ['#fullBackupBtn', '#fullBackupImportBtn']) {
    assert(dataBackupCheckText.includes(selector), 'D01 nennt echten Bedienhost: ' + selector);
}
assert(dataBackupCheckText.includes('bestehenden Seitendialog') && !/Erweitert|native/i.test(dataBackupCheckText),
    'D01 beschreibt Seitendialog und Bedienung der eigenen Sicherungsseite');
const missingDataPage = structuredClone(inventory);
missingDataPage.pages = missingDataPage.pages.filter(page => page.path !== 'Daten-Sicherung.html');
assertEqual(validateInventory(missingDataPage).ok, false, 'P14: Gate erkennt entfernten sechsten Einstieg');
assertEqual(inventory.baselineAudit.length, 162, 'P14: historische Ausgangskennungen bleiben vollständig');

});
