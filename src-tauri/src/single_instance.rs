//! ES-1: Je Kennung (Datenbereich) läuft höchstens eine App. Ein zweiter Start holt das
//! offene Fenster nach vorn und endet, bevor er ein eigenes Fenster öffnet.
//!
//! Nur Standardbibliothek, keine zusätzliche Abhängigkeit: Unter Windows hält die erste
//! Instanz eine Sperrdatei ohne Schreibfreigabe offen. Das System gibt sie beim Prozessende
//! frei, auch nach einem Absturz. In der Datei stehen Port und Kennwort eines Weckdienstes
//! auf 127.0.0.1. Ohne prüfbare Sperre (anderes System, Datei nicht anlegbar) startet die
//! App wie bisher.

use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const WAKE_REPLY: &str = "wach";
const CONNECT_TIMEOUT: Duration = Duration::from_millis(500);
const REPLY_TIMEOUT: Duration = Duration::from_millis(1500);
const RETRY_INTERVAL: Duration = Duration::from_millis(250);
// Rund fünf Sekunden: Eine gerade schließende Instanz gibt die Sperre in dieser Zeit frei.
const RETRY_COUNT: u32 = 20;

#[derive(Debug)]
pub enum InstanceStart {
  /// Diese Instanz besitzt die Sperre und startet.
  First(InstanceLock),
  /// Eine andere Instanz derselben Kennung läuft; sie wurde geweckt oder ist gerade nicht erreichbar.
  Second,
  /// Sperre nicht prüfbar: bisheriges Verhalten.
  Unchecked,
}

#[derive(Debug)]
pub struct InstanceLock {
  file: File,
  listener: Option<TcpListener>,
  token: String,
}

impl InstanceLock {
  fn publish(mut file: File) -> InstanceLock {
    let token = new_token();
    // Ohne Weckdienst bleibt die Sperre wirksam; ein zweiter Start endet dann nach der Wartezeit.
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).ok().filter(|listener| {
      listener.local_addr().map(|address| write_wake_address(&mut file, address.port(), &token).is_ok()).unwrap_or(false)
    });
    InstanceLock { file, listener, token }
  }

  /// Hält die Sperre bis zum Prozessende und weckt bei jedem gültigen Zweitstart.
  pub fn serve<F>(self, on_wake: F)
  where
    F: Fn() + Send + 'static,
  {
    let InstanceLock { file, listener, token } = self;
    // Das System schließt die Datei beim Prozessende und gibt damit die Sperre frei.
    std::mem::forget(file);
    let Some(listener) = listener else { return };
    thread::spawn(move || {
      for stream in listener.incoming() {
        match stream {
          Ok(stream) => { answer_wake(stream, &token, &on_wake); }
          Err(_) => thread::sleep(RETRY_INTERVAL),
        }
      }
    });
  }
}

/// Eine Sperrdatei je Kennung im Temp-Ordner des Nutzers: Prüf- und Produktiv-EXE sperren getrennt.
pub fn lock_path(identifier: &str) -> PathBuf {
  let name: String = identifier
    .chars()
    .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
    .collect();
  std::env::temp_dir().join(format!("{}.instanz.lock", name))
}

/// Erster Start besitzt die Sperre; ein weiterer weckt den ersten oder wartet kurz auf dessen Ende.
pub fn acquire(path: &Path) -> InstanceStart {
  for attempt in 0..RETRY_COUNT {
    match open_exclusive(path) {
      Ok(file) => return InstanceStart::First(InstanceLock::publish(file)),
      Err(error) if held_by_other_instance(&error) => {
        if wake_running_instance(path) {
          return InstanceStart::Second;
        }
      }
      Err(_) => return InstanceStart::Unchecked,
    }
    if attempt + 1 < RETRY_COUNT {
      thread::sleep(RETRY_INTERVAL);
    }
  }
  // Gesperrt, aber nicht erreichbar: lieber kein zweites Fenster auf denselben Daten.
  InstanceStart::Second
}

/// Holt das Hauptfenster der laufenden Instanz nach vorn.
pub fn bring_to_front<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
  use tauri::Manager;
  let window = app.get_webview_window("main").or_else(|| app.webview_windows().into_values().next());
  if let Some(window) = window {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
  }
}

#[cfg(windows)]
fn open_exclusive(path: &Path) -> io::Result<File> {
  use std::os::windows::fs::OpenOptionsExt;
  // Nur Lesen bleibt geteilt: Ein zweiter Start liest Port und Kennwort, kann die Datei aber nicht schreibend öffnen.
  const FILE_SHARE_READ: u32 = 0x0000_0001;
  std::fs::OpenOptions::new().read(true).write(true).create(true).share_mode(FILE_SHARE_READ).open(path)
}

#[cfg(not(windows))]
fn open_exclusive(_path: &Path) -> io::Result<File> {
  Err(io::Error::new(io::ErrorKind::Unsupported, "Startsperre nur unter Windows"))
}

fn held_by_other_instance(error: &io::Error) -> bool {
  // ERROR_SHARING_VIOLATION (32) und ERROR_LOCK_VIOLATION (33).
  cfg!(windows) && matches!(error.raw_os_error(), Some(32) | Some(33))
}

#[cfg(windows)]
fn allow_foreground_handoff() {
  #[link(name = "user32")]
  extern "system" {
    fn AllowSetForegroundWindow(process_id: u32) -> i32;
  }
  const ASFW_ANY: u32 = u32::MAX;
  // Der gerade vom Nutzer gestartete Prozess gibt das Recht auf den Vordergrund an die laufende Instanz weiter.
  unsafe {
    AllowSetForegroundWindow(ASFW_ANY);
  }
}

#[cfg(not(windows))]
fn allow_foreground_handoff() {}

fn new_token() -> String {
  use std::collections::hash_map::RandomState;
  use std::hash::{BuildHasher, Hasher};
  let mut hasher = RandomState::new().build_hasher();
  hasher.write_u32(std::process::id());
  hasher.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_nanos()).unwrap_or(0));
  format!("{:016x}", hasher.finish())
}

fn write_wake_address(file: &mut File, port: u16, token: &str) -> io::Result<()> {
  file.set_len(0)?;
  file.write_all(format!("{}\n{}\n", port, token).as_bytes())?;
  file.sync_all()
}

fn parse_wake_address(text: &str) -> Option<(u16, String)> {
  let mut lines = text.lines();
  let port = lines.next()?.trim().parse::<u16>().ok().filter(|port| *port != 0)?;
  let token = lines.next()?.trim();
  (!token.is_empty() && token.bytes().all(|byte| byte.is_ascii_hexdigit())).then(|| (port, token.to_string()))
}

fn wake_running_instance(path: &Path) -> bool {
  // Direkt nach dem Öffnen der Sperre kann die Datei noch leer sein; der nächste Versuch liest erneut.
  let Some((port, token)) = fs::read_to_string(path).ok().and_then(|text| parse_wake_address(&text)) else {
    return false;
  };
  allow_foreground_handoff();
  send_wake(port, &token)
}

fn send_wake(port: u16, token: &str) -> bool {
  let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
  let Ok(mut stream) = TcpStream::connect_timeout(&address, CONNECT_TIMEOUT) else {
    return false;
  };
  let _ = stream.set_read_timeout(Some(REPLY_TIMEOUT));
  if stream.write_all(format!("{}\n", token).as_bytes()).is_err() {
    return false;
  }
  let mut reply = String::new();
  BufReader::new(stream.take(64)).read_line(&mut reply).is_ok() && reply.trim_end() == WAKE_REPLY
}

// Erst wecken, dann antworten: Der zweite Start endet erst, wenn das Fenster den Auftrag hat.
fn answer_wake(mut stream: TcpStream, token: &str, on_wake: &dyn Fn()) -> bool {
  let _ = stream.set_read_timeout(Some(REPLY_TIMEOUT));
  let mut line = String::new();
  // Höchstens eine kurze Zeile; fremde Verbindungen bleiben wirkungslos.
  let read = BufReader::new((&stream).take(128)).read_line(&mut line);
  if read.is_err() || line.trim_end() != token {
    return false;
  }
  on_wake();
  let _ = stream.write_all(format!("{}\n", WAKE_REPLY).as_bytes());
  true
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::atomic::{AtomicUsize, Ordering};
  use std::sync::Arc;

  fn test_lock_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("es1-{}-{}.instanz.lock", name, std::process::id()))
  }

  #[test]
  fn instance_lock_path_is_one_file_per_identifier() {
    let release = lock_path("de.vermoegen-ruhestand.suite");
    let develop = lock_path("de.vermoegen-ruhestand.entwicklung");
    assert_ne!(release, develop);
    assert!(release.starts_with(std::env::temp_dir()));
    assert_eq!(lock_path("a/b\\c:d").file_name().unwrap().to_str().unwrap(), "a_b_c_d.instanz.lock");
  }

  #[test]
  fn instance_wake_address_accepts_only_port_and_hex_token() {
    assert_eq!(parse_wake_address("4711\n00ff\n"), Some((4711, "00ff".to_string())));
    assert_eq!(parse_wake_address("4711\r\n00ff\r\n"), Some((4711, "00ff".to_string())));
    assert_eq!(parse_wake_address("0\n00ff\n"), None);
    assert_eq!(parse_wake_address("4711\n"), None);
    assert_eq!(parse_wake_address("4711\nkein kennwort\n"), None);
    assert_eq!(parse_wake_address(""), None);
  }

  #[test]
  fn instance_wake_needs_the_matching_token() {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let port = listener.local_addr().unwrap().port();
    let woken = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&woken);
    let server = thread::spawn(move || {
      let wake = move || {
        counter.fetch_add(1, Ordering::SeqCst);
      };
      (0..2).map(|_| answer_wake(listener.accept().unwrap().0, "00ff", &wake)).collect::<Vec<_>>()
    });
    assert!(!send_wake(port, "abcd"));
    assert!(send_wake(port, "00ff"));
    assert_eq!(server.join().unwrap(), vec![false, true]);
    assert_eq!(woken.load(Ordering::SeqCst), 1);
  }

  #[cfg(windows)]
  #[test]
  fn instance_second_start_wakes_the_first_and_does_not_start() {
    let path = test_lock_path("zweitstart");
    let InstanceStart::First(first) = acquire(&path) else { panic!("Erster Start muss die Sperre erhalten") };
    let woken = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&woken);
    first.serve(move || {
      counter.fetch_add(1, Ordering::SeqCst);
    });
    assert!(matches!(acquire(&path), InstanceStart::Second));
    assert_eq!(woken.load(Ordering::SeqCst), 1);
    assert!(matches!(acquire(&test_lock_path("andere-kennung")), InstanceStart::First(_)));
  }

  #[cfg(windows)]
  #[test]
  fn instance_released_lock_allows_the_next_start() {
    let path = test_lock_path("freigabe");
    let InstanceStart::First(first) = acquire(&path) else { panic!("Erster Start muss die Sperre erhalten") };
    drop(first);
    assert!(matches!(acquire(&path), InstanceStart::First(_)));
  }

  #[cfg(not(windows))]
  #[test]
  fn instance_without_windows_lock_starts_as_before() {
    assert!(matches!(acquire(&test_lock_path("ohne-windows")), InstanceStart::Unchecked));
  }
}
