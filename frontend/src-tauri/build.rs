fn main() {
  // Generate allow-/deny- permissions for the app's own commands. Without an
  // app ACL manifest, custom commands are unreachable from remote origins —
  // and in release builds the frontend is served from http://localhost:8481
  // (tauri-plugin-localhost), which Tauri classifies as remote.
  tauri_build::try_build(
    tauri_build::Attributes::new().app_manifest(
      tauri_build::AppManifest::new().commands(&["select_directory", "open_external", "sidecar_process_alive"]),
    ),
  )
  .expect("failed to run tauri-build");
}
