import { sameExecutableCode } from '../scripts/check-code-unchanged.mjs';

const cases = [
    ['a', 'const x = 1;', '// Kommentar\nconst x = 1; /* neu */', true],
    ['b', 'const x = value;', 'const x = /** @type {number} */ (value);', true],
    ['c', 'const x = (a + b) * c;', 'const x = a + b * c;', false],
    ['d Zahl', 'const x = 1;', 'const x = 2;', false],
    ['d Zeichenkette', 'const x = "alt";', 'const x = "neu";', false],
    ['e', 'work();', 'work(); extra();', false],
    ['optional Eigenschaft', 'x = a?.b.c;', 'x = /** @type {T} */ (a?.b).c;', false],
    ['optional Aufruf', 'x = a?.b.c();', 'x = /** @type {T} */ (a?.b).c();', false],
    ['optional fortgesetzt', 'x = a?.b?.c;', 'x = /** @type {T} */ (a?.b)?.c;', true],
    ['optional ganze Kette', 'x = a?.b.c;', 'x = /** @type {T} */ (a?.b.c);', true],
    ['optional Element', 'x = a?.[k].c;', 'x = /** @type {T} */ (a?.[k]).c;', false],
    ['optional Elementfortsetzung', 'x = a?.b[k];', 'x = /** @type {T} */ (a?.b)[k];', false],
    ['optional direkter Aufruf', 'x = a?.b();', 'x = /** @type {T} */ (a?.b)();', false],
    ['optional Tagged Template', 'x = a?.b`text`;', 'x = /** @type {T} */ (a?.b)`text`;', false],
    ['optional verschachtelte Zusicherung', 'x = a?.b.c;', 'x = /** @type {T} */ (/** @type {U} */ (a?.b)).c;', false],
    ['optional verschachtelt fortgesetzt', 'x = a?.b?.c;', 'x = /** @type {T} */ (/** @type {U} */ (a?.b))?.c;', true]
];
for (const [id, before, after, expected] of cases) {
    const actual = sameExecutableCode(before, after);
    assertEqual(actual, expected, `Gegenprobe ${id}`);
    console.log(`Gegenprobe ${id}: ${actual ? 'gleich' : 'verschieden'} (erwartet ${expected ? 'gleich' : 'verschieden'})`);
}
assert(sameExecutableCode('const x = /a[bc]/; const y = `a${x}b`;', '/* Kopf */ const x = /a[bc]/; const y = `a${x}b`;'), 'Regex und Templates werden geparst');
assert(!sameExecutableCode('function f() { return\nx; }', 'function f() { return x; }'), 'Zeilenwechsel mit ASI-Wirkung bleibt eine Codeänderung');
assert(!sameExecutableCode('const x = a + b * c;', 'const x = /** @type {number} */ (a + b) * c;'), 'Typzusicherung verbirgt keine geänderte Rechenreihenfolge');
assert(!sameExecutableCode('const x = `a b`;', 'const x = `a  b`;'), 'Leerraum in Literalen bleibt Code');
