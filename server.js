import express from 'express';//
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ensureAuthenticated, ensureAdmin, tryExtractUser } from './auth.js';
import crypto from "crypto";
import nodemailer from "nodemailer";
import { ptBR } from 'date-fns/locale';
import { format, parse, addMonths, isBefore } from "date-fns";



const app = express();
const prisma = new PrismaClient();
dotenv.config();

app.use(cors());
app.use(express.json());

// === ROTAS ===

// Registro
//app.post('/api/auth/register', async (req, res) => {
  //const { nome, email, senha } = req.body;
  //const senhaHash = await bcrypt.hash(senha, 10);
  //try {
    //const novoUsuario = await prisma.usuario.create({
      //data: { nome, email, senha: senhaHash, role: 'cliente' }, // <- CORRIGIDO
    //});
   // res.json({ id: novoUsuario.id });
  //} catch (e) {
   // res.status(400).json({ erro: 'Email já cadastrado' });
  //}
//});

//Registro
app.post('/api/auth/register', async (req, res) => {
  const { nome, email, senha } = req.body;

  try {
    const senhaHash = await bcrypt.hash(senha, 10);
    const tokenVerificacao = crypto.randomBytes(32).toString('hex');

    const novoUsuario = await prisma.usuario.create({
      data: {
        nome,
        email,
        senha: senhaHash,
        tokenVerificacao,
        emailVerificado: false,
        role: 'cliente',
      },
    });

    const link = `${process.env.FRONT_URL}/verificar-email/${tokenVerificacao}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      to: email,
      subject: "Verifique seu e-mail",
      html: `<p>Olá, ${nome}!</p><p>Para ativar sua conta, clique no link abaixo:</p><a href="${link}">${link}</a>`,
    });

    res.status(201).json({ msg: "Usuário criado. Verifique seu e-mail para ativar a conta." });
  } catch (err) {
    res.status(400).json({ erro: 'Erro ao cadastrar. E-mail já existe?' });
  }
});

//Verificar email
app.get('/api/auth/verificar-email/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const usuario = await prisma.usuario.findFirst({
      where: { tokenVerificacao: token },
    });

    if (!usuario) {
      return res.status(400).json({ erro: 'Token inválido ou expirado' });
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        emailVerificado: true,
        tokenVerificacao: null,
      },
    });

    res.json({ msg: 'E-mail verificado com sucesso. Você já pode fazer login.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao verificar e-mail' });
  }
});



// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, senha } = req.body;
  const usuario = await prisma.usuario.findUnique({ where: { email } });

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
    return res.status(401).json({ erro: 'Credenciais inválidas' });
  }

  if (!usuario.emailVerificado) {
    return res.status(403).json({ erro: 'Você precisa verificar seu e-mail antes de acessar.' });
  }

  const token = jwt.sign(
    { id: usuario.id, email: usuario.email, role: usuario.role },
    process.env.JWT_SECRET
  );

  res.json({ token, role: usuario.role });
});


// Criar crédito judicial (admin)
app.post('/api/creditos', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const {
    valor, area, fase, materia, desagio, preco,
    numeroProcesso, descricao, quantidadeCotas,
    cotasAdquiridas, status, dataEstimadaPagamento
  } = req.body;

  try {
    const novoCredito = await prisma.creditoJudicial.create({
      data: {
        valor,
        area,
        fase,
        materia,
        desagio,
        preco,
        numeroProcesso,
        descricao,
        quantidadeCotas,
        cotasAdquiridas,
        status,
        dataEstimadaPagamento: dataEstimadaPagamento ? new Date(dataEstimadaPagamento) : null
      },
    });
    res.status(201).json(novoCredito);
  } catch (err) {
    console.error('ERRO AO CADASTRAR CRÉDITO:', err);
    res.status(500).json({ erro: 'Erro ao cadastrar crédito', detalhes: err.message });
  }
});


app.get('/api/creditos/verificar/:numeroProcesso', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const numeroProcessoParam = req.params.numeroProcesso;
  const normalizadoParam = numeroProcessoParam.replace(/[^\d]/g, '');

  try {
    const creditos = await prisma.creditoJudicial.findMany();

    const existente = creditos.find(c => {
      const normalizadoDB = c.numeroProcesso.replace(/[^\d]/g, '');
      return normalizadoDB === normalizadoParam;
    });

    if (existente) {
      res.json({ existe: true, id: existente.id });
    } else {
      res.json({ existe: false });
    }
  } catch (err) {
    console.error("Erro ao verificar crédito:", err);
    res.status(500).json({ erro: "Erro ao verificar crédito" });
  }
});


//Gera token e envia e-mail
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const usuario = await prisma.usuario.findUnique({ where: { email } });

  if (!usuario) return res.status(404).json({ erro: "Email não encontrado" });

  const token = crypto.randomBytes(32).toString("hex");
  const expiracao = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  await prisma.usuario.update({
    where: { email },
    data: { tokenRecuperacao: token, tokenExpira: expiracao },
  });

  const resetLink = `${process.env.FRONT_URL}/resetar-senha/${token}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Redefinição de senha",
    html: `<p>Para redefinir sua senha, clique no link abaixo:</p><a href="${resetLink}">${resetLink}</a>`,
  });

  res.json({ msg: "E-mail enviado com sucesso" });
});

//Valida token e salva nova senha
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, novaSenha } = req.body;

  const usuario = await prisma.usuario.findFirst({
    where: {
      tokenRecuperacao: token,
      tokenExpira: { gte: new Date() },
    },
  });

  if (!usuario) return res.status(400).json({ erro: "Token inválido ou expirado" });

  const senhaHash = await bcrypt.hash(novaSenha, 10);

  await prisma.usuario.update({
    where: { id: usuario.id },
    data: {
      senha: senhaHash,
      tokenRecuperacao: null,
      tokenExpira: null,
    },
  });

  res.json({ msg: "Senha redefinida com sucesso" });
});


app.get('/api/creditos', async (req, res) => {
  try {
    const creditos = await prisma.creditoJudicial.findMany({
      include: {
        cotas: true
      }
    });

    res.json(creditos);
  } catch (err) {
    console.error("Erro ao buscar créditos:", err);
    res.status(500).json({ erro: "Erro ao buscar créditos" });
  }
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
// Criar cota manualmente (admin)
app.post('/api/cotas', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { usuarioId, creditoJudicialId, quantidade, dataAquisicao, dataPagamentoReal } = req.body;

  if (!usuarioId || !creditoJudicialId || !quantidade) {
    return res.status(400).json({ erro: 'Dados incompletos: usuarioId, creditoJudicialId e quantidade são obrigatórios' });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    // ❌ não buscamos mais o crédito para conferir capacidade
    const cotaExistente = await prisma.cota.findUnique({
      where: { usuarioId_creditoJudicialId: { usuarioId, creditoJudicialId } },
    });

    if (cotaExistente) {
      await prisma.cota.update({
        where: { usuarioId_creditoJudicialId: { usuarioId, creditoJudicialId } },
        data: {
          quantidade: { increment: quantidade },
          dataAquisicao: dataAquisicao ? new Date(dataAquisicao) : cotaExistente.dataAquisicao,
          dataPagamentoReal: dataPagamentoReal ? new Date(dataPagamentoReal) : cotaExistente.dataPagamentoReal,
        },
      });
    } else {
      await prisma.cota.create({
        data: {
          usuarioId,
          creditoJudicialId,
          quantidade,
          dataAquisicao: dataAquisicao ? new Date(dataAquisicao) : null,
          dataPagamentoReal: dataPagamentoReal ? new Date(dataPagamentoReal) : null,
        },
      });
    }

    // ❌ não recalcula mais `cotasAdquiridas` aqui
    res.json({ msg: 'Cota registrada com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar cota:', err);
    res.status(500).json({ erro: 'Erro ao registrar cota', detalhes: err.message });
  }
});


/*app.post('/api/cotas', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const {
    usuarioId,
    creditoJudicialId,
    quantidade,
    dataAquisicao,
    dataPagamentoReal
  } = req.body;

  if (!usuarioId || !creditoJudicialId || !quantidade) {
    return res.status(400).json({
      erro: 'Dados incompletos: usuarioId, creditoJudicialId e quantidade são obrigatórios'
    });
  }

  try {
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });

    const credito = await prisma.creditoJudicial.findUnique({ where: { id: creditoJudicialId } });
    if (!credito) return res.status(404).json({ erro: 'Crédito judicial não encontrado' });

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
          // opcionalmente atualizar datas se desejar
          dataAquisicao: dataAquisicao ? new Date(dataAquisicao) : cotaExistente.dataAquisicao,
          dataPagamentoReal: dataPagamentoReal ? new Date(dataPagamentoReal) : cotaExistente.dataPagamentoReal,
        },
      });
    } else {
      await prisma.cota.create({
        data: {
          usuarioId,
          creditoJudicialId,
          quantidade,
          dataAquisicao: dataAquisicao ? new Date(dataAquisicao) : null,
          dataPagamentoReal: dataPagamentoReal ? new Date(dataPagamentoReal) : null,
        },
      });
    }

    const totalAdquiridas = await prisma.cota.aggregate({
      where: { creditoJudicialId },
      _sum: { quantidade: true }
    });

    await prisma.creditoJudicial.update({
      where: { id: creditoJudicialId },
      data: {
        cotasAdquiridas: totalAdquiridas._sum.quantidade || 0
      }
    });

    res.json({ msg: 'Cota registrada com sucesso' });
  } catch (err) {
    console.error('Erro ao registrar cota:', err);
    res.status(500).json({ erro: 'Erro ao registrar cota', detalhes: err.message });
  }
});*/


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
  const { quantidade, dataAquisicao, dataPagamentoReal } = req.body;

  const data = {};
  if (quantidade !== undefined) data.quantidade = Number(quantidade);
  if (dataAquisicao !== undefined) {
    data.dataAquisicao = dataAquisicao ? new Date(dataAquisicao) : null;
  }
  if (dataPagamentoReal !== undefined) {
    data.dataPagamentoReal = dataPagamentoReal ? new Date(dataPagamentoReal) : null;
  }

  try {
    const cota = await prisma.cota.update({
      where: { id: parseInt(id) },
      data,
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


// Listar créditos com status 'Cotizando' (p/ uso no AdminCotas)
app.get('/api/creditos/cotizando', ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const creditosCotizando = await prisma.creditoJudicial.findMany({
      where: { status: 'Cotizando' },
      select: {
        id: true,
        numeroProcesso: true,
        valor: true // <-- Adicionado aqui
      }
    });
    res.json(creditosCotizando);
  } catch (err) {
    console.error("Erro ao listar créditos cotizando:", err);
    res.status(500).json({ erro: "Erro ao listar créditos cotizando" });
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
  const {
    valor, area, fase, materia, desagio, preco,
    numeroProcesso, descricao, quantidadeCotas,
    cotasAdquiridas, status, dataEstimadaPagamento
  } = req.body;

  try {
    const atualizado = await prisma.creditoJudicial.update({
      where: { id: Number(id) },
      data: {
        valor,
        area,
        fase,
        materia,
        desagio,
        preco,
        numeroProcesso,
        descricao,
        quantidadeCotas,
        cotasAdquiridas,
        status,
        dataEstimadaPagamento: dataEstimadaPagamento ? new Date(dataEstimadaPagamento) : null
      },
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

// Alterar senha do usuário (somente admin)
app.put('/api/usuarios/:id/senha', ensureAuthenticated, ensureAdmin, async (req, res) => {
  const { id } = req.params;
  const { novaSenha } = req.body;

  if (!novaSenha) return res.status(400).json({ erro: "A nova senha é obrigatória" });

  try {
    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await prisma.usuario.update({
      where: { id: parseInt(id) },
      data: { senha: senhaHash },
    });

    res.json({ msg: "Senha atualizada com sucesso" });
  } catch (err) {
    console.error("Erro ao alterar senha:", err);
    res.status(500).json({ erro: "Erro ao alterar senha" });
  }
});

app.post('/api/auth/alterar-senha', ensureAuthenticated, async (req, res) => {
  const { senhaAtual, novaSenha } = req.body;

  try {
    const usuario = await prisma.usuario.findUnique({
      where: { id: req.user.id },
    });

    if (!usuario) {
      return res.status(404).json({ erro: 'Usuário não encontrado' });
    }

    const senhaCorreta = await bcrypt.compare(senhaAtual, usuario.senha);
    if (!senhaCorreta) {
      return res.status(400).json({ erro: 'Senha atual incorreta' });
    }

    const novaSenhaHash = await bcrypt.hash(novaSenha, 10);
    await prisma.usuario.update({
      where: { id: req.user.id },
      data: { senha: novaSenhaHash },
    });

    return res.json({ msg: 'Senha alterada com sucesso' });
  } catch (err) {
    console.error("Erro ao alterar senha:", err);
    return res.status(500).json({ erro: 'Erro interno ao alterar senha' });
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
      status: cota.creditoJudicial.status, // ✅ incluído aqui
      cotasCompradas: cota.quantidade,
    }));

    res.json(ativos);
  } catch (err) {
    console.error("Erro ao buscar ativos:", err);
    res.status(500).json({ erro: "Erro ao buscar ativos" });
  }
});

// === RETORNO PROJETADO ===
// === RETORNO PROJETADO ===
app.get('/api/retorno-projetado', ensureAuthenticated, async (req, res) => {
  try {
    const cotas = await prisma.cota.findMany({
      where: { usuarioId: req.user.id },
      include: { creditoJudicial: true },
    });

    const agrupado = {};
    const aquisicoes = [];

    for (const cota of cotas) {
      const credito = cota.creditoJudicial;

      // === CURVA DE RETORNO PROJETADO ===
      const dataPagamento =
        credito.status === 'Pago' && cota.dataPagamentoReal
          ? new Date(cota.dataPagamentoReal)
          : credito.dataEstimadaPagamento
          ? new Date(credito.dataEstimadaPagamento)
          : null;

      if (dataPagamento && credito.quantidadeCotas && credito.quantidadeCotas > 0) {
        const mes = format(dataPagamento, "MMM/yyyy", { locale: ptBR });
        const retornoPorCota = credito.valor / credito.quantidadeCotas;
        const valorProjetado = cota.quantidade * retornoPorCota;
        agrupado[mes] = (agrupado[mes] || 0) + valorProjetado;
      }

      // === APORTES PARA CURVA CDI ===
      if (cota.dataAquisicao && credito.quantidadeCotas && credito.quantidadeCotas > 0) {
        const valorCota = credito.preco / credito.quantidadeCotas; // <- valor de aquisição
        aquisicoes.push({
          data: new Date(cota.dataAquisicao),
          valor: cota.quantidade * valorCota,
        });
      }
    }

    // === ORGANIZA RETORNO PROJETADO ===
   // === ORGANIZA RETORNO PROJETADO COM INTERVALO BASEADO EM AQUISIÇÃO E PAGAMENTO ===

// Converte agrupado para [{ mes, valor, dataReal }]
const ordenado = Object.entries(agrupado)
  .map(([mes, valor]) => {
    const [mesAbrev, ano] = mes.split('/');
    const dataReal = parse(`01/${mesAbrev}/${ano}`, 'dd/MMM/yyyy', new Date(), { locale: ptBR });
    return { mes, valor, dataReal };
  })
  .sort((a, b) => a.dataReal - b.dataReal);

if (ordenado.length === 0) {
  return res.json({ retornoPorMes: [], comparativoCDI: [] });
}

// 🔽 NOVO INÍCIO: menor data de aquisição
const inicio = aquisicoes.length > 0
  ? new Date(Math.min(...aquisicoes.map((a) => a.data.getTime())))
  : ordenado[0].dataReal;

// 🔼 NOVO FIM: maior data estimada de pagamento (projeção)
const dataMaxima = new Date(Math.max(
  ...cotas
    .map((c) => c.creditoJudicial.dataEstimadaPagamento)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
));

const fim = addMonths(dataMaxima, 1); // ✅ folga de 1 mês

const preenchido = [];
let acumulado = 0;
let atual = inicio;
let i = 0;

while (!isBefore(fim, atual)) {
  const mes = format(atual, "MMM/yyyy", { locale: ptBR });
  if (ordenado[i] && format(ordenado[i].dataReal, "MMM/yyyy", { locale: ptBR }) === mes) {
    acumulado += ordenado[i].valor;
    i++;
  }
  preenchido.push({ mes, valor: acumulado });
  atual = addMonths(atual, 1);
}


    // === CALCULA CURVA CDI (base: valor de aquisição acumulado) ===
    const taxaCDIMensal = Math.pow(1 + 0.15, 1 / 12) - 1;
    const listaMeses = preenchido.map((p) => p.mes);

    // Ordena aquisições por data
    const aquisicoesOrdenadas = aquisicoes
      .filter(a => a.data && a.valor)
      .sort((a, b) => a.data - b.data);

    // Inicializa mapa com zero em todos os meses
    const mapaCDI = {};
    for (const mes of listaMeses) {
      mapaCDI[mes] = 0;
    }

    let montante = 0;
    let mesAnterior = null;

    for (const mes of listaMeses) {
      for (const aq of aquisicoesOrdenadas) {
        const mesAq = format(aq.data, "MMM/yyyy", { locale: ptBR });
        if (mesAq === mes) {
          montante += aq.valor;
        }
      }

      if (mesAnterior !== null) {
        montante *= 1 + taxaCDIMensal;
      }

      mapaCDI[mes] = montante;
      mesAnterior = mes;
    }

    const comparativoCDI = listaMeses.map((mes) => ({
      mes,
      valor: Number((mapaCDI[mes] || 0).toFixed(2)),
    }));

    res.json({
      retornoPorMes: preenchido,
      comparativoCDI,
    });
  } catch (err) {
    console.error("❌ Erro ao calcular retorno projetado:", err);
    res.status(500).json({ erro: "Erro ao calcular retorno projetado" });
  }
});

// RETORNO GERAL DOS ATIVOS
app.get("/api/retorno-agenciado", async (req, res) => {
  try {
    const cotas = await prisma.cota.findMany({
      include: { creditoJudicial: true },
    });

    const agrupado = {};
    const aquisicoes = [];

    for (const cota of cotas) {
      const credito = cota.creditoJudicial;

      if (!credito || !credito.quantidadeCotas || credito.quantidadeCotas === 0)
        continue;

      // === CURVA DE RETORNO PROJETADO ===
      const dataPagamento =
        credito.status === "Pago" && cota.dataPagamentoReal
          ? new Date(cota.dataPagamentoReal)
          : credito.dataEstimadaPagamento
          ? new Date(credito.dataEstimadaPagamento)
          : null;

      if (dataPagamento) {
        const mes = format(dataPagamento, "MMM/yyyy", { locale: ptBR });
        const retornoPorCota = credito.valor / credito.quantidadeCotas;
        const valorProjetado = cota.quantidade * retornoPorCota;
        agrupado[mes] = (agrupado[mes] || 0) + valorProjetado;
      }

      // === APORTES PARA CDI ===
      if (cota.dataAquisicao) {
        const valorCota = credito.preco / credito.quantidadeCotas;
        aquisicoes.push({
          data: new Date(cota.dataAquisicao),
          valor: cota.quantidade * valorCota,
        });
      }
    }

    // === ORGANIZA RETORNO PROJETADO COM BASE NO PERÍODO ===
    const ordenado = Object.entries(agrupado)
      .map(([mes, valor]) => {
        const [mesAbrev, ano] = mes.split("/");
        const dataReal = parse(`01/${mesAbrev}/${ano}`, "dd/MMM/yyyy", new Date(), { locale: ptBR });
        return { mes, valor, dataReal };
      })
      .sort((a, b) => a.dataReal - b.dataReal);

    if (ordenado.length === 0) {
      return res.json({ retornoPorMes: [], comparativoCDI: [] });
    }

    const inicio = aquisicoes.length > 0
      ? new Date(Math.min(...aquisicoes.map((a) => a.data.getTime())))
      : ordenado[0].dataReal;

    const dataMaxima = new Date(Math.max(
      ...cotas.map((c) => c.creditoJudicial.dataEstimadaPagamento).filter(Boolean).map((d) => new Date(d).getTime())
    ));

    const fim = addMonths(dataMaxima, 1);
    const preenchido = [];
    let acumulado = 0;
    let atual = inicio;
    let i = 0;

    while (!isBefore(fim, atual)) {
      const mes = format(atual, "MMM/yyyy", { locale: ptBR });
      if (ordenado[i] && format(ordenado[i].dataReal, "MMM/yyyy", { locale: ptBR }) === mes) {
        acumulado += ordenado[i].valor;
        i++;
      }
      preenchido.push({ mes, valor: Number(acumulado.toFixed(2)) });
      atual = addMonths(atual, 1);
    }

    // === CDI acumulado
    const taxaCDIMensal = Math.pow(1 + 0.15, 1 / 12) - 1;
    const listaMeses = preenchido.map((p) => p.mes);
    const aquisicoesOrdenadas = aquisicoes.sort((a, b) => a.data - b.data);

    const mapaCDI = {};
    let montante = 0;
    let mesAnterior = null;

    for (const mes of listaMeses) {
      for (const aq of aquisicoesOrdenadas) {
        const mesAq = format(aq.data, "MMM/yyyy", { locale: ptBR });
        if (mesAq === mes) {
          montante += aq.valor;
        }
      }

      if (mesAnterior !== null) {
        montante *= 1 + taxaCDIMensal;
      }

      mapaCDI[mes] = Number(montante.toFixed(2));
      mesAnterior = mes;
    }

    const comparativoCDI = listaMeses.map((mes) => ({
      mes,
      valor: mapaCDI[mes],
    }));

    res.json({ retornoPorMes: preenchido, comparativoCDI });
  } catch (err) {
    console.error("Erro ao calcular retorno agenciado:", err);
    res.status(500).json({ erro: "Erro ao calcular retorno agenciado" });
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

















