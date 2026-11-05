// Leserprojektion; vollständige Rohschlüssel und Zuordnungen bleiben separat geprüft.
export const TECHNICAL_REFERENCE = 'docs/reference/TECHNICAL.md';
const number = value => value.toLocaleString('de-DE', { maximumFractionDigits: 8 });
export function readableValue(value, unit = '') {
    if (value === Infinity) return '∞';
    if (value === null) return 'keine Vorgabe';
    if (typeof value === 'boolean') return value ? 'ein' : 'aus';
    if (typeof value === 'number') {
        const label = unit === 'Jahre' && value === 1 ? 'Jahr' : unit;
        return `${number(unit === '%' ? value * 100 : value)}${label ? ` ${label}` : ''}`;
    }
    const names = { legacy_step: 'CAPE-Stützpunkte', cape_continuous: 'stetige CAPE-Rendite',
        bear_deep: 'Tiefer Bär', recovery_in_bear: 'Erholung im Bär', config_or_zero: 'Vorgabe oder 0 %' };
    if (!(value in names)) throw new Error(`Leserwert nicht übersetzt: ${value}`);
    return names[value];
}
export function readerParameterRows(entries, specs, assignments, technicalOnly = []) {
    const values = new Map(entries), assigned = new Set(technicalOnly);
    for (const key of technicalOnly) if (!values.has(key)) throw new Error(`Veraltete technische Zuordnung: ${key}`);
    const rows = specs.map(([name, keys, units = '', heading]) => {
        const targets = new Set();
        const parts = keys.map((key, index) => {
            if (!values.has(key)) throw new Error(`Leserparameter fehlt: ${key}`);
            if (assigned.has(key)) throw new Error(`Leserparameter doppelt: ${key}`);
            assigned.add(key);
            targets.add(assignments.get(key)?.target ?? assignments.get(key));
            return readableValue(values.get(key), Array.isArray(units) ? units[index] : units);
        });
        return (heading ? `\n#### ${heading}\n\n| Parameter | Vorgabe | Stufe |\n| --- | --- | --- |\n` : '')
            + `| ${name} | ${parts.join(' / ')} | ${[...targets].map(target => `[${target.slice(1).toUpperCase()}](${target})`).join(', ')} |`;
    });
    const missing = entries.filter(([key]) => !assigned.has(key));
    if (missing.length) throw new Error(`Leserzuordnung fehlt: ${missing.map(([key]) => key).join(', ')}`);
    return ['| Parameter | Vorgabe | Stufe |', '| --- | --- | --- |', ...rows].join('\n');
}
export function technicalProjection(text, reference) {
    return text.replace(/\]\(#/g, `](${reference.split('/').at(-1)}#`);
}
