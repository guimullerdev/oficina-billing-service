-- CreateEnum
CREATE TYPE "StatusOrcamento" AS ENUM ('GERADO', 'APROVADO', 'REPROVADO');

-- CreateTable
CREATE TABLE "orcamentos" (
    "id" TEXT NOT NULL,
    "os_id" TEXT NOT NULL,
    "cliente_id" TEXT,
    "status" "StatusOrcamento" NOT NULL,
    "valor_total" DECIMAL(10,2) NOT NULL,
    "motivo_reprovacao" TEXT,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orcamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orcamentos_os_id_key" ON "orcamentos"("os_id");

