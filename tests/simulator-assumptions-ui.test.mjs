import fs from 'node:fs';
import { tokenizeHTML, matchesSelector } from './funktionsinventar-contract.mjs';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { initializeAssumptionsUI, refreshAssumptionNumbers, refreshAssumptionFillStatus } from '../app/simulator/simulator-assumptions-ui.js';
import { compactSimulatorTrancheStatus, initializeSimulatorTrancheAdapter } from '../app/simulator/simulator-portfolio-display.js';
import { setFieldState } from '../app/shared/field-state.js';

const html = fs.readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
const tree = tokenizeHTML(html);
const find = selector => tree.elements.filter(node => matchesSelector({ elements: [node] }, selector));
assertEqual(find('[data-step-go]').length, 0, 'Reine Weiter-/Zurücknavigation ist entfernt');
assertEqual(find('[data-assumption-step] .sim-step-status').length, 1, 'Profilwahl behält ihren Statuschip');
assertEqual(find('.sim-care-table tbody tr').length, 5, 'Kostenstaffel enthält weiterhin fünf Pflegegrade');
for (const prefix of ['p1', 'r2']) {
    const card = prefix === 'p1' ? '.sim-person-card[aria-labelledby="p1PersonSource"]' : '#sectionRente2';
    assertEqual(find(`${card}.ds-card`).length, 0, `${prefix}: Personenblock hat keine eigene ds-card`);
    const headingId = `${prefix}PersonSource`;
    assertEqual(find(`${card} h3#${headingId}`).length, 1, `${prefix}: Name ist eine Überschrift`);
    assertEqual(find(`#${headingId}.ds-source`).length, 0, `${prefix}: Name ist keine Herkunftszeile`);
    const suffixes = ['Geburtsdatum', 'StartAlter', 'Geschlecht', 'Rentenbeginn', 'Monatsrente',
        'StartInJahren', 'SparerPauschbetrag', 'KirchensteuerPct', ...(prefix === 'r2' ? ['Steuerquote'] : [])];
    for (const suffix of suffixes) {
        const id = `${prefix}${suffix}`;
        assertEqual(find(`#${id}`).length, 1, `${id} besitzt genau einen Wertträger`);
        assertEqual(find(`${card} #${id}`).length, 0, `${id} steht im Normalmodus außerhalb der Personenkarte`);
        assertEqual(find(`#personEditorCache #${id}`).length, 1, `${id} bleibt einmalig im verborgenen Editorcache erreichbar`);
        assertEqual(find(`[data-parameters="personen"] #${id}`).length, 0, `${id} ist getrennt von den Modellannahmen`);
        assertEqual(find(`#personEditorCache #${id}[disabled][data-no-persist="true"]`).length, 1,
            `${id} ist im Normalmodus gesperrt und von der Persistenz ausgeschlossen`);
    }
}
for (const id of ['rentAdjMode', 'rentAdjPct']) {
    assertEqual(find(`[data-assumption-step="4"] #${id}[disabled][data-no-persist="true"]`).length, 1,
        `${id} zeigt die gesperrte gemeinsame Rentenanpassung`);
    assertEqual(find(`[data-parameters="personen"] #${id}`).length, 0, `${id} ist getrennt von den Modellannahmen`);
}
for (const id of ['pflegeModellTyp', 'pflegeMinDauer', 'pflegeMaxDauer', 'pflegeRampUp', 'pflegeMaxFloor', 'pflegeRegionalZuschlag', 'pflegeKostenDrift']) {
    assertEqual(find(`#simCareDetails #${id}`).length, 1, `${id} liegt in der geschlossenen Pflegeklappe`);
}
assertEqual(find('.sim-care-duration-field #pflegeMinDauer').length, 1, 'Pflegedauer gruppiert den bisherigen Minimumcontrol');
assertEqual(find('.sim-care-duration-field #pflegeMaxDauer').length, 1, 'Pflegedauer gruppiert den bisherigen Maximumcontrol');
assertEqual(find('.sim-care-table input').length, 15, 'Alle Staffelcontrols bleiben native Eingaben');
assertEqual(find('.sim-care-table input[aria-label]').length, 15, 'Alle Staffelcontrols haben eindeutige zugängliche Namen');

const doc = createPresentationTestDocument();
const original = doc.createElement.bind(doc);
doc.createElement = tag => {
    const node = original(tag); node.dataset = {}; node.value = ''; node.type = ''; node.disabled = false;
    const classes = new Set();
    node.classList = { add: value => classes.add(value), contains: value => classes.has(value),
        toggle: (value, on) => on ? classes.add(value) : classes.delete(value) };
    return node;
};
const assumptionsHost = doc.createElement('section'); assumptionsHost.id = 'tab-annahmen'; doc.body.appendChild(assumptionsHost);
assumptionsHost.querySelector = () => null;
const frame = doc.createElement('div'); assumptionsHost.appendChild(frame);
const input = doc.createElement('input'); input.type = 'number'; input.id = 'startFloorBedarf'; frame.appendChild(input);
let canonicalValue = '', setterCalls = 0;
Object.defineProperty(input, 'value', { configurable: true, get() { return canonicalValue; }, set(value) {
    assert(this === input, 'Zahlenprojektion erhält den Empfänger des nativen Setters');
    setterCalls++; canonicalValue = String(value).trim() !== '' && Number.isFinite(Number(value)) ? String(value) : '';
} });
Object.defineProperty(input, 'valueAsNumber', { configurable: true,
    get() { return canonicalValue === '' ? NaN : Number(canonicalValue); },
    set(value) {
        assert(this === input, 'Numerischer Setter behält seinen nativen Empfänger');
        if (!Number.isFinite(value) && !Number.isNaN(value)) throw new TypeError('Nicht endlicher Zahlenwert');
        canonicalValue = Number.isNaN(value) ? '' : String(value);
    }
});
doc.querySelectorAll = selector => selector === '#tab-annahmen input[type="number"]' ? [input] : [];
input.min = '0'; input.max = '100000'; input.step = '0.01'; input.validity = { badInput: false };
let events = 0; input.dispatchEvent = () => { events++; };
const storage = new Map([['sim_startFloorBedarf', '24000.25']]);
initializeAssumptionsUI(doc);
const valueSetter = Object.getOwnPropertyDescriptor(input, 'value').set;
initializeAssumptionsUI(doc);
assertEqual(Object.getOwnPropertyDescriptor(input, 'value').set, valueSetter, 'Initialisierung bindet den Setter einmalig');
for (const [raw, display, valid] of [['24000.25', '24.000,25', true], ['0', '0', true], ['', '', false], ['-1234.5', '-1.234,5', true], ['1e6', '1.000.000', true]]) {
    const previousCalls = setterCalls;
    const attributesBefore = JSON.stringify([...input.attributes]);
    input.value = raw;
    assertEqual(frame.children[1].textContent, display, 'Programmatische Übernahme synchronisiert ohne Event und manuellen Refresh');
    assertEqual(setterCalls, previousCalls + 1, 'Native Wertzuweisung wird genau einmal ausgeführt');
    assertEqual(JSON.stringify([...input.attributes]), attributesBefore, 'Wertwechsel benötigt keine Attributmutation');
    for (const disabled of [false, true]) {
        input.disabled = disabled;
        refreshAssumptionNumbers(doc); refreshAssumptionNumbers(doc);
        assertEqual(input.value, raw, 'Anzeige verändert niemals den kanonischen Wert');
        assertEqual(frame.children[1].textContent, display, 'Anzeige unterscheidet Null, fehlende und negative Werte');
        assertEqual(input.classList.contains('sim-number-projected'), valid, 'Fehlende Werte bleiben im nativen Editor');
        assertEqual(input.disabled, disabled, 'Anzeige verändert keine Sperre');
        assertEqual(frame.children.length, 2, 'Mehrfacher Refresh erzeugt genau eine Anzeige');
    }
}
input.value = ''; input.validity.badInput = true; refreshAssumptionNumbers(doc);
assert(!input.classList.contains('sim-number-projected'), 'Ungültige native Eingabe wird nicht als Null verdeckt');
input.validity.badInput = false;
input.valueAsNumber = 98765.25;
assertEqual(frame.children[1].textContent, '98.765,25', 'Numerische programmatische Zuweisung aktualisiert dieselbe Anzeige');
let setterError;
try { input.valueAsNumber = Infinity; } catch (error) { setterError = error; }
assert(setterError instanceof TypeError, 'Native Setterfehler bleiben beobachtbar');
assertEqual(frame.children[1].textContent, '98.765,25', 'Abgewiesene native Zuweisung verändert die Anzeige nicht');
input.valueAsNumber = NaN;
assertEqual(input.value, '', 'Native NaN-Normalisierung bleibt erhalten');
assertEqual(frame.children[1].textContent, '', 'Numerischer Leerwert erscheint nicht als Null');
input.value = 'kein Zahlenwert';
assertEqual(input.value, '', 'Stringzuweisung behält die native Zahlenfeldnormalisierung');
assertEqual(frame.children[1].textContent, '', 'Anzeige liest den normalisierten kanonischen Wert');
assertEqual(events, 0, 'Profilübernahme und wiederholter Anzeigenrefresh erzeugen keine Fachereignisse');
assertEqual(JSON.stringify([...storage]), '[["sim_startFloorBedarf","24000.25"]]', 'Anzeige schreibt keine persistierten Werte');
assertEqual([input.min, input.max, input.step].join(','), '0,100000,0.01', 'Parserdomäne bleibt unverändert');

// Der echte Feldbesitzer erzeugt bei Übernahme/Pflege aus einen Beschreibungsknoten.
// Er darf die benachbarten checked/focus-Selektoren des Sliders nicht unterbrechen.
const toggleLabel = doc.createElement('label'); toggleLabel.classList.add('ds-toggle'); assumptionsHost.appendChild(toggleLabel);
const toggleInput = doc.createElement('input'); toggleInput.id = 'reason-toggle'; toggleInput.type = 'checkbox';
toggleInput.checked = true; toggleInput.disabled = true; toggleLabel.appendChild(toggleInput);
const slider = doc.createElement('span'); slider.classList.add('ds-slider'); toggleLabel.appendChild(slider);
Object.defineProperty(toggleInput, 'parentElement', { get() { return this.parentNode; } });
const numberQuery = doc.querySelectorAll;
for (const state of ['adopted', 'inactive', 'adopted']) {
    const reason = setFieldState(toggleInput, state, 'Synthetischer unveränderter Sperrgrund');
    Object.defineProperty(reason, 'parentElement', { configurable: true, get() { return this.parentNode; } });
    assert(toggleInput.nextSibling === reason, 'Echter Feldbesitzer setzt den Grund zunächst zwischen Input und Slider');
    doc.querySelectorAll = selector => selector === '#tab-annahmen .ds-field-reason' ? [reason] : numberQuery(selector);
    refreshAssumptionFillStatus(doc);
    assert(toggleInput.nextSibling === slider && toggleLabel.nextSibling === reason, 'Grundprojektion erhält Checkbox unmittelbar vor Slider und Grund außerhalb des Labels');
    assert(toggleInput.getAttribute('aria-describedby').includes(reason.id) && reason.textContent === 'Synthetischer unveränderter Sperrgrund', 'Umgesetzter Grund bleibt gültiges unverändertes ARIA-Ziel');
    assert(toggleInput.checked && toggleInput.disabled, 'Grundprojektion verändert weder Schaltwert noch Sperre');
}
doc.querySelectorAll = numberQuery;

// Das echte HTML als Elementbaum: Klappen bleiben geschlossen, nur die
// tatsächlich zugänglichen Felder ihrer Untergruppen werden gezählt.
const markupDoc = createPresentationTestDocument();
const domNodes = new Map();
const query = (scope, selector) => selector.split(',').flatMap(part => {
    const excludedTypes = [...part.matchAll(/:not\(\[type="([^"]+)"\]\)/g)].map(match => match[1]);
    const checked = part.includes(':checked');
    const clean = part.replace(/:not\(\[type="[^"]+"\]\)/g, '').replace(':checked', '').trim();
    return tree.elements.filter(parsed => {
        if (!matchesSelector({ elements: [parsed] }, clean) || excludedTypes.includes(parsed.attrs.type)) return false;
        if (checked && !domNodes.get(parsed).checked) return false;
        for (let parent = parsed.parent; parent; parent = parent.parent) if (parent === scope) return true;
        return false;
    }).map(parsed => domNodes.get(parsed));
});
for (const parsed of tree.elements) {
    const node = markupDoc.createElement(parsed.tag);
    domNodes.set(parsed, node);
    for (const [name, value] of Object.entries(parsed.attrs)) node.setAttribute(name, value);
    node.dataset = Object.fromEntries(Object.entries(parsed.attrs).filter(([key]) => key.startsWith('data-'))
        .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    node.className = parsed.attrs.class ?? '';
    const classes = new Set(node.className.split(/\s+/));
    node.classList = { add: value => classes.add(value), contains: value => classes.has(value),
        toggle: (value, on) => on ? classes.add(value) : classes.delete(value) };
    node.type = parsed.attrs.type; node.value = parsed.attrs.value ?? ''; node.hidden = 'hidden' in parsed.attrs;
    node.disabled = 'disabled' in parsed.attrs; node.checked = 'checked' in parsed.attrs;
    node.style = Object.fromEntries((parsed.attrs.style ?? '').split(';').filter(s => s.includes(':')).map(s => s.split(':').map(p => p.trim())));
    node.querySelectorAll = selector => query(parsed, selector);
    node.querySelector = selector => selector === '.sim-parameter-count'
        ? node.children.find(child => child.className === selector.slice(1)) : query(parsed, selector)[0] ?? null;
    node.matches = selector => matchesSelector({ elements: [parsed] }, selector);
    (domNodes.get(parsed.parent) ?? markupDoc.body).appendChild(node);
}
markupDoc.querySelectorAll = selector => query(tree.document, selector);
markupDoc.querySelector = selector => markupDoc.querySelectorAll(selector)[0] ?? null;
const parameterDetails = markupDoc.querySelectorAll('.sim-parameters');
const counts = { portfolio: 0, personen: 4 };
for (const partner of [false, true, false]) {
    markupDoc.getElementById('sectionRente2').style.display = partner ? 'block' : 'none';
    {
        assertEqual(markupDoc.getElementById('accumulationPhaseDetails'), null, 'Entfernte Ansparbedienung hat keinen Klapphost');
        refreshAssumptionFillStatus(markupDoc); refreshAssumptionFillStatus(markupDoc);
        for (const detail of parameterDetails) {
            const key = detail.dataset.parameters;
            const summary = detail.querySelector('summary');
            const expected = counts[key];
            assertEqual(summary.querySelector('.sim-parameter-count').textContent, `${expected} weitere`,
                `${key}: echtes Markup zählt bedienbare Controls, Partner=${partner}`);
            assertEqual(detail.hidden, expected === 0, `${key}: nur Klappen mit bedienbaren Zusatzfeldern sind sichtbar`);
            assertEqual(summary.children.filter(child => child.className === 'sim-parameter-count').length, 1, 'Refresh dupliziert keinen Zähler');
            assert(!detail.open, 'Zählung erfordert kein Öffnen der Klappen');
        }
    }
}
// Die Pflegeklappe bleibt auch mit ausgeschalteter Logik erreichbar.
const careDetails = markupDoc.getElementById('simCareDetails');
const careToggle = markupDoc.getElementById('pflegefallLogikAktivieren');
careToggle.checked = false; refreshAssumptionFillStatus(markupDoc);
assert(!careDetails.hidden && !careDetails.open, 'Pflege aus verändert den geschlossenen Detailzugang nicht');
assertEqual(markupDoc.getElementById('simCareSummary').textContent, 'Pflegefälle werden nicht gerechnet.', 'Zusammenfassung folgt dem Schalter');
careToggle.checked = true; refreshAssumptionFillStatus(markupDoc);
assert(markupDoc.getElementById('simCareSummary').textContent.includes('120.000 €')
    && markupDoc.getElementById('simCareSummary').textContent.includes('3,5 %'), 'Pflegezusammenfassung zeigt die bestehenden Kostenannahmen');
const goldOff = markupDoc.getElementById('simGoldOff');
markupDoc.getElementById('goldAllokationAktiv').value = 'false'; refreshAssumptionFillStatus(markupDoc);
assert(!goldOff.hidden && markupDoc.getElementById('simGoldBandFrame').dataset.goldActive === 'false', 'Gold aus ersetzt den normalen Bandwert');
markupDoc.getElementById('goldAllokationAktiv').value = 'true'; refreshAssumptionFillStatus(markupDoc);
assert(goldOff.hidden && markupDoc.getElementById('simGoldBandFrame').dataset.goldActive === 'true', 'Gold aktiv zeigt das erhaltene Band');
assertEqual(find('.care-panel-toggle .ds-info .ds-info-pop #simCareReserve').length, 1, 'Reservewerthost liegt im Infofeld direkt am Pflegeschalter');
assertEqual(find('.care-panel-toggle label #simCareReserve').length, 0, 'Pflegeschalter enthält nur seine Beschriftung');
assert(html.match(/<span id="simCareReserveInfo"[^>]*>[\s\S]*?<\/span>/)?.[0].includes('Die Reserve bleibt auch bei ausgeschalteter Pflegelogik erhalten.'),
    'Reserveerklärung bleibt im Infofeld erhalten');
assertEqual(find('.sim-dynamic-flex-field #dynamicFlexPreset').length, 1, 'Presetselect bleibt in der breiten Strategiefeldgruppe');
assertEqual(find('#chkPartnerAktiv[hidden][disabled][data-no-persist="true"]').length, 1,
    'Partnerstatus bleibt ein gesperrter, unsichtbarer und nicht persistierter Profilwertträger');
assertEqual(find('[data-assumption-step="4"] #personDeviationToggle[data-no-persist="true"]').length, 1,
    'Die dokumentlokale Personenabweichung bleibt über einen eigenen Schalter erreichbar');
for (const id of ['pflegefallLogikAktivieren', 'personDeviationToggle', 'runBacktestCohorts', 'toggle-backtest-detail', 'toggle-log-detail']) {
    const checkbox = find(`#${id}`)[0];
    assert(checkbox.parent.attrs.class.includes('ds-toggle'), `${id}: bestehende Checkbox bleibt im nativen Label`);
    const siblings = tree.elements.filter(node => node.parent === checkbox.parent);
    assertEqual(siblings[siblings.indexOf(checkbox) + 1].attrs.class, 'ds-slider', `${id}: Slider folgt unmittelbar auf die Checkbox`);
}

// Derselbe Host wird vom gemeinsamen Writer wiederholt ersetzt.
const host = doc.createElement('div'); host.id = 'tranchenStatusBadge'; doc.body.appendChild(host);
let block;
host.querySelector = () => block;
const writer = (state, warnings) => {
    block = doc.createElement('div'); block.dataset.tranchenState = state;
    block.querySelectorAll = () => warnings.map(({ text, error }) => {
        const node = doc.createElement('span'); node.textContent = text;
        if (error) node.setAttribute('role', 'alert');
        return node;
    });
    host.replaceChildren(block);
};
for (const state of ['valid', 'empty', 'error', 'not_loaded', 'valid']) {
    writer(state, [{ text: '⚠️ 1 Tranche(n) ohne Marktwert und 2 ohne Einstand.' },
        { text: '⚠️ 3 Realverkäufe mit offener manueller Cashbuchung.' },
        { text: '⚠️ Cashstatus-Audit ist beschädigt; Cashaussagen sind blockiert.', error: true },
        { text: 'Kein offener manueller Cashrückstand. Altverkäufe sind nicht cashbestätigt.' }]);
    const status = { state, count: 4, totalValue: 12345, totalCost: 10000 };
    compactSimulatorTrancheStatus(host, status);
    const text = block.children.map(n => n.textContent).join(' ');
    assert(text.includes('ohne Marktwert') && text.includes('ohne Einstand') && text.includes('offener manueller Cashbuchung'), `${state}: Bestands- und offene Cashwarnungen erhalten`);
    assert(text.includes('Cashstatus-Audit') && text.includes('nicht cashbestätigt'), `${state}: Audit- und Legacywarnungen erhalten`);
    assertEqual(block.children.filter(n => n.getAttribute('role') === 'alert').length, 1, `${state}: Auditfehler bleibt ein Alert`);
    assert(!/FIFO|⚠|✅/.test(text), `${state}: kompakter Status enthält keine Emojis oder FIFO-Satz`);
    compactSimulatorTrancheStatus(host, status);
    assertEqual(block.children.length, 5, `${state}: wiederholte Projektion dupliziert keine Warnung`);
    if (state === 'error') assertEqual(block.getAttribute('role'), 'alert', 'Fehlerhafter Bestand bleibt als Alert sichtbar');
}
// Registrierung am tatsächlichen Host, erneuter gemeinsamer Writer löst Adapter aus.
let callback, registrations = 0;
doc.defaultView = { MutationObserver: class {
    constructor(fn) { callback = fn; registrations++; }
    observe(node, options) { assert(node === host && options.subtree, 'Adapter beobachtet den wiederverwendeten Host'); }
    disconnect() {}
} };
initializeSimulatorTrancheAdapter(doc); initializeSimulatorTrancheAdapter(doc);
assertEqual(registrations, 1, 'Tranchenadapter wird pro Host genau einmal gebunden');
const previousWindow = globalThis.window;
globalThis.window = { __profilverbundTranchenOverride: [] };
try { writer('empty', []); await callback(); } finally { globalThis.window = previousWindow; }
assertEqual(block.children[0].textContent, 'Tranchenbestand ist leer.', 'Refresh wird erneut kompakt dargestellt');

// Kompakter Versuch: Kopfaktionen liegen außerhalb der zuklappbaren Inhalte.
assert(!tree.elements.some(element => element.attrs.id === 'simPlanSource'), 'Große Plankarte ist entfernt');
for (const id of ['simPlanTrialStart', 'simPlanTrialStrategy']) {
    const action = tree.elements.find(element => element.attrs.id === id);
    assert(action && Object.hasOwn(action.attrs, 'data-plan-trial-toggle'), id + ': gemeinsamer Kopfselektor');
    let insideContent = false;
    for (let parent = action.parent; parent; parent = parent.parent)
        if ((parent.attrs?.class || '').split(' ').includes('sim-step-content')) insideContent = true;
    assert(!insideContent, id + ': Aktion bleibt bei geschlossenem Schritt erreichbar');
}
const trialBand = tree.elements.find(element => element.attrs.id === 'simPlanTrialBand');
assert(Object.hasOwn(trialBand.attrs, 'hidden'), 'Kompaktes Versuchsband ist ohne Versuch verborgen');
const runwayField = tree.elements.find(element => element.attrs.id === 'liquidityRunwayYears');
assert(runwayField && !Object.hasOwn(runwayField.attrs, 'hidden'), 'Liquiditäts-Reichweite bleibt unabhängig vom Versuch vorhanden');
for (let parent = runwayField.parent; parent; parent = parent.parent)
    assert(parent !== trialBand, 'Liquiditäts-Reichweite liegt außerhalb des Versuchsbandes');

// U-2: Sichtbarkeit beim Aufruf des Annahmenreiters, ohne gespeicherte Klappzustände.
const byId = id => tree.elements.find(item => item.attrs.id === id);
const inside = (item, host) => { for (let parent = item; parent; parent = parent.parent) if (parent === host) return true; return false; };
const visible = item => {
    for (let parent = item; parent && parent !== byId('tab-annahmen'); parent = parent.parent) {
        if ('hidden' in parent.attrs || /display:\s*none/.test(parent.attrs.style || '')) return false;
        if (parent.parent?.tag === 'details' && parent.tag !== 'summary' && !('open' in parent.parent.attrs)) return false;
    }
    return inside(item, byId('tab-annahmen'));
};
const needCard = tree.elements.find(item => item.attrs['aria-labelledby'] === 'simNeedHeading');
assertEqual(tree.elements.filter(item => item.tag === 'input' && inside(item, needCard)).map(item => item.attrs.id).join(','),
    'startFloorBedarf,startFlexBedarf,minimumFlexAnnual', 'Bedarf enthält genau dieselben drei Planfelder wie Balance');
assert(['startFloorBedarf', 'startFlexBedarf', 'minimumFlexAnnual'].every(id => visible(byId(id))), 'Bedarf ist offen sichtbar');
for (const id of ['mcSetupDisclosure', 'simPersonDetails', 'simCareDetails']) assert(!('open' in byId(id).attrs), id + ': bei jedem Seitenaufruf geschlossen');
for (const id of ['marketCapeRatio', 'flexBudgetAnnual', 'liquidityRunwayYears', 'dynamicFlexPreset', 'rebalancingBand', 'mcAnzahl', 'mcDauer', 'stressPreset'])
    assert(inside(byId(id), byId('mcSetupDisclosure')) && !visible(byId(id)), id + ': nur hinter Alle Parameter');
assertEqual(find('.sim-parameter-card h3[data-plan-group-label]').map(item => item.attrs['data-plan-group-label']).join(','), '1,4,2,5,3', 'Gemeinsame Gruppen folgen dem Spaltenaufbau von Balance');
assert(visible(byId('p1PersonValues')) && visible(byId('pflegefallLogikAktivieren')) && visible(byId('simCareSummary')), 'Personenübersicht, Pflegeschalter und Zusammenfassung sind sichtbar');
assert(!visible(byId('sharedPensionValues')) && !visible(byId('pflegeModellTyp')) && !visible(byId('widowPensionMode')), 'Rentenanpassung, Modell- und Pflegeannahmen liegen hinter den Details');
