import fs from 'node:fs';
import { setFieldState } from '../app/shared/field-state.js';
import { UIUtils } from '../app/balance/balance-utils.js';
import { readSources, validateBalance, validateFoundation, validateComponents, createPresentationTestDocument, rules } from './designsystem-source-contract.mjs';
import { createAnnualModalHandlers } from '../app/balance/balance-annual-modal.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { dialogElements } from '../app/shared/close-dialog.js';

const sources = readSources();
assertEqual(validateBalance(sources).join('\n'), '', 'Balance-Textconsumer und Bausteine sind tokenisiert');
assertEqual(validateFoundation(sources).join('\n'), '', 'Balance-Aliase und bestehende Prioritäten bleiben gültig');
assertEqual(validateComponents(sources).join('\n'), '', 'Balance-Symboltasten haben Namen');
for (const [path, addition, validator] of [
    ['css/balance.css', '.summary-item { opacity: .5; }', validateBalance],
    ['css/balance.css', '.panel { color: #aaa; }', validateBalance],
    ['app/balance/balance-annual-modal.js', "node.style.cssText = 'opacity:0.6';", validateBalance],
    ['app/balance/balance-diagnosis-keyparams.js', "node.style.color = '#aaa';", validateBalance],
    ['Balance.html', '<button class="ds-icon-button">X</button>', validateComponents]
]) {
    assert(validator({ ...sources, [path]: sources[path] + addition }).length > 0, `Gegenprobe erkennt ${addition}`);
}

// Tatsächlicher Sync-Quelltext mit kontrollierten Profil-/Storagefixtures.
// Referenzlauf entfernt ausschließlich die neue Darstellungszeile.
const syncSource = sources['app/balance/balance-main-profile-sync.js'].replace(/^import .*;$/gm, '').replace(/export /g, '');
const keys = ['fixedIncomeAnnual', 'tagesgeld', 'geldmarktEtf', 'depotwertGesamt', 'goldWert', 'costBasisAlt', 'costBasisNeu', 'goldCost'];
const snapshot = field => ({ value: field.value, disabled: field.disabled, readOnly: field.readOnly,
    type: field.getAttribute('type'), title: field.getAttribute('title'), inputmode: field.getAttribute('inputmode'),
    noPersist: field.getAttribute('data-no-persist') });
function buildSync(presented, profiles) {
    const doc = createPresentationTestDocument();
    const inputs = {};
    const bridges = doc.createElement('div'); bridges.id = 'balanceContractInputs'; bridges.hidden = true;
    doc.body.appendChild(bridges);
    const rows = doc.createElement('div'); rows.id = 'balanceAdoptedRows'; doc.body.appendChild(rows);
    for (const key of ['income', 'cash', 'depot', 'gold-bonds', 'costs']) {
        const row = doc.createElement('div'); row.id = `balanceAdopt-${key}`; rows.appendChild(row);
        for (const suffix of ['source', 'value']) {
            const node = doc.createElement(suffix === 'value' ? 'strong' : 'div');
            node.id = `balanceAdopt-${key}-${suffix}`; row.appendChild(node);
        }
    }
    for (const key of [...keys, 'renteAktiv', 'renteMonatlich', 'aktuellesAlter', 'depotwertAlt', 'depotwertNeu']) {
        const field = doc.createElement('input'); field.id = key;
        field.value = '123'; field.disabled = true; field.readOnly = false;
        field.setAttribute('type', keys.includes(key) ? 'text' : 'hidden');
        field.setAttribute('title', `Bestehender Titel ${key}`); field.setAttribute('inputmode', 'numeric');
        field.setAttribute('data-no-persist', 'true'); field.setAttribute('aria-describedby', 'existing-help');
        bridges.appendChild(field); inputs[key] = field;
    }
    const summary = { totalTagesgeld: 1200, totalRenteMonatlich: 150, totalGeldmarkt: 200,
        totalDepotAlt: 300, totalDepotNeu: 400, totalCostAlt: 250, totalCostNeu: 350,
        totalGold: 80, totalGoldCost: 70, mergedTranches: [] };
    const make = new Function('registeredPlanTrial', 'setFieldState', 'UIReader', 'UIUtils', 'loadProfilverbundProfiles',
        'buildProfilverbundAssetSummary', 'readProfileOverridesFromStorage', 'persistenceStorage', 'readBalancePersonStatus', 'projectParticipatingPerson',
        `${presented ? syncSource : syncSource.replace('renderProfileInputOrigins(dom, profilverbundProfiles.length > 0);', '')}\nreturn createProfileSyncHandlers;`);
    const handler = make(() => null, setFieldState, { applySideEffectsFromInputs() {} }, UIUtils, () => profiles,
        () => summary, () => ({ profileTagesgeld: 400, profileRenteMonatlich: 100, profileSonstigeEinkuenfte: 20 }),
        { getItem: () => 'a' }, () => ({ ready: true, status: 'complete' }),
        () => ({ startAlter: 67, startSPB: 1000, kirchensteuerSatz: 0.09, renteMonatlich: 100, sonstigeEinkuenfte: 20 }))({ dom: { inputs }, PROFILE_VALUE_KEYS: { alter: 'alter' } });
    return { doc, inputs, handler, summary };
}
for (const profiles of [[], [{ profileId: 'a', inputs: { sparerPauschbetrag: 1000 } }], [{ profileId: 'a', inputs: { sparerPauschbetrag: 1000 } }, { profileId: 'b', inputs: { sparerPauschbetrag: 1000 } }]]) {
    const before = buildSync(false, profiles), after = buildSync(true, profiles);
    for (const phase of ['Start', 'Profilaktualisierung']) {
        if (phase !== 'Start') { before.summary.totalTagesgeld = 2300; after.summary.totalTagesgeld = 2300; }
        assert(before.handler.syncProfileDerivedInputs() && after.handler.syncProfileDerivedInputs(), `${phase}: Synchronisierung erfolgreich`);
        for (const key of keys) {
            const field = after.inputs[key];
            assertEqual(JSON.stringify(snapshot(field)), JSON.stringify(snapshot(before.inputs[key])), `${phase}/${key}: Werte, Sperren und alte Attribute unverändert`);
            assertEqual(field.getAttribute('data-field-state'), 'adopted', `${phase}/${key}: Herkunft übernommen`);
            const ids = field.getAttribute('aria-describedby').split(' ');
            assertEqual(ids[0], 'existing-help', `${phase}/${key}: fremder Beschreibungshinweis erhalten`);
            assertEqual(ids.length, 2, `${phase}/${key}: genau eine eigene Begründung`);
            const reason = after.doc.getElementById(ids[1]).textContent;
            assert(reason.includes(profiles.length ? 'Haushaltsprofilen' : 'dem Profil'), `${phase}/${key}: vorhandener Profilzweig begründet`);
            assert(reason.includes('Pflege im'), `${phase}/${key}: Pflegeort sichtbar`);
        }
        for (const key of ['renteAktiv', 'renteMonatlich', 'aktuellesAlter', 'depotwertAlt', 'depotwertNeu']) {
            assert(!after.inputs[key].hasAttribute('data-field-state'), `${phase}/${key}: verborgene Brücke bleibt ohne Darstellung`);
        }
    }
}
// Wechsel derselben Felder aktualisiert den Grund ohne neue Knoten oder Sperren.
const switching = buildSync(true, []);
switching.handler.syncProfileDerivedInputs();
const { renderProfileInputOrigins } = await import('../app/balance/balance-main-profile-sync.js');
const old = snapshot(switching.inputs.tagesgeld);
const reasonId = switching.inputs.tagesgeld.getAttribute('aria-describedby').split(' ')[1];
renderProfileInputOrigins({ inputs: switching.inputs }, true);
assertEqual(JSON.stringify(snapshot(switching.inputs.tagesgeld)), JSON.stringify(old), 'Reine Herkunftsaktualisierung verändert keinen Inputvertrag');
assert(switching.doc.getElementById(reasonId).textContent.includes('Haushaltsprofilen'), 'Profilzweigwechsel aktualisiert denselben sichtbaren Grund');

// Jahresdialog: Warn-/Fehlergründe und Schließen werden vom echten Renderer erzeugt.
const previousDocument = globalThis.document;
try {
    const { doc, nodes } = createDialogFixture();
    globalThis.document = doc;
    const results = {
        targetYear: 2026, startTime: 0, endTime: 1000, age: { old: 67, new: 68 },
        cape: { capeRatio: 25, capeFetchStatus: 'warn_stale_source', sourceLabel: 'Synthetische veraltete Quelle' },
        errors: [{ step: 'Inflation', error: 'Synthetischer Abruffehler' }]
    };
    createAnnualModalHandlers({ getLastUpdateResults: () => results }).showUpdateResultModal(results);
    const modal = doc.getElementById('balanceAnnualClose');
    const rendered = () => dialogElements(doc.getElementById('annualResults'));
    const text = () => rendered().map(node => node.textContent).join(' ');
    const warning = rendered().find(node => node.className?.includes('ds-note-warning'));
    assert(warning && dialogElements(warning).some(node => node.textContent.includes('Quelle veraltet')), 'Jahreswarnung behält ihren Grund und die Warnrolle');
    assert(rendered().some(node => node.className?.includes('ds-note-error') && node.textContent.includes('Synthetischer Abruffehler')), 'Jahresfehler behält seinen Grund und die Fehlerrolle');
    assertEqual(modal.getAttribute('aria-labelledby'), 'balanceAnnualCloseTitle', 'Ergebnisdialog hat einen zugänglichen Titel');
    assert(text().includes('Planstand 2026 → 2027'), 'Ergebnisjahr stammt aus dem Periodenkontext');
    assert(rendered().some(node => node.getAttribute('role') === 'status' && node.textContent === 'Jahresabschluss unvollständig'), 'Teilresultat meldet den unbestätigten Abschluss zugänglich');
    assertEqual(modal.dataset.annualYearResult, 'unconfirmed', 'Teilresultat wird nicht als bestätigt markiert');
    assert(!dialogElements(modal).some(node => node.dataset.state === 'done'), 'Teilresultat markiert keinen Abschnitt als bestätigt');
    assert(!doc.getElementById('annualShowLog').hidden, 'Protokollaktion ist nur mit vorhandenem Sitzungsprotokoll verfügbar');
    await doc.getElementById('annualShowLog').fire('click');
    assert(text().includes(`Start: ${new Date(results.startTime).toLocaleString('de-DE')} · Ende: ${new Date(results.endTime).toLocaleString('de-DE')}`), 'Vorhandener Loghandler ergänzt tatsächliche Protokollzeiten');
    assert(doc.getElementById('annualShowLog').hidden, 'Protokollaktion eröffnet keine Rekursion ohne neue Information');
    await doc.getElementById('annualCloseBtn').fire('click');
    assert(!modal.open && !doc.getElementById('balanceAnnualClose'), 'Jahresdialog bleibt schließbar und entfernt seinen Host');
    assert(nodes.every(node => [...node.listeners.values()].every(set => !set.size)), 'Schließen entfernt sämtliche Dialoglistener');
} finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }

// Die Kaskade schützt die tatsächlichen Profilzeilen einschließlich compact.
const balanceRules = rules('css/balance.css', sources['css/balance.css']);
const finalDeclarations = selector => Object.assign({}, ...balanceRules.filter(rule => rule.selector === selector).map(rule => rule.declarations));
assertEqual(finalDeclarations('.profilverbund-profile-list.compact')['flex-wrap'], 'wrap', 'Kompakte Profilkacheln dürfen umbrechen');
assertEqual(finalDeclarations('.profilverbund-profile-row')['max-width'], '100%', 'Profilkachel bleibt im verfügbaren Container');
assertEqual(finalDeclarations('.profilverbund-profile-row > input[type="checkbox"]').flex, '0 0 auto', 'Checkbox wird nicht gequetscht');
assertEqual(finalDeclarations('.profilverbund-profile-row > span')['white-space'], 'normal', 'Profilnamen brechen vollständig um');
assertEqual(finalDeclarations('.profilverbund-profile-row > span')['overflow-wrap'], 'anywhere', 'Auch lange Einzelwörter bleiben in der Kachel');
assertEqual(finalDeclarations('.profilverbund-profile-row > span')['word-break'], 'normal', 'Kurze passende Namen werden nicht erzwungen zerlegt');
assertEqual(finalDeclarations('.profilverbund-profile-row > input[type="checkbox"]').width, 'auto', 'Checkbox übernimmt nicht die volle allgemeine Inputbreite');
assertEqual(finalDeclarations('.profilverbund-header-group')['flex-wrap'], 'wrap', 'Schmaler Profilheader gibt Namen eine eigene Zeile statt sie zwischen Titel und Verteilung zu quetschen');

// Reale Feldgründe und realer Balance-Adapter: keine Preset-/Finanzmutation.
{
    const { bindBalancePresentationControls } = await import('../app/balance/balance-presentation-controls.js');
    const { initDynamicFlexControls, refreshDynamicFlexControls, syncDynamicFlexPresetSelection } = await import('../app/simulator/simulator-main-dynamic-flex.js');
    const previous = globalThis.document, doc = createPresentationTestDocument();
    doc.getElementById = id => doc.nodes.find(node => node.id === id && node.parentNode) || null;
    // Dokumentlokales Ereignisdoppel: mehrere Listener und echtes Bubbling.
    const eventListeners = new Map(), descriptors = new Map();
    const createEventNode = doc.createElement.bind(doc);
    doc.createElement = tag => {
        const node = createEventNode(tag), listeners = new Map();
        eventListeners.set(node, listeners);
        node.addEventListener = (type, handler) => {
            const handlers = listeners.get(type) || new Set(); handlers.add(handler); listeners.set(type, handlers);
            node.events.set(type, event => { for (const fn of [...handlers]) fn(event); });
        };
        node.removeEventListener = (type, handler) => listeners.get(type)?.delete(handler);
        node.dispatchEvent = event => {
            if (!event.target) Object.defineProperty(event, 'target', { value: node, configurable: true });
            node.events.get(event.type)?.(event);
            if (event.bubbles) node.parentNode?.dispatchEvent?.(event);
            return true;
        };
        node.click = () => node.dispatchEvent(new Event('click', { bubbles: true }));
        return node;
    };
    globalThis.document = doc;
    try {
        const root = doc.createElement('section'); doc.body.appendChild(root);
        const card = doc.createElement('section'); root.appendChild(card);
        const note = doc.createElement('p'); note.id = 'balanceDynamicFlexOff'; note.textContent = 'Dynamic Flex ist aus – Detailwerte gesperrt'; card.appendChild(note);
        const parameters = doc.createElement('details'); parameters.id = 'balanceAllParameters'; root.appendChild(parameters);
        parameters.open = true;
        const fields = {};
        for (const [id, value] of Object.entries({ dynamicFlexPreset: 'custom', dynamicFlexShowAdvanced: '', dynamicFlex: '',
            horizonMethod: 'mean', horizonYears: '27', survivalQuantile: '0.83', goGoActive: '', goGoMultiplier: '1.15',
            longevityMode: 'quantile_shift', longevityQuantileShift: '0.03', longevityRelativePct: '0.07', longevityBufferYears: '4' })) {
            const field = doc.createElement('input'); field.id = id; field.value = value;
            field.type = ['dynamicFlex', 'dynamicFlexShowAdvanced', 'goGoActive'].includes(id) ? 'checkbox' : 'text';
            field.checked = id === 'dynamicFlexShowAdvanced'; field.disabled = false;
            const frame = doc.createElement('div'); (id === 'dynamicFlexPreset' ? root : card).appendChild(frame);
            frame.appendChild(field); fields[id] = field;
        }
        const help = doc.createElement('span'); help.id = 'existing-help'; help.textContent = 'Weiterer Feldhinweis'; root.appendChild(help);
        fields.horizonMethod.setAttribute('aria-describedby', help.id);
        const group = id => {
            const host = doc.createElement('div'); host.dataset = { balanceControl: id }; root.appendChild(host);
            const reason = doc.createElement('span'); reason.id = `${id}-presentation-reason`; root.appendChild(reason);
            const values = id === 'dynamicFlexPreset' ? ['off', 'custom', 'konservativ'] : ['false', 'true'];
            const buttons = values.map(value => {
                const button = doc.createElement('button'); button.dataset = { balanceValue: value }; host.appendChild(button); return button;
            });
            host.querySelectorAll = () => buttons;
            return { host, buttons, reason };
        };
        const preset = group('dynamicFlexPreset'), goGo = group('goGoActive'), dynamic = group('dynamicFlex');
        root.querySelector = () => card;
        root.querySelectorAll = selector => selector === '[data-balance-control]' ? [preset.host, goGo.host, dynamic.host] : [];
        card.querySelectorAll = selector => selector === 'input, select' ? Object.values(fields).filter(field => field.id !== 'dynamicFlexPreset')
            : doc.nodes.filter(node => node.parentNode && node.className.split(' ').includes('ds-field-reason'));
        const decorate = node => { node.classList = {
            contains: name => node.className.split(' ').includes(name),
            toggle: (name, on) => { node.className = [...node.className.split(' ').filter(v => v && v !== name), ...(on ? [name] : [])].join(' '); }
        }; return node; };
        doc.nodes.forEach(decorate);
        const create = doc.createElement.bind(doc); doc.createElement = tag => decorate(create(tag));
        // Echte Accessoren aktivieren die Instanzbeobachtung des Adapters.
        for (const field of [...Object.values(fields), parameters]) {
            for (const property of ['value', 'checked', 'disabled', 'open']) {
                let current = field[property];
                Object.defineProperty(field, property, { configurable: true, enumerable: true,
                    get() { return current; }, set(value) { current = value; } });
            }
        }
        const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
        initDynamicFlexControls({ enableLocalPersistence: false });
        for (const node of [...Object.values(fields), parameters]) descriptors.set(node, Object.getOwnPropertyDescriptors(node));
        const native = () => JSON.stringify(Object.values(fields).map(field => [field.id, field.value, field.checked, field.disabled]));
        const before = native();
        let financialEvents = 0;
        root.addEventListener('change', () => { financialEvents++; });
        let views = 0;
        const binding = bindBalancePresentationControls(root, { onParametersToggle: open => {
            views++; fields.dynamicFlexShowAdvanced.checked = open; refreshDynamicFlexControls();
        } });
        await settle();
        assertEqual(native(), before, 'Ausprojektion erhält Custom, Detailwerte und sämtliche nativen Sperren');
        assertEqual(fields.dynamicFlexPreset.value, 'custom', 'Nativer Customwert bleibt bestehen');
        assertEqual(preset.buttons[0].getAttribute('aria-pressed'), 'true', 'Nur Aus wird im oberen Segment aktiv projiziert');
        assertEqual(preset.buttons[1].getAttribute('aria-pressed'), 'false', 'Custom ist bei ausgeschaltetem Dynamic Flex visuell inaktiv');
        assertEqual(preset.host.getAttribute('aria-describedby'), 'balanceDynamicFlexOff', 'Ausprojektion am oberen Segment beschreibt den tatsächlichen Ausschaltzustand');
        assertEqual(fields.horizonMethod.getAttribute('aria-describedby'), 'existing-help balanceDynamicFlexOff', 'Gemeinsames Ziel erhält fremden Feldhinweis');
        assertEqual(goGo.host.getAttribute('aria-describedby'), 'balanceDynamicFlexOff', 'Sichtbares gesperrtes Segment verweist auf denselben Kartenhinweis');
        assert(goGo.reason.hidden, 'Keine zusätzliche sichtbare Segmentbegründung für Aus');
        const writes = () => doc.nodes.reduce((sum, node) => sum + node.writes, 0);
        binding.refresh(); await settle(); const stable = writes(); binding.refresh(); binding.refresh(); await settle();
        assertEqual(writes(), stable, 'Wiederholter Observerrefresh erzeugt keine weiteren Attributmutationen');
        fields.dynamicFlex.checked = true; refreshDynamicFlexControls(); binding.refresh(); await settle();
        assert(note.hidden, 'Aktivierung entfernt den zentralen Ausschalthinweis');
        assertEqual(preset.buttons[1].getAttribute('aria-pressed'), 'true', 'Aktivierung projiziert wieder den nativen Customwert');
        assertEqual(fields.horizonMethod.getAttribute('aria-describedby'), 'existing-help', 'Editable entfernt das gemeinsame Ziel und erhält den fremden Hinweis');
        const applicable = fields.survivalQuantile.getAttribute('aria-describedby').split(' ');
        assert(applicable.every(id => doc.getElementById(id)?.parentNode), 'Nach Aktivierung bestehen sämtliche ARIA-Ziele');
        assert(applicable.some(id => doc.getElementById(id).textContent.includes('Erwartungswert')), 'Nichtanwendbarkeit wird wieder aus dem gemeinsamen Besitzer beschrieben');
        setFieldState(fields.horizonMethod, 'error', 'Synthetischer Validierungsfehler');
        fields.dynamicFlex.checked = false; binding.refresh(); await settle();
        assert(fields.horizonMethod.getAttribute('aria-describedby').split(' ').some(id => doc.getElementById(id)?.textContent === 'Synthetischer Validierungsfehler'), 'Anderer Fehler bleibt bei Aus unverändert beschrieben');
        const detailValues = Object.values(fields).map(field => field.value).join('|');
        parameters.open = false; parameters.events.get('toggle')(); await settle();
        assert(!fields.dynamicFlexShowAdvanced.checked, 'Schließen benutzt den vorhandenen Detailmoduspfad');
        parameters.open = true; parameters.events.get('toggle')(); await settle();
        assertEqual(Object.values(fields).map(field => field.value).join('|'), detailValues, 'Schließen und Öffnen schreibt keine Finanzwerte');
        assertEqual(fields.dynamicFlexPreset.value, 'custom', 'Ansichtswechsel schreibt kein Off-Preset');
        assert(fields.horizonMethod.disabled && fields.horizonMethod.getAttribute('aria-describedby').includes('balanceDynamicFlexOff'), 'Toggle bündelt den Ausschaltgrund nach Aktualisierung der nativen Sperre');
        assert(views > 0 && fields.dynamicFlexShowAdvanced.checked, 'Alle Parameter öffnet den bestehenden technischen Detailanschluss');
        assertEqual(financialEvents, 0, 'Ansichtswechsel sendet kein finanziell persistierendes Formularereignis');
        // Äußerer Feldbesitzer liest versteckte Details vor dem ersten Setter:
        // synchron darf ihn der Adapter nicht mit einem inneren Lauf überholen.
        fields.dynamicFlexPreset.value = 'off';
        fields.dynamicFlexShowAdvanced.checked = false;
        refreshDynamicFlexControls();
        assert(!fields.dynamicFlexShowAdvanced.checked, 'Äußerer Feldbesitzer wird vollständig beendet');
        await settle();
        assert(parameters.open && fields.dynamicFlexShowAdvanced.checked && !fields.dynamicFlex.checked,
            'Offene Klappe synchronisiert erst nach dem äußeren Feldbesitzerdurchlauf');
        assert(fields.horizonMethod.disabled, 'Aus bleibt nativ gesperrt');
        assert(!preset.reason.textContent.includes('ausgeblendet'), 'Keine veraltete Detailbegründung überschreibt den Endzustand');
        assertEqual(fields.horizonMethod.getAttribute('aria-describedby'), 'existing-help balanceDynamicFlexOff', 'Endzustand bündelt ausschließlich den Ausgrund');
        fields.dynamicFlex.checked = true;
        fields.dynamicFlexPreset.value = 'custom';
        fields.horizonMethod.value = 'survival_quantile';
        refreshDynamicFlexControls(); await settle();
        for (const open of [false, true]) {
            parameters.open = open; parameters.events.get('toggle')(); await settle();
            assertEqual(fields.dynamicFlexShowAdvanced.checked, open, 'Klappenwechsel folgt auch bei Custom dem sichtbaren Zustand');
        }
        assert(!fields.horizonMethod.disabled, 'An/Custom bleibt nach erneutem Öffnen bearbeitbar');
        assertEqual(fields.horizonYears.getAttribute('data-field-state'), 'inactive', 'Aktuarischer Horizont erhält den bestehenden Nichtanwendbarkeitsvertrag');
        assert(fields.horizonYears.getAttribute('aria-describedby').split(' ').some(id => doc.getElementById(id)?.textContent.includes('Nicht anwendbar')), 'Horizontbegründung bleibt zugänglich');
        const endState = native(), endViews = views, endWrites = writes();
        binding.refresh(); binding.refresh(); await settle();
        assertEqual(native(), endState, 'Folgerefresh erhält alle Feldwerte und Sperren');
        assertEqual(views, endViews, 'Folgerefresh ruft den Besitzer nicht erneut auf');
        assertEqual(writes(), endWrites, 'Accessorfolge terminiert ohne weitere Attributmutationen');
        assertEqual(financialEvents, 0, 'Accessor- und Presetprojektion starten weder Input-/Changeweg noch Finanzwrites');

        preset.buttons[0].click();
        assertEqual(financialEvents, 1, 'Ein echter Segmentklick sendet weiterhin genau ein natives change');
        let focuses = 0;
        fields.horizonMethod.focus = () => { focuses++; doc.activeElement = fields.horizonMethod; };
        assert(bindBalancePresentationControls(root) === binding, 'Wiederholte Bindung erhält denselben Customlistener');
        for (const identical of [true, false]) {
            Object.assign(fields.horizonMethod, { value: 'survival_quantile' });
            fields.horizonYears.value = identical ? '35' : '37';
            fields.survivalQuantile.value = '0.9'; fields.goGoActive.checked = false;
            fields.goGoMultiplier.value = '1'; fields.longevityMode.value = 'none';
            fields.dynamicFlex.checked = true;
            syncDynamicFlexPresetSelection(); refreshDynamicFlexControls(); await settle();
            parameters.open = false; parameters.events.get('toggle')(); await settle();
            const valuesBefore = Object.values(fields).filter(field => !['dynamicFlexPreset', 'dynamicFlexShowAdvanced'].includes(field.id))
                .map(field => [field.id, field.value, field.checked]);
            const eventsBefore = financialEvents, focusBefore = focuses;
            preset.buttons[1].click(); await settle(); await settle();
            assert(parameters.open && fields.dynamicFlexShowAdvanced.checked, `Custom öffnet nach Abgleich, presetgleich=${identical}`);
            assertEqual(fields.dynamicFlexPreset.value, identical ? 'konservativ' : 'custom', 'Echte Preseterkennung bleibt maßgeblich');
            assertEqual(preset.buttons[identical ? 2 : 1].getAttribute('aria-pressed'), 'true', 'Segmentprojektion folgt dem erkannten nativen Preset');
            assertEqual(JSON.stringify(Object.values(fields).filter(field => !['dynamicFlexPreset', 'dynamicFlexShowAdvanced'].includes(field.id))
                .map(field => [field.id, field.value, field.checked])), JSON.stringify(valuesBefore), 'Custom schreibt keine Detailwerte');
            assertEqual(financialEvents, eventsBefore + 1, 'Custom sendet genau ein bestehendes change');
            assert(doc.activeElement === fields.horizonMethod && !fields.horizonMethod.disabled, 'Fokus erreicht das erste freigegebene Detailfeld');
            assertEqual(focuses, focusBefore + 1, 'Custom fokussiert einmal nach dem Abgleich');
        }
        parameters.open = false; fields.dynamicFlexPreset.disabled = true; await settle();
        const locked = native(), lockedEvents = financialEvents, lockedFocus = focuses;
        preset.buttons[1].click(); await settle();
        assertEqual(native(), locked, 'Gesperrter Customklick ändert keinen nativen Wert');
        assert(!parameters.open && financialEvents === lockedEvents && focuses === lockedFocus, 'Gesperrter Customklick öffnet und fokussiert nicht');
        fields.dynamicFlexPreset.disabled = false; fields.dynamicFlex.checked = false;
        syncDynamicFlexPresetSelection(); refreshDynamicFlexControls(); await settle();
        preset.buttons[1].click(); await settle(); await settle();
        assert(parameters.open && fields.horizonMethod.disabled && focuses === lockedFocus, 'Custom bei Aus öffnet nur die Ansicht und fokussiert keine gesperrten Details');
    } finally {
        // Keine Prototypeänderung; alle Instanzbeobachter und Listener entfernen.
        for (const [node, saved] of descriptors) for (const property of ['value', 'checked', 'disabled', 'open']) {
            if (saved[property]) Object.defineProperty(node, property, saved[property]);
            else delete node[property];
        }
        for (const [node, listeners] of eventListeners) { listeners.clear(); node.events.clear(); }
        await Promise.resolve(); await Promise.resolve();
        if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    }
}

const clipped = finalDeclarations('.balance-page .balance-strategy-grid .balance-dynamic-card .ds-field-reason.balance-bundled-reason');
assertEqual(clipped.padding, '0', 'Bündelklasse gewinnt mit höherer Spezifität gegen Feldrahmenpadding');
assertEqual(clipped.border, '0', 'Technische Kopie hat keinen Rand');
assertEqual(clipped.width, '1px', 'Technische Kopie hat nur eine abgeschnittene 1-px-Fläche');
assertEqual(clipped['clip-path'], 'inset(50%)', 'Technische Kopie wird vollständig abgeschnitten');
assertEqual(finalDeclarations('.balance-market-segment.phase-0')['--phase-color'], 'var(--warn)', 'Heiß gelaufene Phase zeigt Warnfarbe');
assert(!sources['Balance.html'].includes('dynamicFlexShowAdvanced-segments'), 'Kein zusätzlicher sichtbarer Detailparameterschalter');

const captionStyle = finalDeclarations('.balance-page .ds-table > caption');
for (const [property, expected] of [['position', 'absolute'], ['width', '1px'], ['height', '1px'], ['padding', '0'], ['border', '0'], ['clip-path', 'inset(50%)']]) {
    assertEqual(captionStyle[property], expected, `Tabellencaption bleibt zugänglich ohne sichtbare Fläche: ${property}`);
}
assert(!captionStyle.display && !captionStyle.visibility, 'Caption wird nicht aus dem Zugänglichkeitsbaum entfernt');
assertEqual(finalDeclarations('.guardrail-card .value').font, '400 26px/1.2 var(--font-serif)', 'Leitplankenwerte sind Serif regular 26 px');
// B7: Ausgaben-CSS wird auf Ausgaben.html geladen; alte Balance-Regeln
// beweisen dort weder Monatsgeometrie noch die semantischen Jahresköpfe.
const expensesCss = fs.readFileSync(new URL('../css/expenses.css', import.meta.url), 'utf8');
const expensesRules = rules('css/expenses.css', expensesCss);
const expensesDeclarations = selector => Object.assign({}, ...expensesRules.filter(rule => rule.selector === selector).map(rule => rule.declarations));
assertEqual(expensesDeclarations('.profile-cell-inner').display, 'grid', 'Ausgaben: Matrixaktionen besitzen einen stabilen Betragsslot');
assertEqual(expensesDeclarations('.profile-cell-inner')['grid-template-columns'], '12ch auto', 'Ausgaben: fester Betragsslot steht vor den Symbolen');
assertEqual(expensesDeclarations('.profile-cell-inner')['justify-content'], 'start', 'Ausgaben: Gruppe beginnt unter ihrer Personenüberschrift');
assertEqual(expensesDeclarations('.profile-cell-inner .expense-value').width, '12ch', 'Ausgaben: Betragsbreite bleibt unabhängig vom Wert');
assertEqual(expensesDeclarations('.expenses-page .expenses-table .profile-head')['text-align'], 'left', 'Ausgaben: Personenüberschrift steht über der ganzen Gruppe');
assertEqual(expensesDeclarations('.profile-cell-inner .expense-value')['text-align'], 'right', 'Ausgaben: Beträge sind rechtsbündig');
assertEqual(expensesDeclarations('.profile-cell-inner .expense-value')['font-variant-numeric'], 'tabular-nums', 'Ausgaben: Betragsslot bleibt tabellarisch');
assertEqual(finalDeclarations('.profile-cell-inner')['grid-template-columns'], '12ch auto', 'Balance: gleicher fester Betragsslot vor den Symbolen');
assertEqual(finalDeclarations('.profile-cell-inner .expense-value').width, '12ch', 'Balance: Betragsbreite bleibt unabhängig vom Wert');
assertEqual(finalDeclarations('.profile-cell-inner .expense-value')['font-variant-numeric'], 'tabular-nums', 'Balance: Betragsslot bleibt tabellarisch');
assertEqual(finalDeclarations('.balance-page .expenses-table thead th.profile-head')['text-align'], 'left', 'Balance: Personenüberschrift steht über der ganzen Gruppe');
assert(!expensesCss.includes('.expense-top') && !sources['css/balance.css'].includes('.expense-top'), 'Nicht mehr benötigte Top-3-Regeln sind auf beiden Seiten entfernt');
assertEqual(expensesDeclarations('.expenses-page #expensesHistoryTable th[scope="row"]').background, 'transparent', 'Ausgaben: Jahreskopf hat keine graue Füllung');
assertEqual(expensesDeclarations('.expenses-page #expensesHistoryTable th[scope="row"]')['font-weight'], '700', 'Ausgaben: semantischer Jahreskopf ist nach aktuellem Seitenvertrag fett');
assertEqual(expensesDeclarations('.expenses-page #expensesHistoryTable th:nth-child(2), .expenses-page #expensesHistoryTable td:nth-child(2)')['text-align'], 'left', 'Ausgabenstatus steht links (Ausgaben.html)');

// Lokale Dialog-/Meldungskaskade: sichtbare Hierarchie, kein Controllerwechsel.
assertEqual(finalDeclarations('.balance-action-detail-title').font, '400 var(--balance-help)/1.5 var(--font-sans)', 'Vollständiger Aktionstitel ist eine kleine Kontextzeile');
assertEqual(finalDeclarations('.balance-action-detail-title').margin, '0', 'Titel bringt keinen zusätzlichen Absatzabstand vor die Tabelle');
assertEqual(finalDeclarations('.balance-action-dialog-head h2').margin, '18px 0 4px', 'Überschrift und Kontext stehen eng zusammen');
assertEqual(finalDeclarations('.balance-action-table-scroll').margin, '0', 'Tabellen verdoppeln den bestehenden Inhaltsabstand nicht');
assertEqual(finalDeclarations('#action-error-container .balance-message-close').order, '2', 'Schließen steht optisch rechts von der Folgeaktion');
assertEqual(finalDeclarations('#action-error-container .balance-message-action').order, '1', 'Jahresfolgeaktion behält ihre optische Priorität');
assertEqual(finalDeclarations('#action-error-container .balance-message-action')['grid-column'], '1', 'Schmale Bänder halten die Folgeaktion in der linken Aktionsspalte');
assertEqual(finalDeclarations('#action-error-container .balance-message-close')['grid-column'], '2', 'Schmale Bänder halten Schließen rechts neben der Folgeaktion');
assertEqual(finalDeclarations('#action-error-container .balance-message-close')['grid-row'], '2', 'Schließen teilt die Aktionszeile auch unter 480 px');
assertEqual(finalDeclarations('#updateResultModal .ds-eyebrow')['text-transform'], 'uppercase', 'Jahres-Eyebrow ist großgeschrieben');
assertEqual(finalDeclarations('#updateResultModal .ds-eyebrow')['letter-spacing'], '.08em', 'Jahres-Eyebrow erhält die Referenzlaufweite');
assertEqual(finalDeclarations('#updateResultModal #annualHandPriceHelp')['font-size'], '14px', 'Handkurshilfe ist lokal 14 px');
assertEqual(finalDeclarations('#updateResultModal #annualHandPriceHelp').color, 'var(--text-muted)', 'Handkurshilfe ist gedämpft');
assertEqual(finalDeclarations('#updateResultModal #annualHandPriceHelp').margin, '4px 0 0', 'Handkurshilfe steht direkt unter dem Feld');
