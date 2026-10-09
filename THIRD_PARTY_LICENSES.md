# Third-party licenses

## Cloudflare adapter

The optional `cloudflare/` adapter ports Mozilla AutoPush and X registration
compatibility code from Angelic-Angel. Its exact revision, archive checksum,
changes and full MIT notice are in [cloudflare/NOTICE](cloudflare/NOTICE).

`htmlparser2` and its dependencies retain their respective licenses as installed
by npm. The exact runtime and development dependency versions are pinned in
`cloudflare/package-lock.json`. These dependencies are not relicensed by PostRelay.

## Tabler Icons

Selected outline icons are embedded in web/app.js.
Source: https://github.com/tabler/tabler-icons
Commit: a49ebdf8e13cc30794a5629c5b637e13ed5699d0

MIT License

Copyright (c) 2020-2026 Paweł Kuna

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


## Container runtime components

The application container uses official CPython3.12.15 on Google's distroless Debian13 runtime. CPython's installed `LICENSE.txt` is retained under `/usr/local/lib/python3.12/`. Added Debian libraries retain their package records and copyright notices under `/var/lib/dpkg/status.d/` and `/usr/share/doc/`. The build inventory is `/usr/share/postrelay/python-runtime.json`; CI saves the actual file inventory and SBOM. Optional curses/readline/Tk/native UUID extensions and pip are omitted because the application does not use them.

The receiver uses the same distroless runtime and retains Angelic-Angel's MIT notice in `/usr/share/doc/angelic-angel/LICENSE`. Its exact upstream revision, source checksum, patch and dependency lock are documented in [integrations/README.md](integrations/README.md). Distroless retains notices and package records for its own components; these components retain their respective licenses and are not relicensed by PostRelay.

## Public embed metadata

The Cloudflare adapter uses the public embed token calculation from Vercel react-tweet. Its MIT notice is retained in [cloudflare/NOTICE](cloudflare/NOTICE). No react-tweet package is installed.
