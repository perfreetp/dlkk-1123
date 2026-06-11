const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '需要用户认证' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, message: '权限不足' });
    }
    next();
  };
};

const requireAdmin = requireRole('admin');
const requireEditor = requireRole('admin', 'editor');
const requireCustomerService = requireRole('admin', 'customer_service', 'editor');

module.exports = {
  requireRole,
  requireAdmin,
  requireEditor,
  requireCustomerService
};
