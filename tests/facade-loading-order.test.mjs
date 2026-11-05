import fs from 'node:fs';
import ts from 'typescript';
import { parseJavaScript } from '../scripts/javascript-syntax.mjs';

// Direkte Abhängigkeiten vor der Zerlegung. Auf der Übersicht müssen sie weiterhin
// vor den Teilmodulen angefordert werden: ein späterer Start verschiebt Kurswrites.
const dependencies = {
    'app/simulator/historical-backtest-contract.js': ['./simulator-data.js'],
    'app/profile/profilverbund-balance.js': [
        '../shared/person-data-status.js', '../../engine/tax-settlement.mjs',
        '../shared/persistence-facade.js', './profile-registry.js', './profile-person-data.js',
        './profile-state.js', '../tranches/tranchen-manager-state.js', '../../types/tranche-contract.js',
        './profile-asset-values.js', '../../types/liquidity-runway-contract.js'
    ],
    'app/balance/balance-renderer-action.js': [
        '../../engine/transactions/net-action.mjs', './balance-action-origin.js', './balance-utils.js',
        '../shared/designsystem-info-popover.js', './balance-diagnosis-transaction.js',
        './balance-action-summary.js', './balance-play-execution-ui.js', './balance-play-execution.js',
        '../shared/persistence-facade.js', '../../engine/config.mjs'
    ]
};

for (const [file, expected] of Object.entries(dependencies)) {
    const source = parseJavaScript(fs.readFileSync(file, 'utf8'), file);
    const requested = [...new Set(source.statements.filter(node =>
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
    ).map(node => node.moduleSpecifier.text))];
    assertEqual(JSON.stringify(requested.slice(0, expected.length)), JSON.stringify(expected),
        `${file}: bisherige Abhängigkeiten bleiben auf derselben Ladeebene und in derselben Reihenfolge`);
}
