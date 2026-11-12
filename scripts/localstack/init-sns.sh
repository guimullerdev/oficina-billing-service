#!/bin/bash
set -euo pipefail

# Idempotent: every AWS command here can be re-run without failing.
# The OS queue (oficina-os-queue) is owned by oficina-os-service and is NOT created here.

json_escape() {
  local s=${1//\\/\\\\}
  s=${s//\"/\\\"}
  printf '%s' "$s"
}

queue_arn() {
  awslocal sqs get-queue-attributes --queue-url "$1" --attribute-names QueueArn \
    --query 'Attributes.QueueArn' --output text
}

# Topics
OS_TOPIC_ARN=$(awslocal sns create-topic --name oficina-os-events --query TopicArn --output text)
BILLING_TOPIC_ARN=$(awslocal sns create-topic --name oficina-billing-events --query TopicArn --output text)
awslocal sns create-topic --name oficina-execucao-events >/dev/null

# DLQ and billing queue
awslocal sqs create-queue --queue-name oficina-billing-dlq >/dev/null
DLQ_URL=$(awslocal sqs get-queue-url --queue-name oficina-billing-dlq --query QueueUrl --output text)
DLQ_ARN=$(queue_arn "$DLQ_URL")

awslocal sqs create-queue --queue-name oficina-billing-queue >/dev/null
QUEUE_URL=$(awslocal sqs get-queue-url --queue-name oficina-billing-queue --query QueueUrl --output text)
QUEUE_ARN=$(queue_arn "$QUEUE_URL")

# Policy: only oficina-os-events can send messages to the billing queue.
POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"AllowSnsSendMessage","Effect":"Allow","Principal":{"Service":"sns.amazonaws.com"},"Action":"sqs:SendMessage","Resource":"'"$QUEUE_ARN"'","Condition":{"ArnEquals":{"aws:SourceArn":"'"$OS_TOPIC_ARN"'"}}}]}'
REDRIVE='{"deadLetterTargetArn":"'"$DLQ_ARN"'","maxReceiveCount":"3"}'
QUEUE_ATTRS='{"RedrivePolicy":"'"$(json_escape "$REDRIVE")"'","VisibilityTimeout":"30","Policy":"'"$(json_escape "$POLICY")"'"}'
awslocal sqs set-queue-attributes --queue-url "$QUEUE_URL" --attributes "$QUEUE_ATTRS"

# Subscribe billing queue to oficina-os-events (raw delivery + filter on MessageAttributes.evento)
SUB_ARN=$(awslocal sns subscribe --topic-arn "$OS_TOPIC_ARN" --protocol sqs \
  --notification-endpoint "$QUEUE_ARN" --query SubscriptionArn --output text)
awslocal sns set-subscription-attributes --subscription-arn "$SUB_ARN" \
  --attribute-name RawMessageDelivery --attribute-value true
awslocal sns set-subscription-attributes --subscription-arn "$SUB_ARN" \
  --attribute-name FilterPolicyScope --attribute-value MessageAttributes
awslocal sns set-subscription-attributes --subscription-arn "$SUB_ARN" \
  --attribute-name FilterPolicy \
  --attribute-value '{"evento":["os.criada","diagnostico.concluido","os.cobranca.solicitada"]}'

# Spy queue: receives everything published to oficina-billing-events (raw, no filter), for e2e checks.
awslocal sqs create-queue --queue-name oficina-billing-spy >/dev/null
SPY_URL=$(awslocal sqs get-queue-url --queue-name oficina-billing-spy --query QueueUrl --output text)
SPY_ARN=$(queue_arn "$SPY_URL")
SPY_SUB_ARN=$(awslocal sns subscribe --topic-arn "$BILLING_TOPIC_ARN" --protocol sqs \
  --notification-endpoint "$SPY_ARN" --query SubscriptionArn --output text)
awslocal sns set-subscription-attributes --subscription-arn "$SPY_SUB_ARN" \
  --attribute-name RawMessageDelivery --attribute-value true
