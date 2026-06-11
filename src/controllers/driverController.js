const { Driver, DownloadToken, Favorite } = require('../models');
const config = require('../config');
const { successResponse, errorResponse, generateDownloadToken, formatFileSize, checkBlacklist } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');

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
    let isFavorited = false;
    if (req.user) {
      isFavorited = await Favorite.exists({ userId: req.user._id, driverId: driver._id });
    }
    const relatedDrivers = await Driver.find({
      gpuModel: driver.gpuModel,
      status: 'published',
      _id: { $ne: driver._id }
    })
      .select('name version releaseDate downloadCount rating')
      .sort({ releaseDate: -1 })
      .limit(5)
      .lean()
      .exec();
    return successResponse(res, {
      ...driver,
      fileSizeFormatted: formatFileSize(driver.fileSize),
      isFavorited,
      relatedDrivers
    });
  } catch (error) {
    next(error);
  }
};

const getDriverVersions = async (req, res, next) => {
  try {
    const { gpuModel } = req.query;
    if (!gpuModel) {
      return errorResponse(res, '请提供显卡型号', 400);
    }
    const drivers = await Driver.find({
      gpuModel: new RegExp(gpuModel, 'i'),
      status: 'published'
    })
      .select('name version gpuModel osSupport releaseDate downloadCount rating isRecommended')
      .sort({ releaseDate: -1 })
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
    if (driver.checksum?.md5 && await checkBlacklist('file_md5', driver.checksum.md5)) {
      return errorResponse(res, '文件已被列入黑名单，禁止下载', 403);
    }
    if (await checkBlacklist('url', driver.downloadUrl)) {
      return errorResponse(res, '下载链接已被列入黑名单，禁止下载', 403);
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
    if (req.user) {
      logOperation({
        user: req.user,
        action: 'generate_download_token',
        targetType: 'driver',
        targetId: driver._id,
        details: { source, token },
        req
      });
    }
    return successResponse(res, {
      token,
      expiresAt,
      expiresIn: config.downloadTokenExpiresIn / 1000,
      driverInfo: {
        id: driver._id,
        name: driver.name,
        version: driver.version,
        fileSize: driver.fileSize,
        fileSizeFormatted: formatFileSize(driver.fileSize)
      }
    });
  } catch (error) {
    next(error);
  }
};

const redeemDownloadToken = async (req, res, next) => {
  try {
    const { token } = req.params;
    const downloadToken = await DownloadToken.findOne({ token })
      .populate('driverId');
    if (!downloadToken) {
      return errorResponse(res, '下载令牌无效', 404);
    }
    if (downloadToken.used) {
      return errorResponse(res, '下载令牌已使用', 410);
    }
    if (new Date() > downloadToken.expiresAt) {
      return errorResponse(res, '下载令牌已过期', 410);
    }
    const driver = downloadToken.driverId;
    if (!driver || driver.status !== 'published') {
      return errorResponse(res, '关联的驱动不存在或未发布', 404);
    }
    downloadToken.used = true;
    downloadToken.usedAt = new Date();
    await downloadToken.save();
    await Driver.findByIdAndUpdate(driver._id, {
      $inc: { downloadCount: 1 }
    });
    return successResponse(res, {
      downloadUrl: driver.downloadUrl,
      checksum: driver.checksum || {},
      fileName: driver.name,
      fileSize: driver.fileSize,
      version: driver.version
    });
  } catch (error) {
    next(error);
  }
};

const incrementDownloadCount = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { downloadCount: 1 }
    });
    return successResponse(res, null, '下载次数已更新');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDriverDetail,
  getDriverVersions,
  generateDownloadLink,
  redeemDownloadToken,
  incrementDownloadCount
};
