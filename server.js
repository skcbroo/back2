import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
//import { ensureAuthenticated, ensureAdmin } from './auth.js';
import { ensureAuthenticated, ensureAdmin, tryExtractUser } from './auth.js';


const app = express();
const prisma = new PrismaClient();
dotenv.config();

app.use(cors());
app.use(express.json());

// === ROTAS ===

// Registro
app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha } = req.body;
  const senhaHash = await bcrypt.hash(senha, 10);
  try {
    const novoUsuario = await prisma.usuario.create({
      data: { nome, email, senha: senhaHash, role: 'cliente' }, // <- CORRIGIDO
    });
    res.json({ id: novoUsuario.id });
  } catch (e) {
    res.status(400).json({ erro: 'Email já cadastrado' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }
  const token = jwt.sign({ id: usuario.id, email: usuario.email, role: usuario.role }, process.env.JWT_SECRET);
  res.json({ token, role: usuario.role });
});

// Criar crédito judicial (admin)
app.post('/api/creditos', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { valor, area, fase, materia, desagio, preco, numeroProcesso, descricao, quantidadeCotas, cotasAdquiridas, status } = req.body;


  try {
    const novoCredito = await prisma.creditoJudicial.create({
      data: { valor, area, fase, materia, desagio, preco, numeroProcesso, descricao, quantidadeCotas, cotasAdquiridas, status },
    });
    res.status(201).json(novoCredito);
  } catch (err) {
    console.error('ERRO AO CADASTRAR CRÉDITO:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar crédito', detalhes: err.message });
  }
});

// Listar créditos (público)
app.get('/api/creditos', async (req, res) => {
  const creditos = await prisma.creditoJudicial.findMany({
    include: { cotas: true }
  });
  res.json(creditos);
});


// Obter um crédito específico por ID 
app.get('/api/creditos/:id', tryExtractUser, async (req, res) => {
  const id = parseInt(req.params.id);
  const usuarioId = req.user?.id; // ← pode ser undefined

  try {
    const credito = await prisma.creditoJudicial.findUnique({
      where: { id },
      include: {
        cotas: {
          include: { usuario: true }
        }
      }
    });

    if (!credito) return res.status(404).json({ erro: 'Crédito não encontrado' });

    let cotasDoUsuario = 0;

    if (usuarioId) {
      const cotaDoUsuario = await prisma.cota.findUnique({
        where: {
          usuarioId_creditoJudicialId: {
            usuarioId,
            creditoJudicialId: id
          }
        }
      });
      cotasDoUsuario = cotaDoUsuario?.quantidade || 0;
    }

    res.json({ ...credito, cotasDoUsuario });

  } catch (err) {
    console.error('Erro ao buscar crédito:', err);
    res.status(500).json({ erro: 'Erro interno ao buscar crédito' });
  }
});



// Confirmar aquisição (login obrigatório)
app.post('/api/creditos/:id/confirmar', ensureAuthenticated, async (req, res) => {
  const usuarioId = req.user.id;
  const creditoJudicialId = parseInt(req.params.id);
  const { quantidade } = req.body;

  try {
    const credito = await prisma.creditoJudicial.findUnique({
      where: { id: creditoJudicialId },
      include: { cotas: true },
    });

    if (!credito) return res.status(404).json({ erro: 'Crédito não encontrado' });

    const totalCotas = credito.quantidadeCotas;
    const cotasUsadas = credito.cotas.reduce((acc, c) => acc + c.quantidade, 0);
    const cotasDisponiveis = totalCotas - cotasUsadas;

    if (quantidade > cotasDisponiveis) {
      return res.status(400).json({ erro: 'Quantidade de cotas excede o disponível' });
    }

    const cotaExistente = await prisma.cota.findUnique({
      where: {
        usuarioId_creditoJudicialId: {
          usuarioId,
          creditoJudicialId,
        },
      },
    });

    if (cotaExistente) {
      await prisma.cota.update({
        where: {
          usuarioId_creditoJudicialId: {
            usuarioId,
            creditoJudicialId,
          },
        },
        data: {
          quantidade: { increment: quantidade },
        },
      });
    } else {
      await prisma.cota.create({
        data: {
          usuarioId,
          creditoJudicialId,
          quantidade,
        },
      });
    }

    res.status(200).json({ sucesso: true });
  } catch (err) {
    console.error('Erro ao confirmar aquisição:', err);
    res.status(500).json({ erro: 'Erro ao confirmar aquisição' });
  }
});

// Criar cota manualmente (admin)
app.post('/api/cotas', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { usuarioId, creditoJudicialId, quantidade } = req.body;

  if (!usuarioId || !creditoJudicialId || !quantidade) {
    return res.status(400).json({ erro: 'Dados incompletos: usuarioId, creditoJudicialId e quantidade são obrigatórios' });
  }

  try {
    // Verifique se o usuário existe
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // Verifique se o crédito existe
    const credito = await prisma.creditoJudicial.findUnique({ where: { id: creditoJudicialId } });
    if (!credito) return res.status(404).json({ erro: 'Crédito judicial não encontrado' });

    // Verifique cotas disponíveis
    const cotasUsadas = await prisma.cota.aggregate({
      where: { creditoJudicialId },
      _sum: { quantidade: true }
    });
    const cotasDisponiveis = credito.quantidadeCotas - (cotasUsadas._sum.quantidade || 0);
    if (quantidade > cotasDisponiveis) {
      return res.status(400).json({ erro: `Quantidade excede as cotas disponíveis (${cotasDisponiveis})` });
    }

    const cotaExistente = await prisma.cota.findUnique({
      where: {
        usuarioId_creditoJudicialId: {
          usuarioId,
          creditoJudicialId,
        },
      },
    });

    if (cotaExistente) {
      await prisma.cota.update({
        where: {
          usuarioId_creditoJudicialId: {
            usuarioId,
            creditoJudicialId,
          },
        },
        data: {
          quantidade: { increment: quantidade },
        },
      });
    } else {
      await prisma.cota.create({
        data: {
          usuarioId,
          creditoJudicialId,
          quantidade,
        },
      });
    }

    res.json({ msg: 'Cota registrada com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar cota:', err);
    res.status(500).json({ erro: 'Erro ao registrar cota', detalhes: err.message });
  }
});

app.get('/api/cotas', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const cotas = await prisma.cota.findMany({
      include: {
        usuario: { select: { id: true, nome: true } },
        creditoJudicial: { select: { id: true, numeroProcesso:true } },
      },
    });
    res.json(cotas);
  } catch (err) {
    console.error("Erro ao listar cotas:", err);
    res.status(500).json({ erro: "Erro ao listar cotas" });
  }
});

app.put('/api/cotas/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const { usuarioId } = req.body;

  try {
    const cota = await prisma.cota.update({
      where: { id: parseInt(id) },
      data: { usuarioId: parseInt(usuarioId) },
    });
    res.json(cota);
  } catch (err) {
    console.error("Erro ao editar cota:", err);
    res.status(500).json({ erro: "Erro ao editar cota" });
  }
});

app.delete('/api/cotas/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await prisma.cota.delete({
      where: { id: parseInt(id) },
    });
    res.status(204).send();
  } catch (err) {
    console.error("Erro ao remover cota:", err);
    res.status(500).json({ erro: "Erro ao remover cota" });
  }
});


// Listar cotas de um usuário
app.get('/api/usuarios/:id/cotas', ensureAuthenticated, async (req, res) => {
  const id = parseInt(req.params.id);
  const solicitanteId = req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isAdmin && id !== solicitanteId) {
    return res.status(403).json({ erro: "Acesso negado" });
  }

  try {
    const cotas = await prisma.cota.findMany({
      where: { usuarioId: id },
      include: { creditoJudicial: true }
    });
    res.json(cotas);
  } catch (err) {
    console.error("Erro ao buscar cotas:", err);
    res.status(500).json({ erro: "Erro ao buscar cotas do usuário" });
  }
});

// Listar créditos adquiridos
app.get('/api/creditos/adquiridos', async (req, res) => {
  try {
    const creditos = await prisma.creditoJudicial.findMany({ where: { adquirido: true } });
    res.json(creditos);
  } catch (err) {
    console.error('Erro ao buscar créditos adquiridos:', err);
    res.status(500).json({ erro: 'Erro ao buscar créditos adquiridos' });
  }
});

// Atualizar crédito (admin)
app.put('/api/creditos/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const { valor, area, fase, materia, desagio, preco, numeroProcesso, descricao, quantidadeCotas, cotasAdquiridas, status } = req.body;

  try {
    const atualizado = await prisma.creditoJudicial.update({
      where: { id: Number(id) },
      data: { valor, area, fase, materia, desagio, preco, numeroProcesso, descricao, quantidadeCotas, cotasAdquiridas, status },
    });
    res.json(atualizado);
  } catch (err) {
    console.error('Erro ao atualizar crédito:', err);
    res.status(500).json({ erro: 'Erro ao atualizar crédito' });
  }
});

// Excluir crédito (admin)
app.delete('/api/creditos/:id', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await prisma.creditoJudicial.delete({ where: { id: Number(id) } });
    res.json({ msg: 'Crédito excluído com sucesso' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir crédito' });
  }
});

// Dashboard admin
app.get('/api/admin/dashboard', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const usuarios = await prisma.usuario.count();
  const creditos = await prisma.creditoJudicial.count();
  const pedidos = await prisma.pedido.count();

  res.json({ usuarios, creditos, pedidos });
});

// Listar usuários (admin)
app.get('/api/usuarios', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const usuarios = await prisma.usuario.findMany({
    select: { id: true, nome: true, email: true, role: true },
  });
  res.json(usuarios);
});
//banco
app.get('/teste-db', async (req, res) => {
  try {
    const usuarios = await prisma.usuario.findMany({ take: 5 });
    res.json({ status: 'ok', usuarios });
  } catch (err) {
    console.error('Erro ao acessar o banco:', err);
    res.status(500).json({ erro: 'Banco não acessível', detalhes: err.message });
  }
});

// Listar ativos (cotas) do usuário logado
app.get('/api/ativos', ensureAuthenticated, async (req, res) => {
  try {
    const cotas = await prisma.cota.findMany({
      where: { usuarioId: req.user.id },
      include: { creditoJudicial: true },
    });

    const ativos = cotas.map((cota) => ({
      id: cota.creditoJudicial.id,
      numeroProcesso: cota.creditoJudicial.numeroProcesso,
      valor: cota.creditoJudicial.valor,
      preco: cota.creditoJudicial.preco,
      quantidadeCotas: cota.creditoJudicial.quantidadeCotas,
      desagio: cota.creditoJudicial.desagio,
      cotasCompradas: cota.quantidade,
    }));

    res.json(ativos);
  } catch (err) {
    console.error("Erro ao buscar ativos:", err);
    res.status(500).json({ erro: "Erro ao buscar ativos" });
  }
});



// Promover usuário a admin (admin)
app.post('/api/usuarios/promover', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { email } = req.body;
  const usuario = await prisma.usuario.update({
    where: { email },
    data: { role: 'admin' },
  });
  res.json({ msg: `${usuario.nome} agora é admin` });
});

// Rota raiz
app.get('/', (req, res) => {
  res.send('✅ API da Plataforma está rodando com sucesso!');
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
