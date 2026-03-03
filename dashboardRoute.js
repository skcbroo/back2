// dashboardRoute.js
import express from "express";
import { prisma } from "./prisma.js";
import { ensureAuthenticated, ensureAdmin } from "./auth.js";

const router = express.Router();

/**
 * GET /api/dashboard/midlej/state
 * Protegi com login (e admin opcional).
 * Se quiser que qualquer usuário logado veja: deixa só ensureAuthenticated.
 * Se quiser só admin ver: coloca ensureAdmin também.
 */
router.get("/dashboard/midlej/state", ensureAuthenticated, async (req, res) => {
  try {
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
  } catch (e) {
    console.error("dashboard state error:", e);
    res.status(500).json({ erro: "Erro ao carregar dashboard" });
  }
});

/**
 * PUT /api/dashboard/midlej/settings (admin)
 */
router.put("/dashboard/midlej/settings", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const data = req.body;

    await prisma.$executeRaw`
      INSERT INTO "DashboardSettings" ("key","data")
      VALUES ('midlej', ${JSON.stringify(data)}::jsonb)
      ON CONFLICT ("key")
      DO UPDATE SET "data"=EXCLUDED."data", "updatedAt"=now()
    `;

    res.json({ ok: true });
  } catch (e) {
    console.error("dashboard settings error:", e);
    res.status(500).json({ erro: "Erro ao salvar settings" });
  }
});

/**
 * POST /api/dashboard/midlej/vendas (admin)
 * Body: { descricao, vendedor: 'mc'|'rui', valor }
 */
router.post("/dashboard/midlej/vendas", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { descricao, vendedor, valor } = req.body || {};
    if (!descricao || !vendedor || !valor) return res.status(400).json({ erro: "Campos obrigatórios" });

    const rows = await prisma.$queryRaw`
      INSERT INTO "DashboardVenda" ("dashboardKey","descricao","vendedor","valor")
      VALUES ('midlej', ${descricao}, ${vendedor}, ${Number(valor)})
      RETURNING "id","descricao","vendedor","valor","createdAt" as created_at
    `;

    res.status(201).json(rows?.[0]);
  } catch (e) {
    console.error("dashboard vendas post error:", e);
    res.status(500).json({ erro: "Erro ao criar venda" });
  }
});

/**
 * DELETE /api/dashboard/midlej/vendas/:id (admin)
 */
router.delete("/dashboard/midlej/vendas/:id", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.$executeRaw`
      DELETE FROM "DashboardVenda"
      WHERE "id"=${id}::uuid AND "dashboardKey"='midlej'
    `;

    res.status(204).send();
  } catch (e) {
    console.error("dashboard vendas delete error:", e);
    res.status(500).json({ erro: "Erro ao remover venda" });
  }
});

export default router;
