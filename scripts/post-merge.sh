#!/bin/bash
set -e

export PLAYWRIGHT_BROWSERS_PATH=./playwright-browsers

if compgen -G "./playwright-browsers/chromium-*" > /dev/null && \
   compgen -G "./playwright-browsers/chromium_headless_shell-*" > /dev/null; then
  export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
fi

npm install --no-audit --no-fund

npm run db:push
