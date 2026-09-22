use std::env;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_recorder();
    }
    tauri_build::build()
}

// Compiles recorder/Recorder.swift (native meeting recording, see
// src/recording.rs) into a static library linked into the app, so capture runs
// inside the app process under its own entitlements and privacy prompts. Uses
// the Xcode / Command Line Tools swiftc that desktop builds already require,
// and honors SDKROOT like the rest of the toolchain. Runs once per arch in a
// universal build (cargo builds each target separately).
fn build_recorder() {
    const MIN_MACOS: &str = "12.0"; // bundle.macOS.minimumSystemVersion
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        other => other,
    }
    .to_string();
    let target = format!("{arch}-apple-macos{MIN_MACOS}");
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let source = "recorder/Recorder.swift";
    println!("cargo:rerun-if-changed={source}");
    println!("cargo:rerun-if-env-changed=SDKROOT");

    let status = Command::new("xcrun")
        .args(["swiftc", "-parse-as-library", "-emit-library", "-static", "-O"])
        .args(["-module-name", "DaliRecorder", "-target", &target])
        .arg("-o")
        .arg(out_dir.join("libdali_recorder.a"))
        .arg(source)
        .status()
        .expect("run swiftc (install Xcode or the Command Line Tools)");
    assert!(status.success(), "swiftc failed to build {source}");

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=dali_recorder");

    // The library autolinks the Swift runtime and its frameworks; the linker
    // needs to know where they live. The runtime ships in the OS on every
    // supported macOS, so it's loaded from /usr/lib/swift at run time.
    let info = Command::new("xcrun")
        .args(["swiftc", "-print-target-info", "-target", &target])
        .output()
        .expect("run swiftc -print-target-info");
    let info: serde_json::Value =
        serde_json::from_slice(&info.stdout).expect("parse swiftc target info");
    for path in info["paths"]["runtimeLibraryPaths"].as_array().into_iter().flatten() {
        if let Some(p) = path.as_str() {
            println!("cargo:rustc-link-search=native={p}");
        }
    }
    let sdk = Command::new("xcrun")
        .arg("--show-sdk-path")
        .output()
        .expect("run xcrun --show-sdk-path");
    let sdk = String::from_utf8_lossy(&sdk.stdout).trim().to_string();
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    for fw in ["AVFoundation", "Speech", "CoreAudio", "AudioToolbox"] {
        println!("cargo:rustc-link-lib=framework={fw}");
    }
}
