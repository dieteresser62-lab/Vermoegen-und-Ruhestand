// Ersetzt für einen Kindprozess Felder des Datenstands im Speicher (JD-1 Nachtrag 2): `node --import <diese Datei> …`
// mit JD1_DATENSTAND_OVERRIDE='{"endYear":2026}'. Die Dateien bleiben unverändert.
import { register } from 'node:module';

const override = JSON.parse(process.env.JD1_DATENSTAND_OVERRIDE || 'null');
if (override) register(new URL('./historical-datenstand-override-hooks.mjs', import.meta.url), { data: override });
