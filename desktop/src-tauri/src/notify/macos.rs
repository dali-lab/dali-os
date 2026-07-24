// UNUserNotificationCenter backend for bundled builds. Banners post with the
// Notification row id as their identifier and the link in userInfo, so the
// delegate can resolve a response even after an app relaunch (the system
// persists both), and delivered banners can be removed from Notification
// Center once their row is read elsewhere.
//
// Unbundled dev binaries (`tauri dev`) cannot touch the UN framework at all —
// currentNotificationCenter throws NSInternalInconsistencyException outside a
// signed bundle — so they fall back to mac-notification-sys (banner + body
// click only), the same machinery the Tauri plugin wraps.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{define_class, msg_send, AnyThread};
use objc2_foundation::{
    NSArray, NSBundle, NSDictionary, NSError, NSObject, NSObjectProtocol, NSSet, NSString,
};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification, UNNotificationAction,
    UNNotificationActionOptions, UNNotificationCategory, UNNotificationCategoryOptions,
    UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNNotificationSound, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use tauri::AppHandle;

use super::Banner;

const CATEGORY_INVITE: &str = "dali-meeting-invite";
const CATEGORY_ROW: &str = "dali-notification";
const USERINFO_LINK: &str = "link";
// Shell-local banners still need a unique request identifier; the prefix maps
// them back to "no row" in the response handler.
const SHELL_ID_PREFIX: &str = "shell-";

static APP: OnceLock<AppHandle> = OnceLock::new();
static UN_ACTIVE: AtomicBool = AtomicBool::new(false);
static SHELL_SEQ: AtomicU64 = AtomicU64::new(0);

define_class!(
    // SAFETY: NSObject has no subclassing requirements; no ivars, no Drop.
    #[unsafe(super(NSObject))]
    #[name = "DaliNotificationDelegate"]
    struct Delegate;

    unsafe impl NSObjectProtocol for Delegate {}

    unsafe impl UNUserNotificationCenterDelegate for Delegate {
        // Show banners even while the app is frontmost.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            handle_response(response);
            completion.call(());
        }
    }
);

impl Delegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { msg_send![super(this), init] }
    }
}

// Apple guarantees no particular queue for delegate callbacks; everything
// here is thread-safe and the shared handlers hop to the main thread for
// window work themselves.
fn handle_response(response: &UNNotificationResponse) {
    let Some(app) = APP.get() else {
        return;
    };
    let request = response.notification().request();
    let raw_id = request.identifier().to_string();
    let id = if raw_id.starts_with(SHELL_ID_PREFIX) {
        String::new()
    } else {
        raw_id
    };
    let link = request
        .content()
        .userInfo()
        .objectForKey(&*NSString::from_str(USERINFO_LINK))
        .and_then(|o| o.downcast::<NSString>().ok())
        .map(|s| s.to_string());

    let action = response.actionIdentifier();
    if &*action == unsafe { UNNotificationDefaultActionIdentifier } {
        super::on_clicked(app, &id, link.as_deref());
        return;
    }
    // Dismiss (or anything unrecognized) falls through on_action as a no-op.
    super::on_action(app, &id, &action.to_string());
}

fn un_active() -> bool {
    UN_ACTIVE.load(Ordering::Relaxed)
}

pub fn init(app: &AppHandle) {
    if NSBundle::mainBundle().bundleIdentifier().is_none() {
        return; // unbundled dev binary — fallback path only
    }
    let _ = APP.set(app.clone());

    let center = UNUserNotificationCenter::currentNotificationCenter();

    // The delegate property is weak — leak one strong reference for the app's
    // lifetime so callbacks keep arriving.
    let delegate = Delegate::new();
    center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    std::mem::forget(delegate);

    // Completion may run on a background thread; nothing is captured.
    let auth_done = RcBlock::new(|_granted: Bool, _error: *mut NSError| {});
    center.requestAuthorizationWithOptions_completionHandler(
        UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound | UNAuthorizationOptions::Badge,
        &auth_done,
    );

    let action = |id: &str, title: &str| {
        UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str(id),
            &NSString::from_str(title),
            UNNotificationActionOptions::empty(),
        )
    };
    let no_intents: Retained<NSArray<NSString>> = NSArray::new();
    let invite = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(CATEGORY_INVITE),
        &NSArray::from_retained_slice(&[
            action(super::ACTION_RSVP_ACCEPT, "Accept"),
            action(super::ACTION_RSVP_MAYBE, "Maybe"),
            action(super::ACTION_RSVP_DECLINE, "Decline"),
        ]),
        &no_intents,
        UNNotificationCategoryOptions::empty(),
    );
    let row = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
        &NSString::from_str(CATEGORY_ROW),
        &NSArray::from_retained_slice(&[action(super::ACTION_READ, "Mark read")]),
        &no_intents,
        UNNotificationCategoryOptions::empty(),
    );
    center.setNotificationCategories(&NSSet::from_retained_slice(&[invite, row]));

    UN_ACTIVE.store(true, Ordering::Relaxed);
}

pub fn raise(app: &AppHandle, banner: Banner) {
    if !un_active() {
        return raise_fallback(app, banner);
    }

    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&banner.title));
    if !banner.body.is_empty() {
        content.setBody(&NSString::from_str(&banner.body));
    }
    if banner.urgent {
        content.setSound(Some(&UNNotificationSound::defaultSound()));
    }
    if banner.rsvp {
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY_INVITE));
    } else if banner.is_row() {
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY_ROW));
    }
    if let Some(link) = &banner.link {
        let dict: Retained<NSDictionary<NSString, NSString>> = NSDictionary::from_slices(
            &[&*NSString::from_str(USERINFO_LINK)],
            &[&*NSString::from_str(link)],
        );
        let dict: Retained<NSDictionary> = unsafe { Retained::cast_unchecked::<NSDictionary>(dict) };
        // SAFETY: string keys/values are valid property-list userInfo.
        unsafe { content.setUserInfo(&dict) };
    }

    let id = if banner.is_row() {
        banner.id
    } else {
        format!("{SHELL_ID_PREFIX}{}", SHELL_SEQ.fetch_add(1, Ordering::Relaxed))
    };
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&id),
        &content,
        None, // no trigger = deliver now
    );
    let done = RcBlock::new(|_error: *mut NSError| {});
    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(&request, Some(&done));
}

pub fn clear_delivered(ids: &[String]) {
    if !un_active() || ids.is_empty() {
        return;
    }
    let ids: Vec<Retained<NSString>> = ids.iter().map(|s| NSString::from_str(s)).collect();
    UNUserNotificationCenter::currentNotificationCenter()
        .removeDeliveredNotificationsWithIdentifiers(&NSArray::from_retained_slice(&ids));
}

pub fn clear_all_delivered() {
    if !un_active() {
        return;
    }
    UNUserNotificationCenter::currentNotificationCenter().removeAllDeliveredNotifications();
}

// Unbundled dev fallback (NSUserNotificationCenter via mac-notification-sys).
// send() parks its thread until the user responds, so each banner gets a
// detached thread; only the body click is supported.
fn raise_fallback(app: &AppHandle, banner: Banner) {
    use mac_notification_sys::{Notification, NotificationResponse};

    let app = app.clone();
    std::thread::spawn(move || {
        let mut n = Notification::new();
        n.title(&banner.title);
        if !banner.body.is_empty() {
            n.message(&banner.body);
        }
        if banner.urgent {
            n.sound("default");
        }
        if let Ok(NotificationResponse::Click) = n.send() {
            super::on_clicked(&app, &banner.id, banner.link.as_deref());
        }
    });
}
