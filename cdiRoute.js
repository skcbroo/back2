import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';

const router = express.Router();

router.get('/cdi', async (req, res) => {
  console.log("Iniciando scraping do CDI...");
  try {
    const url = 'https://www.bcb.gov.br/acessoinformacao/legado?url=https:%2F%2Fwww.bcb.gov.br%2Fhtms%2Fselic%2Fselicdiarios.asp';
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    const linha = $('div[role="row"]').first();
    const celulas = linha.find('.ui-grid-cell-contents');

    const data = $(celulas[0]).text().trim();
    const taxa = $(celulas[1]).text().trim();
    const taxaCDI = parseFloat(taxa.replace(',', '.'));

    res.json({ data, taxaCDI });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar CDI' });
  }
});

export default router;
