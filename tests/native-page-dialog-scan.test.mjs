import fs from 'node:fs';
import path from 'node:path';
import strict from 'node:assert/strict';
import { tokenizeJS, locateProducer } from './funktionsinventar-contract.mjs';

const injected = new Map([
    ['app/overview/overview-main.js', ['bindOverviewMonthClose', /confirm\s*=\s*requestOverviewMonthConfirmation/]],
    ['app/overview/overview-example-expenses.js', ['bindOverviewExampleExpenses', /confirm\s*=\s*\(targets, context\)\s*=>\s*requestExpensesPreview/]],
    ['app/balance/balance-expenses-import.js', ['importExpenses', /targets, confirm, storage/]],
    ['app/shared/probelauf-state.js', ['executeTransition', /choose, confirm, date/]]
]);

/** Lexikalischer Scan: Literale werden nicht als Code behandelt, Templateausdrücke schon. */
export function nativeDialogReferences(source, file = 'probe.js') {
    const all = tokenizeJS(source);
    const ranges = [], bindings = new Set();
    if (injected.has(file)) {
        const [name, signature] = injected.get(file);
        const match = signature.exec(source);
        if (match) {
            const body = locateProducer({ kind: 'function', module: file, name }, source);
            if (body.length) ranges.push([body[0].start, body.at(-1).end]);
            const offset = match.index + match[0].indexOf('confirm');
            bindings.add(offset);
        }
        if (file === 'app/shared/probelauf-state.js') {
            const callback = /end: \(confirm, options = \{\}\) => transition\(\{ \.\.\.options, confirm, ending: true \}\)/.exec(source);
            if (callback) ranges.push([callback.index, callback.index + callback[0].length]);
        }
    }
    const found = [];
    const scan = tokens => tokens.forEach((token, index) => {
        for (const expression of token.expressions || []) scan(expression);
        if (!['confirm', 'alert', 'prompt'].includes(token.value)) return;
        const before = tokens[index - 1]?.value, after = tokens[index + 1]?.value;
        const receiver = tokens[index - 2];
        const indexed = token.kind === 'string' && before === '[' && (['.', ')', ']'].includes(receiver?.value)
            || receiver?.kind === 'word' && !['return', 'throw', 'yield', 'await'].includes(receiver.value));
        const property = before === '.' || indexed;
        if (property) { found.push(token); return; }
        if (token.kind !== 'word') return;
        if (after === ':') {
            const close = tokens.findIndex((item, at) => at > index && item.value === '}');
            if (close > index && tokens[close + 1]?.value === '=') found.push(token);
            return;
        }
        if (token.value === 'confirm' && (bindings.has(token.start) || ranges.some(([a, b]) => token.start >= a && token.end <= b))) return;
        found.push(token);
    });
    scan(all);
    return found.map(token => `${file}:${source.slice(0, token.start).split('\n').length}: ${token.value}`);
}

for (const code of ["confirm('x')", "alert('x')", "prompt('x')", 'window.confirm()', 'globalThis.alert',
    'windowRef?.confirm?.()', 'const ask = confirm; ask()', 'function x(ask = prompt) {}',
    'const { confirm: ask } = window; ask()', "window['confirm']()", 'globalThis?.prompt?.()',
    'const x = `${window.alert()}`']) {
    assert(nativeDialogReferences(code).length > 0, `Gegenprobe verwirft ${code}`);
}
strict.equal(nativeDialogReferences('// confirm()\nconst text = "alert()"; const r = /prompt\\(/; const list = ["confirm", "alert"];').length, 0);
const localSource = 'export function importExpenses({ targets, confirm, storage }) { return confirm(targets); }';
assertEqual(nativeDialogReferences(localSource, 'app/balance/balance-expenses-import.js').length, 0, 'Belegter injizierter Callback bleibt zulässig');
assert(nativeDialogReferences(localSource + '\nwindow.confirm();', 'app/balance/balance-expenses-import.js').length > 0,
    'Lokale Bindung verdeckt keinen globalen Aufruf in derselben Datei');
assert(nativeDialogReferences(localSource + '\nconfirm();', 'app/balance/balance-expenses-import.js').length > 0,
    'Lokale Bindung gilt ausschließlich im Funktionsumfang');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.posix.join(dir, entry.name)) : /\.(?:js|mjs)$/.test(entry.name) ? [path.posix.join(dir, entry.name)] : []);
const references = walk('app').flatMap(file => nativeDialogReferences(fs.readFileSync(file, 'utf8'), file));
assertEqual(references.join('\n'), '', 'app enthält keine nativen Browserdialogreferenzen');
for (const [file, [name]] of injected) {
    const source = fs.readFileSync(file, 'utf8');
    assert(locateProducer({ kind: 'function', module: file, name }, source).some(token => token.value === 'confirm'),
        `${file}: Ausnahme besitzt weiterhin den belegten lokalen Callback`);
}
