// DALI OS desktop shell entry. Wires plugins (single-instance FIRST so it routes
// deep links + focuses the running instance), builds the menu/tray/windows, and
// decides first-run (no keychain token → pairing) vs returning (token → show app
// + start poller). Closing the main window minimizes to tray to keep the poller
// alive; Quit is explicit via the tray/menu.

mod commands;
mod config;
mod deeplink;
mod keychain;
mod menu;
mod nav;
mod notify;
mod pairing;
mod poller;
mod state;
mod tray;
mod updater;
mod window;

use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_deep_link::DeepLinkExt;

use state::{AppState, AuthState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance must be registered first: it routes a second-launch
        // deep link into the running instance and focuses it.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            deeplink::from_argv(app, &argv);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::pairing_start,
            commands::pairing_cancel,
            commands::get_auth_state,
            commands::sign_out,
            commands::open_external,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // Native menu (Edit → clipboard) + tray.
            app.set_menu(menu::build(&handle)?)?;
            tray::install(&handle)?;

            // Pairing window stays built + hidden, ready to show.
            window::build_pairing(&handle)?;

            // Route deep links delivered to the already-running instance.
            {
                let h = handle.clone();
                app.deep_link().on_open_url(move |event| {
                    deeplink::handle_urls(&h, &event.urls());
                });
            }

            // First-run vs returning is decided by keychain-token presence — not
            // by watching the first navigation.
            if keychain::get_token().is_some() {
                app.state::<AppState>().set_auth(AuthState::Authenticated);
                window::show_main(&handle);
                poller::spawn(handle.clone());
            } else {
                app.state::<AppState>().set_auth(AuthState::Unpaired);
                window::show_pairing(&handle);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close = minimize to tray (keeps the background poller alive).
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        // App menu bar actions (menu.rs). Predefined items (Cut/Copy/Quit/…) are
        // handled by macOS directly and need no arm here.
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reload" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.eval("location.reload()");
                }
            }
            "help" => {
                window::navigate_main(app, &config::help_url());
                window::show_main(app);
            }
            "sign-out" => {
                tauri::async_runtime::spawn(commands::do_sign_out(app.clone()));
            }
            "check-update" => {
                tauri::async_runtime::spawn(updater::check_now(app.clone()));
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running DALI OS desktop");
}
