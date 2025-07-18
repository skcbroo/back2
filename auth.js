import jwt from 'jsonwebtoken';

// Middleware padrão: exige token válido
export function ensureAuthenticated(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ erro: 'Token não enviado' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("Erro ao verificar token:", err.message);
    return res.status(403).json({ erro: 'Token inválido' });
  }
}

// Middleware para rotas públicas: tenta extrair o usuário, se houver token
export function tryExtractUser(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (err) {
      // Token inválido — ignora e segue sem req.user
      console.warn("Token inválido ignorado em rota pública");
    }
  }
  next();
}

// Verifica se é admin
export function ensureAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Apenas administradores podem acessar esta rota' });
  }
  next();
}
