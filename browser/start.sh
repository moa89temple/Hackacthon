#!/bin/sh
# Runs the virtual screen, the live view and Chromium. The container stops when Chromium does,
# and Docker starts it again, so closing the browser window during a Takeover can't strand anyone.
set -eu

# A lock left by an earlier run would stop Chromium opening its profile.
rm -f /profile/SingletonLock /profile/SingletonCookie /profile/SingletonSocket

export DISPLAY=:99
Xvfb "$DISPLAY" -screen 0 720x1280x24 -nolisten tcp &

until [ -e /tmp/.X11-unix/X99 ]; do sleep 0.1; done

# The live view, for Takeovers. The raw VNC port stays inside the container.
x11vnc -display "$DISPLAY" -localhost -rfbport 5900 -forever -shared -nopw -quiet -bg -o /dev/null
websockify --web /usr/share/novnc 0.0.0.0:6080 127.0.0.1:5900 >/dev/null 2>&1 &

# Chromium only listens on the container's own loopback, so this carries the control port out.
socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223 &

# --restore-last-session keeps session cookies, such as Canvas's login, across restarts.
chromium \
  --user-data-dir=/profile \
  --remote-debugging-port=9223 \
  --restore-last-session \
  --no-first-run \
  --no-default-browser-check \
  --password-store=basic \
  --window-position=0,0 \
  --window-size=480,853 \
  --force-device-scale-factor=1.5 &
chromium_pid=$!

close_chromium() {
  python3 /usr/local/bin/close-chromium.py || kill -TERM "$chromium_pid"
  wait "$chromium_pid"
  exit 0
}
trap close_chromium TERM INT
wait "$chromium_pid"
