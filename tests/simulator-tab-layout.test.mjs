import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import strict from 'node:assert/strict';
import { rules } from './designsystem-source-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'Simulator.html'), 'utf8');

const tabButtons = [...html.matchAll(/<button\s+class="tab-btn(?: active)?"\s+data-tab="([^"]+)">([^<]+)<\/button>/g)]
    .map(([, id, label]) => ({ id, label: label.trim() }));
assert(JSON.stringify(tabButtons) === JSON.stringify([
    { id: 'ergebnis', label: 'Ergebnis' },
    { id: 'annahmen', label: 'Annahmen' },
    { id: 'backtesting', label: 'Backtest' },
    { id: 'montecarlo', label: 'Monte-Carlo' },
    { id: 'werkstatt', label: 'Werkstatt' }
]), 'Simulator-Tab-Leiste enthält die fünf Tabs in der vorgesehenen Reihenfolge');

const sweepStart = html.indexOf('<div id="tab-sweep" class="sim-workshop-panel ds-plan-card"');
const optimizeStart = html.indexOf('<div id="tab-auto-optimize" class="sim-workshop-panel ds-plan-card"');
const scriptsStart = html.indexOf('<script type="module" src="app/profile/profile-bridge.js">');
assert(sweepStart >= 0 && optimizeStart > sweepStart && scriptsStart > optimizeStart,
    'Sweep- und Auto-Optimize-Panels sind getrennt und in Tab-Reihenfolge vorhanden');

const sweepPanel = html.slice(sweepStart, optimizeStart);
const optimizePanel = html.slice(optimizeStart, scriptsStart);
for (const id of ['sweepRuns', 'sweepGridSize', 'sweepButton', 'sweepCancelButton', 'sweepResults', 'sweepHeatmap']) {
    assert(sweepPanel.includes(`id="${id}"`), `${id} bleibt im Parameter-Sweep-Panel`);
    assert(!optimizePanel.includes(`id="${id}"`), `${id} liegt nicht im Auto-Optimize-Panel`);
}
for (const id of ['ao_metric', 'ao_presets_container', 'ao_parameters_container', 'ao_run_btn', 'ao_progress', 'ao_result', 'ao_apply_btn']) {
    assert(optimizePanel.includes(`id="${id}"`), `${id} liegt im Auto-Optimize-Panel`);
    assert(!sweepPanel.includes(`id="${id}"`), `${id} liegt nicht mehr im Parameter-Sweep-Panel`);
}

const owners = ['ergebnis', 'annahmen', 'backtesting', 'montecarlo', 'werkstatt'];
const markup = html.slice(0, scriptsStart);
const panelIds = [...markup.matchAll(/<div id="([^"]+)" class="tab-panel(?: active)?"/g)].map(m => m[1]);
assertEqual(JSON.stringify(panelIds), JSON.stringify(owners.map(id => 'tab-' + id)), 'Genau fünf Hauptpanels in Zielreihenfolge');
assert(markup.includes('id="tab-ergebnis" class="tab-panel active"'), 'Ergebnis ist initial aktiv');
assert(!markup.includes('sim-page-actions'), 'Kopfaktionen sind entfernt');
assert(/class="mc-settings-actions"[^]*?id="mcButton"/.test(markup), 'Start liegt in Einstellungen außerhalb der geschlossenen Details');
const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assertEqual(ids.length, new Set(ids).size, 'Alle Bestandscontrols und Ergebnis-Hosts besitzen eindeutige IDs');
const controls = {
    ergebnis: ['overviewBacktest', 'overviewMonteCarlo', 'overviewCrises', 'overviewRunHeads'],
    annahmen: ['simProfileList', 'startFloorBedarf', 'minimumFlexAnnual', 'pflegePanel', 'simPlanParameters'],
    backtesting: ['simStartJahr', 'simEndJahr', 'btButton', 'simulationSummary', 'simulationLog', 'exportBacktestJson', 'parity-smoketest-card'],
    montecarlo: [ 'mcButton', 'mcCancelButton', 'mcViewTabLogs', 'mcSetupDisclosure', 'mcAdvancedDisclosure', 'mcAnzahl', 'mcDauer', 'stressPreset'],
    werkstatt: ['workshopReplayPanel', 'stressReplayWorkspace', 'mcReplayVariantBadge', 'sweepButton', 'sweepResults', 'ao_run_btn', 'ao_result', 'ao_apply_btn']
};
for (let i = 0; i < owners.length; i++) {
    const start = markup.indexOf('<div id="tab-' + owners[i] + '"');
    const end = i + 1 < owners.length ? markup.indexOf('<div id="tab-' + owners[i + 1] + '"') : markup.length;
    const panel = markup.slice(start, end);
    for (const id of controls[owners[i]]) assert(panel.includes('id="' + id + '"'), id + ' gehört zum Hauptpanel ' + owners[i]);
}
assert(markup.includes('data-workshop-panel="optimize" tabindex="-1" hidden'), 'Auto-Optimize liegt in eigener initial verborgener Werkstattfläche');
const assumptionSource = fs.readFileSync(path.join(root, 'app/simulator/simulator-assumptions-ui.js'), 'utf8');
assert(assumptionSource.includes('input:not([type="hidden"]):not([type="checkbox"]), select') && assumptionSource.includes("host.addEventListener('input'") && assumptionSource.includes("host.addEventListener('change'"), 'Bestehende Füllindikatorbindung folgt den echten Annahmenfeldern');
assertEqual((markup.match(/data-assumption-step="[1-5]"/g) || []).length, 5, 'Fünf bestehende Annahmenbereiche bleiben zugeordnet');
assert(!markup.slice(markup.indexOf('id="tab-annahmen"'), markup.indexOf('id="tab-backtesting"')).includes('class="form-group"'), 'Annahmen verwenden Bausteinfelder');
assert(!html.includes('#tab-rahmendaten'), 'Kein Inlinebinder verweist auf die entfernte Besitzfläche');
const workshop = markup.slice(markup.indexOf('id="tab-werkstatt"'));
assertEqual((workshop.match(/class="ds-plan-card sim-tool-card"/g) || []).length, 3, 'Werkstatt beginnt mit genau drei Werkzeugkarten');
assert(!workshop.includes('id="workshopToolNavigation"') && !workshop.includes('id="workshopCloseTool"'), 'Nur die drei Karten steuern Öffnen und Schließen');
assertEqual((workshop.match(/data-workshop-tool="/g) || []).length, 3, 'Genau ein Auswahlknopf pro Werkzeug');
assert(workshop.includes('data-workshop-panel="replay" tabindex="-1" hidden'), 'Auch Replay ist vor Werkzeugöffnung verborgen');
assert(!workshop.includes('class="form-group"'), 'Alle Werkstattfelder verwenden gemeinsame Feldrollen');
assertEqual((workshop.match(/data-preset="/g) || []).length, 7, 'Sieben Presets bleiben als echte Bedienelemente erreichbar');
assert(workshop.includes('id="ao_cancel_btn"') && workshop.includes('id="ao_c_sr99"') && workshop.includes('id="ao_c_noex"') && workshop.includes('id="ao_c_ts45"') && workshop.includes('id="ao_c_dd55"'), 'Optimize behält Abbruchzugang und alle vier Nebenbedingungen');

// Quellvertrag für die erhaltenen Werkzeughosts; echte Sichtbarkeit prüft der Browser.
function toolPrintDisplay(css, id, hidden) {
    const printBlocks = [...css.matchAll(/@media print\s*\{([\s\S]*?)\n\}/g)];
    const activeCss = css.replace(/@media print\s*\{[\s\S]*?\n\}/g, '')
        + '\n' + printBlocks.map(match => match[1]).join('\n');
    const selectors = [`#${id}`, '.sim-workshop-panel', '.ds-plan-card'];
    const suffix = hidden ? '[hidden]' : ':not([hidden])';
    const matching = new Set([...selectors, ...selectors.map(selector => selector + suffix), suffix]);
    let winner = { important: false, specificity: -1, display: hidden ? 'none' : 'block' };
    for (const rule of rules('simulator.css', activeCss)) {
        if (!rule.declarations.display) continue;
        for (const selector of rule.selector.split(',').map(value => value.trim())) {
            if (!matching.has(selector)) continue;
            const value = rule.declarations.display;
            const important = value.includes('!important');
            const specificity = (selector.match(/#/g) || []).length * 100
                + (selector.match(/\.|\[/g) || []).length * 10;
            if (Number(important) > Number(winner.important)
                || (important === winner.important && specificity >= winner.specificity)) {
                winner = { important, specificity, display: value.replace(/\s*!important/, '').trim() };
            }
        }
    }
    return winner.display;
}
function assertToolPrintContract(css, id) {
    strict.equal(toolPrintDisplay(css, id, false), 'block', `${id} ohne hidden bleibt druckbar`);
    strict.equal(toolPrintDisplay(css, id, true), 'block', `${id} mit hidden bleibt druckbar`);
}
const css = fs.readFileSync(path.join(root, 'simulator.css'), 'utf8');
for (const id of ['tab-sweep', 'tab-auto-optimize']) {
    assertEqual(toolPrintDisplay(css, id, false), 'block', `${id} ohne hidden bleibt im Druck offen`);
    assertEqual(toolPrintDisplay(css, id, true), 'block', `${id} mit hidden bleibt im Druck offen`);
    assertToolPrintContract(css, id);
    const selector = `#${id}[hidden]`;
    assert(css.includes(selector), `${id}: Gegenproben treffen den tatsächlichen Druckselektor`);
    const hiddenHide = css + `\n@media print {\n#${id}[hidden] { display: none !important; }\n}\n`;
    assert(strict.throws(() => assertToolPrintContract(hiddenHide, id), strict.AssertionError) === undefined,
        `${id}: Ausblenden verborgener Werkzeuge scheitert am Druckvertrag`);
    const unconditionalHide = css + `\n@media print {\n#${id} { display: none !important; }\n}\n`;
    assert(strict.throws(() => assertToolPrintContract(unconditionalHide, id), strict.AssertionError) === undefined,
        `${id}: pauschales Ausblenden scheitert am Druckvertrag`);
}

// Die echte Ausgabe gruppiert Kennzahlen vor dem Chart; Ruin/Recoverytexte bleiben.
const { createPresentationTestDocument } = await import('./designsystem-source-contract.mjs');
const { tokenizeHTML, matchesSelector } = await import('./funktionsinventar-contract.mjs');
const { renderSimulatorOverview, setOverviewBacktestStatus } = await import('../app/simulator/simulator-result-overview.js');
const { simulatorRunAssumptions: heads } = await import('../app/simulator/simulator-run-assumptions.js');
const previousDocument = globalThis.document;
try {
    const doc = createPresentationTestDocument();
    doc.querySelectorAll = () => []; doc.addEventListener = () => {};
    doc.createElementNS = (_namespace, tag) => doc.createElement(tag);
    const host = doc.createElement('section'); host.id = 'overviewBacktest'; host.querySelector = () => null;
    globalThis.document = doc;
    for (const outcome of ['completed', 'ruin']) {
        const result = { request: { startYear: 2020, endYear: 2020 }, outcome: { kind: outcome }, ruinYear: 2020,
            portfolioStart: 100000, completedYears: 1, metrics: { values: { wealth_end_nominal_eur: 80000, flex_reduction_longest_streak_gte_10_pct: 1 } },
            rows: [{ jahr: 2020, wertAktien: 80000, wertGold: 0, liquiditaet: 0, row: {
                health_bucket_start: 0, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 20
            } }] };
        const values = { inputs: {}, settings: result.request };
        heads.observe('backtest', values); const token = heads.begin('backtest', values, {}); heads.complete('backtest', token, result);
        setOverviewBacktestStatus('completed'); renderSimulatorOverview();
        const output = tokenizeHTML(host.innerHTML);
        assert(matchesSelector(output, '.sim-card-status .sim-status-chip') && matchesSelector(output, '.sim-card-status .ds-info-button'), 'Statuschip und Info stehen gemeinsam im rechten Kartenkopf');
        assertEqual(output.elements.filter(node => matchesSelector({ elements: [node] }, '.sim-outcome-metrics .ds-row')).length, 3, 'Drei Nebenkennzahlen stehen neben dem Ergebnisblock');
        assert(matchesSelector(output, '.sim-cut-metric .ds-hint'), 'Kürzungsdauer steht innerhalb der Kürzungskennzahl');
        assert(matchesSelector(output, '.sim-outcome-primary .sim-hero-amount') && matchesSelector(output, '.sim-outcome-primary .sim-outcome-start'), 'Betrag, Endbezeichnung und Startbetrag bleiben zusammen');
        assertEqual(host.children.at(-1).id, 'overviewPortfolioChart', 'Chart wird nach dem Kennzahlenblock eingefügt');
        assert(host.innerHTML.includes(outcome === 'completed' ? 'Ja. Dein Plan' : 'Der Floor wäre'), 'Erfolg und Ruin behalten ihre bisherigen Aussagen');
    }
    for (const [phase, text] of [['loading', 'Profil wird geladen'], ['blocked', 'nicht rechenbar'], ['missing', 'Daten fehlen'], ['technical_error', 'technischer Fehler']]) {
        setOverviewBacktestStatus(phase); renderSimulatorOverview();
        assert(host.innerHTML.includes(text), `${phase}: bestehender Lade-/Recovery-/Fehlertext erhalten`);
    }
} finally { globalThis.document = previousDocument; }
