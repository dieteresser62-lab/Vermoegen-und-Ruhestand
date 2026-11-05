import ts from 'typescript';

/** @param {string} text @param {string} [file] @returns {ts.SourceFile} */
export function parseJavaScript(text, file = 'source.js') {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    if (source.parseDiagnostics.length) {
        throw new Error(`${file}: ${ts.flattenDiagnosticMessageText(source.parseDiagnostics[0].messageText, ' ')}`);
    }
    return source;
}

/** AST-Struktur und Token erhalten auch Klammern, ASI und Literal-Schreibweisen.
 * @param {string} text @param {string} [file] @returns {string}
 */
export function executableSyntax(text, file) {
    const source = parseJavaScript(text, file);
    function visit(node) {
        if (ts.isJSDoc(node)) return undefined;
        if (ts.isJSDocTypeAssertion(node)) {
            const parent = node.parent;
            let expression = node.expression;
            while (ts.isJSDocTypeAssertion(expression)) expression = expression.expression;
            const continuesChain = parent && (parent.expression === node || parent.tag === node) && !parent.questionDotToken
                && (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)
                    || ts.isCallExpression(parent) || ts.isTaggedTemplateExpression(parent));
            // Diese Klammer beendet das Kurzschließen der optionalen Kette.
            if (ts.isOptionalChain(expression) && continuesChain) {
                return [node.kind, visit(node.expression)];
            }
            return visit(node.expression);
        }
        const children = node.getChildren(source).filter(child => !ts.isJSDoc(child));
        return children.length ? [node.kind, ...children.map(visit)] : [node.kind, node.getText(source)];
    }
    return JSON.stringify(visit(source));
}

/** @param {string} before @param {string} after @param {string} [file] @returns {boolean} */
export function sameExecutableCode(before, after, file = 'source.js') {
    return executableSyntax(before, file) === executableSyntax(after, file);
}

/** Jede von einem Token belegte Zeile zählt, auch innerhalb mehrzeiliger Literale.
 * @param {string} text @param {string} [file] @returns {number}
 */
export function countCodeLines(text, file = 'source.js') {
    const source = parseJavaScript(text, file);
    const lines = new Set();
    function visit(node) {
        if (ts.isJSDoc(node) || node.kind === ts.SyntaxKind.EndOfFileToken) return;
        const children = node.getChildren(source);
        if (children.length) {
            children.forEach(visit);
        } else if (node.end > node.getStart(source)) {
            const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
            const last = source.getLineAndCharacterOfPosition(node.end - 1).line;
            for (let line = first; line <= last; line++) lines.add(line);
        }
    }
    visit(source);
    return lines.size;
}
