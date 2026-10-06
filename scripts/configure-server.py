"""Create a private server .env once; keep generated credentials out of output."""
import argparse
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from postrelay.security import normalize_origin


def configure(directory, port=8765, origin=None):
    if not 1 <= port <= 65535:
        raise ValueError('ポート番号を確認してください。')
    origin = normalize_origin(origin or f'http://localhost:{port}')
    path = Path(directory) / '.env'
    content = (f'POSTRELAY_PORT={port}\nPOSTRELAY_PUBLIC_URL={origin.rstrip("/")}\n'
               f'POSTRELAY_SIGNUP_KEY={secrets.token_urlsafe(32)}\n')
    # Exclusive creation prevents replacing a deployment's registration key.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(content)
        handle.flush(); os.fsync(handle.fileno())
    return path


def main():
    parser = argparse.ArgumentParser(description='Create private PostRelay server settings')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--origin', help='Browser origin, for example https://notify.example.com')
    args = parser.parse_args()
    try:
        configure(Path.cwd(), args.port, args.origin)
    except FileExistsError:
        raise SystemExit('.envが既にあります。既存の接続設定は変更していません。') from None
    except (OSError, ValueError):
        raise SystemExit('設定を保存できませんでした。URL・ポート番号・保存先の権限を確認してください。') from None
    print('.envを所有者だけが読める権限で作成しました。登録キーは.env内で確認してください。')


if __name__ == '__main__':
    main()
