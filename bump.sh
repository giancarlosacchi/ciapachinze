#!/bin/sh
# Aggiorna il numero di versione nei riferimenti a css/js così i browser scaricano sempre i file nuovi
V=$(date +%Y%m%d%H%M)
sed -i -E "s/(style\.css|app\.js|engine\.js|arcade\.js|manifest\.webmanifest)(\?v=[0-9]+)?/\1?v=$V/g" index.html
sed -i -E "s/const CACHE = .cpz-v[0-9]*.;/const CACHE = 'cpz-v$V';/" sw.js
sed -i -E "s/const APP_VERSION = '[^']*'/const APP_VERSION = '$V'/" app.js
echo "versione $V"
