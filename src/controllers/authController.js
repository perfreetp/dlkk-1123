const jwt = require('jsonwebtoken');
const { User } = require('../models');
const config = require('../config');
const { successResponse, errorResponse } = require('../utils/helpers');
const { logOperation } = require('../utils/logger');

const register = async (req, res, next) => {
  try {
    const { username, email, password, nickname } = req.body;
    if (!username || !email || !password) {
      return errorResponse(res, '请填写完整信息', 400);
    }
    if (password.length < 6) {
      return errorResponse(res, '密码长度至少6位', 400);
    }
    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return errorResponse(res, '用户名或邮箱已存在', 409);
    }
    const user = new User({
      username,
      email,
      password,
      nickname: nickname || username
    });
    await user.save();
    const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    return successResponse(res, {
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        nickname: user.nickname,
        role: user.role
      }
    }, '注册成功', 201);
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return errorResponse(res, '请提供用户名和密码', 400);
    }
    const user = await User.findOne({ $or: [{ username }, { email: username }] });
    if (!user) {
      return errorResponse(res, '用户名或密码错误', 401);
    }
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      return errorResponse(res, '用户名或密码错误', 401);
    }
    if (user.status !== 'active') {
      return errorResponse(res, '账号已被禁用', 403);
    }
    user.lastLoginAt = new Date();
    user.lastLoginIp = req.ip;
    await user.save();
    const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    logOperation({
      user,
      action: 'login',
      details: { ip: req.ip },
      req
    });
    return successResponse(res, {
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        avatar: user.avatar
      }
    }, '登录成功');
  } catch (error) {
    next(error);
  }
};

const getProfile = async (req, res, next) => {
  try {
    return successResponse(res, {
      id: req.user._id,
      username: req.user.username,
      email: req.user.email,
      nickname: req.user.nickname,
      role: req.user.role,
      avatar: req.user.avatar,
      status: req.user.status,
      createdAt: req.user.createdAt
    });
  } catch (error) {
    next(error);
  }
};

const updateProfile = async (req, res, next) => {
  try {
    const { nickname, avatar, email } = req.body;
    const updateData = {};
    if (nickname) updateData.nickname = nickname;
    if (avatar) updateData.avatar = avatar;
    if (email) updateData.email = email;
    const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true }).select('-password');
    logOperation({
      user: req.user,
      action: 'update_profile',
      details: updateData,
      req
    });
    return successResponse(res, user);
  } catch (error) {
    next(error);
  }
};

const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      return errorResponse(res, '请提供旧密码和新密码', 400);
    }
    if (newPassword.length < 6) {
      return errorResponse(res, '新密码长度至少6位', 400);
    }
    const user = await User.findById(req.user._id);
    const isValid = await user.comparePassword(oldPassword);
    if (!isValid) {
      return errorResponse(res, '旧密码错误', 401);
    }
    user.password = newPassword;
    await user.save();
    logOperation({
      user: req.user,
      action: 'change_password',
      req
    });
    return successResponse(res, null, '密码修改成功');
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  changePassword
};
