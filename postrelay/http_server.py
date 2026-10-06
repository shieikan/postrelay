"""Bounded admission and a monotonic lifetime for each HTTP connection."""
import socket
import threading
import time
from http.server import ThreadingHTTPServer


class BoundedHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, handler, *, deadline=15, max_connections=16):
        self.deadline = deadline
        self.slots = threading.BoundedSemaphore(max_connections)
        self.connections = {}
        self.connection_lock = threading.Lock()
        self.closed = threading.Event()
        super().__init__(address, handler)
        # One watchdog per listener, rather than a timer thread per client.
        self.watchdog = threading.Thread(target=self.expire_connections, daemon=True)
        self.watchdog.start()

    @staticmethod
    def disconnect(request):
        try:
            request.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        request.close()

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            # Never parse input or allocate another handler for an overload response.
            try:
                request.settimeout(.05)
                request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nConnection: close\r\n'
                                b'Retry-After: 1\r\nContent-Length: 0\r\n\r\n')
            except OSError:
                pass
            finally:
                self.disconnect(request)
            return
        with self.connection_lock:
            self.connections[request] = time.monotonic() + self.deadline
        request.settimeout(self.deadline)
        try:
            super().process_request(request, address)
        except Exception:
            self.release(request)
            raise

    def release(self, request):
        with self.connection_lock:
            self.connections.pop(request, None)
        self.slots.release()

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.release(request)

    def handle_error(self, request, client_address):
        # Timeout/disconnect diagnostics must not expose paths, cookies or bodies.
        pass

    def expire_connections(self):
        while not self.closed.wait(min(.05, self.deadline / 4)):
            with self.connection_lock:
                expired = [request for request, until in self.connections.items()
                           if time.monotonic() >= until]
                for request in expired:
                    self.connections.pop(request)
                    # Close under the lock so a recycled fd cannot be shut down later.
                    self.disconnect(request)

    def server_close(self):
        self.closed.set()
        with self.connection_lock:
            for request in self.connections:
                self.disconnect(request)
            self.connections.clear()
        super().server_close()
        self.watchdog.join(timeout=1)
