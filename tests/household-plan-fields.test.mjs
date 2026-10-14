import { HOUSEHOLD_PLAN_FIELDS, HOUSEHOLD_PLAN_CARDS, HOUSEHOLD_PLAN_DISPLAY_FIELDS, projectHouseholdPlanFieldLabels, bindHouseholdPlanField, parseHouseholdPlanNumber, formatHouseholdPlanValue, readHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { PLAN_DEFAULTS } from '../app/profile/household-plan.js';
import { householdPlanSummary, resetHouseholdPlanParameterDetails, projectHouseholdPlanParameters } from '../app/shared/household-plan-presentation.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';

const summaryValues = { ...structuredClone(PLAN_DEFAULTS), flexBudgetAnnual: 7283, liquidityRunwayYears: 5,
    dynamicFlex: false, cape: { value: 32 } };
assertEqual(householdPlanSummary(summaryValues), 'Flex-Budget 7.283 €/Jahr · Reserven 5,0 Jahre · Strategie Standard · Dynamik Aus · CAPE 32,0',
    'Gemeinsame Kopfzusammenfassung enthält die tatsächlichen Werte');
assertEqual(householdPlanSummary(null), 'Planbereich noch nicht bestätigt', 'Unbestätigter Plan erfindet keine Zusammenfassungswerte');
const detailFields = { dynamicFlexPreset: { value: 'custom' }, dynamicFlexShowAdvanced: { checked: true } };
const beforeSummaryReset = JSON.stringify(summaryValues);
resetHouseholdPlanParameterDetails({ getElementById: id => detailFields[id] }, summaryValues);
assertEqual(detailFields.dynamicFlexPreset.value, 'off', 'Zurück zum Plan verwirft die lokale Detailauswahl');
assert(!detailFields.dynamicFlexShowAdvanced.checked && JSON.stringify(summaryValues) === beforeSummaryReset,
    'Detailrückkehr verändert keine Planwerte');

{
    const { doc } = createDialogFixture();
    const root = doc.createElement('section'), flex = doc.createElement('input'), field = doc.createElement('input');
    flex.id = 'dynamicFlex'; flex.checked = false;
    field.value = '30'; field.disabled = true; field.setAttribute('aria-describedby', 'off-reason method-reason');
    const off = doc.createElement('span'), method = doc.createElement('span');
    off.id = 'off-reason'; off.className = method.className = 'ds-field-reason';
    off.textContent = 'Dynamic Flex ist ausgeschaltet.';
    method.id = 'method-reason'; method.textContent = 'Nicht anwendbar bei aktuarischer Horizontmethode.';
    root.append(flex, field, off, method); doc.body.append(root);
    projectHouseholdPlanParameters(doc, root, {}, summaryValues);
    assertEqual(off.dataset.planBundledReason, 'true', 'Identischer Ausschaltgrund wird beim Sammelhinweis gebündelt');
    assertEqual(method.dataset.planBundledReason, 'false', 'Abweichender Methodengrund bleibt am Feld');
    assertEqual(field.getAttribute('aria-describedby'), 'off-reason method-reason', 'Beschreibungsziele bleiben erhalten');
    assertEqual(field.value, '30', 'Bündelung verändert keinen Wert');
    assert(field.disabled, 'Bündelung gibt gesperrte Felder nicht frei');
    flex.checked = true;
    projectHouseholdPlanParameters(doc, root, {}, summaryValues);
    assertEqual(off.dataset.planBundledReason, 'false', 'Aktivierung nimmt die Ausschaltbündelung zurück');
    flex.checked = false; off.textContent = 'Go-Go ist ausgeschaltet.';
    projectHouseholdPlanParameters(doc, root, {}, summaryValues);
    assertEqual(off.dataset.planBundledReason, 'false', 'Ein neuer abweichender Feldgrund wird nicht weiter gebündelt');
}

for (const [path, text, expected] of [
    ['floorBedarf', '30.000 €', 30000], ['floorBedarf', '30.000,25 €', 30000.25],
    ['floorBedarf', '  30\u00a0000,25\u00a0€  ', 30000.25], ['floorBedarf', '30 000 €', 30000],
    ['floorBedarf', '30\u202f000 €', 30000], ['flexBudgetYears', '5 Jahre', 5], ['minCashBufferMonths', '2 Monate', 2],
    ['maxSkimPctOfEq', '10 %', 10], ['decumulation.drawdownTrigger', '15 %', 15],
    ['survivalQuantile', '85 %', .85], ['longevityQuantileShift', '5 %', .05], ['longevityRelativePct', '5 %', .05],
    ['goGoMultiplier', '1,10', 1.1], ['decumulation.bondRefillThreshold', '', null], ['floorBedarf', '0 €', 0]
]) assertEqual(parseHouseholdPlanNumber(text, path), expected, path + ': vollständig gelesen ' + text);
for (const [path, text] of [
    ['floorBedarf', '30.00 €'], ['floorBedarf', '3.0000 €'], ['floorBedarf', '3000.000 €'], ['floorBedarf', '30 00 €'],
    ['floorBedarf', '30,000.25 €'], ['floorBedarf', '30000 EUR'], ['floorBedarf', '30.000 %'], ['floorBedarf', 'x30000'],
    ['floorBedarf', '30000xyz'], ['floorBedarf', 'NaN'], ['floorBedarf', 'Infinity'], ['floorBedarf', '1e4'],
    ['floorBedarf', ''], ['floorBedarf', '€'], ['minCashBufferMonths', '2 Jahre'], ['survivalQuantile', '85 €'], ['goGoMultiplier', '1,10 %']
]) assert(Number.isNaN(parseHouseholdPlanNumber(text, path)), path + ': ungültiger Text abgewiesen ' + text);
for (const [path, value, expected] of [
    ['floorBedarf', 30000, '30.000 €'], ['floorBedarf', 30000.25, '30.000,25 €'], ['flexBudgetYears', 5, '5 Jahre'],
    ['minCashBufferMonths', 2, '2 Monate'], ['maxSkimPctOfEq', 10, '10 %'], ['survivalQuantile', .85, '85 %'],
    ['longevityQuantileShift', .05, '5 %'], ['goGoMultiplier', 1.1, '1,10']
]) assertEqual(formatHouseholdPlanValue(value, path), expected, path + ': feldgenaue Anzeige');

for (const path of ['longevityQuantileShift', 'longevityRelativePct', 'survivalQuantile']) {
    for (const [value, expected] of [[0.07, '7'], [0.29, '29'], [0.57, '57'], [0.853456789, '85,3456789'],
        [0.12345678901234567, '12,345678901234566'], [1e-7, '0,00001']]) {
        const editing = formatHouseholdPlanValue(value, path, { editing: true });
        assertEqual(editing, expected, path + ': Fokusdarstellung ohne Gleitkommarauschen');
        assertEqual(parseHouseholdPlanNumber(editing, path), value, path + ': Fokusdarstellung liest exakt den kanonischen Anteil');
    }
}

const { doc } = createDialogFixture();
// Native value-Zuweisungen setzen die Auswahl zurück; Tippen ersetzt ihre echte Spanne.
function selectionField(field) {
    let text = '';
    Object.defineProperty(field, 'value', { get: () => text, set(value) {
        text = String(value); field.selectionStart = field.selectionEnd = text.length;
    } });
    field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
    field.select = () => field.setSelectionRange(0, text.length);
    field.typeText = text => {
        const start = field.selectionStart, end = field.selectionEnd;
        field.value = field.value.slice(0, start) + text + field.value.slice(end);
        field.setSelectionRange(start + text.length, start + text.length);
    };
    return field;
}
for (const spec of HOUSEHOLD_PLAN_FIELDS.filter(spec => !spec.checkbox && !spec.options)) {
    for (const viaTab of [false, true]) {
        const fixture = createDialogFixture(), doc = fixture.doc, keys = new Set(), moves = new Set();
        const add = doc.addEventListener.bind(doc), remove = doc.removeEventListener.bind(doc);
        doc.addEventListener = (type, fn) => { if (type === 'keydown') keys.add(fn); else if (type === 'pointermove') moves.add(fn); else add(type, fn); };
        doc.removeEventListener = (type, fn) => { if (type === 'keydown') keys.delete(fn); else if (type === 'pointermove') moves.delete(fn); else remove(type, fn); };
        const row = doc.createElement('div'), field = selectionField(doc.createElement('input'));
        field.id = spec.path; row.append(field); doc.body.append(row);
        let writes = 0;
        const binding = bindHouseholdPlanField({ doc, row, field, path: spec.path, onChange: () => writes++ });
        const value = spec.path.split('.').reduce((v, key) => v[key], PLAN_DEFAULTS);
        binding.project(value);
        if (viaTab) { field.setSelectionRange(0, 0); for (const fn of keys) fn({ key: 'Tab' }); }
        else field.setSelectionRange(0, 0);
        field.focus(); await field.fire('focus');
        const editing = field.value;
        assertEqual(field.selectionStart, 0, spec.path + ': Vollauswahl beginnt nach Fokus bei 0');
        assertEqual(field.selectionEnd, editing.length, spec.path + ': Vollauswahl umfasst die reine Zahl');
        assertEqual(readHouseholdPlanField(field, spec.path), value, spec.path + ': Auswahl erhält kanonischen Wert');
        await field.fire('blur'); doc.activeElement = null;
        assertEqual(writes, 0, spec.path + ': Auswahl/Fokus/Blur ohne Schreibcallback');
        binding.project(spec.path === 'floorBedarf' ? 30600 : value);
        field.setSelectionRange(0, 0); field.focus();
        // fire beginnt synchron; die Auswahl muss vor seinem ersten await stimmen.
        const focusing = field.fire('focus');
        assertEqual(field.selectionStart, 0, spec.path + ': Fokus markiert synchron');
        assertEqual(field.selectionEnd, field.value.length, spec.path + ': Fokus markiert synchron vollständig');
        await focusing;
        if (spec.path === 'floorBedarf') {
            assertEqual(field.value, '30600', '30.600 € wird zur reinen Zahl');
            assertEqual(field.selectionEnd, 5, 'Vollauswahl 0–5');
        }
        field.select(); field.typeText('20000'); await field.fire('input');
        assertEqual(field.value, '20000', spec.path + ': Tippen ersetzt tatsächlich gesetzte Auswahl');
        assertEqual(readHouseholdPlanField(field, spec.path), spec.scale === 100 ? 200 : 20000, spec.path + ': Ersatz wird kanonisch gelesen');
        await field.fire('blur'); doc.activeElement = null;
        binding.project(value);
        field.setSelectionRange(0, 0); await field.fire('pointerdown'); field.focus(); await field.fire('focus');
        assertEqual(field.selectionStart, 0, spec.path + ': auch erster Mausfokus markiert vollständig');
        field.typeText('4'); await field.fire('input');
        await Promise.resolve();
        assertEqual(field.value, '4', spec.path + ': kein verzögerter Handler verändert Ersatz');
        field.setSelectionRange(0, 0); await field.fire('click');
        assertEqual(field.selectionStart, 0, spec.path + ': spätere Nutzerauswahl bleibt erhalten');
        await field.fire('blur'); doc.activeElement = null;
        binding.project(value); field.focus(); await field.fire('focus');
        field.setSelectionRange(0, Math.min(2, field.value.length)); await field.fire('click');
        assertEqual(field.selectionEnd, Math.min(2, field.value.length), spec.path + ': gezogene Auswahl bleibt erhalten');
        binding.dispose(); assertEqual(keys.size, 0, spec.path + ': Dispose entfernt Tablistener');
        assertEqual(moves.size, 0, spec.path + ': Dispose entfernt Draglistener');
    }
}
for (const [path, value] of [['floorBedarf', 30000.254987], ['survivalQuantile', .853456789], ['goGoMultiplier', 1.123456789],
    ...['longevityQuantileShift', 'longevityRelativePct', 'survivalQuantile'].flatMap(path => [0.07, 0.29, 0.57].map(value => [path, value]))]) {
    const row = doc.createElement('div'), field = doc.createElement('input'); field.id = path; row.append(field); doc.body.append(row);
    let writes = 0;
    const binding = bindHouseholdPlanField({ doc, field, row, path, onChange: () => writes++ });
    binding.project(value); const display = field.value;
    assertEqual(readHouseholdPlanField(field, path), value, path + ': gerundete Darstellung bewahrt Präzision');
    field.focus(); await field.fire('focus'); const editing = field.value;
    assertEqual(parseHouseholdPlanNumber(editing, path), value, path + ': tatsächlicher Fokustext erhält volle Präzision');
    assertEqual(readHouseholdPlanField(field, path), value, path + ': Fokus erhält kanonischen Wert');
    binding.project(value); assertEqual(field.value, editing, path + ': aktive Eingabe bleibt bei Projektion erhalten');
    await field.fire('blur'); doc.activeElement = null;
    assertEqual(field.value, display, path + ': Blur stellt Anzeige wieder her');
    assertEqual(readHouseholdPlanField(field, path), value, path + ': Fokus/Blur ändert keine kanonischen Werte');
    assertEqual(writes, 0, path + ': Darstellung erzeugt keinen Write');
    field.value = 'falsch'; await field.fire('blur'); assertEqual(field.value, 'falsch', path + ': ungültiger Zwischenstand bleibt korrigierbar');
    binding.dispose();
}
for (const spec of HOUSEHOLD_PLAN_FIELDS.filter(spec => spec.segment)) {
    const row = doc.createElement('div'), field = doc.createElement(spec.checkbox ? 'input' : 'select'); field.id = spec.path;
    row.append(field); doc.body.append(row); let writes = 0;
    const binding = bindHouseholdPlanField({ doc, row, field, path: spec.path, onChange: () => writes++ });
    const initial = spec.checkbox ? true : spec.options[1][0]; binding.project(initial);
    const buttons = row.querySelectorAll('button');
    const first = buttons[0]; await first.fire('click');
    assertEqual(writes, Object.is(initial, spec.checkbox ? true : spec.options[0][0]) ? 0 : 1, spec.path + ': ein tatsächlicher Segmentwechsel');
    await first.fire('click'); const count = writes;
    assertEqual(first.getAttribute('aria-pressed'), 'true', spec.path + ': aktive Auswahl zugänglich');
    field.disabled = true; binding.sync(PLAN_DEFAULTS); await buttons[1].fire('click');
    assert(buttons.every(button => button.disabled), spec.path + ': Disabled synchronisiert');
    assertEqual(writes, count, spec.path + ': gesperrtes Segment schreibt nicht');
    assertEqual(row.querySelector('[data-plan-segment]').getAttribute('aria-label'), spec.label, spec.path + ': zugänglicher Gruppenname');
    binding.dispose();
}

// Erneute Bindung desselben nativen Felds lässt keine alten Segmente/Listener zurück.
{
    const row = doc.createElement('div'), field = doc.createElement('select'); field.id = 'rebind'; row.append(field); doc.body.append(row);
    let oldChanges = 0, newChanges = 0;
    const old = bindHouseholdPlanField({ doc, field, row, path: 'decumulation.mode', onChange: () => oldChanges++ }); old.project('standard');
    const current = bindHouseholdPlanField({ doc, field, row, path: 'decumulation.mode', onChange: () => newChanges++ }); current.project('standard');
    assertEqual(row.querySelectorAll('[data-plan-segment]').length, 1, 'Erneute Bindung erhält genau ein Segment');
    await row.querySelectorAll('button')[1].fire('click');
    assertEqual(oldChanges, 0, 'Erneute Bindung entfernt alte Listener');
    assertEqual(newChanges, 1, 'Erneute Bindung erzeugt genau einen Änderungsaufruf');
    current.dispose(); assertEqual(row.querySelectorAll('[data-plan-segment]').length, 0, 'Dispose entfernt erzeugte Segmente');
}

// Gemeinsame Presetbindung: lokale Absicht, Sperre, erneutes Binden und Disposal.
{
    const { doc } = createDialogFixture(), row = doc.createElement('div'), field = doc.createElement('input');
    field.id = 'invalidMinimum'; row.append(field); doc.body.append(row);
    const binding = bindHouseholdPlanField({ doc, row, field, path: 'minimumFlexAnnual', onChange() {} });
    binding.project(6000);
    field.focus(); await field.fire('focus'); field.value = '999999';
    readHouseholdPlanField(field, 'minimumFlexAnnual');
    binding.sync(PLAN_DEFAULTS, 'Mindest-Flex darf den Wunschbedarf (Flex) nicht überschreiten.');
    await field.fire('change'); await field.fire('blur'); doc.activeElement = null;
    assertEqual(field.value, '999999', 'Fachlich ungültige endliche Zahl bleibt beim Fokusverlust exakt erhalten');
    binding.project(6000);
    assertEqual(field.value, '999999', 'Gewöhnliche Projektion ersetzt keinen ungültigen Entwurf');
    field.focus(); await field.fire('focus');
    assertEqual(field.value, '999999', 'Erneuter Fokus erhält ungültigen Text');
    assertEqual(field.getAttribute('aria-invalid'), 'true', 'Fokuswechsel erhält Feldmarkierung');
    assert(!row.querySelector('.household-plan-error').hidden, 'Fokuswechsel erhält sichtbare Feldmeldung');
    binding.project(6000, { force: true }); binding.sync(PLAN_DEFAULTS);
    assertEqual(readHouseholdPlanField(field, 'minimumFlexAnnual'), 6000, 'Ausdrückliche Rücknahme darf den Entwurf ersetzen');
    binding.dispose();
}
import { bindHouseholdPlanDynamicFlex } from '../app/shared/household-plan-dynamic-flex.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
{
    const { doc } = createDialogFixture(), host = doc.createElement('div'), details = doc.createElement('div');
    doc.body.append(host, details);
    let values = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('ausgewogen') }, locked = false, changes = [];
    const options = { doc, host, details, read: () => values, disabled: () => locked,
        onChange: patch => { changes.push(patch); values = { ...values, ...patch }; } };
    const first = bindHouseholdPlanDynamicFlex(options);
    assert(details.hidden && !host.querySelector('[data-plan-dynamic-hint]').hidden, 'Festes Preset zeigt Hinweis und verbirgt alle Details');
    await host.querySelector('[data-plan-dynamic-preset="custom"]').fire('click'); first.sync();
    assert(!details.hidden, 'Bewusste Customöffnung bleibt nach Erkennung erhalten');
    assertEqual(changes.length, 0, 'Aktive Detailöffnung erzeugt kein Fachereignis');
    locked = true; first.sync(); await host.querySelector('[data-plan-dynamic-preset="off"]').fire('click');
    assert(host.querySelectorAll('button').every(button => button.disabled), 'Alle Segmente übernehmen Disabled');
    assertEqual(changes.length, 0, 'Disabled erzeugt kein Fachereignis');
    locked = false; first.reset();
    const old = host.querySelector('[data-plan-dynamic-preset="custom"]');
    const next = bindHouseholdPlanDynamicFlex(options);
    assertEqual(host.querySelectorAll('[data-plan-dynamic-presets]').length, 1, 'Erneutes Binden erzeugt genau eine Gruppe');
    assert(details.hidden, 'Neue Bindung erkennt Werte ohne alte Öffnungsabsicht');
    await old.fire('click'); assertEqual(changes.length, 0, 'Alte Listener entfernt');
    await host.querySelector('[data-plan-dynamic-preset="off"]').fire('click');
    assertEqual(changes.length, 1, 'Aus erzeugt einen vollständigen Batchcallback');
    const before = { ...values }; await host.querySelector('[data-plan-dynamic-preset="custom"]').fire('click');
    assertEqual(JSON.stringify(changes[1]), JSON.stringify({ dynamicFlex: true }), 'Aus → Custom erzeugt nur den Einschaltpatch');
    assertEqual(JSON.stringify(values), JSON.stringify({ ...before, dynamicFlex: true }), 'Custom erhält sämtliche Fachwerte');
    next.dispose(); assertEqual(host.querySelectorAll('button').length, 0, 'Disposal entfernt Segmente');
}

// Fehlerprojektion überschreibt nur die Sichtbarkeitsbedingung, niemals Fachwerte.
for (const [path, values] of [
    ['goGoMultiplier', { ...structuredClone(PLAN_DEFAULTS), goGoActive: false }],
    ['survivalQuantile', { ...structuredClone(PLAN_DEFAULTS), horizonMethod: 'mean' }],
    ['longevityBufferYears', { ...structuredClone(PLAN_DEFAULTS), longevityMode: 'none' }]
]) {
    const { doc } = createDialogFixture(), row = doc.createElement('div'), field = doc.createElement('input');
    field.id = 'error_' + path; row.append(field); doc.body.append(row);
    const before = JSON.stringify(values);
    const binding = bindHouseholdPlanField({ doc, row, field, path, onChange() {} });
    binding.project(values[path]); binding.sync(values);
    assert(row.hidden, path + ': gültiges inaktives Detail bleibt verborgen');
    field.value = 'unlesbar'; readHouseholdPlanField(field, path);
    binding.sync(values, path + ': Bitte eine lesbare Zahl eingeben.');
    assert(!row.hidden && !field.disabled && binding.hasError(), path + ': ungültiges inaktives Detail korrigierbar');
    assert(!row.querySelector('.household-plan-error').hidden, path + ': Feldmeldung sichtbar');
    assertEqual(JSON.stringify(values), before, path + ': Fehleröffnung verändert keine Fachwerte');
    binding.project(values[path], { force: true }); binding.sync(values);
    assert(row.hidden && !binding.hasError(), path + ': Rücknahme entfernt Fehleröffnung');
    binding.dispose();
}
{
    const { doc } = createDialogFixture(), row = doc.createElement('div'), field = doc.createElement('input');
    field.id = 'nativeDynamic'; row.append(field);
    const binding = bindHouseholdPlanField({ doc, row, field, path: 'dynamicFlex', nativeOnly: true, onChange() {} });
    binding.sync(PLAN_DEFAULTS, 'dynamicFlex: Ungültiger Wert');
    assert(row.hidden && !binding.hasError(), 'nativeOnly bleibt auch bei einem Feldfehler verborgen');
    binding.dispose();
}
{
    const { doc } = createDialogFixture(), host = doc.createElement('div'), details = doc.createElement('div');
    doc.body.append(host, details);
    let values = { ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('off') }, error = true;
    const binding = bindHouseholdPlanDynamicFlex({ doc, host, details, read: () => values, disabled: () => false,
        hasDetailErrors: () => error, onChange: patch => { values = { ...values, ...patch }; } });
    for (const key of ['off', 'konservativ', 'ausgewogen', 'offensiv']) {
        await host.querySelector('[data-plan-dynamic-preset="' + key + '"]').fire('click');
        assert(!details.hidden && host.querySelector('[data-plan-dynamic-hint]').hidden, key + ': Detailfehler öffnet Presetdetails');
        error = false; binding.sync();
        assert(details.hidden && !host.querySelector('[data-plan-dynamic-hint]').hidden, key + ': behobener Fehler hinterlässt keine Customabsicht');
        error = true; binding.sync();
    }
    error = false; binding.reset();
    assert(details.hidden, 'Rücknahme entfernt zusätzliche Fehleröffnung'); binding.dispose();
}

// Führende Namen werden auch in bestehende statische Labels projiziert.
{
    const { doc } = createDialogFixture();
    const row = doc.createElement('div'), label = doc.createElement('label'), field = doc.createElement('select');
    field.id = 'managerPlan_householdWithdrawalMode'; field.value = 'runway_first';
    label.setAttribute('for', field.id);
    const title = { nodeType: 3, textContent: 'Altes Label' };
    const hint = doc.createElement('small'), info = doc.createElement('button');
    hint.textContent = 'Bestehende Hilfe'; let infoClicks = 0;
    info.addEventListener('click', () => infoClicks++);
    label.childNodes = [title, hint, info]; label.append(hint, info); row.append(label, field); doc.body.append(row);
    field.options = [{ value: 'runway_first', textContent: 'Reichweite zuerst' }];
    const binding = bindHouseholdPlanField({ doc, field, row, path: 'householdWithdrawalMode', onChange() {} });
    assertEqual(title.textContent, 'Verteilung im Haushalt', 'Managerlabel erhält den führenden Namen');
    assertEqual(field.options[0].textContent, 'Nacheinander', 'Manageroption erhält den führenden Namen');
    assertEqual(field.value, 'runway_first', 'Beschriftung ändert keine ausgewählte Strategie');
    await info.fire('click');
    assert(hint.textContent === 'Bestehende Hilfe' && infoClicks === 1, 'Kleine Hilfe und Infobutton bleiben funktionstüchtig');
    binding.dispose();
    assertEqual(HOUSEHOLD_PLAN_CARDS.strategy, 'Reserven & Entnahme', 'Gemeinsame Kartenbezeichnung aus den führenden Gruppen');
    assert(!HOUSEHOLD_PLAN_FIELDS.some(spec => spec.path === 'rebalancingBand')
        && HOUSEHOLD_PLAN_DISPLAY_FIELDS.rebalancingBand.label === 'Gold-Umschichtungsband',
        'Goldanzeige besitzt einen gemeinsamen Namen außerhalb des Planfeldsatzes');
}
import fs from 'node:fs';
import { SIMULATOR_PLAN_FIELD_MAP } from '../app/profile/household-plan.js';
import { DYNAMIC_FLEX_OPTIONS } from '../app/shared/dynamic-flex-presets.js';
import { createSelectionDocument, addField, simulatorSelectOptions } from './designsystem-selection-dom.mjs';
{
    const markup = fs.readFileSync(new URL('../Simulator.html', import.meta.url), 'utf8');
    const doc = createSelectionDocument();
    for (const [id, path] of Object.entries(SIMULATOR_PLAN_FIELD_MAP)) {
        const spec = HOUSEHOLD_PLAN_FIELDS.find(spec => spec.path === path) || HOUSEHOLD_PLAN_DISPLAY_FIELDS[path];
        // Der führende Labeltext bleibt maßgeblich, auch mit anschließendem ⓘ.
        const label = markup.match(new RegExp('<label for="' + id + '">([^<]*)'));
        assert(label?.[1].trim() === spec.label, id + ': Simulatorname entspricht dem führenden Feldsatz');
        if (spec.options) {
            const field = addField(doc, id, spec.options[0][0], simulatorSelectOptions(id));
            projectHouseholdPlanFieldLabels(doc, SIMULATOR_PLAN_FIELD_MAP);
            assert(field.options.every(option => option.textContent === spec.options.find(([key]) => key === option.value)?.[1]),
                id + ': aktive Simulatoroptionen entsprechen der gemeinsamen Quelle');
        }
    }
    assert(HOUSEHOLD_PLAN_DISPLAY_FIELDS.dynamicFlexPreset.options === DYNAMIC_FLEX_OPTIONS,
        'Presetbeschriftung verwendet die unveränderte gemeinsame Optionsquelle');
}

import { BALANCE_PLAN_FIELD_MAP } from '../app/balance/balance-plan-trial.js';
import { managerPlanFieldId } from '../app/tranches/tranchen-manager-household-plan.js';
{
    const markup = Object.fromEntries(['depot-tranchen-manager.html', 'Balance.html', 'Simulator.html']
        .map(page => [page, fs.readFileSync(new URL('../' + page, import.meta.url), 'utf8')]));
    const simulatorOnlyMissing = [];
    // Die Tabelle verbindet Planpfad und die drei real vorhandenen Formular-IDs.
    for (const spec of HOUSEHOLD_PLAN_FIELDS) {
        const row = [
            ['depot-tranchen-manager.html', managerPlanFieldId(spec.path)],
            ['Balance.html', Object.keys(BALANCE_PLAN_FIELD_MAP).find(id => BALANCE_PLAN_FIELD_MAP[id] === spec.path)],
            ['Simulator.html', Object.keys(SIMULATOR_PLAN_FIELD_MAP).find(id => SIMULATOR_PLAN_FIELD_MAP[id] === spec.path)]
        ];
        for (const [page, id] of row) {
            if (!id) { simulatorOnlyMissing.push(spec.path); continue; }
            assert(markup[page].includes(`id="${id}"`), `${spec.path}/${page}/${id}: tatsächliches Gegenstück vorhanden`);
            const doc = createSelectionDocument(), field = addField(doc, id);
            const label = doc.createElement('label');
            label.textContent = markup[page].match(new RegExp(`<(?:label for="${id}"|span id="${id}-label")[^>]*>([^<]*)`))?.[1] || '';
            assert(Boolean(label.textContent), `${spec.path}/${page}/${id}: gerenderter Ursprungstext vorhanden`);
            doc.querySelector = selector => selector === `label[for="${id}"]` ? label : null;
            projectHouseholdPlanFieldLabels(doc, { [id]: spec.path });
            assertEqual(label.textContent, spec.label, `${spec.path}/${page}/${id}: Projektion verwendet denselben führenden Namen`);
        }
    }
    assertEqual(simulatorOnlyMissing.sort().join(), 'householdWithdrawalMode',
        'Nur die Haushaltsverteilung bleibt auf Manager und Balance beschränkt');
}
