// macOS Keychain access for the long-lived desktop Session token (the poller's
// Bearer credential). keyring v3 wraps the Security framework.

use crate::config::{KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_ACCOUNT};
use keyring::Entry;

fn entry() -> keyring::Result<Entry> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_TOKEN_ACCOUNT)
}

pub fn store_token(token: &str) -> keyring::Result<()> {
    entry()?.set_password(token)
}

pub fn get_token() -> Option<String> {
    entry().ok().and_then(|e| e.get_password().ok())
}

pub fn delete_token() {
    if let Ok(e) = entry() {
        let _ = e.delete_credential();
    }
}
