# GPU 显卡驱动服务 API 接口文档

## 基础信息
- **Base URL**: `http://localhost:3000/api/v1`
- **Content-Type**: `application/json`
- **认证方式**: Bearer Token (JWT)

## 一、搜索类接口

### 1.1 驱动搜索
`GET /api/v1/search/search`

**查询参数**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 关键词模糊匹配（型号/名称/描述） |
| gpuBrand | string | 否 | 品牌：NVIDIA/AMD/Intel/Other |
| osVersion | string | 否 | 系统版本：Windows 10/Windows 11/Linux等 |
| architecture | string | 否 | 架构：x86/x64/arm64/all |
| sortBy | string | 否 | 排序：version/downloads/rating/date |
| sortOrder | string | 否 | 顺序：asc/desc（默认desc） |
| page | number | 否 | 页码，默认1 |
| limit | number | 否 | 每页数量，默认20 |

### 1.2 热门驱动排行
`GET /api/v1/search/hot?limit=10&gpuBrand=NVIDIA`

### 1.3 获取品牌列表
`GET /api/v1/search/brands`

### 1.4 获取支持系统
`GET /api/v1/search/os`

### 1.5 获取显卡型号
`GET /api/v1/search/gpu-models?gpuBrand=NVIDIA&keyword=RTX`

---

## 二、驱动详情类接口

### 2.1 驱动详情
`GET /api/v1/drivers/:id`

**返回**: 包含驱动基本信息、文件校验、发布说明、相关驱动、是否已收藏等

### 2.2 获取某型号驱动版本列表
`GET /api/v1/drivers/versions?gpuModel=RTX 4090`

### 2.3 生成下载令牌
`POST /api/v1/drivers/:driverId/download/token?source=web|miniapp|customer_service`

**返回**:
```json
{
  "code": 200,
  "data": {
    "token": "xxx",
    "expiresAt": "2024-01-01T00:00:00Z",
    "expiresIn": 3600,
    "driverInfo": { ... }
  }
}
```

### 2.4 兑换下载令牌（获取真实下载地址）
`POST /api/v1/drivers/download/redeem/:token`

**返回**:
```json
{
  "code": 200,
  "data": {
    "downloadUrl": "https://...",
    "checksum": { "md5": "...", "sha256": "..." },
    "fileName": "...",
    "fileSize": 123456,
    "version": "546.17"
  }
}
```

---

## 三、下载令牌接口

见上述 **2.3** 和 **2.4**，令牌默认有效期1小时。

---

## 四、版本比较接口

### 4.1 驱动版本比较
`POST /api/v1/compatibility/compare`

**请求体**:
```json
{
  "driverIds": ["id1", "id2", "id3"]
}
```

**返回**: 多驱动版本对比、系统兼容性矩阵、推荐（最新/最多下载/最高评分）

### 4.2 兼容性校验
`POST /api/v1/compatibility/check`

**请求体**:
```json
{
  "driverId": "xxx",
  "osVersion": "Windows 11",
  "architecture": "x64",
  "gpuModel": "RTX 4090"
}
```

### 4.3 批量兼容性校验
`POST /api/v1/compatibility/batch-check`

---

## 五、反馈受理接口

### 5.1 提交反馈
`POST /api/v1/feedback`

**请求体**:
```json
{
  "driverId": "xxx",
  "type": "invalid_link|compatibility_issue|other|rating",
  "content": "反馈内容",
  "rating": 5,
  "contactInfo": "邮箱或其他联系方式"
}
```

### 5.2 我的反馈列表
`GET /api/v1/feedback/my`

### 5.3 用户评分
`POST /api/v1/rating`

```json
{ "driverId": "xxx", "rating": 5 }
```

---

## 六、收藏记录接口

### 6.1 添加收藏
`POST /api/v1/favorites`
```json
{ "driverId": "xxx", "remark": "备注" }
```

### 6.2 取消收藏
`DELETE /api/v1/favorites/:driverId`

### 6.3 我的收藏
`GET /api/v1/favorites?page=1&limit=20`

### 6.4 检查是否已收藏
`GET /api/v1/favorites/check/:driverId`

---

## 七、用户认证接口

### 7.1 注册
`POST /api/v1/auth/register`
```json
{ "username": "test", "email": "test@test.com", "password": "123456", "nickname": "昵称" }
```

### 7.2 登录
`POST /api/v1/auth/login`
```json
{ "username": "test", "password": "123456" }
```

### 7.3 获取个人信息
`GET /api/v1/auth/profile` (需登录)

### 7.4 更新个人信息
`PUT /api/v1/auth/profile`

### 7.5 修改密码
`POST /api/v1/auth/change-password`

---

## 八、管理审核接口 (需 admin/editor 权限)

### 8.1 驱动管理

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/admin/drivers` | 新增驱动 |
| PUT | `/api/v1/admin/drivers/:id` | 更新驱动 |
| DELETE | `/api/v1/admin/drivers/:id` | 删除驱动 |
| POST | `/api/v1/admin/drivers/:id/publish` | 发布驱动 |
| POST | `/api/v1/admin/drivers/:id/offline` | 下架驱动 |
| POST | `/api/v1/admin/drivers/:id/reject` | 拒绝审核 |
| POST | `/api/v1/admin/drivers/:id/remark` | 添加审核备注 |
| GET | `/api/v1/admin/drivers/pending` | 待审核列表 |
| GET | `/api/v1/admin/drivers` | 全部驱动列表 |
| POST | `/api/v1/admin/drivers/merge` | 重复驱动合并 |

**合并请求体**:
```json
{
  "targetDriverId": "主驱动ID",
  "sourceDriverIds": ["id1", "id2"],
  "mergeStrategy": "newest"
}
```

### 8.2 下载统计
`GET /api/v1/admin/statistics/downloads`

### 8.3 反馈管理
- `GET /api/v1/admin/feedbacks` - 反馈列表
- `POST /api/v1/admin/feedbacks/:id/handle` - 处理反馈

### 8.4 黑名单管理
- `GET /api/v1/admin/blacklist` - 黑名单列表
- `POST /api/v1/admin/blacklist` - 添加黑名单
- `DELETE /api/v1/admin/blacklist/:id` - 移除黑名单

**添加请求体**:
```json
{
  "type": "file_md5|file_sha256|url|ip|user",
  "value": "具体值",
  "reason": "原因",
  "expiresAt": "2025-01-01T00:00:00Z"
}
```

### 8.5 操作日志
`GET /api/v1/admin/logs?userId=&action=&startDate=&endDate=`

### 8.6 更新订阅
- `GET /api/v1/admin/subscriptions` - 我的订阅
- `POST /api/v1/admin/subscriptions` - 添加订阅
- `DELETE /api/v1/admin/subscriptions/:id` - 取消订阅
- `GET /api/v1/admin/subscriptions/admin` - 全部订阅（管理员）

### 8.7 客服推荐清单（客服/管理员权限）
`POST /api/v1/admin/recommendations`

**请求体**:
```json
{
  "gpuModel": "RTX 4090",
  "osVersion": "Windows 11",
  "architecture": "x64",
  "limit": 10,
  "includeOldVersions": false
}
```

---

## 用户角色

| 角色 | 权限 |
|------|------|
| user | 搜索、下载、评分、反馈、收藏、订阅 |
| customer_service | user + 生成推荐清单 |
| editor | user + 驱动增删改/发布/下架/审核/处理反馈/查看日志 |
| admin | editor + 驱动合并/黑名单管理/全部权限 |
