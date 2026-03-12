// 背景服务 Worker
chrome.runtime.onInstalled.addListener(() => {
  // 初始化默认配置
  chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'shortcut1Action', 'shortcut1Target', 'shortcut2Action', 'shortcut2Target', 'autoTranslateExcludedSites'], (result) => {
    const defaults = {
      apiUrl: 'https://libretranslate.de',
      apiKey: '',
      defaultSource: 'auto',
      defaultTarget: 'zh-Hans',
      autoTranslate: false,
      autoTranslateLanguages: ['en'],
      autoTranslateExcludedSites: [],
      // 快捷键 1 默认配置：翻译选中文本
      shortcut1Action: 'translateSelection',
      shortcut1Target: 'zh-Hans',
      // 快捷键 2 默认配置：翻译整页
      shortcut2Action: 'translatePage',
      shortcut2Target: 'zh-Hans'
    };
    
    chrome.storage.local.set({
      ...defaults,
      ...result
    });
  });

  // 创建右键菜单
  chrome.contextMenus.create({
    id: 'translate-selection',
    title: '翻译选中文本',
    contexts: ['selection']
  });

  chrome.contextMenus.create({
    id: 'translate-page',
    title: '翻译全文',
    contexts: ['page']
  });
  
  chrome.contextMenus.create({
    id: 'restore-page',
    title: '还原页面',
    contexts: ['page']
  });
});

// 右键菜单点击事件
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const settings = await getSettings();
  const targetLanguage = settings.defaultTarget || 'zh-Hans';
  
  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    // 向内容脚本发送翻译选中文本的消息
    chrome.tabs.sendMessage(tab.id, {
      action: 'translateSelection',
      data: {
        source: 'auto',
        target: targetLanguage
      }
    });
  } else if (info.menuItemId === 'translate-page') {
    // 向内容脚本发送翻译页面的消息
    chrome.tabs.sendMessage(tab.id, {
      action: 'translatePage',
      data: {
        source: 'auto',
        target: targetLanguage
      }
    });
  } else if (info.menuItemId === 'restore-page') {
    // 向内容脚本发送还原页面的消息
    chrome.tabs.sendMessage(tab.id, {
      action: 'restoreOriginalPage'
    });
  }
});

// 监听标签页更新事件，用于自动翻译
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    const settings = await getSettings();
    if (settings.autoTranslate) {
      // 检查是否在排除网站列表中
      const excludedSites = settings.autoTranslateExcludedSites || [];
      const isExcluded = excludedSites.some(site => tab.url.includes(site));
      
      if (!isExcluded) {
        // 向内容脚本发送自动翻译检查消息
        chrome.tabs.sendMessage(tabId, {
          action: 'autoTranslateCheck',
          data: settings
        }).catch(() => {
          // 内容脚本可能还未加载，忽略错误
        });
      }
    }
  }
});

// 监听来自内容脚本和弹出窗口的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'translate':
      handleTranslation(request.data)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // 保持端口开放以进行异步响应
      
    case 'getLanguages':
      getSupportedLanguages()
        .then(languages => sendResponse({ success: true, data: languages }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'getSettings':
      chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'shortcut1Action', 'shortcut1Target', 'shortcut2Action', 'shortcut2Target', 'autoTranslateExcludedSites'], (result) => {
        sendResponse({ success: true, data: result });
      });
      return true;
  }
});

// 翻译处理函数
async function handleTranslation({ q, source, target, format = 'text' }) {
  const settings = await getSettings();
  
  if (!settings.apiUrl) {
    throw new Error('请先配置翻译API地址');
  }

  const formData = new FormData();
  // 支持数组和字符串两种格式的q参数
  if (Array.isArray(q)) {
    q.forEach(text => formData.append('q', text));
  } else {
    formData.append('q', q);
  }
  formData.append('source', source || settings.defaultSource || 'auto');
  formData.append('target', target || settings.defaultTarget || 'zh-Hans');
  formData.append('format', format);
  
  if (settings.apiKey) {
    formData.append('api_key', settings.apiKey);
  }

  try {
    const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/translate`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(15000) // 15秒超时（分批翻译每批超时时间）
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `翻译请求失败: ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`翻译失败: ${error.message}`);
  }
}

// 获取支持的语言列表
async function getSupportedLanguages() {
  const settings = await getSettings();
  
  if (!settings.apiUrl) {
    throw new Error('请先配置翻译API地址');
  }

  try {
    const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/languages`, {
      signal: AbortSignal.timeout(10000) // 10秒超时
    });
    
    if (!response.ok) {
      throw new Error(`获取语言列表失败: ${response.status}`);
    }

    const languages = await response.json();
    return languages;
  } catch (error) {
    throw new Error(`获取语言列表失败: ${error.message}`);
  }
}


// 获取存储的设置
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'shortcut1Action', 'shortcut1Target', 'shortcut2Action', 'shortcut2Target', 'autoTranslateExcludedSites'], resolve);
  });
}
