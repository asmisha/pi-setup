#!/bin/sh
set -eu

limit=4

tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/select-pr-reviewers.XXXXXX")
trap 'rm -rf "$tmpdir"' EXIT INT TERM HUP

tab=$(printf '\t')

emit_line() {
  key=$1
  shift
  printf '%s%s%s\n' "$key" "$tab" "$*"
}

is_listed() {
  value=$1
  file=$2
  [ -s "$file" ] && grep -Fqx "$value" "$file"
}

verify_human_login() {
  login=$1
  case "$login" in
    *'[bot]') return 1 ;;
  esac

  user_record=$(gh api --hostname "$host" "users/$login" --jq '[.login, .type] | @tsv' 2>/dev/null) || return 1
  verified_login=$(printf '%s\n' "$user_record" | awk -F '\t' 'NR == 1 { print $1 }')
  verified_type=$(printf '%s\n' "$user_record" | awk -F '\t' 'NR == 1 { print $2 }')
  [ "$verified_login" = "$login" ] && [ "$verified_type" = 'User' ]
}

if pr_number=$(gh pr view --json number --jq '.number' 2>"$tmpdir/pr_view.err"); then
  :
elif grep -Eiq 'no pull requests? found' "$tmpdir/pr_view.err"; then
  emit_line STATUS no_pr
  emit_line MESSAGE "No open pull request found for the current branch."
  exit 0
else
  cat "$tmpdir/pr_view.err" >&2
  exit 1
fi

pr_url=$(gh pr view --json url --jq '.url')
host=$(printf '%s\n' "$pr_url" | sed -E 's#https?://([^/]+)/.*#\1#')
repo=$(printf '%s\n' "$pr_url" | sed -E 's#https?://[^/]+/([^/]+/[^/]+)/pull/[0-9]+#\1#')
base_ref=$(gh pr view --json baseRefName --jq '.baseRefName')
auth_user=$(gh api --hostname "$host" user --jq '.login')
pr_author=$(gh pr view --json author --jq '.author.login // empty')
pr_is_draft=$(gh pr view --json isDraft --jq '.isDraft')

gh api --hostname "$host" "repos/$repo/pulls/$pr_number" --jq '.requested_reviewers[].login' > "$tmpdir/requested_reviewers.raw"
sort -u "$tmpdir/requested_reviewers.raw" > "$tmpdir/requested_reviewers"
gh api --hostname "$host" "repos/$repo/pulls/$pr_number/files" --paginate --jq '.[] | [.filename, (.previous_filename // .filename)] | @tsv' > "$tmpdir/changed_files_with_history"
awk -F '\t' 'NF { print $1 }' "$tmpdir/changed_files_with_history" > "$tmpdir/changed_files"

: > "$tmpdir/candidate_events"
: > "$tmpdir/candidates"
: > "$tmpdir/selected_reviewers"
selected_count=0

while IFS="$tab" read -r file_path history_path; do
  [ -n "$file_path" ] || continue
  [ -n "$history_path" ] || history_path=$file_path

  gh api --hostname "$host" --method GET "repos/$repo/commits" -f sha="$base_ref" -f path="$history_path" -f per_page=20 --jq '.[] | (.author.login // .committer.login // empty)' > "$tmpdir/file_contributors"
  awk -v file_path="$file_path" '
    NF && !seen[$0]++ {
      rank += 1
      printf "%s\t%s\t%s\n", $0, file_path, rank
    }
  ' "$tmpdir/file_contributors" >> "$tmpdir/candidate_events"
done < "$tmpdir/changed_files_with_history"

if [ -s "$tmpdir/candidate_events" ]; then
  awk -F '\t' '
    {
      file_count[$1]++
      if (!($1 in best_rank) || $3 < best_rank[$1]) {
        best_rank[$1] = $3
      }
    }
    END {
      for (login in file_count) {
        printf "%s\t%s\t%s\n", login, file_count[login], best_rank[login]
      }
    }
  ' "$tmpdir/candidate_events" | sort -t "$tab" -k2,2nr -k3,3n -k1,1 > "$tmpdir/ranked_candidates"
else
  : > "$tmpdir/ranked_candidates"
fi

while IFS="$tab" read -r login file_count best_rank; do
  [ -n "$login" ] || continue

  status=excluded
  reason=not-selected

  if [ "$login" = "$auth_user" ]; then
    reason=authenticated-user
  elif [ "$login" = "$pr_author" ]; then
    reason=pr-author
  elif is_listed "$login" "$tmpdir/requested_reviewers"; then
    reason=already-requested
  elif [ "$selected_count" -ge "$limit" ]; then
    reason=ranked-below-limit
  elif ! verify_human_login "$login"; then
    reason=unverified-or-non-human
  else
    status=selected
    reason=recent-contributor
    selected_count=$((selected_count + 1))
    printf '%s\n' "$login" >> "$tmpdir/selected_reviewers"
  fi

  printf '%s\t%s\t%s\t%s\t%s\n' "$login" "$file_count" "$best_rank" "$status" "$reason" >> "$tmpdir/candidates"
done < "$tmpdir/ranked_candidates"

emit_line STATUS ok
emit_line PR_NUMBER "$pr_number"
emit_line PR_URL "$pr_url"
emit_line PR_AUTHOR "$pr_author"
emit_line PR_IS_DRAFT "$pr_is_draft"
while IFS= read -r file_path; do
  emit_line CHANGED_FILE "$file_path"
done < "$tmpdir/changed_files"
while IFS= read -r login; do
  [ -n "$login" ] || continue
  emit_line REQUESTED_REVIEWER "$login"
done < "$tmpdir/requested_reviewers"
while IFS= read -r login; do
  [ -n "$login" ] || continue
  emit_line SELECTED_REVIEWER "$login"
done < "$tmpdir/selected_reviewers"
while IFS="$tab" read -r login file_count best_rank status reason; do
  [ -n "$login" ] || continue
  printf 'CANDIDATE\t%s\tfiles_touched=%s\tbest_rank=%s\tstatus=%s\treason=%s\n' "$login" "$file_count" "$best_rank" "$status" "$reason"
done < "$tmpdir/candidates"
