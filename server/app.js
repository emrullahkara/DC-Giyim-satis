import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate, requireAuth, registerAuthRoutes } from './auth.js';
import { HttpError } from './util.js';
import products from './routes/products.js';
import sales from './routes/sales.js';
import parties from './routes/parties.js';
import business from './routes/business.js';
import finance from './routes/finance.js';
import reports from './routes/reports.js';
import settings from './routes/settings.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'self'");
    next();
  });

  app.use('/api', express.json({ limit: '2mb' }));
  // CSRF koruması: değişiklik yapan tüm API isteklerinde özel başlık zorunludur (başka sitelerden gönderilemez)
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-DC-Istek') !== '1') {
      return next(new HttpError(403, 'Geçersiz istek kaynağı'));
    }
    next();
  });
  app.use('/api', authenticate);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  registerAuthRoutes(app);
  app.use('/api', requireAuth, products, sales, parties, business, finance, reports, settings);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Bulunamadı')));

  app.use(express.static(PUBLIC, { index: 'index.html', maxAge: '1h' }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'İstek gövdesi okunamadı' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'İstek çok büyük' });
    let status = err instanceof HttpError ? err.status : 500;
    let msg = err.message;
    if (status === 500 && /UNIQUE constraint failed/.test(err.message)) {
      status = 400;
      msg = 'Bu kayıt zaten mevcut (tekrar eden değer)';
    } else if (status === 500) {
      console.error(`[HATA] ${req.method} ${req.originalUrl}`, err);
      msg = 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.';
    }
    res.status(status).json({ error: msg });
  });
  return app;
}
