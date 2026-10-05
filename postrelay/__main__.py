import argparse
import os
import signal
import threading
from urllib.parse import urlsplit
from pathlib import Path
from .store import Store
from .server import make_server


def main():
    parser = argparse.ArgumentParser(description='PostRelay self-hosted notification dashboard')
    parser.add_argument('--host', default='127.0.0.1', choices=['127.0.0.1', '0.0.0.0'])
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--data-dir', default='./data')
    parser.add_argument('--mode', choices=['demo', 'selfhost'], default='demo')
    parser.add_argument('--live', action='store_true', help='Enable actual Discord deliveries in selfhost mode')
    parser.add_argument('--capture-push', action='store_true', help='Privately capture unknown push JSON locally without forwarding it')
    parser.add_argument('--relay-web-push', action='store_true', help='Verify public X posts referenced by data.url and relay them')
    parser.add_argument('--push-port', type=int, default=8767, help='Private loopback ingress port when the dashboard uses a server origin')
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
    if not 0 <= args.port <= 65535 or not 1 <= args.push_port <= 65535:
        parser.error('ports must be in range')
    if args.mode == 'demo' and (args.capture_push or args.relay_web_push):
        parser.error('demo mode cannot receive actual X push notifications')
    data = Path(args.data_dir).resolve()
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    store = Store(data / 'postrelay.sqlite')
    private_ingress = (args.capture_push or args.relay_web_push) and (
        args.host != '127.0.0.1' or
        (args.public_url and urlsplit(args.public_url).hostname not in {'127.0.0.1', 'localhost'}))
    if private_ingress and args.push_port == args.port:
        parser.error('the private push port must differ from the dashboard port')
    server = make_server(store, host=args.host, port=args.port,
                         mode=args.mode, live=args.live, public_url=args.public_url, signup_key=signup_key,
                         capture_push=args.capture_push and not private_ingress,
                         relay_web_push=args.relay_web_push and not private_ingress)
    servers = [server]
    if private_ingress:
        try:
            receiver = make_server(store, port=args.push_port, mode='selfhost', live=args.live,
                                  capture_push=args.capture_push, relay_web_push=args.relay_web_push)
        except Exception:
            server.server_close()
            raise
        receiver.app.stop = server.app.stop
        servers.append(receiver)
    worker = threading.Thread(target=server.worker.run, args=(server.app.stop,), daemon=True)
    worker.start()
    print('PostRelay: ' + server.app.public_url, flush=True)
    print('Mode: ' + args.mode + (' / live Discord delivery enabled' if args.live else ' / no external delivery'), flush=True)
    if private_ingress:
        print('X push ingress: loopback only / port ' + str(args.push_port), flush=True)
    # Signal handlers only set the event; shutdown runs outside serve_forever.
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda _signal, _frame: server.app.stop.set())
    threads = [threading.Thread(target=item.serve_forever, daemon=True) for item in servers]
    for thread in threads:
        thread.start()
    try:
        server.app.stop.wait()
    finally:
        server.app.stop.set()
        for item in servers:
            item.shutdown()
            item.server_close()
        for thread in threads:
            thread.join(timeout=2)
        worker.join(timeout=12)


if __name__ == '__main__':
    main()
