import express from "express";

const router = express.Router();

// GET state (pode proteger com seu middleware auth)
router.get("/dashboard/midlej/state", async (req, res) => {
  const prisma = req.prisma; // ou importe seu prisma client, dependendo do seu projeto

  const settingsRows = await prisma.$queryRaw`
    SELECT "data" FROM "DashboardSettings" WHERE "key"='midlej' LIMIT 1
  `;

  const vendas = await prisma.$queryRaw`
    SELECT "id","descricao","vendedor","valor","createdAt" as created_at
    FROM "DashboardVenda"
    WHERE "dashboardKey"='midlej'
    ORDER BY "createdAt" ASC
  `;

  res.json({
    settings: settingsRows?.[0]?.data || {},
    vendas: vendas || [],
  });
});

// PUT settings (admin)
router.put("/dashboard/midlej/settings", async (req, res) => {
  const prisma = req.prisma;
  const data = req.body;

  await prisma.$executeRaw`
    INSERT INTO "DashboardSettings" ("key","data")
    VALUES ('midlej', ${JSON.stringify(data)}::jsonb)
    ON CONFLICT ("key")
    DO UPDATE SET "data"=EXCLUDED."data", "updatedAt"=now()
  `;

  res.json({ ok: true });
});

// POST venda (admin)
router.post("/dashboard/midlej/vendas", async (req, res) => {
  const prisma = req.prisma;
  const { descricao, vendedor, valor } = req.body || {};
  if (!descricao || !vendedor || !valor) return res.status(400).send("Campos obrigatórios");

  const rows = await prisma.$queryRaw`
    INSERT INTO "DashboardVenda" ("dashboardKey","descricao","vendedor","valor")
    VALUES ('midlej', ${descricao}, ${vendedor}, ${Number(valor)})
    RETURNING "id","descricao","vendedor","valor","createdAt" as created_at
  `;

  res.status(201).json(rows?.[0]);
});

// DELETE venda (admin)
router.delete("/dashboard/midlej/vendas/:id", async (req, res) => {
  const prisma = req.prisma;
  const id = req.params.id;

  await prisma.$executeRaw`
    DELETE FROM "DashboardVenda" WHERE "id"=${id}::uuid AND "dashboardKey"='midlej'
  `;

  res.status(204).send();
});

export default router;
