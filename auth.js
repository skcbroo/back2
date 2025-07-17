import jwt from 'jsonwebtoken';

export function ensureAuthenticated(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ erro: 'Token não enviado' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ erro: 'Token inválido' });
  }
}

export function ensureAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Apenas administradores podem acessar esta rota' });
  }
  next();
}
