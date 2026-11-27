// Git-Isolation für Tests, die ein eigenes Repo anlegen oder Git schreibend nutzen (JD-2b Nachtrag 2).
// Ein geerbtes GIT_DIR (etwa aus der Gegenprobe in einem normalen Klon) lenkt `git init`, `git config` und `git commit`
// sonst in das Eltern-Repo. Darum: alle GIT_*-Variablen entfernen und vor dem ersten Schreiben das Repo prüfen.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Tests, die ein eigenes Git-Repo anlegen oder Git schreibend nutzen; die Gegenprobe gibt ihnen kein GIT_DIR. */
export const GIT_SCHREIBENDE_TESTS = Object.freeze(['jahresdaten-gitattributes.test.mjs', 'runtime-build-provenance.test.mjs',
    'facade-exports.test.mjs', 'typecheck-ratchet.test.mjs']);

/**
 * Entfernt geerbte GIT_*-Variablen vor dem Einfügen ausdrücklicher Zusätze.
 * @param {NodeJS.ProcessEnv} [env] @param {Record<string, string>} [zusatz] @returns {NodeJS.ProcessEnv}
 */
export function gitFreieUmgebung(env = process.env, zusatz = {}) {
    const frei = Object.fromEntries(Object.entries(env).filter(([name]) => !/^GIT_/i.test(name)));
    return { ...frei, ...zusatz };
}

/**
 * Entfernt die GIT_*-Variablen aus process.env selbst, für Tests, die Git auch im eigenen Prozess aufrufen
 * (etwa über einen lokalen Server).
 */
export function prozessUmgebungBereinigen() {
    const frei = gitFreieUmgebung(process.env);
    for (const name of Object.keys(process.env)) if (!(name in frei)) delete process.env[name];
}

/**
 * Bricht ab, wenn Git in `repo` nicht das eigene `repo/.git` benutzt.
 * @param {string} repo @param {NodeJS.ProcessEnv} env
 */
export function eigenesRepoPruefen(repo, env) {
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: repo, env, encoding: 'utf8' }).trim();
    const erwartet = path.join(fs.realpathSync(repo), '.git');
    if (fs.realpathSync(gitDir) !== erwartet) throw new Error(`Git arbeitet nicht im Temp-Repo: ${gitDir} statt ${erwartet}; Abbruch vor jedem Schreiben`);
    return gitDir;
}
