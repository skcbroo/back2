import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ensureAuthenticated, ensureAdmin, tryExtractUser } from './auth.js';
import crypto from "crypto";
import nodemailer from "nodemailer";
import { ptBR } from 'date-fns/locale';
import { format, parse, addMonths, isBefore, isAfter, startOfMonth } from "date-fns";

const app = express();
const prisma = new PrismaClient();
dotenv.config();

app.use(cors());
app.use(express.json());

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

      if (cota.dataAquisicao && credito.quantidadeCotas && credito.quantidadeCotas > 0) {
        const valorCota = credito.preco / credito.quantidadeCotas;
        aquisicoes.push({
          data: new Date(cota.dataAquisicao),
          valor: cota.quantidade * valorCota,
        });
      }
    }

    const ordenado = Object.entries(agrupado)
      .map(([mes, valor]) => {
        const [mesAbrev, ano] = mes.split('/');
        const dataReal = parse(`01/${mesAbrev}/${ano}`, 'dd/MMM/yyyy', new Date(), { locale: ptBR });
        return { mes, valor, dataReal };
      })
      .sort((a, b) => a.dataReal - b.dataReal);

    if (ordenado.length === 0) return res.json({ retornoPorMes: [], comparativoCDI: [] });

    const dataInicioGrafico = aquisicoes.length > 0
      ? startOfMonth(new Date(Math.min(...aquisicoes.map(a => a.data.getTime()))))
      : startOfMonth(ordenado[0].dataReal);

    const dataFimGrafico = startOfMonth(ordenado[ordenado.length - 1].dataReal);

    const listaMeses = [];
    let atual = dataInicioGrafico;
    while (!isAfter(atual, dataFimGrafico)) {
      listaMeses.push(format(atual, "MMM/yyyy", { locale: ptBR }));
      atual = addMonths(atual, 1);
    }

    const preenchido = [];
    let acumulado = 0;
    let i = 0;

    for (const mes of listaMeses) {
      if (
        ordenado[i] &&
        format(ordenado[i].dataReal, "MMM/yyyy", { locale: ptBR }) === mes
      ) {
        acumulado += ordenado[i].valor;
        i++;
      }
      preenchido.push({ mes, valor: acumulado });
    }

    const taxaCDIMensal = Math.pow(1 + 0.15, 1 / 12) - 1;
    const aquisicoesOrdenadas = aquisicoes
      .filter(a => a.data && a.valor)
      .sort((a, b) => a.data - b.data);

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
