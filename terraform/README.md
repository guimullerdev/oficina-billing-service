# Terraform — mensageria do billing-service

Cria a fila `oficina-billing-queue` e a DLQ `oficina-billing-dlq` (redrive após 3 recebimentos),
a queue policy (somente `oficina-os-events` envia), a subscription raw delivery em `oficina-os-events`
com filtro `evento` = `os.criada`, `diagnostico.concluido`, `os.cobranca.solicitada`, a policy IAM
(consumo da fila + `sns:Publish` em `oficina-billing-events`) e o usuário IAM `oficina-billing-service-pod`.

Os tópicos SNS pertencem ao root `mensageria/` do `oficina-infra-k8s`; aqui só são referenciados por ARN.
A chave de acesso NÃO é criada pelo Terraform (não vai para o state).

## Apply

1. Aplicar `mensageria/` do `oficina-infra-k8s` e obter os ARNs de `oficina-os-events` e `oficina-billing-events`.
2. Criar `terraform/terraform.tfvars` (não commitar):

   ```hcl
   os_events_topic_arn      = "arn:aws:sns:us-east-1:<conta>:oficina-os-events"
   billing_events_topic_arn = "arn:aws:sns:us-east-1:<conta>:oficina-billing-events"
   ```

3. Aplicar:

   ```bash
   cd terraform
   terraform init -backend-config=backend.hcl
   terraform apply -var-file=terraform.tfvars
   ```

4. Criar a chave do usuário: `aws iam create-access-key --user-name $(terraform output -raw service_user_name)`.

## Outputs -> GitHub environment `prod` (secrets)

| Secret | Origem |
|---|---|
| `SQS_QUEUE_URL` | `terraform output -raw queue_url` |
| `SNS_TOPIC_ARN` | ARN de `oficina-billing-events` |
| `POD_AWS_ACCESS_KEY_ID` | `AccessKeyId` do `create-access-key` |
| `POD_AWS_SECRET_ACCESS_KEY` | `SecretAccessKey` do `create-access-key` |

## Checagem offline

```bash
terraform init -backend=false && terraform fmt -check -recursive && terraform validate
```
