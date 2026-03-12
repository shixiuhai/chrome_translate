# LibreTranslate Chrome 翻译插件

一个基于 LibreTranslate API 的 Chrome 浏览器翻译插件，支持自定义翻译接口，提供文本翻译和整页翻译功能。

## 功能特性

- 🔧 **自定义 API 配置**：支持配置自己的 LibreTranslate 服务地址和 API 密钥
- 🌍 **多语言支持**：自动检测源语言，支持多种目标语言
- 📝 **文本翻译**：选中文本快速翻译，弹出窗口显示结果
- 🌐 **整页翻译**：一键翻译整个网页内容
- ⚡ **批量翻译**：优化的批量翻译机制，提升翻译速度
- 🎨 **简洁界面**：现代化的用户界面，操作简单直观

## 项目文件结构

```
chrome_translate/
├── manifest.json          # 扩展配置文件（核心入口）
├── background.js          # 后台服务脚本（Service Worker）
├── content.js             # 内容脚本（注入到网页）
├── content.css            # 内容脚本样式
├── popup.html             # 弹出窗口 HTML
├── popup.js               # 弹出窗口逻辑
├── options.html           # 设置页面 HTML
├── options.js             # 设置页面逻辑
└── icons/                 # 图标文件
    ├── icon16.svg
    ├── icon32.svg
    ├── icon48.svg
    └── icon128.svg
```

## 各文件职责说明

### 1. [`manifest.json`](manifest.json) - 扩展配置清单
Chrome 扩展的入口文件，定义扩展的所有配置：
- 扩展名称、版本、描述
- 权限声明（storage、activeTab、scripting、contextMenus）
- 注册 content_scripts（content.js、content.css）
- 注册 background service worker（background.js）
- 定义 popup 页面（popup.html）
- 定义 options 页面（options.html）

### 2. [`background.js`](background.js) - 后台服务（Service Worker）
扩展的核心逻辑层，负责：
- **初始化配置**：扩展安装时设置默认值（API 地址、API 密钥、默认语言等）
- **创建右键菜单**：翻译选中文本、翻译全文、还原页面
- **处理翻译请求**：接收来自 content.js 和 popup.js 的翻译请求，调用 LibreTranslate API
- **自动翻译监听**：监听页面加载完成事件，触发自动翻译检查
- **获取支持的语言**：从 API 服务器获取语言列表

### 3. [`content.js`](content.js) - 内容脚本
注入到所有网页中，负责：
- **收集文本节点**：遍历页面 DOM，收集可翻译的文本节点
- **批量翻译**：将文本分组为批次，并发翻译
- **应用翻译结果**：将翻译后的文本替换原文
- **显示进度条**：翻译过程中显示进度
- **右键菜单响应**：响应 background.js 发送的翻译消息
- **动态内容监听**：监听页面新加载的内容
- **显示通知和弹窗**：翻译结果弹窗、通知提示

### 4. [`content.css`](content.css) - 内容脚本样式
定义注入到页面中的 UI 样式：
- 翻译弹窗动画效果
- 通知提示动画效果
- 翻译后文本的悬停提示样式

### 5. [`popup.html`](popup.html) / [`popup.js`](popup.js) - 弹出窗口
点击扩展图标时显示的窗口：
- **文本翻译**：手动输入文本进行翻译
- **语言选择**：选择源语言和目标语言
- **整页翻译**：触发页面翻译功能
- **还原页面**：恢复页面原始内容
- **自动翻译开关**：启用/禁用自动翻译
- **排除网站开关**：将当前网站加入排除列表

### 6. [`options.html`](options.html) / [`options.js`](options.js) - 设置页面
扩展的配置管理页面：
- **API 地址配置**：设置 LibreTranslate 服务地址
- **API 密钥配置**：设置 API 认证密钥
- **默认语言设置**：设置默认源语言和目标语言
- **自动翻译设置**：配置自动翻译行为
- **排除网站列表**：设置不自动翻译的网站
- **测试连接**：验证 API 配置是否正确

## 配置存储说明

### 存储位置
所有配置都存储在 **Chrome 浏览器的本地存储（chrome.storage.local）** 中，具体位置：
- **Windows**: `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Local Extension Settings\<扩展 ID>\`
- **macOS**: `~/Library/Application Support/Google/Chrome/Default/Local Extension Settings/<扩展 ID>/`
- **Linux**: `~/.config/google-chrome/Default/Local Extension Settings/<扩展 ID>/`

### 存储的配置项
```javascript
{
  apiUrl: 'https://libretranslate.de',           // API 地址
  apiKey: '',                                     // API 密钥
  defaultSource: 'auto',                          // 默认源语言
  defaultTarget: 'zh-Hans',                       // 默认目标语言
  autoTranslate: false,                           // 是否启用自动翻译
  autoTranslateLanguages: ['en'],                 // 自动翻译的源语言列表
  autoTranslateExcludedSites: []                  // 排除自动翻译的网站列表
}
```

### 配置流程
1. 用户在 options.html 页面填写配置
2. options.js 将配置保存到 chrome.storage.local
3. background.js 和 popup.js 从 chrome.storage.local 读取配置
4. 翻译请求使用配置中的 API 地址和密钥

## 按钮触发流程详解

### 流程 1：点击扩展图标 → 弹出窗口
```
用户点击扩展图标
    ↓
Chrome 打开 popup.html
    ↓
popup.js 执行 DOMContentLoaded
    ↓
popup.js 初始化：
  - 调用 getSettings() 从 storage 读取配置
  - 发送 getLanguages 消息到 background.js
  - 发送 getSelectedText 消息到 content.js 获取选中文本
    ↓
显示弹出窗口，自动填充选中的文本
```

### 流程 2：Popup 翻译按钮 → 文本翻译
```
用户在 popup.html 点击"翻译"按钮 (#translateBtn)
    ↓
popup.js translateText() 函数执行
    ↓
发送 chrome.runtime.sendMessage({ action: 'translate', data: {...} })
    ↓
background.js 监听消息，调用 handleTranslation()
    ↓
handleTranslation() 使用 FormData 发送 POST 请求到 API
    ↓
API 返回翻译结果
    ↓
background.js 发送响应回 popup.js
    ↓
popup.js 将结果显示在 #resultArea
```

### 流程 3：Popup 翻译整个页面按钮 → 整页翻译
```
用户在 popup.html 点击"翻译整个页面"按钮 (#translatePageBtn)
    ↓
popup.js translateEntirePage() 函数执行
    ↓
获取当前标签页 ID
    ↓
发送 chrome.tabs.sendMessage(tabId, { action: 'translatePage', data: {...} })
    ↓
content.js 监听消息，调用 translateEntirePage()
    ↓
translateEntirePage() 执行：
  1. collectTextNodes() - 收集所有文本节点
  2. groupTextNodesIntoBatches() - 分组为批次
  3. showProgress() - 显示进度条
  4. 并发翻译每个批次（translateBatch）
  5. 更新进度条（updateProgress）
  6. hideProgress() - 隐藏进度条
  7. showNotification() - 显示完成通知
```

### 流程 4：右键菜单 → 翻译选中文本
```
用户在网页上选中文本，右键点击"翻译选中文本"
    ↓
background.js chrome.contextMenus.onClicked 监听器触发
    ↓
发送 chrome.tabs.sendMessage(tabId, { action: 'translateSelection', ...})
    ↓
content.js 监听消息，调用 translateSelection()
    ↓
translateSelection() 发送 translate 消息到 background.js
    ↓
background.js 调用 handleTranslation() 获取翻译结果
    ↓
content.js 收到结果，调用 showTranslationPopup()
    ↓
在页面上显示翻译结果弹窗
```

### 流程 5：页面加载 → 自动翻译
```
页面加载完成
    ↓
Chrome 触发 tabs.onUpdated 事件（status === 'complete'）
    ↓
background.js 监听器执行
    ↓
从 storage 读取 autoTranslate 设置
    ↓
检查是否在排除列表（autoTranslateExcludedSites）
    ↓
如果启用且未排除，发送 autoTranslateCheck 消息
    ↓
content.js 调用 checkAutoTranslate()
    ↓
发送翻译请求检测页面语言
    ↓
如果检测到的语言在自动翻译语言列表中
    ↓
调用 translateEntirePage() 执行整页翻译
```

### 流程 6：设置页面 → 保存配置
```
用户在 options.html 填写配置
    ↓
点击"保存设置"按钮 (#saveBtn)
    ↓
options.js saveSettings() 函数执行
    ↓
chrome.storage.local.set({ apiUrl, apiKey, defaultSource, ... })
    ↓
配置保存到浏览器本地存储
    ↓
显示"设置保存成功"通知
```

## 文件间通信关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome 浏览器                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    消息通信    ┌─────────────┐                 │
│  │  popup.js   │◄──────────────►│ background.js│                 │
│  │ (弹出窗口)   │                │  (后台服务)  │                 │
│  └─────────────┘                └─────────────┘                 │
│         ▲                              │                          │
│         │                              │                          │
│         │  chrome.tabs.sendMessage     │  chrome.runtime.sendMessage
│         │                              │                          │
│         ▼                              ▼                          │
│  ┌─────────────┐                ┌─────────────┐                 │
│  │ content.js  │◄──────────────►│  API 服务器  │                 │
│  │ (内容脚本)   │   HTTP 请求     │ (LibreTranslate)│              │
│  └─────────────┘                └─────────────┘                 │
│         │                                                         │
│         ▼                                                         │
│  ┌─────────────┐                                                 │
│  │  网页 DOM    │                                                 │
│  └─────────────┘                                                 │
│                                                                 │
│  ┌─────────────┐    用户操作    ┌─────────────┐                 │
│  │ options.js  │◄──────────────►│  用户界面   │                 │
│  │ (设置页面)   │                │             │                 │
│  └─────────────┘                └─────────────┘                 │
│         │                                                         │
│         ▼                                                         │
│  ┌─────────────┐                                                 │
│  │chrome.storage│                                                │
│  │   (本地存储) │                                                │
│  └─────────────┘                                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 消息类型汇总

| 消息类型 (action) | 发送方 | 接收方 | 说明 |
|------------------|--------|--------|------|
| `translate` | popup.js, content.js | background.js | 请求翻译文本 |
| `getLanguages` | popup.js | background.js | 获取支持的语言列表 |
| `getSettings` | popup.js | background.js | 获取用户设置 |
| `translatePage` | popup.js | content.js | 翻译整个页面 |
| `translateSelection` | background.js | content.js | 翻译选中文本 |
| `restoreOriginalPage` | popup.js, background.js | content.js | 还原页面 |
| `autoTranslateCheck` | background.js | content.js | 自动翻译检查 |
| `getSelectedText` | popup.js | content.js | 获取选中文本 |

## 安装方法

1. 打开 Chrome 浏览器，进入扩展管理页面 (`chrome://extensions/`)
2. 开启右上角的"开发者模式"
3. 点击左上角的"加载已解压的扩展程序"
4. 选择本项目文件夹
5. 插件安装完成，会出现在扩展栏中

## 配置说明

### 首次配置

1. 点击扩展图标，选择右上角的设置按钮（⚙️），或者右键扩展图标选择"选项"
2. 在"API 地址"中填入你的 LibreTranslate 服务地址（例如：`https://libretranslate.de`）
3. 如果你的服务需要 API 密钥，在"API 密钥"中填入
4. 选择默认的源语言和目标语言
5. 点击"保存设置"，然后点击"测试连接"验证配置是否正确

### 公共 LibreTranslate 服务

你可以使用以下公共的 LibreTranslate 服务，或者自己部署：
- https://libretranslate.de
- https://translate.argosopentech.com
- https://translate.mentality.rip

## 使用方法

### 1. 文本翻译
- 选中文本后点击扩展图标，会自动翻译选中的文本
- 或者在弹出窗口中手动输入要翻译的文本，点击"翻译"按钮
- 翻译结果会显示在窗口中，点击"复制结果"可以复制翻译内容

### 2. 整页翻译
- 打开要翻译的网页
- 点击扩展图标，选择要翻译的源语言和目标语言
- 点击"翻译整个页面"按钮，等待翻译完成

### 3. 语言交换
- 点击语言选择框中间的交换按钮（⇄）可以快速交换源语言和目标语言

### 4. 快捷键操作
插件支持自定义快捷键，默认快捷键如下：
- **Ctrl+Shift+X** (Mac: Cmd+Shift+X)：打开弹出窗口
- **Ctrl+Shift+T** (Mac: Cmd+Shift+T)：快捷键 1（默认：翻译选中文本到中文）
- **Ctrl+Shift+Y** (Mac: Cmd+Shift+Y)：快捷键 2（默认：翻译整页到中文）

#### 自定义快捷键功能
在设置页面可以配置每个快捷键的功能：
1. 打开设置页面，找到"快捷键 1"和"快捷键 2"配置区域
2. 选择每个快捷键触发的功能（翻译选中文本 / 翻译整个页面）
3. 选择翻译的目标语言（中文、英语、日语、韩语、法语、德语、西班牙语、俄语）
4. 点击"保存设置"

#### 自定义快捷键组合
如需修改快捷键的按键组合：
1. 打开 Chrome 扩展管理页面 (`chrome://extensions/shortcuts`)
2. 找到"LibreTranslate 翻译插件"
3. 点击输入框并按下你想要的按键组合

## 技术说明

### API 接口

本插件完全兼容 LibreTranslate API v1.8.3，支持以下接口：
- `GET /languages` - 获取支持的语言列表
- `POST /translate` - 翻译文本
- `GET /health` - 健康检查

### 隐私说明

- 所有翻译请求都发送到你配置的 API 服务器
- 插件不会收集或上传任何个人数据
- API 密钥仅存储在本地浏览器中，不会被发送到第三方服务器

## 自建 LibreTranslate 服务

如果你想部署自己的翻译服务，可以参考 LibreTranslate 官方文档：
https://github.com/LibreTranslate/LibreTranslate

### Docker 部署示例：
```bash
docker run -d -p 5000:5000 libretranslate/libretranslate
```

部署完成后，在插件设置中填写 `http://localhost:5000` 作为 API 地址即可。

## 常见问题

### Q: 翻译失败，提示"连接测试失败"
A: 请检查 API 地址是否正确，确保你的网络可以访问该服务。如果是本地部署的服务，请确认服务已经启动。

### Q: 翻译速度慢怎么办
A: 建议部署自己的 LibreTranslate 服务，或者选择离你地理位置较近的公共服务。

### Q: 整页翻译不完整
A: 某些动态加载的内容可能无法被翻译，刷新页面后重新尝试翻译即可。

## 许可证

本项目采用 MIT 许可证开源。
