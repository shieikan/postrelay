"""Check the shipped nginx example with synthetic HTTPS on an Actions runner."""
import json
import os
import socket
import ssl
import subprocess
import tempfile
import threading
from http.client import HTTPSConnection
from pathlib import Path
from postrelay.server import make_server
from postrelay.store import Store


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Run this isolated proxy check in GitHub Actions only.')
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        # nginx runs as the CI user; use only unprivileged loopback ports.
        server = make_server(Store(root / 'state.sqlite'), port=0, mode='selfhost',
                             public_url='https://notify.example.com')
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        key, certificate = root / 'test-key.pem', root / 'test-cert.pem'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                        '-subj', '/CN=notify.example.com', '-addext', 'subjectAltName=DNS:notify.example.com',
                        '-keyout', str(key), '-out', str(certificate)], check=True, capture_output=True)
        config = Path('integrations/nginx/nginx.conf').read_text()
        config = config.replace('/run/nginx.pid', str(root / 'nginx.pid'))
        config = config.replace('listen 443 ssl', f'listen 127.0.0.1:{port} ssl')
        config = config.replace('/etc/letsencrypt/live/notify.example.com/fullchain.pem', str(certificate))
        config = config.replace('/etc/letsencrypt/live/notify.example.com/privkey.pem', str(key))
        config = config.replace('http://127.0.0.1:8765', f'http://127.0.0.1:{server.server_address[1]}')
        config = config.replace('http {', f'http {{\n client_body_temp_path {root}/body;\n proxy_temp_path {root}/proxy;')
        path = root / 'nginx.conf'; path.write_text(config)
        subprocess.run(['nginx', '-t', '-c', str(path), '-p', str(root)], check=True, capture_output=True)
        process = subprocess.Popen(['nginx', '-c', str(path), '-p', str(root), '-g', 'daemon off;'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        context = ssl.create_default_context(cafile=str(certificate))
        try:
            import time
            deadline = time.monotonic() + 5
            while True:
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        break
                except OSError:
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError('Synthetic HTTPS proxy did not start')
                    time.sleep(.05)
            def request(path, expected, host='notify.example.com', data=None):
                # Connect to loopback with the certificate's hostname/SNI and verified TLS.
                connection = HTTPSConnection('notify.example.com', port, context=context, timeout=3)
                connection._create_connection = lambda address, timeout, source=None: socket.create_connection(('127.0.0.1', port), timeout)
                try:
                    connection.request('GET' if data is None else 'POST', path, body=data,
                        headers={'Host': host, 'Content-Type': 'application/json', 'X-PostRelay': '1'})
                    response = connection.getresponse()
                    assert response.status == expected, f'Proxy response {response.status}, expected {expected}'
                    response.read()
                finally:
                    connection.close()
            request('/api/bootstrap', 200)
            request('/api/bootstrap', 421, host='other.example.test')
            request('/api/push/synthetic-invalid-token', 404, data='{}')
            request('/api/login', 413, data='x' * 65537)
            assert not (root / 'error.log').exists()
            print(json.dumps({'nginx_syntax': True, 'verified_https': True, 'host_rejected': True,
                              'raw_push_rejected': True, 'oversize_rejected': True,
                              'external_notifications_sent': 0}))
        finally:
            process.terminate(); process.communicate(timeout=5)
            server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__':
    main()
