// Strikter DOM-freier XML-Validator für den verwendeten SVG-Syntaxumfang.
// DTDs und andere Deklarationen sind bewusst nicht unterstützt.
const NAME = '[A-Za-z_][A-Za-z0-9_.:-]*';
const SPACE = '[ \\t\\r\\n]';
const xmlChar = cp => cp === 9 || cp === 10 || cp === 13 || cp >= 0x20 && cp <= 0xd7ff || cp >= 0xe000 && cp <= 0xfffd || cp >= 0x10000 && cp <= 0x10ffff;
export function validateSvgXml(source) {
    const fail = message => { throw new SyntaxError(message); };
    for (const char of source) if (!xmlChar(char.codePointAt(0))) fail('Ungültiges XML-Zeichen');
    const entities = text => {
        for (let i = 0; i < text.length; i++) {
            if (text[i] !== '&') continue;
            const match = text.slice(i).match(/^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/);
            if (!match) fail('Ungültige oder unmaskierte Entität');
            if (match[1][0] === '#') {
                const hex = match[1][1] === 'x';
                const cp = Number.parseInt(match[1].slice(hex ? 2 : 1), hex ? 16 : 10);
                if (!xmlChar(cp)) fail('Ungültige numerische Entität');
            }
            i += match[0].length - 1;
        }
    };
    let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0;
    if (source.startsWith('<?xml', cursor)) {
        const declaration = source.slice(cursor).match(/^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(['"])1\.0\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(['"])(?:yes|no)\3)?[ \t\r\n]*\?>/);
        if (!declaration) fail('Ungültige XML-Deklaration');
        cursor += declaration[0].length;
    }
    const stack = [];
    let roots = 0;
    while (cursor < source.length) {
        if (source[cursor] !== '<') {
            const end = source.indexOf('<', cursor);
            const text = source.slice(cursor, end < 0 ? source.length : end);
            if (!stack.length && /[^ \t\r\n]/.test(text)) fail('Text außerhalb der Wurzel');
            if (text.includes(']]>')) fail('CDATA-Ende in Text');
            entities(text);
            cursor += text.length;
        } else if (source.startsWith('<!--', cursor)) {
            const end = source.indexOf('-->', cursor + 4);
            if (end < 0) fail('Offener Kommentar');
            const comment = source.slice(cursor + 4, end);
            if (comment.includes('--') || comment.endsWith('-')) fail('Ungültiger Kommentar');
            cursor = end + 3;
        } else if (source.startsWith('<![CDATA[', cursor)) {
            if (!stack.length) fail('CDATA außerhalb der Wurzel');
            const end = source.indexOf(']]>', cursor + 9);
            if (end < 0) fail('Offene CDATA');
            cursor = end + 3;
        } else if (source.startsWith('</', cursor)) {
            const match = source.slice(cursor).match(new RegExp(`^</(${NAME})${SPACE}*>`));
            if (!match || stack.pop() !== match[1]) fail('Falscher Endtag');
            cursor += match[0].length;
        } else {
            if (source.startsWith('<!', cursor) || source.startsWith('<?', cursor)) fail('Nicht unterstützte Deklaration');
            const match = source.slice(cursor).match(new RegExp(`^<(${NAME})`));
            if (!match) fail('Ungültiger Starttag');
            const name = match[1];
            cursor += match[0].length;
            const attributes = new Set();
            while (true) {
                const whitespace = source.slice(cursor).match(/^[ \t\r\n]*/)[0];
                cursor += whitespace.length;
                if (source.startsWith('/>', cursor) || source[cursor] === '>') break;
                if (!whitespace) fail('Attribut ohne Trennzeichen');
                const attr = source.slice(cursor).match(new RegExp(`^(${NAME})${SPACE}*=${SPACE}*(["'])([\\s\\S]*?)\\2`));
                if (!attr || attr[3].includes('<')) fail('Ungültiges Attribut');
                if (attributes.has(attr[1])) fail('Doppeltes Attribut');
                attributes.add(attr[1]); entities(attr[3]);
                cursor += attr[0].length;
            }
            if (!stack.length) {
                roots++;
                if (roots !== 1 || name !== 'svg') fail('Genau eine SVG-Wurzel erforderlich');
            }
            const selfClosing = source.startsWith('/>', cursor);
            cursor += selfClosing ? 2 : 1;
            if (!selfClosing) stack.push(name);
        }
    }
    if (stack.length || roots !== 1) fail('Unvollständiges Dokument');
    return true;
}
