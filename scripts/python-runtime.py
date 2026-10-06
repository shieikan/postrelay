"""Assemble the official CPython runtime on distroless, retaining package records.

Build-stage helper only: ELF dependencies are read from trusted official image
binaries. No package metadata is erased to conceal an installed component.
"""
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


# Already shipped by distroless cc-debian13; do not overwrite its libraries/records.
BASE_LIBRARIES = re.compile(r'^(ld-linux.*|lib(c|m|dl|pthread|rt|resolv|util|ssl|crypto|z|zstd|gcc_s|stdc\+\+)\.so.*)$')


def main():
    root = Path('/runtime')
    local = root / 'usr/local'
    shutil.copytree('/usr/local', local, symlinks=True)
    for directory in [local / 'include', local / 'lib/pkgconfig']:
        shutil.rmtree(directory, ignore_errors=True)
    for path in (local / 'bin').iterdir():
        if path.name not in {'python', 'python3', f'python{sys.version_info.major}.{sys.version_info.minor}'}:
            path.unlink()
    library = local / f'lib/python{sys.version_info.major}.{sys.version_info.minor}'
    # Interactive terminal editing and package installation are not application features.
    for pattern in ['lib-dynload/_curses*.so', 'lib-dynload/readline*.so', 'lib-dynload/_tkinter*.so', 'lib-dynload/_uuid*.so']:
        for path in library.glob(pattern):
            path.unlink()
    for directory in ['ensurepip', 'site-packages']:
        shutil.rmtree(library / directory, ignore_errors=True)
    (library / 'site-packages').mkdir()
    packages, copied = set(), set()
    pending = list(local.rglob('*.so')) + list(local.glob('lib/libpython*.so.*')) + [local / 'bin' / f'python{sys.version_info.major}.{sys.version_info.minor}']
    pending = [Path("/usr/local") / p.relative_to(local) for p in pending]
    checked = set()
    while pending:
        binary = pending.pop().resolve()
        if binary in checked:
            continue
        checked.add(binary)
        result = subprocess.run(['ldd', str(binary)], text=True, capture_output=True, check=True,
                                env=dict(os.environ, LD_LIBRARY_PATH='/usr/local/lib'))
        if 'not found' in result.stdout:
            raise RuntimeError('Unresolved trusted build library: ' + str(binary) + '\n' + result.stdout)
        for value in re.findall(r'(?:=>\s+)?(/[^\s]+)\s+\(', result.stdout):
            soname = Path(value).name
            dependency = Path(value).resolve()
            if dependency.is_relative_to(local) or str(dependency).startswith('/usr/local/') or BASE_LIBRARIES.fullmatch(dependency.name):
                continue
            target = root / dependency.relative_to('/')
            if dependency not in copied:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dependency, target)
                if soname != dependency.name:
                    (target.parent / soname).symlink_to(dependency.name)
                copied.add(dependency); pending.append(dependency)
                owner = subprocess.run(['dpkg-query', '-S', str(dependency)], text=True, capture_output=True, check=True)
                packages.add(owner.stdout.split(': /', 1)[0])
    records = root / 'var/lib/dpkg/status.d'
    records.mkdir(parents=True, exist_ok=True)
    for package in sorted(packages):
        record = subprocess.run(['dpkg-query', '-s', package], text=True, capture_output=True, check=True).stdout
        (records / ('postrelay-' + package.replace(':', '_'))).write_text(record)
    import ssl
    import pyexpat
    inventory = {'python': sys.version.split()[0], 'openssl_build': ssl.OPENSSL_VERSION,
                 'bundled_expat': pyexpat.EXPAT_VERSION, 'extra_libraries': sorted(str(p) for p in copied),
                 'extra_debian_packages': sorted(packages), 'source': 'docker.io/library/python:3.12.15-slim-trixie',
                 'omitted_optional_extensions': ['_curses', '_curses_panel', 'readline', '_tkinter', '_uuid']}
    info = root / 'usr/share/postrelay'
    info.mkdir(parents=True); (info / 'python-runtime.json').write_text(json.dumps(inventory, indent=2) + '\n')
    for package in packages:
        name = package.split(':')[0]
        source = Path('/usr/share/doc') / name
        if source.exists():
            shutil.copytree(source, root / 'usr/share/doc' / name, symlinks=True, dirs_exist_ok=True)
    Path('/runtime-data').mkdir(mode=0o700)


if __name__ == '__main__':
    main()
