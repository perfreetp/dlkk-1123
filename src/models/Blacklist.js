const mongoose = require('mongoose');

const blacklistSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['file_md5', 'file_sha256', 'url', 'ip', 'user'],
    index: true
  },
  value: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  reason: {
    type: String,
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expiresAt: Date,
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Blacklist', blacklistSchema);
