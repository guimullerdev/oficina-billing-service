output "queue_url" {
  description = "URL da fila principal do billing-service"
  value       = aws_sqs_queue.main.url
}

output "queue_arn" {
  description = "ARN da fila principal do billing-service"
  value       = aws_sqs_queue.main.arn
}

output "dlq_url" {
  description = "URL da DLQ do billing-service"
  value       = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  description = "ARN da DLQ do billing-service"
  value       = aws_sqs_queue.dlq.arn
}

output "messaging_policy_arn" {
  description = "ARN da policy IAM de mensageria (sns:Publish + consumo SQS)"
  value       = aws_iam_policy.messaging.arn
}

output "os_events_subscription_arn" {
  description = "ARN da assinatura da fila no tópico oficina-os-events"
  value       = aws_sns_topic_subscription.os_events.arn
}

output "service_user_name" {
  description = "Usuário IAM do pod (só a policy de mensageria); a chave de acesso é criada fora do Terraform"
  value       = aws_iam_user.service.name
}
