# Shared live meta.json fetch for stale-watchdog / decide scripts.
# Cache-busts GitHub Pages (max-age=600) so polls can see a just-deployed file.
#
# Usage: source this file, then curl_live_meta "$LIVE_META_URL" [extra curl args...]

curl_live_meta() {
  local url="$1"
  shift
  local sep='?'
  [[ "${url}" == *\?* ]] && sep='&'
  local busted="${url}${sep}cowx_cb=$(date +%s)"
  curl -fsS --max-time 30 \
    -H 'Cache-Control: no-cache' \
    -H 'Pragma: no-cache' \
    "$@" \
    "${busted}"
}
