-- AlterTable
ALTER TABLE "CreditoJudicial" ADD COLUMN     "adquirido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "descricao" TEXT,
ADD COLUMN     "numeroProcesso" TEXT;
