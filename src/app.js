const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const connectDB = require('./config/database');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();

connectDB();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: {
    code: 429,
    message: '请求过于频繁，请稍后再试'
  }
});
app.use('/api/', limiter);

app.use('/api/v1', routes);

app.get('/', (req, res) => {
  res.json({
    name: 'GPU Driver Service',
    version: '1.0.0',
    description: '显卡驱动网后端服务 - 统一驱动资料接口',
    endpoints: {
      health: '/api/v1/health',
      auth: '/api/v1/auth',
      search: '/api/v1/search',
      drivers: '/api/v1/drivers',
      compatibility: '/api/v1/compatibility',
      admin: '/api/v1/admin'
    }
  });
});

app.use(notFound);
app.use(errorHandler);

const PORT = config.port;
app.listen(PORT, () => {
  console.log(`GPU Driver Service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/v1/health`);
});

module.exports = app;
