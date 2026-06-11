const mongoose = require('mongoose');

const favoriteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  driverId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Driver',
    required: true,
    index: true
  },
  remark: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

favoriteSchema.index({ userId: 1, driverId: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
