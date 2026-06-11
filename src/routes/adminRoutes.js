const express = require('express');
const router = express.Router();
const {
  createDriver,
  updateDriver,
  deleteDriver,
  publishDriver,
  offlineDriver,
  rejectDriver,
  addAuditRemark,
  getPendingDrivers,
  getAllDrivers,
  getDriverDetailAdmin,
  mergeDrivers,
  getDownloadStatistics,
  migrateVersionCodes
} = require('../controllers/adminController');
const { getDownloadSessions, getDownloadSessionDetail } = require('../controllers/driverController');
const {
  getFeedbacks,
  handleFeedback,
  addBlacklistItem,
  removeBlacklistItem,
  getBlacklist,
  getOperationLogs,
  getSubscriptions,
  addSubscription,
  cancelSubscription,
  generateRecommendationList,
  getAllSubscriptionsAdmin
} = require('../controllers/manageController');
const { auth } = require('../middleware/auth');
const { requireEditor, requireAdmin, requireCustomerService } = require('../middleware/permission');

router.post('/drivers', auth, requireEditor, createDriver);
router.put('/drivers/:id', auth, requireEditor, updateDriver);
router.delete('/drivers/:id', auth, requireAdmin, deleteDriver);
router.post('/drivers/:id/publish', auth, requireEditor, publishDriver);
router.post('/drivers/:id/offline', auth, requireEditor, offlineDriver);
router.post('/drivers/:id/reject', auth, requireEditor, rejectDriver);
router.post('/drivers/:id/remark', auth, requireEditor, addAuditRemark);
router.get('/drivers/pending', auth, requireEditor, getPendingDrivers);
router.get('/drivers', auth, requireEditor, getAllDrivers);
router.get('/drivers/:id', auth, requireEditor, getDriverDetailAdmin);
router.post('/drivers/merge', auth, requireAdmin, mergeDrivers);

router.get('/statistics/downloads', auth, requireEditor, getDownloadStatistics);
router.get('/download-sessions', auth, requireEditor, getDownloadSessions);
router.get('/download-sessions/:sessionId', auth, requireEditor, getDownloadSessionDetail);
router.post('/migrate/version-codes', auth, requireAdmin, migrateVersionCodes);

router.get('/feedbacks', auth, requireEditor, getFeedbacks);
router.post('/feedbacks/:id/handle', auth, requireEditor, handleFeedback);

router.post('/blacklist', auth, requireAdmin, addBlacklistItem);
router.delete('/blacklist/:id', auth, requireAdmin, removeBlacklistItem);
router.get('/blacklist', auth, requireEditor, getBlacklist);

router.get('/logs', auth, requireAdmin, getOperationLogs);

router.get('/subscriptions', auth, getSubscriptions);
router.post('/subscriptions', auth, addSubscription);
router.delete('/subscriptions/:id', auth, cancelSubscription);
router.get('/subscriptions/admin', auth, requireEditor, getAllSubscriptionsAdmin);

router.post('/recommendations', auth, requireCustomerService, generateRecommendationList);

module.exports = router;
