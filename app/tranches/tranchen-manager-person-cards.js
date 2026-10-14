// Ausschließlich dokumentlokale UI: jeder Seitenaufruf beginnt geschlossen.
const cards = ['Person', 'Assets', 'Care'];
const bindings = new WeakMap();

export function bindManagerPersonCards(doc, profileId) {
    if (bindings.has(doc)) return bindings.get(doc);
    let current = null;
    const memory = Object.create(null);
    const byId = id => doc.getElementById(id);
    const state = () => memory[current] || {};
    const present = () => cards.filter(card => byId(`manager${card}Body`));
    const visibleState = () => Object.fromEntries(present().map(card => [card, !byId(`manager${card}Body`).hidden]));
    const updateAria = () => {
        const shown = visibleState();
        present().forEach(card => {
            byId(`manager${card}Toggle`)?.setAttribute('aria-expanded', String(shown[card]));
            const action = byId(`manager${card}Action`);
            if (action) action.textContent = shown[card] ? '▾ ausblenden' : '▸ zeigen';
        });
        const all = byId('managerCardsToggleAll');
        const expanded = present().length > 0 && present().every(card => shown[card]);
        if (all) {
            all.textContent = expanded ? '▾ Alle Details ausblenden' : '▸ Alle Details zeigen';
            all.setAttribute('aria-expanded', String(expanded));
        }
    };
    const paint = saved => {
        present().forEach(card => { byId(`manager${card}Body`).hidden = saved[card] !== true; });
        updateAria();
    };
    const set = changes => {
        if (!current) return;
        paint({ ...visibleState(), ...changes });
        memory[current] = visibleState();
    };
    // Native Buttons übernehmen Enter/Space; kein zweiter keydown-Toggle.
    cards.forEach(card => byId(`manager${card}Toggle`)?.addEventListener('click', () => set({ [card]: byId(`manager${card}Body`)?.hidden === true })));
    byId('managerCardsToggleAll')?.addEventListener('click', () => {
        const shown = visibleState();
        const open = !present().every(card => shown[card]);
        set(Object.fromEntries(present().map(card => [card, open])));
    });
    const openTarget = () => {
        if (doc.defaultView?.location?.hash !== '#personendaten' || byId('managerPersonPanel')?.hidden) return;
        set({ Person: true });
        byId(byId('managerBirthSupplement')?.hidden === false ? 'managerBirthDate' : 'profileGeburtsdatum')?.focus();
    };
    const api = { openPerson() { set({ Person: true }); }, sync() { current = profileId(); paint(state()); }, openTarget };
    bindings.set(doc, api);
    api.sync();
    return api;
}
