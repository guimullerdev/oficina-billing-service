-- CreateEnum
CREATE TYPE "StatusCobranca" AS ENUM ('PENDENTE', 'CONFIRMADA', 'RECUSADA');

-- CreateTable
CREATE TABLE "cobrancas" (
    "id" TEXT NOT NULL,
    "os_id" TEXT NOT NULL,
    "orcamento_id" TEXT,
    "gateway_payment_id" TEXT,
    "valor" DECIMAL(10,2) NOT NULL,
    "status" "StatusCobranca" NOT NULL,
    "checkout_url" TEXT,
    "correlation_id" TEXT,
    "saga_id" TEXT,
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobrancas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_os_id_key" ON "cobrancas"("os_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_gateway_payment_id_key" ON "cobrancas"("gateway_payment_id");
