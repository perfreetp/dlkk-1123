const { Driver, Feedback, Blacklist, OperationLog, Subscription } = require('../models');
const { successResponse, errorResponse, paginate, checkBlacklist } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');

const createDriver = async (req, res, next) => {
  try {
    const driverData = {
      ...req.body,
      createdBy: req.user._id,
      status: 'pending'
    };
    if (driverData.checksum?.md5 && await checkBlacklist('file_md5', driverData.checksum.md5)) {
      return errorResponse(res, '文件MD5已被列入黑名单，禁止发布', 403);
    }
    if (driverData.downloadUrl && await checkBlacklist('url', driverData.downloadUrl)) {
      return errorResponse(res, '下载链接已被列入黑名单，禁止发布', 403);
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
    if (driver.checksum?.md5 && await checkBlacklist('file_md5', driver.checksum.md5)) {
      return errorResponse(res, '文件MD5已被列入黑名单，禁止发布', 403);
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
    const query = { status: 'published' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    const topDrivers = await Driver.find(query)
      .select('name gpuModel gpuBrand version downloadCount rating')
      .sort({ downloadCount: -1 })
      .limit(20)
      .lean()
      .exec();
    const totalDownloads = await Driver.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$downloadCount' } } }
    ]);
    const brandStats = await Driver.aggregate([
      { $match: query },
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
    return successResponse(res, {
      overview: {
        totalDownloads: totalDownloads[0]?.total || 0,
        totalPending,
        totalPublished,
        totalOffline
      },
      topDrivers,
      brandStats
    });
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
  mergeDrivers,
  getDownloadStatistics
};
