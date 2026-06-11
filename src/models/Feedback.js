const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
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
  type: {
    type: String,
    required: true,
    enum: ['invalid_link', 'compatibility_issue', 'other', 'rating'],
    index: true
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  content: {
    type: String,
    required: true
  },
  contactInfo: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'resolved', 'rejected'],
    default: 'pending',
    index: true
  },
  handler: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  handleRemark: {
    type: String,
    default: ''
  },
  handledAt: Date,
  ip: String,
  userAgent: String
}, {
  timestamps: true
});

feedbackSchema.index({ driverId: 1, type: 1, status: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
