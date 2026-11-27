// Ladehaken zu historical-datenstand-override-register.mjs: legt die Felder des Overrides über den Datenstand.
let override = null;

export function initialize(data) {
    override = data;
}

export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);
    if (!override || !url.endsWith('/app/simulator/historical-datenstand.js')) return result;
    const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    if (!source.includes('export default ')) throw new Error('Datenstand-Modul hat keinen Standardexport');
    return {
        ...result,
        shortCircuit: true,
        source: `${source.replace('export default ', 'const original = ')}\nexport default Object.freeze({ ...original, ...${JSON.stringify(override)} });\n`
    };
}
