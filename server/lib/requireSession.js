// Middleware to validate the user's JWT session cookie
import jwt from 'jsonwebtoken';

// Ensures a valid mcp_session JWT is present; attaches decoded user to req
export function requireSession(req, res, next) {
  const raw = req.cookies?.mcp_session;

  if (!raw) return res.status(401).json({ error: 'No session' });

  try {
    const user = jwt.verify(raw, process.env.JWT_SECRET);
    req.user = user;
    return next();
  } catch (e) {
    console.error('[requireSession] verify failed:', e.message);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
