const { Driver } = require('../models');
const { successResponse, errorResponse, compareVersions } = require('../utils/helpers');

const compareDrivers = async (req, res, next) => {
  try {
    const { driverIds } = req.body;
    if (!Array.isArray(driverIds) || driverIds.length < 2) {
      return errorResponse(res, '请提供至少2个驱动ID进行比较', 400);
    }
    if (driverIds.length > 5) {
      return errorResponse(res, '最多只能比较5个驱动', 400);
    }
    const drivers = await Driver.find({
      _id: { $in: driverIds },
      status: 'published'
    })
      .select('name gpuModel gpuBrand version releaseDate osSupport architecture fileSize description releaseNotes rating downloadCount')
      .lean()
      .exec();
    if (drivers.length !== driverIds.length) {
      return errorResponse(res, '部分驱动不存在或未发布', 404);
    }
    const sortedByVersion = [...drivers].sort((a, b) => compareVersions(b.version, a.version));
    const versionComparison = drivers.map((d, idx) => {
      if (idx === 0) return { id: d._id, version: d.version, status: '基准' };
      const cmp = compareVersions(d.version, drivers[0].version);
      let status = '相同';
      if (cmp > 0) status = '较新';
      else if (cmp < 0) status = '较旧';
      return { id: d._id, version: d.version, status };
    });
    const allOS = new Set();
    drivers.forEach(d => d.osSupport.forEach(os => allOS.add(os)));
    const osCompatibility = Array.from(allOS).map(os => ({
      os,
      supportedBy: drivers.map(d => ({
        id: d._id,
        name: d.name,
        supported: d.osSupport.includes(os)
      }))
    }));
    return successResponse(res, {
      drivers,
      sortedByVersion,
      versionComparison,
      osCompatibility,
      recommendations: {
        newestVersion: sortedByVersion[0],
        mostDownloads: [...drivers].sort((a, b) => b.downloadCount - a.downloadCount)[0],
        highestRating: [...drivers].sort((a, b) => b.rating.average - a.rating.average)[0]
      }
    });
  } catch (error) {
    next(error);
  }
};

const checkCompatibility = async (req, res, next) => {
  try {
    const { driverId, osVersion, architecture, gpuModel } = req.body;
    if (!driverId) {
      return errorResponse(res, '请提供驱动ID', 400);
    }
    const driver = await Driver.findById(driverId).select('name gpuModel gpuBrand version osSupport architecture status').lean();
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    const issues = [];
    const warnings = [];
    if (driver.status !== 'published') {
      issues.push('驱动未发布');
    }
    if (gpuModel) {
      const gpuMatch = driver.gpuModel.toLowerCase().includes(gpuModel.toLowerCase()) ||
        gpuModel.toLowerCase().includes(driver.gpuModel.toLowerCase());
      if (!gpuMatch) {
        issues.push(`显卡型号不匹配: 驱动支持 ${driver.gpuModel}, 当前显卡 ${gpuModel}`);
      }
    }
    if (osVersion) {
      const osMatch = driver.osSupport.some(os => os.toLowerCase().includes(osVersion.toLowerCase()));
      if (!osMatch) {
        issues.push(`系统版本不兼容: 驱动支持 ${driver.osSupport.join(', ')}, 当前系统 ${osVersion}`);
      }
    }
    if (architecture && architecture !== 'all') {
      if (driver.architecture !== 'all' && driver.architecture !== architecture) {
        issues.push(`架构不兼容: 驱动支持 ${driver.architecture}, 当前架构 ${architecture}`);
      }
    }
    const isCompatible = issues.length === 0;
    return successResponse(res, {
      driver: {
        id: driver._id,
        name: driver.name,
        gpuModel: driver.gpuModel,
        version: driver.version
      },
      isCompatible,
      issues,
      warnings,
      suggestion: isCompatible ? '可以安装此驱动' : '不建议安装，请检查兼容性问题'
    });
  } catch (error) {
    next(error);
  }
};

const batchCheckCompatibility = async (req, res, next) => {
  try {
    const { driverIds, osVersion, architecture, gpuModel } = req.body;
    if (!Array.isArray(driverIds)) {
      return errorResponse(res, '请提供驱动ID列表', 400);
    }
    const drivers = await Driver.find({ _id: { $in: driverIds } })
      .select('name gpuModel version osSupport architecture status')
      .lean()
      .exec();
    const results = drivers.map(driver => {
      const issues = [];
      if (driver.status !== 'published') issues.push('驱动未发布');
      if (gpuModel) {
        const gpuMatch = driver.gpuModel.toLowerCase().includes(gpuModel.toLowerCase()) ||
          gpuModel.toLowerCase().includes(driver.gpuModel.toLowerCase());
        if (!gpuMatch) issues.push('显卡型号不匹配');
      }
      if (osVersion) {
        const osMatch = driver.osSupport.some(os => os.toLowerCase().includes(osVersion.toLowerCase()));
        if (!osMatch) issues.push('系统版本不兼容');
      }
      if (architecture && architecture !== 'all') {
        if (driver.architecture !== 'all' && driver.architecture !== architecture) {
          issues.push('架构不兼容');
        }
      }
      return {
        id: driver._id,
        name: driver.name,
        version: driver.version,
        gpuModel: driver.gpuModel,
        isCompatible: issues.length === 0,
        issues
      };
    });
    return successResponse(res, {
      total: results.length,
      compatibleCount: results.filter(r => r.isCompatible).length,
      results
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  compareDrivers,
  checkCompatibility,
  batchCheckCompatibility
};
