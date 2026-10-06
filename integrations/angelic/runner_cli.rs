use std::io::Write;
use std::process::{Command, Stdio};
#[test]
fn secrets_are_rejected_as_arguments_and_non_terminal_input_is_never_echoed() {
    let binary = env!("CARGO_BIN_EXE_postrelay-angelic");
    for command in ["init", "set-receiver"] {
        let mut child = Command::new(binary)
            .arg(command)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let _ = child
            .stdin
            .take()
            .unwrap()
            .write_all(b"synthetic-private-secret\n");
        let output = child.wait_with_output().unwrap();
        assert!(!output.status.success());
        assert!(!String::from_utf8_lossy(&output.stdout).contains("synthetic-private-secret"));
        assert!(!String::from_utf8_lossy(&output.stderr).contains("synthetic-private-secret"));
    }
    let output = Command::new(binary)
        .args(["init", "--auth-token", "synthetic-private-secret"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(!String::from_utf8_lossy(&output.stderr).contains("synthetic-private-secret"));
    assert!(Command::new(binary).arg("help").status().unwrap().success());
}
