import { readHouseholdPlanField } from '../app/shared/household-plan-fields.js';
import { createAnnualPlanDraft, annualPlanFieldVisible, ANNUAL_PLAN_FIELDS, evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { PLAN_DEFAULTS, PLAN_FIELD_PATHS } from '../app/profile/household-plan.js';
import { annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { readyAnnualFixture, annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { ANNUAL_PLAN_RECORD_KEY, buildAnnualPlanRecord } from '../app/profile/annual-plan-record.js';

assertEqual(ANNUAL_PLAN_FIELDS.map(field => field.path).sort().join(','), PLAN_FIELD_PATHS.filter(path => !path.startsWith('cape.')).sort().join(','), 'Alle bearbeitbaren Planfelder, CAPE als Herkunft');
const gates = [], states = [];
const recommended = { monthlyWithdrawal: 500, monthlyBudget: 700 };
const editor = createAnnualPlanDraft({ notify: state => states.push(state), evaluate: patch => new Promise(resolve => gates.push({ patch, resolve })) });
const base = structuredClone(PLAN_DEFAULTS);
const initial = editor.setBase(base); gates.shift().resolve({ recommended, adopted: recommended }); await initial;
assertEqual(editor.accept(), undefined, 'Ohne Änderung kein Patch');
const old = editor.change('floorBedarf', 13000), newest = editor.change('flexBedarf', 25000);
assert(!editor.read().valid && editor.read().pending, 'Neue Eingabe sperrt sofort die Bestätigung');
const first = gates.shift(), second = gates.shift();
second.resolve({ recommended, adopted: { monthlyWithdrawal: 600, monthlyBudget: 800 } }); await newest;
first.resolve({ recommended, adopted: { monthlyWithdrawal: 550, monthlyBudget: 750 } }); await old;
assertEqual(editor.read().result.adopted.monthlyWithdrawal, 600, 'Verspätete Rechnung verdrängt neueste Revision nicht');
assertEqual(JSON.stringify(editor.accept()), JSON.stringify({ floorBedarf: 13000, flexBedarf: 25000 }), 'Mehrere tatsächliche Änderungen übernommen');
await editor.change('minimumFlexAnnual', 26000);
assert(!editor.read().valid && editor.read().error.includes('Mindest-Flex'), 'Ungültiger Mindest-Flex sichtbar, keine stille Begrenzung');
assertEqual(editor.read().values.minimumFlexAnnual, 26000, 'Fehlerwert bleibt korrigierbar');
let thrown = false; try { editor.accept(); } catch { thrown = true; } assert(thrown, 'Ungültige Revision nicht bestätigbar');
const discard = editor.discard(); gates.shift().resolve({ recommended, adopted: recommended }); await discard;
assertEqual(editor.accept(), undefined, 'Verwerfen entfernt sämtliche Anpassungsfelder');
assertEqual(JSON.stringify(editor.read().values), JSON.stringify(base), 'Verwerfen stellt die Empfehlung wieder her');
assert(!annualPlanFieldVisible('decumulation.drawdownTrigger', base) && !annualPlanFieldVisible('horizonYears', base), 'Strategieabhängige und aktuarische Sichtbarkeit');
assert(annualPlanFieldVisible('decumulation.drawdownTrigger', { ...base, decumulation: { ...base.decumulation, mode: '3_bucket_jilge' } }), '3-Töpfe öffnet Strategiefelder');
for (const [path, mode] of [['longevityQuantileShift', 'quantile_shift'], ['longevityRelativePct', 'relative_horizon_buffer'], ['longevityBufferYears', 'buffer_years']]) assert(annualPlanFieldVisible(path, { ...base, longevityMode: mode }), path + ': zugehöriger Modus sichtbar');
editor.dispose();
const sample = readyAnnualFixture(); const storage = annualRecordStorage(sample.records), before = JSON.stringify(storage.records);
const evaluated = await evaluateAnnualPlanPreview({ targetYear: 2026, storage, marketData: annualTestMarketData,
    adoptedPlanPatch: { floorBedarf: 20000, flexBedarf: 30000 }, now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
assertEqual(JSON.stringify(storage.records), before, 'Echte Enginevorschau verändert keinen Fachrecord');
assertEqual(evaluated.adopted.snapshot.plan.floorBedarf, 20000, 'Engine rechnet den beschlossenen Planpatch');
assert(evaluated.recommended.snapshot.plan.floorBedarf !== 20000, 'Empfehlung bleibt beim ursprünglichen Jahresplan');

// Tatsächlicher DOM-Editor: Öffnen, Segmentwechsel, Fehler und Verwerfen.
import { createAnnualPlanEditor } from '../app/shared/annual-plan-editor.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
const { doc } = createDialogFixture(), cleanups = [], calculations = [];
const ui = createAnnualPlanEditor({ doc, listen: (node, type, fn) => {
    node.addEventListener(type, fn); cleanups.push(() => node.removeEventListener(type, fn));
}, evaluate: async patch => { calculations.push(patch); return { recommended, adopted: patch ? { monthlyWithdrawal: 650, monthlyBudget: 850 } : recommended }; } });
doc.body.append(ui.root); await ui.setBase({ ...base, floorBedarf: 12000.254987 });
const toggle = ui.root.querySelector('[data-annual-plan-toggle]'), panel = ui.root.querySelector('[data-annual-plan-panel]');
const pill = ui.root.querySelector('[data-annual-plan-adjusted]'), discardButton = ui.root.querySelector('[data-annual-plan-discard]');
assert(panel.hidden && toggle.getAttribute('aria-expanded') === 'false', 'Feldbereich ist initial geschlossen');
assertEqual(ui.root.querySelectorAll('table').length, 1, 'Zuerst ruhige Vergleichstabelle');
assertEqual(ui.root.querySelectorAll('.household-plan-group').length, 6, 'Identische sechs Gruppen im Abschlussdialog');
assertEqual(ui.root.querySelectorAll('.household-plan-used').length, 0, 'Jahreseditor erzeugt keine Nutzungskennzeichen');
assertEqual(ui.root.querySelectorAll('.household-plan-note').length, 0, 'Jahreseditor erzeugt keine ergänzende CAPE-Fußnote');
assert(ui.root.querySelector('[data-annual-plan-cape]').textContent.length > 0, 'CAPE-Herkunft bleibt direkt am lesenden Wert');
assertEqual(ui.root.querySelectorAll('[data-annual-recommendation]')[0].textContent, '500 €', 'Vergleich zeigt ganze Euro');
await toggle.fire('click');
assert(!panel.hidden && toggle.getAttribute('aria-controls') === panel.id, 'Bewusste Öffnung mit zugänglicher Bindung');
assertEqual(ui.accept(), undefined, 'Öffnen erzeugt keinen Patch');
assertEqual(calculations.length, 1, 'Öffnen startet keine zusätzliche Rechnung');
await toggle.fire('click');
assert(panel.hidden && toggle.getAttribute('aria-expanded') === 'false', 'Erneuter Klick schließt nur die Darstellung');
assertEqual(ui.accept(), undefined, 'Schließen erzeugt keinen Patch');
assertEqual(calculations.length, 1, 'Schließen startet keine Rechnung');
await toggle.fire('click');
const revisionBeforeFocus = ui.read().revision;
for (const spec of ANNUAL_PLAN_FIELDS.filter(spec => !spec.options && !spec.checkbox)) {
    const field = doc.getElementById('annualPlan_' + spec.path.replaceAll('.', '_'));
    field.selectionStart = field.selectionEnd = 0;
    field.setSelectionRange = (start, end) => { field.selectionStart = start; field.selectionEnd = end; };
    field.focus(); const focusing = field.fire('focus');
    assertEqual(field.selectionStart, 0, spec.path + ': Jahreseditor markiert synchron ab Anfang');
    assertEqual(field.selectionEnd, field.value.length, spec.path + ': Jahreseditor markiert synchron bis Ende');
    await focusing; await field.fire('blur'); doc.activeElement = null;
}
const floorInput = doc.getElementById('annualPlan_floorBedarf'); floorInput.focus(); await floorInput.fire('focus'); await floorInput.fire('blur');
assertEqual(ui.accept(), undefined, 'Fokus und Blur ohne Patch trotz gerundeter Anzeige');
assertEqual(calculations.length, 1, 'Fokus aller Zahlenfelder startet keine Rechnung');
assertEqual(ui.read().revision, revisionBeforeFocus, 'Fokus/Blur ohne Dirtybatch erzeugt keine Revision');
await ui.setBase({ ...base, floorBedarf: 30600 });
floorInput.focus(); await floorInput.fire('focus');
floorInput.value = floorInput.value.slice(0, floorInput.selectionStart) + '20000' + floorInput.value.slice(floorInput.selectionEnd);
await floorInput.fire('input'); await Promise.resolve();
assertEqual(ui.accept().floorBedarf, 20000, 'Jahreseditor ersetzt 30.600 € exakt durch 20000');
await floorInput.fire('blur'); doc.activeElement = null;
await discardButton.fire('click'); await Promise.resolve();

const minimum = doc.getElementById('annualPlan_minimumFlexAnnual'); minimum.value = '999999'; await minimum.fire('input');
assert(!ui.read().valid && minimum.getAttribute('aria-invalid') === 'true', 'Ungültiges Mindest-Flex sperrt und markiert das Feld');
assert(doc.getElementById(minimum.id + '_error').textContent.includes('Mindest-Flex'), 'Fehler am Feld verständlich zugeordnet');
assertEqual(minimum.value, '999999', 'Ungültige Eingabe bleibt korrigierbar');
assert(!pill.hidden && !panel.hidden && !discardButton.disabled, 'Echte Anpassung zeigt Pille, offene Felder und Verwerfen');
await discardButton.fire('click'); await Promise.resolve();
assertEqual(ui.accept(), undefined, 'DOM-Verwerfen entfernt sämtliche Anpassungsfelder');
assert(!panel.hidden && pill.hidden && discardButton.disabled, 'Nach Verwerfen offen, ohne Anpassungspille');
const strategy = ui.root.querySelectorAll('[data-plan-segment]').find(node => node.dataset.planSegment === 'decumulation.mode');
await strategy.querySelectorAll('button')[1].fire('click'); await Promise.resolve();
assertEqual(ui.accept().decumulation.mode, '3_bucket_jilge', 'Segment ändert ausschließlich bestehenden Strategiewert');
assert(!doc.getElementById('annualPlan_decumulation_drawdownTrigger').closest('.household-plan-field').hidden, 'Strategie öffnet zugehörige Felder');
assert(!pill.hidden && ui.root.querySelectorAll('[data-annual-adopted]')[0].textContent === '650 €', 'Angepasster Vergleich folgt neuer Rechnung');
ui.dispose(); cleanups.forEach(cleanup => cleanup());

// UI-Validierung vor jeder echten Enginevorschau, ohne Änderung von Fachrecords.
{
    const { doc } = createDialogFixture(), removers = [];
    let evaluatedCount = 0;
    // Einzelprofil prüft die UI-Grenze unabhängig von Haushalts-Quellenkapazitäten.
    // Die echte Haushaltsvorschau mit gültigem Planpatch wird oben separat geprüft.
    const boundarySample = readyAnnualFixture('Einzelprofil'), boundaryStorage = annualRecordStorage(boundarySample.records);
    const priorPreview = await evaluateAnnualPlanPreview({ targetYear: 2026, storage: boundaryStorage, marketData: annualTestMarketData,
        now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
    const receiptBytes = buildAnnualPlanRecord(null, { targetYear: 2025, scope: boundarySample.scope,
        committedAt: '2026-01-02T12:00:00.000Z', recommended: priorPreview.recommended, adopted: priorPreview.recommended }).raw;
    boundaryStorage.setItem(ANNUAL_PLAN_RECORD_KEY, receiptBytes);
    const protectedBytes = JSON.stringify(boundaryStorage.records);
    const trial = createAnnualPlanEditor({ doc, listen: (node, type, fn) => {
        node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn));
    }, evaluate: async patch => {
        evaluatedCount++;
        return evaluateAnnualPlanPreview({ targetYear: 2026, storage: boundaryStorage, marketData: annualTestMarketData,
            adoptedPlanPatch: { flexBedarf: 10_000_000, ...patch }, now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
    } });
    doc.body.append(trial.root);
    const baseline = { ...structuredClone(evaluated.values), flexBedarf: 10_000_000 };
    await trial.setBase(baseline);
    for (const spec of ANNUAL_PLAN_FIELDS.filter(spec => spec.unit === '€')) {
        for (const invalid of ['10000000,01', '3000033000', 'unlesbar', '-1']) {
            const field = doc.getElementById('annualPlan_' + spec.path), beforeCount = evaluatedCount;
            field.value = invalid; await field.fire('input');
            assertEqual(evaluatedCount, beforeCount, spec.path + ': keine evaluate-Rechnung für ' + invalid);
            assert(!trial.read().valid && !trial.read().pending, spec.path + ': ungültiger Entwurf nicht akzeptierbar');
            let refused = false; try { trial.accept(); } catch { refused = true; }
            assert(refused, spec.path + ': accept weist ungültigen Entwurf ab');
            assertEqual(field.getAttribute('aria-invalid'), 'true', spec.path + ': DOM-Feldfehler');
            const message = doc.getElementById(field.id + '_error').textContent;
            assert(message.includes(spec.label) && !message.includes('Profilverbund'), spec.path + ': verständliche Eingabemeldung');
            assertEqual(field.value, invalid, spec.path + ': keine stille Begrenzung');
            assertEqual(JSON.stringify(boundaryStorage.records), protectedBytes, spec.path + ': Plan, Beleg und alle übrigen Records bytegleich');
        }
        const field = doc.getElementById('annualPlan_' + spec.path), beforeCount = evaluatedCount;
        field.value = '10000000'; await field.fire('input');
        // fire wartet nicht auf das bewusst asynchrone Produktcalculate.
        for (let i = 0; i < 20 && trial.read().pending; i++) await Promise.resolve();
        assertEqual(evaluatedCount, beforeCount + 1, spec.path + ': exakte Grenze startet eine Rechnung');
        assert(trial.read().valid, spec.path + ': exakte Grenze positiv akzeptierbar: ' + trial.read().error);
        assertEqual(trial.read().values[spec.path], 10_000_000, spec.path + ': Grenzbetrag wird nicht gerundet');
        await trial.root.querySelector('[data-annual-plan-discard]').fire('click');
        for (let i = 0; i < 20 && trial.read().pending; i++) await Promise.resolve();
    }
    const minimum = doc.getElementById('annualPlan_minimumFlexAnnual'), count = evaluatedCount;
    minimum.value = '10000001'; await minimum.fire('input');
    assertEqual(evaluatedCount, count, 'Mindest-Flex-Verletzung startet keine Rechnung');
    await trial.root.querySelector('[data-annual-plan-discard]').fire('click');
    for (let i = 0; i < 20 && trial.read().pending; i++) await Promise.resolve();
    const flex = doc.getElementById('annualPlan_flexBedarf');
    minimum.value = '100'; await minimum.fire('input');
    for (let i = 0; i < 20 && trial.read().pending; i++) await Promise.resolve();
    const beforeCoupled = evaluatedCount; flex.value = '99'; await flex.fire('input');
    assertEqual(evaluatedCount, beforeCoupled, 'Gekoppelte Mindest-Flex-Verletzung vor evaluate');
    assert(trial.read().error.includes('Mindest-Flex') && minimum.getAttribute('aria-invalid') === 'true', 'Gekoppelter Feldfehler erklärt die Untergrenze');
    flex.value = '33000'; await flex.fire('input');
    for (let i = 0; i < 20 && trial.read().pending; i++) await Promise.resolve();
    assert(trial.read().valid && trial.accept().flexBedarf === 33000, 'Gültige Korrektur wird wieder akzeptiert');
    assertEqual(JSON.stringify(boundaryStorage.records), protectedBytes, 'Auch gültige Vorschauen erhalten sämtliche Fachrecords');
    assertEqual(boundaryStorage.getItem(ANNUAL_PLAN_RECORD_KEY), receiptBytes, 'Vorhandener gültiger Jahresbeleg bleibt ausdrücklich bytegleich');
    trial.dispose(); removers.forEach(remove => remove());
}
{
    let calls = 0;
    const trial = createAnnualPlanDraft({ evaluate: async () => { calls++; return { recommended, adopted: recommended }; } });
    await trial.setBase({ ...base, floorBedarf: 30_000_000 });
    assert(trial.read().valid && calls === 1, 'Hoher gespeicherter Altbetrag bleibt ohne Eingriff gültig');
    await trial.change('minCashBufferMonths', 3);
    assert(trial.read().valid && calls === 2, 'Andere Eingabe bereinigt den Altbetrag nicht');
    trial.dispose();
    const technical = createAnnualPlanDraft({ evaluate: async () => { throw new Error('Technischer Vorschaufehler'); } });
    await technical.setBase(base);
    assertEqual(technical.read().error, 'Technischer Vorschaufehler', 'Technische Fehler bleiben unverändert erkennbar');
    technical.dispose();
}

// Atomare Presetentwürfe und Übernahme durch die vorhandene Jahresbestätigung.
import { dynamicFlexPresetPatch, detectDynamicFlexPreset } from '../app/shared/dynamic-flex-presets.js';
import { computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { commitAnnualPlanUpdate } from '../app/balance/balance-annual-storage-commit.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord } from '../app/profile/household-plan.js';
{
    const fixture = readyAnnualFixture('Einzelprofil'), storage = annualRecordStorage(fixture.records);
    const original = JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[fixture.scope.key].values;
    const active = { ...original, ...dynamicFlexPresetPatch('ausgewogen'), goGoMultiplier: 1.2 };
    storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(storage.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: fixture.scope, values: active }]).raw);
    const evaluate = patch => evaluateAnnualPlanPreview({ targetYear: 2026, storage, marketData: annualTestMarketData,
        now: annualTestNow, engineLoader: { load: async () => EngineAPI }, adoptedPlanPatch: patch });
    const preview = await evaluate();
    const receipt = buildAnnualPlanRecord(null, { targetYear: 2025, scope: fixture.scope,
        committedAt: '2026-01-02T12:00:00.000Z', recommended: preview.recommended, adopted: preview.recommended }).raw;
    storage.setItem(ANNUAL_PLAN_RECORD_KEY, receipt);
    const protectedBytes = JSON.stringify(storage.records), { doc } = createDialogFixture(), removers = [], gates = [];
    const ui = createAnnualPlanEditor({ doc, listen(node, type, fn) { node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn)); },
        evaluate: patch => {
            let resolve; const done = new Promise(release => { resolve = release; }).then(() => evaluate(patch));
            gates.push({ patch, resolve, done }); return done;
        } });
    doc.body.append(ui.root);
    const initial = ui.setBase(preview.values); gates.shift().resolve(); await initial;
    await ui.root.querySelector('[data-annual-plan-toggle]').fire('click');
    const field = doc.getElementById('annualPlan_goGoMultiplier'), details = ui.root.querySelector('[data-plan-dynamic-details]');
    const custom = ui.root.querySelector('[data-plan-dynamic-preset="custom"]'), hint = ui.root.querySelector('[data-plan-dynamic-hint]');
    const open = label => {
        assert(!details.hidden && !field.disabled, label + ': Details und Faktor bedienbar');
        assertEqual(custom.getAttribute('aria-pressed'), 'true', label + ': Custom gedrückt');
        assert(hint.hidden, label + ': Hinweis verborgen');
    };
    const settle = async () => { const gate = gates.shift(); gate.resolve(); await gate.done; await Promise.resolve(); };
    open('Aktiver individueller Jahresplan ohne Customklick');
    field.focus();
    for (const text of ['1,1', '1,15']) {
        field.value = text; await field.fire('input'); open(text);
        assert(doc.activeElement === field, text + ': Faktor behält Fokus');
        assertEqual(field.value, text, text + ': Text unverändert');
        assertEqual(ui.read().values.goGoMultiplier, Number(text.replace(',', '.')), text + ': Entwurf aktuell');
        assertEqual(JSON.stringify(storage.records), protectedBytes, 'Eingabe verändert weder Plan noch Jahresbeleg');
    }
    const older = gates.shift(), latest = gates.shift(); latest.resolve(); await latest.done; await Promise.resolve();
    assert(ui.read().valid && ui.accept().goGoMultiplier === 1.15, 'Aktuelle echte Vorschau akzeptiert 1,15');
    const result = ui.read().result;
    older.resolve(); await older.done; await Promise.resolve();
    assert(ui.read().result === result && ui.read().values.goGoMultiplier === 1.15, 'Verspätete Revision ersetzt weder Ergebnis noch Entwurfswert');
    open('Aktuelles und verspätetes Ergebnis');
    assertEqual(field.value, '1,15', 'Ergebnisse überschreiben fokussierten Text nicht');
    const recalculation = ui.setBase(preview.values); gates.shift().resolve(); await recalculation;
    open('Jahresbasisneuberechnung erhält Bearbeitungsabsicht');
    assertEqual(ui.accept().goGoMultiplier, 1.15, 'Basisneuberechnung erhält Entwurf');
    await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await settle();
    open('Verwerfen auf individuelle Basis');
    assertEqual(ui.accept(), undefined, 'Verwerfen entfernt Patch');
    // Die erste synchrone calculate-Meldung enthält noch Customwerte.
    field.focus(); await ui.root.querySelector('[data-plan-dynamic-preset="ausgewogen"]').fire('click');
    assert(details.hidden && !hint.hidden, 'Ausdrückliche Presetwahl schließt trotz alter synchroner Werte');
    assert(!details.contains(doc.activeElement), 'Schließen verlagert Fokus aus den Details');
    await settle(); assert(details.hidden, 'Presetresultat öffnet Details nicht erneut');
    const revision = ui.read().revision;
    await custom.fire('click'); open('Ausdrückliches Custom bei passenden aktiven Werten');
    assertEqual(ui.read().revision, revision, 'Reine Öffnung erzeugt keine Revision');
    assertEqual(gates.length, 0, 'Reine Öffnung startet keine Rechnung');
    const matchingBase = { ...preview.values, ...dynamicFlexPresetPatch('ausgewogen') };
    const matched = ui.setBase(matchingBase); gates.shift().resolve(); await matched;
    open('Laufende passende Basis erhält Absicht');
    await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await settle();
    assert(details.hidden && !hint.hidden, 'Verwerfen auf passende Basis erkennt Preset erneut');
    assertEqual(ui.accept(), undefined, 'Passende Basis ohne Patch');
    assertEqual(JSON.stringify(storage.records), protectedBytes, 'Alle Vorschauen erhalten Plan- und Belegbytes');
    assertEqual(storage.getItem(ANNUAL_PLAN_RECORD_KEY), receipt, 'Gültiger Jahresbeleg ausdrücklich bytegleich');
    ui.dispose(); removers.forEach(remove => remove());
    const rebound = createAnnualPlanEditor({ doc, listen: (node, type, fn) => node.addEventListener(type, fn), evaluate });
    doc.body.append(rebound.root); await rebound.setBase(matchingBase);
    assert(rebound.root.querySelector('[data-plan-dynamic-details]').hidden, 'Neue Editorbindung erkennt passende Basis');
    rebound.dispose();
}
for (const matching of [false, true]) {
    const fixture = readyAnnualFixture('Einzelprofil'), storage = annualRecordStorage(fixture.records);
    const original = JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[fixture.scope.key].values;
    const off = { ...original, ...dynamicFlexPresetPatch('ausgewogen'), dynamicFlex: false,
        goGoMultiplier: matching ? 1.1 : 1.17, longevityRelativePct: .07 };
    storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(storage.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: fixture.scope, values: off }]).raw);
    const protectedBytes = JSON.stringify(storage.records), calculations = [];
    const { doc } = createDialogFixture(), removers = [];
    const ui = createAnnualPlanEditor({ doc, listen(node, type, fn) { node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn)); },
        evaluate: async patch => { calculations.push(patch); return evaluateAnnualPlanPreview({ targetYear: 2026, storage,
            marketData: annualTestMarketData, now: annualTestNow, engineLoader: { load: async () => EngineAPI }, adoptedPlanPatch: patch }); } });
    doc.body.append(ui.root);
    const preview = await evaluateAnnualPlanPreview({ targetYear: 2026, storage, marketData: annualTestMarketData,
        now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
    await ui.setBase(preview.values);
    await ui.root.querySelector('[data-annual-plan-toggle]').fire('click');
    const buttons = ui.root.querySelectorAll('[data-plan-dynamic-preset]');
    assertEqual(buttons.map(button => button.textContent).join(' · '), 'Aus · Konservativ · Ausgewogen · Offensiv · Benutzerdefiniert', 'Abschluss enthält genau fünf Presetsegmente');
    assert(ui.root.querySelector('[data-plan-dynamic-details]').hidden, 'Aus im Entwurf verbirgt alle Details');
    const revision = ui.read().revision, count = calculations.length;
    await buttons[4].fire('click');
    for (let i = 0; i < 30 && ui.read().pending; i++) await Promise.resolve();
    assertEqual(ui.read().revision, revision + 1, 'Aus → Custom ist eine Entwurfsrevision');
    assertEqual(calculations.length, count + 1, 'Aus → Custom startet genau eine aktuelle Berechnung');
    assertEqual(JSON.stringify(ui.accept()), JSON.stringify({ dynamicFlex: true }), 'Atomarer Einschaltpatch ohne Defaults oder Detailänderung');
    for (const path of Object.keys(dynamicFlexPresetPatch('ausgewogen')).filter(path => path !== 'dynamicFlex')) assertEqual(ui.read().values[path], off[path], 'Abschluss erhält ' + path);
    assertEqual(JSON.stringify(storage.records), protectedBytes, 'Keine vorzeitige Persistenz von Entwurf oder Beleg');
    assert(!ui.root.querySelector('[data-plan-dynamic-details]').hidden, 'Customabsicht bleibt auch bei passenden aktiven Werten offen');
    await buttons[4].fire('click'); assertEqual(calculations.length, count + 1, 'Aktive Customöffnung berechnet nicht erneut');
    await ui.root.querySelector('[data-annual-plan-discard]').fire('click');
    for (let i = 0; i < 30 && ui.read().pending; i++) await Promise.resolve();
    assertEqual(ui.accept(), undefined, 'Verwerfen entfernt Einschaltpatch');
    assertEqual(ui.read().values.dynamicFlex, false, 'Verwerfen erhält ausgeschaltete Empfehlung');
    assert(ui.root.querySelector('[data-plan-dynamic-details]').hidden, 'Verwerfen erkennt erneut Aus');
    assertEqual(JSON.stringify(storage.records), protectedBytes, 'Verwerfen erhält Plan und Belegbytes');
    await buttons[4].fire('click');
    for (let i = 0; i < 30 && ui.read().pending; i++) await Promise.resolve();
    const adoptedPlanPatch = ui.accept();
    ui.dispose(); removers.forEach(remove => remove());
    assertEqual(JSON.stringify(storage.records), protectedBytes, 'Dialogabbruch/Dispose persistiert nichts');
    // Vorhandene Abschlussgrenze: erst jetzt ist der Fachwrite vorbereitet.
    const state = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY));
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'synthetic-before', phase: 'writes_started' };
    storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, storage, marketData: annualTestMarketData, now: annualTestNow });
    const persistence = { flush: async () => true, async replaceRecordsTransactional(records, options) {
        for (const [key, raw] of Object.entries(records)) storage.setItem(key, raw);
        options.postValidate(storage.records);
    } };
    await commitAnnualPlanUpdate({ draft, storage, persistence, engineApi: EngineAPI, adoptedPlanPatch, now: annualTestNow });
    const adopted = JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[fixture.scope.key].values;
    assertEqual(adopted.dynamicFlex, true, 'Erst Jahresbestätigung übernimmt Einschalten');
    assertEqual(detectDynamicFlexPreset(adopted), matching ? 'ausgewogen' : 'custom', 'Nach bestätigtem Jahresabschluss niemals Aus');
    const receipt = Object.values(JSON.parse(storage.getItem(ANNUAL_PLAN_RECORD_KEY)).entries).find(entry => entry.periodId === 'calendar-year:2026');
    assert(receipt.adjusted && receipt.adopted.snapshot.plan.dynamicFlex === true && receipt.recommended.snapshot.plan.dynamicFlex === false, 'Beleg trennt ausgeschaltete Empfehlung und aktiven Beschluss');
}
{
    const gates = [], trial = createAnnualPlanDraft({ evaluate: patch => new Promise(resolve => gates.push({ patch, resolve })) });
    const baseOff = { ...structuredClone(PLAN_DEFAULTS), dynamicFlex: false };
    const first = trial.setBase(baseOff); gates.shift().resolve({ recommended, adopted: recommended }); await first;
    const old = trial.changeBatch(dynamicFlexPresetPatch('konservativ'));
    const latest = trial.changeBatch(dynamicFlexPresetPatch('offensiv'));
    assert(trial.read().pending && !trial.read().valid, 'Presetwahl entwertet Resultate synchron');
    assertEqual(gates.length, 2, 'Ein evaluate pro vollständiger Presetwahl');
    const outdated = gates.shift(), current = gates.shift();
    current.resolve({ recommended, adopted: { monthlyWithdrawal: 700 } }); await latest;
    outdated.resolve({ recommended, adopted: { monthlyWithdrawal: 900 } }); await old;
    assertEqual(trial.read().result.adopted.monthlyWithdrawal, 700, 'Veraltetes Presetresultat verdrängt aktuelle Rechnung nicht');
    await trial.change('minimumFlexAnnual', 999999);
    assert(!trial.read().valid && !trial.read().pending, 'Ungültiger Presetentwurf sperrt Übernahme');
    assertEqual(gates.length, 0, 'Ungültiger Entwurf startet keine Engineberechnung');
    trial.dispose();
}
{
    const { doc } = createDialogFixture(), removers = [], calls = [];
    const ui = createAnnualPlanEditor({ doc, listen(node, type, fn) { node.addEventListener(type, fn); removers.push(() => node.removeEventListener(type, fn)); },
        evaluate: async patch => { calls.push(patch); return { recommended, adopted: recommended }; } });
    doc.body.append(ui.root);
    await ui.setBase({ ...structuredClone(PLAN_DEFAULTS), dynamicFlex: false, floorBedarf: 12000 });
    await ui.setBase({ ...structuredClone(PLAN_DEFAULTS), dynamicFlex: false, floorBedarf: 24000 });
    const count = calls.length;
    await ui.root.querySelector('[data-plan-dynamic-preset="konservativ"]').fire('click'); await Promise.resolve();
    assertEqual(calls.length, count + 1, 'Preset nach neuer Jahresbasis berechnet genau einmal');
    assertEqual(ui.read().values.floorBedarf, 24000, 'Preset übernimmt keine unberührten alten Anzeigewerte in neue Jahresbasis');
    assert(!Object.hasOwn(ui.accept(), 'floorBedarf'), 'Presetpatch bleibt auf Dynamik beschränkt');
    await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await Promise.resolve();
    // Noch ungemeldete gültige und ungültige Eingaben bleiben Teil des Einschaltbatchs.
    const field = doc.getElementById('annualPlan_goGoMultiplier'); field.value = '1,17';
    await ui.root.querySelector('[data-plan-dynamic-preset="custom"]').fire('click'); await Promise.resolve();
    assertEqual(ui.accept().goGoMultiplier, 1.17, 'Einschalten erhält noch ungemeldete gültige Dynamikdetails');
    assertEqual(ui.accept().dynamicFlex, true, 'Detailtext und Einschalten sind derselbe Entwurf');
    await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await Promise.resolve();
    doc.getElementById('annualPlan_minimumFlexAnnual').value = '999999';
    const beforeInvalid = calls.length;
    await ui.root.querySelector('[data-plan-dynamic-preset="custom"]').fire('click');
    assert(!ui.read().valid && calls.length === beforeInvalid, 'Ungemeldeter ungültiger Text verhindert isolierte Aktivierungsrechnung');
    assertEqual(doc.getElementById('annualPlan_minimumFlexAnnual').value, '999999', 'Presetwahl bewahrt ungültigen Text');
    ui.dispose(); removers.forEach(remove => remove());
}

// Die Probe muss die Wurzel erreichen und jeden Knoten einschließlich der Wurzel prüfen.
function visibleThroughRoot(node, root) {
    for (; node; node = node.parentElement || node.parent) {
        if (node.hidden) return false;
        if (node === root) return true;
    }
    return false;
}

function assertFocusedCorrection(doc, field, root, text, label) {
    assertEqual(field.value, text, label + ': exakter Korrekturtext');
    assert(doc.activeElement === field, label + ': unveränderter Dokumentfokus');
    assert(visibleThroughRoot(field, root), label + ': Faktor und gesamte Vorfahrenkette sichtbar');
}
function assertVisibilityProbe(field, root) {
    for (let node = field; node; node = node === root ? null : node.parentElement || node.parent) {
        node.hidden = true;
        assert(!visibleThroughRoot(field, root), 'Verborgener Knoten lässt Sichtbarkeitsprobe scheitern');
        node.hidden = false;
    }
    const parent = field.parent;
    field.parent = null;
    assert(!visibleThroughRoot(field, root), 'Abgetrennte Elternkette lässt Sichtbarkeitsprobe scheitern');
    field.parent = parent;
}

// Browserreihenfolge ausdrücklich: change/blur vor Segmentfokus und click.
for (const matching of [false, true, 'active']) {
    const fixture = readyAnnualFixture('Einzelprofil'), storage = annualRecordStorage(fixture.records);
    const original = JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[fixture.scope.key].values;
    const values = { ...original, ...dynamicFlexPresetPatch('ausgewogen'), dynamicFlex: matching === 'active',
        goGoMultiplier: matching === 'active' ? 1.2 : matching ? 1.1 : 1.17 };
    storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(storage.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: fixture.scope, values }]).raw);
    const { doc } = createDialogFixture();
    let calculations = 0, holdNextPreview = false, delayedPreview = null;
    const ui = createAnnualPlanEditor({ doc, listen: (node, type, fn) => node.addEventListener(type, fn),
        evaluate: patch => {
            calculations++;
            const result = evaluateAnnualPlanPreview({ targetYear: 2026, storage,
                marketData: annualTestMarketData, now: annualTestNow, engineLoader: { load: async () => EngineAPI }, adoptedPlanPatch: patch });
            if (!holdNextPreview) return result;
            holdNextPreview = false;
            let release; const done = new Promise(resolve => { release = resolve; }).then(() => result);
            delayedPreview = { release, done }; return done;
        } });
    doc.body.append(ui.root);
    const preview = await evaluateAnnualPlanPreview({ targetYear: 2026, storage, marketData: annualTestMarketData,
        now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
    storage.setItem(ANNUAL_PLAN_RECORD_KEY, buildAnnualPlanRecord(null, { targetYear: 2025, scope: fixture.scope,
        committedAt: '2026-01-02T12:00:00.000Z', recommended: preview.recommended, adopted: preview.recommended }).raw);
    const before = JSON.stringify(storage.records);
    await ui.setBase(preview.values);
    await ui.root.querySelector('[data-annual-plan-toggle]').fire('click');
    const settle = async () => { for (let i = 0; i < 50 && ui.read().pending; i++) await Promise.resolve(); assert(!ui.read().pending, 'Jahresvorschau abgeschlossen'); };
    const click = async key => {
        const button = ui.root.querySelector('[data-plan-dynamic-preset="' + key + '"]'), previous = doc.activeElement;
        if (previous?.tag === 'input') { await previous.fire('change'); await previous.fire('blur'); }
        button.focus(); await button.fire('focus'); await button.fire('click'); await settle();
    };
    for (const key of ['off', 'konservativ', 'ausgewogen', 'offensiv']) {
        await click(key);
        assertEqual(JSON.stringify(ui.read().values), JSON.stringify({ ...preview.values, ...dynamicFlexPresetPatch(key) }), key + ': Jahreseditor erhält übrige Felder und CAPE bei vollständigem Wertpatch');
        assert(ui.root.querySelector('[data-plan-dynamic-details]').hidden && !ui.root.querySelector('[data-plan-dynamic-hint]').hidden, key + ': Jahreseditor zeigt wieder Presethinweis');
        assertEqual(JSON.stringify(storage.records), before, key + ': gültige Presetvorschau ohne Fachwrite');
        await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await settle();
    }
    for (const [path, text, message] of [['minimumFlexAnnual', '999999', 'Mindest-Flex'],
        ['minimumFlexAnnual', 'unlesbar', 'lesbare Zahl'], ['goGoMultiplier', 'unlesbar', 'lesbare Zahl']]) {
        if (path === 'goGoMultiplier') await click('custom');
        const field = doc.getElementById('annualPlan_' + path);
        field.focus(); await field.fire('focus'); field.value = text; await field.fire('input');
        const count = calculations;
        for (const key of ['off', 'konservativ', 'ausgewogen', 'offensiv', 'custom']) {
            await click(key);
            assertEqual(field.value, text, matching + '/' + key + ': exakter ungültiger Text bleibt');
            assertEqual(field.getAttribute('aria-invalid'), 'true', key + ': Feldmarkierung bleibt');
            const error = field.parent.querySelector('.household-plan-error');
            assert(error.textContent.includes(message), key + ': passende Feldmeldung');
            for (const node of [field, field.parent, error]) assert(visibleThroughRoot(node, ui.root), key + ': vollständige Fehler-Vorfahrenkette sichtbar');
            assert(!field.disabled, key + ': Fehlerfeld aktiviert');
            field.focus(); await field.fire('focus');
            assert(doc.activeElement === field, key + ': Fehlerfeld direkt fokussierbar');
            if (path !== 'goGoMultiplier') assert(ui.root.querySelector('[data-plan-dynamic-details]').hidden === (key !== 'custom'), key + ': externer Feldfehler öffnet keine Dynamikdetails');
            assert(doc.getElementById('annualPlan_dynamicFlex').parent.hidden, key + ': nativeOnly bleibt verborgen');
            assert(!ui.read().valid && ui.read().error.includes(message), key + ': ungültiger Entwurf bleibt gesperrt');
            let rejected = false; try { ui.accept(); } catch { rejected = true; }
            assert(rejected, key + ': keine Abschlussübernahme');
            assertEqual(calculations, count, key + ': keine gültige Zwischenberechnung');
            assertEqual(JSON.stringify(storage.records), before, key + ': gesamter Speicherbestand bytegleich');
        }
        if (path === 'goGoMultiplier') {
            const details = ui.root.querySelector('[data-plan-dynamic-details]');
            for (const node of [field.parent, details, ui.root]) {
                node.hidden = true;
                assert(!visibleThroughRoot(field, ui.root) && !visibleThroughRoot(field.parent.querySelector('.household-plan-error'), ui.root), 'Verborgene Zeile, Details oder Wurzel lassen Sichtbarkeitsprobe scheitern');
                node.hidden = false;
            }
        }
        await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await settle();
        assertEqual(JSON.stringify(ui.read().values), JSON.stringify(preview.values), 'Verwerfen stellt gültige Jahresbasis wieder her');
        assertEqual(field.getAttribute('aria-invalid'), 'false', 'Verwerfen entfernt Feldfehler');
        assertEqual(ui.root.querySelector('[data-plan-dynamic-details]').hidden, detectDynamicFlexPreset(preview.values) !== 'custom', 'Verwerfen entfernt zusätzliche Fehleröffnung');
    }
    for (const target of ['off', 'konservativ']) for (const blurMode of ['external', 'outside', 'forward', 'body-only', 'backward', 'no-related']) {
        await click('custom');
        const field = doc.getElementById('annualPlan_goGoMultiplier');
        field.focus(); await field.fire('focus'); field.value = 'unlesbar'; await field.fire('input');
        await click(target);
        assertEqual(ui.read().values.goGoActive, false, target + ': Go-Go bleibt aus');
        assert(visibleThroughRoot(field, ui.root), target + ': Faktor trotz Go-Go aus korrigierbar');
        assert(field.getAttribute('aria-invalid') === 'true' && !ui.read().valid && !ui.root.querySelector('[data-plan-dynamic-details]').hidden, target + ': ungültiger Blur erhält Fehleröffnung und Übernahmesperre');
        assertVisibilityProbe(field, ui.root);
        field.focus(); await field.fire('focus');
        holdNextPreview = true;
        for (const text of ['1', '1,', '1,1', '1,17']) {
            field.value = text; await field.fire('input');
            if (text !== '1') await settle();
            assertFocusedCorrection(doc, field, ui.root, text, target + '/' + text);
            assertEqual(ui.read().values.goGoActive, false, text + ': Zwischenstand hält Go-Go aus');
            if (text === '1,') {
                assert(!ui.read().valid && field.getAttribute('aria-invalid') === 'true', 'Unvollständige Zahl bleibt ungültig');
                let rejected = false; try { ui.accept(); } catch { rejected = true; }
                assert(rejected, 'Unvollständige Zahl sperrt Übernahme');
            }
        }
        const latestResult = ui.read().result;
        delayedPreview.release(); await delayedPreview.done; await Promise.resolve();
        assert(ui.read().result === latestResult && ui.read().values.goGoMultiplier === 1.17, 'Verspätete Zwischenvorschau ersetzt weder Ergebnis noch jüngeren Entwurf');
        assertFocusedCorrection(doc, field, ui.root, '1,17', target + '/verspätete Vorschau');
        assert(ui.read().valid, target + ': korrigierte Jahresvorschau gültig');
        assertEqual(field.getAttribute('aria-invalid'), 'false', target + ': Feldmeldung entfernt');
        assert(field.parent.querySelector('.household-plan-error').hidden, target + ': Fehlerknoten geschlossen');
        assertEqual(ui.read().values.goGoActive, false, target + ': Korrektur aktiviert Go-Go nicht');
        const expected = { ...preview.values, ...dynamicFlexPresetPatch(target), goGoMultiplier: 1.17 };
        assertEqual(JSON.stringify(ui.read().values), JSON.stringify(expected), target + ': vollständiger Zielpresetentwurf');
        assertEqual(JSON.stringify({ ...preview.values, ...ui.accept() }), JSON.stringify(expected), target + ': akzeptierter Patch ergibt vollständigen Zielplan');
        const revisionBeforeBlur = ui.read().revision, calculationsBeforeBlur = calculations;
        const outside = blurMode === 'outside' ? doc.createElement('button') : ui.root.querySelector('[data-annual-plan-toggle]');
        if (blurMode === 'outside') doc.body.append(outside);
        const destination = ['external', 'outside'].includes(blurMode) ? outside : doc.getElementById('annualPlan_' + (blurMode === 'backward' ? 'goGoActive' : 'longevityMode'));
        if (!['external', 'outside'].includes(blurMode)) assert(ui.root.querySelector('[data-plan-dynamic-details]').contains(destination), 'Tabziel liegt ausdrücklich innerhalb der Dynamikdetails');
        if (['external', 'outside'].includes(blurMode)) destination.focus();
        else doc.activeElement = doc.body;
        assert(['external', 'outside'].includes(blurMode) || doc.activeElement === doc.body, 'Nativer Blur beginnt ausdrücklich mit body als activeElement');
        const blurring = field.fire('blur', { relatedTarget: blurMode === 'no-related' ? null : destination });
        // Der Browser setzt das Tastaturziel erst nach den synchronen Blurhandlern.
        if (['forward', 'backward', 'no-related'].includes(blurMode)) destination.focus();
        await blurring; await new Promise(resolve => setTimeout(resolve, 0));
        const active = doc.activeElement;
        assert(active !== doc.body && !active.disabled && visibleThroughRoot(active, blurMode === 'outside' ? doc.body : ui.root), target + '/' + blurMode + ': Endfokus sichtbar und aktiviert am vorgesehenen Ziel');
        if (['external', 'outside'].includes(blurMode)) assert(active === outside, 'Sichtbarer Fokus außerhalb der Details bleibt erhalten');
        else if (target === 'off') assert(active === ui.root.querySelector('[data-plan-dynamic-preset="off"]'), 'Schließen rettet Fokus auf ausgewählten aktivierten Presetknopf');
        else if (blurMode === 'body-only') assert(active === ui.root.querySelector('[data-plan-dynamic-preset="custom"]'), 'Verborgene Faktorzeile rettet Body-Endfokus auf sichtbaren Customknopf');
        assert(field.parent.hidden, target + ': Faktorzeile nach tatsächlichem Blur wieder verborgen');
        assertEqual(ui.root.querySelector('[data-plan-dynamic-details]').hidden, detectDynamicFlexPreset(expected) !== 'custom', target + ': reguläre Detailerkennung nach Blur');
        assertEqual(ui.read().revision, revisionBeforeBlur, 'Blur erzeugt keine Fachrevision');
        assertEqual(calculations, calculationsBeforeBlur, 'Blur erzeugt keine Rechnung');
        await click('custom');
        assertEqual(ui.read().values.goGoMultiplier, 1.17, target + ': Custom zeigt korrigierten Faktor');
        assertEqual(readHouseholdPlanField(field, 'goGoMultiplier'), 1.17, target + ': korrigierter Feldwert erhalten');
        assertEqual(JSON.stringify(storage.records), before, target + ': Korrektur und Vorschau schreiben keine Rohbytes oder Belege');
        await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await settle();
    }
    await click('ausgewogen');
    const revision = ui.read().revision, count = calculations;
    await click('custom');
    const assertCustom = label => {
        assert(!ui.root.querySelector('[data-plan-dynamic-details]').hidden, label + ': Details offen');
        assert(ui.root.querySelector('[data-plan-dynamic-hint]').hidden, label + ': Hinweis verborgen');
        assertEqual(ui.root.querySelectorAll('[data-plan-dynamic-preset]').filter(button => button.getAttribute('aria-pressed') === 'true').length, 1, label + ': genau eine Markierung');
        assertEqual(ui.root.querySelector('[data-plan-dynamic-preset="custom"]').getAttribute('aria-pressed'), 'true', label + ': Custom markiert');
    };
    assertCustom('Aktive presetgleiche Basis');
    assertEqual(ui.read().revision, revision, 'Customöffnung ohne Fachrevision');
    assertEqual(calculations, count, 'Customöffnung ohne Rechnung');
    await ui.setBase(preview.values); assertCustom('Nach erneuter Jahresbasisvorschau');
    assertEqual(JSON.stringify(storage.records), before, 'Öffnen und Vorschau erhalten alle Speicherbytes');
    await ui.root.querySelector('[data-annual-plan-discard]').fire('click'); await settle();
    assertEqual(ui.read().values.dynamicFlex, values.dynamicFlex, 'Verwerfen stellt ursprüngliche Aktivierung wieder her');
    await click('custom'); assertCustom('Erneute Customwahl nach Verwerfen');
    ui.dispose();
    assertEqual(JSON.stringify(storage.records), before, 'Schließen erhält alle Speicherbytes');
}

// Gültige sichtbare Customdetails dürfen einen natürlichen Body-Endfokus nicht übernehmen.
for (const containerBox of [true, false]) {
    const fixture = readyAnnualFixture('Einzelprofil'), storage = annualRecordStorage(fixture.records);
    const original = JSON.parse(storage.getItem(HOUSEHOLD_PLAN_KEY)).entries[fixture.scope.key].values;
    const values = { ...original, ...dynamicFlexPresetPatch('ausgewogen'), longevityMode: 'buffer_years', longevityBufferYears: 3 };
    storage.setItem(HOUSEHOLD_PLAN_KEY, buildPlanRecord(storage.getItem(HOUSEHOLD_PLAN_KEY), [{ scope: fixture.scope, values }]).raw);
    const { doc } = createDialogFixture();
    let calculations = 0;
    const evaluate = patch => evaluateAnnualPlanPreview({ targetYear: 2026, storage, marketData: annualTestMarketData,
        now: annualTestNow, engineLoader: { load: async () => EngineAPI }, adoptedPlanPatch: patch });
    const preview = await evaluate();
    storage.setItem(ANNUAL_PLAN_RECORD_KEY, buildAnnualPlanRecord(null, { targetYear: 2025, scope: fixture.scope,
        committedAt: '2026-01-02T12:00:00.000Z', recommended: preview.recommended, adopted: preview.recommended }).raw);
    const ui = createAnnualPlanEditor({ doc, listen: (node, type, fn) => node.addEventListener(type, fn),
        evaluate: patch => { calculations++; return evaluate(patch); } });
    doc.body.append(ui.root); await ui.setBase(preview.values);
    await ui.root.querySelector('[data-annual-plan-toggle]').fire('click');
    const field = doc.getElementById('annualPlan_longevityBufferYears'), details = ui.root.querySelector('[data-plan-dynamic-details]');
    details.getClientRects = () => containerBox ? [{}] : [];
    field.getClientRects = () => [{}];
    assert(ui.read().valid && detectDynamicFlexPreset(ui.read().values) === 'custom', 'Gültige individuelle Jahresbasis ohne Fehleröffnung');
    for (const node of [field, field.parent, details]) assert(!node.disabled && visibleThroughRoot(node, ui.root), 'Customfeld und gesamte Vorfahrenkette vor Fokus sichtbar');
    let focusCalls = 0;
    const restore = ui.root.querySelectorAll('[data-plan-dynamic-preset]').map(button => {
        const focus = button.focus; button.focus = function(...args) { focusCalls++; return focus.apply(this, args); };
        return () => { button.focus = focus; };
    });
    const revision = ui.read().revision, count = calculations, before = JSON.stringify(storage.records);
    focusCalls = 0; field.focus(); await field.fire('focus');
    doc.activeElement = doc.body; await field.fire('blur');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(doc.activeElement === doc.body, 'Sichtbares Jahrescustomfeld lässt Body-Endfokus unverändert');
    assertEqual(focusCalls, 0, 'Kein Jahrespreset erhält programmatischen Fokus');
    for (const node of [field, field.parent, details]) assert(visibleThroughRoot(node, ui.root), 'Jahrescustomdetails bleiben nach Blur sichtbar');
    assertEqual(ui.read().revision, revision, 'Reine Jahresfokusfolge ohne Fachrevision');
    assertEqual(calculations, count, 'Reine Jahresfokusfolge ohne zusätzliche Rechnung');
    assertEqual(JSON.stringify(storage.records), before, 'Jahresrohstrings und Belege nach Fokusfolge bytegleich');
    restore.forEach(fn => fn()); ui.dispose();
}

// Der verzögerte Fokusabgleich gehört zur alten Blurfolge, nicht zum nächsten Entwurf.
for (const followup of ['new-correction', 'reopen', 'reset', 'dispose', 'outside-after-blur']) {
    const { doc } = createDialogFixture();
    let calculations = 0;
    const ui = createAnnualPlanEditor({ doc, listen: (node, type, fn) => node.addEventListener(type, fn),
        evaluate: async () => { calculations++; return { recommended, adopted: recommended }; } });
    doc.body.append(ui.root);
    await ui.setBase({ ...structuredClone(PLAN_DEFAULTS), ...dynamicFlexPresetPatch('off') });
    await ui.root.querySelector('[data-annual-plan-toggle]').fire('click');
    await ui.root.querySelector('[data-plan-dynamic-preset="custom"]').fire('click');
    const field = doc.getElementById('annualPlan_goGoMultiplier'), details = ui.root.querySelector('[data-plan-dynamic-details]');
    field.focus(); await field.fire('focus'); field.value = 'unlesbar'; await field.fire('input');
    doc.activeElement = doc.body; await field.fire('blur');
    await ui.root.querySelector('[data-plan-dynamic-preset="off"]').fire('click');
    field.focus(); await field.fire('focus'); field.value = '1,17'; await field.fire('input');
    doc.activeElement = doc.body;
    await field.fire('blur', { relatedTarget: doc.getElementById('annualPlan_longevityMode') });
    assert(field.parent.hidden && details.hidden, followup + ': gültiger Blur schließt regulär');
    let expectedFocus = doc.body;
    if (followup === 'new-correction') {
        field.value = 'unlesbar'; await field.fire('input');
        field.focus(); await field.fire('focus');
        // Auch wieder gültige Zeichen dürfen die neue Korrektur nicht vorzeitig schließen.
        field.value = '1'; await field.fire('input'); expectedFocus = field;
    } else if (followup === 'reopen') {
        // Neue gültige Fachwerte öffnen ohne Presetklick und dessen Timerabbruch.
        for (const path of ['goGoActive', 'dynamicFlex']) {
            const checkbox = doc.getElementById('annualPlan_' + path);
            checkbox.checked = true; await checkbox.fire('input');
        }
        for (let i = 0; i < 50 && ui.read().pending; i++) await Promise.resolve();
        assert(ui.read().valid && visibleThroughRoot(field, ui.root) && !details.hidden, 'Jüngerer gültiger Entwurf öffnet Blurfeld wieder');
    } else if (followup === 'reset') {
        await ui.root.querySelector('[data-annual-plan-discard]').fire('click');
        doc.activeElement = doc.body;
    } else if (followup === 'dispose') {
        ui.dispose();
        const next = createAnnualPlanEditor({ doc, listen: (node, type, fn) => node.addEventListener(type, fn),
            evaluate: async () => ({ recommended, adopted: recommended }) });
        doc.body.append(next.root); await next.setBase(PLAN_DEFAULTS);
        const before = JSON.stringify(next.read());
        await new Promise(resolve => setTimeout(resolve, 0));
        assert(doc.activeElement === doc.body, 'Dispose verhindert verspäteten Zugriff auf den neuen Editor');
        assertEqual(JSON.stringify(next.read()), before, 'Alter Fokusabgleich verändert keinen neuen Jahresentwurf');
        next.dispose(); continue;
    } else {
        expectedFocus = doc.createElement('button'); doc.body.append(expectedFocus); expectedFocus.focus();
    }
    const revision = ui.read().revision, count = calculations, hidden = details.hidden;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert(doc.activeElement === expectedFocus, followup + ': alter Abgleich verändert den jüngeren Fokus nicht');
    assertEqual(details.hidden, hidden, followup + ': alter Abgleich verändert die jüngere Sichtbarkeit nicht');
    assertEqual(ui.read().revision, revision, followup + ': Abgleich ohne Fachrevision');
    assertEqual(calculations, count, followup + ': Abgleich ohne Rechnung');
    if (followup === 'new-correction') assertFocusedCorrection(doc, field, ui.root, '1', 'Neue Korrektur nach überholtem Blur');
    if (followup === 'reset') assert(details.hidden && !ui.read().dirty, 'Reset bleibt beim geschlossenen Basisplan');
    ui.dispose();
}
