#!/usr/bin/env bash
set -e

mkdir -p .playwright-cli/responsive

VIEWPORTS=(
  "1920 1080 desktop-1080p"
  "2560 1440 desktop-2k"
  "1440 900 laptop-1440"
  "1366 768 laptop-lowheight"
  "1280 720 small-desktop"
  "1024 768 tablet-landscape"
  "768 1024 tablet-portrait"
  "430 932 phone-large-430"
  "390 844 phone-standard-390"
  "360 800 phone-small-360"
  "844 390 phone-landscape"
)

echo "=== STARTING RESPONSIVE LAYOUT VERIFICATION ==="

for VP in "${VIEWPORTS[@]}"; do
  read -r W H NAME <<< "$VP"
  echo "--- Testing Viewport: ${NAME} (${W}x${H}) ---"
  
  playwright-cli resize "$W" "$H" > /dev/null
  playwright-cli goto "http://localhost:3000" > /dev/null
  
  OVERFLOW=$(playwright-cli --raw eval '() => document.documentElement.scrollWidth > window.innerWidth')
  SCROLL_W=$(playwright-cli --raw eval '() => document.documentElement.scrollWidth')
  INNER_W=$(playwright-cli --raw eval '() => window.innerWidth')
  
  echo "  Home: innerW=${INNER_W}, scrollW=${SCROLL_W}, overflow=${OVERFLOW}"
  if [ "$OVERFLOW" = "true" ]; then
    echo "  [ERROR] Horizontal overflow detected on Home at ${W}x${H}!"
    exit 1
  fi
done

echo "=== ALL VIEWPORTS CHECKED CLEANLY FOR HOME ==="
