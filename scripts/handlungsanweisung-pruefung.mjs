import fs from 'node:fs';
import path from 'node:path';
import { replaceGenerated, renderRunwayTable } from './jahresbudget-parameter.mjs';
import { ACTION_REFERENCE, renderActionParameterTable, renderTechnicalActionParameterTable } from './handlungsanweisung-parameter.mjs';
import { calculateActionExamples, renderActionExamples, renderActionTechnicalExamples, renderHandbookActionExample } from './handlungsanweisung-beispiele.mjs';
import { TECHNICAL_REFERENCE, technicalProjection } from './docs-reader-parameters.mjs';

export function checkActionDocumentation(root, source) {
    const errors = [];
    const check = (file, code, current, marker, generate, command) => {
        try {
            if (replaceGenerated(current, marker, generate()) !== current) {
                errors.push({ file, code, reason: `Stand veraltet; ${command} ausführen.` });
            }
        } catch (error) { errors.push({ file, code, reason: error.message }); }
    };
    check(ACTION_REFERENCE, 'action-parameter', source, 'docs:parameter', () => renderActionParameterTable(source), 'npm run docs:parameter');
    check(ACTION_REFERENCE, 'action-runway', source, 'docs:runway', renderRunwayTable, 'npm run docs:parameter');
    const examples = calculateActionExamples();
    check(ACTION_REFERENCE, 'action-examples', source, 'docs:beispiele', () => renderActionExamples(examples), 'npm run docs:beispiele');
    try {
        const technical = fs.readFileSync(path.join(root, TECHNICAL_REFERENCE), 'utf8');
        check(TECHNICAL_REFERENCE, 'action-technical-parameter', technical, 'docs:action-parameter',
            () => technicalProjection(renderTechnicalActionParameterTable(source), ACTION_REFERENCE), 'npm run docs:parameter');
        check(TECHNICAL_REFERENCE, 'action-technical-examples', technical, 'docs:action-examples',
            () => technicalProjection(renderActionTechnicalExamples(examples), ACTION_REFERENCE), 'npm run docs:beispiele');
    } catch (error) { errors.push({ file: TECHNICAL_REFERENCE, code: 'action-technical', reason: error.message }); }
    const handbook = fs.readFileSync(path.join(root, 'Handbuch.html'), 'utf8');
    check('Handbuch.html', 'action-handbook', handbook, 'docs:handlungsanweisung', () => renderHandbookActionExample(examples), 'npm run docs:beispiele');
    return errors;
}
