#!/usr/bin/env sh
set -eu

readonly ENDPOINT="http://localhost:4566"
readonly DLQ_NAME="wager-transactions-dlq.fifo"
readonly QUEUE_NAME="wager-transactions.fifo"
readonly MAX_RECEIVE_COUNT="5"

sqs() {
  aws --endpoint-url="${ENDPOINT}" sqs "$@"
}

sqs create-queue \
  --queue-name "${DLQ_NAME}" \
  --attributes FifoQueue=true

DLQ_URL="$(sqs get-queue-url --queue-name "${DLQ_NAME}" --query QueueUrl --output text)"
DLQ_ARN="$(sqs get-queue-attributes \
  --queue-url "${DLQ_URL}" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn --output text)"

sqs create-queue \
  --queue-name "${QUEUE_NAME}" \
  --attributes "{
    \"FifoQueue\": \"true\",
    \"VisibilityTimeout\": \"30\",
    \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"${MAX_RECEIVE_COUNT}\\\"}\"
  }"

echo "SQS queues provisioned: ${QUEUE_NAME}, ${DLQ_NAME}"
