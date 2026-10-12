import { DYNAMIC_FLEX_OPTIONS, detectDynamicFlexPreset, dynamicFlexPresetPatch } from './dynamic-flex-presets.js';

const bindings = new WeakMap();

/** Flüchtige Detailabsicht; Änderungen und Validierung besitzt allein der Aufrufer. */
export function bindHouseholdPlanDynamicFlex({ doc, root = doc?.body, host, details, read, disabled, onChange,
    hasDetailErrors = () => false, hasDetailCorrections = () => false } = {}) {
    if (!host) return null;
    bindings.get(host)?.dispose();
    let customRequested = false, presetTransition = null, disposed = false, focusTimer = null;
    let visibleDetailTargets = new Set();
    const cancelFocus = () => { clearTimeout(focusTimer); focusTimer = null; };
    const visible = node => {
        if (!node || node.disabled || node.isConnected === false) return false;
        if (node.getClientRects && !node.getClientRects().length) return false;
        let withinRoot = false;
        for (; node; node = node.parentElement || node.parent) {
            if (node.hidden || node.inert) return false;
            if (node === root) withinRoot = true;
        }
        return withinRoot;
    };
    const segment = doc.createElement('div'); segment.className = 'ds-segment';
    segment.dataset.planDynamicPresets = '';
    segment.setAttribute('role', 'group'); segment.setAttribute('aria-label', 'Dynamik');
    const hint = doc.createElement('p'); hint.className = 'ds-help'; hint.dataset.planDynamicHint = '';
    hint.textContent = 'Voreinstellung gilt; Details sind ausgeblendet.';
    const buttons = [];
    for (const [key, label] of DYNAMIC_FLEX_OPTIONS) {
        const button = doc.createElement('button'); button.type = 'button'; button.textContent = label;
        button.dataset.planDynamicPreset = key;
        const click = () => {
            if (disposed || disabled()) return;
            cancelFocus();
            const values = read();
            if (!values) return;
            customRequested = key === 'custom';
            // Alte synchrone Entwurfsmeldungen dürfen die bewusste Presetwahl
            // nicht wieder als individuelle Bearbeitung öffnen.
            presetTransition = key;
            try {
                // Aktive Dynamik: reine Öffnung, auch bei exakt passenden Presetwerten.
                if (key !== 'custom' || values.dynamicFlex === false) {
                    onChange(key === 'custom' ? { dynamicFlex: true } : dynamicFlexPresetPatch(key));
                }
            } finally {
                presetTransition = null;
                sync();
            }
        };
        button.addEventListener('click', click); segment.append(button); buttons.push({ button, key, click });
    }
    host.append(segment, hint);
    const focusSelected = () => {
        const target = buttons.find(({ button }) => button.getAttribute('aria-pressed') === 'true' && visible(button))
            || buttons.find(({ button }) => visible(button));
        target?.button.focus();
    };
    function sync({ blurredField, relatedTarget } = {}) {
        if (disposed) return;
        const beforeBlur = visibleDetailTargets;
        const values = read(), detected = detectDynamicFlexPreset(values), errorOpen = hasDetailErrors(), correcting = hasDetailCorrections();
        // Auch automatisch geöffnete individuelle Werte begründen eine lokale
        // Bearbeitungsabsicht, die Preset-Zwischenwerte beim Tippen überlebt.
        // Eine reine Fehleröffnung erzeugt dagegen keine bleibende Customabsicht.
        if (values && !presetTransition && !errorOpen && !correcting && detected === 'custom') customRequested = true;
        const selected = presetTransition || (customRequested ? 'custom' : detected);
        const open = Boolean(values && (selected === 'custom' || errorOpen || correcting));
        if (correcting) cancelFocus();
        for (const { button, key } of buttons) {
            button.disabled = disabled(); button.setAttribute('aria-pressed', String(selected === key));
        }
        if (details) {
            if (!open && !details.hidden && details.contains(doc.activeElement)) {
                focusSelected();
            }
            details.hidden = !open;
        }
        hint.hidden = open;
        visibleDetailTargets = new Set(Array.from(details?.querySelectorAll('input, select, button, textarea, [tabindex]') || []).filter(visible));
        if (details?.contains(blurredField)) {
            cancelFocus();
            // Nur ein zuvor sichtbares Detailziel begründet eine Blurrettung.
            if (!beforeBlur.has(blurredField)) return;
            // Ein weiterhin sichtbares Feld ohne verborgenes angekündigtes
            // Detailziel hat keinen Fokusverlust durch diese Projektion.
            const hiddenRelatedTarget = beforeBlur.has(relatedTarget) && !visible(relatedTarget);
            if (visible(blurredField) && !hiddenRelatedTarget) return;
            // Beim nativen Blur kann activeElement bereits body sein. Erst nach
            // der Fokusfolge steht fest, ob Tab ein inzwischen verborgenes Ziel
            // getroffen hat. Keine Detailabsicht oder Fachänderung daraus ableiten.
            focusTimer = setTimeout(() => {
                focusTimer = null;
                if (disposed || hasDetailCorrections()) return;
                const active = doc.activeElement;
                if (active && active !== doc.body && !root?.contains(active)) return;
                if (active !== doc.body && visible(active)) return;
                // Ein angekündigtes Außenziel gehört weiterhin dem Nutzer.
                if ((!active || active === doc.body) && relatedTarget && !root?.contains(relatedTarget)) return;
                // Body allein bedeutet keinen Sichtbarkeitsverlust. Den Zustand
                // erst hier prüfen, damit auch eine Wiederöffnung den alten Auftrag entkräftet.
                const hiddenEndTarget = details.contains(active) && beforeBlur.has(active) && !visible(active);
                // Maßgeblich ist das konkrete Fokusziel samt Vorfahren, nicht
                // die eigene Layoutbox des nicht fokussierbaren Containers.
                if (visible(blurredField) && !hiddenEndTarget) return;
                focusSelected();
            }, 0);
        }
    }
    const binding = { sync, reset() { cancelFocus(); customRequested = false; sync(); }, dispose() {
        cancelFocus();
        disposed = true;
        for (const { button, click } of buttons) button.removeEventListener('click', click);
        segment.remove(); hint.remove(); bindings.delete(host);
    } };
    bindings.set(host, binding); sync(); return binding;
}
