# Buddy's Browser: Chromium on a virtual screen, with a live view for Takeovers.
FROM debian:trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates chromium fonts-liberation fonts-noto-core \
      novnc python3 socat websockify x11vnc xvfb \
 && rm -rf /var/lib/apt/lists/*

COPY chromium-policies.json /etc/chromium/policies/managed/buddy.json
COPY takeover.html /usr/share/novnc/takeover.html
COPY login-done.html /usr/share/novnc/login-done.html
COPY start.sh /usr/local/bin/start-buddys-browser
COPY close-chromium.py /usr/local/bin/close-chromium.py

RUN useradd --create-home buddy \
 && mkdir /profile \
 && chown buddy:buddy /profile

USER buddy
VOLUME /profile
EXPOSE 6080 9222
ENTRYPOINT ["/bin/sh", "/usr/local/bin/start-buddys-browser"]
