use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is set"));
    let target = std::env::var("TARGET").expect("TARGET is set");
    let repo_root = manifest_dir.parent().expect("project root should exist");
    let binaries_dir = manifest_dir.join("binaries");
    let binary_name = if target.contains("windows") {
        format!("airwsjtx_bridge-{target}.exe")
    } else {
        format!("airwsjtx_bridge-{target}")
    };
    let expected_binary = binaries_dir.join(&binary_name);

    fs::create_dir_all(&binaries_dir).expect("cannot create binaries directory");

    if (target.contains("linux") || target.contains("apple")) && !expected_binary.exists() {
        let python_script = repo_root.join("sidecar").join("airwsjtx_bridge.py");
        let wrapper = format!(
            "#!/bin/sh\nexec python3 \"{}\" \"$@\"\n",
            python_script.display()
        );
        fs::write(&expected_binary, wrapper).expect("cannot create Unix sidecar wrapper");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = fs::metadata(&expected_binary)
                .expect("wrapper metadata missing")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&expected_binary, permissions).expect("cannot mark wrapper executable");
        }
    } else if target.contains("windows") && !expected_binary.exists() {
        let python_script = repo_root.join("sidecar").join("airwsjtx_bridge.py");
        let escaped_script = python_script.to_string_lossy().replace('\\', "\\\\");
        let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set"));
        let wrapper_src = out_dir.join("airwsjtx_bridge_wrapper.rs");
        let rust_code = format!(
            r#"use std::env;
use std::path::PathBuf;
use std::process::{{Command, Stdio}};

fn main() {{
    let current = env::current_exe().unwrap_or_else(|_| PathBuf::from("."));
    let mut dir = current.parent();
    let mut script = None;
    while let Some(d) = dir {{
        let candidate = d.join("sidecar").join("airwsjtx_bridge.py");
        if candidate.exists() {{
            script = Some(candidate);
            break;
        }}
        dir = d.parent();
    }}
    let script = script.unwrap_or_else(|| PathBuf::from(r"{escaped_script}"));

    let candidates = ["python", "python3", "py"];
    let mut chosen = "python";
    let mut extra: Option<&str> = None;
    for &cand in &candidates {{
        if let Ok(out) = Command::new(cand).arg("--version").output() {{
            if out.status.success() {{
                chosen = cand;
                if cand == "py" {{
                    extra = Some("-3");
                }}
                break;
            }}
        }}
    }}

    let mut cmd = Command::new(chosen);
    if let Some(arg) = extra {{
        cmd.arg(arg);
    }}
    cmd.arg(&script);
    cmd.args(env::args().skip(1));
    cmd.stdin(Stdio::inherit());
    cmd.stdout(Stdio::inherit());
    cmd.stderr(Stdio::inherit());

    match cmd.spawn() {{
        Ok(mut child) => {{
            let status = child.wait().expect("Failed to wait for python sidecar");
            std::process::exit(status.code().unwrap_or(1));
        }}
        Err(e) => {{
            eprintln!("Failed to spawn python sidecar: {{}}", e);
            std::process::exit(1);
        }}
    }}
}}
"#
        );
        fs::write(&wrapper_src, rust_code).expect("cannot write Windows sidecar wrapper source");
        let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_string());
        let status = Command::new(rustc)
            .arg(&wrapper_src)
            .arg("-o")
            .arg(&expected_binary)
            .status()
            .expect("failed to execute rustc to compile sidecar wrapper");
        assert!(status.success(), "failed to compile Windows sidecar wrapper");
    }

    println!("cargo:rerun-if-changed={}", repo_root.join("sidecar").join("airwsjtx_bridge.py").display());

    if target.contains("windows") {
        // If an existing instance of airwsjtx or airwsjtx_bridge is still running,
        // terminate it so Windows file-locking doesn't cause tauri-build or the linker
        // to panic with OS error 5 (Access is denied).
        if let Ok(output) = Command::new("taskkill")
            .args(["/F", "/IM", "airwsjtx.exe", "/IM", "airwsjtx_bridge.exe"])
            .output()
        {
            if output.status.success() {
                std::thread::sleep(std::time::Duration::from_millis(200));
            }
        }
    }

    tauri_build::build();
}
