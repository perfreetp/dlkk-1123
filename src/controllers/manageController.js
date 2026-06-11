const { Feedback, Blacklist, OperationLog, Subscription, Driver, Favorite } = require('../models');
const { successResponse, errorResponse, paginate } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');

const getFeedbacks = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, type, driverId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    if (driverId) query.driverId = driverId;
    const result = await paginate(Feedback, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: [
        { path: 'driverId', select: 'name version gpuModel' },
        { path: 'userId', select: 'username nickname' },
        { path: 'handler', select: 'username nickname' }
      ]
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const handleFeedback = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, handleRemark } = req.body;
    if (!status || !['processing', 'resolved', 'rejected'].includes(status)) {
      return errorResponse(res, '请提供有效的处理状态', 400);
    }
    const feedback = await Feedback.findById(id);
    if (!feedback) {
      return errorResponse(res, '反馈不存在', 404);
    }
    feedback.status = status;
    feedback.handler = req.user._id;
    feedback.handleRemark = handleRemark || '';
    feedback.handledAt = new Date();
    await feedback.save();
    logOperation({
      user: req.user,
      action: 'handle_feedback',
      targetType: 'feedback',
      targetId: id,
      details: { status, handleRemark },
      req
    });
    return successResponse(res, feedback, '反馈处理成功');
  } catch (error) {
    next(error);
  }
};

const addBlacklistItem = async (req, res, next) => {
  try {
    const { type, value, reason, expiresAt } = req.body;
    if (!type || !value || !reason) {
      return errorResponse(res, '请填写完整信息', 400);
    }
    if (!['file_md5', 'file_sha256', 'url', 'ip', 'user'].includes(type)) {
      return errorResponse(res, '无效的黑名单类型', 400);
    }
    const existing = await Blacklist.findOne({ type, value });
    if (existing) {
      return errorResponse(res, '该记录已在黑名单中', 409);
    }
    const item = new Blacklist({
      type,
      value,
      reason,
      createdBy: req.user._id,
      expiresAt: expiresAt ? new Date(expiresAt) : undefined
    });
    await item.save();
    logOperation({
      user: req.user,
      action: 'add_blacklist',
      targetType: 'blacklist',
      targetId: item._id,
      details: { type, value },
      req
    });
    return successResponse(res, item, '已添加到黑名单', 201);
  } catch (error) {
    next(error);
  }
};

const removeBlacklistItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const item = await Blacklist.findByIdAndDelete(id);
    if (!item) {
      return errorResponse(res, '黑名单记录不存在', 404);
    }
    logOperation({
      user: req.user,
      action: 'remove_blacklist',
      targetType: 'blacklist',
      targetId: id,
      details: { type: item.type, value: item.value },
      req
    });
    return successResponse(res, null, '已从黑名单移除');
  } catch (error) {
    next(error);
  }
};

const getBlacklist = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type, isActive } = req.query;
    const query = {};
    if (type) query.type = type;
    if (isActive !== undefined) query.isActive = isActive === 'true';
    const result = await paginate(Blacklist, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: { path: 'createdBy', select: 'username nickname' }
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const getOperationLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, userId, action, targetType, startDate, endDate } = req.query;
    const query = {};
    if (userId) query.userId = userId;
    if (action) query.action = action;
    if (targetType) query.targetType = targetType;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    const result = await paginate(OperationLog, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: { path: 'userId', select: 'username nickname role' }
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const getSubscriptions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, isActive } = req.query;
    const query = { userId: req.user._id };
    if (isActive !== undefined) query.isActive = isActive === 'true';
    const result = await paginate(Subscription, query, {
      page,
      limit,
      sort: { createdAt: -1 }
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const addSubscription = async (req, res, next) => {
  try {
    const { gpuModel, gpuBrand, osVersion, notifyMethod = 'email' } = req.body;
    if (!gpuModel) {
      return errorResponse(res, '请提供显卡型号', 400);
    }
    const existing = await Subscription.findOne({
      userId: req.user._id,
      gpuModel,
      osVersion: osVersion || null
    });
    if (existing) {
      existing.isActive = true;
      existing.notifyMethod = notifyMethod;
      await existing.save();
      return successResponse(res, existing, '订阅已更新');
    }
    const subscription = new Subscription({
      userId: req.user._id,
      gpuModel,
      gpuBrand,
      osVersion,
      notifyMethod
    });
    await subscription.save();
    logOperation({
      user: req.user,
      action: 'add_subscription',
      targetType: 'subscription',
      targetId: subscription._id,
      details: { gpuModel, osVersion },
      req
    });
    return successResponse(res, subscription, '订阅成功', 201);
  } catch (error) {
    next(error);
  }
};

const cancelSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const subscription = await Subscription.findOne({ _id: id, userId: req.user._id });
    if (!subscription) {
      return errorResponse(res, '订阅不存在', 404);
    }
    subscription.isActive = false;
    await subscription.save();
    return successResponse(res, null, '已取消订阅');
  } catch (error) {
    next(error);
  }
};

const generateRecommendationList = async (req, res, next) => {
  try {
    const { gpuModel, osVersion, architecture, limit = 10, includeOldVersions = false } = req.body;
    if (!gpuModel) {
      return errorResponse(res, '请提供显卡型号', 400);
    }
    const query = { status: 'published' };
    query.$or = [
      { gpuModel: new RegExp(gpuModel, 'i') },
      { name: new RegExp(gpuModel, 'i') }
    ];
    if (osVersion) {
      query.osSupport = {
        $elemMatch: { $regex: new RegExp(osVersion, 'i') }
      };
    }
    const drivers = await Driver.find(query)
      .select('name gpuModel gpuBrand version releaseDate osSupport architecture fileSize description rating downloadCount isRecommended releaseNotes checksum downloadUrl')
      .sort([
        ['isRecommended', -1],
        ['releaseDate', -1],
        ['rating.average', -1],
        ['downloadCount', -1]
      ])
      .lean()
      .exec();
    const versions = new Map();
    const filteredDrivers = drivers.filter(d => {
      if (architecture && architecture !== 'all') {
        if (d.architecture !== 'all' && d.architecture !== architecture) {
          return false;
        }
      }
      if (!includeOldVersions) {
        const key = `${d.gpuModel}-${d.osSupport.join(',')}`;
        if (versions.has(key)) return false;
        versions.set(key, true);
      }
      return true;
    }).slice(0, limit);
    const recommendationList = filteredDrivers.map((d, idx) => ({
      rank: idx + 1,
      driver: d,
      recommendationLevel: idx === 0 ? '强烈推荐' : idx < 3 ? '推荐' : '可选',
      reason: d.isRecommended ? '官方推荐版本' :
        idx === 0 ? '最新稳定版本' :
          d.rating.average >= 4.5 ? '用户评价优秀' :
            d.downloadCount > 10000 ? '下载量领先' : '备选方案'
    }));
    logOperation({
      user: req.user,
      action: 'generate_recommendation',
      details: { gpuModel, osVersion, architecture, count: recommendationList.length },
      req
    });
    return successResponse(res, {
      query: { gpuModel, osVersion, architecture },
      totalFound: drivers.length,
      recommended: recommendationList.length,
      recommendations: recommendationList
    });
  } catch (error) {
    next(error);
  }
};

const getAllSubscriptionsAdmin = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, gpuModel, isActive } = req.query;
    const query = {};
    if (gpuModel) query.gpuModel = new RegExp(gpuModel, 'i');
    if (isActive !== undefined) query.isActive = isActive === 'true';
    const result = await paginate(Subscription, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: { path: 'userId', select: 'username email nickname' }
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFeedbacks,
  handleFeedback,
  addBlacklistItem,
  removeBlacklistItem,
  getBlacklist,
  getOperationLogs,
  getSubscriptions,
  addSubscription,
  cancelSubscription,
  generateRecommendationList,
  getAllSubscriptionsAdmin
};
