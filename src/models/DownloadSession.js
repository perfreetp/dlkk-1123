const mongoose = require('mongoose');

const downloadSessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  token: {
    type: String,
    index: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },
  source: {
    type: String,
    enum: ['web', 'miniapp', 'customer_service', 'api'],
    default: 'api',
    index: true
  },
  status: {
    type: String,
    enum: ['generated', 'redeemed', 'failed', 'expired'],
    default: 'generated',
    index: true
  },
  failureReason: {
    type: String
  },
  blacklistHit: {
    type: Boolean,
    default: false
  },
  blacklistType: {
    type: String,
    enum: ['file_md5', 'file_sha256', 'url', 'none'],
    default: 'none'
  },
  clientIp: String,
  userAgent: String,
  fileInfo: {
    fileName: String,
    fileSize: Number,
    md5: String,
    sha256: String,
    version: String
  },
  recommendationId: {
    type: String,
    index: true
  },
  generatedAt: {
    type: Date,
    default: Date.now
  },
  redeemedAt: Date,
  expiresAt: Date
}, {
  timestamps: true
});

downloadSessionSchema.index({ createdAt: -1 });
downloadSessionSchema.index({ source: 1, status: 1, createdAt: -1 });
downloadSessionSchema.index({ driverId: 1, status: 1 });
downloadSessionSchema.index({ recommendationId: 1 });

module.exports = mongoose.model('DownloadSession', downloadSessionSchema);
