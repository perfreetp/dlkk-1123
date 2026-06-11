const express = require('express');
const router = express.Router();

const searchRoutes = require('./searchRoutes');
const driversRoutes = require('./driversRoutes');
const compatibilityRoutes = require('./compatibilityRoutes');
const feedbackRoutes = require('./feedbackRoutes');
const authRoutes = require('./authRoutes');
const adminRoutes = require('./adminRoutes');

router.get('/health', (req, res) => {
  res.json({
    code: 200,
    message: 'GPU Driver Service is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

router.use('/auth', authRoutes);
router.use('/search', searchRoutes);
router.use('/drivers', driversRoutes);
router.use('/compatibility', compatibilityRoutes);
router.use('/', feedbackRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
