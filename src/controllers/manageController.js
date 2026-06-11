const { Feedback, Blacklist, OperationLog, Subscription, Driver, Favorite } = require('../models');
const { successResponse, errorResponse, paginate, formatFileSize, getBlacklistValuesMap } = require('../utils/helpers');
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
    const {
      gpuModel,
      osVersion,
      architecture,
      limit = 5,
      includeOldVersions = false,
      exactModel = false
    } = req.body;

    if (!gpuModel) {
      return errorResponse(res, '请提供显卡型号', 400);
    }

    const query = { status: 'published' };

    if (exactModel === true || exactModel === 'true') {
      query.gpuModel = { $regex: new RegExp(`^${gpuModel}$`, 'i') };
    } else {
      query.$or = [
        { gpuModel: new RegExp(gpuModel, 'i') },
        { name: new RegExp(gpuModel, 'i') }
      ];
    }

    if (osVersion) {
      query.osSupport = {
        $elemMatch: { $regex: new RegExp(osVersion, 'i') }
      };
    }

    const blacklistMap = await getBlacklistValuesMap(['file_md5', 'file_sha256', 'url']);
    const blacklistConditions = [];
    if (blacklistMap.file_md5.length > 0) {
      blacklistConditions.push({ 'checksum.md5': { $nin: blacklistMap.file_md5 } });
    }
    if (blacklistMap.file_sha256.length > 0) {
      blacklistConditions.push({ 'checksum.sha256': { $nin: blacklistMap.file_sha256 } });
    }
    if (blacklistMap.url.length > 0) {
      blacklistConditions.push({ downloadUrl: { $nin: blacklistMap.url } });
    }
    if (blacklistConditions.length > 0) {
      query.$and = (query.$and || []).concat(blacklistConditions);
    }

    const drivers = await Driver.find(query)
      .select('name gpuModel gpuBrand version versionCode releaseDate osSupport architecture fileSize description rating downloadCount isRecommended releaseNotes checksum')
      .sort([
        ['isRecommended', -1],
        ['versionCode', -1],
        ['releaseDate', -1],
        ['rating.average', -1],
        ['downloadCount', -1],
        ['_id', 1]
      ])
      .lean()
      .exec();

    const filteredDrivers = drivers.filter(d => {
      if (architecture && architecture !== 'all') {
        if (d.architecture !== 'all' && d.architecture !== architecture) {
          return false;
        }
      }
      return true;
    });

    let primaryDrivers = [];
    if (!includeOldVersions) {
      const seen = new Map();
      filteredDrivers.forEach(d => {
        const key = `${d.gpuModel.toLowerCase()}-${d.gpuBrand}`;
        if (!seen.has(key)) {
          seen.set(key, d);
          primaryDrivers.push(d);
        }
      });
    } else {
      primaryDrivers = filteredDrivers;
    }
    primaryDrivers = primaryDrivers.slice(0, limit);

    const buildRecommendationReason = (driver, index) => {
      const reasons = [];
      const tags = [];

      if (driver.isRecommended) {
        reasons.push('官方推荐版本，稳定性经过验证');
        tags.push('官方推荐');
      }
      if (index === 0) {
        reasons.push('当前最新版本，功能最完善');
        tags.push('最新版本');
      }
      if (driver.rating?.average >= 4.5 && driver.rating?.count >= 5) {
        reasons.push(`用户评分为 ${driver.rating.average} 分（${driver.rating.count} 人评价），口碑优秀`);
        tags.push('口碑优秀');
      }
      if (driver.downloadCount > 100000) {
        reasons.push(`下载量 ${(driver.downloadCount / 10000).toFixed(0)} 万次，用户基数大`);
        tags.push('下载量大');
      }
      if (driver.downloadCount > 10000 && driver.downloadCount <= 100000) {
        reasons.push(`下载量 ${(driver.downloadCount / 1000).toFixed(0)} 千次，广泛使用`);
        tags.push('广泛使用');
      }

      if (reasons.length === 0) {
        reasons.push('可用版本');
      }

      return {
        reasons,
        tags,
        level: index === 0 ? '强烈推荐' : index < 3 ? '推荐' : '可选'
      };
    };

    const recommendationList = primaryDrivers.map((d, idx) => {
      const reasonInfo = buildRecommendationReason(d, idx);
      return {
        rank: idx + 1,
        level: reasonInfo.level,
        driver: {
          id: d._id,
          name: d.name,
          gpuModel: d.gpuModel,
          gpuBrand: d.gpuBrand,
          version: d.version,
          releaseDate: d.releaseDate,
          osSupport: d.osSupport,
          architecture: d.architecture,
          fileSize: d.fileSize,
          fileSizeFormatted: formatFileSize(d.fileSize),
          rating: d.rating,
          downloadCount: d.downloadCount,
          isRecommended: d.isRecommended,
          releaseNotes: d.releaseNotes || [],
          checksum: {
            md5: d.checksum?.md5 || '',
            sha256: d.checksum?.sha256 || ''
          }
        },
        reasons: reasonInfo.reasons,
        tags: reasonInfo.tags,
        download: {
          tokenUrl: `/api/v1/drivers/${d._id}/download/token?source=customer_service`,
          tokenMethod: 'POST',
          hint: '调用生成下载令牌后即可获得真实下载地址'
        }
      };
    });

    const historyVersions = includeOldVersions ? [] : filteredDrivers
      .slice(limit, limit + 10)
      .map(d => ({
        id: d._id,
        name: d.name,
        version: d.version,
        releaseDate: d.releaseDate,
        fileSizeFormatted: formatFileSize(d.fileSize),
        downloadCount: d.downloadCount,
        rating: d.rating,
        isRecommended: d.isRecommended
      }));

    logOperation({
      user: req.user,
      action: 'generate_recommendation',
      details: { gpuModel, osVersion, architecture, count: recommendationList.length },
      req
    });

    const summary = {
      gpuModel,
      osVersion: osVersion || '全部系统',
      architecture: architecture || '全部架构',
      totalFound: drivers.length,
      recommendedCount: recommendationList.length,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user?.nickname || req.user?.username
    };

    const textSummary = `
显卡型号：${gpuModel}
系统版本：${osVersion || '全部系统'}
推荐数量：${recommendationList.length} 个版本
生成时间：${new Date().toLocaleString('zh-CN')}
`.trim();

    return successResponse(res, {
      summary,
      textSummary,
      recommendations: recommendationList,
      historyVersions,
      totalFound: drivers.length
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
