import { setFieldState } from '../app/shared/field-state.js';
import { writeBoundHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { initDynamicFlexControls, refreshDynamicFlexControls } from '../app/simulator/simulator-main-dynamic-flex.js';
import { initRentAdjModeUI, refreshRentAdjustmentPresentation } from '../app/simulator/simulator-main-rent-adjust.js';
import { initPartnerToggle, refreshPartnerPresentation } from '../app/simulator/simulator-main-partner.js';
import { initThreeBucketControls, refreshThreeBucketControls } from '../app/simulator/simulator-main-3bucket.js';
import { initializePflegeUIControls } from '../app/simulator/simulator-ui-pflege.js';
import { initRente2ConfigWithLocalStorage } from '../app/simulator/simulator-ui-rente.js';
import { initMonteCarloMethodControls, createMonteCarloUI } from '../app/simulator/monte-carlo-ui.js';
import { PersistenceFacade } from '../app/shared/persistence-facade.js';
import { readSources, validateSimulatorFields, validateFoundation, validateComponents, createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { tokenizeHTML } from './funktionsinventar-contract.mjs';
import { formatCurrency } from '../app/simulator/simulator-utils.js';
import { formatDisplayNumber } from '../app/simulator/simulator-portfolio-format.js';
import { initializeAssumptionsUI, refreshAssumptionFillStatus, refreshAssumptionSegments, revealAssumptionControl } from '../app/simulator/simulator-assumptions-ui.js';

const sources = readSources();
assertEqual(validateSimulatorFields(sources).join('\n'), '', 'Simulator-Feldconsumer erfüllen den Darstellungsvertrag');
assertEqual(validateFoundation(sources).join('\n'), '', 'Feldconsumer behalten Token- und Kontrastvertrag');
assertEqual(validateComponents(sources).join('\n'), '', 'Feldconsumer behalten Komponentenvertrag');
for (const [path, mutate, expected] of [
    ['app/simulator/simulator-main-dynamic-flex.js', s => s + '\nnode.style.opacity = 0.65;', 'Feld-Textdeckkraft'],
    ['app/simulator/simulator-ui-pflege.js', s => s.replace('var(--text-muted)', '#555'), 'Feldfarbe ohne Token'],
    ['app/simulator/simulator-portfolio-display.js', s => s.replaceAll('calculated-display ds-metric', 'calculated-display'), 'Startallokation'],
    ['Simulator.html', s => s.replace('class="ds-select"', 'class=""'), 'Simulator-Feldrolle'],
    ['Simulator.html', s => s.replace('id="telemetryToggle" class="ds-checkbox" />', 'id="telemetryToggle" / class="ds-checkbox">'), 'Simulator-Feldsyntax'],
    ['Simulator.html', s => s.replace('<select id="p1KirchensteuerPct" class="ds-select"', '<select id="p1KirchensteuerPct" / class="ds-select"'), 'Simulator-Feldsyntax'],
    ['Simulator.html', s => s.replace('<input type="hidden" id="depotwertAlt"', '<input type="hidden" / id="depotwertAlt"'), 'Simulator-Feldsyntax']
]) {
    const changed = mutate(sources[path]);
    assert(changed !== sources[path], `Wirksame Gegenprobe ${expected}`);
    assert(validateSimulatorFields({ ...sources, [path]: changed }).some(e => e.includes(expected)), `Abgelehnte Gegenprobe ${expected}`);
}
for (const tag of [
    '<input type="text" class="ds-input">',
    '<input type="text" class="ds-input" />',
    '<input type="text" title="€/Jahr > 0" class="ds-input" />',
    '<input type="text" title=€/Jahr class="ds-input">',
    '<select title=\'€/Jahr\' class="ds-select">'
]) {
    assertEqual(validateSimulatorFields({ ...sources, 'Simulator.html': tag }).join('\n'), '', `Zulässige Feldsyntax: ${tag}`);
}

// DOM mit echten Eltern-/Geschwisterbeziehungen und mehreren Listenern je Ereignis.
function fixture(values = {}) {
    const doc = createPresentationTestDocument();
    const originalCreate = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = originalCreate(tag.toUpperCase());
        node.dataset = {}; node.value = ''; node.checked = false; node.disabled = false; node.type = '';
        node.listeners = {};
        node.addEventListener = (type, fn) => (node.listeners[type] ||= []).push(fn);
        node.removeEventListener = (type, fn) => { node.listeners[type] = (node.listeners[type] || []).filter(f => f !== fn); };
        node.dispatchEvent = event => { for (const fn of node.listeners[event.type] || []) fn({ target: node, ...event }); };
        node.closest = selector => selector === '.ds-field' ? node.parentNode : null;
        node.matches = selector => selector === 'details' && node.tagName === 'DETAILS';
        node.focus = () => { doc.activeElement = node; };
        Object.defineProperty(node, 'parentElement', { get: () => node.parentNode });
        return node;
    };
    for (const [id, value] of Object.entries(values)) {
        const parent = doc.createElement('div'); doc.body.appendChild(parent);
        const field = doc.createElement('input'); field.id = id; parent.appendChild(field);
        if (typeof value === 'object') Object.assign(field, value); else field.value = String(value);
    }
    globalThis.document = doc;
    return { doc, field: id => doc.getElementById(id), fire: (id, type = 'change') => doc.getElementById(id).dispatchEvent({ type }) };
}
const state = field => field.getAttribute('data-field-state');
const reason = field => (field.getAttribute('aria-describedby') || '').split(/\s+/).map(id => field.ownerDocument.getElementById(id)?.textContent || '').join(' ');
const previous = { document: globalThis.document, window: globalThis.window, localStorage: globalThis.localStorage };
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.window = {};
PersistenceFacade.resetPersistenceRuntimeForTests();
try {
    const flexFields = {
        dynamicFlexPreset: 'custom', dynamicFlexShowAdvanced: { checked: true, type: 'checkbox' },
        dynamicFlex: { checked: true, type: 'checkbox' }, horizonMethod: 'survival_quantile', horizonYears: '30', survivalQuantile: '0.85',
        goGoActive: { checked: true, type: 'checkbox' }, goGoMultiplier: '1.1', longevityMode: 'none',
        longevityQuantileShift: '0.03', longevityRelativePct: '10', longevityBufferYears: '3',
        dynamicFlexConfigGroup: '', dynamicFlexAdvancedToggleRow: ''
    };
    const f = fixture(flexFields);
    f.field('horizonYears').setAttribute('aria-describedby', 'horizonYearsApplicability');
    initDynamicFlexControls({ enableLocalPersistence: false });
    assertEqual(state(f.field('horizonYears')), 'inactive', 'B16/S09: aktuarischer Horizont ist bei Init nicht anwendbar');
    assert(f.field('horizonYears').getAttribute('aria-describedby').startsWith('horizonYearsApplicability '), 'S09: bisherige Erläuterung bleibt additiv erhalten');
    // Beide Seiten verwenden denselben Controller; alle bisherigen Entscheidungsbedingungen bleiben identisch.
    for (const detail of [false, true]) for (const enabled of [false, true]) for (const goGo of [false, true]) {
        for (const method of ['mean', 'survival_quantile', 'direct']) for (const longevity of ['none', 'quantile_shift', 'relative_horizon_buffer', 'buffer_years']) {
            f.field('dynamicFlexPreset').value = detail ? 'custom' : 'konservativ';
            f.field('dynamicFlexShowAdvanced').checked = detail;
            f.field('dynamicFlex').checked = enabled; f.field('goGoActive').checked = goGo;
            f.field('horizonMethod').value = method; f.field('longevityMode').value = longevity;
            const values = Object.fromEntries(Object.keys(flexFields).map(id => [id, f.field(id).value]));
            refreshDynamicFlexControls();
            assertEqual(f.field('dynamicFlexConfigGroup').style.display, detail ? 'grid' : 'none', 'B15/S08: bisherige Detailsichtbarkeit');
            const baseDisabled = !detail || !enabled;
            const disabled = {
                dynamicFlex: !detail, horizonMethod: baseDisabled, horizonYears: baseDisabled, survivalQuantile: baseDisabled,
                goGoActive: baseDisabled, goGoMultiplier: baseDisabled || !goGo, longevityMode: baseDisabled,
                longevityQuantileShift: baseDisabled || longevity !== 'quantile_shift',
                longevityRelativePct: baseDisabled || longevity !== 'relative_horizon_buffer',
                longevityBufferYears: baseDisabled || longevity !== 'buffer_years'
            };
            for (const [id, expected] of Object.entries(disabled)) {
                const inactive = expected || (id === 'horizonYears' && method !== 'direct') || (id === 'survivalQuantile' && method !== 'survival_quantile');
                assertEqual(f.field(id).disabled, expected, `B15–B17/S08–S10: unveränderte Sperre ${id}`);
                assertEqual(f.field(id).value, values[id], `B15–B17/S08–S10: unveränderter Wert ${id}`);
                assertEqual(state(f.field(id)), inactive ? 'inactive' : 'editable', `B15–B17/S08–S10: synchroner Zustand ${id}`);
                if (inactive) assert(reason(f.field(id)).trim().length > 0, `B15–B17/S08–S10: konkreter Grund ${id}`);
            }
        }
    }
    for (const preset of ['off', 'konservativ', 'ausgewogen', 'offensiv']) {
        f.field('dynamicFlexShowAdvanced').checked = false;
        f.field('dynamicFlexPreset').value = preset; f.fire('dynamicFlexPreset');
        assertEqual(f.field('dynamicFlex').checked, preset !== 'off', `B15/S08: Presetwechsel ${preset}`);
        assertEqual(f.field('dynamicFlexConfigGroup').style.display, 'none', `B15/S08: Preset synchronisiert Details ${preset}`);
        f.field('dynamicFlexShowAdvanced').checked = true; f.fire('dynamicFlexShowAdvanced');
        assertEqual(f.field('dynamicFlexConfigGroup').style.display, 'grid', `B15/S08: Detailfreigabe nach Preset ${preset}`);
    }
    f.field('dynamicFlex').checked = false; f.fire('dynamicFlex');
    assertEqual(state(f.field('goGoActive')), 'inactive', 'B17/S10: Togglewechsel synchronisiert Grund');
    f.field('dynamicFlex').checked = true; f.field('dynamicFlexShowAdvanced').checked = true; f.fire('dynamicFlexShowAdvanced');
    f.field('horizonMethod').value = 'mean'; f.fire('horizonMethod');
    assert(reason(f.field('survivalQuantile')).includes('Erwartungswert'), 'S09: Methodenwechsel nennt Nichtanwendbarkeit');
    f.field('goGoActive').checked = false; f.fire('goGoActive');
    assert(reason(f.field('goGoMultiplier')).includes('Go-Go'), 'B17/S10: Go-Go-Wechsel nennt Grund');
    f.field('longevityMode').value = 'buffer_years'; f.fire('longevityMode');
    assertEqual(state(f.field('longevityBufferYears')), 'editable', 'B17/S10: Langlebigkeitswechsel entfernt alten Grund');

    // Derselbe Controller mit reiner Detailnavigation: kein change, kein neuer Speicherwert.
    const detail = f.doc.createElement('details');
    detail.open = false;
    const host = f.doc.createElement('section'); host.id = 'tab-annahmen';
    host.querySelector = selector => selector === '[data-parameters="strategie"]' ? detail : null;
    const classes = () => {
        const values = new Set();
        return { add: value => values.add(value), toggle: (value, on) => on ? values.add(value) : values.delete(value), contains: value => values.has(value) };
    };
    const steps = [1, 2].map(n => {
        const step = f.doc.createElement('section'); step.classList = classes();
        const button = f.doc.createElement('button'); button.setAttribute('aria-controls', `simStep${n}Content`);
        button.setAttribute('aria-expanded', 'true');
        const body = f.doc.createElement('div'); body.id = `simStep${n}Content`; body.hidden = false;
        const indicator = f.doc.createElement('span');
        const field = f.doc.createElement('input'); field.type = 'number'; field.value = '0';
        step.querySelectorAll = () => [field];
        step.querySelector = selector => selector === '[data-step-toggle]' ? button
            : selector === '.sim-step-content' ? body : selector === '.progress-indicator' ? indicator : null;
        button.closest = selector => selector === '[data-step-toggle]' ? button : null;
        return { step, button, body, indicator, field };
    });
    const select = f.field('dynamicFlexPreset');
    const nativeSelect = f.doc.createElement('select'); nativeSelect.value = 'native';
    const label = f.doc.createElement('label'); label.textContent = 'Dynamic Flex'; label.setAttribute('for', select.id);
    label.closest = selector => selector === 'label[for]' ? label : null;
    const group = f.doc.createElement('div'); group.dataset.selectSegment = select.id; group.classList = classes();
    const segment = f.doc.createElement('button'); segment.dataset.value = 'off';
    const selectedSegment = f.doc.createElement('button'); selectedSegment.dataset.value = 'ausgewogen';
    group.querySelectorAll = () => [segment, selectedSegment];
    segment.closest = selector => selector === '[data-select-segment]' ? group
        : selector === '[data-select-segment] button[data-value]' ? segment : null;
    select.classList = classes();
    f.doc.querySelectorAll = selector => selector === '[data-assumption-step]' ? steps.map(s => s.step)
        : selector === '[data-select-segment]' ? [group] : [];
    f.doc.querySelector = selector => selector === '#tab-annahmen [data-parameters="strategie"]' ? detail
        : selector === `label[for="${select.id}"]` ? label : null;
    f.field('dynamicFlexShowAdvanced').checked = false;
    select.value = 'ausgewogen';
    const inputSnapshot = () => JSON.stringify(Object.fromEntries(Object.keys(flexFields).map(id => [id, {
        value: f.field(id).value, checked: f.field(id).checked
    }])));
    const storedBefore = JSON.stringify([...store]);
    const valuesBefore = inputSnapshot();
    initializeAssumptionsUI(f.doc);
    assertEqual(select.getAttribute('tabindex'), '-1', 'Gebundenes Select entfällt aus der Tabreihenfolge');
    assertEqual(select.getAttribute('aria-hidden'), 'true', 'Gebundenes Select entfällt aus dem Barrierefreiheitsbaum');
    assertEqual(group.getAttribute('aria-label'), label.textContent, 'Segmentgruppe übernimmt die zugängliche Labelbezeichnung');
    assertEqual(nativeSelect.getAttribute('tabindex'), null, 'Select ohne Segment erhält keine Tabänderung');
    assertEqual(nativeSelect.getAttribute('aria-hidden'), null, 'Select ohne Segment bleibt zugänglich');
    revealAssumptionControl(nativeSelect);
    assertEqual(f.doc.activeElement, nativeSelect, 'Select ohne Segment bleibt direkt fokussierbar');
    const selectField = select.parentElement;
    detail.appendChild(selectField); steps[0].step.appendChild(detail);
    select.closest = selector => selector === '[data-assumption-step]' ? steps[0].step : selector === '.ds-field' ? selectField : null;
    detail.open = false; steps[0].body.hidden = true;
    revealAssumptionControl(select);
    assertEqual(f.doc.activeElement, selectedSegment, 'Korrekturzugang fokussiert den gedrückten Segmentknopf');
    assert(detail.open && !steps[0].body.hidden, 'Korrekturzugang öffnet Schritt und Detailklappe');
    selectedSegment.disabled = true;
    revealAssumptionControl(select);
    assertEqual(f.doc.activeElement, segment, 'Bei gesperrter Auswahl erhält der erste freigegebene Knopf Fokus');
    refreshAssumptionSegments(f.doc);
    let labelDefaultPrevented = false;
    host.dispatchEvent({ type: 'click', target: label, preventDefault: () => { labelDefaultPrevented = true; } });
    assert(labelDefaultPrevented, 'Labelaktivierung unterbindet den unsichtbaren nativen Fokus');
    assertEqual(f.doc.activeElement, selectedSegment, 'Labelaktivierung fokussiert den gedrückten Segmentknopf');
    const clicks = host.listeners.click.length;
    initializeAssumptionsUI(f.doc);
    assertEqual(host.listeners.click.length, clicks, 'Annahmenbindung ist pro Dokument einmalig');
    for (const open of [true, false, true]) {
        detail.open = open; detail.dispatchEvent({ type: 'toggle' });
        assertEqual(inputSnapshot(), valuesBefore, 'Detailklappe verändert keine Eingabewerte');
        assertEqual(JSON.stringify([...store]), storedBefore, 'Detailklappe schreibt keine Speicherwerte');
        assertEqual(f.field('dynamicFlexConfigGroup').style.display, open ? 'grid' : 'none', 'Alle Parameter zeigen erreicht Dynamic-Flex-Details');
    }
    host.dispatchEvent({ type: 'click', target: steps[0].button });
    assert(steps[0].body.hidden && !steps[1].body.hidden, 'Schritte sind unabhängig einklappbar');
    assertEqual(steps[0].button.getAttribute('aria-expanded'), 'false', 'Klappstatus ist zugänglich');
    host.dispatchEvent({ type: 'click', target: steps[0].button });
    assert(!steps[0].body.hidden, 'Schritt öffnet wieder ohne Eingabeverlust');
    for (const [value, disabled, expected] of [['', false, false], ['0', false, false], ['12000', true, false], ['12000', false, true]]) {
        Object.assign(steps[0].field, { value, disabled });
        refreshAssumptionFillStatus(f.doc);
        assertEqual(steps[0].step.classList.contains('has-data'), expected, 'Füllstatus folgt bisherigen Wert- und Sperrbedingungen');
    }
    steps[0].field.value = '0'; host.dispatchEvent({ type: 'input' });
    assert(!steps[0].step.classList.contains('has-data'), 'Nutzereingabe aktualisiert Füllstatus');
    steps[0].field.value = '9000'; refreshAssumptionFillStatus(f.doc);
    assert(steps[0].step.classList.contains('has-data'), 'Programmatische Übernahme aktualisiert Füllstatus');
    select.disabled = true; refreshAssumptionSegments(f.doc);
    f.doc.activeElement = nativeSelect;
    revealAssumptionControl(select);
    assertEqual(f.doc.activeElement, nativeSelect, 'Profilsperre erzeugt keinen Fokus auf dem unsichtbaren Select');
    assertEqual(selectedSegment.disabled, true, 'Profilsperre sperrt auch den gedrückten Segmentknopf');
    host.dispatchEvent({ type: 'click', target: segment });
    assertEqual(select.value, 'ausgewogen', 'Segment umgeht keine Profilsperre');
    assertEqual(segment.disabled, true, 'Segment übernimmt native Selectsperre');
    select.disabled = false; refreshAssumptionSegments(f.doc);
    let changes = 0;
    select.addEventListener('change', () => { changes++; });
    host.dispatchEvent({ type: 'click', target: segment });
    assertEqual(changes, 1, 'Segment löst genau ein natives change am bisherigen Select aus');
    host.dispatchEvent({ type: 'click', target: segment });
    assertEqual(changes, 1, 'Erneute Aktivierung derselben Auswahl erzeugt kein weiteres change');
    assertEqual(select.value, 'off', 'Segment setzt den echten Selectwert');
    assertEqual(f.field('dynamicFlex').checked, false, 'Segment erreicht den vorhandenen Presetbinder');
    refreshAssumptionSegments(f.doc);
    assertEqual(segment.getAttribute('aria-pressed'), 'true', 'Segmentzustand folgt dem kanonischen Selectwert');

    const r = fixture({ rentAdjMode: 'wage', rentAdjPct: '2.0' });
    r.field('rentAdjPct').setAttribute('data-no-persist', 'true');
    initRentAdjModeUI();
    for (const mode of ['wage', 'fix', 'cpi', 'fix']) {
        r.field('rentAdjMode').value = mode; r.fire('rentAdjMode');
        assertEqual(r.field('rentAdjPct').disabled, mode !== 'fix', 'S14: unveränderte Modussperre');
        assertEqual(r.field('rentAdjPct').parentNode.style.display, mode === 'fix' ? 'flex' : 'none', 'S14: unveränderte Sichtbarkeit');
        assertEqual(r.field('rentAdjPct').value, '2.0', 'S14: Prozentwert unverändert');
        assertEqual(r.field('rentAdjPct').getAttribute('data-no-persist'), 'true', 'S14: Attribut unverändert');
        assert(reason(r.field('rentAdjMode')).includes(mode === 'wage' ? 'Lohnentwicklung' : mode === 'fix' ? 'Gemeinsame' : 'Inflation'), 'S14: Grund am sichtbaren Modus');
        assertEqual(r.field('rentAdjPct').title, mode === 'fix' ? 'Gemeinsame Rentenanpassung für beide Personen' : `Wird automatisch über Koppelung gesteuert (${mode === 'wage' ? 'Lohnentwicklung' : 'Inflation'})`, 'S14: bisheriger Titel bleibt');
    }

    const profileSource = sources['app/simulator/simulator-main-profiles.js'];
    const applyCombined = new Function('setFieldState', 'refreshRentAdjustmentPresentation', 'refreshPartnerPresentation', 'refreshDynamicFlexControls', 'syncDynamicFlexPresetSelection', 'refreshThreeBucketControls', 'resolveHouseholdSimulatorNeed', 'writeBoundHouseholdPlanField', `${profileSource.slice(profileSource.indexOf('function applyCombinedInputsToUI('))}\nreturn applyCombinedInputsToUI;`)(
        setFieldState, refreshRentAdjustmentPresentation, refreshPartnerPresentation,
        () => {}, () => {}, () => {}, (id, value, overrides) => overrides?.[id] ?? value, writeBoundHouseholdPlanField
    );
    const p = fixture({
        p1StartAlter: '', p1Geschlecht: '', rentAdjMode: 'fix', rentAdjPct: '2', chkPartnerAktiv: { type: 'checkbox' },
        sectionRente2: '', enableAccumulationPhase: { type: 'checkbox' }, accumulationPhaseDetails: '',
        tagesgeld: { disabled: true }, geldmarktEtf: { disabled: true }, startFloorBedarf: '', startFlexBedarf: '', minimumFlexAnnual: ''
    });
    initRentAdjModeUI();
    for (const count of [1, 2, 1]) {
        applyCombined({ startAlter: 67, geschlecht: 'w', rentAdjMode: 'wage', rentAdjPct: 2, tagesgeld: 5000, geldmarktEtf: 3000 }, count, { startFloorBedarf: '25000' });
        for (const id of ['p1StartAlter', 'p1Geschlecht', 'rentAdjMode', 'rentAdjPct', 'chkPartnerAktiv']) {
            assertEqual(p.field(id).disabled, true, `S03/S13/S14/S16: bisheriger Profil-Lock ${id}`);
            assertEqual(state(p.field(id)), 'adopted', `S03/S13/S14/S16: Herkunft ${id}`);
            assert(reason(p.field(id)).includes(count > 1 ? 'Haushaltsprofilen' : 'ausgewählten Profil'), 'S03: Herkunft nach Profilanzahl synchron');
        }
        assertEqual(p.field('p1StartAlter').value, 67, 'S13: übernommenes Alter unverändert');
        assertEqual(p.field('sectionRente2').style.display, count > 1 ? 'block' : 'none', 'S16: Partnersektion nach Profilanzahl');
        assertEqual(p.field('chkPartnerAktiv').checked, count > 1, 'S16: Partnerwahl unverändert');
        assertEqual(p.field('enableAccumulationPhase').disabled, false, 'S18: entfernte UI hat keine Sperrwirkung auf Alt-DOM');
        assertEqual(p.field('startFloorBedarf').value, '25000', 'S03: Haushalts-Override bleibt erhalten');
        assertEqual(p.field('startFloorBedarf').disabled, false, 'S03: Bedarf bleibt bearbeitbar');
    }
    const lockReason = p.field('rentAdjPct').dataset.profileFieldOrigin;
    for (const mode of ['fix', 'cpi', 'wage']) {
        p.field('rentAdjMode').value = mode; p.fire('rentAdjMode');
        assertEqual(p.field('rentAdjPct').dataset.profileFieldOrigin, lockReason, 'S14: Moduswechsel ändert keine Profil-Lock-Bedingung');
        assertEqual(state(p.field('rentAdjPct')), 'adopted', 'S14: Herkunft bleibt auch beim Moduswechsel sichtbar');
        assert(reason(p.field('rentAdjMode')).includes(lockReason), 'S14: Modus und Herkunft additiv am sichtbaren Feld');
        assertEqual(p.field('rentAdjPct').disabled, true, 'S14: programmatischer Moduswechsel erhält die zentrale Personensperre');
        applyCombined({ rentAdjMode: mode, rentAdjPct: 2 }, 1, {});
        assertEqual(p.field('rentAdjPct').disabled, true, 'S14: nachfolgende Profilsperre gewinnt');
    }

    const portfolioSource = sources['app/simulator/simulator-portfolio-display.js'].replace(/^import .*;$/gm, '').replace(/export /g, '');
    let portfolioInputs, aggregate;
    const updatePortfolio = new Function('readBasePortfolioInputs', 'readStrategyInputs', 'readTrancheInputs', 'calculateAggregatedValues', 'formatCurrency', 'formatDisplayNumber', 'setFieldState', `${portfolioSource}\nreturn updateStartPortfolioDisplay;`)(
        () => portfolioInputs, () => ({}), () => ({}), () => aggregate, formatCurrency, formatDisplayNumber, setFieldState
    );
    const portfolio = fixture({ simStartVermoegen: { disabled: true }, depotwertGesamt: { disabled: true }, goldWert: { disabled: true }, initialBondBucket: { disabled: true }, einstandNeu: '', displayPortfolioBreakdown: '', goldStrategyPanel: '' });
    for (const useAggregates of [false, true, false]) {
        portfolioInputs = { startVermoegen: 100000, depotwertAlt: 20000, tagesgeld: 5000, geldmarktEtf: 3000, goldAktiv: true, goldZielProzent: 20, detailledTranches: useAggregates ? [{}] : [] };
        aggregate = { depotwertAlt: 20000, depotwertNeu: 30000, goldWert: 10000, geldmarktEtf: 8000, costBasisNeu: 22000, bondsWert: 9000 };
        updatePortfolio();
        assertEqual(portfolio.field('simStartVermoegen').value, useAggregates ? '73.000' : '100.000', 'S04: Startportfolio unverändert abgeleitet');
        assertEqual(portfolio.field('depotwertGesamt').value, useAggregates ? '50.000' : '73.600', 'S04: Depotaufteilung unverändert');
        assertEqual(portfolio.field('goldWert').value, useAggregates ? '10.000' : '18.400', 'S04: Goldaufteilung unverändert');
        assertEqual(portfolio.field('einstandNeu').value, useAggregates ? 22000 : '53600', 'S04: Einstandseinheit unverändert');
        assertEqual(portfolio.field('initialBondBucket').value, formatCurrency(useAggregates ? 9000 : 0), 'S04: Bondanzeige unverändert');
        for (const id of ['simStartVermoegen', 'depotwertGesamt', 'goldWert', 'initialBondBucket']) {
            assertEqual(portfolio.field(id).disabled, true, 'S04: übernommenes Portfolio bleibt gesperrt');
            assertEqual(state(portfolio.field(id)), 'adopted', 'S04: Portfolioherkunft explizit');
            assert(reason(portfolio.field(id)).includes(useAggregates ? 'Tranchenbestand' : 'Zielallokation'), 'S04: Herkunft nach Bestandswechsel synchron');
        }
        assertEqual((portfolio.field('displayPortfolioBreakdown').innerHTML.match(/calculated-display ds-metric/g) || []).length, 3, 'S04: vorhandene Breakdownanker mit additiver Rolle');
    }

    const partnerOnly = fixture({ chkPartnerAktiv: { type: 'checkbox' }, sectionRente2: '' });
    initPartnerToggle();
    for (const active of [true, false, true]) {
        partnerOnly.field('chkPartnerAktiv').checked = active; partnerOnly.fire('chkPartnerAktiv');
        assertEqual(partnerOnly.field('sectionRente2').style.display, active ? 'block' : 'none', 'S16: manueller Partnerwechsel');
    }
    assert(!sources['Simulator.html'].includes('id="enableAccumulationPhase"'), 'S18: Ansparbedienung entfernt');
    assert(!sources['app/simulator/simulator-main-accumulation.js'].includes('setItem'), 'S18: kein Anspar-UI-Schreibpfad');

    const b = fixture({ mcMethode: 'regime_iid', mcBlockSize: '7', mcBlockSizeLabel: '' });
    initMonteCarloMethodControls();
    for (const method of ['regime_iid', 'block', 'stationary', 'regime_markov', 'regime_iid']) {
        b.field('mcMethode').value = method; b.fire('mcMethode');
        assertEqual(b.field('mcBlockSize').disabled, method !== 'block' && method !== 'stationary', 'S24: bisherige Blockgrößensperre');
        assertEqual(state(b.field('mcBlockSize')), method !== 'block' && method !== 'stationary' ? 'inactive' : 'editable', 'S24: Zustand nach Bootstrapwechsel');
        assertEqual(b.field('mcBlockSize').value, '7', 'S24: Blockgröße unverändert');
        assertEqual(reason(b.field('mcBlockSize')).trim(), b.field('mcBlockSize').title, 'S24: sichtbarer Begriff und Titel synchron');
    }
    const busy = fixture({ mcButton: '', mcCancelButton: '', 'mc-progress-bar-container': '', 'mc-progress-bar': '', mcRunStatus: '' });
    const ui = createMonteCarloUI(); ui.beginRun();
    assertEqual(busy.field('mcButton').disabled, true, 'Busy bleibt gesperrt');
    assertEqual(state(busy.field('mcButton')), null, 'Busy-disabled ist keine fachliche Nichtanwendbarkeit');
    assertEqual(busy.field('mcRunStatus').textContent, 'Monte-Carlo-Lauf gestartet.', 'Busy behält spezifischen Grund');
    ui.beginCancelling(); ui.finishRun();
    assertEqual(state(busy.field('mcButton')), null, 'Abbruch/Ende erzeugen keine pauschale Klassifikation');

    const care = fixture({ pflegefallLogikAktivieren: { checked: true }, pflegePanel: '', pflegePanelContainer: '',
        pflegeModellTyp: 'chronisch', pflegeDauerContainer: '', pflegeStufe1Zusatz: '12000', pflegeStufe1FlexCut: '75' });
    const careFields = ['pflegeModellTyp', 'pflegeStufe1Zusatz', 'pflegeStufe1FlexCut'].map(care.field);
    care.field('pflegePanelContainer').querySelectorAll = () => careFields;
    initializePflegeUIControls();
    for (const model of ['akut', 'chronisch']) {
        care.field('pflegeModellTyp').value = model; care.fire('pflegeModellTyp');
        assertEqual(care.field('pflegeDauerContainer').style.display, model === 'akut' ? 'contents' : 'none', 'Pflegedauer: Sichtbarkeit unverändert');
        assertEqual(reason(care.field('pflegeModellTyp')).trim().length > 0, model !== 'akut', 'Pflegedauer: Grund synchron');
    }
    care.field('pflegefallLogikAktivieren').checked = false; care.fire('pflegefallLogikAktivieren');
    assertEqual(care.field('pflegePanel').style.display, 'grid', 'Pflegepanel bleibt bei gesperrter Bedienung erhalten');
    assert(careFields.every(field => field.disabled), 'Pflege aus sperrt auch die sichtbar erhaltenen Detailcontrols');
    assert(careFields.every(field => state(field) === 'inactive'), 'Pflege aus nennt Nichtanwendbarkeit an den echten Feldern');
    care.field('pflegefallLogikAktivieren').checked = true; care.fire('pflegefallLogikAktivieren');
    assert(careFields.every(field => !field.disabled), 'Pflege an gibt dieselben Controls wieder frei');
    assertEqual(care.field('pflegeStufe1Zusatz').value, '12000', 'Pflege aus/an erhält die eingegebenen Kosten');
    assertEqual(care.field('pflegeStufe1FlexCut').value, '75', 'Pflege aus/an erhält den Flexwert');
    const bucket = fixture({ entnahmeStrategie: 'standard', threeBucketConfigGroup: '', bondTargetFactor: '', drawdownTrigger: '' });
    initThreeBucketControls(); bucket.field('entnahmeStrategie').value = '3_bucket_jilge'; bucket.fire('entnahmeStrategie');
    assertEqual(bucket.field('threeBucketConfigGroup').style.display, 'grid', '3-Bucket: bisherige Sichtbarkeit');
    assertEqual(bucket.field('bondTargetFactor').value, '5', '3-Bucket: vorhandener Leerwertdefault');
    assertEqual(reason(bucket.field('entnahmeStrategie')).trim(), '', '3-Bucket: alten Nichtanwendbarkeitsgrund entfernt');

    const legacyIds = ['startAlter', 'geschlecht', 'startSPB', 'kirchensteuerSatz', 'renteMonatlich', 'renteStartOffsetJahre'];
    const html = tokenizeHTML(sources['Simulator.html']).elements;
    for (const id of legacyIds) {
        assertEqual(html.find(n => n.attrs.id === id)?.attrs.type, 'hidden', `S15: Legacyfeld ${id} bleibt verborgen`);
    }
    for (const [id, value, step] of [['widowPensionPct', '55', '5'], ['widowMarriageOffsetYears', '0', null], ['widowMinMarriageYears', '1', null]]) {
        const node = html.find(n => n.attrs.id === id);
        assertEqual(node.attrs.value, value, `S17: Hinterbliebenenparameter ${id} unverändert`);
        if (step) assertEqual(node.attrs.step, step, 'S17: Prozent-Schritt unverändert');
        assert(node.attrs.class.includes('ds-input'), 'S17: additive Eingaberolle');
    }
    store.clear(); store.set('sim_p1KirchensteuerPct', '9'); store.set('sim_p1Monatsrente', '1234'); store.set('sim_r2Brutto', '24000');
    const legacy = fixture(Object.fromEntries([...legacyIds, 'p1KirchensteuerPct', 'p1Monatsrente', 'chkPartnerAktiv', 'sectionRente2', 'r2Monatsrente'].map(id => [id, ''])));
    initRente2ConfigWithLocalStorage();
    assertEqual(legacy.field('kirchensteuerSatz').value, '', 'S13/S15: Initialisierer liest keine alte Kirchensteuer');
    assertEqual(legacy.field('renteMonatlich').value, '', 'S15: Initialisierer liest keine alte Monatsrente');
    assertEqual(legacy.field('r2Monatsrente').value, '', 'S16: Bruttomigration gehört ausschließlich zur gesicherten Personenübernahme');
    assertEqual(store.get('sim_r2Brutto'), '24000', 'Initialisierer löscht keine ungesicherten Altbytes');
    for (const id of legacyIds) assertEqual(state(legacy.field(id)), null, 'S15: keine sichtbare Legacydarstellung');
} finally {
    PersistenceFacade.resetPersistenceRuntimeForTests();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
}
