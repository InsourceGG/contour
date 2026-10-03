#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .smoke
chmod 700 .smoke
base=http://localhost:3200
check() {
  local label="$1" expected="$2" output="$3"
  shift 3
  local status
  status=$(curl --silent --show-error --output "$output" --write-out '%{http_code}' "$@")
  if [[ "$status" != "$expected" ]]; then
    printf '%s: expected %s, received %s\n' "$label" "$expected" "$status"
    exit 1
  fi
  printf '%s: %s\n' "$label" "$status"
}
check 'Signed-out desk' 307 /dev/null "$base/desk"
check 'Login page' 200 .smoke/login.html "$base/login"
for account in riley casey dana; do
  check "$account sign-in" 303 /dev/null --cookie-jar ".smoke/$account.cookies" --data-urlencode "email=$account@northwind.demo" --data-urlencode 'password=northwind-demo-2026' "$base/api/auth/login"
  check "$account desk" 200 ".smoke/$account-desk.html" --cookie ".smoke/$account.cookies" "$base/desk"
done
for page in customers reports settings; do
  check "$page page" 200 ".smoke/$page.html" --cookie .smoke/riley.cookies "$base/$page"
done
check 'Admin team directory' 200 .smoke/admin.html --cookie .smoke/dana.cookies "$base/admin"
check 'Agent admin permission state' 200 .smoke/admin-denied.html --cookie .smoke/riley.cookies "$base/admin"
check 'Compact cards and 30-day CSAT' 200 .smoke/variants.html --cookie .smoke/riley.cookies "$base/desk?view=cards&density=compact&range=30d&kb=collapsed"
own=00000004-0000-4000-8000-000000000001
foreign=00000004-0000-4000-8000-000000000021
check 'Anonymous assign rejected' 401 .smoke/anon.json --header 'Accept: application/json' --request POST "$base/api/tickets/$own/assign"
check 'Foreign-team assign rejected' 404 .smoke/foreign.json --cookie .smoke/riley.cookies --header 'Accept: application/json' --request POST "$base/api/tickets/$foreign/assign"
check 'Cross-origin assign rejected' 403 .smoke/origin.json --cookie .smoke/riley.cookies --header 'Accept: application/json' --header 'Origin: https://other.example' --request POST "$base/api/tickets/$own/assign"
check 'Assign own-team ticket' 200 .smoke/assign.json --cookie .smoke/riley.cookies --header 'Accept: application/json' --request POST "$base/api/tickets/$own/assign"
check 'Foreign-team reply rejected' 404 .smoke/foreign-reply.json --cookie .smoke/riley.cookies --header 'Accept: application/json' --data-urlencode 'body=Synthetic authorization check.' "$base/api/tickets/$foreign/reply"
check 'Save own-team reply' 200 .smoke/reply.json --cookie .smoke/riley.cookies --header 'Accept: application/json' --data-urlencode 'body=I reviewed the invoice details. The account credit will be included in the revised total.' "$base/api/tickets/$own/reply"
check 'Ticket conversation' 200 .smoke/ticket.html --cookie .smoke/riley.cookies "$base/tickets/$own"
check 'Save preferences' 303 /dev/null --cookie .smoke/riley.cookies --data-urlencode 'displayName=Riley Chen' --data 'emailNotifications=on&slaNotifications=on&dailyDigest=on' "$base/api/settings"
check 'Saved preferences page' 200 .smoke/settings-saved.html --cookie .smoke/riley.cookies "$base/settings?saved=1"
check 'Restore preferences' 303 /dev/null --cookie .smoke/riley.cookies --data-urlencode 'displayName=Riley Chen' --data 'emailNotifications=on&slaNotifications=on' "$base/api/settings"
python3 - <<'PY'
from pathlib import Path
from html.parser import HTMLParser
class Text(HTMLParser):
    def __init__(self): super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self,t,a):
        if t in ['script','style']: self.skip+=1
    def handle_endtag(self,t):
        if t in ['script','style']: self.skip-=1
    def handle_data(self,d):
        if not self.skip: self.parts.append(d)
def text(name):
    parser=Text(); parser.feed(Path('.smoke/'+name+'.html').read_text()); return ' '.join(parser.parts)
riley=text('riley-desk');casey=text('casey-desk');dana=text('dana-desk')
assert 'Invoice total does not match' in riley and 'intermittent 502 errors' not in riley
assert 'intermittent 502 errors' in casey and 'Invoice total does not match' not in casey
assert 'Invoice total does not match' in dana and 'Webhook delivery delayed' in dana
assert 'Administrator access required' in text('admin-denied')
assert 'The account credit will be included' in text('ticket')
assert 'Profile and notification preferences saved' in text('settings-saved')
assert 'name="dailyDigest" checked=' in Path('.smoke/settings-saved.html').read_text()
assert 'queue-cards' in Path('.smoke/variants.html').read_text()
assert 'kb-collapsed' in Path('.smoke/variants.html').read_text()
print('Team visibility, variants, saved reply, preferences: passed')
PY
check 'Sign out' 303 /dev/null --cookie .smoke/riley.cookies --cookie-jar .smoke/riley.cookies --request POST "$base/api/auth/logout"
check 'Signed-out desk redirect' 307 /dev/null --cookie .smoke/riley.cookies "$base/desk"
