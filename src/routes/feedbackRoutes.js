const express = require('express');
const router = express.Router();
const {
  submitFeedback,
  getMyFeedbacks,
  submitRating,
  addFavorite,
  removeFavorite,
  getMyFavorites,
  checkFavorite
} = require('../controllers/feedbackController');
const { auth, optionalAuth } = require('../middleware/auth');

router.post('/feedback', optionalAuth, submitFeedback);
router.get('/feedback/my', auth, getMyFeedbacks);
router.post('/rating', auth, submitRating);
router.get('/rating/:driverId', auth, getMyRating);
router.post('/favorites', auth, addFavorite);
router.delete('/favorites/:driverId', auth, removeFavorite);
router.get('/favorites', auth, getMyFavorites);
router.get('/favorites/check/:driverId', auth, checkFavorite);

module.exports = router;
