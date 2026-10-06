"""Wire-level resource limits; synthetic loopback connections, no delivery."""
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from postrelay.server import make_server
from postrelay.store import Store


class HTTPLimitTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.clients = []
        # Short deadlines keep the same production behavior observable in a bounded test.
        with patch('postrelay.server.REQUEST_DEADLINE', .3, create=True), \
                patch('postrelay.server.MAX_CONNECTIONS', 2, create=True):
            self.server = make_server(Store(Path(self.folder.name) / 'state.sqlite'), port=0, mode='selfhost')
        self.address = self.server.server_address
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()

    def tearDown(self):
        for client in self.clients:
            client.close()
        self.server.shutdown(); self.server.server_close(); self.thread.join(2)
        self.folder.cleanup()

    def connect(self):
        client = socket.create_connection(self.address, timeout=1)
        client.settimeout(.9)
        self.clients.append(client)
        return client

    def headers(self):
        return (f'POST /api/login HTTP/1.1\r\nHost: {self.address[0]}:{self.address[1]}\r\n'
                'Content-Type: application/json\r\nX-PostRelay: 1\r\nContent-Length: 64000\r\n\r\n').encode()

    def assert_closed(self, client):
        try:
            received = client.recv(4096)
        except ConnectionResetError:
            return
        except socket.timeout:
            self.fail('An unfinished request remained open beyond its total deadline')
        self.assertEqual(received, b'', 'Expired unfinished request should close without exposing input')

    def healthy(self):
        client = self.connect()
        client.sendall((f'GET /api/bootstrap HTTP/1.0\r\nHost: {self.address[0]}:{self.address[1]}\r\n\r\n').encode())
        self.assertIn(b'200', client.recv(4096).split(b'\r\n', 1)[0])

    def test_unfinished_headers_expire(self):
        client = self.connect(); client.sendall(b'POST /api/login HTTP/1.1\r\nX-Slow: ')
        self.assert_closed(client)
        self.healthy()

    def test_unfinished_body_expires_before_authentication(self):
        client = self.connect(); client.sendall(self.headers() + b'{')
        self.assert_closed(client)
        self.assertEqual(len(self.server.app.rates), 0)
        self.healthy()

    def test_trickling_bytes_cannot_reset_the_total_deadline(self):
        client = self.connect(); client.sendall(self.headers() + b'{')
        start = time.monotonic()
        while time.monotonic() - start < .55:
            try:
                client.sendall(b' ')
            except OSError:
                break
            time.sleep(.035)
        self.assert_closed(client)
        self.healthy()

    def test_admission_is_bounded_before_headers_and_recovers_after_disconnect(self):
        first, second = self.connect(), self.connect()
        first.sendall(b'G'); second.sendall(b'G')
        time.sleep(.05)
        extra = self.connect(); extra.sendall(b'G')
        try:
            response = extra.recv(4096)
        except socket.timeout:
            self.fail('Over-capacity connection was accepted as another indefinitely blocked handler')
        self.assertIn(b'503', response.split(b'\r\n', 1)[0])
        self.assertNotIn(b'G', response.split(b'\r\n\r\n', 1)[-1])
        first.close(); second.close(); time.sleep(.05)
        self.healthy()

    def test_invalid_request_releases_capacity(self):
        for _ in range(4):
            client = self.connect(); client.sendall(b'not-http\r\n\r\n')
            self.assertIn(b'400', client.recv(4096))
            client.close()
        self.healthy()

    def test_ambiguous_or_truncated_body_never_reaches_authentication(self):
        for header, body, close in [
            ('Content-Length: 2\r\nContent-Length: 3\r\n', b'{}', False),
            ('Transfer-Encoding: chunked\r\nContent-Length: 2\r\n', b'{}', False),
            ('Content-Length: 10\r\n', b'{}', True),
        ]:
            client = self.connect()
            prefix = (f'POST /api/login HTTP/1.1\r\nHost: {self.address[0]}:{self.address[1]}\r\n'
                      'Content-Type: application/json\r\nX-PostRelay: 1\r\n')
            client.sendall((prefix + header + '\r\n').encode() + body)
            if close:
                client.shutdown(socket.SHUT_WR)
            self.assertIn(b'400', client.recv(4096).split(b'\r\n', 1)[0])
            client.close()
        self.assertEqual(len(self.server.app.rates), 0)
        self.healthy()
