#!/usr/bin/env bash
# Write -> record -> review loop for .github/workflows/demo-write.yml. Run from dali-api/
# with demo-work/pr.md and demo-work/pr.diff in place and the app built.
#
# Env: SLUG (required), MODEL, MAX_ATTEMPTS, TOKEN_BUDGET, WRITER_TURNS, REVIEWER_TURNS.
# Writes result/attempts/tokens/file to $GITHUB_OUTPUT (or stdout) and the last
# reviewer feedback to demo-work/review.md.
set -uo pipefail

: "${SLUG:?SLUG is required}"
MODEL=${MODEL:-sonnet}
MAX_ATTEMPTS=${MAX_ATTEMPTS:-3}
# Counts uncached input + cache writes + output across every call. Cache reads are
# excluded: they are cheap and would otherwise dominate the count.
TOKEN_BUDGET=${TOKEN_BUDGET:-1500000}
WRITER_TURNS=${WRITER_TURNS:-40}
REVIEWER_TURNS=${REVIEWER_TURNS:-24}

FILE="demos/${SLUG}.demo.ts"
WORK=demo-work
PROMPTS=demos/lib/prompts
OUT=${GITHUB_OUTPUT:-/dev/stdout}
REPO_FILE="dali-api/${FILE}"
REVIEW_SCHEMA='{"type":"object","properties":{"pass":{"type":"boolean"},"feedback":{"type":"string"}},"required":["pass","feedback"],"additionalProperties":false}'

TOKENS=0
attempt=0
result=fail

render() {
  sed -e "s#{{SLUG}}#${SLUG}#g" -e "s#{{INTERVAL}}#${INTERVAL:-}#g" -e "s#{{DURATION}}#${DURATION:-}#g" "$1"
}

# claude_run <prompt-file> <max-turns> <allowed-tools> [extra args...]; JSON result in $WORK/last.json
claude_run() {
  local prompt=$1 turns=$2 tools=$3
  shift 3
  render "$prompt" | claude -p --model "$MODEL" --max-turns "$turns" --allowedTools "$tools" \
    --output-format json "$@" > "$WORK/last.json" 2> "$WORK/last.err" || true
  local used
  used=$(jq '(.usage.input_tokens // 0) + (.usage.cache_creation_input_tokens // 0) + (.usage.output_tokens // 0)' "$WORK/last.json" 2>/dev/null || echo 0)
  TOKENS=$((TOKENS + ${used:-0}))
  echo "  $(basename "$prompt" .md): ${used:-0} tokens (total ${TOKENS}/${TOKEN_BUDGET}), $(jq -r '.num_turns // "?"' "$WORK/last.json" 2>/dev/null) turns"
}

over_budget() {
  if [ "$TOKENS" -ge "$TOKEN_BUDGET" ]; then
    echo "Token budget spent (${TOKENS}/${TOKEN_BUDGET})."
    result=budget
    return 0
  fi
  return 1
}

# The writer may only touch its own demo file. Undo anything else it changed and
# tell it. Paths dirty before the loop started (build output) are left alone.
enforce_scope() {
  local stray=""
  while IFS= read -r path; do
    [ -z "$path" ] || [ "$path" = "$REPO_FILE" ] && continue
    grep -qxF -- "$path" "$WORK/baseline" && continue
    stray="${stray} ${path}"
    if git ls-files --error-unmatch -- "../${path}" >/dev/null 2>&1; then
      git checkout HEAD -- "../${path}"
    else
      rm -rf -- "../${path}"
    fi
  done < <(git status --porcelain --untracked-files=all | cut -c4-)
  if [ -n "$stray" ]; then
    echo "  reverted out-of-scope changes:${stray}"
    printf '\nYou changed files other than %s; they were reverted:%s\n' "$FILE" "$stray" >> "$WORK/review.md"
  fi
}

record() {
  rm -rf demo-results demo-out "$WORK/frames"
  mkdir -p "$WORK/frames"
  if ! npx playwright test -c playwright.demos.config.ts "$FILE" > "$WORK/record.log" 2>&1; then
    { echo "The script failed when recorded. End of the log:"; echo '```'; tail -n 40 "$WORK/record.log"; echo '```'; } > "$WORK/review.md"
    return 1
  fi
  if ! npx tsx demos/lib/encode.ts > "$WORK/encode.log" 2>&1 || [ ! -f "demo-out/${SLUG}.mp4" ]; then
    { echo "The test passed but no video came out. Encoder log:"; echo '```'; tail -n 20 "$WORK/encode.log"; echo '```'; } > "$WORK/review.md"
    return 1
  fi
  DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "demo-out/${SLUG}.mp4" | awk '{printf "%.0f", $1}')
  # About 14 frames, at least one a second apart.
  INTERVAL=$(awk -v d="$DURATION" 'BEGIN { i = d / 14; if (i < 1) i = 1; printf "%.1f", i }')
  ffmpeg -y -loglevel error -i "demo-out/${SLUG}.mp4" -vf "fps=1/${INTERVAL},scale=960:-2" "$WORK/frames/%02d.png"
}

mkdir -p "$WORK"
rm -f "$WORK/review.md" "$WORK/not-demoable.md"
git status --porcelain --untracked-files=all | cut -c4- > "$WORK/baseline"

while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  echo "Attempt ${attempt}/${MAX_ATTEMPTS}"
  over_budget && break

  claude_run "$PROMPTS/writer.md" "$WRITER_TURNS" \
    "Read,Write,Edit,Glob,Grep,LS,Bash(npx playwright test:*)"
  enforce_scope

  if [ -f "$WORK/not-demoable.md" ]; then
    rm -f -- "$FILE"
    result=not-demoable
    cp "$WORK/not-demoable.md" "$WORK/review.md"
    break
  fi
  if [ ! -f "$FILE" ]; then
    echo "No demo file was written. Write ${FILE}." > "$WORK/review.md"
    continue
  fi

  record || { echo "  recording failed"; continue; }
  echo "  recorded ${DURATION}s"
  over_budget && break

  rm -f "$WORK/review.md"
  claude_run "$PROMPTS/reviewer.md" "$REVIEWER_TURNS" "Read,Glob,LS" --json-schema "$REVIEW_SCHEMA"
  pass=$(jq -r '.structured_output.pass // false' "$WORK/last.json" 2>/dev/null || echo false)
  jq -r '.structured_output.feedback // "The reviewer returned no verdict."' "$WORK/last.json" > "$WORK/review.md" 2>/dev/null \
    || echo "The reviewer returned no verdict." > "$WORK/review.md"
  echo "  review: pass=${pass}"
  if [ "$pass" = "true" ]; then
    result=pass
    break
  fi
done

{
  echo "result=${result}"
  echo "attempts=${attempt}"
  echo "tokens=${TOKENS}"
  echo "file=${FILE}"
} >> "$OUT"
echo "Result: ${result} after ${attempt} attempt(s), ${TOKENS} tokens"
