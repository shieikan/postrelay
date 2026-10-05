"""Run the pinned listener with secrets in a private volume, not container args."""
import getpass
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


def receiver_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError('PostRelayの受け取りURLを確認してください。')
    value = value.strip()
    try:
        parsed = urlsplit(value)
    except ValueError:
        raise ValueError('PostRelayの受け取りURLを確認してください。') from None
    if parsed.scheme or parsed.netloc:
        if (parsed.scheme not in {'http', 'https'} or not parsed.netloc
                or parsed.username or parsed.password or parsed.query or parsed.fragment):
            raise ValueError('PostRelayの受け取りURLを確認してください。')
        match = re.fullmatch(r'/api/hooks/([A-Za-z0-9_-]{32,128})', parsed.path)
        if not match:
            raise ValueError('PostRelayの受け取りURLを確認してください。')
        token = match[1]
    else:
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', value):
            raise ValueError('PostRelayの受け取りURLを確認してください。')
        token = value
    return 'http://127.0.0.1:8767/api/push/' + token


def private_directory(directory):
    directory = Path(directory)
    if (directory.is_symlink() or not directory.is_dir()
            or stat.S_IMODE(directory.stat().st_mode) != 0o700):
        raise ValueError('接続設定の保存先は、所有者だけが使えるディレクトリにしてください。')
    return directory


def save_receiver(directory, value):
    directory = private_directory(directory)
    token = receiver_url(value).rsplit('/', 1)[1]
    path = directory / 'postrelay-token'
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError('接続設定の保存先を確認してください。')
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), 0o600)
            handle.write(token)
            handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()


def load_receiver(directory):
    path = private_directory(directory) / 'postrelay-token'
    if (path.is_symlink() or not path.is_file()
            or stat.S_IMODE(path.stat().st_mode) != 0o600 or path.stat().st_size > 2048):
        raise ValueError('PostRelayとの接続を設定してください。秘密ファイルの権限は0600にしてください。')
    return receiver_url(path.read_text())


def main():
    command = sys.argv[1] if len(sys.argv) == 2 else 'listen' if len(sys.argv) == 1 else ''
    allowed = {'init', 'register', 'listen', 'status', 'unregister', 'set-receiver', 'help'}
    if command not in allowed:
        raise SystemExit('Usage: angelic init|set-receiver|register|listen|status|unregister|help')
    if command == 'help':
        print('Use init, set-receiver, register, then listen. Enter secrets only at the hidden prompts.')
        return
    os.umask(0o077)
    try:
        directory = private_directory('/private')
        if command == 'set-receiver':
            value = getpass.getpass('PostRelayの受け取りURL（入力は非表示）: ')
            save_receiver(directory, value)
            print('PostRelayとの接続設定を保存しました（値は非表示）。')
            return
        env = os.environ.copy()
        if command == 'listen':
            env['WEBHOOK_ENDPOINT'] = load_receiver(directory)
        binary = '/usr/local/bin/angelic-angel'
        os.execve(binary, [binary, '--config', str(directory / 'angelic-angel.toml'), command], env)
    except (OSError, ValueError):
        raise SystemExit('接続設定を確認してください。保存先は0700、秘密ファイルは0600にし、初期設定を完了してください。') from None


if __name__ == '__main__':
    main()
