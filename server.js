require('dotenv').config();

const fs = require('fs');
const https = require('https');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { Server: SocketIOServer } = require('socket.io');

const { connectDatabase } = require('./database');
const logger = require('./logger');

const { router: authRouter } = require('./auth');
const walletRouter = require('./wallet');
const { router: gameRouter, attachSocket } = require('./game');
const adminRouter = require('./admin');

const app = express();

/* ------------------------------------------------------------------ */
/*  Trust proxy (needed for correct client IPs / rate limiting behind    */
/*  a reverse proxy such as nginx or Caddy doing TLS termination)         */
/* ------------------------------------------------------------------ */
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

/* ------------------------------------------------------------------ */
/*  Core security & parsing middleware                                  */
/* ------------------------------------------------------------------ */
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Global API rate limit (in addition to the stricter per-route limiters
// defined inside auth.js and wallet.js for sensitive actions).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

/* ------------------------------------------------------------------ */
/*  Routes                                                              */
/* ------------------------------------------------------------------ */
app.use('/api/auth', authRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/game', gameRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

// Centralized error handler - keep this last
app.use((err, req, res, next) => {
  logger.error(err.message, { stack: err.stack, path: req.path, method: req.method });
  const status = err.status || 500;
  const isProd = process.env.NODE_ENV === 'production';
  res.status(status).json({ error: isProd && status === 500 ? 'Internal server error' : err.message });
});

/* ------------------------------------------------------------------ */
/*  HTTPS-ready server bootstrap                                        */
/*                                                                        */
/*  In production, terminate TLS at a reverse proxy (nginx/Caddy/ALB)    */
/*  and set TRUST_PROXY=1, OR provide SSL_KEY_PATH/SSL_CERT_PATH below   */
/*  to have Node terminate TLS directly.                                 */
/* ------------------------------------------------------------------ */
async function start() {
  await connectDatabase();

  const port = process.env.PORT || 5000;
  let server;

  if (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH) {
    const options = {
      key: fs.readFileSync(process.env.SSL_KEY_PATH),
      cert: fs.readFileSync(process.env.SSL_CERT_PATH),
    };
    server = https.createServer(options, app);
    logger.info(`Starting HTTPS server on port ${port}`);
  } else {
    server = http.createServer(app);
    logger.info(`Starting HTTP server on port ${port} (set SSL_KEY_PATH/SSL_CERT_PATH for direct HTTPS, or terminate TLS at a reverse proxy)`);
  }

  const io = new SocketIOServer(server, {
    cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' },
  });
  attachSocket(io);

  server.listen(port, () => {
    logger.info(`Server listening on port ${port} [${process.env.NODE_ENV || 'development'}]`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message, stack: err.stack });
  process.exit(1);
});
