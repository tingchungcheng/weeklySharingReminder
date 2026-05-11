#!/usr/bin/env bash
set -euo pipefail

# Seed the single roster row expected by Lambda (pk = ROSTER, names = list of strings).
#
# Usage (from repo root):
#   ./sam/scripts/seed-roster.sh <dynamodb-table-name>
#   ./sam/scripts/seed-roster.sh --stack <cloudformation-stack-name>

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ITEM_FILE="$SCRIPT_DIR/seed-item.json"

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "AWS CLI credentials are invalid or missing." >&2
  echo "Use a named profile (example): export AWS_PROFILE=tingcccc-admin" >&2
  exit 1
fi

resolve_table_from_stack() {
  local stack_name="$1"
  local out
  out="$(aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='RosterTableName'].OutputValue | [0]" \
    --output text 2>/dev/null || true)"
  out="$(echo -n "$out" | tr -d '\r')"
  if [[ -z "$out" || "$out" == "None" ]]; then
    echo "Could not read RosterTableName from stack '$stack_name'." >&2
    echo "Deploy the SAM stack first, or pass the concrete DynamoDB table name." >&2
    exit 1
  fi
  echo "$out"
}

if [[ "${1:-}" == "--stack" ]]; then
  STACK_NAME="${2:?Usage: $0 --stack <cloudformation-stack-name>}"
  TABLE_NAME="$(resolve_table_from_stack "$STACK_NAME")"
  echo "Using table from stack output: $TABLE_NAME"
elif [[ -n "${1:-}" ]]; then
  TABLE_NAME="$1"
else
  echo "Usage: $0 <dynamodb-table-name>" >&2
  echo "   or: $0 --stack <cloudformation-stack-name>" >&2
  exit 1
fi

aws dynamodb put-item \
  --table-name "$TABLE_NAME" \
  --item "file://${ITEM_FILE}"

echo "Seeded pk=ROSTER in table $TABLE_NAME"
