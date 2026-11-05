import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodeAssert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { CONFIG, DYNAMIC_FLEX_SAFETY_DEFAULTS } from '../engine/config.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { ffgInput } from './helpers/ff-g-scenarios.mjs';
import { parameterLeaves, renderParameterTable, renderTechnicalParameterTable, replaceGenerated } from '../scripts/jahresbudget-parameter.mjs';
import { checkBudgetDocumentation } from '../scripts/jahresbudget-pruefung.mjs';
import { renderBudgetCurves, renderBudgetExamples, renderBudgetTechnicalExamples, renderHandbookBudgetExamples, HANDBOOK_BUDGET_CAPTURES } from '../scripts/jahresbudget-beispiele.mjs';
import { readHandbookBudgetImages } from '../scripts/jahresbudget-pruefung.mjs';
import { renderActionParameterTable, renderTechnicalActionParameterTable } from '../scripts/handlungsanweisung-parameter.mjs';
import { checkActionDocumentation } from '../scripts/handlungsanweisung-pruefung.mjs';
import { renderActionExamples, renderActionTechnicalExamples, renderHandbookActionExample, calculateActionExamples } from '../scripts/handlungsanweisung-beispiele.mjs';

import { TECHNICAL_REFERENCE, technicalProjection } from '../scripts/docs-reader-parameters.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'docs/reference/JAHRESBUDGET.md'), 'utf8');
const technicalSource = fs.readFileSync(path.join(root, TECHNICAL_REFERENCE), 'utf8');
function assertNameCoverage(text) {
    const rows = [...text.matchAll(/^\| `([a-z_]+)` \| ([^|]+) \| [^|]+ \| \[B\d+\]\(JAHRESBUDGET\.md#b\d+\) \|$/gm)];
    const names = new Map(rows.map(m => [m[1], m[2]]));
    nodeAssert.equal(names.size, rows.length, 'Keine doppelten Namenstabellenzeilen');
    const traced = new Set();
    for (const file of fs.readdirSync(path.join(root, 'engine/planners'))) {
        if (!file.endsWith('.mjs')) continue;
        const code = fs.readFileSync(path.join(root, 'engine/planners', file), 'utf8');
        for (const m of code.matchAll(/\brecord\(\s*'([a-z_]+)'/g)) traced.add(m[1]);
    }
    const traceSource = fs.readFileSync(path.join(root, 'engine/planners/flex-trace.mjs'), 'utf8');
    const sourceNames = traceSource.match(/const sources = \{([\s\S]*?)\};/)[1];
    for (const m of sourceNames.matchAll(/\b([a-z_]+):\s*'/g)) traced.add(m[1]);
    const uiCode = fs.readFileSync(path.join(root, 'app/balance/balance-flex-trace.js'), 'utf8');
    for (const object of uiCode.matchAll(/const (?:labels|reasons) = \{([\s\S]*?)\};/g)) {
        for (const m of object[1].matchAll(/\b([a-z_]+):\s*'([^']+)'/g)) {
            traced.add(m[1]);
            if (object[0].startsWith('const labels')) nodeAssert(names.get(m[1])?.trim().split(' / ').includes(m[2]), `${m[1]}: aktueller Treppenname fehlt`);
        }
    }
    for (const m of uiCode.matchAll(/\.schritt\s*===\s*'([a-z_]+)'/g)) traced.add(m[1]);
    nodeAssert.deepEqual([...names.keys()].sort(), [...traced].sort(), 'Alle Engine- und Balance-Trace-Schlüssel sind dokumentiert');
}
assertNameCoverage(technicalSource);
nodeAssert.throws(() => assertNameCoverage(technicalSource.replace(/^\| `annual_change_limit`.*\n/m, '')),
    /annual_change_limit|dokumentiert/, 'Fehlende Namenzeile muss scheitern');
for (const step of ['previous_rate', 'annual_change_limit', 'final_smoothing']) {
    const oldName = technicalSource.replace(new RegExp('^(\\| `' + step + '` \\| )[^|]+', 'm'), '$1Anpassung zum Vorjahr ');
    nodeAssert.throws(() => assertNameCoverage(oldName),
        /Treppenname fehlt/, 'Ein alter Anzeigename muss scheitern');
}
const stageSections = [...source.matchAll(/<a id="([ab]\d+)"><\/a>\n### [AB]\d+ [\s\S]*?(?=\n<a id=|$)/g)];
nodeAssert.equal(stageSections.length, 19);
for (const section of stageSections) for (const field of ['Zweck', 'Wann sie greift', 'Rechnung', 'Parameter', 'Beispiel', 'Gedächtnis', 'Name', 'Quelle']) {
    nodeAssert(section[0].includes(`- ${field}:`), `${section[1]}: ${field} fehlt`);
}
const parameters = renderParameterTable(source);
nodeAssert.equal(replaceGenerated(source, 'docs:parameter', parameters), source, 'Parameter aktuell');
for (const group of ['SPENDING_MODEL', 'THRESHOLDS', 'RECOVERY_GUARDRAILS', 'ANTI_PSEUDO_ACCURACY', 'MARKET_VALUATION']) {
    const config = { ...CONFIG, [group]: { ...CONFIG[group], NEW_UNASSIGNED_KEY: 123 } };
    nodeAssert.throws(() => renderParameterTable(source, config), new RegExp(`${group}.NEW_UNASSIGNED_KEY`));
}
nodeAssert.throws(() => renderParameterTable(source, { ...CONFIG, SPENDING_MODEL: { ...CONFIG.SPENDING_MODEL, EMPTY_NEW_GROUP: {} } }), /EMPTY_NEW_GROUP/);
for (const group of ['DYNAMIC_FLEX', 'DYNAMIC_FLEX_SAFETY']) {
    const config = { ...CONFIG, SPENDING_MODEL: { ...CONFIG.SPENDING_MODEL,
        [group]: { ...CONFIG.SPENDING_MODEL[group], NEW_KEY: 1 } } };
    nodeAssert.throws(() => renderParameterTable(source, config), new RegExp(`${group}.NEW_KEY`));
}
const arrayConfig = { ...CONFIG, ANTI_PSEUDO_ACCURACY: { ...CONFIG.ANTI_PSEUDO_ACCURACY,
    QUANTIZATION_TIERS_MONTHLY: [{ ...CONFIG.ANTI_PSEUDO_ACCURACY.QUANTIZATION_TIERS_MONTHLY[0], NEW_KEY: 1 },
        ...CONFIG.ANTI_PSEUDO_ACCURACY.QUANTIZATION_TIERS_MONTHLY.slice(1)] } };
nodeAssert.throws(() => renderParameterTable(source, arrayConfig), /QUANTIZATION_TIERS_MONTHLY.0.NEW_KEY/);
nodeAssert(parameterLeaves().some(([key]) => key === 'RECOVERY_GUARDRAILS.getCurb'), 'Auch Methoden brauchen eine Zuordnung');
nodeAssert.throws(() => renderParameterTable(source.replace('<a id="b4"></a>', '')), /Steckbrief/, 'Ein Ziel ohne Steckbrief zählt nicht');
nodeAssert.throws(() => replaceGenerated(source, 'docs:unbekannt', ''), /Marker/);

const examples = renderBudgetExamples();
nodeAssert.equal(replaceGenerated(source, 'docs:beispiele', examples), source, 'Engine-Beispiele aktuell');
nodeAssert.equal(replaceGenerated(technicalSource, 'docs:budget-parameter', technicalProjection(renderTechnicalParameterTable(source), 'JAHRESBUDGET.md')), technicalSource);
nodeAssert.equal(replaceGenerated(technicalSource, 'docs:budget-examples', technicalProjection(renderBudgetTechnicalExamples(), 'JAHRESBUDGET.md')), technicalSource);
const handbook = fs.readFileSync(path.join(root, 'Handbuch.html'), 'utf8');
nodeAssert(!/\bhref=["'][^"']*\.md(?:[?#][^"']*)?["']/i.test(handbook),
    'Handbuch nennt Markdown-Quellen als Klartext statt als Desktop-Links');
const handbookExamples = renderHandbookBudgetExamples(readHandbookBudgetImages(root));
nodeAssert.equal(replaceGenerated(handbook, 'docs:monatsbetrag', handbookExamples), handbook, 'Handbuchzahlen aus denselben Engine-Beispielen aktuell');
const preparedImages = HANDBOOK_BUDGET_CAPTURES.map(item => ({ path: `docs/ui/${item.name}.png`, width: 900, height: 700 }));
const illustrated = renderHandbookBudgetExamples(preparedImages);
for (const item of preparedImages) nodeAssert(illustrated.includes(`src="${item.path}"`), 'Aufnahmen werden nach docs:bilder im Handbuch eingebunden');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jahresbudget-'));
try {
    fs.writeFileSync(path.join(temporary, 'Handbuch.html'), replaceGenerated(handbook, 'docs:monatsbetrag', renderHandbookBudgetExamples()));
    for (const [file, svg] of Object.entries(renderBudgetCurves())) {
        fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
        fs.writeFileSync(path.join(temporary, file), svg);
    }
    fs.mkdirSync(path.dirname(path.join(temporary, TECHNICAL_REFERENCE)), { recursive: true });
    fs.writeFileSync(path.join(temporary, TECHNICAL_REFERENCE), technicalSource);
    nodeAssert.deepEqual(checkBudgetDocumentation(temporary, source), []);
    const temporaryHandbook = fs.readFileSync(path.join(temporary, 'Handbuch.html'), 'utf8');
    fs.writeFileSync(path.join(temporary, 'Handbuch.html'), temporaryHandbook.replace('5.035,45 €', '5.035,46 €'));
    nodeAssert(checkBudgetDocumentation(temporary, source).some(d => d.code === 'budget-handbook'), 'Veraltete Handbuchzahl muss scheitern');
    fs.writeFileSync(path.join(temporary, 'Handbuch.html'), temporaryHandbook);
    const parameterStale = source.replace('| Glättung · Rohzielgewicht | 35 %', '| Glättung · Rohzielgewicht | 36 %');
    nodeAssert(checkBudgetDocumentation(temporary, parameterStale).some(d => d.code === 'budget-parameter'));
    nodeAssert(checkBudgetDocumentation(temporary, source.replace(examples, examples + '\nVeraltet.')).some(d => d.code === 'budget-examples'));
    const staleTechnical = technicalSource.replace('| `SPENDING_MODEL.FLEX_RATE_SMOOTHING_ALPHA` | `0.35`', '| `SPENDING_MODEL.FLEX_RATE_SMOOTHING_ALPHA` | `0.36`');
    fs.writeFileSync(path.join(temporary, TECHNICAL_REFERENCE), staleTechnical);
    nodeAssert(checkBudgetDocumentation(temporary, source).some(d => d.code === 'budget-technical'), 'Veralteter technischer Rohwert muss scheitern');
    fs.writeFileSync(path.join(temporary, TECHNICAL_REFERENCE), technicalSource);
    const curve = Object.keys(renderBudgetCurves())[0];
    fs.appendFileSync(path.join(temporary, curve), '<!-- veraltet -->');
    nodeAssert(checkBudgetDocumentation(temporary, source).some(d => d.code === 'budget-curve'));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }

// Erzeugte Handlungsbeispiele, Parameter und veraltete Zahlen werden geprüft.
const actionSource = fs.readFileSync(path.join(root, 'docs/reference/HANDLUNGSANWEISUNG.md'), 'utf8');
const actionExamples = calculateActionExamples();
nodeAssert.equal(replaceGenerated(actionSource, 'docs:parameter', renderActionParameterTable(actionSource)), actionSource);
nodeAssert.equal(replaceGenerated(technicalSource, 'docs:action-parameter', technicalProjection(renderTechnicalActionParameterTable(actionSource), 'HANDLUNGSANWEISUNG.md')), technicalSource);
nodeAssert.equal(replaceGenerated(technicalSource, 'docs:action-examples', technicalProjection(renderActionTechnicalExamples(actionExamples), 'HANDLUNGSANWEISUNG.md')), technicalSource);
nodeAssert.equal(replaceGenerated(actionSource, 'docs:beispiele', renderActionExamples(actionExamples)), actionSource);
nodeAssert.equal(replaceGenerated(handbook, 'docs:handlungsanweisung', renderHandbookActionExample(actionExamples)), handbook);
for (const [group, count] of [['c', 17], ['d', 3], ['e', 4], ['s', 5]]) {
    for (let step = 1; step <= count; step++) nodeAssert(actionSource.includes(`<a id="${group}${step}"></a>`));
}
const actionSections = actionSource.match(/### [CDES]\d+ [\s\S]*?(?=\n### |\n## |$)/g);
nodeAssert.equal(actionSections.length, 23);
for (const section of actionSections) for (const field of ['Zweck', 'Wann sie greift', 'Rechnung', 'Parameter', 'Beispiel', 'Gedächtnis', 'Name', 'Quelle']) {
    nodeAssert(section.includes(`- ${field}:`), `${section.split('\n')[0]}: ${field} fehlt`);
}
nodeAssert.throws(() => renderActionParameterTable(actionSource, { ...CONFIG,
    SPENDING_MODEL: { ...CONFIG.SPENDING_MODEL, THREE_BUCKET: { ...CONFIG.SPENDING_MODEL.THREE_BUCKET, NEW_KEY: 1 } } }), /NEW_KEY/);
nodeAssert.throws(() => renderActionParameterTable(actionSource.replace('<a id="c8"></a>', '')), /Steckbrief/);
nodeAssert(checkActionDocumentation(root, actionSource.replace('34.906,10 €', '34.906,11 €')).some(d => d.code === 'action-examples'));
const actionTemporary = fs.mkdtempSync(path.join(os.tmpdir(), 'handlungsanweisung-'));
try {
    fs.mkdirSync(path.dirname(path.join(actionTemporary, TECHNICAL_REFERENCE)), { recursive: true });
    fs.writeFileSync(path.join(actionTemporary, TECHNICAL_REFERENCE), technicalSource);
    const staleRaw = technicalSource.replace('| `THRESHOLDS.STRATEGY.minRefillAmount` | `10000`', '| `THRESHOLDS.STRATEGY.minRefillAmount` | `10001`');
    fs.writeFileSync(path.join(actionTemporary, 'Handbuch.html'), handbook);
    fs.writeFileSync(path.join(actionTemporary, TECHNICAL_REFERENCE), staleRaw);
    nodeAssert(checkActionDocumentation(actionTemporary, actionSource).some(d => d.code === 'action-technical-parameter'), 'Veralteter technischer Handelswert muss scheitern');
    fs.writeFileSync(path.join(actionTemporary, TECHNICAL_REFERENCE), technicalSource);
    fs.writeFileSync(path.join(actionTemporary, 'Handbuch.html'), handbook.replace('Abzüglich 486,35 € Steuer', 'Abzüglich 486,36 € Steuer'));
    nodeAssert(checkActionDocumentation(actionTemporary, actionSource).some(d => d.code === 'action-handbook'));
} finally { fs.rmSync(actionTemporary, { recursive: true, force: true }); }

// Fehlende Sicherheitskonfiguration verwendet dieselben Konstanten wie die normale Konfiguration.
const configured = CONFIG.SPENDING_MODEL.DYNAMIC_FLEX_SAFETY;
nodeAssert.deepEqual(configured, DYNAMIC_FLEX_SAFETY_DEFAULTS);
const first = EngineAPI.simulateSingleYear({ ...ffgInput, dynamicFlex: true }, null);
for (const stage of [0, 1, 2]) {
    const previous = { ...first.newState, vpwSafetyStage: stage, vpwSafetyStableStreak: 1,
        vpwSafetyRiskStreak: 1, vpwSafetyReentryRemaining: 2, vpwLastDynamicFlex: 50000 };
    const normal = EngineAPI.simulateSingleYear({ ...ffgInput, dynamicFlex: true }, previous);
    try {
        delete CONFIG.SPENDING_MODEL.DYNAMIC_FLEX_SAFETY;
        nodeAssert.deepEqual(EngineAPI.simulateSingleYear({ ...ffgInput, dynamicFlex: true }, previous), normal);
    } finally { CONFIG.SPENDING_MODEL.DYNAMIC_FLEX_SAFETY = configured; }
}
assert(true, 'Jahresbudget-Verträge und Gegenproben erfolgreich');
console.log('Jahresbudget: Namen, 19 Steckbriefe, Parameterabdeckung, Aktualität und Ersatzwerte geprüft.');
