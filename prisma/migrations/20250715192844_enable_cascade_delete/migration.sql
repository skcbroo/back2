-- DropForeignKey
ALTER TABLE "Cota" DROP CONSTRAINT "Cota_creditoJudicialId_fkey";

-- AlterTable
ALTER TABLE "CreditoJudicial" ALTER COLUMN "quantidadeCotas" SET DEFAULT 1;

-- AddForeignKey
ALTER TABLE "Cota" ADD CONSTRAINT "Cota_creditoJudicialId_fkey" FOREIGN KEY ("creditoJudicialId") REFERENCES "CreditoJudicial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
