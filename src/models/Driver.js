const mongoose = require('mongoose');
const { generateVersionCode } = require('../utils/helpers');

const driverSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true
  },
  gpuModel: {
    type: String,
    required: true,
    index: true
  },
  gpuBrand: {
    type: String,
    required: true,
    enum: ['NVIDIA', 'AMD', 'Intel', 'Other'],
    index: true
  },
  version: {
    type: String,
    required: true
  },
  versionCode: {
    type: String,
    index: true
  },
  releaseDate: {
    type: Date,
    required: true
  },
  osSupport: [{
    type: String,
    required: true,
    enum: ['Windows 10', 'Windows 11', 'Windows 7', 'Windows 8', 'Linux', 'macOS']
  }],
  architecture: {
    type: String,
    enum: ['x86', 'x64', 'arm64', 'all'],
    default: 'all'
  },
  fileSize: {
    type: Number,
    required: true
  },
  downloadUrl: {
    type: String,
    required: true
  },
  checksum: {
    md5: String,
    sha256: String,
    sha1: String
  },
  description: {
    type: String,
    default: ''
  },
  releaseNotes: [{
    type: String
  }],
  tags: [{
    type: String,
    index: true
  }],
  status: {
    type: String,
    enum: ['pending', 'published', 'offline', 'rejected', 'merged'],
    default: 'pending',
    index: true
  },
  isHot: {
    type: Boolean,
    default: false,
    index: true
  },
  isRecommended: {
    type: Boolean,
    default: false
  },
  rating: {
    average: {
      type: Number,
      default: 0
    },
    count: {
      type: Number,
      default: 0
    }
  },
  downloadCount: {
    type: Number,
    default: 0,
    index: true
  },
  feedbackCount: {
    type: Number,
    default: 0
  },
  invalidLinkCount: {
    type: Number,
    default: 0
  },
  mergedFrom: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  }],
  parentDriver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  publishedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  publishedAt: Date,
  auditRemarks: [{
    content: String,
    auditor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

driverSchema.index({ name: 'text', gpuModel: 'text', description: 'text', tags: 'text' });
driverSchema.index({ gpuBrand: 1, status: 1 });
driverSchema.index({ status: 1, osSupport: 1 });

driverSchema.pre('save', function (next) {
  if (this.isModified('version') || !this.versionCode) {
    this.versionCode = generateVersionCode(this.version);
  }
  next();
});

driverSchema.statics.generateVersionCode = generateVersionCode;

module.exports = mongoose.model('Driver', driverSchema);
