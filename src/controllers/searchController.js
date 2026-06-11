const { Driver, Blacklist } = require('../models');
const { successResponse, errorResponse, formatFileSize, getBlacklistValuesMap, sortDriversByVersion } = require('../utils/helpers');

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

    const isExactModel = exactModel === true || exactModel === 'true' || exactModel === '1';
    const matchType = gpuModel ? (isExactModel ? 'exact' : 'fuzzy') : null;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    if (sortBy === 'version') {
      const allDrivers = await Driver.find(query)
        .select('-downloadUrl -checksum -auditRemarks -createdBy -mergedFrom -parentDriver')
        .lean()
        .exec();

      const enriched = allDrivers.map(d => {
        let gpuModelMatchType = 'n/a';
        if (gpuModel) {
          const escaped = gpuModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const exactRegex = new RegExp(`^${escaped}$`, 'i');
          const fuzzyRegex = new RegExp(escaped, 'i');
          if (exactRegex.test(d.gpuModel || '')) {
            gpuModelMatchType = 'exact';
          } else if (fuzzyRegex.test(d.gpuModel || '')) {
            gpuModelMatchType = 'fuzzy';
          }
        }
        return {
          ...d,
          versionCode: d.versionCode,
          fileSizeFormatted: formatFileSize(d.fileSize),
          gpuModelMatchType
        };
      });

      const sorted = sortDriversByVersion(enriched, sortOrder);
      const total = sorted.length;
      const pagedItems = sorted.slice(skip, skip + limitNum);

      return successResponse(res, {
        items: pagedItems,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
          hasNext: skip + limitNum < total,
          hasPrev: pageNum > 1
        },
        filters: { keyword, gpuModel, gpuBrand, osVersion, architecture, exactModel: isExactModel },
        matchType,
        matchTypeDescription: matchType === 'exact'
          ? '精确型号匹配：只返回 gpuModel 完全等于查询值的驱动'
          : (matchType === 'fuzzy' ? '模糊型号匹配：返回 gpuModel 中包含查询关键词的驱动' : null),
        sortInfo: {
          by: 'version',
          order: sortOrder,
          note: '全量结果已按版本号+发布时间+_id稳定排序，包含未显式设置 versionCode 的历史数据'
        }
      });
    }

    const sortOption = getSortOption(sortBy, sortOrder);
    const [total, drivers] = await Promise.all([
      Driver.countDocuments(query),
      Driver.find(query)
        .select('-downloadUrl -checksum -auditRemarks -createdBy -mergedFrom -parentDriver')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum)
        .lean()
        .exec()
    ]);

    const formattedDrivers = drivers.map(d => {
      let gpuModelMatchType = 'n/a';
      if (gpuModel) {
        const escaped = gpuModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exactRegex = new RegExp(`^${escaped}$`, 'i');
        const fuzzyRegex = new RegExp(escaped, 'i');
        if (exactRegex.test(d.gpuModel || '')) {
          gpuModelMatchType = 'exact';
        } else if (fuzzyRegex.test(d.gpuModel || '')) {
          gpuModelMatchType = 'fuzzy';
        }
      }
      return {
        ...d,
        versionCode: d.versionCode,
        fileSizeFormatted: formatFileSize(d.fileSize),
        gpuModelMatchType
      };
    });

    return successResponse(res, {
      items: formattedDrivers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasNext: skip + limitNum < total,
        hasPrev: pageNum > 1
      },
      filters: { keyword, gpuModel, gpuBrand, osVersion, architecture, exactModel: isExactModel },
      matchType,
      matchTypeDescription: matchType === 'exact'
        ? '精确型号匹配：只返回 gpuModel 完全等于查询值的驱动'
        : (matchType === 'fuzzy' ? '模糊型号匹配：返回 gpuModel 中包含查询关键词的驱动' : null)
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
