const express = require('express');
const router = express.Router();
const {
  searchDrivers,
  getHotDrivers,
  getGpuBrands,
  getSupportedOS,
  getGpuModels
} = require('../controllers/searchController');

router.get('/', searchDrivers);
router.get('/hot', getHotDrivers);
router.get('/brands', getGpuBrands);
router.get('/os', getSupportedOS);
router.get('/models', getGpuModels);
router.get('/gpu-models', getGpuModels);

module.exports = router;
