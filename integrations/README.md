# Angelic-Angel integration patch

Source: [sh1ma/Angelic-Angel](https://github.com/sh1ma/Angelic-Angel), commit `169a098e2025cc6e41a50fc8d521c483e21d9b6d` (2026-03-05). `angelic-hardening.patch` is a local MIT-licensed patch against that exact archive; it is not an upstream release.

The optional Compose source container builds this pinned upstream with the patch applied. Interactive setup, private storage and server startup are documented in the [server guide](../docs/server.md). The Dockerfile verifies the downloaded archive's SHA-256 before building; PostRelay and Angelic-Angel run as separate processes.

The source container replaces the upstream Cargo.lock with [the reviewed security lockfile](angelic/Cargo.lock). Targeted compatible updates cover the TLS/crypto and HTTP dependencies identified by the vulnerability scan; Cargo.toml and the upstream source pin stay unchanged. This override is part of the local integration, not an upstream release. Copy that lockfile into a standalone patched checkout before running the commands below if you want the same dependency versions as the source container.

Apply inside a clean checkout of the pinned commit, using the actual path to this directory:

```sh
patch -p1 < /path/to/postrelay/integrations/angelic-hardening.patch
cargo test --locked
cargo build --locked
```

The patch hides credentials, subscription endpoints and notification contents in status, logs and diagnostics; masks both interactive Cookie inputs; suppresses dependency logging; saves config atomically with Unix mode 0600; rejects symlink files and parents; requires an existing private parent directory (0700); and bounds X registration/Webhook HTTP requests to 10 seconds with redirects and environment proxies disabled. The config helper does not create directories. Use interactive credential input or a protected local config, never command-line secret arguments.

A non-2xx Webhook response becomes a processing error and the existing listener emits NotDelivered instead of Delivered. Backoff/fatal classifications are retained independently from redacted error formatting. This does not add durable source-side retry or prove that AutoPush redelivers failed notifications. Actual X/Discord credentials, notification schema and live delivery are not part of the patch's verification.

Original hardening-patch verification: 11 local unit tests and 1 CLI test passed; locked debug build passed; Cargo.toml and the original Cargo.lock were unchanged; patch application reconstructed all 7 changed/new files exactly. No account registration, live listening or external message was performed in that patch test. Later security-lock/build checks are recorded in [VERIFICATION.md](../VERIFICATION.md). The tests use synthetic values and loopback HTTP only.

Upstream and patch redistribution retain this license:

```text
MIT License

Copyright (c) 2026 sh1ma

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
