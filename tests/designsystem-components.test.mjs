import { readSources, validateComponents, validateBalanceSimulatorRefinement, COMPONENT_CLASSES } from './designsystem-source-contract.mjs';
const original = readSources();
assertEqual(validateComponents(original).join('\n'), '', 'Originalquellen erfüllen den Komponentenvertrag');
assertEqual(validateBalanceSimulatorRefinement(original).join('\n'), '', 'Balance-/Simulator-Feinschliff erfüllt lokale Darstellungsverträge');
for (const [path, mutation, expected] of [
    ['simulator.css', s => s + '\n.sim-toggle-row > input { width: 100%; height: 100%; inset: 0; z-index: 1; }', 'Schalterinput'],
    ['simulator.css', s => s.replace('grid-template-rows: subgrid;', 'grid-template-rows: auto auto;'), 'grid-template-rows'],
    ['simulator.css', s => s.replace('[data-profile-role-id] { white-space: nowrap;', '[data-profile-role-id] { white-space: normal;'), 'white-space'],
    ['css/balance.css', s => s.replace('.balance-market-segment.phase-0 { --phase-color: var(--warn); background: var(--warn-soft);', '.balance-market-segment.phase-0 { --phase-color: var(--good); background: var(--good-soft);'), 'Warn- und Zielstatusfarben'],
    ['css/balance.css', s => s + '\n.balance-action-table caption { display: none; }', 'Dialogcaption']
]) {
    const changed = mutation(original[path]);
    assert(changed !== original[path], `Wirksame Feinschliffgegenprobe: ${expected}`);
    assert(validateBalanceSimulatorRefinement({ ...original, [path]: changed }).some(error => error.includes(expected)), `Feinschliffgegenprobe abgewiesen: ${expected}`);
}
assert(!/transition\s*:[^;]*(?:\ball\b|outline)/.test(original['index.html']), 'Startseitenübergänge interpolieren keine Outline-Eigenschaft');
function reject(path, mutate, expected) {
    const changed = mutate(original[path]);
    assert(changed !== original[path], `Wirksame Gegenprobe: ${expected}`);
    assert(validateComponents({ ...original, [path]: changed }).some(error => error.includes(expected)), `Abgelehnte Gegenprobe: ${expected}`);
}
reject('index.html', s => s.replace('</body>', '<button class="ds-icon-button">×</button></body>'), 'Namenlose Symboltaste');
reject('index.html', s => s.replace('</body>', '<button class="ds-icon-button" aria-label="  ">×</button></body>'), 'Namenlose Symboltaste');
reject('index.html', s => s + "\nconst button = document.createElement('button'); button.className = 'ds-icon-button';", 'Namenlose Symboltaste');
reject('index.html', s => s.replace('</body>', '<input data-field-state="success"></body>'), 'Ungültiger Zustandswert');
reject('css/components.css', s => s.replace('data-field-state="error"', 'data-field-state="failure"'), 'Ungültiger Zustandswert');
reject('css/components.css', s => s + '\n.ds-note { opacity: .5; }', 'Text-/Elterndeckkraft');
reject('css/overview.css', s => s.replace('.overview-person {', '.overview-person { opacity: .7;'), 'Text-/Elterndeckkraft');
reject('Handbuch.html', s => s.replace('.step-content p {', '.step-content p { opacity: .7;'), 'Text-/Elterndeckkraft');
reject('Handbuch.html', s => s.replace('<body>', '<body style="color: #777">'), 'Inline-Textfarbe');
reject('css/components.css', s => s.replace('solid var(--ring-color)', 'solid transparent'), 'Fokusring');
reject('index.html', s => s.replace('href="css/components.css"', 'href="css/fonts.css"'), 'Komponenten-Ladefolge');
for (const [before, replacements, diagnostic] of [
    ['margin: auto;', ['', 'margin: 0;'], 'Navigationsdarstellung: .navigation-guard-dialog margin'],
    ['padding: var(--space-6);', ['', 'padding: 0;', 'padding: var(--space-4);'], 'Navigationsdarstellung: .navigation-guard-dialog padding'],
    ['background: var(--backdrop);', ['', 'background: var(--surface-sunken);', 'background: var(--accent-soft);'], 'Navigationsdarstellung: .navigation-guard-dialog::backdrop background'],
    ['color: var(--text-main);', ['color: var(--backdrop);'], 'Navigationsdarstellung: .navigation-guard-dialog color'],
    ['background: var(--surface);', ['background: var(--backdrop);'], 'Navigationsdarstellung: .navigation-guard-dialog background']
]) {
    for (const after of replacements) reject('css/components.css', s => s.replace(/\.navigation-guard-dialog(?:::backdrop)? \{[^}]*\}/g,
        rule => rule.replace(before, after)), diagnostic);
}
reject('css/components.css', s => s.replace('.navigation-guard-dialog {', '.navigation-guard-dialog { opacity: .5;'), 'Text-/Elterndeckkraft');
reject('css/components.css', s => s + '\n.probe-parent { color: var(--backdrop); }', 'Transparente Textfarbe');
reject('css/components.css', s => s + '\n.probe-parent { opacity: .5; }', 'Text-/Elterndeckkraft');
reject('css/components.css', s => s.replace('.navigation-guard-dialog { margin: auto;', '.navigation-guard-dialog { /* margin: auto; */')
    + '\n.probe { margin: auto; }', 'Navigationsdarstellung: .navigation-guard-dialog margin');
const named = { ...original, 'index.html': original['index.html'].replace('</body>', '<button aria-label="Schließen" class="ds-icon-button">×</button></body>') };
assertEqual(validateComponents(named).length, 0, 'Benannte Symboltaste ist zulässig');
for (const name of COMPONENT_CLASSES) assert(original['css/components.css'].includes(`.${name}`), `Gemeinsame Rolle ${name}`);
assert(!/opacity\s*:/.test(original['css/components.css']), 'Disabled-Komponenten behalten lesbare Textdeckkraft');
assert(original['css/components.css'].includes(':where(.ds-metric-primary) { font-family: var(--font-serif)'), 'Nur hervorgehobener Kennzahlwert erhält Serifentypografie');

const hiddenRule = /:where\(\.ds-button,\s*\.ds-icon-button\)\[hidden\]\s*\{\s*display:\s*none;\s*\}/;
assert(hiddenRule.test(original['css/components.css']), 'Hidden-Buttons sind trotz inline-flex wirklich verborgen');
const withoutHiddenRule = original['css/components.css'].replace(hiddenRule, '');
assert(withoutHiddenRule !== original['css/components.css'] && !hiddenRule.test(withoutHiddenRule), 'Gegenprobe erkennt fehlende Hidden-Regel');
