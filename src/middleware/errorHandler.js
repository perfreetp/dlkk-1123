const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ code: 400, message: '数据验证失败', errors });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ code: 400, message: '无效的ID格式' });
  }
  if (err.code === 11000) {
    return res.status(409).json({ code: 409, message: '数据已存在' });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ code: 401, message: '无效的令牌' });
  }
  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    code: statusCode,
    message: err.message || '服务器内部错误',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

const notFound = (req, res, next) => {
  res.status(404).json({ code: 404, message: '接口不存在' });
};

module.exports = { errorHandler, notFound };
