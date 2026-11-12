# Recursos de mensageria do billing-service.

resource "aws_sqs_queue" "dlq" {
  name = var.dlq_name
}

resource "aws_sqs_queue" "main" {
  name                       = var.queue_name
  visibility_timeout_seconds = var.visibility_timeout_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.main.arn]
  })
}

# Somente o tópico oficina-os-events pode enviar mensagens para a fila.
data "aws_iam_policy_document" "queue" {
  statement {
    sid       = "AllowSnsSendMessage"
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.main.arn]

    principals {
      type        = "Service"
      identifiers = ["sns.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [var.os_events_topic_arn]
    }
  }
}

resource "aws_sqs_queue_policy" "main" {
  queue_url = aws_sqs_queue.main.id
  policy    = data.aws_iam_policy_document.queue.json
}

# Assinatura SQS -> os-events (raw delivery + filtro por MessageAttributes.evento)
resource "aws_sns_topic_subscription" "os_events" {
  topic_arn            = var.os_events_topic_arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.main.arn
  raw_message_delivery = true
  filter_policy_scope  = "MessageAttributes"

  filter_policy = jsonencode({
    evento = [
      "os.criada",
      "diagnostico.concluido",
      "os.cobranca.solicitada",
    ]
  })

  depends_on = [aws_sqs_queue_policy.main]
}

# Policy IAM de mensageria: publica em billing-events e consome a fila do billing-service.
data "aws_iam_policy_document" "messaging" {
  statement {
    sid       = "PublishBillingEvents"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [var.billing_events_topic_arn]
  }

  statement {
    sid    = "ConsumeBillingQueue"
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]
    resources = [aws_sqs_queue.main.arn]
  }
}

resource "aws_iam_policy" "messaging" {
  name        = "oficina-billing-service-messaging"
  description = "Publicar em oficina-billing-events e consumir a fila do billing-service"
  policy      = data.aws_iam_policy_document.messaging.json
}

# Credencial do pod. Sem IRSA, o pod usa a chave estática de um usuário que só
# tem a policy acima. A chave NÃO é criada aqui, para o segredo não ir parar no
# state: `aws iam create-access-key` e `gh secret set`
# (POD_AWS_ACCESS_KEY_ID / POD_AWS_SECRET_ACCESS_KEY), ver o README deste root.
resource "aws_iam_user" "service" {
  name = "oficina-billing-service-pod"
}

resource "aws_iam_user_policy_attachment" "service_messaging" {
  user       = aws_iam_user.service.name
  policy_arn = aws_iam_policy.messaging.arn
}
