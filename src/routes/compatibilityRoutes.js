const express = require('express');
const router = express.Router();
const {
  compareDrivers,
  checkCompatibility,
  batchCheckCompatibility
} = require('../controllers/compatibilityController');

router.post('/compare', compareDrivers);
router.post('/check', checkCompatibility);
router.post('/batch-check', batchCheckCompatibility);

module.exports = router;
