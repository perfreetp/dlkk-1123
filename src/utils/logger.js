const { OperationLog } = require('../models');

const logOperation = async ({ user, action, targetType, targetId, details, req, result = 'success' }) => {
  try {
    const log = new OperationLog({
      userId: user?._id,
      action,
      targetType,
      targetId,
      details,
      ip: req?.ip || req?.connection?.remoteAddress,
      userAgent: req?.headers?.['user-agent'],
      result
    });
    await log.save();
  } catch (error) {
    console.error('Failed to create operation log:', error);
  }
};

const createOperationLogger = (action, getTargetInfo) => {
  return async (req, res, next) => {
    const originalSend = res.send;
    res.send = function (data) {
      res.send = originalSend;
      try {
        const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
        const result = res.statusCode < 400 ? 'success' : 'failed';
        let targetType = null;
        let targetId = null;
        let details = {};
        if (typeof getTargetInfo === 'function') {
          const info = getTargetInfo(req, parsedData) || {};
          targetType = info.targetType;
          targetId = info.targetId;
          details = info.details || {};
        }
        if (req.user && action) {
          logOperation({
            user: req.user,
            action,
            targetType,
            targetId,
            details,
            req,
            result
          });
        }
      } catch (err) {
        console.error('Operation logging error:', err);
      }
      return originalSend.call(this, data);
    };
    next();
  };
};

module.exports = { logOperation, createOperationLogger };
