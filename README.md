# oficina-billing-service

Tech Challenge Fase 4 - microsserviço de orçamento e cobrança da oficina (NestJS 11, Prisma 7, PostgreSQL/RDS), com um gateway de pagamento simulado isolado no mesmo processo.

## Sumário

1. [Visão geral](#1-visão-geral)
2. [Arquitetura](#2-arquitetura)
3. [Eventos consumidos](#3-eventos-consumidos)
4. [Eventos publicados](#4-eventos-publicados)
5. [Rotas](#5-rotas)
6. [Variáveis de ambiente](#6-variáveis-de-ambiente)
7. [Rodando localmente](#7-rodando-localmente)
8. [Testes e qualidade](#8-testes-e-qualidade)
9. [Deploy](#9-deploy)
10. [Débitos declarados](#10-débitos-declarados)

## 1. Visão geral

O Billing é um participante da saga orquestrada pelo `oficina-os-service`. Ele não decide o andamento da saga: reage a comandos/eventos que chegam por SNS/SQS e responde publicando eventos.

| Passo da saga | Entrada (do OS) | Ação do Billing | Saída (para o OS) |
|---|---|---|---|
| Gerar orçamento | `diagnostico.concluido` | cria o orçamento `GERADO` a partir dos itens do diagnóstico | `orcamento.gerado` |
| Aprovar / reprovar | chamada HTTP `PATCH /billing/orcamentos/:id/aprovar` ou `/reprovar` | muda o status do orçamento | `orcamento.aprovado` / `orcamento.reprovado` |
| Cobrar | `os.cobranca.solicitada` | abre o pagamento no gateway (cobrança `PENDENTE`) ou recusa a cobrança de imediato | `pagamento.recusado` (só na recusa imediata) |
| Confirmar pagamento | webhook do gateway em `POST /billing/webhooks/pagamento` | reconsulta o gateway e fecha a cobrança | `pagamento.confirmado` / `pagamento.recusado` |

```mermaid
sequenceDiagram
    participant OS as oficina-os-service
    participant SNS as SNS / SQS
    participant B as Billing
    participant GW as Gateway simulado (/gateway)

    OS->>SNS: diagnostico.concluido (oficina-os-events)
    SNS->>B: fila oficina-billing-queue
    B->>B: grava orçamento GERADO + outbox
    B->>SNS: orcamento.gerado (oficina-billing-events)
    SNS->>OS: orcamento.gerado

    Note over OS,B: aprovação/reprovação via PATCH /billing/orcamentos/:id/...
    B->>SNS: orcamento.aprovado | orcamento.reprovado
    SNS->>OS: evento da decisão

    OS->>SNS: os.cobranca.solicitada
    SNS->>B: fila oficina-billing-queue
    B->>GW: POST /gateway/payments (Idempotency-Key = sagaId:osId)
    GW-->>B: pagamento pending + checkout_url
    B->>B: cobrança PENDENTE

    GW->>B: POST /billing/webhooks/pagamento (HMAC)
    B->>GW: GET /gateway/payments/:id (fonte da verdade)
    B->>B: cobrança CONFIRMADA | RECUSADA + outbox
    B->>SNS: pagamento.confirmado | pagamento.recusado
    SNS->>OS: resultado do pagamento
```

## 2. Arquitetura

Módulos em `src/`:

| Módulo | Responsabilidade |
|---|---|
| `modules/orcamentos` | gera, consulta, aprova e reprova orçamentos; handler de `diagnostico.concluido` |
| `modules/cobrancas` | abre cobranças (handler de `os.cobranca.solicitada`), consulta por OS, processa o webhook; adapter HTTP do gateway (`PaymentGateway`) |
| `modules/auth` | `JwtAuthGuard` (JWT HS256 com `JWT_SECRET`, aborta o boot sem ele), `RolesGuard`, decorators `@Public` e `@Roles` |
| `shared/messaging` | outbox (`OutboxWriter`, `OutboxPublisher`), consumidor SQS, registro de handlers, `IdempotentProcessor` |
| `fake-gateway` | gateway de pagamento simulado (OAuth2 client_credentials, pagamentos, checkout HTML, notificação de webhook); isolado: não depende de código de domínio do billing nem tem FK para as tabelas dele |
| `modules/health` | `GET /billing/health` |

Cada módulo de negócio segue as camadas `domain` (entidades, repositórios como interface), `application` (use cases, handlers, eventos, ports), `infrastructure` (Prisma, adapter HTTP) e `presentation` (controllers, filtros de exceção, DTOs).

**Outbox transacional.** Toda mudança de estado que gera evento grava a linha em `outbox` na mesma transação. O `OutboxPublisher` varre `outbox` (`published_at IS NULL`, `FOR UPDATE SKIP LOCKED`, lote de `OUTBOX_BATCH_SIZE`) a cada `OUTBOX_PUBLISH_INTERVAL_MS` e publica no tópico SNS; a linha só recebe `published_at` após o publish confirmado (at-least-once). Falhas incrementam `tentativas` e gravam `ultimo_erro`.

**Idempotência por `eventId`.** O consumidor SQS usa o atributo `eventId` (ou o `MessageId`, se ausente) como chave. O `IdempotentProcessor` insere a chave em `mensagens_processadas` na mesma transação do handler; duplicata (violação de unicidade) é descartada. Erros do handler desfazem a transação e a mensagem não é removida da fila: reaparece após o visibility timeout e, depois de 3 recebimentos (`maxReceiveCount`), vai para a DLQ `oficina-billing-dlq`.

**Tabelas** (`prisma/schema.prisma`):

| Tabela | Conteúdo |
|---|---|
| `outbox` | eventos pendentes/publicados (`evento`, `payload`, `correlation_id`, `traceparent`, `published_at`, `tentativas`, `ultimo_erro`) |
| `mensagens_processadas` | `event_id` único, `evento`, `processed_at` |
| `orcamentos` | `os_id` único, `cliente_id`, `status` (`GERADO`/`APROVADO`/`REPROVADO`), `valor_total`, `motivo_reprovacao`, `correlation_id` |
| `orcamento_itens` | `tipo` (`SERVICO`/`PECA`), `ref_id`, `descricao`, `quantidade`, `preco_unitario` |
| `cobrancas` | `os_id` único, `orcamento_id` (coluna simples, sem FK), `gateway_payment_id` único, `valor`, `status` (`PENDENTE`/`CONFIRMADA`/`RECUSADA`), `checkout_url`, `saga_id`, `motivo` |
| `fake_gateway_pagamentos` | pagamentos do gateway simulado (`idempotency_key` único, `amount_cents`, `currency`, `status` `pending`/`approved`/`declined`, `metadata`) |

Transições de orçamento: só `GERADO` pode ir para `APROVADO` ou `REPROVADO`; qualquer outra transição responde 409.

## 3. Eventos consumidos

Fila `oficina-billing-queue`, assinada no tópico `oficina-os-events` com entrega raw e filtro por atributo de mensagem `evento` (`os.criada`, `diagnostico.concluido`, `os.cobranca.solicitada`). Atributos lidos: `evento` (obrigatório), `eventId`, `correlationId`, `traceparent`. Payload inválido ou evento sem handler: erro logado, mensagem não removida, DLQ após as reentregas.

| Evento | Tratamento |
|---|---|
| `os.criada` | só registra em log e confirma (ack); a idempotência grava o `eventId` |
| `diagnostico.concluido` | gera o orçamento e publica `orcamento.gerado` |
| `os.cobranca.solicitada` | abre a cobrança (ver abaixo) |

**`diagnostico.concluido`** aceita dois formatos (`osId = payload.osId ?? payload.id`):

```jsonc
// antigo: sem itens, orçamento gerado com valorTotal 0 (aviso em log)
{ "id": "<osId>", "status": "AGUARDANDO_APROVACAO" }

// novo
{
  "id": "<osId>", "osId": "<osId>", "status": "AGUARDANDO_APROVACAO",
  "clienteId": "<uuid>",
  "itens": [
    { "tipo": "SERVICO" | "PECA", "refId": "<id>", "descricao": "Troca de óleo", "quantidade": 1, "precoUnitario": 120.5 }
  ],
  "valorTotal": 190.7
}
```

Validação: `tipo` deve ser `SERVICO` ou `PECA`; `quantidade` inteiro positivo; `precoUnitario` e `valorTotal` números >= 0; `clienteId` texto não vazio quando presente. Sem `valorTotal`, o total é a soma de `precoUnitario * quantidade` em centavos. Se já existe orçamento para a OS, nada é gravado (idempotente por `osId`).

**`os.cobranca.solicitada`** - payload do OS: `{ "id": "<osId>", "sagaId": "<sagaId>", "ordem": ..., "nome": ..., "causadoPor": ... }`. Só `id` e `sagaId` são usados (ambos obrigatórios, texto não vazio). Regras:

- se já existe cobrança para a OS, nada é feito (idempotente por `osId`);
- sem orçamento, orçamento não `APROVADO` ou com valor 0: grava cobrança `RECUSADA` (motivo `orcamento_inexistente`, `orcamento_nao_aprovado` ou `valor_zero`) e publica `pagamento.recusado`;
- caso contrário, chama o gateway (`POST /gateway/payments`, `Idempotency-Key: <sagaId>:<osId>`, `amount_cents`, `currency` `BRL`, `description` `OS <osId>`, `metadata` com `osId`, `orcamentoId`, `sagaId`) e grava a cobrança `PENDENTE` com `checkout_url`.

## 4. Eventos publicados

Tópico `oficina-billing-events` (criado pelo `oficina-infra-k8s/mensageria`; aqui só entra como variável do terraform). Mensagem = `payload` em JSON. Atributos SNS de cada mensagem (todos `String`):

| Atributo | Valor |
|---|---|
| `evento` | nome do evento |
| `eventId` | id da linha do outbox (chave de deduplicação para o consumidor) |
| `correlationId` | correlation id da saga (herdado do evento recebido; no orçamento, o gravado em `orcamentos.correlation_id`; senão o header `x-correlation-id` ou um UUID novo) |
| `traceparent` | só quando disponível |

| Evento | Payload |
|---|---|
| `orcamento.gerado` | `{ osId, orcamentoId, valorTotal, status: "GERADO" }` |
| `orcamento.aprovado` | `{ osId, orcamentoId, valorTotal, status: "APROVADO" }` |
| `orcamento.reprovado` | `{ osId, orcamentoId, valorTotal, status: "REPROVADO", motivo }` |
| `pagamento.confirmado` | `{ osId, cobrancaId, valor, status: "CONFIRMADA" }` |
| `pagamento.recusado` (gateway recusou) | `{ osId, cobrancaId, valor, status: "RECUSADA", motivo: "pagamento_recusado" }` |
| `pagamento.recusado` (recusa antes do gateway) | `{ osId, cobrancaId: null, valor, status: "RECUSADA", motivo }` com `motivo` em `orcamento_inexistente`, `orcamento_nao_aprovado`, `valor_zero` |

`valorTotal` e `valor` são números (reais, 2 casas). Na recusa antes do gateway, o id da cobrança gravada vai só no `aggregateId` do outbox, não no payload.

## 5. Rotas

Prefixo global `/billing`; o gateway simulado fica em `/gateway` (fora do prefixo). Swagger em `/billing/docs`. Perfis: `ADMIN`, `ATENDENTE`, `MECANICO` (staff) e `CLIENTE` (token da `oficina-auth-lambda`). O JWT é validado com `JWT_SECRET` e a role vem da claim `role`.

| Método | Path | Auth | Roles | Respostas |
|---|---|---|---|---|
| GET | `/billing/health` | pública | - | 200 `{ "status": "ok" }` |
| GET | `/billing/orcamentos/by-os/:osId` | JWT | ADMIN, ATENDENTE, MECANICO, CLIENTE | 200; 401; 403; 404 |
| GET | `/billing/orcamentos/:id` | JWT | ADMIN, ATENDENTE, MECANICO, CLIENTE | 200; 401; 403; 404 |
| PATCH | `/billing/orcamentos/:id/aprovar` | JWT | ADMIN, ATENDENTE, CLIENTE | 200; 401; 403; 404; 409 (transição inválida) |
| PATCH | `/billing/orcamentos/:id/reprovar` | JWT | ADMIN, ATENDENTE, CLIENTE | 200; 400 (`motivo` ausente/vazio); 401; 403; 404; 409 |
| GET | `/billing/cobrancas/by-os/:osId` | JWT | ADMIN, ATENDENTE, MECANICO, CLIENTE | 200; 401; 403; 404 |
| POST | `/billing/webhooks/pagamento` | HMAC (sem JWT) | - | 200 `{ status }`; 400; 401; 404; 502; 503 |
| POST | `/gateway/oauth/token` | client_id/secret (body ou Basic) | - | 200 (Bearer, 300 s); 400 `unsupported_grant_type`; 401 `invalid_client`; 503 `gateway_not_configured` |
| POST | `/gateway/payments` | Bearer do gateway | - | 201 criado; 200 replay idempotente; 400; 401; 409 `idempotency_key_conflict`; 503 |
| GET | `/gateway/payments/:id` | Bearer do gateway | - | 200; 401; 404 `payment_not_found`; 503 |
| GET | `/gateway/checkout/:id` | pública | - | 200 HTML; 404 HTML |
| POST | `/gateway/checkout/:id/aprovar` | pública | - | 200 HTML (dispara o webhook `approved`) |
| POST | `/gateway/checkout/:id/recusar` | pública | - | 200 HTML (dispara o webhook `declined`) |

Os `:id`/`:osId` são validados como UUID (400 caso contrário). `PATCH` aceita o header `x-correlation-id`, usado quando o orçamento não tem correlation id gravado. O checkout só muda pagamentos `pending`; repetir a decisão não reenvia o webhook.

**Webhook de pagamento.** Corpo (enviado pelo gateway simulado): `{ payment_id, status, amount_cents, currency, metadata, occurred_at }`; só `payment_id` é obrigatório. Headers:

- `x-signature`: `hex(HMAC-SHA256(PAYMENT_WEBHOOK_SECRET, "<timestamp>." + <corpo bruto>))`;
- `x-signature-timestamp`: segundos unix; aceito dentro de ±300 s (5 min) do relógio local.

A assinatura é calculada sobre os bytes recebidos e comparada em tempo constante; sem segredo configurado, tudo é rejeitado (401). O `status` do corpo é só gatilho: o Billing sempre reconsulta o gateway e prevalece o status de lá (`pending` = nada a fazer). A transição `PENDENTE` para `CONFIRMADA`/`RECUSADA` é um update condicional, então só uma requisição grava o evento no outbox; webhook repetido é no-op (200 com o status atual). Gateway indisponível: 503; resposta inesperada: 502.

## 6. Variáveis de ambiente

"Onde": `configmap` (`k8s/configmap.yaml`), `secret` (Secret `oficina-billing-service-secret`, criado pelo CI a partir dos secrets do GitHub) ou `.env` (`.env.example`, só local).

| Nome | Onde | Obrigatória? | Descrição |
|---|---|---|---|
| `DATABASE_URL` | secret / .env | sim | conexão PostgreSQL; TLS com o bundle da AWS quando a URL tem `sslmode` diferente de `disable` |
| `PORT` | configmap / .env | não (3000) | porta HTTP |
| `NODE_ENV` | configmap (e Dockerfile) | não | `production` no cluster |
| `JWT_SECRET` | secret / .env | sim (o boot aborta sem ele) | segredo dos JWT; mesmo valor do OS |
| `AWS_REGION` | configmap / .env | sim para SNS/SQS | região dos clientes SNS/SQS |
| `AWS_ENDPOINT_URL` | .env | não | endpoint do LocalStack (lido pelo SDK) |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | secret | sim no cluster | chave do usuário IAM do pod (CI: `POD_AWS_ACCESS_KEY_ID`/`POD_AWS_SECRET_ACCESS_KEY`) |
| `SNS_TOPIC_ARN` | secret / .env | sim para publicar | tópico `oficina-billing-events`; sem ele o publisher não inicia |
| `OUTBOX_PUBLISHER_ENABLED` | configmap / .env | não | `true` liga o publisher |
| `OUTBOX_PUBLISH_INTERVAL_MS` | configmap / .env | não (5000) | intervalo da varredura |
| `OUTBOX_BATCH_SIZE` | configmap / .env | não (50) | linhas por lote |
| `SQS_QUEUE_URL` | secret / .env | sim para consumir | fila `oficina-billing-queue`; sem ela o consumidor não inicia |
| `SQS_CONSUMER_ENABLED` | configmap / .env | não | `true` liga o consumidor (no configmap versionado está `"false"`) |
| `SQS_WAIT_TIME_SECONDS` | configmap / .env | não (20) | long poll |
| `SQS_VISIBILITY_TIMEOUT_SECONDS` | configmap / .env | não (30) | visibility timeout do receive |
| `SQS_MAX_MESSAGES` | configmap / .env | não (10) | mensagens por poll (máx. 10) |
| `GATEWAY_CLIENT_ID`, `GATEWAY_CLIENT_SECRET` | secret / .env | não para subir | credenciais OAuth do gateway; usadas pelo gateway (validação) e pelo adapter do Billing (cliente) |
| `GATEWAY_JWT_SECRET` | secret / .env | não para subir | assina os tokens do gateway; sem as variáveis do gateway, `/gateway/*` responde 503 |
| `GATEWAY_PUBLIC_BASE_URL` | configmap / .env | não para subir | base do `checkout_url` devolvido ao cliente |
| `GATEWAY_INTERNAL_BASE_URL` | configmap / .env | não (`http://localhost:3000/gateway`) | base usada pelo adapter para chamar o gateway, sem barra final |
| `PAYMENT_WEBHOOK_URL` | configmap / .env | não para subir | destino do webhook disparado pelo gateway; sem ele (ou sem segredo) a notificação falha |
| `PAYMENT_WEBHOOK_SECRET` | secret / .env | não para subir | segredo HMAC do webhook; sem ele o endpoint rejeita tudo com 401 |

## 7. Rodando localmente

```bash
cp .env.example .env
docker compose up -d                      # Postgres (:5433) + LocalStack (SNS/SQS, :4566)
DATABASE_URL=postgresql://oficina:oficina@localhost:5433/oficina_billing npx prisma migrate deploy
yarn seed:orcamento                       # imprime orcamentoId, osId e um JWT de teste (1h)
SQS_CONSUMER_ENABLED=true yarn start      # API em http://localhost:3000/billing (Swagger em /billing/docs)
```

O LocalStack executa `scripts/localstack/init-sns.sh` ao subir: cria os tópicos `oficina-os-events` e `oficina-billing-events`, a fila `oficina-billing-queue` (DLQ `oficina-billing-dlq`, 3 recebimentos), a assinatura com o filtro de `evento` e a fila espiã `oficina-billing-spy`, que recebe tudo o que o Billing publica.

Fluxo completo até `pagamento.confirmado` (o seed cria um orçamento `GERADO` de R$ 150,00 para a OS `11111111-1111-4111-8111-111111111111`; rodar o seed de novo reseta o orçamento para `GERADO`):

```bash
export TOKEN=<token impresso pelo seed>
export ORCAMENTO_ID=<orcamentoId impresso pelo seed>
export OS_ID=11111111-1111-4111-8111-111111111111

# 1. Aprovar o orçamento (publica orcamento.aprovado)
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/billing/orcamentos/$ORCAMENTO_ID/aprovar

# 2. Simular o comando do OS (passo COBRAR)
docker exec oficina_billing_localstack awslocal sns publish \
  --topic-arn arn:aws:sns:us-east-1:000000000000:oficina-os-events \
  --message "{\"id\":\"$OS_ID\",\"sagaId\":\"saga-local-1\"}" \
  --message-attributes '{"evento":{"DataType":"String","StringValue":"os.cobranca.solicitada"},"eventId":{"DataType":"String","StringValue":"evt-local-1"}}'

# 3. Ver a cobrança PENDENTE e o checkout_url (após alguns segundos)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/billing/cobrancas/by-os/$OS_ID

# 4. Aprovar o pagamento no checkout simulado (o gateway chama o webhook)
curl -X POST <checkoutUrl>/aprovar

# 5. Conferir os eventos publicados (fila espiã, em ~10s)
docker exec oficina_billing_localstack awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/oficina-billing-spy \
  --message-attribute-names All --max-number-of-messages 10 --wait-time-seconds 5
```

Na fila espiã aparecem `orcamento.aprovado` e, depois do passo 4, `pagamento.confirmado` (use `curl -X POST <checkoutUrl com /recusar>` para ver `pagamento.recusado`). Para repetir o fluxo é preciso rodar o seed e usar outro `sagaId`/`eventId`, e a cobrança da OS anterior bloqueia nova cobrança: apague-a no banco ou use outra OS.

## 8. Testes e qualidade

```bash
yarn lint          # eslint --fix
yarn lint:ci       # eslint --max-warnings=0 (usado no CI)
yarn build         # nest build
yarn test          # jest
yarn test:cov      # jest --coverage; falha abaixo de 80% (statements, branches, functions, lines)
```

- Cobertura exclui `*.module.ts`, `main.ts`, `*.dto.ts` e `*.spec.ts`; o relatório lcov vai para `coverage/lcov.info`.
- Sonar: projeto `guimullerdev_oficina-billing-service` (`sonar-project.properties`). O passo do CI só roda quando o secret `SONAR_TOKEN` existe e usa a variável de repositório `SONAR_ORGANIZATION`, com `sonar.qualitygate.wait=true` (timeout 300 s).

Evidência de cobertura: _[inserir print/link do relatório de `yarn test:cov` e do dashboard do Sonar]_

## 9. Deploy

Pipeline `.github/workflows/ci-cd.yml` (push e PR em `main`; os jobs de imagem e deploy só rodam em push na `main`):

| Job | O que faz |
|---|---|
| `build-and-test` | `yarn install --frozen-lockfile`, `yarn lint:ci`, `yarn build`, `yarn test:cov`, scan Sonar (se houver `SONAR_TOKEN`) |
| `terraform-check` | `terraform fmt -check`, `init -backend=false`, `validate` em `terraform/` |
| `docker-build-push` | build e push da imagem para o GHCR: `ghcr.io/<owner>/oficina-billing-service:<sha>` e `:latest` |
| `deploy` | environment `prod`, namespace `prod`, cluster EKS `oficina-cluster` |

O job `deploy` é pulado (com aviso) sem `AWS_ACCESS_KEY_ID`, sem `DATABASE_URL` ou sem imagem. Etapas: conferir que `DATABASE_URL` aponta para o banco `oficina_billing`; criar/atualizar o Secret; aplicar o ConfigMap; rodar o **Job de migration** (`k8s/migration-job.yaml`, `npx prisma migrate deploy`, nome `oficina-billing-migrate-<sha7>`, espera até 300 s e aborta o rollout se falhar); aplicar Deployment (2 réplicas, probes em `/billing/health`), Service, Ingress (`/billing` e `/gateway`) e HPA; aguardar o rollout. As migrations nunca rodam no entrypoint do container.

Secrets do environment `prod` usados:

- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` (deploy; token só em AWS Academy);
- `DATABASE_URL`, `SNS_TOPIC_ARN`, `SQS_QUEUE_URL`, `JWT_SECRET` (obrigatório: sem ele o deploy falha);
- `POD_AWS_ACCESS_KEY_ID`, `POD_AWS_SECRET_ACCESS_KEY` (viram `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` do pod; chave do usuário IAM `oficina-billing-service-pod`, só mensageria);
- `GATEWAY_CLIENT_ID`, `GATEWAY_CLIENT_SECRET`, `GATEWAY_JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET` (opcionais: ausentes, `/gateway` responde 503).

Variáveis de repositório: `SONAR_ORGANIZATION`. O Terraform em `terraform/` (ver `terraform/README.md`) cria a fila, a DLQ, a assinatura no `oficina-os-events` (raw delivery + filtro de `evento`) e o usuário/policy IAM de mensageria.

Operação em janela paga (subir/derrubar o ambiente): [oficina-infra-k8s/docs/runbook-janela-paga.md](https://github.com/guimullerdev/oficina-infra-k8s/blob/main/docs/runbook-janela-paga.md).

## 10. Débitos declarados

- `execucao.falhou` não é consumido: não há cancelamento/estorno de cobrança quando a execução falha.
- O catálogo de serviços e peças fica no `oficina-os-service`; o Billing guarda só `refId`, `descricao`, quantidade e preço recebidos no evento. Como o OS não guarda o nome das peças nos itens da OS, elas chegam descritas como "Peça <id>".
- Credencial AWS do pod é uma chave IAM estática, sem IRSA.
- A chamada HTTP ao gateway acontece dentro da transação do `IdempotentProcessor` (segura uma conexão do pool; timeout de 5 s). Se o commit falhar depois do pagamento criado, a mensagem é reentregue e a `Idempotency-Key` (`sagaId:osId`) faz o gateway devolver o mesmo pagamento.
- Corrida rara: uma violação de unicidade (P2002) que escape do handler é tratada como duplicata e o registro em `mensagens_processadas` se perde; a reentrega vira no-op.
- Sem retentativa de webhook: se a entrega falha (timeout de 5 s, não-2xx), o gateway simulado só registra o aviso e a página de checkout indica a falha de notificação.
