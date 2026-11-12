# oficina-billing-service
Tech Challenge Fase 4 - microsservico de Orcamento e Pagamento (NestJS, PostgreSQL/RDS, Mercado Pago)

## Rodando localmente

```bash
cp .env.example .env
docker compose up -d                      # Postgres (:5433) + LocalStack
DATABASE_URL=postgresql://oficina:oficina@localhost:5433/oficina_billing npx prisma migrate deploy
yarn seed:orcamento                       # imprime orcamentoId, osId e um JWT de teste (1h)
SQS_CONSUMER_ENABLED=true yarn start      # API em http://localhost:3000/billing (Swagger em /billing/docs)
```

Aprovar o orçamento criado pelo seed (use o `orcamentoId` e o `token` impressos):

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/billing/orcamentos/$ORCAMENTO_ID/aprovar
```

Conferir o evento `orcamento.aprovado` publicado (fila espiã, em ~10s):

```bash
docker exec oficina_billing_localstack awslocal sqs receive-message \
  --queue-url http://localhost:4566/000000000000/oficina-billing-spy \
  --message-attribute-names All --wait-time-seconds 5
```

Rodar o seed de novo reseta o orçamento para `GERADO`.
