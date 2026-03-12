// 弹出窗口逻辑
document.addEventListener('DOMContentLoaded', () => {
  const sourceLangSelect = document.getElementById('sourceLang');
  const targetLangSelect = document.getElementById('targetLang');
  const swapBtn = document.getElementById('swapBtn');
  const sourceTextArea = document.getElementById('sourceText');
  const translateBtn = document.getElementById('translateBtn');
  const resultArea = document.getElementById('resultArea');
  const settingsBtn = document.getElementById('settingsBtn');
  const translatePageBtn = document.getElementById('translatePageBtn');
  const restorePageBtn = document.getElementById('restorePageBtn');
  const copyBtn = document.getElementById('copyBtn');
  const excludeSiteCheckbox = document.getElementById('excludeSite');
  const loadingDiv = document.getElementById('loading');
  const errorDiv = document.getElementById('error');

  let languages = [];

  // 初始化
  init();

  // 初始化函数
  async function init() {
    // 加载设置
    const settings = await getSettings();
    
    // 加载语言列表
    await loadLanguages();
    
    // 设置默认语言
    if (settings.defaultSource) {
      sourceLangSelect.value = settings.defaultSource;
    }
    if (settings.defaultTarget) {
      targetLangSelect.value = settings.defaultTarget;
    }

    // 获取选中文本
    getSelectedText();

    // 初始化排除网站开关状态
    initExcludeSiteSwitch(settings);

    // 绑定事件
    bindEvents();
  }

  // 绑定事件
  function bindEvents() {
    // 翻译按钮点击
    translateBtn.addEventListener('click', translateText);

    // 交换语言按钮
    swapBtn.addEventListener('click', swapLanguages);

    // 设置按钮点击
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });

    // 翻译整个页面按钮
    translatePageBtn.addEventListener('click', translateEntirePage);

    // 还原页面按钮
    restorePageBtn.addEventListener('click', restoreOriginalPage);

    // 复制按钮
    copyBtn.addEventListener('click', copyResult);

    // 排除网站开关
    excludeSiteCheckbox.addEventListener('change', toggleExcludeSite);

    // 回车翻译
    sourceTextArea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        translateText();
      }
    });
  }

  // 加载语言列表
  async function loadLanguages() {
    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getLanguages'
      });

      if (response.success) {
        languages = response.data;
        
        // 清空现有选项（保留auto选项）
        let autoOption = sourceLangSelect.querySelector('option[value="auto"]');
        if (!autoOption) {
          autoOption = document.createElement('option');
          autoOption.value = 'auto';
          autoOption.textContent = '自动检测';
        }
        sourceLangSelect.innerHTML = '';
        sourceLangSelect.appendChild(autoOption);
        
        targetLangSelect.innerHTML = '';
        
        // 添加语言选项
        languages.forEach(lang => {
          const option1 = document.createElement('option');
          option1.value = lang.code;
          option1.textContent = `${lang.name} (${lang.code})`;
          sourceLangSelect.appendChild(option1);
          
          const option2 = document.createElement('option');
          option2.value = lang.code;
          option2.textContent = `${lang.name} (${lang.code})`;
          targetLangSelect.appendChild(option2);
        });
      } else {
        showError(`加载语言列表失败: ${response.error}`);
      }
    } catch (error) {
      showError(`加载语言列表失败: ${error.message}`);
    }
  }

  // 翻译文本
  async function translateText() {
    const text = sourceTextArea.value.trim();
    const source = sourceLangSelect.value;
    const target = targetLangSelect.value;

    if (!text) {
      showError('请输入要翻译的文本');
      return;
    }

    if (source === target) {
      showError('源语言和目标语言不能相同');
      return;
    }

    try {
      showLoading(true);
      hideError();

      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        data: {
          q: text,
          source,
          target,
          format: 'text'
        }
      });

      if (response.success) {
        resultArea.textContent = response.data.translatedText;
      } else {
        showError(`翻译失败: ${response.error}`);
      }
    } catch (error) {
      showError(`翻译失败: ${error.message}`);
    } finally {
      showLoading(false);
    }
  }

  // 交换语言
  function swapLanguages() {
    const sourceVal = sourceLangSelect.value;
    const targetVal = targetLangSelect.value;

    if (sourceVal === 'auto') {
      showError('自动检测不能作为目标语言');
      return;
    }

    sourceLangSelect.value = targetVal;
    targetLangSelect.value = sourceVal;

    // 交换文本内容
    const sourceText = sourceTextArea.value;
    const resultText = resultArea.textContent;
    
    if (resultText) {
      sourceTextArea.value = resultText;
      resultArea.textContent = sourceText;
    }
  }

  // 翻译整个页面
  async function translateEntirePage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 向内容脚本发送翻译页面的消息
      await chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage',
        data: {
          source: sourceLangSelect.value,
          target: targetLangSelect.value
        }
      });

      window.close();
    } catch (error) {
      showError(`页面翻译失败: ${error.message}`);
    }
  }

  // 还原页面到原始状态
  async function restoreOriginalPage() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 向内容脚本发送还原页面的消息
      await chrome.tabs.sendMessage(tab.id, {
        action: 'restoreOriginalPage'
      });

      window.close();
    } catch (error) {
      showError(`页面还原失败: ${error.message}`);
    }
  }

  // 复制结果
  async function copyResult() {
    const text = resultArea.textContent;
    if (!text) {
      showError('没有可复制的内容');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '已复制!';
      setTimeout(() => {
        copyBtn.textContent = '复制结果';
      }, 2000);
    } catch (error) {
      showError('复制失败');
    }
  }

  // 获取当前页面选中的文本
  async function getSelectedText() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 跳过chrome://等特殊页面
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://')) {
        return;
      }
      
      // 先向内容脚本发送消息获取选中文本，不需要额外权限
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getSelectedText'
      }).catch(() => null);
      
      if (response && response.success && response.text) {
        sourceTextArea.value = response.text;
        // 自动翻译（仅当源文本和目标语言不同时）
        setTimeout(() => {
          if (sourceLangSelect.value !== targetLangSelect.value) {
            translateText();
          }
        }, 100);
        return;
      }
      
      // 如果内容脚本没有响应，再尝试使用scripting API
      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString()
      });

      if (result && result[0] && result[0].result) {
        sourceTextArea.value = result[0].result;
        // 自动翻译（仅当源文本和目标语言不同时）
        setTimeout(() => {
          if (sourceLangSelect.value !== targetLangSelect.value) {
            translateText();
          }
        }, 100);
      }
    } catch (error) {
      console.error('获取选中文本失败:', error);
    }
  }

  // 显示错误
  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    setTimeout(() => {
      hideError();
    }, 5000);
  }

  // 隐藏错误
  function hideError() {
    errorDiv.style.display = 'none';
  }

  // 显示/隐藏加载
  function showLoading(show) {
    loadingDiv.style.display = show ? 'block' : 'none';
    translateBtn.disabled = show;
    translatePageBtn.disabled = show;
    restorePageBtn.disabled = show;
    copyBtn.disabled = show;
    excludeSiteCheckbox.disabled = show;
  }

  // 初始化排除网站开关状态
  async function initExcludeSiteSwitch(settings) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab.url);
      const domain = url.hostname;
      
      const excludedSites = settings.autoTranslateExcludedSites || [];
      excludeSiteCheckbox.checked = excludedSites.includes(domain);
    } catch (error) {
      console.error('初始化排除网站开关失败:', error);
    }
  }

  // 切换当前网站排除状态
  async function toggleExcludeSite() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = new URL(tab.url);
      const domain = url.hostname;
      
      const settings = await getSettings();
      let excludedSites = settings.autoTranslateExcludedSites || [];
      
      if (excludeSiteCheckbox.checked) {
        // 添加到排除列表
        if (!excludedSites.includes(domain)) {
          excludedSites.push(domain);
        }
      } else {
        // 从排除列表移除
        excludedSites = excludedSites.filter(site => site !== domain);
      }
      
      // 保存设置
      await chrome.storage.local.set({ autoTranslateExcludedSites: excludedSites });
      
      showError(excludeSiteCheckbox.checked ? '已添加到自动翻译排除列表' : '已从自动翻译排除列表移除');
    } catch (error) {
      console.error('切换排除网站状态失败:', error);
      showError('操作失败: ' + error.message);
    }
  }

  // 获取设置 - 统一的设置获取函数
  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslate', 'autoTranslateLanguages', 'autoTranslateExcludedSites'], resolve);
    });
  }
});
