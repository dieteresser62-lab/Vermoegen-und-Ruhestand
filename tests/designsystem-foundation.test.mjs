import { readSources, validateFoundation, COLORS, CONTRAST_PAIRS, contrast, PAGES } from './designsystem-source-contract.mjs';
const original = readSources();
assertEqual(validateFoundation(original).join('\n'), '', 'Originalquellen erfüllen das Grundbild');
function reject(path, mutate, expected, label) {
    const source = mutate(original[path]);
    assert(source !== original[path], `${label}: echte Gegenprobe`);
    const errors = validateFoundation({ ...original, [path]: source });
    assert(errors.some(error => error.includes(expected)), `${label}: gezielte Diagnose ${expected}`);
}
for (const page of PAGES) {
    reject(page, s => s.replace('href="css/tokens.css"', 'href="css/fonts.css"'), 'Ladefolge', `${page}: vertauschte Ladefolge`);
    reject(page, s => s.replace('</head>', '<style>:root { --page: #000000; }</style></head>'), 'Tokenüberschreibung', `${page}: Tokenüberschreibung`);
    reject(page, s => s.replace('</head>', '<link rel="stylesheet" href="https://fonts.example.org/style.css"></head>'), 'Externe', `${page}: externe Schriftquelle`);
    reject(page, s => s.replace('</head>', '<style>body { opacity: .5; }</style></head>'), 'Textdeckkraft', `${page}: Elterndeckkraft`);
}
reject('css/balance.css', s => s.replace('--input-bg: var(--surface);', '--input-bg: var(--missing);'), 'Alias', 'Fehlender Alias');
reject('css/balance.css', s => s.replace('--input-bg: var(--surface);', '--input-bg: var(--hover-color);').replace('--hover-color: var(--surface-sunken);', '--hover-color: var(--input-bg);'), 'Aliaszyklus', 'Zyklische Aliasbrücke');
reject('css/balance.css', s => s.replace('--green-text: var(--good);', ''), 'Balance-Alias', 'Fehlende Balance-Brücke');
reject('css/balance.css', s => s + '\n.panel { color: var(--text-main) !important; }', 'Priorität', 'Zusätzliche Priorität');
reject('css/balance.css', s => s.replace('.input-error {', '.new-input-error {'), 'Priorität', 'Verschobene Prioritätsausnahme');
reject('Balance.html', s => s.replace('<body>', '<body style="color: red !important">'), 'Inline-Priorität', 'Inline-Override');
reject('css/balance.css', s => s.replace('color: var(--primary-text);\n    margin:', 'color: rgba(29, 40, 48, .5);\n    margin:'), 'Deckkraft', 'Transparente Grundschrift');
reject('app/balance/balance-main.js', s => s + '\ntarget.style.opacity = .5;', 'JS-Textdeckkraft', 'JS-Textfläche');
reject('css/overview.css', s => s.replace('.overview-page {', '.overview-page { opacity: .5;'), 'Textdeckkraft', 'Deckkraft des Kartenelternteils');
reject('css/overview.css', s => s.replace('.overview-pill {', '.overview-pill { opacity: .5;'), 'Textdeckkraft', 'Deckkraft der Hauptaktion');
reject('css/tokens.css', s => s.replace('--text-muted: #56626a;', '--text-muted: #dddddd;'), 'Kontrast', 'Kontrastschwache Tokenfarbe');
const backdrop = '--backdrop: color-mix(in srgb, var(--text-main) 45%, transparent);';
for (const [replacement, label] of [
    ['', 'Fehlender Grafiktoken'],
    [backdrop.replace('45%', '25%'), 'Falscher Grafikanteil'],
    [backdrop.replace('--text-main', '--text-muted'), 'Falsche Grafikrolle'],
    ['--backdrop: var(--surface-sunken);', 'Opaker Grafiktoken'],
    [`${backdrop} ${backdrop}`, 'Doppelter Grafiktoken'],
    [`/* ${backdrop} */`, 'Grafiktoken nur im Kommentar']
]) reject('css/tokens.css', s => s.replace(backdrop, replacement), 'Grafiktoken: --backdrop', label);
reject('css/tokens.css', s => s.replace(backdrop, '') + `\n.probe { ${backdrop} }`, 'Grafiktoken: --backdrop', 'Grafiktoken außerhalb :root');
reject('index.html', s => s.replace('</head>', `<style>:root { ${backdrop} }</style></head>`), 'Tokenüberschreibung', 'Grafiktoken außerhalb der kanonischen Quelle');
reject('css/overview.css', s => s.replace('.overview-heading p {', '.overview-heading p { color: var(--backdrop);'), 'Textfarbe mit Deckkraft', 'Grafiktoken am Textelternknoten');
assert(!('backdrop' in COLORS) && !CONTRAST_PAIRS.flat().includes('backdrop'), 'Grafiktoken ist keine opake Textkontrastrolle');
reject('css/balance.css', s => s.replace('background: var(--text-main);', 'background: var(--accent-soft);'), 'Grundrolle/Kontrast', 'Unzulässiges Aktionspaar');
reject('css/suite-frame.css', s => s.replace(/(\.suite-brand \{[^}]*?)color: var\(--text-main\);/, '$1color: var(--surface);'), 'Grundrolle/Kontrast', 'Unlesbare Rahmenmarke');
reject('css/suite-frame.css', s => s.replace(/(\.suite-navigation a\[aria-current="page"\] \{[^}]*?)background: var\(--surface-sunken\);/, '$1background: var(--text-main);'), 'Grundrolle/Kontrast', 'Unlesbarer aktiver Rahmenlink');
reject('css/fonts.css', s => s.replace('../assets/fonts/newsreader-latin-400-normal.woff2', 'https://cdn.example.org/newsreader.woff2'), 'Externe', 'Externe Fontdatei');
reject('css/fonts.css', s => s.replace('font-display: swap;', 'font-display: block;'), 'Fontface', 'Blockierende Schrift');
reject('css/fonts.css', s => s.replace('font-weight: 400;', 'font-weight: 700;'), 'Fontface', 'Falscher lokaler Schnitt');
reject('app/shared/designsystem-icons.js', s => s + '\nconst symbolSource = "https://cdn.example.org/lucide.svg";', 'Externe', 'Fremde Symbolnetzquelle');
reject('css/balance.css', s => s.replace('.input-error {', '.input-error { color: red !important; color: black;'), 'Priorität', 'Verdeckte zusätzliche Priorität');
reject('index.html', s => s.replace('</head>', '<style>.designsystem-overlay { position: fixed; }</style></head>'), 'Designoverlay', 'Neue Overlay-Schicht');
reject('app/balance/balance-main.js', s => s.replace("target.style.color = 'var(--warn)'", "target.style.color = 'var(--warn-soft)'"), 'JS-Kontrastpaar', 'Unlesbares Warnpaar im Renderer');
reject('Balance.html', s => s.replace('background-color: var(--warn-soft); color: var(--warn);', 'background-color: var(--warn); color: #000;'), 'Inline-Kontrastpaar', 'Unlesbares Inline-Warnpaar');
for (const [fg, bg] of CONTRAST_PAIRS) assert(contrast(COLORS[fg], COLORS[bg]) >= 4.5, `Textkontrast ${fg}/${bg} mindestens 4,5:1`);
for (const [path, source] of Object.entries(original)) assert(!source.includes('designsystem-overlay'), `${path}: kein Designoverlay`);
assert(!original['index.html'].includes('.app-card::after'), 'Keine helle Dekorschicht über migriertem Kartentext');
assert(original['app/balance/balance-main.js'].includes("target.style.backgroundColor = 'var(--warn-soft)'"), 'Persistenzwarnung auf Warnfläche');
assert(original['app/balance/balance-main.js'].includes("alertBanner.style.color = 'var(--bad)'"), 'Startfehler mit Fehlertext');

reject('css/components.css', s => s.replace('inset: 0; margin: auto;', 'inset: 0;'), 'Seitendialog: margin', 'Eigene Dialogzentrierung');
reject('css/components.css', s => s.replace('.page-choice-dialog h2 { font-family: var(--font-serif); font-size: var(--text-title); }', '.page-choice-dialog h2 { font-family: var(--font-serif); font-size: var(--text-sm); }'), 'Seitendialog: font-size', 'Eigene Dialogtitelschrift');
reject('css/components.css', s => s.replace('.page-choice-dialog .ds-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }', '.page-choice-dialog .ds-actions { display: flex; }'), 'Seitendialog: gap', 'Dialoglokaler Knopfabstand');

reject('css/components.css', s => s.replace('.page-choice-dialog label.page-choice-card { font-family: var(--font-sans); font-size: var(--text-base); }', '.page-choice-dialog label.page-choice-card { font-family: var(--font-sans); }'), 'Seitendialog:', 'Fehlender eigenständiger Optionswert');
reject('css/components.css', s => s.replace('.page-choice-dialog label.page-choice-card', '.page-choice-card'), 'Seitendialog:', 'Abgeschwächte Optionsspezifität gegen kompakte Seite');
reject('css/components.css', s => s.replace('.page-choice-dialog .page-choice-card > span { font-family: var(--font-sans); font-size: var(--text-base); }', ''), 'Seitendialog:', 'Fehlende Optionstextschrift');
reject('css/balance.css', s => s.replace('html[data-density=compact] label {', 'html[data-density=compact] .page-choice-dialog label {'), 'Seitendialog: wirksame', 'Konkrete kompakte Seitenüberschreibung in echter Ladefolge');
