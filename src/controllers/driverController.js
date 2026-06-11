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
    const { source = 'api' } = req.query;

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
          details: { source, blacklistType: blacklistResult.hitType, reason: blacklistResult.reason },
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
        details: { source, token, sessionId },
        req
      });
    }

    return successResponse(res, {
      token,
      sessionId,
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

    const failWithSession = async (failureReason, statusCode = 400) => {
      if (sessionRecord) {
        sessionRecord.status = 'failed';
        sessionRecord.failureReason = failureReason;
        sessionRecord.redeemedAt = new Date();
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
      sessionRecord.blacklistHit = true;
      sessionRecord.blacklistType = blacklistResult.hitType;
      await failWithSession(`文件已被列入黑名单：${blacklistResult.reason}`, 403);
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
    const { page = 1, limit = 20, source, status, startDate, endDate, driverId } = req.query;
    const query = {};
    if (source) query.source = source;
    if (status) query.status = status;
    if (driverId) query.driverId = driverId;
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

module.exports = {
  getDriverDetail,
  getDriverVersions,
  generateDownloadLink,
  redeemDownloadToken,
  incrementDownloadCount,
  getDownloadSessions
};
