// 设置页面逻辑
document.addEventListener('DOMContentLoaded', () => {
  const apiUrlInput = document.getElementById('apiUrl');
  const apiKeyInput = document.getElementById('apiKey');
  const defaultSourceSelect = document.getElementById('defaultSource');
  const defaultTargetSelect = document.getElementById('defaultTarget');
  const saveBtn = document.getElementById('saveBtn');
  const testBtn = document.getElementById('testBtn');
  const statusDiv = document.getElementById('status');
  const loadingDiv = document.getElementById('loading');
  const autoTranslateLanguagesInput = document.getElementById('autoTranslateLanguages');
  const autoTranslateExcludedSitesInput = document.getElementById('autoTranslateExcludedSites');

  // 加载已保存的设置
  loadSettings();

  // 保存设置
  saveBtn.addEventListener('click', saveSettings);

  // 测试连接
  testBtn.addEventListener('click', testConnection);

  // 加载设置
  function loadSettings() {
    chrome.storage.local.get(['apiUrl', 'apiKey', 'defaultSource', 'defaultTarget', 'autoTranslateLanguages', 'autoTranslateExcludedSites'], (result) => {
      console.log('[options.js] 加载设置:', result);
      if (result.apiUrl) {
        apiUrlInput.value = result.apiUrl;
        if (result.apiKey) {
          apiKeyInput.value = result.apiKey;
        }
        autoTranslateLanguagesInput.value = result.autoTranslateLanguages ? result.autoTranslateLanguages.join(',') : '';
        autoTranslateExcludedSitesInput.value = result.autoTranslateExcludedSites ? result.autoTranslateExcludedSites.join(',') : '';
        
        console.log('[options.js] 准备加载语言列表，默认源语言:', result.defaultSource, '默认目标语言:', result.defaultTarget);
        // 加载语言列表，并传入已保存的默认值
        loadLanguagesWithDefaults(result.apiUrl, result.apiKey, result.defaultSource, result.defaultTarget);
      } else {
        // 默认值
        apiUrlInput.value = 'https://libretranslate.de';
        loadLanguages('https://libretranslate.de', '');
      }
    });
  }
  
  // 加载语言列表并设置默认值
  function loadLanguagesWithDefaults(apiUrl, apiKey, defaultSource, defaultTarget) {
    try {
      showLoading(true);
      fetch(`${apiUrl.replace(/\/$/, '')}/languages`, {
        signal: AbortSignal.timeout(10000) // 10 秒超时
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(languages => {
        // 清空现有选项
        defaultSourceSelect.innerHTML = '<option value="auto">自动检测</option>';
        defaultTargetSelect.innerHTML = '';
        
        // 添加语言选项
        languages.forEach(lang => {
          const option1 = document.createElement('option');
          option1.value = lang.code;
          option1.textContent = `${lang.name} (${lang.code})`;
          defaultSourceSelect.appendChild(option1);
          
          const option2 = document.createElement('option');
          option2.value = lang.code;
          option2.textContent = `${lang.name} (${lang.code})`;
          defaultTargetSelect.appendChild(option2);
        });
        
        // 使用保存的值设置选中项
        if (defaultSource) {
          defaultSourceSelect.value = defaultSource;
        }
        if (defaultTarget) {
          defaultTargetSelect.value = defaultTarget;
        }
        
        showStatus('语言列表加载成功', 'success');
      })
      .catch(error => {
        showStatus(`加载语言列表失败：${error.message}`, 'error');
      })
      .finally(() => {
        showLoading(false);
      });
    } catch (error) {
      showStatus(`加载语言列表失败：${error.message}`, 'error');
      showLoading(false);
    }
  }

  // 加载语言列表
  async function loadLanguages(apiUrl, apiKey, keepSelection = false) {
    try {
      showLoading(true);
      const response = await fetch(`${apiUrl.replace(/\/$/, '')}/languages`, {
        signal: AbortSignal.timeout(10000) // 10 秒超时
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const languages = await response.json();
      
      // 保存当前选中的值
      const currentSource = keepSelection ? defaultSourceSelect.value : null;
      const currentTarget = keepSelection ? defaultTargetSelect.value : null;
      
      // 清空现有选项
      defaultSourceSelect.innerHTML = '<option value="auto">自动检测</option>';
      defaultTargetSelect.innerHTML = '';
      
      // 添加语言选项
      languages.forEach(lang => {
        const option1 = document.createElement('option');
        option1.value = lang.code;
        option1.textContent = `${lang.name} (${lang.code})`;
        defaultSourceSelect.appendChild(option1);
        
        const option2 = document.createElement('option');
        option2.value = lang.code;
        option2.textContent = `${lang.name} (${lang.code})`;
        defaultTargetSelect.appendChild(option2);
      });

      // 恢复选中的值
      if (keepSelection) {
        if (currentSource) {
          defaultSourceSelect.value = currentSource;
        }
        if (currentTarget) {
          defaultTargetSelect.value = currentTarget;
        }
      }

      showStatus('语言列表加载成功', 'success');
    } catch (error) {
      showStatus(`加载语言列表失败：${error.message}`, 'error');
    } finally {
      showLoading(false);
    }
  }

  // 保存设置
  function saveSettings() {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const defaultSource = defaultSourceSelect.value;
    const defaultTarget = defaultTargetSelect.value;
    const autoTranslateLanguages = autoTranslateLanguagesInput.value
      .split(',')
      .map(lang => lang.trim())
      .filter(lang => lang);
    const autoTranslateExcludedSites = autoTranslateExcludedSitesInput.value
      .split(',')
      .map(site => site.trim())
      .filter(site => site);

    console.log('[options.js] 准备保存设置:', { apiUrl, apiKey, defaultSource, defaultTarget, autoTranslateLanguages, autoTranslateExcludedSites });

    if (!apiUrl) {
      showStatus('请填写 API 地址', 'error');
      return;
    }

    chrome.storage.local.set({
      apiUrl,
      apiKey,
      defaultSource,
      defaultTarget,
      autoTranslateLanguages,
      autoTranslateExcludedSites
    }, () => {
      console.log('[options.js] 设置已保存');
      // 验证保存结果
      chrome.storage.local.get(['defaultSource', 'defaultTarget'], (result) => {
        console.log('[options.js] 验证保存结果:', result);
      });
      
      showStatus('设置保存成功', 'success');
      // 重新加载语言列表，并在加载完成后从 storage 获取最新设置来设置选中值
      loadLanguagesAfterSave(apiUrl, apiKey, defaultSource, defaultTarget);
    });
  }
  
  // 保存设置后重新加载语言列表
  function loadLanguagesAfterSave(apiUrl, apiKey, savedSource, savedTarget) {
    try {
      showLoading(true);
      fetch(`${apiUrl.replace(/\/$/, '')}/languages`, {
        signal: AbortSignal.timeout(10000) // 10 秒超时
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(languages => {
        // 清空现有选项
        defaultSourceSelect.innerHTML = '<option value="auto">自动检测</option>';
        defaultTargetSelect.innerHTML = '';
        
        // 添加语言选项
        languages.forEach(lang => {
          const option1 = document.createElement('option');
          option1.value = lang.code;
          option1.textContent = `${lang.name} (${lang.code})`;
          defaultSourceSelect.appendChild(option1);
          
          const option2 = document.createElement('option');
          option2.value = lang.code;
          option2.textContent = `${lang.name} (${lang.code})`;
          defaultTargetSelect.appendChild(option2);
        });
        
        // 使用保存的值设置选中项
        if (savedSource) {
          defaultSourceSelect.value = savedSource;
        }
        if (savedTarget) {
          defaultTargetSelect.value = savedTarget;
        }
        
        showStatus('语言列表加载成功', 'success');
      })
      .catch(error => {
        showStatus(`加载语言列表失败：${error.message}`, 'error');
      })
      .finally(() => {
        showLoading(false);
      });
    } catch (error) {
      showStatus(`加载语言列表失败：${error.message}`, 'error');
      showLoading(false);
    }
  }

  // 测试连接
  async function testConnection() {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();

    if (!apiUrl) {
      showStatus('请填写 API 地址', 'error');
      return;
    }

    try {
      showLoading(true);
      
      // 测试健康检查接口
      let healthResponse;
      try {
        healthResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/health`, {
          signal: AbortSignal.timeout(5000) // 5 秒超时
        });
        if (healthResponse.ok) {
          const healthData = await healthResponse.json();
          if (healthData.status !== 'ok') {
            console.warn('服务健康状态警告:', healthData);
          }
        }
      } catch (healthError) {
        console.warn('健康检查接口不可用，跳过:', healthError.message);
      }

      // 测试翻译接口
      const formData = new FormData();
      formData.append('q', 'Hello');
      formData.append('source', 'en');
      formData.append('target', 'zh-Hans');
      if (apiKey) {
        formData.append('api_key', apiKey);
      }

      const translateResponse = await fetch(`${apiUrl.replace(/\/$/, '')}/translate`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(10000) // 10 秒超时
      });

      if (!translateResponse.ok) {
        const errorData = await translateResponse.json().catch(() => null);
        throw new Error(errorData?.error || `翻译测试失败：${translateResponse.status}`);
      }

      const translateData = await translateResponse.json();
      showStatus(`连接测试成功！测试翻译结果：${translateData.translatedText}`, 'success');
      
    } catch (error) {
      showStatus(`连接测试失败：${error.message}`, 'error');
    } finally {
      showLoading(false);
    }
  }

  // 显示状态信息
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    // 清除之前可能设置的 display: none 样式
    statusDiv.style.display = 'block';
    
    // 3 秒后自动隐藏成功消息
    if (type === 'success') {
      setTimeout(() => {
        statusDiv.style.display = 'none';
      }, 3000);
    }
  }

  // 显示/隐藏加载状态
  function showLoading(show) {
    loadingDiv.style.display = show ? 'block' : 'none';
    saveBtn.disabled = show;
    testBtn.disabled = show;
  }
});
