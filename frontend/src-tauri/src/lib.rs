use std::process::{Command, Child};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

struct SidecarState(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Resolve sidecar script path
      let mut sidecar_path = PathBuf::from("backend/bootstrap_sidecar.py");
      if !sidecar_path.exists() {
        sidecar_path = PathBuf::from("../backend/bootstrap_sidecar.py");
      }
      if !sidecar_path.exists() {
        sidecar_path = PathBuf::from("../../backend/bootstrap_sidecar.py");
      }

      let mut sidecar_child: Option<Child> = None;

      if sidecar_path.exists() {
        let sidecar_abs = sidecar_path.canonicalize().unwrap_or(sidecar_path);
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
      } else {
        eprintln!("Could not locate local_sidecar.py in ./backend or ../backend");
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
