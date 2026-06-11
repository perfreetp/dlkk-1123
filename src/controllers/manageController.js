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

    const sortedDrivers = require('../utils/helpers').sortDriversByVersion(filteredDrivers, 'desc');

    const normalize = (val, min, max) => {
      if (max === min) return 1;
      return Math.max(0, Math.min(1, (val - min) / (max - min)));
    };

    const downloads = sortedDrivers.map(d => d.downloadCount || 0);
    const ratings = sortedDrivers.map(d => d.rating?.average || 0);
    const minDL = Math.min(...downloads, 0);
    const maxDL = Math.max(...downloads, 1);
    const maxRating = Math.max(...ratings, 5);

    const buildRankingFactors = (driver, allDrivers) => {
      const factors = [];
      let totalScore = 0;

      const isNewest = allDrivers.length > 0 &&
        String(allDrivers[0]._id) === String(driver._id);

      factors.push({
        key: 'officialRecommended',
        name: '官方推荐',
        hit: !!driver.isRecommended,
        score: driver.isRecommended ? 30 : 0,
        weight: 30,
        description: driver.isRecommended ? '官方推荐版本，经过完整稳定性验证' : '非官方推荐版本'
      });
      totalScore += driver.isRecommended ? 30 : 0;

      factors.push({
        key: 'newestVersion',
        name: '最新版本',
        hit: isNewest,
        score: isNewest ? 25 : 0,
        weight: 25,
        description: isNewest ? '当前筛选条件下的最新版本，功能最完善' : `${driver.version}，比最新版本旧`
      });
      totalScore += isNewest ? 25 : 0;

      const ratingScore = Math.round(normalize(driver.rating?.average || 0, 0, maxRating || 5) * 20);
      const ratingHit = (driver.rating?.average || 0) >= 4.0 && (driver.rating?.count || 0) >= 3;
      factors.push({
        key: 'highRating',
        name: '用户评分高',
        hit: ratingHit,
        score: ratingScore,
        weight: 20,
        description: ratingHit
          ? `用户评分 ${driver.rating.average} 分（${driver.rating.count} 人评价），口碑优秀`
          : `用户评分 ${driver.rating?.average || 0} 分（${driver.rating?.count || 0} 人评价）`
      });
      totalScore += ratingScore;

      const dlScore = Math.round(normalize(driver.downloadCount || 0, minDL, maxDL) * 15);
      const dlHit = (driver.downloadCount || 0) >= 10000;
      factors.push({
        key: 'highDownload',
        name: '下载量高',
        hit: dlHit,
        score: dlScore,
        weight: 15,
        description: dlHit
          ? `下载量 ${driver.downloadCount} 次，用户基数大，验证充分`
          : `下载量 ${driver.downloadCount || 0} 次`
      });
      totalScore += dlScore;

      const osMatch = !osVersion || (driver.osSupport || []).some(os =>
        os.toLowerCase().includes(String(osVersion).toLowerCase())
      );
      factors.push({
        key: 'osMatched',
        name: '系统匹配',
        hit: osMatch,
        score: osMatch ? 10 : 0,
        weight: 10,
        description: osMatch
          ? `支持的系统：${(driver.osSupport || []).join('、')}，与查询的 ${osVersion || '全部系统'} 匹配`
          : `仅支持：${(driver.osSupport || []).join('、')}`
      });
      totalScore += osMatch ? 10 : 0;

      return {
        totalScore,
        maxScore: 100,
        factors
      };
    };

    const buildRecommendationReason = (ranking) => {
      const reasons = ranking.factors
        .filter(f => f.hit)
        .map(f => f.description);
      const tags = ranking.factors
        .filter(f => f.hit)
        .map(f => f.name);
      return { reasons, tags };
    };

    let primaryDrivers = [];
    if (!includeOldVersions) {
      const seen = new Map();
      sortedDrivers.forEach(d => {
        const key = `${d.gpuModel.toLowerCase()}-${d.gpuBrand}`;
        if (!seen.has(key)) {
          seen.set(key, d);
          primaryDrivers.push(d);
        }
      });
    } else {
      primaryDrivers = sortedDrivers;
    }
    primaryDrivers = primaryDrivers.slice(0, limit);

    const recommendationId = `rec_${Date.now()}_${require('crypto').randomBytes(4).toString('hex')}`;

    const recommendationList = primaryDrivers.map((d, idx) => {
      const ranking = buildRankingFactors(d, sortedDrivers);
      const reasonInfo = buildRecommendationReason(ranking);
      return {
        rank: idx + 1,
        level: idx === 0 ? '强烈推荐' : idx < 3 ? '推荐' : '可选',
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
        rankingFactors: ranking,
        download: {
          tokenUrl: `/api/v1/drivers/${d._id}/download/token?source=customer_service&recommendationId=${recommendationId}`,
          tokenMethod: 'POST',
          hint: '调用生成下载令牌后即可获得真实下载地址',
          recommendationId,
          driverId: d._id
        }
      };
    });

    const historyTimeline = sortedDrivers.map((d, idx) => {
      const ranking = buildRankingFactors(d, sortedDrivers);
      const inRecommendations = primaryDrivers.slice(0, limit).some(p => String(p._id) === String(d._id));
      return {
        timelineIndex: idx + 1,
        id: d._id,
        name: d.name,
        version: d.version,
        versionCode: d.versionCode,
        releaseDate: d.releaseDate,
        fileSizeFormatted: formatFileSize(d.fileSize),
        downloadCount: d.downloadCount,
        rating: d.rating,
        isRecommended: d.isRecommended,
        osSupport: d.osSupport,
        architecture: d.architecture,
        gpuModel: d.gpuModel,
        inRecommendationList: inRecommendations,
        recommendationRank: inRecommendations
          ? (primaryDrivers.slice(0, limit).findIndex(p => String(p._id) === String(d._id)) + 1)
          : null,
        topHitFactors: ranking.factors.filter(f => f.hit).map(f => f.name),
        rankingFactorsSummary: {
          totalScore: ranking.totalScore,
          maxScore: ranking.maxScore,
          hitFactorNames: ranking.factors.filter(f => f.hit).map(f => f.name)
        },
        download: {
          tokenUrl: `/api/v1/drivers/${d._id}/download/token?source=customer_service&recommendationId=${recommendationId}`,
          tokenMethod: 'POST'
        }
      };
    });

    const timelineGroups = [];
    let currentYear = null;
    let currentGroup = null;
    historyTimeline.forEach(item => {
      const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : '未知年份';
      if (year !== currentYear) {
        currentYear = year;
        currentGroup = { year, count: 0, items: [] };
        timelineGroups.push(currentGroup);
      }
      currentGroup.count += 1;
      currentGroup.items.push(item);
    });

    logOperation({
      user: req.user,
      action: 'generate_recommendation',
      details: {
        recommendationId,
        gpuModel,
        osVersion,
        architecture,
        count: recommendationList.length,
        historyCount: historyTimeline.length
      },
      req
    });

    const summary = {
      recommendationId,
      gpuModel,
      exactModel: !!exactModel,
      osVersion: osVersion || '全部系统',
      architecture: architecture || '全部架构',
      totalFound: sortedDrivers.length,
      recommendedCount: recommendationList.length,
      historyVersionCount: historyTimeline.length,
      generatedAt: new Date().toISOString(),
      generatedBy: req.user?.nickname || req.user?.username
    };

    const textSummaryLines = [
      `【显卡驱动推荐清单 #${recommendationId.slice(-8)}】`,
      `显卡型号：${gpuModel}${exactModel ? '（精确匹配）' : ''}`,
      `系统版本：${osVersion || '全部系统'}`,
      `筛选结果：共 ${sortedDrivers.length} 个可用版本，重点推荐 ${recommendationList.length} 个`,
      `生成时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '【推荐版本】'
    ];
    recommendationList.forEach(r => {
      textSummaryLines.push(`${r.rank}. ${r.driver.name} v${r.driver.version}`);
      textSummaryLines.push(`   标签：${r.tags.join(' / ')}`);
      textSummaryLines.push(`   理由：${r.reasons.slice(0, 2).join('；')}`);
      textSummaryLines.push(`   令牌入口：POST ${r.download.tokenUrl}`);
      textSummaryLines.push('');
    });
    if (historyTimeline.length > 0) {
      textSummaryLines.push(`【历史版本（${historyTimeline.length} 个）】`);
      historyTimeline.slice(0, 5).forEach(h => {
        textSummaryLines.push(`- v${h.version}（${new Date(h.releaseDate).toLocaleDateString('zh-CN')}）${h.isRecommended ? ' [官方推荐]' : ''}`);
      });
      if (historyTimeline.length > 5) {
        textSummaryLines.push(`... 还有 ${historyTimeline.length - 5} 个历史版本，详见 historyTimeline`);
      }
    }

    return successResponse(res, {
      summary,
      textSummary: textSummaryLines.join('\n'),
      recommendations: recommendationList,
      historyTimeline,
      timelineGroups,
      totalFound: sortedDrivers.length
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
