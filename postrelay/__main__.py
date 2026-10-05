import argparse
import os
import threading
from urllib.parse import urlsplit
from pathlib import Path
from .store import Store
from .server import make_server


def main():
    parser = argparse.ArgumentParser(description='PostRelay local notification dashboard')
    parser.add_argument('--host', default='127.0.0.1', choices=['127.0.0.1', '0.0.0.0'])
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', default='./data')
    parser.add_argument('--mode', choices=['demo', 'selfhost'], default='demo')
    parser.add_argument('--live', action='store_true', help='Enable actual Discord deliveries in selfhost mode')
    parser.add_argument('--capture-push', action='store_true', help='Privately capture unknown push JSON locally without forwarding it')
    parser.add_argument('--relay-web-push', action='store_true', help='Verify public X posts referenced by data.url and relay them')
    parser.add_argument('--public-url', default=os.environ.get('POSTRELAY_PUBLIC_URL', ''))
    args = parser.parse_args()
    signup_key = os.environ.get('POSTRELAY_SIGNUP_KEY', '')
    if args.host == '0.0.0.0' and (not args.public_url or len(signup_key) < 20):
        parser.error('0.0.0.0 requires an explicit public URL and POSTRELAY_SIGNUP_KEY of at least 20 characters')
    if args.public_url:
        parsed = urlsplit(args.public_url)
        if parsed.scheme not in {'http', 'https'} or not parsed.netloc or parsed.path not in {'', '/'} or parsed.query or parsed.fragment or parsed.username:
            parser.error('public URL must be an HTTP(S) origin without a path or credentials')
    if args.mode == 'demo' and args.live:
        parser.error('demo mode cannot enable live delivery')
    data = Path(args.data_dir).resolve()
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    server = make_server(Store(data / 'postrelay.sqlite'), host=args.host, port=args.port,
                         mode=args.mode, live=args.live, public_url=args.public_url, signup_key=signup_key,
                         capture_push=args.capture_push, relay_web_push=args.relay_web_push)
    worker = threading.Thread(target=server.worker.run, args=(server.app.stop,), daemon=True)
    worker.start()
    print('PostRelay: ' + server.app.public_url, flush=True)
    print('Mode: ' + args.mode + (' / live Discord delivery enabled' if args.live else ' / no external delivery'), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.app.stop.set()
        server.server_close()
        worker.join(timeout=12)


if __name__ == '__main__':
    main()
