-- CreateEnum
CREATE TYPE "TipoItemOrcamento" AS ENUM ('SERVICO', 'PECA');

-- CreateTable
CREATE TABLE "orcamento_itens" (
    "id" TEXT NOT NULL,
    "orcamento_id" TEXT NOT NULL,
    "tipo" "TipoItemOrcamento" NOT NULL,
    "ref_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "orcamento_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orcamento_itens_orcamento_id_idx" ON "orcamento_itens"("orcamento_id");

-- AddForeignKey
ALTER TABLE "orcamento_itens" ADD CONSTRAINT "orcamento_itens_orcamento_id_fkey" FOREIGN KEY ("orcamento_id") REFERENCES "orcamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

