// 背景服务 Worker
chrome.runtime.onInstalled.addListener(() => {
  // 初始化默认配置
  chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'autoTranslateExcludedSites'], (result) => {
    const defaults = {
      apiUrl: 'https://libretranslate.com/translate',
      apiKey: '',
      defaultSource: 'auto',
      defaultTarget: 'zh-Hans',
      autoTranslate: false,
      autoTranslateLanguages: ['en'],
      autoTranslateExcludedSites: []
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
    console.log('[自动翻译] 页面加载完成:', tab.url);
    const settings = await getSettings();
    console.log('[自动翻译] 当前设置:', settings);
    
    if (settings.autoTranslate) {
      // 检查是否在排除网站列表中
      const excludedSites = settings.autoTranslateExcludedSites || [];
      const isExcluded = excludedSites.some(site => tab.url.includes(site));
      
      console.log('[自动翻译] 是否在排除列表:', isExcluded);
      
      if (!isExcluded) {
        // 延迟一点发送消息，确保内容脚本已准备好
        setTimeout(() => {
          console.log('[自动翻译] 发送自动翻译检查消息');
          chrome.tabs.sendMessage(tabId, {
            action: 'autoTranslateCheck',
            data: settings
          }).catch((err) => {
            console.warn('[自动翻译] 发送消息失败:', err.message);
          });
        }, 300);
      }
    } else {
      console.log('[自动翻译] 自动翻译未启用');
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
      
    case 'detectLanguage':
      detectLanguage(request.data)
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'getLanguages':
      getSupportedLanguages()
        .then(languages => sendResponse({ success: true, data: languages }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;
      
    case 'getSettings':
      chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'autoTranslateExcludedSites'], (result) => {
        sendResponse({ success: true, data: result });
      });
      return true;
  }
});

// 翻译处理函数 - 支持 HTML 和 text 格式
async function handleTranslation({ q, source, target, format = 'text' }) {
  const settings = await getSettings();
  
  if (!settings.apiUrl) {
    throw new Error('请先配置翻译 API 地址');
  }

  // 使用 FormData 发送翻译请求
  const formData = new FormData();
  formData.append('q', q);
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
      signal: AbortSignal.timeout(30000)  // 30 秒超时（增加以减少超时错误）
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `翻译请求失败：${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    throw new Error(`翻译失败：${error.message}`);
  }
}

// 语言检测函数 - 使用专门的 /detect 端点
async function detectLanguage({ q }) {
  const settings = await getSettings();
  
  if (!settings.apiUrl) {
    throw new Error('请先配置翻译 API 地址');
  }

  // 使用 FormData 发送检测请求
  const formData = new FormData();
  formData.append('q', q);
  
  if (settings.apiKey) {
    formData.append('api_key', settings.apiKey);
  }

  try {
    const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/detect`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(10000)  // 10 秒超时
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || `语言检测失败：${response.status}`);
    }

    const result = await response.json();
    // 返回置信度最高的语言
    if (Array.isArray(result) && result.length > 0) {
      return { detectedLanguage: result[0] };
    }
    return { detectedLanguage: result };
  } catch (error) {
    throw new Error(`语言检测失败：${error.message}`);
  }
}

// 备用语言列表（当 API 不可用时使用）
const FALLBACK_LANGUAGES = [
  { code: "zh-Hans", name: "中文（简体）" },
  { code: "zh-Hant", name: "中文（繁体）" },
  { code: "ar", name: "阿拉伯语" },
  { code: "az", name: "阿塞拜疆语" },
  { code: "bg", name: "保加利亚语" },
  { code: "bn", name: "孟加拉语" },
  { code: "ca", name: "加泰罗尼亚语" },
  { code: "cs", name: "捷克语" },
  { code: "da", name: "丹麦语" },
  { code: "de", name: "德语" },
  { code: "el", name: "希腊语" },
  { code: "en", name: "英语" },
  { code: "eo", name: "世界语" },
  { code: "es", name: "西班牙语" },
  { code: "et", name: "爱沙尼亚语" },
  { code: "eu", name: "巴斯克语" },
  { code: "fa", name: "波斯语" },
  { code: "fi", name: "芬兰语" },
  { code: "fr", name: "法语" },
  { code: "ga", name: "爱尔兰语" },
  { code: "gl", name: "加利西亚语" },
  { code: "he", name: "希伯来语" },
  { code: "hi", name: "印地语" },
  { code: "hu", name: "匈牙利语" },
  { code: "id", name: "印度尼西亚语" },
  { code: "it", name: "意大利语" },
  { code: "ja", name: "日语" },
  { code: "ko", name: "韩语" },
  { code: "ky", name: "吉尔吉斯语" },
  { code: "lt", name: "立陶宛语" },
  { code: "lv", name: "拉脱维亚语" },
  { code: "ms", name: "马来语" },
  { code: "nb", name: "挪威语" },
  { code: "nl", name: "荷兰语" },
  { code: "pl", name: "波兰语" },
  { code: "pt-BR", name: "葡萄牙语（巴西）" },
  { code: "pt", name: "葡萄牙语" },
  { code: "ro", name: "罗马尼亚语" },
  { code: "ru", name: "俄语" },
  { code: "sk", name: "斯洛伐克语" },
  { code: "sl", name: "斯洛文尼亚语" },
  { code: "sq", name: "阿尔巴尼亚语" },
  { code: "sr", name: "塞尔维亚语" },
  { code: "sv", name: "瑞典语" },
  { code: "th", name: "泰语" },
  { code: "tl", name: "他加禄语" },
  { code: "tr", name: "土耳其语" },
  { code: "uk", name: "乌克兰语" },
  { code: "ur", name: "乌尔都语" },
  { code: "vi", name: "越南语" }
];

// 获取支持的语言列表
async function getSupportedLanguages() {
  const settings = await getSettings();
  
  if (!settings.apiUrl) {
    // 没有 API 地址时返回备用语言列表
    return FALLBACK_LANGUAGES;
  }

  try {
    const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/languages`, {
      signal: AbortSignal.timeout(10000) // 10 秒超时
    });
    
    if (!response.ok) {
      // API 请求失败时返回备用语言列表
      console.warn('API 语言列表获取失败，使用备用语言列表');
      return FALLBACK_LANGUAGES;
    }

    const languages = await response.json();
    return languages;
  } catch (error) {
    // 发生错误时返回备用语言列表
    console.warn('获取语言列表失败:', error.message, '使用备用语言列表');
    return FALLBACK_LANGUAGES;
  }
}


// 获取存储的设置
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'autoTranslateExcludedSites'], resolve);
  });
}
