import fs from 'node:fs';
import path from 'node:path';
import { BUDGET_REFERENCE, renderParameterTable, renderTechnicalParameterTable, replaceGenerated } from './jahresbudget-parameter.mjs';
import { renderBudgetExamples, renderBudgetTechnicalExamples, renderBudgetCurves, renderHandbookBudgetExamples } from './jahresbudget-beispiele.mjs';
import { TECHNICAL_REFERENCE, technicalProjection } from './docs-reader-parameters.mjs';

export function readHandbookBudgetImages(root) {
    const file = path.join(root, 'docs/ui/manifest.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).images || [] : [];
}

export function checkBudgetDocumentation(root, source) {
    const errors = [];
    const check = (code, generate, command) => {
        try {
            if (generate() !== source) errors.push({ code, reason: `Stand veraltet; ${command} ausführen.` });
        } catch (error) { errors.push({ code, reason: error.message }); }
    };
    check('budget-parameter', () => replaceGenerated(source, 'docs:parameter', renderParameterTable(source)), 'npm run docs:parameter');
    check('budget-examples', () => replaceGenerated(source, 'docs:beispiele', renderBudgetExamples()), 'npm run docs:beispiele');
    const technicalFile = path.join(root, TECHNICAL_REFERENCE);
    try {
        const technical = fs.readFileSync(technicalFile, 'utf8');
        for (const [marker, content, command] of [
            ['docs:budget-parameter', renderTechnicalParameterTable(source), 'npm run docs:parameter'],
            ['docs:budget-examples', renderBudgetTechnicalExamples(), 'npm run docs:beispiele']
        ]) {
            if (replaceGenerated(technical, marker, technicalProjection(content, BUDGET_REFERENCE)) !== technical) {
                errors.push({ file: TECHNICAL_REFERENCE, code: 'budget-technical', reason: `Technische Belege veraltet; ${command} ausführen.` });
            }
        }
    } catch (error) { errors.push({ file: TECHNICAL_REFERENCE, code: 'budget-technical', reason: error.message }); }
    const handbookFile = path.join(root, 'Handbuch.html');
    if (fs.existsSync(handbookFile)) {
        const handbook = fs.readFileSync(handbookFile, 'utf8');
        try {
            const expected = replaceGenerated(handbook, 'docs:monatsbetrag', renderHandbookBudgetExamples(readHandbookBudgetImages(root)));
            if (expected !== handbook) errors.push({ code: 'budget-handbook', reason: 'Handbuchbeispiele veraltet; npm run docs:beispiele ausführen.' });
        } catch (error) { errors.push({ code: 'budget-handbook', reason: error.message }); }
    }
    for (const [file, expected] of Object.entries(renderBudgetCurves())) {
        const full = path.join(root, file);
        if (!fs.existsSync(full) || fs.readFileSync(full, 'utf8') !== expected) {
            errors.push({ code: 'budget-curve', reason: `${file} fehlt oder ist veraltet; npm run docs:beispiele ausführen.` });
        }
    }
    return errors.map(error => ({ ...error, file: error.file ?? (error.code === 'budget-handbook' ? 'Handbuch.html' : BUDGET_REFERENCE) }));
}
