-- CreateEnum
CREATE TYPE "FakeGatewayPagamentoStatus" AS ENUM ('pending', 'approved', 'declined');

-- CreateTable
CREATE TABLE "fake_gateway_pagamentos" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "description" TEXT,
    "status" "FakeGatewayPagamentoStatus" NOT NULL DEFAULT 'pending',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fake_gateway_pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fake_gateway_pagamentos_idempotency_key_key" ON "fake_gateway_pagamentos"("idempotency_key");

