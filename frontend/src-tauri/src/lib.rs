use std::path::PathBuf;
use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// The IAM OAuth client redirects to http://localhost:8481/callback, so the
// frontend must be reachable on that origin in every mode: dev via the Next
// dev server, release via tauri-plugin-localhost serving the bundled export.
const FRONTEND_PORT: u16 = 8481;

struct SidecarState(Mutex<Option<Child>>);

fn resolve_sidecar_script(app: &tauri::App) -> Option<PathBuf> {
  // Dev: repo-relative paths from the working directory
  for p in [
    "backend/bootstrap_sidecar.py",
    "../backend/bootstrap_sidecar.py",
    "../../backend/bootstrap_sidecar.py",
  ] {
    let path = PathBuf::from(p);
    if path.exists() {
      return path.canonicalize().ok().or(Some(path));
    }
  }

  // Bundled: backend/ is shipped as a Tauri resource
  if let Ok(resource_dir) = app.path().resource_dir() {
    let path = resource_dir.join("backend").join("bootstrap_sidecar.py");
    if path.exists() {
      return Some(path);
    }
  }

  None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default();

  #[cfg(not(debug_assertions))]
  {
    builder = builder.plugin(tauri_plugin_localhost::Builder::new(FRONTEND_PORT).build());
  }

  builder
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let window_url = if cfg!(debug_assertions) {
        // Resolves to build.devUrl (the Next dev server on 8481)
        WebviewUrl::App("index.html".into())
      } else {
        WebviewUrl::External(
          format!("http://localhost:{}", FRONTEND_PORT)
            .parse()
            .expect("valid localhost URL"),
        )
      };

      WebviewWindowBuilder::new(app, "main", window_url)
        .title("Lixionary QA Tools")
        .inner_size(800.0, 600.0)
        .resizable(true)
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;

      let mut sidecar_child: Option<Child> = None;

      match resolve_sidecar_script(app) {
        Some(sidecar_abs) => {
          println!("Launching local Python sidecar at: {:?}", sidecar_abs);

          // Spawn using python or fallback to python3
          let spawn_res = Command::new("python")
            .arg("-u")
            .arg(&sidecar_abs)
            .spawn()
            .or_else(|_| {
              Command::new("python3")
                .arg("-u")
                .arg(&sidecar_abs)
                .spawn()
            });

          match spawn_res {
            Ok(child) => {
              println!("Local sidecar started with PID: {}", child.id());
              sidecar_child = Some(child);
            }
            Err(e) => {
              eprintln!("Failed to spawn local python sidecar: {}", e);
            }
          }
        }
        None => {
          eprintln!("Could not locate bootstrap_sidecar.py in dev paths or bundled resources");
        }
      }

      app.manage(SidecarState(Mutex::new(sidecar_child)));

      Ok(())
    })
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::Destroyed = event {
        if let Some(state) = window.try_state::<SidecarState>() {
          let mut lock = state.0.lock().unwrap();
          if let Some(mut child) = lock.take() {
            println!("Terminating local sidecar process (PID: {})...", child.id());
            let _ = child.kill();
          }
        }
      }
    })
    .invoke_handler(tauri::generate_handler![select_directory, open_external, sidecar_process_alive])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

// Used by the frontend's backend-monitoring panel: a successful invoke proves
// the Tauri IPC bridge itself is up, and the returned bool distinguishes the
// sidecar process having crashed from it simply not answering HTTP yet (e.g.
// still running through bootstrap_sidecar.py's first-launch venv/pip/
// playwright-install sequence, which can take minutes).
#[tauri::command]
fn sidecar_process_alive(state: tauri::State<SidecarState>) -> bool {
  let mut lock = state.0.lock().unwrap();
  match lock.as_mut() {
    Some(child) => matches!(child.try_wait(), Ok(None)),
    None => false,
  }
}

#[tauri::command]
fn select_directory() -> Option<String> {
  let folder = rfd::FileDialog::new()
    .set_title("Select Root Directory")
    .pick_folder();
  folder.map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
  // Restrict to http(s) so this command can't be abused to run arbitrary targets
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return Err("Only http(s) URLs can be opened".into());
  }

  #[cfg(target_os = "macos")]
  let res = Command::new("open").arg(&url).spawn();
  #[cfg(target_os = "windows")]
  let res = Command::new("cmd").args(["/C", "start", "", &url]).spawn();
  #[cfg(target_os = "linux")]
  let res = Command::new("xdg-open").arg(&url).spawn();

  res.map(|_| ()).map_err(|e| e.to_string())
}
