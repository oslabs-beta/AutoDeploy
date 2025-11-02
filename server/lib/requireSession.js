// import jwt from 'jsonwebtoken';

// const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret';

// export function requireSession(req, res, next) {
//   let token = req.cookies?.mcp_session;
//   if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
//     token = req.headers.authorization.slice(7);
//   }
//   if (!token) return res.status(401).json({ error: 'No session token' });

//   try {
//     const decoded = jwt.verify(token, SESSION_SECRET);
//     req.user = decoded;
//     next();
//   } catch (err) {
//     console.error('Session verify failed', err);
//     return res.status(401).json({ error: 'Invalid or expired session' });
//   }
// }

import jwt from 'jsonwebtoken';

export function requireSession(req, res, next) {
  const raw = req.cookies?.mcp_session;
  if (!raw) return res.status(401).json({ error: 'No session' });
  try {
    const user = jwt.verify(raw, process.env.JWT_SECRET); // MUST match the signer
    req.user = user; // { user_id, github_username, email, iat, exp }
    return next();
  } catch (e) {
    console.error('[requireSession] verify failed:', e.message);
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}
