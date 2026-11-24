#!/bin/sh
# Connects www.mavynews.com to the MAVY NEWS server on this VPS. Safe to run again.
# Adds ONE new nginx site (mavynews.com). rentipa.com and themavy.com are not touched.
# If anything fails, the new site is removed again and nginx keeps running as before.
set -u
RAW=https://raw.githubusercontent.com/Mavytechsolutions/newsdesk-reporter/mavy-news-app/deploy
SITE=/etc/nginx/sites-available/mavynews.com
ME=194.238.17.81

echo "1/3  Adding mavynews.com to nginx..."
if [ ! -f "$SITE" ] || ! grep -q "listen 443" "$SITE"; then
  curl -fsSL "$RAW/nginx-mavynews.conf" -o /tmp/mavynews.conf || { echo "Could not download the settings. Check internet and try again."; exit 1; }
  cp /tmp/mavynews.conf "$SITE"
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/mavynews.com
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && echo "     OK"
else
  rm -f /etc/nginx/sites-enabled/mavynews.com
  nginx -t
  echo "     Problem found, so nothing was changed. Please send this screen to Claude."
  exit 1
fi

echo "2/3  Checking that mavynews.com points to this server..."
A=$(getent ahostsv4 mavynews.com | awk '{print $1; exit}')
W=$(getent ahostsv4 www.mavynews.com | awk '{print $1; exit}')
if [ "$A" != "$ME" ] || [ "$W" != "$ME" ]; then
  echo "     Not yet: mavynews.com -> ${A:-none}, www -> ${W:-none} (should be $ME)."
  echo "     Change the A record in GoDaddy, wait 15-30 minutes, then run this command again."
  exit 0
fi
echo "     OK"

echo "3/3  Getting the free https certificate (padlock)..."
if ! command -v certbot >/dev/null 2>&1; then apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx; fi
if certbot --nginx -d mavynews.com -d www.mavynews.com --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
  nginx -t && systemctl reload nginx
  echo ""
  echo "DONE: https://www.mavynews.com is live."
else
  echo "     The certificate step failed. Please send this screen to Claude."
  exit 1
fi
