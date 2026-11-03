#!/bin/sh
set -eu

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(dirname "$0")/..}"

# Use one workflow variable for both the native app and the web extension.
case "${GATEWAY_HOST:-}" in
  ''|*[!A-Za-z0-9.-]*)
    echo 'error: Set GATEWAY_HOST in the Xcode Cloud workflow environment (hostname only, without https:// or a path).'
    exit 1
    ;;
esac
printf 'GATEWAY_HOST = %s\n' "$GATEWAY_HOST" > Secrets.xcconfig
printf 'VITE_GATEWAY_URL=https://%s\n' "$GATEWAY_HOST" > extension/.env.local

export HOMEBREW_NO_AUTO_UPDATE=1
brew install node@24 corepack
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix)/bin:$PATH"
cd extension
corepack pnpm install --frozen-lockfile
