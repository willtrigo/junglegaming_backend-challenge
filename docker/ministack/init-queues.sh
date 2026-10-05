#!/usr/bin/env sh
set -eu

readonly ENDPOINT="${SQS_ENDPOINT:-http://127.0.0.1:4566}"
readonly AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:2.22.12}"
readonly DLQ_NAME="wager-transactions-dlq.fifo"
readonly QUEUE_NAME="wager-transactions.fifo"
readonly EVENTS_QUEUE_NAME="integration-events.fifo"
readonly VISIBILITY_TIMEOUT="30"
readonly MAX_RECEIVE_COUNT="5"

export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-us-east-1}"

sqs() {
  docker run --rm --network host \
    -e AWS_ACCESS_KEY_ID \
    -e AWS_SECRET_ACCESS_KEY \
    -e AWS_DEFAULT_REGION \
    "${AWS_CLI_IMAGE}" \
    --endpoint-url="${ENDPOINT}" \
    sqs "$@"
}

create_fifo_queue() {
  name="$1"
  attributes="$2"
  sqs create-queue --queue-name "${name}" --attributes "${attributes}" >/dev/null
}

readonly DLQ_ATTRIBUTES="FifoQueue=true,ContentBasedDeduplication=false"
create_fifo_queue "${DLQ_NAME}" "${DLQ_ATTRIBUTES}"

DLQ_URL="$(sqs get-queue-url --queue-name "${DLQ_NAME}" --query QueueUrl --output text)"
DLQ_ARN="$(sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)"

REDRIVE_POLICY="$(printf '{"deadLetterTargetArn":"%s","maxReceiveCount":"%s"}' \
  "${DLQ_ARN}" "${MAX_RECEIVE_COUNT}")"
REDRIVE_POLICY_ESCAPED="$(printf '%s' "${REDRIVE_POLICY}" | sed 's/"/\\"/g')"
QUEUE_ATTRIBUTES="$(printf \
  '{"FifoQueue":"true","ContentBasedDeduplication":"false","VisibilityTimeout":"%s","RedrivePolicy":"%s"}' \
  "${VISIBILITY_TIMEOUT}" "${REDRIVE_POLICY_ESCAPED}")"

create_fifo_queue "${QUEUE_NAME}" "${QUEUE_ATTRIBUTES}"
create_fifo_queue "${EVENTS_QUEUE_NAME}" "${DLQ_ATTRIBUTES}"

echo "SQS queues provisioned: ${QUEUE_NAME}, ${DLQ_NAME}, ${EVENTS_QUEUE_NAME}"
sqs list-queues
