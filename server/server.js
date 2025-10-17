import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { healthCheck } from './db.js';
import githubAuthRouter from './routes/auth.github.js';
import userRouter from './routes/usersRoutes.js';

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(morgan('dev'));

// Health & DB ping
app.get('/health', (_req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);
app.get('/db/ping', async (_req, res) => {
  try {
    const ok = await healthCheck();
    res.json({ ok });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Mount users route at /users
app.use('/', userRouter);

// --- Request Logging Middleware ---
app.use((req, res, next) => {
  const user = req.headers['x-user-id'] || 'anonymous';
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${
      req.originalUrl
    } | user=${user}`
  );
  next();
});

// -- Agent entry point
app.use('/mcp/v1', mcpRoutes);

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error('Global Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: err.message,
  });
});

// Mount GitHub OAuth routes at /auth/github
app.use('/auth/github', githubAuthRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API on http://localhost:${port}`));
