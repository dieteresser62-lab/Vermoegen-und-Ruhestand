export const SUITE_SIDEBAR_KEY = 'ui_suite_sidebar_collapsed';
export const SUITE_SIDEBAR_BREAKPOINT_REM = 82;

/** Gerätepräferenz außerhalb der fachlichen Persistenz; nur manuell schreiben. */
export function createSuiteSidebarPreference(getStorage = () => globalThis.localStorage) {
    let collapsed = false;
    try { collapsed = getStorage()?.getItem(SUITE_SIDEBAR_KEY) === 'true'; } catch {}
    return {
        get collapsed() { return collapsed; },
        choose(value) {
            collapsed = Boolean(value);
            try { getStorage()?.setItem(SUITE_SIDEBAR_KEY, String(collapsed)); } catch {}
            return collapsed;
        }
    };
}

export function sidebarIsAutomatic(width, remSize = 16) {
    return width < SUITE_SIDEBAR_BREAKPOINT_REM * remSize;
}

export function initSuiteSidebar(doc) {
    const shell = doc.querySelector?.('.suite-shell');
    const button = doc.getElementById('suiteSidebarToggle');
    const win = doc.defaultView;
    if (!shell || !button || !win) return false;
    const preference = createSuiteSidebarPreference(() => win.localStorage);
    let automatic = false;
    const render = () => {
        const rem = parseFloat(win.getComputedStyle(doc.documentElement).fontSize) || 16;
        automatic = sidebarIsAutomatic(shell.getBoundingClientRect().width, rem);
        shell.dataset.sidebarCollapsed = String(preference.collapsed);
        const collapsed = automatic || preference.collapsed;
        const label = automatic ? 'Leiste automatisch kompakt (unter 82rem)'
            : collapsed ? 'Leiste ausklappen' : 'Leiste einklappen';
        button.disabled = automatic;
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', label);
        button.title = label;
        // Beide lokalen Symbole sind statisch geladen; ihre Auswahl benötigt keinen Fetch.
        button.dataset.collapsed = String(collapsed);
    };
    button.addEventListener('click', () => {
        if (automatic) return;
        preference.choose(!preference.collapsed);
        render();
    });
    if (win.ResizeObserver) {
        const observer = new win.ResizeObserver(render);
        observer.observe(shell);
        observer.observe(doc.documentElement);
    } else {
        win.addEventListener('resize', render);
    }
    render();
    return true;
}
