//! Restricted container entry point. Private token files remain compatible.
use std::fs::{self, File, OpenOptions};
use std::io::{IsTerminal, Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Command;
const ERROR: &str = "接続設定を確認してください。保存先は0700、秘密ファイルは0600にし、初期設定を完了してください。";
type Result<T> = std::result::Result<T, &'static str>;
fn receiver_url(value: &str) -> Result<String> {
    if value.len() > 2048 {
        return Err(ERROR);
    }
    let value = value.trim();
    let token = if value.contains("://") {
        // Reject empty authorities before URL normalization can repair them.
        let (scheme, rest) = value.split_once("://").ok_or(ERROR)?;
        if !matches!(scheme, "http" | "https") || rest.starts_with('/') {
            return Err(ERROR);
        }
        let url = reqwest::Url::parse(value).map_err(|_| ERROR)?;
        if url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(ERROR);
        }
        url.path()
            .strip_prefix("/api/hooks/")
            .ok_or(ERROR)?
            .to_owned()
    } else {
        value.to_owned()
    };
    if !(32..=128).contains(&token.len())
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(ERROR);
    }
    Ok(format!("http://127.0.0.1:8767/api/push/{token}"))
}
fn private_directory(directory: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(directory).map_err(|_| ERROR)?;
    if !metadata.is_dir() || metadata.mode() & 0o7777 != 0o700 {
        return Err(ERROR);
    }
    Ok(())
}
fn check_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|_| ERROR)?;
    if !metadata.is_file()
        || metadata.mode() & 0o7777 != 0o600
        || metadata.nlink() != 1
        || metadata.len() > 2048
    {
        return Err(ERROR);
    }
    Ok(())
}
fn save_receiver(directory: &Path, value: &str) -> Result<()> {
    private_directory(directory)?;
    let url = receiver_url(value)?;
    let token = url.rsplit('/').next().ok_or(ERROR)?;
    let path = directory.join("postrelay-token");
    match fs::symlink_metadata(&path) {
        Ok(_) => check_file(&path)?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(ERROR),
    }
    let temporary = directory.join(format!(".postrelay-token-{}", rand::random::<u128>()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .map_err(|_| ERROR)?;
    let result = (|| {
        file.write_all(token.as_bytes()).map_err(|_| ERROR)?;
        file.sync_all().map_err(|_| ERROR)?;
        fs::rename(&temporary, &path).map_err(|_| ERROR)?;
        File::open(directory)
            .and_then(|d| d.sync_all())
            .map_err(|_| ERROR)
    })();
    // Cleanup only the temporary file this process successfully created.
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
fn load_receiver(directory: &Path) -> Result<String> {
    private_directory(directory)?;
    let path = directory.join("postrelay-token");
    check_file(&path)?;
    let mut value = String::new();
    File::open(&path)
        .map_err(|_| ERROR)?
        .take(2049)
        .read_to_string(&mut value)
        .map_err(|_| ERROR)?;
    receiver_url(&value)
}
fn command(args: &[String]) -> Result<&str> {
    match args {
        [] => Ok("listen"),
        [one]
            if matches!(
                one.as_str(),
                "init" | "set-receiver" | "register" | "listen" | "status" | "unregister" | "help"
            ) =>
        {
            Ok(one)
        }
        _ => Err("Usage: angelic init|set-receiver|register|listen|status|unregister|help"),
    }
}
fn run() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let command = command(&args)?;
    if command == "help" {
        println!(
            "Use init, set-receiver, register, then listen. Enter secrets only at the hidden prompts."
        );
        return Ok(());
    }
    // Both secret-entry commands fail closed instead of falling back to echoed input.
    if matches!(command, "init" | "set-receiver")
        && (!std::io::stdin().is_terminal() || !std::io::stderr().is_terminal())
    {
        return Err(ERROR);
    }
    let directory = Path::new("/private");
    private_directory(directory)?;
    if command == "set-receiver" {
        let value = dialoguer::Password::new()
            .with_prompt("PostRelayの受け取りURL（入力は非表示）")
            .interact()
            .map_err(|_| ERROR)?;
        save_receiver(directory, &value)?;
        println!("PostRelayとの接続設定を保存しました（値は非表示）。");
        return Ok(());
    }
    let mut child = Command::new("/usr/local/bin/angelic-angel");
    child.args(["--config", "/private/angelic-angel.toml", command]);
    if command == "listen" {
        child.env("WEBHOOK_ENDPOINT", load_receiver(directory)?);
    }
    // Replace the entry point so signals reach the receiver directly; no shell.
    let _error = child.exec();
    Err(ERROR)
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::fs::symlink;
    use std::path::PathBuf;
    struct Private(PathBuf);
    impl Private {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("postrelay-runner-{}", rand::random::<u128>()));
            fs::create_dir(&path).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
            Self(path)
        }
    }
    impl Drop for Private {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn token() -> String {
        "synthetic_token_".to_owned() + &"x".repeat(30)
    }
    #[test]
    fn only_one_known_command_is_allowed() {
        assert_eq!(command(&[]).unwrap(), "listen");
        assert_eq!(command(&["help".to_owned()]).unwrap(), "help");
        for args in [
            vec!["init", "--auth-token", "private-secret"],
            vec!["--config", "/tmp/secret"],
            vec!["private-secret"],
        ] {
            let args: Vec<_> = args.iter().map(|s| s.to_string()).collect();
            assert!(!command(&args).unwrap_err().contains("private-secret"));
        }
    }
    #[test]
    fn dashboard_host_is_never_a_delivery_destination() {
        let value = token();
        let expected = format!("http://127.0.0.1:8767/api/push/{value}");
        assert_eq!(receiver_url(&value).unwrap(), expected);
        assert_eq!(
            receiver_url(&format!("https://untrusted.example.test/api/hooks/{value}")).unwrap(),
            expected
        );
    }
    #[test]
    fn invalid_input_is_redacted() {
        for value in [
            "short-private-secret".to_owned(),
            format!(
                "https://user:private-secret@host.test/api/hooks/{}",
                token()
            ),
            format!(
                "https://host.test/api/hooks/{}?secret=private-secret",
                token()
            ),
            format!("https://host.test/api/hooks/{}#private-secret", token()),
            format!("https:///api/hooks/{}", token()),
            "x".repeat(2049),
            "x".repeat(129),
            "https://[malformed/private-secret".to_owned(),
        ] {
            let error = receiver_url(&value).unwrap_err();
            assert!(!error.contains("private-secret"));
            assert!(!error.contains(&value));
        }
    }
    #[test]
    fn private_atomic_save_reload_and_failed_input_preservation() {
        let directory = Private::new();
        save_receiver(&directory.0, &token()).unwrap();
        let path = directory.0.join("postrelay-token");
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert_eq!(fs::read_to_string(&path).unwrap(), token());
        assert_eq!(
            load_receiver(&directory.0).unwrap(),
            receiver_url(&token()).unwrap()
        );
        save_receiver(&directory.0, &"a".repeat(43)).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "a".repeat(43));
        assert_eq!(fs::read_dir(&directory.0).unwrap().count(), 1);
        assert!(save_receiver(&directory.0, "short-private-secret").is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "a".repeat(43));
    }
    #[test]
    fn shared_directory_and_secret_files_are_rejected() {
        let directory = Private::new();
        fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(save_receiver(&directory.0, &token()).is_err());
        fs::set_permissions(&directory.0, fs::Permissions::from_mode(0o700)).unwrap();
        save_receiver(&directory.0, &token()).unwrap();
        let path = directory.0.join("postrelay-token");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load_receiver(&directory.0).is_err());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&path, "x".repeat(2049)).unwrap();
        assert!(load_receiver(&directory.0).is_err());
    }
    #[test]
    fn links_cannot_read_or_overwrite_external_files() {
        let directory = Private::new();
        let external = Private::new();
        let target = external.0.join("secret");
        fs::write(&target, "outside-private-secret").unwrap();
        let path = directory.0.join("postrelay-token");
        symlink(&target, &path).unwrap();
        assert!(save_receiver(&directory.0, &token()).is_err());
        assert!(load_receiver(&directory.0).is_err());
        assert_eq!(
            fs::read_to_string(&target).unwrap(),
            "outside-private-secret"
        );
        fs::remove_file(&path).unwrap();
        fs::hard_link(&target, &path).unwrap();
        assert!(save_receiver(&directory.0, &token()).is_err());
        assert!(load_receiver(&directory.0).is_err());
        let alias = external.0.join("alias");
        symlink(&directory.0, &alias).unwrap();
        assert!(private_directory(&alias).is_err());
    }
}
