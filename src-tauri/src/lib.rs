use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, LogicalPosition, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;

pub mod import_package;
mod state_repository;

const POPUP_WIDTH: f64 = 560.0;
const POPUP_HEIGHT: f64 = 520.0;
const POPUP_MARGIN_X: f64 = 22.0;
const POPUP_MARGIN_Y: f64 = 72.0;
const FLOATING_WIDTH: f64 = 52.0;
const FLOATING_HEIGHT: f64 = 52.0;
const FLOATING_MARGIN: f64 = 18.0;
const WINDOW_GAP: f64 = 0.0;
const WINDOW_SAFE_MARGIN: f64 = 12.0;
const POPUP_HEADER_CENTER: f64 = 25.0;

#[cfg(windows)]
#[link(name = "gdi32")]
extern "system" {
    fn CreateRoundRectRgn(
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
        ellipse_width: i32,
        ellipse_height: i32,
    ) -> *mut std::ffi::c_void;
    fn DeleteObject(object: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn SetWindowRgn(
        window: *mut std::ffi::c_void,
        region: *mut std::ffi::c_void,
        redraw: i32,
    ) -> i32;
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PopupAnchor {
    rect: (f64, f64, f64, f64),
    monitor: (f64, f64, f64, f64),
    scale: f64,
}

#[derive(Default)]
struct WindowCoordinatorState {
    floating_requested: bool,
    popup_anchor: Option<PopupAnchor>,
}

impl WindowCoordinatorState {
    fn request_floating(&mut self, requested: bool) {
        self.floating_requested = requested;
    }

    fn begin_popup(&mut self, anchor: Option<PopupAnchor>) {
        self.popup_anchor = anchor;
    }

    fn finish_popup(&mut self) -> (bool, Option<PopupAnchor>) {
        (self.floating_requested, self.popup_anchor.take())
    }
}

#[derive(Default)]
struct WindowCoordinator(Mutex<WindowCoordinatorState>);

fn clamp_axis(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum.max(minimum))
}

fn floating_content_rect(
    outer_position: (f64, f64),
    outer_size: (f64, f64),
    scale: f64,
) -> (f64, f64, f64, f64) {
    let width = (FLOATING_WIDTH * scale).round().max(1.0);
    let height = (FLOATING_HEIGHT * scale).round().max(1.0);
    let offset_x = ((outer_size.0 - width) / 2.0).max(0.0).round();
    let offset_y = ((outer_size.1 - height) / 2.0).max(0.0).round();
    (
        outer_position.0 + offset_x,
        outer_position.1 + offset_y,
        width,
        height,
    )
}

fn floating_outer_position_for_content(
    content_position: (f64, f64),
    outer_size: (f64, f64),
    scale: f64,
) -> (i32, i32) {
    let content_rect = floating_content_rect((0.0, 0.0), outer_size, scale);
    (
        (content_position.0 - content_rect.0).round() as i32,
        (content_position.1 - content_rect.1).round() as i32,
    )
}

#[cfg(windows)]
fn apply_floating_window_region(window: &tauri::WebviewWindow) -> Result<(), String> {
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let content = floating_content_rect(
        (0.0, 0.0),
        (outer_size.width as f64, outer_size.height as f64),
        scale,
    );
    let left = (content.0 + 2.0 * scale).round() as i32;
    let top = (content.1 + 2.0 * scale).round() as i32;
    let right = (content.0 + content.2 - 2.0 * scale).round() as i32;
    let bottom = (content.1 + content.3 - 2.0 * scale).round() as i32;
    let corner = (30.0 * scale).round().max(1.0) as i32;
    let native_window = window.hwnd().map_err(|error| error.to_string())?;

    // Windows enforces a minimum top-level HWND width even for an undecorated 52px
    // window. Limit the real visible and hit-test region so the transparent surplus
    // no longer blocks clicks or creates a false gap beside the reading popup.
    unsafe {
        let region = CreateRoundRectRgn(left, top, right, bottom, corner, corner);
        if region.is_null() {
            return Err("无法创建悬浮图标窗口区域".into());
        }
        if SetWindowRgn(native_window.0, region, 1) == 0 {
            DeleteObject(region);
            return Err("无法收紧悬浮图标窗口区域".into());
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_floating_window_region(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

fn set_floating_content_position(
    window: &tauri::WebviewWindow,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = floating_outer_position_for_content(
        (x, y),
        (outer_size.width as f64, outer_size.height as f64),
        scale,
    );
    window
        .set_position(PhysicalPosition::new(position.0, position.1))
        .map_err(|error| error.to_string())
}

fn popup_position_for_anchor(
    anchor: (f64, f64, f64, f64),
    popup_size: (f64, f64),
    monitor: (f64, f64, f64, f64),
    scale: f64,
) -> (f64, f64) {
    let (anchor_x, anchor_y, anchor_width, anchor_height) = anchor;
    let (popup_width, popup_height) = popup_size;
    let (monitor_x, monitor_y, monitor_width, monitor_height) = monitor;
    let anchor_center_x = anchor_x + anchor_width / 2.0;
    let monitor_center_x = monitor_x + monitor_width / 2.0;
    let gap = WINDOW_GAP * scale;
    let margin = WINDOW_SAFE_MARGIN * scale;
    let bottom_margin = POPUP_MARGIN_Y * scale;
    let preferred_x = if anchor_center_x >= monitor_center_x {
        anchor_x - popup_width - gap
    } else {
        anchor_x + anchor_width + gap
    };
    let preferred_y = anchor_y + anchor_height / 2.0 - POPUP_HEADER_CENTER * scale;
    (
        clamp_axis(
            preferred_x,
            monitor_x + margin,
            monitor_x + monitor_width - popup_width - margin,
        ),
        clamp_axis(
            preferred_y,
            monitor_y + margin,
            monitor_y + monitor_height - popup_height - bottom_margin,
        ),
    )
}

fn floating_position_for_popup(anchor: PopupAnchor, popup: (f64, f64, f64, f64)) -> (f64, f64) {
    let (popup_x, popup_y, popup_width, _) = popup;
    let (_, _, anchor_width, anchor_height) = anchor.rect;
    let (monitor_x, _, monitor_width, _) = anchor.monitor;
    let anchor_center_x = anchor.rect.0 + anchor_width / 2.0;
    let monitor_center_x = monitor_x + monitor_width / 2.0;
    let gap = WINDOW_GAP * anchor.scale;
    let x = if anchor_center_x >= monitor_center_x {
        popup_x + popup_width + gap
    } else {
        popup_x - anchor_width - gap
    };
    let y = popup_y + POPUP_HEADER_CENTER * anchor.scale - anchor_height / 2.0;
    (x, y)
}

fn capture_floating_anchor(floating: &tauri::WebviewWindow) -> Option<PopupAnchor> {
    let monitor = floating.current_monitor().ok().flatten()?;
    let position = floating.outer_position().ok()?;
    let size = floating.outer_size().ok()?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    Some(PopupAnchor {
        rect: floating_content_rect(
            (position.x as f64, position.y as f64),
            (size.width as f64, size.height as f64),
            monitor.scale_factor(),
        ),
        monitor: (
            monitor_position.x as f64,
            monitor_position.y as f64,
            monitor_size.width as f64,
            monitor_size.height as f64,
        ),
        scale: monitor.scale_factor(),
    })
}

fn sync_popup_to_floating(app: &tauri::AppHandle, floating: &tauri::WebviewWindow) {
    let Some(popup) = app.get_webview_window("reading-popup") else {
        return;
    };
    let Some(anchor) = capture_floating_anchor(floating) else {
        return;
    };
    let Ok(popup_size) = popup.outer_size() else {
        return;
    };
    let (x, y) = popup_position_for_anchor(
        anchor.rect,
        (popup_size.width as f64, popup_size.height as f64),
        anchor.monitor,
        anchor.scale,
    );
    let _ = popup.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
    if let Ok(mut state) = app.state::<WindowCoordinator>().0.lock() {
        state.popup_anchor = Some(anchor);
    }
}

fn bind_floating_window_events(floating: &tauri::WebviewWindow) {
    let app = floating.app_handle().clone();
    let floating_for_event = floating.clone();
    floating.on_window_event(move |event| match event {
        WindowEvent::Moved(_) => sync_popup_to_floating(&app, &floating_for_event),
        WindowEvent::ScaleFactorChanged { .. } => {
            let _ = apply_floating_window_region(&floating_for_event);
            sync_popup_to_floating(&app, &floating_for_event);
        }
        _ => {}
    });
}

fn main_window_is_presented(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main").is_some_and(|window| {
        window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
    })
}

fn sync_floating_visibility(app: &tauri::AppHandle) -> Result<(), String> {
    let requested = app
        .state::<WindowCoordinator>()
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .floating_requested;
    let should_show = requested && !main_window_is_presented(app);
    if should_show && app.get_webview_window("reading-floating").is_none() {
        create_floating_widget(app)?;
    }
    if let Some(window) = app.get_webview_window("reading-floating") {
        if should_show {
            window.show().map_err(|error| error.to_string())?;
            sync_popup_to_floating(app, &window);
        } else {
            window.hide().map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn popup_geometry_for_anchor(
    anchor: PopupAnchor,
    popup_width: f64,
    popup_height: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let physical_width = popup_width * anchor.scale;
    let physical_height = popup_height * anchor.scale;
    let (x, y) = popup_position_for_anchor(
        anchor.rect,
        (physical_width, physical_height),
        anchor.monitor,
        anchor.scale,
    );
    (
        PhysicalPosition::new(x.round() as i32, y.round() as i32),
        PhysicalSize::new(
            physical_width.round().max(1.0) as u32,
            physical_height.round().max(1.0) as u32,
        ),
    )
}

fn monitor_geometry(app: &tauri::AppHandle) -> Option<(f64, f64, f64, f64)> {
    let monitor = app.primary_monitor().ok().flatten()?;
    let scale = monitor.scale_factor();
    let size = monitor.size();
    let position = monitor.position();
    Some((
        position.x as f64 / scale,
        position.y as f64 / scale,
        size.width as f64 / scale,
        size.height as f64 / scale,
    ))
}

fn create_floating_widget(app: &tauri::AppHandle) -> Result<(), String> {
    let builder = WebviewWindowBuilder::new(
        app,
        "reading-floating",
        WebviewUrl::App("index.html?mode=floating".into()),
    )
    .title("弹阅")
    .inner_size(FLOATING_WIDTH, FLOATING_HEIGHT)
    .min_inner_size(FLOATING_WIDTH, FLOATING_HEIGHT)
    .max_inner_size(FLOATING_WIDTH, FLOATING_HEIGHT)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .focusable(true)
    .visible(false);

    let mut builder = builder;
    let mut initial_content_position = None;
    if let Some((monitor_x, monitor_y, monitor_width, monitor_height)) = monitor_geometry(app) {
        let x = monitor_x + monitor_width - FLOATING_WIDTH - FLOATING_MARGIN;
        let y = monitor_y + ((monitor_height - FLOATING_HEIGHT) * 0.52);
        builder = builder.position(x.max(monitor_x), y.max(monitor_y));
        initial_content_position = Some((x.max(monitor_x), y.max(monitor_y)));
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let configure_result = (|| -> Result<(), String> {
        apply_floating_window_region(&window)?;
        if let Some((x, y)) = initial_content_position {
            let scale = window.scale_factor().map_err(|error| error.to_string())?;
            set_floating_content_position(&window, x * scale, y * scale)?;
        }
        Ok(())
    })();
    if let Err(error) = configure_result {
        let _ = window.close();
        return Err(error);
    }
    bind_floating_window_events(&window);
    Ok(())
}

#[tauri::command]
async fn show_floating_widget(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, WindowCoordinator>,
) -> Result<bool, String> {
    coordinator
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .request_floating(true);
    sync_floating_visibility(&app)?;
    Ok(true)
}

#[tauri::command]
async fn hide_floating_widget(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, WindowCoordinator>,
) -> Result<bool, String> {
    coordinator
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .request_floating(false);
    sync_floating_visibility(&app)?;
    Ok(true)
}

#[tauri::command]
async fn show_reading_popup(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, WindowCoordinator>,
) -> Result<bool, String> {
    if app.get_webview_window("reading-popup").is_some() {
        return Ok(true);
    }

    let floating = app.get_webview_window("reading-floating");
    let anchor = floating
        .as_ref()
        .filter(|window| window.is_visible().unwrap_or(false))
        .and_then(capture_floating_anchor);
    coordinator
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .begin_popup(anchor);

    let builder = WebviewWindowBuilder::new(
        &app,
        "reading-popup",
        WebviewUrl::App("index.html?mode=popup".into()),
    )
    .title("弹阅 · 片刻阅读")
    .inner_size(POPUP_WIDTH, POPUP_HEIGHT)
    .min_inner_size(480.0, 340.0)
    .max_inner_size(640.0, 720.0)
    .decorations(false)
    .transparent(false)
    .shadow(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    .focusable(true)
    .visible(false)
    .prevent_overflow();

    let mut builder = builder;
    if let Some((monitor_x, monitor_y, monitor_width, monitor_height)) = monitor_geometry(&app) {
        let x = monitor_x + monitor_width - POPUP_WIDTH - POPUP_MARGIN_X;
        let y = monitor_y + monitor_height - POPUP_HEIGHT - POPUP_MARGIN_Y;
        builder = builder.position(x.max(monitor_x), y.max(monitor_y));
    }

    if let Err(error) = builder.build() {
        let (restore_floating, _) = coordinator
            .0
            .lock()
            .map_err(|_| "窗口协调器不可用".to_string())?
            .finish_popup();
        if restore_floating {
            let _ = sync_floating_visibility(&app);
        }
        return Err(error.to_string());
    }
    Ok(true)
}

#[tauri::command]
async fn hide_reading_popup(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, WindowCoordinator>,
) -> Result<(), String> {
    let popup = app.get_webview_window("reading-popup");
    if let Some(window) = popup {
        window.close().map_err(|error| error.to_string())?;
    }
    let (restore_floating, anchor) = coordinator
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .finish_popup();
    if restore_floating {
        if app.get_webview_window("reading-floating").is_none() {
            create_floating_widget(&app)?;
        }
        if let Some(floating) = app.get_webview_window("reading-floating") {
            if let Some(anchor) = anchor {
                set_floating_content_position(&floating, anchor.rect.0, anchor.rect.1)?;
            }
            sync_floating_visibility(&app)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn fit_reading_popup(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, WindowCoordinator>,
    width: f64,
    height: f64,
    anchor_to_floating: bool,
    reveal: bool,
) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("reading-popup") else {
        return Ok(false);
    };
    let width = width.clamp(480.0, 600.0);
    let height = height.clamp(340.0, 720.0);
    let anchor = coordinator
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .popup_anchor;
    if anchor_to_floating {
        if let Some(anchor) = anchor {
            let (_, size) = popup_geometry_for_anchor(anchor, width, height);
            window.set_size(size).map_err(|error| error.to_string())?;
            let actual_size = window.outer_size().map_err(|error| error.to_string())?;
            let (x, y) = popup_position_for_anchor(
                anchor.rect,
                (actual_size.width as f64, actual_size.height as f64),
                anchor.monitor,
                anchor.scale,
            );
            window
                .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
                .map_err(|error| error.to_string())?;
        } else if let Some(monitor) = app.primary_monitor().ok().flatten() {
            let scale = monitor.scale_factor();
            let monitor_position = monitor.position();
            let monitor_size = monitor.size();
            let physical_width = width * scale;
            let physical_height = height * scale;
            window
                .set_size(PhysicalSize::new(
                    physical_width.round().max(1.0) as u32,
                    physical_height.round().max(1.0) as u32,
                ))
                .map_err(|error| error.to_string())?;
            let actual_size = window.outer_size().map_err(|error| error.to_string())?;
            let x = monitor_position.x as f64 + monitor_size.width as f64
                - actual_size.width as f64
                - POPUP_MARGIN_X * scale;
            let y = monitor_position.y as f64 + monitor_size.height as f64
                - actual_size.height as f64
                - POPUP_MARGIN_Y * scale;
            window
                .set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
                .map_err(|error| error.to_string())?;
        }
    } else {
        window
            .set_size(PhysicalSize::new(
                (width * window.scale_factor().unwrap_or(1.0))
                    .round()
                    .max(1.0) as u32,
                (height * window.scale_factor().unwrap_or(1.0))
                    .round()
                    .max(1.0) as u32,
            ))
            .map_err(|error| error.to_string())?;
    }
    if reveal {
        window.show().map_err(|error| error.to_string())?;
    }
    Ok(true)
}

#[tauri::command]
async fn move_reading_popup(
    app: tauri::AppHandle,
    coordinator: tauri::State<'_, WindowCoordinator>,
    x: f64,
    y: f64,
) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("reading-popup") else {
        return Ok(false);
    };
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    let anchor = coordinator
        .0
        .lock()
        .map_err(|_| "窗口协调器不可用".to_string())?
        .popup_anchor;
    if let (Some(mut anchor), Some(floating)) = (anchor, app.get_webview_window("reading-floating"))
    {
        let popup_position = window.outer_position().map_err(|error| error.to_string())?;
        let popup_size = window.outer_size().map_err(|error| error.to_string())?;
        let (floating_x, floating_y) = floating_position_for_popup(
            anchor,
            (
                popup_position.x as f64,
                popup_position.y as f64,
                popup_size.width as f64,
                popup_size.height as f64,
            ),
        );
        anchor.rect.0 = floating_x.round();
        anchor.rect.1 = floating_y.round();
        coordinator
            .0
            .lock()
            .map_err(|_| "窗口协调器不可用".to_string())?
            .popup_anchor = Some(anchor);
        set_floating_content_position(&floating, floating_x, floating_y)?;
    }
    Ok(true)
}

#[tauri::command]
async fn move_floating_widget(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
    settle: bool,
) -> Result<bool, String> {
    if !x.is_finite() || !y.is_finite() {
        return Err("悬浮图标位置无效".into());
    }
    let Some(window) = app.get_webview_window("reading-floating") else {
        return Ok(false);
    };
    window
        .set_position(LogicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    if settle {
        if let Some(anchor) = capture_floating_anchor(&window) {
            let (x, y) = docked_floating_position(anchor);
            set_floating_content_position(&window, x, y)?;
        }
    }
    Ok(true)
}

fn docked_floating_position(anchor: PopupAnchor) -> (f64, f64) {
    let (x, y, width, height) = anchor.rect;
    let (left, top, screen_width, screen_height) = anchor.monitor;
    let right = left + screen_width;
    let threshold = 24.0 * anchor.scale;
    let x = if x <= left + threshold {
        left - width / 2.0
    } else if x + width >= right - threshold {
        right - width / 2.0
    } else {
        x
    };
    (x, y.clamp(top, (top + screen_height - height).max(top)))
}

#[tauri::command]
async fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.unminimize().map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    }
    sync_floating_visibility(&app)?;
    Ok(())
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = sync_floating_visibility(app);
}

#[cfg(test)]
mod window_geometry_tests {
    use super::{
        floating_content_rect, floating_outer_position_for_content, floating_position_for_popup,
        popup_geometry_for_anchor, popup_position_for_anchor, PopupAnchor, WindowCoordinatorState,
    };

    #[test]
    fn floating_docks_halfway_at_both_edges_without_changing_middle_positions() {
        for scale in [1.0, 1.5, 2.0] {
            let mut anchor = PopupAnchor {
                rect: (-1920.0 + 10.0 * scale, 300.0, 52.0 * scale, 52.0 * scale),
                monitor: (-1920.0, 0.0, 1920.0, 1080.0),
                scale,
            };
            assert_eq!(
                super::docked_floating_position(anchor),
                (-1920.0 - 26.0 * scale, 300.0)
            );
            anchor.rect.0 = -60.0 * scale;
            assert_eq!(
                super::docked_floating_position(anchor),
                (-26.0 * scale, 300.0)
            );
            anchor.rect.0 = -900.0;
            assert_eq!(super::docked_floating_position(anchor), (-900.0, 300.0));
        }
    }

    #[test]
    fn windows_minimum_width_is_excluded_from_the_floating_content_rect() {
        let rect = floating_content_rect((300.0, 400.0), (262.0, 104.0), 2.0);
        assert_eq!(rect, (379.0, 400.0, 104.0, 104.0));
        assert_eq!(
            floating_outer_position_for_content((379.0, 400.0), (262.0, 104.0), 2.0),
            (300, 400)
        );
    }

    #[test]
    fn popup_keeps_a_small_safe_gap_from_right_side_button() {
        let (x, y) = popup_position_for_anchor(
            (1850.0, 480.0, 52.0, 52.0),
            (480.0, 425.0),
            (0.0, 0.0, 1920.0, 1080.0),
            1.0,
        );
        assert_eq!((x, y), (1370.0, 481.0));
    }

    #[test]
    fn popup_keeps_a_small_safe_gap_from_left_side_button() {
        let (x, _) = popup_position_for_anchor(
            (18.0, 480.0, 52.0, 52.0),
            (480.0, 425.0),
            (0.0, 0.0, 1920.0, 1080.0),
            1.0,
        );
        assert_eq!(x, 70.0);
    }

    #[test]
    fn popup_geometry_uses_the_anchor_monitor_scale() {
        let anchor = PopupAnchor {
            rect: (2805.0, 720.0, 78.0, 78.0),
            monitor: (0.0, 0.0, 2880.0, 1620.0),
            scale: 1.5,
        };
        let (position, size) = popup_geometry_for_anchor(anchor, 480.0, 425.0);
        assert_eq!((position.x, position.y), (2085, 722));
        assert_eq!((size.width, size.height), (720, 638));
    }

    #[test]
    fn popup_stays_inside_negative_coordinate_monitor_at_common_scales() {
        for scale in [1.0, 1.5, 2.0] {
            let monitor = (-2560.0, -300.0, 2560.0, 1440.0);
            let anchor = PopupAnchor {
                rect: (-100.0, 100.0, 52.0 * scale, 52.0 * scale),
                monitor,
                scale,
            };
            let (position, size) = popup_geometry_for_anchor(anchor, 480.0, 425.0);
            assert!(position.x >= -2560 && position.y >= -300);
            assert!(position.x + size.width as i32 <= 0);
            assert!(position.y + size.height as i32 <= 1140);
        }
    }

    #[test]
    fn moving_a_right_side_popup_keeps_the_floating_button_attached() {
        let anchor = PopupAnchor {
            rect: (1850.0, 480.0, 52.0, 52.0),
            monitor: (0.0, 0.0, 1920.0, 1080.0),
            scale: 1.0,
        };
        let position = floating_position_for_popup(anchor, (1370.0, 481.0, 480.0, 425.0));
        assert_eq!(position, (1850.0, 480.0));
    }

    #[test]
    fn moving_a_left_side_popup_keeps_the_floating_button_attached() {
        let anchor = PopupAnchor {
            rect: (18.0, 480.0, 52.0, 52.0),
            monitor: (0.0, 0.0, 1920.0, 1080.0),
            scale: 1.0,
        };
        let position = floating_position_for_popup(anchor, (70.0, 481.0, 480.0, 425.0));
        assert_eq!(position, (18.0, 480.0));
    }

    #[test]
    fn popup_session_restores_the_exact_original_anchor() {
        let anchor = PopupAnchor {
            rect: (1850.0, 480.0, 52.0, 52.0),
            monitor: (0.0, 0.0, 1920.0, 1080.0),
            scale: 1.0,
        };
        let mut state = WindowCoordinatorState::default();
        state.request_floating(true);
        state.begin_popup(Some(anchor));
        let (restore, restored_anchor) = state.finish_popup();
        assert!(restore);
        assert_eq!(restored_anchor, Some(anchor));
        assert_eq!(state.popup_anchor, None);
    }

    #[test]
    fn disabling_floating_during_popup_prevents_restore() {
        let mut state = WindowCoordinatorState::default();
        state.request_floating(true);
        state.begin_popup(None);
        state.request_floating(false);
        let (restore, _) = state.finish_popup();
        assert!(!restore);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WindowCoordinator::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            show_reading_popup,
            hide_reading_popup,
            fit_reading_popup,
            move_reading_popup,
            move_floating_widget,
            show_main_window,
            show_floating_widget,
            hide_floating_widget,
            state_repository::load_app_state,
            state_repository::save_app_state,
            state_repository::restore_app_state,
            state_repository::migrate_legacy_state,
            state_repository::reset_app_state,
            state_repository::storage_diagnostics,
            import_package::list_pending_import_packages,
            import_package::acknowledge_import_package
        ])
        .setup(|app| {
            let read_now = MenuItem::with_id(app, "read-now", "立即读一段", true, None::<&str>)?;
            let show_main_item =
                MenuItem::with_id(app, "show-main", "打开弹阅", true, None::<&str>)?;
            let pause_30 = MenuItem::with_id(app, "pause-30", "暂停 30 分钟", true, None::<&str>)?;
            let pause_today =
                MenuItem::with_id(app, "pause-today", "今天不再提醒", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&read_now, &show_main_item, &pause_30, &pause_today, &quit],
            )?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("弹阅 · 少而精地读，深而静地思")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show-main" => show_main(app),
                    "read-now" | "pause-30" | "pause-today" => {
                        let _ = app.emit("tray-action", event.id.as_ref());
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            if let Some(main_window) = app.get_webview_window("main") {
                let window_for_event = main_window.clone();
                let app_for_event = app.handle().clone();
                main_window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_event.hide();
                        let _ = sync_floating_visibility(&app_for_event);
                    }
                    if matches!(event, WindowEvent::Focused(true) | WindowEvent::Resized(_)) {
                        let _ = sync_floating_visibility(&app_for_event);
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run 弹阅");
}
