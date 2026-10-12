export function documentDouble({ fault = '' } = {}) {
    const nodes = [];
    const doc = { activeElement: null, createElement(tag) { const node = new Node(tag); nodes.push(node); return node; } };
    class Node {
        constructor(tag) { this.tagName = tag; this.innerHTML = ''; this.children = []; this.dataset = {}; this.listeners = new Map(); this.attributes = {}; }
        get isConnected() { return this === doc.body || Boolean(this.parentNode?.isConnected); }
        setAttribute(key, value) { this.attributes[key] = value; }
        appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
        append(...children) { children.forEach(child => this.appendChild(child)); }
        replaceChildren(...children) { [...this.children].forEach(child => child.remove()); this.append(...children); }
        remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
        focus() { doc.activeElement = this; }
        addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
        removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
        fire(type, detail = {}) { const event = { prevented: false, preventDefault() { this.prevented = true; }, ...detail }; [...this.listeners.get(type) || []].forEach(fn => fn(event)); return event; }
        showModal() { if (fault === 'show') throw new Error('SYNTHETIC_SHOW_FAILURE'); this.open = true; }
        close() { this.open = false; this.fire('close'); }
    }
    doc.body = doc.createElement('body');
    const opener = doc.createElement('button'); doc.body.appendChild(opener); opener.focus();
    if (fault === 'missing') doc.createElement = tag => { const node = new Node(tag); nodes.push(node); if (tag === 'dialog') node.showModal = undefined; return node; };
    return { doc, nodes, opener, dialog: () => nodes.findLast(node => node.tagName === 'dialog'),
        controls: () => { const walk = node => [node, ...node.children.flatMap(walk)]; return walk(doc.body).filter(node => ['select', 'button'].includes(node.tagName) && node !== opener); },
        cleaned: () => nodes.every(node => [...node.listeners.values()].every(set => set.size === 0)) };
}

/** Ergänzt bestehende Seitenfixtures nur um den DOM-Unterbaum des Seitendialogs. */
export function installPageDialogDom(doc) {
    const env = documentDouble();
    const create = doc.createElement?.bind(doc) || env.doc.createElement.bind(env.doc);
    let building = false;
    doc.pageDialogs = [];
    if (!doc.body) doc.body = env.doc.body;
    doc.createElement = tag => {
        if (tag === 'dialog') building = true;
        if (!building) return create(tag);
        const node = env.doc.createElement(tag);
        node.focus = () => { doc.activeElement = node; };
        if (tag === 'dialog') {
            doc.pageDialogs.push(node);
            node.showModal = () => { node.open = true; building = false; };
            const remove = node.remove.bind(node);
            node.remove = () => { node.open = false; remove(); };
        }
        return node;
    };
    return doc;
}

export async function respondPageDialog(doc, action = 'accept') {
    let dialog;
    for (let i = 0; i < 100; i++) {
        dialog = doc.pageDialogs?.findLast(node => node.open);
        if (dialog) break;
        await Promise.resolve();
    }
    if (!dialog) throw new Error('Kein offener Seitendialog in der Seitenfixture.');
    const walk = node => [node, ...node.children.flatMap(walk)];
    if (action === 'escape') dialog.fire('keydown', { key: 'Escape' });
    else walk(dialog).find(node => node.dataset[action === 'accept' ? 'pageDialogAccept' : 'pageDialogCancel'] !== undefined).fire('click');
    for (let i = 0; i < 12; i++) await Promise.resolve();
    return dialog;
}

export async function completePageDialog(pending, doc, action = 'accept') {
    await respondPageDialog(doc, action);
    return pending;
}
