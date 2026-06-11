const { Driver, DownloadToken, Favorite, DownloadSession, Feedback } = require('../models');
const config = require('../config');
const { successResponse, errorResponse, generateDownloadToken, formatFileSize, checkDriverBlacklist, getBlacklistValuesMap, paginate } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const getDriverDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id)
      .populate('publishedBy', 'username nickname')
      .lean()
      .exec();
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    if (driver.status !== 'published' && !req.user) {
      return errorResponse(res, '驱动不存在或未发布', 404);
    }
    if (driver.status !== 'published' && req.user && !['admin', 'editor'].includes(req.user.role)) {
      return errorResponse(res, '驱动不存在或未发布', 404);
    }

    const blacklistResult = await checkDriverBlacklist(driver);
    const isBlacklisted = blacklistResult.isBlocked;

    let isFavorited = false;
    if (req.user) {
      isFavorited = await Favorite.exists({ userId: req.user._id, driverId: driver._id });
    }

    const relatedDriversQuery = {
      gpuModel: driver.gpuModel,
      status: 'published',
      _id: { $ne: driver._id }
    };
    const blacklistMap = await getBlacklistValuesMap(['file_md5', 'file_sha256', 'url']);
    if (blacklistMap.file_md5.length > 0) relatedDriversQuery['checksum.md5'] = { $nin: blacklistMap.file_md5 };
    if (blacklistMap.file_sha256.length > 0) relatedDriversQuery['checksum.sha256'] = { $nin: blacklistMap.file_sha256 };
    if (blacklistMap.url.length > 0) relatedDriversQuery.downloadUrl = { $nin: blacklistMap.url };

    const relatedDrivers = await Driver.find(relatedDriversQuery)
      .select('name version versionCode releaseDate downloadCount rating isRecommended')
      .sort({ versionCode: -1, releaseDate: -1, _id: 1 })
      .limit(5)
      .lean()
      .exec();

    const recentFeedbacks = await Feedback.find({
      driverId: driver._id,
      type: { $ne: 'rating' }
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('userId', 'username nickname')
      .lean()
      .exec();

    const result = {
      ...driver,
      fileSizeFormatted: formatFileSize(driver.fileSize),
      isFavorited,
      relatedDrivers,
      isBlacklisted,
      blacklistInfo: isBlacklisted ? {
        hitType: blacklistResult.hitType,
        hitValue: blacklistResult.hitValue,
        reason: blacklistResult.reason
      } : null,
      stats: {
        ratingCount: driver.rating?.count || 0,
        averageRating: driver.rating?.average || 0,
        invalidLinkCount: driver.invalidLinkCount || 0,
        feedbackCount: driver.feedbackCount || 0,
        downloadCount: driver.downloadCount || 0
      },
      recentFeedbacks
    };

    if (isBlacklisted && !['admin', 'editor'].includes(req.user?.role)) {
      delete result.downloadUrl;
      delete result.checksum;
      result.downloadUnavailable = true;
      result.downloadUnavailableReason = blacklistResult.reason || '文件已被列入黑名单，无法下载';
    }

    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const getDriverVersions = async (req, res, next) => {
  try {
    const { gpuModel, osVersion, architecture } = req.query;
    if (!gpuModel) {
      return errorResponse(res, '请提供显卡型号', 400);
    }
    const query = {
      gpuModel: new RegExp(gpuModel, 'i'),
      status: 'published'
    };
    if (osVersion) {
      query.osSupport = { $elemMatch: { $regex: new RegExp(osVersion, 'i') } };
    }
    if (architecture && architecture !== 'all') {
      query.$and = (query.$and || []).concat([
        {
          $or: [
            { architecture: architecture },
            { architecture: 'all' }
          ]
        }
      ]);
    }

    const blacklistMap = await getBlacklistValuesMap(['file_md5', 'file_sha256', 'url']);
    if (blacklistMap.file_md5.length > 0) query['checksum.md5'] = { $nin: blacklistMap.file_md5 };
    if (blacklistMap.file_sha256.length > 0) query['checksum.sha256'] = { $nin: blacklistMap.file_sha256 };
    if (blacklistMap.url.length > 0) query.downloadUrl = { $nin: blacklistMap.url };

    const drivers = await Driver.find(query)
      .select('name version versionCode gpuModel gpuBrand osSupport architecture releaseDate downloadCount rating isRecommended')
      .sort({ versionCode: -1, releaseDate: -1, _id: 1 })
      .lean()
      .exec();
    return successResponse(res, drivers);
  } catch (error) {
    next(error);
  }
};

const generateDownloadLink = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { source = 'api', recommendationId } = req.query;

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    if (driver.status !== 'published') {
      return errorResponse(res, '驱动未发布，无法下载', 403);
    }

    const blacklistResult = await checkDriverBlacklist(driver);
    const sessionId = uuidv4();

    const createFailedSession = async (failureReason, blacklistHit = false, blacklistType = 'none') => {
      await DownloadSession.create({
        sessionId,
        token: null,
        driverId: driver._id,
        userId: req.user?._id,
        source,
        status: 'failed',
        failureReason,
        blacklistHit,
        blacklistType,
        clientIp: req.ip,
        userAgent: req.headers['user-agent'],
        recommendationId: recommendationId || null,
        fileInfo: {
          fileName: driver.name,
          fileSize: driver.fileSize,
          md5: driver.checksum?.md5,
          sha256: driver.checksum?.sha256,
          version: driver.version
        },
        generatedAt: new Date(),
        expiresAt: null
      });
    };

    if (blacklistResult.isBlocked) {
      await createFailedSession(
        blacklistResult.reason || '文件已被列入黑名单，禁止下载',
        true,
        blacklistResult.hitType
      );
      if (req.user) {
        logOperation({
          user: req.user,
          action: 'generate_download_token_blocked',
          targetType: 'driver',
          targetId: driver._id,
          details: { source, blacklistType: blacklistResult.hitType, reason: blacklistResult.reason, recommendationId },
          req
        });
      }
      return errorResponse(res, `文件已被列入黑名单，禁止下载。原因：${blacklistResult.reason}`, 403);
    }

    const token = generateDownloadToken();
    const expiresAt = new Date(Date.now() + config.downloadTokenExpiresIn);

    const downloadToken = new DownloadToken({
      token,
      driverId: driver._id,
      userId: req.user?._id,
      expiresAt,
      clientIp: req.ip,
      source
    });
    await downloadToken.save();

    await DownloadSession.create({
      sessionId,
      token,
      driverId: driver._id,
      userId: req.user?._id,
      source,
      status: 'generated',
      blacklistHit: false,
      blacklistType: 'none',
      clientIp: req.ip,
      userAgent: req.headers['user-agent'],
      recommendationId: recommendationId || null,
      fileInfo: {
        fileName: driver.name,
        fileSize: driver.fileSize,
        md5: driver.checksum?.md5,
        sha256: driver.checksum?.sha256,
        version: driver.version
      },
      generatedAt: new Date(),
      expiresAt
    });

    if (req.user) {
      logOperation({
        user: req.user,
        action: 'generate_download_token',
        targetType: 'driver',
        targetId: driver._id,
        details: { source, token, sessionId, recommendationId },
        req
      });
    }

    return successResponse(res, {
      token,
      sessionId,
      recommendationId: recommendationId || null,
      expiresAt,
      expiresIn: config.downloadTokenExpiresIn / 1000,
      driverInfo: {
        id: driver._id,
        name: driver.name,
        version: driver.version,
        gpuModel: driver.gpuModel,
        fileSize: driver.fileSize,
        fileSizeFormatted: formatFileSize(driver.fileSize),
        md5: driver.checksum?.md5,
        sha256: driver.checksum?.sha256
      }
    });
  } catch (error) {
    next(error);
  }
};

const redeemDownloadToken = async (req, res, next) => {
  let sessionRecord = null;
  try {
    const { token } = req.params;
    const downloadToken = await DownloadToken.findOne({ token })
      .populate('driverId');

    sessionRecord = await DownloadSession.findOne({ token });

    const failWithSession = async (failureReason, statusCode = 400, { setBlacklist = false, blacklistType = 'none' } = {}) => {
      if (sessionRecord) {
        sessionRecord.status = 'failed';
        sessionRecord.failureReason = failureReason;
        sessionRecord.redeemedAt = new Date();
        if (setBlacklist) {
          sessionRecord.blacklistHit = true;
          sessionRecord.blacklistType = blacklistType || 'none';
        }
        await sessionRecord.save();
      }
      return errorResponse(res, failureReason, statusCode);
    };

    if (!downloadToken) {
      await failWithSession('下载令牌无效', 404);
      return;
    }

    if (!sessionRecord) {
      sessionRecord = new DownloadSession({
        sessionId: uuidv4(),
        token,
        driverId: downloadToken.driverId?._id,
        userId: downloadToken.userId,
        source: downloadToken.source || 'api',
        status: 'failed',
        clientIp: req.ip,
        userAgent: req.headers['user-agent'],
        generatedAt: downloadToken.createdAt,
        expiresAt: downloadToken.expiresAt
      });
    } else {
      sessionRecord.clientIp = req.ip;
      sessionRecord.userAgent = req.headers['user-agent'];
    }

    if (downloadToken.used) {
      await failWithSession('下载令牌已使用', 410);
      return;
    }
    if (new Date() > downloadToken.expiresAt) {
      sessionRecord.status = 'expired';
      sessionRecord.failureReason = '下载令牌已过期';
      sessionRecord.redeemedAt = new Date();
      await sessionRecord.save();
      return errorResponse(res, '下载令牌已过期', 410);
    }

    const driver = downloadToken.driverId;
    if (!driver || driver.status !== 'published') {
      await failWithSession('关联的驱动不存在或未发布', 404);
      return;
    }

    const blacklistResult = await checkDriverBlacklist(driver);
    if (blacklistResult.isBlocked) {
      await failWithSession(`文件已被列入黑名单[${blacklistResult.hitType}]：${blacklistResult.reason}`, 403, {
        setBlacklist: true,
        blacklistType: blacklistResult.hitType
      });
      return;
    }

    downloadToken.used = true;
    downloadToken.usedAt = new Date();
    await downloadToken.save();

    sessionRecord.status = 'redeemed';
    sessionRecord.redeemedAt = new Date();
    sessionRecord.blacklistHit = false;
    sessionRecord.blacklistType = 'none';
    await sessionRecord.save();

    await Driver.findByIdAndUpdate(driver._id, {
      $inc: { downloadCount: 1 }
    });

    return successResponse(res, {
      downloadUrl: driver.downloadUrl,
      checksum: driver.checksum || {},
      fileName: driver.name,
      fileSize: driver.fileSize,
      fileSizeFormatted: formatFileSize(driver.fileSize),
      version: driver.version,
      gpuModel: driver.gpuModel
    });
  } catch (error) {
    if (sessionRecord) {
      try {
        sessionRecord.status = 'failed';
        sessionRecord.failureReason = `系统错误：${error.message}`;
        await sessionRecord.save();
      } catch (e) { /* ignore */ }
    }
    next(error);
  }
};

const incrementDownloadCount = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    const blacklistResult = await checkDriverBlacklist(driver);
    if (blacklistResult.isBlocked) {
      return errorResponse(res, '文件已被列入黑名单', 403);
    }
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { downloadCount: 1 }
    });
    return successResponse(res, null, '下载次数已更新');
  } catch (error) {
    next(error);
  }
};

const getDownloadSessions = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, source, status, startDate, endDate, driverId, recommendationId, userId } = req.query;
    const query = {};
    if (source) query.source = source;
    if (status) query.status = status;
    if (driverId) query.driverId = driverId;
    if (recommendationId) query.recommendationId = recommendationId;
    if (userId) query.userId = userId;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }
    const result = await paginate(DownloadSession, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: [
        { path: 'driverId', select: 'name version gpuModel' },
        { path: 'userId', select: 'username nickname' }
      ]
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const STATUS_LABELS = {
  generated: '令牌已生成',
  redeemed: '兑换成功',
  failed: '兑换失败',
  expired: '令牌已过期'
};

const BLACKLIST_TYPE_LABELS = {
  file_md5: 'MD5 命中黑名单',
  file_sha256: 'SHA256 命中黑名单',
  url: '下载链接命中黑名单',
  none: '未命中黑名单'
};

const getDownloadSessionDetail = async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const session = await DownloadSession.findOne({ sessionId })
      .populate('driverId', 'name version gpuModel gpuBrand status downloadUrl fileSize osSupport architecture releaseDate')
      .populate('userId', 'username nickname role')
      .lean()
      .exec();
    if (!session) {
      return errorResponse(res, '下载会话不存在', 404);
    }

    const relatedSessions = session.recommendationId
      ? await DownloadSession.find({ recommendationId: session.recommendationId })
          .sort({ createdAt: 1 })
          .populate('driverId', 'name version gpuModel gpuBrand fileSize')
          .lean()
          .exec()
      : [];

    const recommendationChainSummary = session.recommendationId
      ? (() => {
          const summary = {
            recommendationId: session.recommendationId,
            totalSessions: relatedSessions.length,
            statusCounts: { generated: 0, redeemed: 0, failed: 0, expired: 0 },
            blacklistHitCount: 0,
            failureReasons: [],
            driverVersions: [],
            sources: [],
            timeframe: { firstAt: null, lastAt: null }
          };
          const reasonMap = new Map();
          const driverMap = new Map();
          const sourceSet = new Set();
          relatedSessions.forEach(s => {
            summary.statusCounts[s.status] = (summary.statusCounts[s.status] || 0) + 1;
            if (s.blacklistHit) summary.blacklistHitCount += 1;
            if (s.failureReason) {
              reasonMap.set(s.failureReason, (reasonMap.get(s.failureReason) || 0) + 1);
            }
            if (s.driverId) {
              const key = `${s.driverId._id || s.driverId}`;
              if (!driverMap.has(key)) {
                driverMap.set(key, {
                  driverId: s.driverId._id || s.driverId,
                  name: s.driverId.name || '',
                  version: s.driverId.version || '',
                  gpuModel: s.driverId.gpuModel || '',
                  sessionCount: 0,
                  redeemedCount: 0
                });
              }
              const d = driverMap.get(key);
              d.sessionCount += 1;
              if (s.status === 'redeemed') d.redeemedCount += 1;
            }
            if (s.source) sourceSet.add(s.source);
            const t = s.generatedAt || s.createdAt;
            if (t) {
              if (!summary.timeframe.firstAt || t < summary.timeframe.firstAt) summary.timeframe.firstAt = t;
              if (!summary.timeframe.lastAt || t > summary.timeframe.lastAt) summary.timeframe.lastAt = t;
            }
          });
          summary.failureReasons = Array.from(reasonMap.entries()).map(([reason, count]) => ({ reason, count }));
          summary.driverVersions = Array.from(driverMap.values());
          summary.sources = Array.from(sourceSet);
          return summary;
        })()
      : null;

    const eventTimeline = [
      {
        event: 'generated',
        name: '令牌生成',
        time: session.generatedAt,
        status: session.status === 'generated' ? 'pending' : 'done',
        info: {
          source: session.source,
          clientIp: session.clientIp,
          userAgent: session.userAgent,
          recommendationId: session.recommendationId || null
        }
      }
    ];
    if (session.redeemedAt) {
      eventTimeline.push({
        event: 'redeemed',
        name: '令牌兑换',
        time: session.redeemedAt,
        status: session.status === 'redeemed'
          ? 'success'
          : (session.status === 'failed' ? 'failed' : (session.status === 'expired' ? 'expired' : 'pending')),
        info: {
          failureReason: session.failureReason || null,
          blacklistHit: !!session.blacklistHit,
          blacklistType: session.blacklistType || 'none',
          blacklistTypeLabel: BLACKLIST_TYPE_LABELS[session.blacklistType] || session.blacklistType
        }
      });
    } else if (session.status === 'failed') {
      eventTimeline.push({
        event: 'failed',
        name: '兑换失败',
        time: session.updatedAt || session.createdAt,
        status: 'failed',
        info: {
          failureReason: session.failureReason || null,
          blacklistHit: !!session.blacklistHit,
          blacklistType: session.blacklistType || 'none'
        }
      });
    }
    if (session.status === 'expired') {
      eventTimeline.push({
        event: 'expired',
        name: '令牌过期',
        time: session.expiresAt,
        status: 'failed',
        info: {}
      });
    }

    const sessionWithLabels = {
      ...session,
      statusLabel: STATUS_LABELS[session.status] || session.status,
      blacklistTypeLabel: BLACKLIST_TYPE_LABELS[session.blacklistType] || session.blacklistType,
      fileInfoWithLabels: session.fileInfo ? {
        ...session.fileInfo,
        fileSizeFormatted: session.fileInfo.fileSize ? formatFileSize(session.fileInfo.fileSize) : null
      } : null
    };

    const relatedWithLabels = relatedSessions.map(s => ({
      sessionId: s.sessionId,
      status: s.status,
      statusLabel: STATUS_LABELS[s.status] || s.status,
      source: s.source,
      recommendationId: s.recommendationId,
      generatedAt: s.generatedAt,
      redeemedAt: s.redeemedAt,
      failureReason: s.failureReason,
      blacklistHit: !!s.blacklistHit,
      blacklistType: s.blacklistType,
      blacklistTypeLabel: BLACKLIST_TYPE_LABELS[s.blacklistType] || s.blacklistType,
      driverId: s.driverId?._id || s.driverId,
      driverName: s.driverId?.name,
      driverVersion: s.driverId?.version,
      driverGpuModel: s.driverId?.gpuModel
    }));

    return successResponse(res, {
      session: sessionWithLabels,
      eventTimeline,
      recommendationChainSummary,
      relatedSessions: relatedWithLabels
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDriverDetail,
  getDriverVersions,
  generateDownloadLink,
  redeemDownloadToken,
  incrementDownloadCount,
  getDownloadSessions,
  getDownloadSessionDetail
};
