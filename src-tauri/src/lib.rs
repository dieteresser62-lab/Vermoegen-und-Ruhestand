#![cfg_attr(mobile, tauri::mobile_entry_point)]

mod single_instance;

use log::LevelFilter;
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tiny_http::{Header, Method, Response, Server, StatusCode};

const APP_STATE_FILENAME: &str = "ruhestand_suite_data.json";
const SNAPSHOT_STATE_FILENAME: &str = "ruhestand_suite_snapshots.json";
const QUOTE_MAX_AGE_SECONDS: u64 = 7 * 24 * 60 * 60;
const QUOTE_FUTURE_TOLERANCE_SECONDS: u64 = 5 * 60;
const UPSTREAM_TIMEOUT_SECONDS: u64 = 4;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum StateTarget {
  Live,
  Snapshots,
  Spiel,
  SpielSnapshots,
  Control,
  Households,
}

// Kennung, Phase und Freigabe teilen denselben Lock; keine Timerfreigabe
// kann eine bereits bestätigte JS-Übernahme überholen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClosePhase {
  Waiting { deadline_ms: u64 },
  Held,
  Closing { permit: bool },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct CloseAttempt {
  id: u64,
  phase: ClosePhase,
}

#[derive(Default)]
struct CloseProtocol {
  sequence: u64,
  active: Option<CloseAttempt>,
}

#[derive(Debug, PartialEq, Eq)]
enum CloseRequest {
  Allow,
  Block,
  Start(u64),
}

impl CloseProtocol {
  fn page_load_started(&mut self) {
    // Das neue Dokument besitzt keine Reservierung seines Vorgängers.
    // Die Sequenz bleibt erhalten: alte Antworten und Timer sind wirkungslos.
    // Eine bereits atomar reservierte Schließfreigabe muss der folgende
    // CloseRequested-Rückruf noch verbrauchen können (close läuft ohne Lock).
    if self.active.is_some_and(|attempt| !matches!(attempt.phase, ClosePhase::Closing { .. })) {
      self.active = None;
    }
  }

  fn request(&mut self, now_ms: u64) -> CloseRequest {
    if let Some(attempt) = self.active.as_mut() {
      if attempt.phase == (ClosePhase::Closing { permit: true }) {
        attempt.phase = ClosePhase::Closing { permit: false };
        return CloseRequest::Allow;
      }
      return CloseRequest::Block;
    }
    self.sequence += 1;
    let id = self.sequence;
    self.active = Some(CloseAttempt {
      id,
      phase: ClosePhase::Waiting { deadline_ms: now_ms.saturating_add(3000) },
    });
    CloseRequest::Start(id)
  }

  fn hold(&mut self, id: u64, now_ms: u64) -> bool {
    match self.active.as_mut() {
      Some(attempt) if attempt.id == id => match attempt.phase {
        ClosePhase::Waiting { deadline_ms } if now_ms < deadline_ms => {
          attempt.phase = ClosePhase::Held;
          true
        }
        _ => false,
      },
      _ => false,
    }
  }

  fn reject(&mut self, id: u64) -> bool {
    if self.active == Some(CloseAttempt { id, phase: ClosePhase::Held }) {
      self.active = None;
      return true;
    }
    false
  }

  fn allow(&mut self, id: u64) -> bool {
    if self.active == Some(CloseAttempt { id, phase: ClosePhase::Held }) {
      self.active = Some(CloseAttempt { id, phase: ClosePhase::Closing { permit: true } });
      return true;
    }
    false
  }

  fn timeout(&mut self, id: u64, now_ms: u64) -> bool {
    match self.active.as_mut() {
      Some(attempt) if attempt.id == id => match attempt.phase {
        ClosePhase::Waiting { deadline_ms } if now_ms >= deadline_ms => {
          attempt.phase = ClosePhase::Closing { permit: true };
          true
        }
        _ => false,
      },
      _ => false,
    }
  }

  fn close_failed(&mut self, id: u64) {
    if self.active.map(|attempt| attempt.id == id && matches!(attempt.phase, ClosePhase::Closing { .. })).unwrap_or(false) {
      self.active = None;
    }
  }
}

#[derive(Default)]
struct CloseState {
  protocol: Mutex<CloseProtocol>,
}

fn close_clock_ms() -> u64 {
  // Monotone Zeit: Änderungen der Systemuhr verschieben keine Schließfrist.
  static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
  START.get_or_init(std::time::Instant::now).elapsed().as_millis() as u64
}

fn state_filename(target: Option<StateTarget>) -> &'static str {
  match target.unwrap_or(StateTarget::Live) {
    StateTarget::Live => APP_STATE_FILENAME,
    StateTarget::Snapshots => SNAPSHOT_STATE_FILENAME,
    StateTarget::Spiel => "ruhestand_suite_spiel_data.json",
    StateTarget::SpielSnapshots => "ruhestand_suite_spiel_snapshots.json",
    StateTarget::Control => "ruhestand_suite_area_control.json",
    StateTarget::Households => "ruhestand_suite_households.json",
  }
}

// HV-1: weitere Haushalte liegen unter households/<Kennung>/ mit denselben Dateinamen.
// Die Oberfläche liefert nur die Kennung; den Pfad bildet ausschließlich Rust.
fn is_household_id(id: &str) -> bool {
  id.len() == 12 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

fn household_state_directory(root: &Path, target: Option<StateTarget>, household: Option<&str>) -> Result<PathBuf, String> {
  let Some(id) = household else { return Ok(root.to_path_buf()) };
  if !is_household_id(id) { return Err("Ungültige Haushaltskennung.".into()); }
  // HV-2: Haushalt und Spielbereich eines weiteren Haushalts liegen im eigenen Ordner; Steuerung und Verzeichnis nur in der Wurzel.
  if matches!(target.unwrap_or(StateTarget::Live), StateTarget::Control | StateTarget::Households) {
    return Err("Dieses Ziel gehört keinem einzelnen Haushalt.".into());
  }
  Ok(root.join("households").join(id))
}

fn corrupt_state_filename(target: Option<StateTarget>, timestamp: u64) -> String {
  let stem = state_filename(target).trim_end_matches(".json");
  format!("{}.corrupt.{}.json", stem, timestamp)
}

fn app_data_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
  Ok(app_dir)
}

fn app_state_path(app: &tauri::AppHandle, target: Option<StateTarget>, household: Option<&str>) -> Result<PathBuf, String> {
  let directory = household_state_directory(&app_data_directory(app)?, target, household)?;
  fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
  Ok(directory.join(state_filename(target)))
}

fn household_data_directory(app: &tauri::AppHandle, household: Option<&str>) -> Result<PathBuf, String> {
  let directory = household_state_directory(&app_data_directory(app)?, None, household)?;
  fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
  Ok(directory)
}

// Festes Programm und genau ein natives Ordnerargument, niemals ein Shellstring.
fn app_directory_command(directory: &Path) -> Result<Command, String> {
  if !directory.is_absolute() { return Err("App-Datenordner ist nicht absolut.".into()); }
  let mut command = Command::new("explorer.exe");
  command.arg(directory);
  Ok(command)
}

#[tauri::command]
fn get_app_data_directory(app: tauri::AppHandle, household: Option<String>) -> Result<String, String> {
  let directory = household_data_directory(&app, household.as_deref())?;
  directory.to_str().map(String::from).ok_or_else(|| "App-Datenordner ist nicht als Text darstellbar.".into())
}

#[tauri::command]
fn open_app_data_directory(app: tauri::AppHandle, household: Option<String>) -> Result<(), String> {
  let directory = household_data_directory(&app, household.as_deref())?;
  #[cfg(target_os = "windows")]
  {
    app_directory_command(&directory)?.spawn().map_err(|e| e.to_string())?;
    Ok(())
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = directory;
    Err("Ordneröffnung wird nur in der Windows-EXE unterstützt.".into())
  }
}

#[tauri::command]
fn load_app_state(app: tauri::AppHandle, target: Option<StateTarget>, household: Option<String>) -> Result<String, String> {
  let file_path = app_state_path(&app, target, household.as_deref())?;
  let content = load_state_file(&file_path)?;
  // HV-1: Ein vorhandenes, aber leeres Haushaltsverzeichnis ist beschädigt und nicht „fehlend“.
  if matches!(target, Some(StateTarget::Households)) && content.trim().is_empty() && file_path.exists() {
    return Err("Haushaltsverzeichnis ist leer.".into());
  }
  Ok(content)
}

fn load_state_file(file_path: &Path) -> Result<String, String> {
  match fs::read_to_string(file_path) {
    Ok(content) => return Ok(content),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
    Err(error) => return Err(error.to_string()),
  }
  let mut recovery_found = false;
  for recovery in [file_path.with_extension("json.tmp"), file_path.with_extension("json.bak")] {
    let content = match fs::read_to_string(&recovery) {
      Ok(content) => content,
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
      Err(error) => return Err(error.to_string()),
    };
    recovery_found = true;
    // Eine abgebrochene Temporärdatei darf eine vollständige Sicherung nicht verdrängen.
    if !serde_json::from_str::<serde_json::Value>(&content).map(|value| value.is_object()).unwrap_or(false) {
      continue;
    }
    fs::rename(&recovery, file_path).map_err(|e| e.to_string())?;
    return Ok(content);
  }
  if recovery_found {
    return Err("Hauptdatei fehlt; vorhandene Rettungsdateien sind nicht lesbar. Dateien bleiben erhalten.".into());
  }
  Ok(String::new())
}

// HV-4: Prüfung der Verzeichnis-Generation und Schreiben unter einer gemeinsamen Sperre. Eine veraltete Seite
// (oder ein zweites Fenster) kann zwischen ihrer eigenen Prüfung und dem Write nichts mehr schreiben; das
// Verzeichnis selbst wird nur geschrieben, wenn seine Generation noch der erwarteten entspricht.
static STATE_LOCK: Mutex<()> = Mutex::new(());

fn registry_generation(root: &Path) -> Result<u64, String> {
  let content = load_state_file(&root.join(state_filename(Some(StateTarget::Households))))?;
  if content.trim().is_empty() { return Ok(0); }
  let value: serde_json::Value = serde_json::from_str(&content).map_err(|_| "Haushaltsverzeichnis ist nicht lesbar.".to_string())?;
  value.get("generation").and_then(|generation| generation.as_u64()).ok_or_else(|| "Haushaltsverzeichnis ohne Generation.".to_string())
}

// Gemeinsamer Rahmen aller verändernden Zustandsbefehle: Sperre und Generationsprüfung im Prozess.
// Zwei gleichzeitig gestartete EXE-Instanzen sind (wie schon vor den Haushalten) nicht gegeneinander gesperrt (Härtungsliste).
fn with_state_lock<T>(app: &tauri::AppHandle, expected: Option<u64>, action: impl FnOnce(&Path) -> Result<T, String>) -> Result<T, String> {
  let _guard = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
  let root = app_data_directory(app)?;
  check_generation(&root, expected)?;
  action(&root)
}

// Ein Haushalt im Verzeichnis wird nie gelöscht; ein unlesbares Verzeichnis gilt als „vielleicht verzeichnet“.
fn household_is_registered(root: &Path, household: &str) -> bool {
  let path = root.join(state_filename(Some(StateTarget::Households)));
  let content = match load_state_file(&path) { Ok(content) => content, Err(_) => return true };
  // Nur ein sicher fehlendes Verzeichnis heißt „unverzeichnet“; eine vorhandene leere Datei ist beschädigt.
  if content.trim().is_empty() { return path.exists() || path.with_extension("json.tmp").exists() || path.with_extension("json.bak").exists(); }
  match serde_json::from_str::<serde_json::Value>(&content) {
    Ok(value) => value.get("households").and_then(|list| list.as_array())
      .map(|list| list.iter().any(|entry| entry.get("id").and_then(|id| id.as_str()) == Some(household))).unwrap_or(true),
    Err(_) => true,
  }
}

// Spieldaten werden nicht gelöscht, solange die Steuerung einen laufenden Spielbereich nennt (überholter Löschauftrag).
fn play_is_active(root: &Path) -> bool {
  let content = load_state_file(&root.join(state_filename(Some(StateTarget::Control)))).unwrap_or_default();
  serde_json::from_str::<serde_json::Value>(&content).ok()
    .and_then(|value| value.get("activeArea").and_then(|area| area.as_str()).map(|area| area == "spiel")).unwrap_or(false)
}

fn check_generation(root: &Path, expected: Option<u64>) -> Result<(), String> {
  let Some(expected) = expected else { return Ok(()) };
  if registry_generation(root)? != expected {
    return Err("HOUSEHOLD_CONTEXT_CHANGED: Der Haushalt wurde inzwischen gewechselt. Bitte neu laden.".into());
  }
  Ok(())
}

#[tauri::command]
fn save_app_state(app: tauri::AppHandle, content: String, target: Option<StateTarget>, household: Option<String>, expected_generation: Option<u64>) -> Result<(), String> {
  // Wie die übrigen Sperren: nach einer Panik eines anderen Threads weiterarbeiten (kein dauerhaftes Poisoning).
  with_state_lock(&app, expected_generation, |_| {
    let file_path = app_state_path(&app, target, household.as_deref())?;
    save_state_file_with_replace(&file_path, &content, |source, destination| fs::rename(source, destination))
  })
}

// HV-3 Nachcheck: Export eines Haushalts nur lesend – keine Ordneranlage, keine Wiederherstellung aus .tmp/.bak.
#[tauri::command]
fn read_household_state(app: tauri::AppHandle, household: Option<String>) -> Result<String, String> {
  let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let path = household_state_directory(&root, Some(StateTarget::Live), household.as_deref())?.join(APP_STATE_FILENAME);
  match fs::read_to_string(&path) {
    Ok(content) => Ok(content),
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
    Err(error) => Err(error.to_string()),
  }
}

fn save_state_file_with_replace(
  file_path: &Path,
  content: &str,
  replace: impl FnOnce(&Path, &Path) -> std::io::Result<()>,
) -> Result<(), String> {
  // Zuerst einen unterbrochenen Altwrite retten. Erst dann darf .tmp neu entstehen.
  let previous = load_state_file(file_path)?;
  if file_path.exists() && !serde_json::from_str::<serde_json::Value>(&previous).map(|value| value.is_object()).unwrap_or(false) {
    return Err("Hauptdatei ist nicht lesbar; Rettungsdateien bleiben erhalten.".into());
  }
  let tmp_path = file_path.with_extension("json.tmp");
  {
    let mut temporary = fs::File::create(&tmp_path).map_err(|e| e.to_string())?;
    temporary.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    temporary.sync_all().map_err(|e| e.to_string())?;
  }
  // rename ersetzt die Hauptdatei direkt. Bei Fehler bleiben Haupt- und Rettungsdateien erhalten.
  replace(&tmp_path, file_path).map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn quarantine_app_state(app: tauri::AppHandle, target: Option<StateTarget>, household: Option<String>, expected_generation: Option<u64>) -> Result<String, String> {
  with_state_lock(&app, expected_generation, |_| quarantine_state_file(&app, target, household.as_deref()))
}

fn quarantine_state_file(app: &tauri::AppHandle, target: Option<StateTarget>, household: Option<&str>) -> Result<String, String> {
  let file_path = app_state_path(app, target, household)?;
  if !file_path.exists() {
    return Ok(String::new());
  }
  let timestamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_secs();
  let quarantine_path = file_path.with_file_name(corrupt_state_filename(target, timestamp));
  fs::rename(&file_path, &quarantine_path).map_err(|e| e.to_string())?;
  Ok(quarantine_path.to_string_lossy().to_string())
}

// Ausschließlich Spielziele, einschließlich abgebrochener Schreibdateien.
fn delete_play_files(directory: &Path) -> Result<(), String> {
  for target in [StateTarget::Spiel, StateTarget::SpielSnapshots] {
    let path = directory.join(state_filename(Some(target)));
    for file in [path.clone(), path.with_extension("json.tmp"), path.with_extension("json.bak")] {
      match fs::remove_file(file) {
        Ok(()) => {},
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
        Err(error) => return Err(error.to_string()),
      }
    }
  }
  Ok(())
}

#[tauri::command]
fn delete_play_state(app: tauri::AppHandle, household: Option<String>, expected_generation: Option<u64>) -> Result<(), String> {
  with_state_lock(&app, expected_generation, |root| {
    if play_is_active(root) { return Err("HOUSEHOLD_CONTEXT_CHANGED: Inzwischen läuft ein neuer Spielbereich. Bitte neu laden.".into()); }
    delete_play_files(&household_data_directory(&app, household.as_deref())?)
  })
}

// HV-2: endgültiges Löschen eines weiteren Haushalts; Haushalt 1 und die Wurzel sind ausgeschlossen.
fn household_folder_for_delete(root: &Path, household: &str) -> Result<PathBuf, String> {
  let directory = household_state_directory(root, None, Some(household))?;
  if directory == root { return Err("Haushalt 1 lässt sich nicht löschen.".into()); }
  Ok(directory)
}

// Keine Verzeichnisumleitung (Symlink, Junction) an der Löschgrenze; der aufgelöste Pfad muss unter households/ liegen.
fn delete_household_folder(root: &Path, household: &str) -> Result<(), String> {
  let directory = household_folder_for_delete(root, household)?;
  for path in [root.join("households"), directory.clone()] {
    match fs::symlink_metadata(&path) {
      Ok(meta) if meta.file_type().is_symlink() => return Err("Haushaltsordner ist eine Umleitung und wird nicht gelöscht.".into()),
      Ok(meta) if !meta.is_dir() => return Err("Haushaltsordner ist kein Ordner.".into()),
      Ok(_) => {},
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
      Err(error) => return Err(error.to_string()),
    }
  }
  let base = root.join("households").canonicalize().map_err(|e| e.to_string())?;
  let target = directory.canonicalize().map_err(|e| e.to_string())?;
  if target == base || !target.starts_with(&base) || target.parent() != Some(base.as_path()) {
    return Err("Haushaltsordner liegt nicht im App-Datenordner.".into());
  }
  // Der aufgelöste Ordner muss genau diese Kennung tragen (kein zwischenzeitlich eingetauschter Nachbarhaushalt).
  // remove_dir_all folgt keiner Umleitung, die erst danach eingetauscht wird; es entfernt dann nur den Link.
  if target.file_name().and_then(|name| name.to_str()) != Some(household) {
    return Err("Haushaltsordner passt nicht zur Kennung.".into());
  }
  fs::remove_dir_all(&directory).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_household_state(app: tauri::AppHandle, household: String) -> Result<(), String> {
  // Keine Generation: auch der Verlierer einer gleichzeitigen Neuanlage darf seinen unverzeichneten Bereich entfernen.
  with_state_lock(&app, None, |root| {
    if household_is_registered(root, &household) { return Err("Dieser Haushalt steht im Verzeichnis und wird nicht gelöscht.".into()); }
    delete_household_folder(root, &household)
  })
}

#[tauri::command]
fn confirm_app_close(
  window: tauri::Window,
  state: tauri::State<'_, CloseState>,
  attempt_id: String,
  response: String,
) -> Result<bool, String> {
  let id = attempt_id.parse::<u64>().map_err(|e| e.to_string())?;
  let accepted = {
    let mut protocol = state.protocol.lock().map_err(|e| e.to_string())?;
    match response.as_str() {
      "hold" => protocol.hold(id, close_clock_ms()),
      "reject" => protocol.reject(id),
      "allow" => protocol.allow(id),
      _ => return Err("INVALID_CLOSE_RESPONSE".to_string()),
    }
  };
  if accepted && response == "allow" {
    close_reserved_window(&window, &state, id)?;
  }
  Ok(accepted)
}

fn close_reserved_window(window: &tauri::Window, state: &CloseState, id: u64) -> Result<(), String> {
  // Der CloseRequested-Rückruf benötigt denselben Lock: close außerhalb halten.
  if let Err(error) = window.close() {
    state.protocol.lock().unwrap_or_else(|e| e.into_inner()).close_failed(id);
    return Err(error.to_string());
  }
  Ok(())
}

fn allowed_cors_origin(origin: &str) -> &str {
  match origin {
    "null" | "tauri://localhost" | "https://tauri.localhost" | "http://tauri.localhost" => origin,
    o if o.starts_with("http://localhost:") || o.starts_with("http://127.0.0.1:") => o,
    o if o == "http://localhost" || o == "http://127.0.0.1" => o,
    _ => "null",
  }
}

fn build_headers_for_origin(origin: &str) -> Vec<Header> {
  vec![
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
    Header::from_bytes(&b"Access-Control-Allow-Origin"[..], origin.as_bytes()).unwrap(),
    Header::from_bytes(&b"Access-Control-Allow-Methods"[..], &b"GET,OPTIONS"[..]).unwrap(),
    Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap(),
  ]
}

fn get_request_origin(request: &tiny_http::Request) -> String {
  for header in request.headers() {
    if header.field.to_string().eq_ignore_ascii_case("origin") {
      return header.value.as_str().to_string();
    }
  }
  "null".to_string()
}

fn send_json(request: tiny_http::Request, status: u16, payload: serde_json::Value) {
  let origin = get_request_origin(&request);
  let cors = allowed_cors_origin(&origin);
  let body = payload.to_string();
  let mut response = Response::from_string(body)
    .with_status_code(StatusCode(status));
  for header in build_headers_for_origin(cors) {
    response = response.with_header(header);
  }
  let _ = request.respond(response);
}

fn parse_query(query: &str) -> HashMap<String, String> {
  let mut out = HashMap::new();
  for pair in query.split('&') {
    let mut parts = pair.splitn(2, '=');
    if let Some(key) = parts.next() {
      let val = parts.next().unwrap_or("");
      out.insert(urlencoding::decode(key).unwrap_or_else(|_| key.into()).into_owned(),
                 urlencoding::decode(val).unwrap_or_else(|_| val.into()).into_owned());
    }
  }
  out
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct QuoteFailure {
  code: &'static str,
  message: String,
  status: u16,
}

fn quote_failure(code: &'static str, message: impl Into<String>, status: u16) -> QuoteFailure {
  QuoteFailure { code, message: message.into(), status }
}

fn quote_error_payload(error: &QuoteFailure) -> serde_json::Value {
  json!({
    "status": "error",
    "code": error.code,
    "message": error.message,
  })
}

fn send_quote_error(request: tiny_http::Request, error: &QuoteFailure) {
  send_json(request, error.status, quote_error_payload(error));
}

fn normalize_yahoo_symbol(symbol: &str) -> Result<String, QuoteFailure> {
  let normalized = symbol.trim().to_ascii_uppercase();
  let valid = !normalized.is_empty()
    && normalized.len() <= 32
    && normalized.chars().all(|character| {
      character.is_ascii_uppercase()
        || character.is_ascii_digit()
        || matches!(character, '.' | '^' | '=' | '-')
    });
  if !valid || normalized.contains('@') {
    return Err(quote_failure(
      "INVALID_SYMBOL",
      format!("Ungueltiges Yahoo-Symbol: {}", if normalized.is_empty() { "(leer)" } else { &normalized }),
      400,
    ));
  }
  Ok(normalized)
}

fn fetch_json(url: &str) -> Result<serde_json::Value, QuoteFailure> {
  let client = reqwest::blocking::Client::builder()
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
    .timeout(Duration::from_secs(UPSTREAM_TIMEOUT_SECONDS))
    .build()
    .map_err(|e| quote_failure("PROVIDER_UNAVAILABLE", e.to_string(), 502))?;

  let resp = client
    .get(url)
    .header("Accept", "application/json,text/plain,*/*")
    .header("Accept-Language", "en-US,en;q=0.9")
    .send()
    .map_err(|error| {
      if error.is_timeout() {
        quote_failure("PROVIDER_TIMEOUT", "Yahoo-Timeout nach 4000 ms.", 504)
      } else {
        quote_failure("PROVIDER_UNAVAILABLE", error.to_string(), 502)
      }
    })?;

  let status = resp.status().as_u16();
  if !(200..300).contains(&status) {
    return Err(match status {
      404 => quote_failure("SYMBOL_NOT_FOUND", "Yahoo: Symbol nicht gefunden.", 404),
      429 => quote_failure("PROVIDER_RATE_LIMITED", "Yahoo: Abruflimit erreicht.", 429),
      500..=599 => quote_failure("PROVIDER_UNAVAILABLE", format!("Yahoo HTTP {}.", status), 502),
      _ => quote_failure("INVALID_RESPONSE", format!("Yahoo HTTP {}.", status), 502),
    });
  }

  let text = resp.text()
    .map_err(|e| quote_failure("PROVIDER_UNAVAILABLE", e.to_string(), 502))?;
  serde_json::from_str(&text).map_err(|_| quote_failure(
    "INVALID_RESPONSE",
    format!("Ungueltiges JSON von Yahoo: {}", &text[..text.len().min(200)]),
    502,
  ))
}

fn pick_chart_candidate(data: &serde_json::Value) -> serde_json::Value {
  let result = data.pointer("/chart/result/0").unwrap_or(&serde_json::Value::Null);
  let meta = result.get("meta").unwrap_or(&serde_json::Value::Null);
  let mut price = meta.get("regularMarketPrice").and_then(|value| value.as_f64());
  let mut as_of = meta.get("regularMarketTime").and_then(|value| value.as_u64());

  if !price.is_some_and(|value| value.is_finite() && value > 0.0) {
    let closes = result.pointer("/indicators/quote/0/close").and_then(|value| value.as_array());
    let timestamps = result.get("timestamp").and_then(|value| value.as_array());
    if let Some(closes) = closes {
      for index in (0..closes.len()).rev() {
        let candidate = closes[index].as_f64();
        if candidate.is_some_and(|value| value.is_finite() && value > 0.0) {
          price = candidate;
          as_of = timestamps
            .and_then(|values| values.get(index))
            .and_then(|value| value.as_u64());
          break;
        }
      }
    }
  }

  json!({
    "symbol": meta.get("symbol").and_then(|value| value.as_str()),
    "price": price,
    "currency": meta.get("currency").and_then(|value| value.as_str()),
    "asOf": as_of,
    "source": "yahoo-chart",
  })
}

fn pick_quote_candidate(data: &serde_json::Value) -> serde_json::Value {
  let result = data.pointer("/quoteResponse/result/0").unwrap_or(&serde_json::Value::Null);
  json!({
    "symbol": result.get("symbol").and_then(|value| value.as_str()),
    "price": result.get("regularMarketPrice").and_then(|value| value.as_f64()),
    "currency": result.get("currency").and_then(|value| value.as_str()),
    "asOf": result.get("regularMarketTime").and_then(|value| value.as_u64()),
    "source": "yahoo-quote",
  })
}

fn normalize_provider_quote(
  requested_symbol: &str,
  candidate: &serde_json::Value,
  now_seconds: u64,
) -> Result<serde_json::Value, QuoteFailure> {
  let requested = normalize_yahoo_symbol(requested_symbol)?;
  let raw_response_symbol = candidate.get("symbol").and_then(|value| value.as_str()).unwrap_or("");
  let response_symbol = normalize_yahoo_symbol(raw_response_symbol).map_err(|_| quote_failure(
    "INVALID_RESPONSE", "Yahoo-Antwort enthaelt kein gueltiges Symbol.", 422
  ))?;
  if response_symbol != requested {
    return Err(quote_failure(
      "SYMBOL_MISMATCH",
      format!("Antwortsymbol {} entspricht nicht der Anfrage {}.", response_symbol, requested),
      422,
    ));
  }

  let price = candidate.get("price").and_then(|value| value.as_f64())
    .filter(|value| value.is_finite() && *value > 0.0)
    .ok_or_else(|| quote_failure(
      "INVALID_PRICE", "Yahoo-Antwort enthaelt keinen positiven endlichen Kurs.", 422
    ))?;

  let currency = candidate.get("currency")
    .and_then(|value| value.as_str())
    .unwrap_or("")
    .trim()
    .to_ascii_uppercase();
  if currency.is_empty() {
    return Err(quote_failure(
      "CURRENCY_MISSING", "Yahoo-Antwort enthaelt keine eindeutige Waehrung.", 422
    ));
  }
  if currency != "EUR" {
    return Err(quote_failure(
      "UNSUPPORTED_CURRENCY", format!("Waehrung {} wird nicht unterstuetzt.", currency), 422
    ));
  }

  let as_of = candidate.get("asOf").and_then(|value| value.as_u64()).ok_or_else(|| {
    if candidate.get("asOf").map_or(true, |value| value.is_null()) {
      quote_failure("AS_OF_MISSING", "Yahoo-Antwort enthaelt keinen Kursstichtag.", 422)
    } else {
      quote_failure("INVALID_AS_OF", "Kursstichtag muss eine positive UTC-Unixsekunde sein.", 422)
    }
  })?;
  if as_of == 0 {
    return Err(quote_failure(
      "INVALID_AS_OF", "Kursstichtag muss eine positive UTC-Unixsekunde sein.", 422
    ));
  }
  if as_of > now_seconds.saturating_add(QUOTE_FUTURE_TOLERANCE_SECONDS) {
    return Err(quote_failure(
      "QUOTE_FROM_FUTURE", "Kursstichtag liegt unzulaessig weit in der Zukunft.", 422
    ));
  }
  if now_seconds.saturating_sub(as_of) > QUOTE_MAX_AGE_SECONDS {
    return Err(quote_failure(
      "QUOTE_STALE", "Kurs ist aelter als sieben Kalendertage.", 422
    ));
  }

  let source = candidate.get("source").and_then(|value| value.as_str()).unwrap_or("").trim();
  if source.is_empty() {
    return Err(quote_failure(
      "INVALID_RESPONSE", "Yahoo-Antwort enthaelt keine Kursquelle.", 422
    ));
  }
  Ok(json!({
    "symbol": response_symbol,
    "price": price,
    "currency": currency,
    "asOf": as_of,
    "source": source,
  }))
}

fn should_stop_quote_fallback(error: &QuoteFailure) -> bool {
  matches!(error.code, "UNSUPPORTED_CURRENCY" | "SYMBOL_MISMATCH" | "QUOTE_STALE" | "QUOTE_FROM_FUTURE")
}

fn handle_quote(request: tiny_http::Request, raw_symbol: &str) {
  let symbol = match normalize_yahoo_symbol(raw_symbol) {
    Ok(symbol) => symbol,
    Err(error) => {
      send_quote_error(request, &error);
      return;
    }
  };
  let encoded_symbol = urlencoding::encode(&symbol);
  let attempts: Vec<(String, fn(&serde_json::Value) -> serde_json::Value)> = vec![
    (
      format!("https://query1.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d&lang=en-US&region=US&corsDomain=finance.yahoo.com", encoded_symbol),
      pick_chart_candidate,
    ),
    (
      format!("https://query2.finance.yahoo.com/v8/finance/chart/{}?interval=1d&range=1d&lang=en-US&region=US&corsDomain=finance.yahoo.com", encoded_symbol),
      pick_chart_candidate,
    ),
    (
      format!("https://query1.finance.yahoo.com/v7/finance/quote?symbols={}", encoded_symbol),
      pick_quote_candidate,
    ),
    (
      format!("https://query2.finance.yahoo.com/v7/finance/quote?symbols={}", encoded_symbol),
      pick_quote_candidate,
    ),
  ];
  let now_seconds = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|duration| duration.as_secs())
    .unwrap_or(0);
  let mut last_error = quote_failure("SYMBOL_NOT_FOUND", "Yahoo: Symbol nicht gefunden.", 404);

  for (url, pick_candidate) in attempts {
    match fetch_json(&url).and_then(|data| normalize_provider_quote(&symbol, &pick_candidate(&data), now_seconds)) {
      Ok(quote) => {
        send_json(request, 200, quote);
        return;
      }
      Err(error) => {
        let stop = should_stop_quote_fallback(&error);
        last_error = error;
        if stop { break; }
      }
    }
  }
  send_quote_error(request, &last_error);
}

fn handle_search(request: tiny_http::Request, query: &str) {
  let url = format!("https://query1.finance.yahoo.com/v1/finance/search?q={}", urlencoding::encode(query));
  match fetch_json(&url) {
    Ok(data) => send_json(request, 200, data),
    Err(error) => send_quote_error(request, &error),
  }
}

fn handle_chart(request: tiny_http::Request, symbol: &str, period1: &str, period2: &str, interval: &str) {
  let url = format!(
    "https://query1.finance.yahoo.com/v8/finance/chart/{}?period1={}&period2={}&interval={}&lang=en-US&region=US&corsDomain=finance.yahoo.com",
    urlencoding::encode(symbol), urlencoding::encode(period1), urlencoding::encode(period2), urlencoding::encode(interval)
  );
  match fetch_json(&url) {
    Ok(data) => send_json(request, 200, data),
    Err(error) => send_quote_error(request, &error),
  }
}

fn start_yahoo_proxy() {
  let server = match Server::http("127.0.0.1:8787") {
    Ok(server) => server,
    Err(err) => {
      eprintln!("Yahoo proxy failed to start: {}", err);
      return;
    }
  };

  dispatch_proxy_requests(server.incoming_requests(), handle_proxy_request);
}

// Jede angenommene Anfrage erhält unabhängig von laufenden Handlern einen eigenen Thread.
fn dispatch_proxy_requests<I, F>(requests: I, handler: F)
where
  I: Iterator,
  I::Item: Send + 'static,
  F: Fn(I::Item) + Send + Sync + 'static,
{
  let handler = Arc::new(handler);
  for request in requests {
    let handler = Arc::clone(&handler);
    thread::spawn(move || handler(request));
  }
}

fn handle_proxy_request(request: tiny_http::Request) {
  if request.method() == &Method::Options {
    let origin = get_request_origin(&request);
    let cors = allowed_cors_origin(&origin);
    let mut response = Response::from_string("")
      .with_status_code(StatusCode(204));
    for header in build_headers_for_origin(cors) {
      response = response.with_header(header);
    }
    let _ = request.respond(response);
    return;
  }

  let url = request.url().to_string();
  let mut parts = url.splitn(2, '?');
  let path = parts.next().unwrap_or("");
  let query = parts.next().unwrap_or("");
  let params = parse_query(query);

  match path {
    "/quote" => {
      if let Some(symbol) = params.get("symbol") {
        handle_quote(request, symbol);
      } else {
        send_quote_error(request, &quote_failure("INVALID_SYMBOL", "Yahoo-Symbol fehlt.", 400));
      }
    }
    "/search" => {
      if let Some(q) = params.get("q") {
        handle_search(request, q);
      } else {
        send_quote_error(request, &quote_failure("INVALID_SEARCH_QUERY", "Suchbegriff fehlt.", 400));
      }
    }
    "/chart" => {
      let symbol = params.get("symbol");
      let period1 = params.get("period1");
      let period2 = params.get("period2");
      let interval = params.get("interval").map(String::as_str).unwrap_or("1d");
      if let (Some(symbol), Some(period1), Some(period2)) = (symbol, period1, period2) {
        handle_chart(request, symbol, period1, period2, interval);
      } else {
        send_quote_error(request, &quote_failure("INVALID_CHART_QUERY", "Chart-Parameter fehlen.", 400));
      }
    }
    _ => send_quote_error(request, &quote_failure("NOT_FOUND", "Route nicht gefunden.", 404)),
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let context = tauri::generate_context!();
  // ES-1: Ein zweiter Start derselben Kennung weckt das offene Fenster und endet ohne eigenes Fenster.
  let instance = match single_instance::acquire(&single_instance::lock_path(&context.config().identifier)) {
    single_instance::InstanceStart::Second => return,
    single_instance::InstanceStart::First(lock) => Some(lock),
    single_instance::InstanceStart::Unchecked => None,
  };
  tauri::Builder::default()
    .manage(CloseState::default())
    .on_page_load(|webview, payload| {
      if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
        if let Some(state) = webview.try_state::<CloseState>() {
          state.protocol.lock().unwrap_or_else(|e| e.into_inner()).page_load_started();
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      load_app_state,
      save_app_state,
      quarantine_app_state,
      delete_play_state,
      delete_household_state,
      read_household_state,
      get_app_data_directory,
      open_app_data_directory,
      confirm_app_close
    ])
    .setup(move |app| {
      if let Some(lock) = instance {
        let handle = app.handle().clone();
        lock.serve(move || single_instance::bring_to_front(&handle));
      }
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(LevelFilter::Info)
            .build(),
        )?;
      }

      thread::spawn(start_yahoo_proxy);
      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let Some(state) = window.try_state::<CloseState>() else {
          api.prevent_close();
          return;
        };
        let request = state.protocol.lock().unwrap_or_else(|e| e.into_inner()).request(close_clock_ms());
        let id = match request {
          CloseRequest::Allow => return,
          CloseRequest::Block => { api.prevent_close(); return; }
          CloseRequest::Start(id) => id,
        };
        api.prevent_close();
        let _ = window.emit("ruhestand://close-requested", json!({ "attemptId": id.to_string() }));
        let fallback_window = window.clone();
        thread::spawn(move || {
          thread::sleep(Duration::from_secs(3));
          if let Some(state) = fallback_window.try_state::<CloseState>() {
            let reserved = state.protocol.lock().unwrap_or_else(|e| e.into_inner()).timeout(id, close_clock_ms());
            if reserved {
              let _ = close_reserved_window(&fallback_window, &state, id);
            }
          }
        });
      }
    })
    .run(context)
    .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn household_paths_stay_under_their_own_folder_and_first_household_keeps_the_root() {
    let root = Path::new("C:/daten");
    assert_eq!(household_state_directory(root, Some(StateTarget::Live), None).unwrap(), root.to_path_buf());
    assert_eq!(household_state_directory(root, Some(StateTarget::Households), None).unwrap(), root.to_path_buf());
    let own = household_state_directory(root, Some(StateTarget::Snapshots), Some("abc123def456")).unwrap();
    assert_eq!(own, root.join("households").join("abc123def456"));
    assert_eq!(state_filename(Some(StateTarget::Live)), APP_STATE_FILENAME);
    for bad in ["", "..", "../x", "ABC123DEF456", "abc123def45", "abc123def4567", "abc/23def456", "abc\\23def456", "abc123def45.", "abc 23def456"] {
      assert!(household_state_directory(root, None, Some(bad)).is_err(), "{bad}");
    }
    for shared in [StateTarget::Control, StateTarget::Households] {
      assert!(household_state_directory(root, Some(shared), Some("abc123def456")).is_err());
    }
    for own in [StateTarget::Spiel, StateTarget::SpielSnapshots] {
      assert_eq!(household_state_directory(root, Some(own), Some("abc123def456")).unwrap(), root.join("households").join("abc123def456"));
    }
    assert_eq!(household_folder_for_delete(root, "abc123def456").unwrap(), root.join("households").join("abc123def456"));
    for bad in ["", "..", "../x", "abc123def45"] { assert!(household_folder_for_delete(root, bad).is_err(), "{bad}"); }
  }

  #[test]
  fn generation_check_blocks_stale_writes_and_accepts_the_current_generation() {
    let files = StateFiles::new();
    let root = files.0.as_path();
    assert!(check_generation(root, None).is_ok());
    assert!(check_generation(root, Some(0)).is_ok(), "ohne Verzeichnis gilt Generation 0");
    assert!(check_generation(root, Some(1)).is_err());
    fs::write(root.join(state_filename(Some(StateTarget::Households))), r#"{"version":1,"active":"h1","generation":7,"households":[]}"#).unwrap();
    assert!(check_generation(root, Some(7)).is_ok());
    assert!(check_generation(root, Some(6)).unwrap_err().starts_with("HOUSEHOLD_CONTEXT_CHANGED"));
    fs::write(root.join(state_filename(Some(StateTarget::Households))), "{kaputt").unwrap();
    assert!(check_generation(root, Some(7)).is_err());
  }

  #[test]
  fn registered_households_and_running_play_areas_are_protected() {
    let files = StateFiles::new();
    let root = files.0.as_path();
    assert!(!household_is_registered(root, "abc123def456"), "ohne Verzeichnis nicht verzeichnet");
    fs::write(root.join(state_filename(Some(StateTarget::Households))), r#"{"version":1,"active":"h1","generation":2,"households":[{"id":"h1"},{"id":"abc123def456"}]}"#).unwrap();
    assert!(household_is_registered(root, "abc123def456"));
    assert!(!household_is_registered(root, "zzz999yyy888"));
    fs::write(root.join(state_filename(Some(StateTarget::Households))), "{kaputt").unwrap();
    assert!(household_is_registered(root, "zzz999yyy888"), "unlesbares Verzeichnis: im Zweifel nichts löschen");
    fs::write(root.join(state_filename(Some(StateTarget::Households))), "  ").unwrap();
    assert!(household_is_registered(root, "zzz999yyy888"), "vorhandenes leeres Verzeichnis: im Zweifel nichts löschen");
    assert!(!play_is_active(root));
    fs::write(root.join(state_filename(Some(StateTarget::Control))), r#"{"version":1,"activeArea":"spiel"}"#).unwrap();
    assert!(play_is_active(root));
  }

  #[test]
  fn household_delete_removes_only_its_own_folder() {
    let files = StateFiles::new();
    let root = files.0.as_path();
    fs::write(root.join(APP_STATE_FILENAME), "{}").unwrap();
    let own = root.join("households").join("abc123def456");
    let other = root.join("households").join("zzz999yyy888");
    fs::create_dir_all(&own).unwrap();
    fs::create_dir_all(&other).unwrap();
    fs::write(own.join(APP_STATE_FILENAME), "{}").unwrap();
    fs::write(other.join(APP_STATE_FILENAME), "{}").unwrap();
    delete_household_folder(root, "abc123def456").unwrap();
    assert!(!own.exists());
    assert!(other.join(APP_STATE_FILENAME).exists());
    assert!(root.join(APP_STATE_FILENAME).exists());
    assert!(delete_household_folder(root, "abc123def456").is_ok(), "fehlender Ordner ist kein Fehler");
    assert!(delete_household_folder(root, "../households").is_err());
    fs::write(root.join("households").join("fff000fff000"), "keine Datei als Haushalt").unwrap();
    assert!(delete_household_folder(root, "fff000fff000").is_err());
  }

  struct StateFiles(PathBuf);
  impl StateFiles {
    fn new() -> Self {
      static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
      let sequence = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
      let path = std::env::temp_dir().join(format!("qs-a-{}-{}-{}", std::process::id(), close_clock_ms(), sequence));
      fs::create_dir_all(&path).unwrap();
      Self(path)
    }
  }
  impl Drop for StateFiles {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
  }

  #[test]
  fn state_replace_keeps_main_until_atomic_rename_for_every_target() {
    let files = StateFiles::new();
    for target in [StateTarget::Live, StateTarget::Snapshots, StateTarget::Spiel, StateTarget::SpielSnapshots, StateTarget::Control, StateTarget::Households] {
      let path = files.0.join(state_filename(Some(target)));
      fs::write(&path, r#"{"cash":30000}"#).unwrap();
      fs::write(path.with_extension("json.bak"), r#"{"cash":29000}"#).unwrap();
      save_state_file_with_replace(&path, r#"{"cash":31000}"#, |source, destination| {
        assert_eq!(fs::read_to_string(destination).unwrap(), r#"{"cash":30000}"#);
        assert_eq!(fs::read_to_string(source).unwrap(), r#"{"cash":31000}"#);
        fs::rename(source, destination)
      }).unwrap();
      assert_eq!(load_state_file(&path).unwrap(), r#"{"cash":31000}"#);
      assert_eq!(fs::read_to_string(path.with_extension("json.bak")).unwrap(), r#"{"cash":29000}"#);
    }
  }

  #[test]
  fn state_recovers_old_crash_window_and_partial_temporary_file() {
    let files = StateFiles::new();
    let path = files.0.join(APP_STATE_FILENAME);
    assert_eq!(load_state_file(&path).unwrap(), "");
    fs::write(path.with_extension("json.bak"), r#"{"cash":30000}"#).unwrap();
    fs::write(path.with_extension("json.tmp"), r#"{"cash":31000}"#).unwrap();
    assert_eq!(load_state_file(&path).unwrap(), r#"{"cash":31000}"#);
    fs::remove_file(&path).unwrap();
    fs::write(path.with_extension("json.tmp"), r#"{"cash":"#).unwrap();
    assert_eq!(load_state_file(&path).unwrap(), r#"{"cash":30000}"#);
    assert_eq!(fs::read_to_string(path.with_extension("json.tmp")).unwrap(), r#"{"cash":"#);
  }

  #[test]
  fn failed_state_replace_preserves_main_and_rescue_bytes() {
    let files = StateFiles::new();
    let path = files.0.join(APP_STATE_FILENAME);
    fs::write(&path, r#"{"cash":30000}"#).unwrap();
    let failed = save_state_file_with_replace(&path, r#"{"cash":31000}"#, |_, _| {
      Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "synthetic rename failure"))
    });
    assert!(failed.is_err());
    assert_eq!(load_state_file(&path).unwrap(), r#"{"cash":30000}"#);
    assert_eq!(fs::read_to_string(path.with_extension("json.tmp")).unwrap(), r#"{"cash":31000}"#);
    // Fehlende Hauptdatei: die letzte vollständige Rettung steht vor jedem neuen Write sicher.
    fs::remove_file(&path).unwrap();
    let failed = save_state_file_with_replace(&path, r#"{"cash":32000}"#, |_, _| {
      Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "synthetic rename failure"))
    });
    assert!(failed.is_err());
    assert_eq!(load_state_file(&path).unwrap(), r#"{"cash":31000}"#);
  }

  #[test]
  fn unreadable_rescue_is_never_replaced_by_empty_first_start() {
    let files = StateFiles::new();
    let path = files.0.join(APP_STATE_FILENAME);
    fs::write(path.with_extension("json.tmp"), "unfinished").unwrap();
    fs::write(path.with_extension("json.bak"), "also unfinished").unwrap();
    assert!(load_state_file(&path).is_err());
    assert!(save_state_file_with_replace(&path, "{}", |source, destination| fs::rename(source, destination)).is_err());
    assert_eq!(fs::read_to_string(path.with_extension("json.tmp")).unwrap(), "unfinished");
    assert_eq!(fs::read_to_string(path.with_extension("json.bak")).unwrap(), "also unfinished");
    fs::write(&path, "corrupt main").unwrap();
    fs::write(path.with_extension("json.tmp"), r#"{"cash":30000}"#).unwrap();
    assert!(save_state_file_with_replace(&path, "{}", |source, destination| fs::rename(source, destination)).is_err());
    assert_eq!(fs::read_to_string(path.with_extension("json.tmp")).unwrap(), r#"{"cash":30000}"#);
  }

  #[test]
  fn yahoo_proxy_dispatcher_overlaps_handlers_and_rejects_sequential_control() {
    use std::sync::{mpsc, Condvar};
    use std::time::Instant;
    let probe = |sequential| {
      let timeout = Duration::from_secs(2);
      let (input_tx, input_rx) = mpsc::channel();
      let (entered_tx, entered_rx) = mpsc::channel();
      let (finished_tx, finished_rx) = mpsc::channel();
      let (dispatched_tx, dispatched_rx) = mpsc::channel();
      // Freigabe und Zahl noch blockierter Handler werden unter demselben Lock beobachtet.
      let gate = Arc::new((Mutex::new((false, 0usize)), Condvar::new()));
      let handler_gate = Arc::clone(&gate);
      let handler = Arc::new(move |id: usize| {
        let (lock, release) = &*handler_gate;
        let mut state = lock.lock().unwrap_or_else(|e| e.into_inner());
        state.1 += 1;
        let _ = entered_tx.send((id, state.1));
        while !state.0 {
          state = release.wait(state).unwrap_or_else(|e| e.into_inner());
        }
        state.1 -= 1;
        drop(state);
        let _ = finished_tx.send(id);
      });
      let dispatch = thread::spawn(move || {
        if sequential {
          for request in input_rx { handler(request); }
        } else {
          dispatch_proxy_requests(input_rx.into_iter(), move |request| handler(request));
        }
        let _ = dispatched_tx.send(());
      });
      let first_four_sent = (0..4).all(|id| input_tx.send(id).is_ok());
      let deadline = Instant::now() + timeout;
      let mut entered = Vec::new();
      for _ in 0..4 {
        match entered_rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
          Ok((id, _)) => entered.push(id),
          Err(_) => break,
        }
      }
      entered.sort_unstable();
      let four_blocked = entered == vec![0, 1, 2, 3]
        && first_four_sent && gate.0.lock().unwrap_or_else(|e| e.into_inner()).1 == 4;
      // Auch die Gegenprobe bekommt alle fünf Items; Freigabe erfolgt erst nach Beobachtung.
      let fifth_sent = input_tx.send(4).is_ok();
      let fifth_entered = fifth_sent && matches!(entered_rx.recv_timeout(timeout), Ok((4, 5)));
      let before_release = {
        let state = gate.0.lock().unwrap_or_else(|e| e.into_inner());
        !state.0 && state.1 == 5
      };

      // Kein Assert vor dem Aufräumen, auch bei fehlender Vier-/Fünft-Handler-Beobachtung.
      gate.0.lock().unwrap_or_else(|e| e.into_inner()).0 = true;
      gate.1.notify_all();
      drop(input_tx);
      let deadline = Instant::now() + timeout;
      let mut finished = Vec::new();
      for _ in 0..5 {
        match finished_rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
          Ok(id) => finished.push(id),
          Err(_) => break,
        }
      }
      let dispatched = dispatched_rx.recv_timeout(timeout).is_ok();
      if dispatched { dispatch.join().unwrap(); }
      finished.sort_unstable();
      assert_eq!(finished, vec![0, 1, 2, 3, 4], "Alle Handler müssen nach Freigabe enden");
      assert!(dispatched, "Der Dispatcher muss nach Schließen des Inputs enden");
      assert_eq!(gate.0.lock().unwrap_or_else(|e| e.into_inner()).1, 0);
      four_blocked && fifth_entered && before_release
    };
    let parallel = probe(false);
    let sequential = probe(true);
    assert!(parallel, "Die fünfte Anfrage muss bei vier blockierten Handlern eintreten");
    assert!(!sequential, "Sequentielle Mutation muss dieselbe Vier-plus-eins-Probe verfehlen");
  }

  #[test]
  fn yahoo_proxy_cors_query_and_errors_keep_contract() {
    for origin in ["null", "tauri://localhost", "https://tauri.localhost", "http://localhost:8080", "http://127.0.0.1:8080"] {
      assert_eq!(allowed_cors_origin(origin), origin);
      let headers = build_headers_for_origin(origin);
      assert!(headers.iter().any(|header| header.field.to_string() == "Access-Control-Allow-Origin" && header.value.as_str() == origin));
    }
    assert_eq!(allowed_cors_origin("https://example.invalid"), "null");
    assert_eq!(parse_query("symbol=VWCE%2EDE").get("symbol").unwrap(), "VWCE.DE");
    let error = quote_failure("NOT_FOUND", "Route nicht gefunden.", 404);
    assert_eq!(quote_error_payload(&error), json!({ "status": "error", "code": "NOT_FOUND", "message": "Route nicht gefunden." }));
  }

  #[test]
  fn yahoo_proxy_routes_preflight_and_errors_use_parallel_dispatcher() {
    let server = Server::http("127.0.0.1:0").unwrap();
    let address = server.server_addr().to_ip().unwrap();
    let serving = thread::spawn(move || {
      dispatch_proxy_requests(server.incoming_requests().take(5), handle_proxy_request);
    });
    let client = reqwest::blocking::Client::builder().timeout(Duration::from_secs(2)).build().unwrap();
    for (route, status, code) in [
      ("/quote?symbol=BAD%40GER", 400, "INVALID_SYMBOL"),
      ("/search", 400, "INVALID_SEARCH_QUERY"),
      ("/chart?symbol=VWCE.DE", 400, "INVALID_CHART_QUERY"),
      ("/unknown", 404, "NOT_FOUND"),
    ] {
      let response = client.get(format!("http://{}{}", address, route))
        .header("Origin", "tauri://localhost").send().unwrap();
      assert_eq!(response.status().as_u16(), status);
      assert_eq!(response.headers().get("Access-Control-Allow-Origin").unwrap(), "tauri://localhost");
      assert_eq!(response.headers().get("Access-Control-Allow-Methods").unwrap(), "GET,OPTIONS");
      assert_eq!(response.headers().get("Access-Control-Allow-Headers").unwrap(), "Content-Type");
      assert_eq!(response.headers().get("Content-Type").unwrap(), "application/json");
      let payload: serde_json::Value = response.json().unwrap();
      assert_eq!(payload["status"], "error");
      assert_eq!(payload["code"], code);
      assert!(payload["message"].as_str().is_some_and(|message| !message.is_empty()));
    }
    let response = client.request(reqwest::Method::OPTIONS, format!("http://{}/quote", address))
      .header("Origin", "https://example.invalid").send().unwrap();
    assert_eq!(response.status().as_u16(), 204);
    assert_eq!(response.headers().get("Access-Control-Allow-Origin").unwrap(), "null");
    assert_eq!(response.headers().get("Access-Control-Allow-Methods").unwrap(), "GET,OPTIONS");
    assert_eq!(response.headers().get("Access-Control-Allow-Headers").unwrap(), "Content-Type");
    assert_eq!(response.text().unwrap(), "");
    serving.join().unwrap();
  }

  fn start_close(protocol: &mut CloseProtocol, now: u64) -> u64 {
    match protocol.request(now) {
      CloseRequest::Start(id) => id,
      other => panic!("Kein neuer Versuch: {:?}", other),
    }
  }

  #[test]
  fn close_unclaimed_timeout_is_once_and_not_early() {
    let mut protocol = CloseProtocol::default();
    let id = start_close(&mut protocol, 100);
    assert!(!protocol.timeout(id, 3099));
    assert_eq!(protocol.request(200), CloseRequest::Block);
    assert!(!protocol.allow(id));
    assert!(protocol.timeout(id, 3100));
    assert!(!protocol.hold(id, 3100));
    assert!(!protocol.timeout(id, 9999));
    assert_eq!(protocol.request(3100), CloseRequest::Allow);
    assert_eq!(protocol.request(3101), CloseRequest::Block);
  }

  #[test]
  fn close_hold_and_timeout_both_lock_orders() {
    for hold_first in [true, false] {
      let state = Mutex::new(CloseProtocol::default());
      let id = start_close(&mut state.lock().unwrap(), 0);
      if hold_first {
        assert!(state.lock().unwrap().hold(id, 2999));
        assert!(!state.lock().unwrap().timeout(id, 3000));
        assert!(!state.lock().unwrap().timeout(id, 1_000_000));
        assert_eq!(state.lock().unwrap().request(1_000_000), CloseRequest::Block);
      } else {
        assert!(state.lock().unwrap().timeout(id, 3000));
        assert!(!state.lock().unwrap().hold(id, 2999));
        assert_eq!(state.lock().unwrap().request(3001), CloseRequest::Allow);
      }
    }
    let mut protocol = CloseProtocol::default();
    let id = start_close(&mut protocol, 0);
    assert!(!protocol.hold(id, 3000)); // Auch ein noch nicht aufgewachter Timer schützt die Frist.
    assert!(protocol.timeout(id, 3000));
  }

  #[test]
  fn close_hold_timeout_race_has_exactly_one_winner() {
    use std::sync::{Arc, Barrier};
    for _ in 0..32 {
      let state = Arc::new(Mutex::new(CloseProtocol::default()));
      let id = start_close(&mut state.lock().unwrap(), 0);
      let barrier = Arc::new(Barrier::new(2));
      let held_state = Arc::clone(&state);
      let held_barrier = Arc::clone(&barrier);
      let hold = thread::spawn(move || {
        held_barrier.wait();
        held_state.lock().unwrap().hold(id, 2999)
      });
      barrier.wait();
      let timeout = state.lock().unwrap().timeout(id, 3000);
      assert_ne!(hold.join().unwrap(), timeout);
    }
  }

  #[test]
  fn close_reject_and_old_responses_cannot_release_next_attempt() {
    let mut protocol = CloseProtocol::default();
    let old = start_close(&mut protocol, 0);
    assert!(protocol.hold(old, 0));
    assert!(!protocol.hold(old, 1));
    assert!(protocol.reject(old));
    let next = start_close(&mut protocol, 100);
    assert!(next > old);
    assert!(!protocol.reject(old));
    assert!(!protocol.allow(old));
    assert!(!protocol.timeout(old, 10_000));
    assert!(protocol.hold(next, 101));
    assert!(!protocol.timeout(next, 10_000));
    assert!(protocol.allow(next));
    assert!(!protocol.allow(next));
    assert!(!protocol.reject(next));
    assert_eq!(protocol.request(10_000), CloseRequest::Allow);
    assert_eq!(protocol.request(10_001), CloseRequest::Block);
  }

  #[test]
  fn close_page_load_recovers_held_attempt_without_renderer_reply() {
    let mut protocol = CloseProtocol::default();
    let old = start_close(&mut protocol, 0);
    assert!(protocol.hold(old, 1));
    assert!(!protocol.timeout(old, 1_000_000));
    assert_eq!(protocol.request(1_000_000), CloseRequest::Block);
    protocol.page_load_started(); // Kein reject/allow des alten Renderers.
    let next = start_close(&mut protocol, 1_000_001);
    assert!(next > old);
    assert!(!protocol.hold(old, 1_000_002));
    assert!(!protocol.reject(old));
    assert!(!protocol.allow(old));
    assert!(!protocol.timeout(old, 2_000_000));
    assert!(protocol.hold(next, 1_000_002));
    assert!(!protocol.timeout(next, 2_000_000));
    assert!(protocol.allow(next));
    assert!(!protocol.allow(next));
    assert_eq!(protocol.request(2_000_001), CloseRequest::Allow);
    assert_eq!(protocol.request(2_000_002), CloseRequest::Block);
  }

  #[test]
  fn close_page_load_keeps_already_reserved_close_permission() {
    for held in [false, true] {
      let mut protocol = CloseProtocol::default();
      let id = start_close(&mut protocol, 0);
      if held {
        assert!(protocol.hold(id, 1));
        assert!(protocol.allow(id));
      } else {
        assert!(protocol.timeout(id, 3000));
      }
      protocol.page_load_started();
      assert_eq!(protocol.request(3001), CloseRequest::Allow);
      protocol.page_load_started();
      assert_eq!(protocol.request(3002), CloseRequest::Block);
    }
  }

  #[test]
  fn close_failure_discards_only_its_own_permission() {
    for consume in [false, true] {
      let mut protocol = CloseProtocol::default();
      let old = start_close(&mut protocol, 0);
      assert!(protocol.hold(old, 0));
      assert!(protocol.allow(old));
      if consume { assert_eq!(protocol.request(1), CloseRequest::Allow); }
      protocol.close_failed(old);
      let next = start_close(&mut protocol, 2);
      assert!(protocol.hold(next, 2));
      protocol.close_failed(old);
      assert!(protocol.allow(next));
      assert_eq!(protocol.request(3), CloseRequest::Allow);
    }
  }

  #[test]
  fn cors_origin_allows_tauri_and_local_origins() {
    assert_eq!(allowed_cors_origin("null"), "null");
    assert_eq!(allowed_cors_origin("tauri://localhost"), "tauri://localhost");
    assert_eq!(allowed_cors_origin("https://tauri.localhost"), "https://tauri.localhost");
    assert_eq!(allowed_cors_origin("http://localhost:8000"), "http://localhost:8000");
    assert_eq!(allowed_cors_origin("http://127.0.0.1:8000"), "http://127.0.0.1:8000");
    assert_eq!(allowed_cors_origin("http://localhost"), "http://localhost");
    assert_eq!(allowed_cors_origin("http://127.0.0.1"), "http://127.0.0.1");
  }

  #[test]
  fn cors_origin_rejects_external_origins() {
    assert_eq!(allowed_cors_origin("https://example.com"), "null");
    assert_eq!(allowed_cors_origin("http://192.168.1.10:8000"), "null");
    assert_eq!(allowed_cors_origin("https://localhost.evil.example"), "null");
  }

  #[test]
  fn parse_query_decodes_values_and_empty_params() {
    let params = parse_query("symbol=VWCE.DE&q=hello%20world&empty=");

    assert_eq!(params.get("symbol").map(String::as_str), Some("VWCE.DE"));
    assert_eq!(params.get("q").map(String::as_str), Some("hello world"));
    assert_eq!(params.get("empty").map(String::as_str), Some(""));
  }

  #[test]
  fn quote_extractors_build_complete_candidates_and_normalize_eur() {
    let now = 1_800_000_000;
    let quote = json!({
      "quoteResponse": {
        "result": [
          {
            "symbol": "VWCE.DE",
            "regularMarketPrice": 123.45,
            "currency": "EUR",
            "regularMarketTime": now - 60
          }
        ]
      }
    });
    let normalized_quote = normalize_provider_quote("vwce.de", &pick_quote_candidate(&quote), now).unwrap();
    assert_eq!(normalized_quote.get("symbol").and_then(|value| value.as_str()), Some("VWCE.DE"));
    assert_eq!(normalized_quote.get("price").and_then(|value| value.as_f64()), Some(123.45));
    assert_eq!(normalized_quote.get("currency").and_then(|value| value.as_str()), Some("EUR"));
    assert_eq!(normalized_quote.get("asOf").and_then(|value| value.as_u64()), Some(now - 60));
    assert_eq!(normalized_quote.get("source").and_then(|value| value.as_str()), Some("yahoo-quote"));

    let chart = json!({
      "chart": {
        "result": [
          {
            "meta": {
              "symbol": "VWCE.DE",
              "regularMarketPrice": 0.0,
              "currency": "EUR"
            },
            "timestamp": [now - 180, now - 120, now - 60],
            "indicators": {
              "quote": [
                { "close": [null, 98.7, 101.2] }
              ]
            }
          }
        ]
      }
    });
    let chart_candidate = pick_chart_candidate(&chart);
    assert_eq!(chart_candidate.get("price").and_then(|value| value.as_f64()), Some(101.2));
    assert_eq!(chart_candidate.get("asOf").and_then(|value| value.as_u64()), Some(now - 60));
  }

  #[test]
  fn quote_contract_rejects_foreign_currency_missing_time_and_stale_values() {
    let now = 1_800_000_000;
    for currency in ["USD", "GBP", "GBX"] {
      let candidate = json!({
        "symbol": "VWRL.L",
        "price": 100.0,
        "currency": currency,
        "asOf": now - 60,
        "source": "yahoo-chart"
      });
      let error = normalize_provider_quote("VWRL.L", &candidate, now).unwrap_err();
      assert_eq!(error.code, "UNSUPPORTED_CURRENCY");
      assert!(error.message.contains(currency));
    }

    let missing_time = json!({
      "symbol": "VWCE.DE", "price": 100.0, "currency": "EUR", "source": "yahoo-chart"
    });
    assert_eq!(
      normalize_provider_quote("VWCE.DE", &missing_time, now).unwrap_err().code,
      "AS_OF_MISSING"
    );

    let stale = json!({
      "symbol": "VWCE.DE",
      "price": 100.0,
      "currency": "EUR",
      "asOf": now - QUOTE_MAX_AGE_SECONDS - 1,
      "source": "yahoo-chart"
    });
    assert_eq!(
      normalize_provider_quote("VWCE.DE", &stale, now).unwrap_err().code,
      "QUOTE_STALE"
    );
  }

  #[test]
  fn yahoo_symbol_contract_rejects_exchange_suffixes() {
    assert_eq!(normalize_yahoo_symbol(" vwce.de ").unwrap(), "VWCE.DE");
    assert_eq!(normalize_yahoo_symbol("VWCE@GER").unwrap_err().code, "INVALID_SYMBOL");
  }

  #[test]
  fn app_directory_command_keeps_one_argument_without_shell() {
    let directory = std::env::temp_dir().join("Ruhestand ä & Test (1)");
    let command = app_directory_command(&directory).unwrap();
    assert_eq!(command.get_program(), "explorer.exe");
    assert_eq!(command.get_args().collect::<Vec<_>>(), vec![directory.as_os_str()]);
    assert!(app_directory_command(Path::new("relative/path")).is_err());
  }

  #[test]
  fn app_directory_commands_have_only_injected_app_handle() {
    // Die Funktionszeigertypen erzwingen keine aufrufbaren Zielargumente.
    // HV-1: außer dem AppHandle nur die Haushaltskennung; den Pfad bildet household_state_directory nach Prüfung.
    let _: fn(tauri::AppHandle, Option<String>) -> Result<String, String> = get_app_data_directory;
    let _: fn(tauri::AppHandle, Option<String>) -> Result<(), String> = open_app_data_directory;
  }

  #[test]
  fn state_target_defaults_to_live_file_and_supports_snapshot_file() {
    assert_eq!(state_filename(None), "ruhestand_suite_data.json");
    assert_eq!(state_filename(Some(StateTarget::Live)), "ruhestand_suite_data.json");
    assert_eq!(state_filename(Some(StateTarget::Snapshots)), "ruhestand_suite_snapshots.json");
  }

  #[test]
  fn corrupt_state_filename_uses_target_specific_stem() {
    assert_eq!(
      corrupt_state_filename(None, 123),
      "ruhestand_suite_data.corrupt.123.json"
    );
    assert_eq!(
      corrupt_state_filename(Some(StateTarget::Snapshots), 123),
      "ruhestand_suite_snapshots.corrupt.123.json"
    );
  }
  #[test]
  fn play_targets_and_quarantine_are_separate() {
    assert_eq!(state_filename(Some(StateTarget::Spiel)), "ruhestand_suite_spiel_data.json");
    assert_eq!(state_filename(Some(StateTarget::SpielSnapshots)), "ruhestand_suite_spiel_snapshots.json");
    assert_eq!(state_filename(Some(StateTarget::Control)), "ruhestand_suite_area_control.json");
    for (name, target) in [("spiel", StateTarget::Spiel), ("spielsnapshots", StateTarget::SpielSnapshots), ("control", StateTarget::Control)] {
      assert_eq!(serde_json::from_str::<StateTarget>(&format!("\"{}\"", name)).unwrap(), target);
      assert!(corrupt_state_filename(Some(target), 123).contains(".corrupt.123.json"));
      assert_ne!(corrupt_state_filename(Some(target), 123), corrupt_state_filename(None, 123));
    }
  }

  #[test]
  fn deleting_play_files_preserves_real_files_and_metadata() {
    let directory = std::env::temp_dir().join(format!("rs-play-test-{}-{}", std::process::id(), close_clock_ms()));
    fs::create_dir_all(&directory).unwrap();
    let real = directory.join(APP_STATE_FILENAME);
    let snapshots = directory.join(SNAPSHOT_STATE_FILENAME);
    fs::write(&real, b"real data").unwrap();
    fs::write(&snapshots, b"real snapshots").unwrap();
    let modified = fs::metadata(&real).unwrap().modified().unwrap();
    for target in [StateTarget::Spiel, StateTarget::SpielSnapshots] {
      let path = directory.join(state_filename(Some(target)));
      fs::write(&path, b"play").unwrap();
      fs::write(path.with_extension("json.tmp"), b"partial").unwrap();
    }
    delete_play_files(&directory).unwrap();
    delete_play_files(&directory).unwrap();
    assert_eq!(fs::read(&real).unwrap(), b"real data");
    assert_eq!(fs::read(&snapshots).unwrap(), b"real snapshots");
    assert_eq!(fs::metadata(&real).unwrap().modified().unwrap(), modified);
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 2);
    fs::remove_dir_all(directory).unwrap();
  }

}
