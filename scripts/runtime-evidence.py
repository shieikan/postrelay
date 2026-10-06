"""Save actual synthetic CI image identities, file inventory and Python facts."""
import json
import os
import subprocess
import sys
import tarfile
from pathlib import Path


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('Run this isolated image check in GitHub Actions only.')
    output = Path(sys.argv[1]); output.mkdir(parents=True, exist_ok=True)
    probe = """import importlib,json,pathlib,pyexpat,sqlite3,ssl,sys,os
for path in pathlib.Path('/usr/local/lib/python3.12/lib-dynload').glob('*.so'):
    importlib.import_module(path.name.split('.')[0])
assert sys.version_info[:3] == (3,12,15)
assert tuple(map(int,pyexpat.EXPAT_VERSION.removeprefix('expat_').split('.'))) >= (2,8,5)
assert ssl.create_default_context().get_ca_certs()
assert sqlite3.connect(':memory:').execute('select 1').fetchone() == (1,)
assert os.getuid() == 10001
assert pathlib.Path('/data').stat().st_mode & 0o777 == 0o700
assert pathlib.Path('/usr/local/lib/python3.12/LICENSE.txt').is_file()
print(json.dumps({'python':sys.version.split()[0], 'openssl':ssl.OPENSSL_VERSION,
 'expat':pyexpat.EXPAT_VERSION,'all_shipped_extensions_import':True,
 'ca_certificates':True,'sqlite':True,'uid':os.getuid(),
 'build_inventory':json.loads(pathlib.Path('/usr/share/postrelay/python-runtime.json').read_text())}))
"""
    facts = subprocess.run(['docker', 'run', '--rm', '--network', 'none', 'postrelay-postrelay',
                            'python', '-B', '-c', probe], capture_output=True, text=True, check=True).stdout
    (output / 'python-runtime.json').write_text(facts)
    for image, name in [('postrelay-postrelay', 'postrelay'), ('postrelay-angelic', 'angelic')]:
        container = subprocess.run(['docker', 'create', image], capture_output=True, text=True, check=True).stdout.strip()
        try:
            process = subprocess.Popen(['docker', 'export', container], stdout=subprocess.PIPE)
            with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
                files = {member.name.lstrip('./'): {'mode': oct(member.mode), 'size': member.size,
                                                   'type': member.type.decode('ascii'),
                                                   'uid': member.uid, 'gid': member.gid}
                         for member in archive}
            process.stdout.close()
            assert process.wait(timeout=30) == 0
            for forbidden in ['bin/sh', 'usr/bin/sh', 'bin/mount', 'usr/bin/mount', 'usr/bin/nsenter',
                              'usr/bin/infocmp', 'usr/bin/perl', 'usr/lib/systemd/systemd-homed']:
                assert forbidden not in files, 'Unused executable remains in runtime image'
            (output / (name + '-files.json')).write_text(json.dumps(files, sort_keys=True, indent=2) + '\n')
            private_path = 'private' if name == 'angelic' else 'data'
            assert files[private_path]['mode'] == '0o700'
            assert files[private_path]['uid'] == files[private_path]['gid'] == 10001
            assert any(path.startswith('var/lib/dpkg/status.d/') for path in files), 'Runtime package records missing'
            if name == 'angelic':
                assert 'usr/local/bin/postrelay-angelic' in files
                assert 'usr/share/doc/angelic-angel/Cargo.lock' in files
                assert not any('/python' in path for path in files), 'Python remains in Rust receiver'
            (output / (name + '-files.json')).write_text(json.dumps(files, sort_keys=True, indent=2) + '\n')
        finally:
            subprocess.run(['docker', 'rm', container], check=True, capture_output=True)
    print('Both runtime inventories retained; unused executables absent; Python/SSL/Expat/SQLite checked.')


if __name__ == '__main__':
    main()
