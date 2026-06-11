const mongoose = require('mongoose');

const operationLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    index: true
  },
  targetType: {
    type: String,
    index: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  },
  ip: String,
  userAgent: String,
  result: {
    type: String,
    enum: ['success', 'failed'],
    default: 'success'
  }
}, {
  timestamps: true
});

operationLogSchema.index({ createdAt: -1 });
operationLogSchema.index({ userId: 1, action: 1, createdAt: -1 });

module.exports = mongoose.model('OperationLog', operationLogSchema);
