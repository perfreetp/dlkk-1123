const { Feedback, Driver, Favorite } = require('../models');
const { successResponse, errorResponse, paginate } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');

const submitFeedback = async (req, res, next) => {
  try {
    const { driverId, type, content, rating, contactInfo } = req.body;
    if (!driverId || !type || !content) {
      return errorResponse(res, '请填写必要信息', 400);
    }
    if (!['invalid_link', 'compatibility_issue', 'other', 'rating'].includes(type)) {
      return errorResponse(res, '无效的反馈类型', 400);
    }
    if (type === 'rating' && (!rating || rating < 1 || rating > 5)) {
      return errorResponse(res, '评分必须在1-5之间', 400);
    }
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    const feedback = new Feedback({
      driverId,
      userId: req.user?._id,
      type,
      content,
      rating: type === 'rating' ? rating : undefined,
      contactInfo,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    await feedback.save();
    const updateData = { $inc: { feedbackCount: 1 } };
    if (type === 'invalid_link') {
      updateData.$inc.invalidLinkCount = 1;
    }
    if (type === 'rating') {
      const allRatings = await Feedback.find({ driverId, type: 'rating', rating: { $exists: true } });
      const totalRating = allRatings.reduce((sum, f) => sum + f.rating, 0) + rating;
      const count = allRatings.length + 1;
      updateData.$set = {
        'rating.average': parseFloat((totalRating / count).toFixed(2)),
        'rating.count': count
      };
    }
    await Driver.findByIdAndUpdate(driverId, updateData);
    if (req.user) {
      logOperation({
        user: req.user,
        action: 'submit_feedback',
        targetType: 'driver',
        targetId: driverId,
        details: { type, rating },
        req
      });
    }
    return successResponse(res, { id: feedback._id, status: feedback.status }, '反馈提交成功', 201);
  } catch (error) {
    next(error);
  }
};

const getMyFeedbacks = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, type } = req.query;
    const query = { userId: req.user._id };
    if (status) query.status = status;
    if (type) query.type = type;
    const result = await paginate(Feedback, query, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: { path: 'driverId', select: 'name version gpuModel' }
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const submitRating = async (req, res, next) => {
  try {
    const { driverId, rating } = req.body;
    if (!driverId || !rating || rating < 1 || rating > 5) {
      return errorResponse(res, '请提供有效的驱动ID和评分(1-5)', 400);
    }
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    let existingFeedback = await Feedback.findOne({
      driverId,
      userId: req.user._id,
      type: 'rating'
    });
    if (existingFeedback) {
      existingFeedback.rating = rating;
      existingFeedback.content = `用户评分: ${rating}星`;
      await existingFeedback.save();
    } else {
      existingFeedback = new Feedback({
        driverId,
        userId: req.user._id,
        type: 'rating',
        rating,
        content: `用户评分: ${rating}星`,
        ip: req.ip
      });
      await existingFeedback.save();
    }
    const allRatings = await Feedback.find({ driverId, type: 'rating', rating: { $exists: true } });
    const totalRating = allRatings.reduce((sum, f) => sum + f.rating, 0);
    const count = allRatings.length;
    await Driver.findByIdAndUpdate(driverId, {
      $set: {
        'rating.average': parseFloat((totalRating / count).toFixed(2)),
        'rating.count': count
      }
    });
    logOperation({
      user: req.user,
      action: 'submit_rating',
      targetType: 'driver',
      targetId: driverId,
      details: { rating },
      req
    });
    return successResponse(res, {
      averageRating: parseFloat((totalRating / count).toFixed(2)),
      ratingCount: count
    }, '评分成功');
  } catch (error) {
    next(error);
  }
};

const addFavorite = async (req, res, next) => {
  try {
    const { driverId, remark } = req.body;
    if (!driverId) {
      return errorResponse(res, '请提供驱动ID', 400);
    }
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return errorResponse(res, '驱动不存在', 404);
    }
    const existing = await Favorite.findOne({ userId: req.user._id, driverId });
    if (existing) {
      return errorResponse(res, '该驱动已收藏', 409);
    }
    const favorite = new Favorite({
      userId: req.user._id,
      driverId,
      remark: remark || ''
    });
    await favorite.save();
    logOperation({
      user: req.user,
      action: 'add_favorite',
      targetType: 'driver',
      targetId: driverId,
      req
    });
    return successResponse(res, { id: favorite._id }, '收藏成功', 201);
  } catch (error) {
    next(error);
  }
};

const removeFavorite = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const result = await Favorite.findOneAndDelete({
      userId: req.user._id,
      driverId
    });
    if (!result) {
      return errorResponse(res, '未找到该收藏', 404);
    }
    logOperation({
      user: req.user,
      action: 'remove_favorite',
      targetType: 'driver',
      targetId: driverId,
      req
    });
    return successResponse(res, null, '取消收藏成功');
  } catch (error) {
    next(error);
  }
};

const getMyFavorites = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await paginate(Favorite, { userId: req.user._id }, {
      page,
      limit,
      sort: { createdAt: -1 },
      populate: {
        path: 'driverId',
        select: 'name version gpuModel gpuBrand osSupport fileSize rating downloadCount isRecommended status'
      }
    });
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
};

const checkFavorite = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const exists = await Favorite.exists({
      userId: req.user._id,
      driverId
    });
    return successResponse(res, { isFavorited: !!exists });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitFeedback,
  getMyFeedbacks,
  submitRating,
  addFavorite,
  removeFavorite,
  getMyFavorites,
  checkFavorite
};
