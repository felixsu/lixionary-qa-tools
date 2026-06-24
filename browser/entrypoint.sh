#!/bin/bash
set -e

# Find the Chromium binary path installed by Playwright
echo "Searching for Playwright Chromium binary..."
PLAYWRIGHT_CHROME_PATH=$(find /ms-playwright -name chrome -type f | head -n 1)

if [ -z "$PLAYWRIGHT_CHROME_PATH" ]; then
    echo "Playwright Chromium not found in /ms-playwright. Checking /root/.cache..."
    PLAYWRIGHT_CHROME_PATH=$(find /root/.cache/ms-playwright -name chrome -type f | head -n 1)
fi

if [ -z "$PLAYWRIGHT_CHROME_PATH" ]; then
    echo "ERROR: Playwright Chromium binary could not be found!"
    exit 1
fi

echo "Found Chromium binary at: $PLAYWRIGHT_CHROME_PATH"
export CHROMIUM_PATH="$PLAYWRIGHT_CHROME_PATH"

# Run supervisord to start Xvfb, x11vnc, websockify, and Chromium
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
