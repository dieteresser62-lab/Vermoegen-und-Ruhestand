import { documentDouble } from './helpers/page-dialog-dom.mjs';

const saved = { document: globalThis.document, window: globalThis.window, error: console.error };
const tick = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const tree = node => [node, ...node.children.flatMap(tree)];
function fixture() {
    const env = documentDouble(), fields = new Map();
    env.doc.addEventListener = () => {};
    env.doc.getElementById = id => {
        if (id.startsWith('page')) return env.nodes.find(node => node.id === id && node.isConnected) || null;
        if (!fields.has(id)) fields.set(id, { value: '', checked: false, disabled: false, style: {}, innerHTML: '',
            textContent: '', setAttribute() {}, scrollIntoView() {} });
        return fields.get(id);
    };
    return env;
}

try {
    console.error = () => {};
    globalThis.window = {};
    const { createMonteCarloUI } = await import('../app/simulator/monte-carlo-ui.js');
    const env = fixture(); globalThis.document = env.doc;
    const get = env.doc.getElementById;
    env.doc.getElementById = id => id === 'mc-error-container' ? null : get(id);
    createMonteCarloUI().showError(new Error('Synthetischer MC-Fehler')); await tick();
    assert(env.dialog()?.open, 'Simulatorhinweis ist ein echter Seitendialog');
    assert(tree(env.dialog()).some(n => n.textContent === 'Verstanden'), 'Hinweis besitzt Verstanden');
    assert(tree(env.dialog()).some(n => n.tagName === 'h2' && n.textContent), 'Hinweis besitzt verständlichen Titel');
    tree(env.dialog()).find(n => n.dataset.pageDialogAccept !== undefined).fire('click'); await tick();
} finally {
    console.error = saved.error;
    for (const key of ['document', 'window']) { if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key]; }
}
