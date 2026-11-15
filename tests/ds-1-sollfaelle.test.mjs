// DS-1 Punkt 5: Schutz gegen Rückfall bei der Stil-Konsolidierung. Schlägt an bei (a) neuem eingebettetem <style> in einer App-Seite,
// (b) neuer globaler Elementregel außerhalb der Basis-CSS (tokens, fonts, components, suite-frame) und (c) einem sichtbaren Eurofeld
// (`data-money-input`) einer App-Seite ohne `ds-unit-frame`. Bestand und Ausnahmen sind unten eingefroren und begründet.
import fs from 'node:fs';
import { rules, PAGES } from './designsystem-source-contract.mjs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const BASE_CSS = new Set(['css/tokens.css', 'css/fonts.css', 'css/components.css', 'css/suite-frame.css']);
// Bestand vor DS-1: Seitenstile, die nur ihre eigene Seite laden (Balance, Simulator). Neue Einträge nur mit Begründung.
const GLOBAL_ELEMENT_RULES = new Set([
    ...['body', 'h1', 'h2', 'h3', 'h4', 'hr', 'input', 'input::-webkit-inner-spin-button', 'input::-webkit-outer-spin-button', 'input:disabled',
        'input:focus', 'label', 'select', 'select:focus',
        // VN-3: mit Attributselektor, vorher übersehen; balance.css lädt nur die Balance.
        'input[type=number]', 'html[data-density=compact] label', 'html[data-density=compact] input', 'html[data-density=compact] select'].map(part => `css/balance.css | ${part}`),
    ...['body', 'fieldset', 'fieldset h4', 'fieldset:hover', 'h1', 'h2', 'h3', 'h4', 'input', 'input:disabled', 'input:disabled::placeholder',
        'input:focus', 'label', 'legend', 'select', 'select:disabled', 'select:focus',
        // VN-3: mit Attributselektor, vorher übersehen; simulator.css lädt nur der Simulator.
        'input[aria-invalid="true"]', 'input[type="checkbox"]', 'label[style*="flex-direction: row"]', 'input[data-plan-trial-readonly][type="text"]'].map(part => `simulator.css | ${part}`)
]);
// Ausnahmen für Eurofelder ohne Rahmen (Nachtrag 2 DS-1): Plan- und Bedarfswerte in Haushalt & Plan zeigen die Einheit im Feldtext
// (Planfeld-Muster mit eigener Höhe und Innenabstand, Browservertrag `probePlanFieldStyles`).
const UNFRAMED_MONEY = new Set(['managerPlan_floorBedarf', 'managerPlan_flexBedarf', 'managerPlan_minimumFlexAnnual', 'managerPlan_flexBudgetAnnual',
    'managerPlan_flexBudgetRecharge']);

const splitSelector = selector => {
    const parts = []; let depth = 0, current = '';
    for (const char of selector) {
        if (char === '(') depth++;
        if (char === ')') depth--;
        if (char === ',' && !depth) { parts.push(current); current = ''; } else current += char;
    }
    return [...parts, current].map(part => part.trim()).filter(Boolean);
};
// VN-3 (Gemini Befund 7, Codex F04): Ein Selektor ist nur über Klasse oder Kennung begrenzt; Attributselektoren (`input[type="text"]`)
// und `:where(h1)`/`:is(button)` ohne Klasse gelten als global, außer unter `html[data-suite-page=…]`. `:root` trägt nur Tokens.
const bounded = part => /[.#]/.test(part.replace(/\[[^\]]*\]/g, '')) || /html\[data-suite-page=/.test(part);
const globalPart = part => !/^(from|to|\d+%)$/.test(part) && !/^:root\b/.test(part) && !bounded(part)
    && /(^|[\s>+~(,])(\*|[a-z][a-z0-9-]*)(?=$|[\s>+~:\[).,])/i.test(part);
// Eurofelder in JS-Dialogen: Jede Datei, die Dezimalfelder baut, setzt sie in einen Einheitenrahmen. Bestand ohne Rahmen mit Grund:
const UNFRAMED_JS = new Map([
    ['app/shared/annual-plan-editor.js', 'Planfeld-Muster wie Haushalt & Plan (Einheit im Feldtext, Nachtrag 2 DS-1)'],
    ['app/balance/balance-plan-trial.js', 'Planfeld-Muster „Nur hier ausprobieren“ (Einheit im Feldtext)'],
    ['app/simulator/simulator-plan-trial.js', 'Planfeld-Muster „Nur hier ausprobieren“ (Einheit im Feldtext)'],
    ['app/shared/tagesgeld-fields.js', 'eigenes Muster `tagesgeld-unit` im Monats- und Abschlussdialog; Tagesgeld-Dialog ohne Monat offen (VN-3)']
]);
const FRAME_IN_JS = /ds-unit-frame|unitFrame\(|euroFrame\(/;
const DECIMAL_IN_JS = /inputMode = 'decimal'|inputmode', 'decimal'|inputmode="decimal"/;

/** @param {Record<string, string>} sources Seiten, Stylesheets und App-Skripte */
export function validateStyleConsolidation(sources) {
    const errors = [];
    for (const page of PAGES) if (/<style\b/i.test(sources[page] || '')) errors.push(`Eingebetteter Stilblock: ${page}`);
    for (const [path, source] of Object.entries(sources)) {
        if (!path.endsWith('.css') || BASE_CSS.has(path)) continue;
        for (const rule of rules(path, source)) for (const part of splitSelector(rule.selector)) {
            if (!globalPart(part)) continue;
            if (!GLOBAL_ELEMENT_RULES.has(`${path} | ${part}`)) errors.push(`Globale Elementregel außerhalb der Basis-CSS: ${path} ${part}`);
        }
    }
    for (const page of PAGES) {
        // VN-3: Eurofeld = `data-money-input` oder Dezimalfeld mit „€“ in der Beschriftung; Rahmen und Sichtbarkeit über die Vorfahren.
        const html = sources[page] || '', { elements } = tokenizeHTML(html);
        const labels = new Map([...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g)].map(match => [match[1], match[2].replace(/<[^>]*>/g, '')]));
        const ancestors = node => { const list = []; for (let current = node.parent; current; current = current.parent) list.push(current); return list; };
        for (const input of elements.filter(node => node.tag === 'input')) {
            const id = input.attrs.id || '';
            const euro = 'data-money-input' in input.attrs || input.attrs.inputmode === 'decimal'
                && /€/.test(`${input.attrs['aria-label'] || ''} ${labels.get(id) || ''}`);
            if (!euro || input.attrs.type === 'hidden' || UNFRAMED_MONEY.has(id)) continue;
            // Ausgeblendete Altfelder (Feld oder seine Feldgruppe `hidden`) zählen nicht; ganze Ansichten sind beim Laden ausgeblendet und zählen.
            if ('hidden' in input.attrs || ancestors(input).slice(0, 2).some(node => 'hidden' in (node.attrs || {}))) continue;
            if (!ancestors(input).some(node => String(node.attrs?.class || '').split(/\s+/).includes('ds-unit-frame'))) errors.push(`Eurofeld ohne Einheitenrahmen: ${page} ${id}`);
        }
    }
    for (const [path, source] of Object.entries(sources)) {
        if (!path.endsWith('.js') || !DECIMAL_IN_JS.test(source) || FRAME_IN_JS.test(source) || UNFRAMED_JS.has(path)) continue;
        errors.push(`Dezimalfeld ohne Einheitenrahmen in einem Dialog: ${path}`);
    }
    return errors;
}

const cssFiles = [...fs.readdirSync(new URL('../css/', import.meta.url)).filter(name => name.endsWith('.css')).map(name => `css/${name}`), 'simulator.css'];
const appScripts = dir => fs.readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })
    .flatMap(entry => entry.isDirectory() ? appScripts(`${dir}/${entry.name}`) : entry.name.endsWith('.js') ? [`${dir}/${entry.name}`] : []);
const sources = Object.fromEntries([...PAGES, ...cssFiles, ...appScripts('app')].map(path => [path, read(path)]));
assertEqual(validateStyleConsolidation(sources).join('\n'), '', 'DS-1: keine eingebetteten Stile, keine neuen globalen Elementregeln, Eurofelder im Rahmen');
// Gegenproben: jede Regel schlägt wirklich an.
const style = validateStyleConsolidation({ ...sources, 'Balance.html': sources['Balance.html'].replace('</head>', '<style>p { color: red; }</style></head>') });
assert(style.includes('Eingebetteter Stilblock: Balance.html'), 'DS-1: neuer <style>-Block schlägt an');
const global = validateStyleConsolidation({ ...sources, 'css/personen-vermoegen.css': sources['css/personen-vermoegen.css'] + '\nh2 { margin: 0; }\n' });
assert(global.includes('Globale Elementregel außerhalb der Basis-CSS: css/personen-vermoegen.css h2'), 'DS-1: neue globale Elementregel schlägt an');
const scoped = validateStyleConsolidation({ ...sources, 'css/personen-vermoegen.css': sources['css/personen-vermoegen.css'] + '\n:where(.personen-vermoegen-page) h2 { margin: 0; }\n' });
assert(!scoped.some(error => error.includes(' h2')), 'DS-1: auf die Seite begrenzte Elementregel ist erlaubt');
const money = validateStyleConsolidation({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html']
    .replace('<span class="ds-unit-frame"><input id="profileSparerPauschbetrag"', '<span><input id="profileSparerPauschbetrag"') });
assert(money.includes('Eurofeld ohne Einheitenrahmen: depot-tranchen-manager.html profileSparerPauschbetrag'), 'DS-1: Eurofeld ohne Rahmen schlägt an');
// VN-3 (Codex F04): die vier Gegenproben – Fehler, Fehler, Fehler, kein Fehler.
const unmarked = validateStyleConsolidation({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html']
    .replace('</main>', '<label for="vn3Euro">Betrag (€)</label><input id="vn3Euro" type="text" inputmode="decimal"></main>') });
assert(unmarked.includes('Eurofeld ohne Einheitenrahmen: depot-tranchen-manager.html vn3Euro'), 'VN-3: sichtbares Eurofeld ohne Marker und Rahmen schlägt an');
const dialog = validateStyleConsolidation({ ...sources, 'app/balance/balance-play-execution-ui.js': sources['app/balance/balance-play-execution-ui.js'].replaceAll('ds-unit-frame', 'ohne-rahmen') });
assert(dialog.includes('Dezimalfeld ohne Einheitenrahmen in einem Dialog: app/balance/balance-play-execution-ui.js'), 'VN-3: ungerahmtes Dialogfeld schlägt an');
const attribute = validateStyleConsolidation({ ...sources, 'css/personen-vermoegen.css': sources['css/personen-vermoegen.css'] + '\ninput[type="text"] { margin: 0; }\n:where(h1) { margin: 0; }\n' });
assert(attribute.some(error => error.endsWith('input[type="text"]')) && attribute.some(error => error.endsWith(':where(h1)')), 'VN-3: globale Attribut- und :where-Regel schlägt an');
const hidden = validateStyleConsolidation({ ...sources, 'depot-tranchen-manager.html': sources['depot-tranchen-manager.html']
    .replace('</main>', '<div hidden><input id="vn3Hidden" type="text" inputmode="decimal" data-money-input></div></main>') });
assert(!hidden.some(error => error.includes('vn3Hidden')), 'VN-3: Feld unter einem ausgeblendeten Vorfahren schlägt nicht an');
console.log('✅ DS-1: Stil-Konsolidierung geschützt');
