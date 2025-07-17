-- AlterTable
ALTER TABLE "CreditoJudicial" ADD COLUMN     "quantidadeCotas" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Cota" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "creditoJudicialId" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cota_usuarioId_creditoJudicialId_key" ON "Cota"("usuarioId", "creditoJudicialId");

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_creditoJudicialId_fkey" FOREIGN KEY ("creditoJudicialId") REFERENCES "CreditoJudicial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
