const mongoose = require('mongoose');

const downloadTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
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
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  used: {
    type: Boolean,
    default: false
  },
  usedAt: Date,
  clientIp: String,
  source: {
    type: String,
    enum: ['web', 'miniapp', 'customer_service', 'api'],
    default: 'api'
  }
}, {
  timestamps: true
});

downloadTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DownloadToken', downloadTokenSchema);
