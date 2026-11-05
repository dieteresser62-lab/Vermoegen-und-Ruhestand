import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parseJavaScript } from '../scripts/javascript-syntax.mjs';

const sourceFolders = ['app', 'engine', 'workers', 'types'];
const checkedFolders = [...sourceFolders, 'tests', 'scripts'];

function listFiles(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const file = `${folder}/${entry.name}`;
        return entry.isDirectory() ? listFiles(file) : [file];
    });
}

function discoverBoundaries(files, isDirectory) {
    return files.filter(file => /\.(?:js|mjs)$/.test(file))
        .map(facade => ({ facade, folder: facade.replace(/\.(?:js|mjs)$/, '') }))
        .filter(({ folder }) => isDirectory(folder));
}

function moduleSpecifiers(source, file) {
    const specifiers = [];
    function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifiers.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments.length && ts.isStringLiteral(node.arguments[0])) {
            specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    }
    visit(parseJavaScript(source, file));
    return specifiers;
}

function importsInFile(source, file) {
    if (!file.endsWith('.html')) return moduleSpecifiers(source, file);
    const specifiers = [];
    for (const [, attributes, body] of source.replace(/<!--[\s\S]*?-->/g, '')
        .matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        const attribute = name => attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
        const type = attribute('type');
        if ((type?.[1] ?? type?.[2] ?? type?.[3])?.toLowerCase() !== 'module') continue;
        const src = attribute('src');
        if (src) specifiers.push(src[1] ?? src[2] ?? src[3]);
        else specifiers.push(...moduleSpecifiers(body, file));
    }
    return specifiers;
}

function violations(file, source, boundaries) {
    const errors = [];
    for (const specifier of importsInFile(source, file)) {
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(specifier)) continue;
        if (!file.endsWith('.html') && !specifier.startsWith('.') && !specifier.startsWith('/')) continue;
        const local = specifier.split(/[?#]/)[0];
        const target = local.startsWith('/') ? local.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(file), local));
        for (const { facade, folder } of boundaries) {
            if (!target.startsWith(`${folder}/`) || file.startsWith(`${folder}/`) || file === facade) continue;
            const name = path.posix.basename(facade).replace(/\.(?:js|mjs)$/, '');
            if (file === `tests/${name}-contract.test.mjs`) continue;
            const edge = `${file} → ${target}`;
            errors.push(edge);
        }
    }
    return errors;
}

const synthetic = discoverBoundaries(['app/example.js', 'engine/example.mjs', 'app/leaf.js'],
    folder => folder === 'app/example' || folder === 'engine/example');
assertEqual(synthetic.length, 2, 'Fassaden mit .js und .mjs werden anhand ihres Unterordners erkannt');
for (const code of ["import './example/private.js';", "export { value } from './example/private.js';",
    "export * from './example/private.js';", "const load = () => import('./example/private.js');"]) {
    assertEqual(violations('app/outside.js', code, synthetic).length, 1,
        'Künstlicher Direktimport außerhalb des Ordners wird abgewiesen');
    assertEqual(violations('app/example.js', code, synthetic).length, 0,
        'Die Fassade darf ihre Implementierung importieren');
}
assertEqual(violations('app/example/inside.js', "import './private.js';", synthetic).length, 0,
    'Import innerhalb des Implementierungsordners bleibt erlaubt');
assertEqual(violations('app/outside.js', "import './example.js';", synthetic).length, 0,
    'Ein äußerer Import der Fassade bleibt erlaubt');
assertEqual(violations('tests/persistence-facade-contract.test.mjs',
    "import '../app/shared/persistence-facade/api.js';",
    [{ facade: 'app/shared/persistence-facade.js', folder: 'app/shared/persistence-facade' }]).length,
0, 'Der Vertragstest darf den eigenen Fassadenordner importieren');
assertEqual(violations('tests/example-contract.test.mjs',
    "import '../engine/example/private.mjs';", synthetic).length,
0, 'Die Vertragsregel gilt auch für mjs-Fassaden');
assertEqual(violations('tests/other-contract.test.mjs',
    "import '../app/example/private.js';", synthetic).length,
1, 'Ein Vertragstest darf keinen fremden Fassadenordner importieren');
assertEqual(violations('tests/example.test.mjs',
    "import '../app/example/private.js';", synthetic).length,
1, 'Ein normaler Test darf keine Teilmodule direkt importieren');
assertEqual(violations('index.html', '<script type="module" src="app/example/private.js"></script>', synthetic).length,
    1, 'HTML-Modulquellen werden geprüft');
assertEqual(violations('index.html', '<script type="module">import "./app/example/private.js";</script>', synthetic).length,
    1, 'Inline-Modulimporte werden ebenfalls geprüft');
assertEqual(moduleSpecifiers(`
    // import './ignored.js';
    /** @import {Ignored} from './types.js' */
    const text = "import './ignored.js'";
    const load = () => import(variable);
`, 'synthetic.js').length, 0, 'Kommentare, Typimporte, Strings und variable Importe sind keine statischen Kanten');

const sourceFiles = sourceFolders.flatMap(listFiles);
const boundaries = discoverBoundaries(sourceFiles, folder => fs.existsSync(folder) && fs.statSync(folder).isDirectory());
assert(boundaries.length > 0, 'Die Importprüfung entdeckt die vorhandenen Fassaden automatisch');
const files = [...checkedFolders.flatMap(listFiles).filter(file => /\.(?:js|mjs)$/.test(file)),
    ...fs.readdirSync('.').filter(file => file.endsWith('.html'))];
const errors = files.flatMap(file => violations(file, fs.readFileSync(file, 'utf8'), boundaries));
assertEqual(errors.length, 0, `Implementierungen werden ausschließlich über ihre Fassaden importiert:\n${errors.join('\n')}`);
