const { Driver } = require('../models');
const { successResponse, errorResponse, compareVersions, formatFileSize } = require('../utils/helpers');

const searchDrivers = async (req, res, next) => {
  try {
    const {
      keyword,
      gpuBrand,
      osVersion,
      architecture,
      sortBy = 'version',
      sortOrder = 'desc',
      page = 1,
      limit = 20
    } = req.query;
    const query = { status: 'published' };
    if (keyword) {
      const regex = new RegExp(keyword, 'i');
      query.$or = [
        { name: regex },
        { gpuModel: regex },
        { description: regex },
        { tags: { $in: [regex] } }
      ];
    }
    if (gpuBrand) {
      query.gpuBrand = gpuBrand;
    }
    if (osVersion) {
      query.osSupport = osVersion;
    }
    if (architecture && architecture !== 'all') {
      query.$or = [
        { architecture: architecture },
        { architecture: 'all' }
      ];
    }
    let sortOption = {};
    if (sortBy === 'version') {
      sortOption.releaseDate = sortOrder === 'desc' ? -1 : 1;
    } else if (sortBy === 'downloads') {
      sortOption.downloadCount = sortOrder === 'desc' ? -1 : 1;
    } else if (sortBy === 'rating') {
      sortOption['rating.average'] = sortOrder === 'desc' ? -1 : 1;
    } else if (sortBy === 'date') {
      sortOption.createdAt = sortOrder === 'desc' ? -1 : 1;
    }
    const skip = (page - 1) * limit;
    const [total, drivers] = await Promise.all([
      Driver.countDocuments(query),
      Driver.find(query)
        .select('-downloadUrl -checksum -auditRemarks -createdBy -mergedFrom')
        .sort(sortOption)
        .skip(skip)
        .limit(parseInt(limit))
        .lean()
        .exec()
    ]);
    const formattedDrivers = drivers.map(d => ({
      ...d,
      fileSizeFormatted: formatFileSize(d.fileSize)
    }));
    if (sortBy === 'version') {
      formattedDrivers.sort((a, b) => {
        const cmp = compareVersions(a.version, b.version);
        return sortOrder === 'desc' ? -cmp : cmp;
      });
    }
    return successResponse(res, {
      items: formattedDrivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getHotDrivers = async (req, res, next) => {
  try {
    const { limit = 10, gpuBrand } = req.query;
    const query = { status: 'published' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    const drivers = await Driver.find(query)
      .select('-downloadUrl -checksum -auditRemarks -createdBy -mergedFrom')
      .sort([
        ['isHot', -1],
        ['downloadCount', -1],
        ['rating.average', -1]
      ])
      .limit(parseInt(limit))
      .lean()
      .exec();
    const formatted = drivers.map((d, idx) => ({
      ...d,
      rank: idx + 1,
      fileSizeFormatted: formatFileSize(d.fileSize)
    }));
    return successResponse(res, formatted);
  } catch (error) {
    next(error);
  }
};

const getGpuBrands = async (req, res, next) => {
  try {
    const brands = await Driver.distinct('gpuBrand', { status: 'published' });
    return successResponse(res, brands);
  } catch (error) {
    next(error);
  }
};

const getSupportedOS = async (req, res, next) => {
  try {
    const osList = await Driver.distinct('osSupport', { status: 'published' });
    return successResponse(res, osList);
  } catch (error) {
    next(error);
  }
};

const getGpuModels = async (req, res, next) => {
  try {
    const { gpuBrand, keyword, limit = 50 } = req.query;
    const query = { status: 'published' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    if (keyword) query.gpuModel = new RegExp(keyword, 'i');
    const models = await Driver.distinct('gpuModel', query);
    return successResponse(res, models.slice(0, parseInt(limit)));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  searchDrivers,
  getHotDrivers,
  getGpuBrands,
  getSupportedOS,
  getGpuModels
};
