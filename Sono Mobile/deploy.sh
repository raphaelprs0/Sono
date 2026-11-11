#!/bin/sh
# Met en ligne le service de Sono (compte Cloudflare gratuit) et note son adresse pour l’app iPhone.
set -e
cd "$(dirname "$0")"
(cd web && npm install --silent && npx vite build)
cd cloud && npm install --silent
npx wrangler deploy | tee /tmp/sono-deploy.log
url=$(grep -Eo 'https://[a-zA-Z0-9.-]+\.workers\.dev' /tmp/sono-deploy.log | head -1)
[ -n "$url" ] || { echo "Adresse introuvable dans la sortie de wrangler."; exit 1; }
rest=${url#https://}
sed -i '' "s#^SONO_SERVER_URL = .*#SONO_SERVER_URL = https:/\$()/$rest#" ../ios/Config.xcconfig
echo "Service en ligne : $url"
