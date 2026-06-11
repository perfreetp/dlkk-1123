const { Driver, Feedback, Blacklist, OperationLog, Subscription, DownloadSession } = require('../models');
const { successResponse, errorResponse, paginate, checkDriverBlacklist, generateVersionCode } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');

const createDriver = async (req, res, next) => {
  try {
    const driverData = {
      ...req.body,
      createdBy: req.user._id,
      status: 'pending'
    };

    const blacklistResult = await checkDriverBlacklist(driverData);
    if (blacklistResult.isBlocked) {
      return errorResponse(res, `提交失败，${blacklistResult.hitType === 'url' ? '下载链接' : '文件'}已被列入黑名单。原因：${blacklistResult.reason}`, 403);
    }

    const driver = new Driver(driverData);
    await driver.save();

    logOperation({
      user: req.user,
      action: 'create_driver',
      targetType: 'driver',
      targetId: driver._id,
      details: { name: driver.name, gpuModel: driver.gpuModel },
      req
    });

    return successResponse(res, driver, '驱动创建成功，等待审核', 201);
  } catch (error) {
    next(error);
  }
};

const updateDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.status;
    delete updateData.publishedBy;
    delete updateData.publishedAt;

    const driver = await Driver.findById(id);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }

    const mergedData = { ...driver.toObject(), ...updateData };
    const blacklistResult = await checkDriverBlacklist(mergedData);
    if (blacklistResult.isBlocked) {
      return errorResponse(res, `更新失败，${blacklistResult.hitType === 'url' ? '下载链接' : '文件'}已被列入黑名单。原因：${blacklistResult.reason}`, 403);
    }

    if (driver.status === 'published') {
      driver.status = 'pending';
    }
    Object.assign(driver, updateData);
    await driver.save();

    logOperation({
      user: req.user,
      action: 'update_driver',
      targetType: 'driver',
      targetId: id,
      details: updateData,
      req
    });

    return successResponse(res, driver, '驱动更新成功');
  } catch (error) {
    next(error);
  }
};

const deleteDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findByIdAndDelete(id);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    logOperation({
      user: req.user,
      action: 'delete_driver',
      targetType: 'driver',
      targetId: id,
      details: { name: driver.name },
      req
    });
    return successResponse(res, null, '驱动删除成功');
  } catch (error) {
    next(error);
  }
};

const publishDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { remark } = req.body;
    const driver = await Driver.findById(id);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }

    const blacklistResult = await checkDriverBlacklist(driver);
    if (blacklistResult.isBlocked) {
      return errorResponse(res, `发布失败，${blacklistResult.hitType === 'url' ? '下载链接' : '文件'}已被列入黑名单。原因：${blacklistResult.reason}`, 403);
    }

    driver.status = 'published';
    driver.publishedBy = req.user._id;
    driver.publishedAt = new Date();
    if (remark) {
      driver.auditRemarks.push({
        content: remark,
        auditor: req.user._id
      });
    }
    await driver.save();

    logOperation({
      user: req.user,
      action: 'publish_driver',
      targetType: 'driver',
      targetId: id,
      details: { name: driver.name, remark },
      req
    });

    return successResponse(res, driver, '驱动发布成功');
  } catch (error) {
    next(error);
  }
};

const offlineDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { remark } = req.body;
    const driver = await Driver.findById(id);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    driver.status = 'offline';
    if (remark) {
      driver.auditRemarks.push({
        content: remark,
        auditor: req.user._id
      });
    }
    await driver.save();

    logOperation({
      user: req.user,
      action: 'offline_driver',
      targetType: 'driver',
      targetId: id,
      details: { remark },
      req
    });

    return successResponse(res, driver, '驱动已下架');
  } catch (error) {
    next(error);
  }
};

const rejectDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { remark } = req.body;
    if (!remark) {
      return errorResponse(res, '请填写拒绝原因', 400);
    }
    const driver = await Driver.findById(id);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    driver.status = 'rejected';
    driver.auditRemarks.push({
      content: remark,
      auditor: req.user._id
    });
    await driver.save();

    logOperation({
      user: req.user,
      action: 'reject_driver',
      targetType: 'driver',
      targetId: id,
      details: { remark },
      req
    });

    return successResponse(res, driver, '驱动已拒绝');
  } catch (error) {
    next(error);
  }
};

const addAuditRemark = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    if (!content) {
      return errorResponse(res, '请填写备注内容', 400);
    }
    const driver = await Driver.findById(id);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    driver.auditRemarks.push({
      content,
      auditor: req.user._id
    });
    await driver.save();

    logOperation({
      user: req.user,
      action: 'add_audit_remark',
      targetType: 'driver',
      targetId: id,
      details: { content },
      req
    });

    return successResponse(res, { auditRemarks: driver.auditRemarks }, '备注添加成功');
  } catch (error) {
    next(error);
  }
};

const getPendingDrivers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, gpuBrand } = req.query;
    const query = { status: 'pending' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    const result = await paginate(Driver, query, {
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

const getAllDrivers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, gpuBrand, keyword } = req.query;
    const query = {};
    if (status) query.status = status;
    if (gpuBrand) query.gpuBrand = gpuBrand;
    if (keyword) {
      query.$or = [
        { name: new RegExp(keyword, 'i') },
        { gpuModel: new RegExp(keyword, 'i') }
      ];
    }
    const result = await paginate(Driver, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: [
        { path: 'createdBy', select: 'username nickname' },
        { path: 'publishedBy', select: 'username nickname' }
      ]
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const getDriverDetailAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const driver = await Driver.findById(id)
      .populate('createdBy', 'username nickname')
      .populate('publishedBy', 'username nickname')
      .lean()
      .exec();

    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }

    const recentFeedbacks = await Feedback.find({ driverId: id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('userId', 'username nickname')
      .populate('handler', 'username nickname')
      .lean()
      .exec();

    const ratingCount = driver.rating?.count || 0;
    const averageRating = driver.rating?.average || 0;
    const invalidLinkCount = driver.invalidLinkCount || 0;

    const blacklistResult = await checkDriverBlacklist(driver);

    return successResponse(res, {
      ...driver,
      stats: {
        ratingCount,
        averageRating,
        invalidLinkCount,
        feedbackCount: driver.feedbackCount || 0,
        downloadCount: driver.downloadCount || 0
      },
      isBlacklisted: blacklistResult.isBlocked,
      blacklistInfo: blacklistResult.isBlocked ? {
        hitType: blacklistResult.hitType,
        hitValue: blacklistResult.hitValue,
        reason: blacklistResult.reason
      } : null,
      recentFeedbacks
    });
  } catch (error) {
    next(error);
  }
};

const mergeDrivers = async (req, res, next) => {
  try {
    const { targetDriverId, sourceDriverIds, mergeStrategy = 'newest' } = req.body;
    if (!targetDriverId || !Array.isArray(sourceDriverIds) || sourceDriverIds.length === 0) {
      return errorResponse(res, '请提供目标驱动ID和源驱动ID列表', 400);
    }
    const targetDriver = await Driver.findById(targetDriverId);
    if (!targetDriver) {
      return errorResponse(res, '目标驱动不存在', 404);
    }
    const sourceDrivers = await Driver.find({ _id: { $in: sourceDriverIds } });
    if (sourceDrivers.length !== sourceDriverIds.length) {
      return errorResponse(res, '部分源驱动不存在', 404);
    }
    const mergedDownloadCount = sourceDrivers.reduce((sum, d) => sum + d.downloadCount, 0) + targetDriver.downloadCount;
    targetDriver.downloadCount = mergedDownloadCount;
    targetDriver.mergedFrom = [...(targetDriver.mergedFrom || []), ...sourceDriverIds];
    if (!targetDriver.auditRemarks) targetDriver.auditRemarks = [];
    targetDriver.auditRemarks.push({
      content: `合并了 ${sourceDrivers.length} 个驱动: ${sourceDrivers.map(d => d.name).join(', ')}`,
      auditor: req.user._id
    });
    await targetDriver.save();

    await Driver.updateMany(
      { _id: { $in: sourceDriverIds } },
      {
        $set: {
          status: 'merged',
          parentDriver: targetDriverId
        }
      }
    );

    logOperation({
      user: req.user,
      action: 'merge_drivers',
      targetType: 'driver',
      targetId: targetDriverId,
      details: { sourceDriverIds, mergeStrategy },
      req
    });

    return successResponse(res, {
      targetDriver: targetDriver._id,
      mergedCount: sourceDrivers.length,
      totalDownloads: mergedDownloadCount
    }, '驱动合并成功');
  } catch (error) {
    next(error);
  }
};

const getDownloadStatistics = async (req, res, next) => {
  try {
    const { startDate, endDate, gpuBrand, groupBy = 'day' } = req.query;

    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const sessionQuery = { status: 'redeemed' };
    if (startDate || endDate) {
      sessionQuery.redeemedAt = {};
      if (startDate) sessionQuery.redeemedAt.$gte = new Date(startDate);
      if (endDate) sessionQuery.redeemedAt.$lte = new Date(endDate);
    }

    const sourceStats = await DownloadSession.aggregate([
      { $match: sessionQuery },
      {
        $group: {
          _id: '$source',
          count: { $sum: 1 },
          uniqueDrivers: { $addToSet: '$driverId' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const sourceStatsFormatted = sourceStats.map(s => ({
      source: s._id,
      downloadCount: s.count,
      uniqueDriverCount: s.uniqueDrivers.length
    }));

    let trendData = [];
    if (startDate && endDate) {
      const dateFormat = groupBy === 'hour'
        ? { $dateToString: { format: '%Y-%m-%d %H:00', date: '$redeemedAt' } }
        : { $dateToString: { format: '%Y-%m-%d', date: '$redeemedAt' } };

      trendData = await DownloadSession.aggregate([
        { $match: sessionQuery },
        {
          $group: {
            _id: dateFormat,
            total: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      trendData = trendData.map(t => ({ date: t._id, count: t.total }));
    }

    const statusStats = await DownloadSession.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const blacklistHitCount = await DownloadSession.countDocuments({
      ...query,
      blacklistHit: true
    });

    const driverQuery = { status: 'published' };
    if (gpuBrand) driverQuery.gpuBrand = gpuBrand;

    const topDrivers = await Driver.find(driverQuery)
      .select('name gpuModel gpuBrand version downloadCount rating')
      .sort({ downloadCount: -1 })
      .limit(20)
      .lean()
      .exec();

    const totalDownloads = await Driver.aggregate([
      { $match: driverQuery },
      { $group: { _id: null, total: { $sum: '$downloadCount' } } }
    ]);

    const brandStats = await Driver.aggregate([
      { $match: driverQuery },
      {
        $group: {
          _id: '$gpuBrand',
          totalDownloads: { $sum: '$downloadCount' },
          driverCount: { $sum: 1 },
          avgRating: { $avg: '$rating.average' }
        }
      },
      { $sort: { totalDownloads: -1 } }
    ]);

    const totalPending = await Driver.countDocuments({ status: 'pending' });
    const totalPublished = await Driver.countDocuments({ status: 'published' });
    const totalOffline = await Driver.countDocuments({ status: 'offline' });
    const totalMerged = await Driver.countDocuments({ status: 'merged' });

    const totalSessions = await DownloadSession.countDocuments(query);
    const totalRedeemed = await DownloadSession.countDocuments(sessionQuery);

    return successResponse(res, {
      overview: {
        totalDownloads: totalDownloads[0]?.total || 0,
        totalPending,
        totalPublished,
        totalOffline,
        totalMerged,
        totalSessions,
        totalRedeemed,
        blacklistHitCount
      },
      topDrivers,
      brandStats,
      sourceStats: sourceStatsFormatted,
      statusStats: statusStats.map(s => ({ status: s._id, count: s.count })),
      trendData
    });
  } catch (error) {
    next(error);
  }
};

const migrateVersionCodes = async (req, res, next) => {
  try {
    const { dryRun = true } = req.query;
    const isDryRun = dryRun !== 'false' && dryRun !== false;

    const allDrivers = await Driver.find({}).select('_id version versionCode').lean();
    const needUpdate = [];

    for (const d of allDrivers) {
      const expected = generateVersionCode(d.version);
      if (!d.versionCode || d.versionCode !== expected) {
        needUpdate.push({
          _id: d._id,
          version: d.version,
          oldVersionCode: d.versionCode || null,
          newVersionCode: expected
        });
      }
    }

    let updatedCount = 0;
    if (!isDryRun && needUpdate.length > 0) {
      const bulkOps = needUpdate.map(item => ({
        updateOne: {
          filter: { _id: item._id },
          update: { $set: { versionCode: item.newVersionCode } }
        }
      }));
      const result = await Driver.bulkWrite(bulkOps);
      updatedCount = result.modifiedCount || 0;
    }

    logOperation({
      user: req.user,
      action: 'migrate_version_codes',
      details: {
        dryRun: isDryRun,
        total: allDrivers.length,
        needUpdate: needUpdate.length,
        updatedCount
      },
      req
    });

    return successResponse(res, {
      totalDrivers: allDrivers.length,
      needUpdateCount: needUpdate.length,
      dryRun: isDryRun,
      updatedCount,
      sampleUpdates: needUpdate.slice(0, 20)
    }, isDryRun ? '预检完成，未实际修改数据（传 dryRun=false 执行迁移）' : `迁移完成，已更新 ${updatedCount} 条数据`);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDriver,
  updateDriver,
  deleteDriver,
  publishDriver,
  offlineDriver,
  rejectDriver,
  addAuditRemark,
  getPendingDrivers,
  getAllDrivers,
  getDriverDetailAdmin,
  mergeDrivers,
  getDownloadStatistics,
  migrateVersionCodes
};
