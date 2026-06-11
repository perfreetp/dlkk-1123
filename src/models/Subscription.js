const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
    enum: ['NVIDIA', 'AMD', 'Intel', 'Other'],
    index: true
  },
  osVersion: {
    type: String,
    index: true
  },
  notifyMethod: {
    type: String,
    enum: ['email', 'miniapp', 'sms', 'all'],
    default: 'email'
  },
  lastNotifiedAt: Date,
  isActive: {
    type: Boolean,
    default: true,
    index: true
  }
}, {
  timestamps: true
});

subscriptionSchema.index({ userId: 1, gpuModel: 1, osVersion: 1 }, { unique: true });

module.exports = mongoose.model('Subscription', subscriptionSchema);
