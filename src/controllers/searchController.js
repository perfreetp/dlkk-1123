const { Driver, Blacklist } = require('../models');
const { successResponse, errorResponse, compareVersions, formatFileSize, getBlacklistValuesMap } = require('../utils/helpers');

const buildSearchQuery = async (queryParams, { includeUnpublished = false } = {}) => {
  const {
    keyword,
    gpuModel,
    gpuBrand,
    osVersion,
    architecture,
    exactModel = false
  } = queryParams;

  const query = {};
  if (!includeUnpublished) {
    query.status = 'published';
  }

  if (gpuBrand) {
    query.gpuBrand = gpuBrand;
  }

  if (gpuModel) {
    if (exactModel === true || exactModel === 'true' || exactModel === '1') {
      query.gpuModel = { $regex: new RegExp(`^${gpuModel}$`, 'i') };
    } else {
      query.gpuModel = new RegExp(gpuModel, 'i');
    }
    if (keyword) {
      const regex = new RegExp(keyword, 'i');
      query.$and = (query.$and || []).concat([
        {
          $or: [
            { name: regex },
            { description: regex },
            { tags: { $in: [regex] } }
          ]
        }
      ]);
    }
  } else if (keyword) {
    const regex = new RegExp(keyword, 'i');
    query.$or = [
      { name: regex },
      { gpuModel: regex },
      { description: regex },
      { tags: { $in: [regex] } }
    ];
  }

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

  return query;
};

const getSortOption = (sortBy, sortOrder) => {
  const order = sortOrder === 'asc' ? 1 : -1;
  switch (sortBy) {
    case 'version':
      return { versionCode: order, releaseDate: order, _id: 1 };
    case 'downloads':
      return { downloadCount: order, versionCode: -1, _id: 1 };
    case 'rating':
      return { 'rating.average': order, versionCode: -1, _id: 1 };
    case 'date':
    default:
      return { createdAt: order, _id: 1 };
  }
};

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
      limit = 20,
      gpuModel,
      exactModel
    } = req.query;

    const query = await buildSearchQuery({
      keyword, gpuModel, gpuBrand, osVersion, architecture, exactModel
    });

    const sortOption = getSortOption(sortBy, sortOrder);
    const skip = (page - 1) * limit;

    const [total, drivers] = await Promise.all([
      Driver.countDocuments(query),
      Driver.find(query)
        .select('-downloadUrl -checksum -auditRemarks -createdBy -mergedFrom -parentDriver')
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

    return successResponse(res, {
      items: formattedDrivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      },
      filters: { keyword, gpuModel, gpuBrand, osVersion, architecture, exactModel: !!exactModel }
    });
  } catch (error) {
    next(error);
  }
};

const getHotDrivers = async (req, res, next) => {
  try {
    const { limit = 10, gpuBrand, osVersion } = req.query;

    const query = { status: 'published' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    if (osVersion) query.osSupport = { $elemMatch: { $regex: new RegExp(osVersion, 'i') } };

    const blacklistMap = await getBlacklistValuesMap(['file_md5', 'file_sha256', 'url']);
    if (blacklistMap.file_md5.length > 0) query['checksum.md5'] = { $nin: blacklistMap.file_md5 };
    if (blacklistMap.file_sha256.length > 0) query['checksum.sha256'] = { $nin: blacklistMap.file_sha256 };
    if (blacklistMap.url.length > 0) query.downloadUrl = { $nin: blacklistMap.url };

    const drivers = await Driver.find(query)
      .select('-downloadUrl -checksum -auditRemarks -createdBy -mergedFrom -parentDriver')
      .sort([
        ['isHot', -1],
        ['isRecommended', -1],
        ['downloadCount', -1],
        ['rating.average', -1],
        ['_id', 1]
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
    const { gpuBrand, gpuModel } = req.query;
    const query = { status: 'published' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    if (gpuModel) query.gpuModel = new RegExp(gpuModel, 'i');
    const osList = await Driver.distinct('osSupport', query);
    return successResponse(res, osList);
  } catch (error) {
    next(error);
  }
};

const getGpuModels = async (req, res, next) => {
  try {
    const { gpuBrand, keyword, limit = 50, osVersion } = req.query;
    const query = { status: 'published' };
    if (gpuBrand) query.gpuBrand = gpuBrand;
    if (keyword) query.gpuModel = new RegExp(keyword, 'i');
    if (osVersion) query.osSupport = { $elemMatch: { $regex: new RegExp(osVersion, 'i') } };

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
  getGpuModels,
  buildSearchQuery,
  getSortOption
};
