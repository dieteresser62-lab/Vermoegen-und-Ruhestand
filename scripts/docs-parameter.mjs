import fs from 'node:fs';
import { BUDGET_REFERENCE, renderParameterTable, renderTechnicalParameterTable, renderRunwayTable, replaceGenerated } from './jahresbudget-parameter.mjs';
import { ACTION_REFERENCE, renderActionParameterTable, renderTechnicalActionParameterTable } from './handlungsanweisung-parameter.mjs';
import { TECHNICAL_REFERENCE, technicalProjection } from './docs-reader-parameters.mjs';
const file = new URL(`../${BUDGET_REFERENCE}`, import.meta.url);
const source = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, replaceGenerated(source, 'docs:parameter', renderParameterTable(source)));
const actionFile = new URL(`../${ACTION_REFERENCE}`, import.meta.url);
const actionSource = fs.readFileSync(actionFile, 'utf8');
fs.writeFileSync(actionFile, replaceGenerated(replaceGenerated(actionSource, 'docs:parameter', renderActionParameterTable(actionSource)),
    'docs:runway', renderRunwayTable()));
const technicalFile = new URL(`../${TECHNICAL_REFERENCE}`, import.meta.url);
let technical = fs.readFileSync(technicalFile, 'utf8');
technical = replaceGenerated(technical, 'docs:budget-parameter', technicalProjection(renderTechnicalParameterTable(source), BUDGET_REFERENCE));
technical = replaceGenerated(technical, 'docs:action-parameter', technicalProjection(renderTechnicalActionParameterTable(actionSource), ACTION_REFERENCE));
fs.writeFileSync(technicalFile, technical);
console.log('Leserparameter, vollständige technische Zuordnung und Mindestreichweite erneuert.');
