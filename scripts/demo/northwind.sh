#!/usr/bin/env bash
# Northwind demo loop: set up and tear down a live "add Contour to Northwind" demo.
#
#   scripts/demo/northwind.sh fresh      # disposable worktree with the pristine Northwind baseline + skill
#   scripts/demo/northwind.sh recorded   # disposable worktree with HEAD's integrated Northwind, tables installed
#   scripts/demo/northwind.sh status     # what is set up right now
#   scripts/demo/northwind.sh reset      # undo everything the demo created
#   scripts/demo/northwind.sh restore    # re-install DB state the deployed Northwind needs (after reset)
#
# The worktree lives at ../contour-demo (next to the main checkout) on a throwaway
# branch demo/northwind-<timestamp>. Remote SQL runs through the Supabase CLI link
# in apps/ops-demo. reset never touches the main checkout's apps/northwind, the
# northwind business tables, the northwind-baseline tag, or anything Acme.
set -euo pipefail

SCHEMA="northwind_contour"
BASELINE_TAG="northwind-baseline"
BRANCH_PREFIX="demo/northwind-"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Always resolve the MAIN checkout, even if this copy of the script runs inside the demo worktree.
GIT_COMMON="$(git -C "$SCRIPT_DIR" rev-parse --path-format=absolute --git-common-dir)"
MAIN="$(dirname "$GIT_COMMON")"
DEMO="$(dirname "$MAIN")/contour-demo"
LINK_DIR="$MAIN/apps/ops-demo"            # holds supabase/.temp (the CLI link)
MIGRATE="$MAIN/packages/contour-sdk/bin/contour-migrate.mjs"
HARNESS="$MAIN/apps/northwind-eval/run-skill.ts"

if [[ -t 1 ]]; then B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; N=$'\e[0m'; else B=""; G=""; Y=""; R=""; D=""; N=""; fi
step() { printf '\n%s==> %s%s\n' "$B" "$*" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$*"; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

TMP_FILES=()
cleanup() { if ((${#TMP_FILES[@]})); then rm -f "${TMP_FILES[@]}"; fi; }
trap cleanup EXIT

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not on PATH"; }

# ---------------------------------------------------------------- remote SQL
# Runs a SQL file on the linked project. Output is shown only on failure.
sql_file() {
  local file="$1" out
  if ! out="$(cd "$LINK_DIR" && supabase db query --linked --agent no -f "$file" 2>&1)"; then
    printf '%s\n' "$out" | tail -n 20 >&2
    return 1
  fi
}

# Runs one query and prints its JSON rows.
sql_json() {
  (cd "$LINK_DIR" && supabase db query --linked --agent no -o json "$1" 2>/dev/null)
}

# Reads a field from the first JSON row on stdin.
json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const v=Array.isArray(r)&&r[0]?r[0][process.argv[1]]:undefined;process.stdout.write(v===undefined||v===null?"":String(v));});' "$1"
}

remote_state() {
  sql_json "select
    (select count(*) from pg_tables where schemaname = '$SCHEMA') as tables,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = '$SCHEMA') as functions,
    exists (select 1 from information_schema.columns where table_schema = 'northwind' and table_name = 'users' and column_name = 'role_version') as role_version,
    case when to_regclass('cloud.projects') is null then -1 else (select count(*) from cloud.projects where base_url ilike '%northwind%') end as projects,
    case when to_regclass('cloud.links') is null or to_regclass('cloud.projects') is null then -1 else
      (select count(*) from cloud.links where project_id in (select id from cloud.projects where base_url ilike '%northwind%')) end as links"
}

# ---------------------------------------------------------------- worktree helpers
is_demo_worktree() {
  git -C "$MAIN" worktree list --porcelain | grep -qxF "worktree $DEMO"
}

demo_version() {
  if [[ -d "$DEMO/apps/northwind/src/contour" ]]; then echo "integrated"; else echo "baseline"; fi
}

head_has_integration() {
  git -C "$MAIN" cat-file -e "HEAD:apps/northwind/src/contour" 2>/dev/null
}

create_worktree() {
  if [[ -e "$DEMO" ]]; then
    die "$DEMO already exists. Run: pnpm demo:northwind:reset"
  fi
  git -C "$MAIN" worktree prune
  BRANCH="${BRANCH_PREFIX}$(date +%Y%m%d-%H%M%S)"
  step "Creating worktree $DEMO on $BRANCH"
  git -C "$MAIN" worktree add -q -b "$BRANCH" "$DEMO" HEAD
  ok "worktree at $(git -C "$DEMO" rev-parse --short HEAD) ($(git -C "$MAIN" rev-parse --abbrev-ref HEAD))"
}

restore_baseline() {
  step "Replacing apps/northwind with $BASELINE_TAG"
  git -C "$MAIN" rev-parse -q --verify "refs/tags/$BASELINE_TAG" >/dev/null || die "tag $BASELINE_TAG not found"
  git -C "$DEMO" checkout "$BASELINE_TAG" -- apps/northwind
  # Remove tracked files the tag does not have.
  local extra
  extra="$(comm -23 <(git -C "$DEMO" ls-files apps/northwind | sort) \
                    <(git -C "$DEMO" ls-tree -r --name-only "$BASELINE_TAG" -- apps/northwind | sort))"
  if [[ -n "$extra" ]]; then
    while IFS= read -r f; do git -C "$DEMO" rm -q -f -- "$f"; done <<<"$extra"
    info "removed $(wc -l <<<"$extra" | tr -d ' ') file(s) not in the tag"
  fi
  # Re-apply the workspace join: HEAD's package.json and next.config.ts, no nested workspace files.
  git -C "$DEMO" checkout HEAD -- apps/northwind/package.json apps/northwind/next.config.ts
  local f
  for f in pnpm-workspace.yaml pnpm-lock.yaml supabase/config.toml DESIGN_REVIEW.md; do
    git -C "$DEMO" rm -q -f --ignore-unmatch -- "apps/northwind/$f" >/dev/null
    rm -f "$DEMO/apps/northwind/$f"
  done
  if ! git -C "$DEMO" diff --cached --quiet; then
    git -C "$DEMO" commit -q --no-verify -m "demo: apps/northwind at $BASELINE_TAG (workspace join re-applied)"
    ok "committed baseline on $BRANCH ($(git -C "$DEMO" rev-parse --short HEAD))"
  else
    ok "HEAD's apps/northwind already matches the baseline"
  fi
  [[ ! -d "$DEMO/apps/northwind/src/contour" ]] || die "baseline still has src/contour; aborting"
}

copy_env() {
  step "Copying .env.local files from the main checkout"
  local app
  for app in northwind ops-demo cloud; do
    if [[ -f "$MAIN/apps/$app/.env.local" ]]; then
      cp -p "$MAIN/apps/$app/.env.local" "$DEMO/apps/$app/.env.local"
      ok "apps/$app/.env.local"
    else
      warn "apps/$app/.env.local not found in the main checkout; skipped"
    fi
  done
}

install_skill() {
  step "Installing the contour-setup skill"
  local dest="$DEMO/apps/northwind/.claude/skills/contour-setup"
  mkdir -p "$(dirname "$dest")"
  cp -R "$DEMO/skills/contour-setup" "$dest"
  ok "apps/northwind/.claude/skills/contour-setup (from $(git -C "$DEMO" rev-parse --short HEAD))"
}

pnpm_install() {
  step "pnpm install"
  (cd "$DEMO" && pnpm install --prefer-offline 2>&1 | tail -n 4 | sed 's/^/  /')
  ok "dependencies installed"
}

warn_if_dirty_remote() {
  local state t p
  if ! state="$(remote_state)"; then warn "could not read remote state (supabase CLI)"; return 0; fi
  t="$(json_field tables <<<"$state")"; p="$(json_field projects <<<"$state")"
  if [[ "${t:-0}" != "0" || "${p:-0}" -gt 0 || "$(json_field role_version <<<"$state")" == "true" ]]; then
    warn "remote still has demo leftovers ($SCHEMA tables: $t, Cloud projects: $p, users.role_version: $(json_field role_version <<<"$state")). Run reset first for a clean demo."
  fi
}

dana_answers() {
  node -e '
    const s = require("fs").readFileSync(process.argv[1], "utf8");
    const m = s.match(/const ownerPrompt = `([\s\S]*?)`;/);
    if (!m) { console.error("owner prompt not found in harness"); process.exit(1); }
    process.stdout.write(m[1] + "\n");' "$1"
}

# ---------------------------------------------------------------- commands
cmd_fresh() {
  need git; need pnpm; need node
  create_worktree
  restore_baseline
  copy_env
  install_skill
  pnpm_install
  step "Checking remote state"
  warn_if_dirty_remote
  ok "check done"

  step "Ready. Next steps"
  info "1. cd ../contour-demo/apps/northwind && claude"
  info "2. Paste Dana's prompt below. It opens with \"Add Contour to this app\" and carries her answers:"
  printf '\n%s----- copy below -----%s\n' "$D" "$N"
  dana_answers "$DEMO/apps/northwind-eval/run-skill.ts"
  printf '%s----- copy above -----%s\n\n' "$D" "$N"
  info "When done: pnpm demo:northwind:reset"
}

cmd_recorded() {
  need git; need pnpm; need node; need supabase
  if ! head_has_integration; then
    printf 'The integrated Northwind is not recorded yet: HEAD (%s) has no apps/northwind/src/contour/.\n' \
      "$(git -C "$MAIN" rev-parse --short HEAD)" >&2
    printf 'Run the live demo (pnpm demo:northwind:fresh), commit the integrated apps/northwind, then retry.\n' >&2
    exit 1
  fi
  create_worktree
  copy_env
  pnpm_install

  step "Installing Contour tables into $SCHEMA"
  node "$DEMO/packages/contour-sdk/bin/contour-migrate.mjs" --schema "$SCHEMA" --apply --workdir "$LINK_DIR" >/dev/null
  ok "$SCHEMA installed"

  step "Host SQL"
  if [[ -f "$DEMO/apps/northwind/supabase/contour-host.sql" ]]; then
    sql_file "$DEMO/apps/northwind/supabase/contour-host.sql"
    ok "applied apps/northwind/supabase/contour-host.sql"
  else
    info "no apps/northwind/supabase/contour-host.sql; nothing to apply"
  fi

  step "Ready. Next steps"
  info "cd ../contour-demo/apps/northwind && pnpm dev    # http://localhost:3200"
  info "When done: pnpm demo:northwind:reset"
}

cmd_reset() {
  need git; need node; need supabase
  local did=()

  step "Host SQL rollback"
  local down="$DEMO/apps/northwind/supabase/contour-host.down.sql"
  if [[ -f "$down" ]]; then
    sql_file "$down"
    ok "applied apps/northwind/supabase/contour-host.down.sql"
    did+=("applied contour-host.down.sql")
  else
    info "no contour-host.down.sql in the demo worktree; skipped"
  fi

  step "Dropping Contour objects from $SCHEMA"
  node "$MIGRATE" --schema "$SCHEMA" --drop --apply --workdir "$LINK_DIR" >/dev/null
  ok "$SCHEMA emptied (schema, API exposure and grants kept)"
  did+=("dropped $SCHEMA contents")

  step "Cloud registration rows for Northwind"
  local state projects links
  state="$(remote_state)"
  projects="$(json_field projects <<<"$state")"; links="$(json_field links <<<"$state")"
  if [[ "$projects" == "-1" ]]; then
    info "cloud.projects does not exist; skipped"
  elif [[ "$projects" == "0" ]]; then
    info "no Northwind rows in cloud.projects"
  else
    local f; f="$(mktemp "${TMPDIR:-/tmp}/northwind-reset.XXXXXX")"; TMP_FILES+=("$f"); chmod 600 "$f"
    cat >"$f" <<'SQL'
begin;
do $$
begin
  if to_regclass('cloud.links') is not null then
    delete from cloud.links where project_id in (select id from cloud.projects where base_url ilike '%northwind%' and base_url <> 'https://northwind-support-app.vercel.app');
  end if;
  -- Never remove the deployed Northwind's registration; only demo-created ones.
  delete from cloud.projects where base_url ilike '%northwind%' and base_url <> 'https://northwind-support-app.vercel.app';
end
$$;
commit;
SQL
    sql_file "$f"
    ok "deleted $projects cloud.projects row(s) and $links cloud.links row(s)"
    did+=("deleted Cloud rows: $projects project(s), $links link(s)")
  fi

  step "Worktree and throwaway branch"
  local branch=""
  if is_demo_worktree; then
    if [[ -d "$DEMO" ]]; then branch="$(git -C "$DEMO" symbolic-ref -q --short HEAD || true)"; fi
    git -C "$MAIN" worktree remove --force "$DEMO"
    ok "removed worktree $DEMO"
    did+=("removed $DEMO")
  elif [[ -e "$DEMO" ]]; then
    die "$DEMO exists but is not a worktree of $MAIN; refusing to delete it"
  else
    info "no worktree at $DEMO"
  fi
  git -C "$MAIN" worktree prune
  # Delete this run's branch plus any other demo/northwind-* branch no worktree uses.
  local in_use b sha
  in_use="$(git -C "$MAIN" worktree list --porcelain | sed -n 's#^branch refs/heads/##p')"
  while IFS= read -r b; do
    [[ -n "$b" ]] || continue
    [[ "$b" == "$BRANCH_PREFIX"* ]] || continue
    if grep -qxF "$b" <<<"$in_use"; then warn "branch $b is checked out elsewhere; kept"; continue; fi
    sha="$(git -C "$MAIN" rev-parse --short "refs/heads/$b")"
    git -C "$MAIN" branch -q -D "$b"
    ok "deleted branch $b (was $sha; recover with: git branch $b $sha)"
    did+=("deleted branch $b")
  done < <({ [[ -n "$branch" ]] && echo "$branch"; git -C "$MAIN" for-each-ref --format='%(refname:short)' "refs/heads/${BRANCH_PREFIX}*"; } | sort -u)

  step "Reset done"
  if ((${#did[@]})); then for x in "${did[@]}"; do info "- $x"; done; fi
  info "Untouched: main checkout apps/northwind, northwind business tables, $BASELINE_TAG tag, Acme."
}

# Re-install the database state the DEPLOYED (main checkout) Northwind needs.
# The demo workspace and the deployed app share one database, so run this after
# `reset` if you are not immediately re-running the live setup.
cmd_restore() {
  need node; need supabase
  head_has_integration || die "HEAD has no integrated apps/northwind (src/contour/ missing)."
  step "Restoring $SCHEMA for the deployed Northwind"
  node "$MIGRATE" --schema "$SCHEMA" --apply --workdir "$LINK_DIR" >/dev/null
  ok "$SCHEMA installed"
  if [[ -f "$MAIN/apps/northwind/supabase/contour-host.sql" ]]; then
    sql_file "$MAIN/apps/northwind/supabase/contour-host.sql"
    ok "applied apps/northwind/supabase/contour-host.sql"
  fi
  step "Done. The deployed Northwind's agent features work again."
}

cmd_status() {
  need git; need node
  step "Demo worktree"
  if is_demo_worktree && [[ -d "$DEMO" ]]; then
    ok "$DEMO exists ($(git -C "$DEMO" symbolic-ref -q --short HEAD || echo detached))"
    info "version: $(demo_version)"
    [[ -d "$DEMO/apps/northwind/.claude/skills/contour-setup" ]] && info "skill: installed" || info "skill: not installed"
    [[ -f "$DEMO/apps/northwind/supabase/contour-host.sql" ]] && info "host SQL: supabase/contour-host.sql present" || info "host SQL: none"
  elif [[ -e "$DEMO" ]]; then
    warn "$DEMO exists but is not a worktree of this repo"
  else
    info "no worktree at $DEMO"
  fi
  if head_has_integration; then info "recorded integration at HEAD: yes"; else info "recorded integration at HEAD: no"; fi

  step "Remote (linked project)"
  need supabase
  local state
  if ! state="$(remote_state)"; then die "could not query the linked project (supabase CLI in apps/ops-demo)"; fi
  info "$SCHEMA: $(json_field tables <<<"$state") table(s), $(json_field functions <<<"$state") function(s)"
  info "northwind.users.role_version column: $(json_field role_version <<<"$state")"
  local p l; p="$(json_field projects <<<"$state")"; l="$(json_field links <<<"$state")"
  if [[ "$p" == "-1" ]]; then info "Cloud registration: cloud.projects missing"
  else info "Cloud registration: $p Northwind project(s), $([[ "$l" == "-1" ]] && echo "no links table" || echo "$l link(s)")"; fi
}

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

case "${1:-}" in
  fresh) cmd_fresh ;;
  recorded) cmd_recorded ;;
  reset) cmd_reset ;;
  status) cmd_status ;;
  restore) cmd_restore ;;
  -h|--help|help) usage 0 ;;
  *) usage 2 ;;
esac
