# Chrome 翻译插件代码优化报告

## 一、项目概述

这是一个基于 LibreTranslate API 的 Chrome 扩展程序，提供网页全文翻译和选中文本翻译功能。

### 功能模块

| 模块 | 文件 | 功能描述 |
|------|------|----------|
| 内容脚本 | content.js | 页面翻译、选中文本翻译、弹窗显示 |
| 背景脚本 | background.js | 翻译API调用、右键菜单、快捷键、设置管理 |
| 弹出窗口 | popup.js | 手动翻译输入、翻译整个页面 |
| 选项页面 | options.html/js | 用户配置界面 |

---

## 二、问题识别与分析

### 2.1 性能问题

| 问题 | 位置 | 影响 |
|------|------|------|
| 大页面翻译超时 | background.js:139 | 30秒超时对大页面不足 |
| 重复获取设置 | background.js 多处 | 每次操作都调用 getSettings() |
| 翻译API调用冗余 | popup.js | 选中文本时尝试两次获取 |
| DOM遍历效率低 | content.js 旧代码 | 已废弃的逐节点翻译方式 |

### 2.2 代码冗余

| 问题 | 位置 | 说明 |
|------|------|------|
| 重复的颜色变量定义 | content.js:265-270 | 暗色主题颜色在多处定义 |
| 重复的设置键列表 | background.js:4,105,211 | settings 键名数组重复3次 |
| 无用的代码 | content.js:523-530 | contextmenu 事件监听无实际作用 |
| 未使用的参数 | content.js:209 | currentTarget 参数未使用 |
| getSettings函数重复定义 | popup.js:291,367 | 同一个函数定义两次 |

### 2.3 逻辑缺陷

| 问题 | 位置 | 说明 |
|------|------|------|
| 还原功能失效 | content.js:107 | 使用 textContent 还原 HTML 内容无效 |
| 主题检查重复 | content.js:411,417-422 | 重复的暗色主题检测逻辑 |
| 超时参数无效 | content.js:47 | 消息传递不支持 timeout 参数 |

### 2.4 安全性问题

| 问题 | 位置 | 说明 |
|------|------|------|
| innerHTML XSS风险 | content.js:63 | 直接使用翻译结果设置 innerHTML |
| 缺少输入验证 | popup.js:126 | 未验证输入文本长度 |

### 2.5 架构问题

| 问题 | 说明 |
|------|------|
| 消息传递模式混乱 | 同时使用 Promise 和回调风格的 sendResponse |
| 配置分散 | 设置键名在不同文件中重复定义 |
| 错误处理不一致 | 部分使用 try-catch，部分直接抛出 |

---

## 三、优化方案

### 3.1 性能优化

```javascript
// 优化1: 增加大页面翻译超时
// background.js
const TRANSLATION_TIMEOUT = 60000; // 60秒，用于大页面翻译

// 优化2: 缓存设置，减少重复获取
// background.js
let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_DURATION = 5000; // 5秒缓存

async function getSettings() {
  const now = Date.now();
  if (settingsCache && (now - settingsCacheTime) < SETTINGS_CACHE_DURATION) {
    return settingsCache;
  }
  // ... 原逻辑
  settingsCache = result;
  settingsCacheTime = now;
  return result;
}
```

### 3.2 代码精简

```javascript
// 优化3: 统一颜色配置
const COLORS = {
  light: { bg: 'white', text: '#333', border: '#ddd', btnBg: '#f0f0f0' },
  dark: { bg: '#1e1e1e', text: '#fff', border: '#3e3e3e', btnBg: '#3e3e3e' }
};

// 优化4: 提取设置键名常量
const SETTINGS_KEYS = [
  'apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 
  'autoTranslate', 'autoTranslateLanguages', 
  'shortcut1Action', 'shortcut1Target',
  'shortcut2Action', 'shortcut2Target',
  'autoTranslateExcludedSites'
];
```

### 3.3 逻辑修复

```javascript
// 优化5: 修复还原功能
function restoreOriginalPage() {
  // ... 前置检查
  originalTexts.forEach((data, node) => {
    if (node.parentNode) {
      const originalHtml = typeof data === 'object' ? data.text : data;
      if (data.isHTML) {
        node.innerHTML = originalHtml; // 使用 innerHTML 还原
      } else {
        node.textContent = originalHtml;
      }
    }
  });
}

// 优化6: 移除无效代码
// 删除 content.js:523-530 的无用 contextmenu 监听

// 优化7: 删除重复的 getSettings 定义
// popup.js 只保留一个 getSettings 定义
```

### 3.4 安全性增强

```javascript
// 优化8: HTML sanitizer
function sanitizeHtml(html) {
  const allowedTags = ['p', 'br', 'b', 'i', 'em', 'strong', 'a', 'span', 'div', 'ul', 'ol', 'li'];
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // 移除危险元素
  const dangerous = temp.querySelectorAll('script,style,iframe,object,embed,link');
  dangerous.forEach(el => el.remove());
  
  return temp.innerHTML;
}
```

---

## 四、优化实施状态

| 优化项 | 优先级 | 状态 | 说明 |
|--------|--------|------|------|
| 大页面翻译超时 | 高 | ✅ 已完成 | 使用60秒超时 |
| 全文翻译方案 | 高 | ✅ 已完成 | 改为翻译body.innerHTML |
| 弹窗定位修复 | 高 | ✅ 已完成 | 修复fixed定位计算 |
| 弹窗z-index | 高 | ✅ 已完成 | 提升到最大整数值 |
| 暗色主题适配 | 中 | ✅ 已完成 | 统一颜色变量 |
| 移除无效代码 | 中 | ⏳ 待处理 | 删除无用代码 |
| 设置缓存 | 低 | ⏳ 待处理 | 性能优化 |
| 输入验证 | 低 | ⏳ 待处理 | 安全增强 |

---

## 五、总结

### 已完成的优化

1. **翻译功能修复**：采用新的 HTML 格式翻译方案，直接翻译和替换 `body.innerHTML`，解决翻译后页面无变化的问题
2. **弹窗显示修复**：修复 `position: fixed` 定位计算，添加延迟事件绑定，解决弹窗不显示问题
3. **UI适配改进**：统一暗色主题颜色变量，改善用户体验

### 待优化项

1. 设置缓存机制（减少 storage API 调用）
2. 删除重复代码和无用代码
3. 输入验证和安全性增强
4. 统一错误处理模式

### 性能对比

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 大页面翻译 | 超时失败 | 60秒超时，成功率提升 |
| 弹窗显示 | 经常不显示 | 稳定显示 |
| 暗色主题 | 部分样式错误 | 完整适配 |