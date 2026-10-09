"""Drive the real setup CLI through a POSIX terminal with synthetic secrets only."""
import errno
import json
import os
import pty
import select
import signal
import sys
import time

node, script, root = sys.argv[1:]
pid, terminal = pty.fork()
if pid == 0:
    os.chdir(root)
    os.execv(node, [node, script])

steps = [
    ('Worker URL', 'https://postrelay.example.workers.dev', False),
    ('通知するXユーザー名', 'demo_studio', False),
    ('この設定で作成しますか', 'yes', False),
    ('Discord Webhook URL', 'https://discord.com/api/webhooks/123/pty_hidden_webhook', True),
    ('Xアカウントの auth_token', 'pty_hidden_auth_token_123456', True),
    ('Xアカウントの ct0', 'pty_hidden_csrf_token_123456', True),
]
transcript = b''
seen = b''
index = 0
exited = False
try:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if select.select([terminal], [], [], 0.1)[0]:
            try:
                chunk = os.read(terminal, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                chunk = b''
            if not chunk:
                break
            transcript += chunk
            seen += chunk
            if index < len(steps) and steps[index][0].encode() in seen and b': ' in seen:
                os.write(terminal, (steps[index][1] + '\n').encode())
                index += 1
                seen = b''
        child, status = os.waitpid(pid, os.WNOHANG)
        if child:
            exited = True
            assert os.waitstatus_to_exitcode(status) == 0, 'setup exited unsuccessfully'
            break
    assert index == len(steps), 'setup did not finish all prompts'
    for _, value, hidden in steps:
        assert not hidden or value.encode() not in transcript, 'secret was echoed by the terminal'
    with open(os.path.join(root, '.postrelay/settings.json'), encoding='utf-8') as handle:
        settings = json.load(handle)
    assert settings['secrets']['X_AUTH_TOKEN'] == steps[4][1]
    assert settings['secrets']['X_CSRF_TOKEN'] == steps[5][1]
    assert settings['config']['feeds'][0]['webhook_url'] == steps[3][1]
    print('PTY setup saved synthetic credentials without echoing them.')
finally:
    os.close(terminal)
    if not exited:
        child, _ = os.waitpid(pid, os.WNOHANG)
        if not child:
            os.kill(pid, signal.SIGTERM)
            os.waitpid(pid, 0)
