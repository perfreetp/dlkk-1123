const express = require('express');
const router = express.Router();
const {
  getDriverDetail,
  getDriverVersions,
  generateDownloadLink,
  redeemDownloadToken,
  incrementDownloadCount
} = require('../controllers/driverController');
const { auth, optionalAuth } = require('../middleware/auth');

router.get('/versions', getDriverVersions);
router.get('/:id', optionalAuth, getDriverDetail);
router.post('/:driverId/download/token', optionalAuth, generateDownloadLink);
router.post('/download/redeem/:token', redeemDownloadToken);
router.post('/:driverId/download/count', incrementDownloadCount);

module.exports = router;
