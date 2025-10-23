import jwt from 'jsonwebtoken';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';

export function requireSession(req, res, next) {
  const token = req.cookies?.mcp_session;
  if (!token) return res.status(401).json({ error: 'No session token' });

  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Session verify failed', err);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}