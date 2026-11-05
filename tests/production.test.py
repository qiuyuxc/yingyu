#!/usr/bin/env python3
"""Exercise the built CLI and production server using disposable data."""
import json
import os
import pty
import re
import secrets
import select
import socket
import sqlite3
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path


class ProductionTest(unittest.TestCase):
    def test_administrator_initialization_and_production_startup(self):
        source = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory(prefix="yingyu-production-test-") as data_dir:
            env = os.environ.copy()
            env.update(
                NODE_ENV="production", DATA_DIR=data_dir,
                ENCRYPTION_KEY=secrets.token_hex(32),
                PUBLIC_URL="https://production.example.test",
                HOST="127.0.0.1", TRUST_PROXY="0",
            )
            password = secrets.token_urlsafe(24)
            master, slave = pty.openpty()
            setup = subprocess.Popen(
                ["node", "dist-server/server/setup.js"],
                stdin=slave, stdout=slave, stderr=slave, cwd=source, env=env,
            )
            os.close(slave)
            transcript = bytearray()
            offset = 0

            def answer(prompt, value):
                nonlocal offset
                deadline = time.monotonic() + 20
                while prompt.encode() not in transcript[offset:]:
                    self.assertLess(time.monotonic(), deadline, "administrator prompt timed out")
                    if select.select([master], [], [], 1)[0]:
                        transcript.extend(os.read(master, 65536))
                offset = len(transcript)
                os.write(master, (value + "\n").encode())

            try:
                answer("管理员邮箱：", "deployment-smoke@example.test")
                answer("管理员名称：", "部署测试管理员")
                answer("输入隐藏）：", password)
                answer("确认密码：", password)
                self.assertEqual(setup.wait(timeout=20), 0)
                # Drain remaining output so the assertion covers both inputs.
                while select.select([master], [], [], 0)[0]:
                    try:
                        chunk = os.read(master, 65536)
                        if not chunk:
                            break
                        transcript.extend(chunk)
                    except OSError:
                        break
                self.assertFalse(password.encode() in transcript, "password was echoed by the terminal")
            finally:
                os.close(master)
                if setup.poll() is None:
                    setup.terminate()
                    setup.wait(timeout=5)
            repeat = subprocess.run(
                ["node", "dist-server/server/setup.js"], input="", text=True,
                capture_output=True, cwd=source, env=env, timeout=20,
            )
            self.assertEqual(repeat.returncode, 0)
            self.assertIn("管理员已经创建", repeat.stdout)
            with sqlite3.connect(Path(data_dir) / "yingyu.sqlite") as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT role FROM users").fetchone()[0], "admin")
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                env["PORT"] = str(listener.getsockname()[1])
            origin = "http://127.0.0.1:" + env["PORT"]
            server = subprocess.Popen(
                ["node", "dist-server/server/index.js"], stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, cwd=source, env=env,
            )
            try:
                deadline = time.monotonic() + 20
                while True:
                    try:
                        with urllib.request.urlopen(origin + "/api/health", timeout=2) as response:
                            self.assertEqual(response.status, 200)
                        break
                    except (OSError, urllib.error.URLError):
                        self.assertLess(time.monotonic(), deadline, "production server startup timed out")
                        self.assertIsNone(server.poll(), "production server exited")
                        time.sleep(0.1)
                with urllib.request.urlopen(origin + "/app/settings") as response:
                    self.assertEqual(response.status, 200)
                    html = response.read().decode()
                    self.assertIn('id="root"', html)
                    self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
                script = re.search(r'<script[^>]+src="([^"]+)"', html)
                self.assertIsNotNone(script, "production JavaScript entry is missing")
                with urllib.request.urlopen(origin + script.group(1)) as response:
                    self.assertIn("/third-party-notices.txt", response.read().decode(), "the minifier removed the license reference")
                with urllib.request.urlopen(origin + "/third-party-notices.txt") as response:
                    notices = response.read().decode()
                    self.assertIn("Apache License", notices)
                    self.assertIn("react@", notices)
                    self.assertIn("Unsplash", notices)
                request = urllib.request.Request(
                    origin + "/api/auth/login",
                    data=json.dumps({"email": "deployment-smoke@example.test", "password": password}).encode(),
                    headers={"Origin": env["PUBLIC_URL"], "Content-Type": "application/json"},
                )
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(json.load(response)["user"]["role"], "admin")
                    cookie = response.headers["Set-Cookie"]
                    self.assertIn("__Host-yingyu_session=", cookie)
                    self.assertIn("Secure", cookie)
                    self.assertIn("HttpOnly", cookie)
                request = urllib.request.Request(origin + "/api/auth/me", headers={"Cookie": cookie.split(";")[0]})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(json.load(response)["user"]["email"], "deployment-smoke@example.test")
            finally:
                server.terminate()
                server.communicate(timeout=10)
                self.assertEqual(server.returncode, 0, "production server did not shut down cleanly")


if __name__ == "__main__":
    unittest.main()
