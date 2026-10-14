import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('--- Tauri CSP Tests ---');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const tauriConfigPath = path.join(repoRoot, 'src-tauri', 'tauri.conf.json');
const tauriLibPath = path.join(repoRoot, 'src-tauri', 'src', 'lib.rs');
const packageJsonPath = path.join(repoRoot, 'package.json');
const yahooProxyPath = path.join(repoRoot, 'tools', 'yahoo-proxy.cjs');
const priceServicePath = path.join(repoRoot, 'app', 'tranches', 'tranchen-price-service.js');
const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
const tauriLib = fs.readFileSync(tauriLibPath, 'utf8');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const yahooProxy = fs.readFileSync(yahooProxyPath, 'utf8');
const priceService = fs.readFileSync(priceServicePath, 'utf8');
const security = tauriConfig?.app?.security || {};
const csp = security?.csp || {};
const connectSrc = String(csp?.['connect-src'] || '');
const workerSrc = String(csp?.['worker-src'] || '');
const scriptSrc = String(csp?.['script-src'] || '');
const styleSrc = String(csp?.['style-src'] || '');
const fontSrc = String(csp?.['font-src'] || '');

assert(tauriConfig?.build?.frontendDist === '../dist', 'Tauri should load the synced dist folder');
assert(tauriConfig?.productName === 'Vermögen & Ruhestand Entwicklung', 'Tauri base product name should match development docs');

const mainWindow = tauriConfig?.app?.windows?.[0] || {};
assert(mainWindow.width === 1920, 'Tauri default window width should stay documented');
assert(mainWindow.height === 1080, 'Tauri default window height should stay documented');
assert(mainWindow.resizable === true, 'Tauri window should remain resizable');

assert(connectSrc.includes('http://127.0.0.1:8787'), 'Tauri CSP should allow the local Yahoo proxy');
assert(connectSrc.includes('http://localhost:8787'), 'Tauri CSP should allow localhost Yahoo proxy fallback');
assert(connectSrc.includes('https://data-api.ecb.europa.eu'), 'Tauri CSP should allow ECB inflation fetches');
assert(connectSrc.includes('https://api.worldbank.org'), 'Tauri CSP should allow World Bank inflation fetches');
assert(connectSrc.includes('https://sdmx.oecd.org'), 'Tauri CSP should allow current OECD SDMX inflation fetches');
assert(!connectSrc.includes('https://stats.oecd.org'), 'Tauri CSP should not retain the retired OECD.Stat host');
assert(connectSrc.includes('https://r.jina.ai'), 'Tauri CSP should allow CAPE fetches via r.jina.ai');

assert(workerSrc.includes("'self'"), 'Tauri CSP should allow bundled worker modules');
assert(workerSrc.includes('blob:'), 'Tauri CSP should allow blob worker fallback');
assert(scriptSrc.includes("'self'"), 'Tauri CSP should allow bundled scripts');
assert(scriptSrc.includes("'unsafe-inline'"), 'Tauri CSP should document existing inline script usage');
assert(scriptSrc.includes("'unsafe-eval'"), 'Tauri CSP should document existing dynamic script/eval usage');
assert(styleSrc.includes("'unsafe-inline'"), 'Tauri CSP should allow existing inline styles');
assert(styleSrc === "'self' 'unsafe-inline'", 'Tauri erlaubt lokale Styles und die bestehende Inline-Nutzung');
assert(fontSrc === "'self' data:", 'Tauri erlaubt lokale WOFF2-Dateien und bestehende Datenquellen');
const expectedCsp = {
  'default-src': "'self'",
  'script-src': "'self' 'unsafe-inline' 'unsafe-eval'",
  'style-src': "'self' 'unsafe-inline'",
  'connect-src': "'self' http://127.0.0.1:8787 http://localhost:8787 https://data-api.ecb.europa.eu https://api.worldbank.org https://sdmx.oecd.org https://r.jina.ai",
  'img-src': "'self' data: blob:",
  'font-src': "'self' data:",
  'worker-src': "'self' blob:"
};
assert(JSON.stringify(csp) === JSON.stringify(expectedCsp), 'Alle CSP-Direktiven bleiben bis auf beide entfernten Google-Fontquellen exakt erhalten');
assert(!JSON.stringify(csp).includes('fonts.google'), 'Keine externe Google-Fontfreigabe verbleibt');

assert(
  security.dangerousDisableAssetCspModification === true,
  'Tauri CSP asset modification is disabled intentionally and must be documented'
);

assert(packageJson?.scripts?.['tauri:build'] === 'tauri build', 'package.json should expose the raw Tauri build gate');
assert(
  packageJson?.scripts?.['sync-dist'] === 'node scripts/sync-dist.mjs',
  'package.json should build dist with the cross-platform Node sync script'
);
assert(
  packageJson?.scripts?.['build:desktop'] === 'npm run sync-dist && npm run tauri:build',
  'package.json should expose the portable desktop build that syncs dist first'
);

for (const commandName of [
  'load_app_state',
  'save_app_state',
  'quarantine_app_state',
  'confirm_app_close'
]) {
  assert(
    tauriLib.includes(`fn ${commandName}`),
    `Tauri Rust command should exist: ${commandName}`
  );
}

assert(
  tauriLib.includes('target: Option<StateTarget>'),
  'Tauri state commands should keep the optional target payload contract'
);
assert(
  tauriLib.includes('StateTarget::Snapshots') && tauriLib.includes('ruhestand_suite_snapshots.json'),
  'Tauri snapshot target should map to a separate snapshot state file'
);
assert(
  tauriLib.includes('corrupt_state_filename') && tauriLib.includes('.corrupt.'),
  'Tauri quarantine path should keep a target-specific corrupt-state filename'
);
assert(
  tauriLib.includes('state_target_defaults_to_live_file_and_supports_snapshot_file'),
  'Tauri Rust unit tests should cover live and snapshot state target filenames'
);
assert(
  tauriLib.includes('corrupt_state_filename_uses_target_specific_stem'),
  'Tauri Rust unit tests should cover quarantine filename stems'
);

for (const contractField of ['symbol', 'price', 'currency', 'asOf', 'source']) {
  assert(
    tauriLib.includes(`\"${contractField}\"`) && yahooProxy.includes(contractField),
    `Tauri and Node proxy should expose canonical quote field: ${contractField}`
  );
}

for (const errorCode of [
  'INVALID_SYMBOL',
  'SYMBOL_NOT_FOUND',
  'INVALID_RESPONSE',
  'INVALID_PRICE',
  'CURRENCY_MISSING',
  'UNSUPPORTED_CURRENCY',
  'AS_OF_MISSING',
  'QUOTE_STALE',
  'QUOTE_FROM_FUTURE',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE'
]) {
  assert(tauriLib.includes(errorCode), `Tauri quote path should retain stable error code: ${errorCode}`);
  assert(yahooProxy.includes(errorCode), `Node quote path should retain stable error code: ${errorCode}`);
  assert(
    priceService.includes(errorCode) || ['PROVIDER_TIMEOUT', 'PROVIDER_UNAVAILABLE'].includes(errorCode),
    `Browser quote path should understand stable error code: ${errorCode}`
  );
}

assert(
  tauriLib.includes('QUOTE_MAX_AGE_SECONDS: u64 = 7 * 24 * 60 * 60') &&
    yahooProxy.includes('QUOTE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60') &&
    priceService.includes('QUOTE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60'),
  'Browser, Node and Tauri quote paths should use the same seven-day UTC age limit'
);
assert(
  tauriLib.includes("matches!(character, '.' | '^' | '=' | '-')") &&
    yahooProxy.includes('YAHOO_SYMBOL_PATTERN') &&
    priceService.includes('YAHOO_SYMBOL_PATTERN'),
  'Browser, Node and Tauri should share the Yahoo symbol alphabet without @exchange suffixes'
);
assert(
  !tauriLib.includes('normalize_gbp_price') && !yahooProxy.includes('normalizeGbpPrice'),
  'EUR-only proxies must not silently convert GBP or GBX prices'
);

const iconPaths = tauriConfig?.bundle?.icon || [];
for (const iconPath of iconPaths) {
  const fullPath = path.join(repoRoot, 'src-tauri', iconPath);
  assert(fs.existsSync(fullPath), `Tauri bundle icon should exist: ${iconPath}`);
}

assert(tauriLib.includes('dispatch_proxy_requests(server.incoming_requests(), handle_proxy_request)'),
  'Der produktive Proxy benutzt denselben Dispatcher wie die Rust-Laufzeitprobe');
const dispatcher = tauriLib.slice(tauriLib.indexOf('fn dispatch_proxy_requests'), tauriLib.indexOf('fn handle_proxy_request'));
assert(dispatcher.includes('for request in requests') && dispatcher.includes('thread::spawn(move || handler(request))') &&
    dispatcher.includes("I::Item: Send + 'static") && dispatcher.includes("F: Fn(I::Item) + Send + Sync + 'static"),
  'Jede angenommene Anfrage erhält einen eigenen Handlerthread mit übertragenem Eigentum');
assert(!tauriLib.includes('PROXY_WORKERS') && !/Mutex|\.join\(|thread::scope/.test(dispatcher),
  'Der native Dispatcher hat weder feste Workergrenze noch Handlerlock oder blockierenden Join');
for (const name of [
  'yahoo_proxy_dispatcher_overlaps_handlers_and_rejects_sequential_control',
  'yahoo_proxy_cors_query_and_errors_keep_contract',
  'yahoo_proxy_routes_preflight_and_errors_use_parallel_dispatcher'
]) {
  assert(tauriLib.includes(`#[test]\n  fn ${name}()`), `Cargo-Filter yahoo_proxy_ erfasst den Laufzeittest: ${name}`);
}
assert(tauriLib.includes('let four_blocked = entered == vec![0, 1, 2, 3]') &&
    tauriLib.includes('input_tx.send(4)') && tauriLib.includes('Ok((4, 5))') &&
    tauriLib.includes('let sequential = probe(true)') && tauriLib.includes('assert!(!sequential') &&
    tauriLib.includes('assert_eq!(finished, vec![0, 1, 2, 3, 4]'),
  'Rustprobe beobachtet vier blockierte Handler und den fünften Eintritt, Gegenprobe und Aufräumen; Quellprüfung ersetzt keinen Laufzeitnachweis');
for (const route of ['/quote', '/search', '/chart']) assert(tauriLib.includes(`"${route}" =>`), `Proxyroute bleibt erhalten: ${route}`);
assert(tauriLib.includes('Method::Options') && tauriLib.includes('StatusCode(204)') && tauriLib.includes('yahoo_proxy_cors_query_and_errors_keep_contract'),
  'Preflight-, CORS- und Fehlerverträge bleiben am gemeinsamen Routenhandler');

console.log('✅ Tauri CSP tests passed');
for (const command of ['get_app_data_directory', 'open_app_data_directory']) {
    assert(tauriLib.includes(`fn ${command}(app: tauri::AppHandle)`), 'Ordnerkommando akzeptiert ausschließlich injizierten AppHandle: ' + command);
    assert(tauriLib.slice(tauriLib.indexOf('.invoke_handler')).includes(command), 'Enges Ordnerkommando ist registriert: ' + command);
}
assert(tauriLib.includes('Command::new("explorer.exe")') && tauriLib.includes('command.arg(directory)'), 'Explorer erhält genau ein natives Ordnerargument ohne Shellstring');
assert(tauriLib.includes('app_directory_commands_have_only_injected_app_handle') && tauriLib.includes('app_directory_command_keeps_one_argument_without_shell'), 'Rust-Laufzeitproben prüfen Befehls- und Argumentgrenze; Cargo bleibt separates Gate');
