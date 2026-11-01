"""Asks Chromium to close itself over its control port.

SIGTERM makes Chromium exit without writing its latest cookies to the profile, which would lose
a login made in the last 30 seconds. Browser.close shuts it down properly. Standard library only,
so the image needs no extra packages.
"""
import base64
import json
import os
import socket
import struct
import urllib.parse
import urllib.request

PORT = 9223

with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=5) as response:
    path = urllib.parse.urlparse(json.load(response)["webSocketDebuggerUrl"]).path

with socket.create_connection(("127.0.0.1", PORT), timeout=5) as connection:
    key = base64.b64encode(os.urandom(16)).decode()
    connection.sendall(
        (
            f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
    )
    connection.recv(4096)

    message = json.dumps({"id": 1, "method": "Browser.close"}).encode()
    mask = os.urandom(4)
    masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(message))
    # One final text frame from a client, which must be masked. The message is under 126 bytes.
    connection.sendall(struct.pack("BB", 0x81, 0x80 | len(message)) + mask + masked)
    connection.recv(4096)
