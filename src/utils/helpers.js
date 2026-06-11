const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { Blacklist } = require('../models');

const generateDownloadToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

const parseVersion = (version) => {
  return version
    .split(/[.\-+]/)
    .map(v => {
      const num = parseInt(v, 10);
      return isNaN(num) ? 0 : num;
    });
};

const compareVersions = (v1, v2) => {
  const a = parseVersion(v1);
  const b = parseVersion(v2);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
};

const generateVersionCode = (version) => {
  if (!version) return '000000';
  const parts = version.split(/[.\-+_]/);
  const padded = parts.map(p => {
    const num = parseInt(p, 10);
    if (isNaN(num)) return '000000';
    return num.toString().padStart(6, '0');
  });
  while (padded.length < 4) padded.push('000000');
  return padded.slice(0, 4).join('.');
};

const sortDriversByVersion = (drivers, order = 'desc') => {
  const copy = [...drivers];
  copy.sort((a, b) => {
    const vCodeA = a.versionCode || generateVersionCode(a.version);
    const vCodeB = b.versionCode || generateVersionCode(b.version);
    if (vCodeA !== vCodeB) {
      return order === 'desc' ? vCodeB.localeCompare(vCodeA) : vCodeA.localeCompare(vCodeB);
    }
    const tA = new Date(a.releaseDate || 0).getTime();
    const tB = new Date(b.releaseDate || 0).getTime();
    if (tA !== tB) return order === 'desc' ? tB - tA : tA - tB;
    const idA = a._id ? String(a._id) : '';
    const idB = b._id ? String(b._id) : '';
    return order === 'desc' ? idB.localeCompare(idA) : idA.localeCompare(idB);
  });
  return copy;
};

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const successResponse = (res, data = null, message = '操作成功', status = 200) => {
  return res.status(status).json({
    code: status,
    message,
    data
  });
};

const errorResponse = (res, message = '操作失败', status = 400, errors = null) => {
  const response = { code: status, message };
  if (errors) response.errors = errors;
  return res.status(status).json(response);
};

const paginate = async (model, query = {}, options = {}) => {
  const {
    page = 1,
    limit = 20,
    sort = { createdAt: -1 },
    select = null,
    populate = null
  } = options;
  const skip = (page - 1) * limit;
  const [total, items] = await Promise.all([
    model.countDocuments(query),
    model.find(query)
      .select(select)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate(populate)
      .exec()
  ]);
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1
    }
  };
};

const checkBlacklist = async (type, value) => {
  if (!value) return false;
  const item = await Blacklist.findOne({ type, value, isActive: true });
  return !!item;
};

const checkDriverBlacklist = async (driver) => {
  const result = {
    isBlocked: false,
    hitType: 'none',
    hitValue: '',
    reason: ''
  };
  if (driver.checksum?.md5) {
    const md5Item = await Blacklist.findOne({ type: 'file_md5', value: driver.checksum.md5, isActive: true });
    if (md5Item) {
      result.isBlocked = true;
      result.hitType = 'file_md5';
      result.hitValue = driver.checksum.md5;
      result.reason = md5Item.reason || '文件MD5在黑名单中';
      return result;
    }
  }
  if (driver.checksum?.sha256) {
    const sha256Item = await Blacklist.findOne({ type: 'file_sha256', value: driver.checksum.sha256, isActive: true });
    if (sha256Item) {
      result.isBlocked = true;
      result.hitType = 'file_sha256';
      result.hitValue = driver.checksum.sha256;
      result.reason = sha256Item.reason || '文件SHA256在黑名单中';
      return result;
    }
  }
  if (driver.downloadUrl) {
    const urlItem = await Blacklist.findOne({ type: 'url', value: driver.downloadUrl, isActive: true });
    if (urlItem) {
      result.isBlocked = true;
      result.hitType = 'url';
      result.hitValue = driver.downloadUrl;
      result.reason = urlItem.reason || '下载链接在黑名单中';
      return result;
    }
  }
  return result;
};

const getBlacklistValuesMap = async (types = ['file_md5', 'file_sha256', 'url']) => {
  const items = await Blacklist.find({ type: { $in: types }, isActive: true }).select('type value').lean();
  const map = { file_md5: [], file_sha256: [], url: [] };
  items.forEach(item => {
    if (map[item.type]) map[item.type].push(item.value);
  });
  return map;
};

module.exports = {
  generateDownloadToken,
  parseVersion,
  compareVersions,
  generateVersionCode,
  sortDriversByVersion,
  formatFileSize,
  successResponse,
  errorResponse,
  paginate,
  checkBlacklist,
  checkDriverBlacklist,
  getBlacklistValuesMap
};
