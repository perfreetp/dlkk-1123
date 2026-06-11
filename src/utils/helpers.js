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

module.exports = {
  generateDownloadToken,
  parseVersion,
  compareVersions,
  formatFileSize,
  successResponse,
  errorResponse,
  paginate,
  checkBlacklist
};
