use std::path::PathBuf;
use std::process::{Command, Child};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// The OAuth client redirects to http://localhost:<frontend port>/callback, so
// the frontend must be reachable on that origin in every mode: dev via the
// Next dev server, release via tauri-plugin-localhost serving the bundled
// export. Ports are flavor-dependent (prod: 8481/8484/9222, dev flavor:
// 8491/8494/9232) — see run(), where the flavor is derived from the bundle
// identifier set by tauri.dev.conf.json.

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

// A prior sidecar can outlive a clean app shutdown — a crash, a force-quit,
// or (before tauri-plugin-single-instance) a second app launch racing the
// first — and leave a zombie still bound to SIDECAR_PORT. Without this, the
// freshly-spawned sidecar fails to bind and immediately exits, and
// sidecar_process_alive reports it as dead with no way to recover short of
// a reboot or manually killing the orphan. Returns true if anything was
// killed, so the caller can give the OS a moment to actually release the port.
fn kill_stale_port_holder(port: u16) -> bool {
  let mut killed_any = false;

  #[cfg(any(target_os = "macos", target_os = "linux"))]
  {
    // -sTCP:LISTEN scopes the match to the listening process — a bare lsof on
    // the port also matches processes merely holding a client connection to it
    // (e.g. Chrome with the helper extension's WebSocket open), which must
    // never be killed.
    if let Ok(output) = Command::new("lsof").args(["-ti", &format!("tcp:{}", port), "-sTCP:LISTEN"]).output() {
      for pid in String::from_utf8_lossy(&output.stdout).lines() {
        let pid = pid.trim();
        if pid.is_empty() {
          continue;
        }
        println!("Killing stale process on port {}: PID {}", port, pid);
        if Command::new("kill").args(["-9", pid]).status().map(|s| s.success()).unwrap_or(false) {
          killed_any = true;
        }
      }
    }
  }

  #[cfg(target_os = "windows")]
  {
    if let Ok(output) = Command::new("netstat").args(["-ano"]).output() {
      let needle = format!(":{}", port);
      for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.contains(&needle) && line.contains("LISTENING") {
          if let Some(pid) = line.split_whitespace().last() {
            println!("Killing stale process on port {}: PID {}", port, pid);
            if Command::new("taskkill").args(["/F", "/PID", pid]).status().map(|s| s.success()).unwrap_or(false) {
              killed_any = true;
            }
          }
        }
      }
    }
  }

  killed_any
}

fn show_main_window(app: &tauri::AppHandle) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.set_focus();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Generate the context up front so the flavor (set via the identifier in
  // tauri.dev.conf.json, merged by `tauri {dev,build} --config`) is known
  // before plugins are registered. The dev flavor shifts every port by +10
  // and uses its own data dir so it can run alongside the installed prod app.
  let context = tauri::generate_context!();
  let dev_flavor = context.config().identifier.ends_with(".dev");
  let frontend_port: u16 = if dev_flavor { 8491 } else { 8481 };
  let sidecar_port: u16 = if dev_flavor { 8494 } else { 8484 };
  let cdp_port: u16 = if dev_flavor { 9232 } else { 9222 };
  let window_title = if dev_flavor { "Lixionary QA Tools Dev" } else { "Lixionary QA Tools" };
  let data_dir_name = if dev_flavor { "AutomationExplorerDev" } else { "AutomationExplorer" };

  #[allow(unused_mut)]
  let mut builder = tauri::Builder::default();

  // Must be the first plugin registered — it needs to intercept before any
  // other startup work (notably spawning the sidecar) runs at all. If
  // another instance is already running, this process hands its launch args
  // to that instance's callback and exits immediately.
  builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    show_main_window(app);
  }));

  #[cfg(not(debug_assertions))]
  {
    builder = builder.plugin(tauri_plugin_localhost::Builder::new(frontend_port).build());
  }

  // The dev flavor never registers the updater — it must not fetch the prod
  // latest.json and replace itself with the production build.
  if !dev_flavor {
    builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
  }

  builder
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      let window_url = if cfg!(debug_assertions) {
        // Resolves to build.devUrl (the Next dev server on the flavor's port)
        WebviewUrl::App("index.html".into())
      } else {
        WebviewUrl::External(
          format!("http://localhost:{}", frontend_port)
            .parse()
            .expect("valid localhost URL"),
        )
      };

      WebviewWindowBuilder::new(app, "main", window_url)
        .title(window_title)
        .inner_size(800.0, 600.0)
        .resizable(true)
        // The native drag-drop handler swallows HTML5 drag events, breaking
        // in-page drag & drop (API Studio palette). We never use Tauri's
        // onDragDropEvent, so hand drags back to the webview.
        .disable_drag_drop_handler()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()?;

      let mut sidecar_child: Option<Child> = None;

      match resolve_sidecar_script(app) {
        Some(sidecar_abs) => {
          if kill_stale_port_holder(sidecar_port) {
            std::thread::sleep(std::time::Duration::from_millis(300));
          }

          println!("Launching local Python sidecar at: {:?}", sidecar_abs);

          // Per-flavor data dir; if document_dir() fails, AE_DATA_DIR is
          // omitted and Python falls back to the prod default path.
          let data_dir = app.path().document_dir().map(|d| d.join(data_dir_name));

          // Spawn using python or fallback to python3, passing the flavor's
          // runtime knobs (bootstrap_sidecar.py inherits and forwards them).
          let spawn = |bin: &str| {
            let mut cmd = Command::new(bin);
            cmd
              .arg("-u")
              .arg(&sidecar_abs)
              .env("SIDECAR_PORT", sidecar_port.to_string())
              .env("AE_CDP_PORT", cdp_port.to_string());
            if let Ok(dir) = &data_dir {
              cmd.env("AE_DATA_DIR", dir);
            }
            cmd.spawn()
          };
          let spawn_res = spawn("python").or_else(|_| spawn("python3"));

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
      match event {
        // macOS: closing the window backgrounds the app (like Postman) rather
        // than quitting it — reopened via the Dock icon (RunEvent::Reopen,
        // below) or a second launch attempt (single-instance, above). Only an
        // actual quit (Cmd+Q / Quit menu) tears the window down for real and
        // reaches the Destroyed branch that kills the sidecar. Windows/Linux
        // keep the original close-quits-the-app behavior — there's no tray
        // icon here, so hiding there would strand the window with no way
        // back short of Task Manager.
        #[cfg(target_os = "macos")]
        tauri::WindowEvent::CloseRequested { api, .. } => {
          api.prevent_close();
          let _ = window.hide();
        }
        tauri::WindowEvent::Destroyed => {
          if let Some(state) = window.try_state::<SidecarState>() {
            let mut lock = state.0.lock().unwrap();
            if let Some(mut child) = lock.take() {
              println!("Terminating local sidecar process (PID: {})...", child.id());
              let _ = child.kill();
            }
          }
        }
        _ => {}
      }
    })
    .invoke_handler(tauri::generate_handler![select_directory, open_external, sidecar_process_alive])
    .build(context)
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      // macOS: clicking the Dock icon while the window is hidden (but the
      // app — and its sidecar — is still running) should bring it back.
      #[cfg(target_os = "macos")]
      if let tauri::RunEvent::Reopen { .. } = event {
        show_main_window(app_handle);
      }
      let _ = (app_handle, &event);
    });
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
