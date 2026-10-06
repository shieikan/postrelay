"""Fetch fixed official scanner archives and verify the published SHA-256.

Only the requested binary is extracted; archive paths are never executed or
unpacked onto the filesystem. This is not signature/provenance attestation.
"""
import argparse
import hashlib
import io
import json
import os
import platform
import tarfile
from pathlib import Path
from urllib.request import urlopen

VERSIONS = {'gitleaks': '8.30.1', 'trivy': '0.75.0'}
REPOSITORIES = {'gitleaks': 'gitleaks/gitleaks', 'trivy': 'aquasecurity/trivy'}
ASSETS = {
    ('Darwin', 'arm64'): {'gitleaks': 'darwin_arm64', 'trivy': 'macOS-ARM64'},
    ('Linux', 'x86_64'): {'gitleaks': 'linux_x64', 'trivy': 'Linux-64bit'},
    ('Linux', 'aarch64'): {'gitleaks': 'linux_arm64', 'trivy': 'Linux-ARM64'},
}


def download(url):
    if not url.startswith('https://github.com/'):
        raise ValueError('Scanner downloads must use official GitHub HTTPS URLs.')
    # Fixed official HTTPS release URLs; checksum validation precedes extraction.
    with urlopen(url, timeout=60) as response:  # nosec B310
        if not response.geturl().startswith('https://'):
            raise ValueError('Scanner download redirected away from HTTPS.')
        data = response.read(256 * 1024 * 1024 + 1)
    if len(data) > 256 * 1024 * 1024:
        raise ValueError('Scanner download is too large.')
    return data


def install(name, directory):
    variants = ASSETS.get((platform.system(), platform.machine()))
    if not variants:
        raise ValueError('This scanner installer supports Linux and Apple Silicon macOS.')
    version = VERSIONS[name]
    archive = f'{name}_{version}_{variants[name]}.tar.gz'
    base = f'https://github.com/{REPOSITORIES[name]}/releases/download/v{version}/'
    checksums = download(base + f'{name}_{version}_checksums.txt').decode()
    checksum = next((line.split()[0] for line in checksums.splitlines()
                     if len(line.split()) == 2 and line.split()[1].lstrip('*') == archive), None)
    if checksum is None:
        raise ValueError('Official checksum is missing.')
    data = download(base + archive)
    if hashlib.sha256(data).hexdigest() != checksum:
        raise ValueError('Scanner archive checksum does not match.')
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as source:
        member = next((m for m in source.getmembers() if m.name in {name, './' + name} and m.isfile()), None)
        if not member or member.size > 256 * 1024 * 1024:
            raise ValueError('Scanner binary is missing or too large.')
        with source.extractfile(member) as handle:
            binary = handle.read()
    directory = Path(directory); directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / name
    with path.open('xb') as handle:
        handle.write(binary)
    path.chmod(0o700)
    return {'name': name, 'version': version, 'repository': REPOSITORIES[name], 'archive_sha256': checksum,
            'binary_sha256': hashlib.sha256(binary).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description='Install checksum-verified analysis tools in an isolated directory')
    parser.add_argument('--directory', required=True)
    parser.add_argument('--only', choices=VERSIONS)
    args = parser.parse_args()
    os.umask(0o077)
    results = [install(name, args.directory) for name in ([args.only] if args.only else VERSIONS)]
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
