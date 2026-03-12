// 内容脚本 - 注入到网页中
let originalTexts = new Map(); // 存储原始文本，用于回退
let isTranslating = false;
let currentTranslationTarget = 'zh-Hans';
let translationObserver = null;

// 翻译配置
const TRANSLATION_CONFIG = {
  maxCharsPerBatch: 4000,      // 每批次最大字符数
  maxNodesPerBatch: 30,        // 每批次最大节点数
  concurrency: 4,              // 并发翻译批次数
  retryTimes: 2,                // 失败重试次数
  retryDelay: 1000              // 重试延迟（毫秒）
};

// 进度条元素
let progressOverlay = null;
let translationProgress = { total: 0, completed: 0, failed: 0 };

// 并发控制器类
class ConcurrencyController {
  constructor(maxConcurrency = 4) {
    this.maxConcurrency = maxConcurrency;
    this.running = 0;
    this.queue = [];
  }

  async run(task) {
    while (this.running >= this.maxConcurrency) {
      await new Promise(resolve => {
        this.queue.push(resolve);
      });
    }

    this.running++;
    
    try {
      return await task();
    } finally {
      this.running--;
      if (this.queue.length > 0) {
        const resolve = this.queue.shift();
        resolve();
      }
    }
  }
}

// 排除文本检查
function isExcludedText(text) {
  // 排除纯数字
  if (/^\d+([,.]\d+)*$/.test(text)) return true;
  // 排除纯符号
  if (/^[^\w\s\u4e00-\u9fff]+$/.test(text)) return true;
  // 排除过短文本
  if (text.length < 2) return true;
  return false;
}

// 收集所有可翻译的文本节点
function collectTextNodes(root = document.body) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        
        // 排除的标签
        const excludedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME',
                             'OBJECT', 'EMBED', 'INPUT', 'TEXTAREA',
                             'SELECT', 'CODE', 'PRE', 'CANVAS', 'SVG',
                             'NOSCRIPT', 'META', 'LINK', 'STYLE'];
        
        const tagName = parent.tagName.toUpperCase();
        if (excludedTags.includes(tagName)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 排除隐藏元素
        if (parent.hidden || parent.style.display === 'none' || 
            parent.style.visibility === 'hidden' || 
            parent.offsetParent === null) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 排除可编辑元素
        if (parent.isContentEditable) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 排除空白文本
        const text = node.textContent.trim();
        if (!text || isExcludedText(text)) {
          return NodeFilter.FILTER_REJECT;
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let node;
  while (node = walker.nextNode()) {
    // 保存原始文本
    if (!originalTexts.has(node)) {
      originalTexts.set(node, node.textContent);
    }
    textNodes.push(node);
  }

  return textNodes;
}

// 将文本节点分组为批次
function groupTextNodesIntoBatches(textNodes, config) {
  const batches = [];
  let currentBatch = [];
  let currentChars = 0;

  for (const node of textNodes) {
    const text = node.textContent.trim();
    const textLength = text.length;
    
    // 如果单个文本过长，单独成批次
    if (textLength > config.maxCharsPerBatch) {
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }
      batches.push([node]);
      continue;
    }

    // 检查添加后是否超过限制
    if (currentChars + textLength > config.maxCharsPerBatch || 
        currentBatch.length >= config.maxNodesPerBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }

    currentBatch.push(node);
    currentChars += textLength;
  }

  // 添加最后一个批次
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

// 显示进度条
function showProgress(total) {
  if (progressOverlay) {
    progressOverlay.remove();
  }

  translationProgress = { total, completed: 0, failed: 0 };

  progressOverlay = document.createElement('div');
  progressOverlay.id = 'translation-progress';
  
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  progressOverlay.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: ${isDarkMode ? '#1e1e1e' : 'white'};
    border: 1px solid ${isDarkMode ? '#3e3e3e' : '#ddd'};
    border-radius: 12px;
    padding: 24px 32px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    z-index: 2147483647;
    min-width: 300px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  progressOverlay.innerHTML = `
    <div style="text-align: center; color: ${isDarkMode ? '#fff' : '#333'};">
      <div id="progress-title" style="font-size: 16px; margin-bottom: 12px;">
        正在翻译...
      </div>
      <div style="position: relative; height: 8px; background: ${isDarkMode ? '#3e3e3e' : '#e0e0e0'}; border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
        <div id="progress-bar" style="position: absolute; left: 0; top: 0; height: 100%; width: 0%; background: #4285f4; transition: width 0.3s ease;"></div>
      </div>
      <div id="progress-text" style="font-size: 14px; color: ${isDarkMode ? '#aaa' : '#666'};">
        0 / ${total} (0%)
      </div>
    </div>
  `;

  document.body.appendChild(progressOverlay);
}

// 更新进度条
function updateProgress() {
  if (!progressOverlay) return;

  const percentage = Math.round((translationProgress.completed / translationProgress.total) * 100);
  
  const progressBar = progressOverlay.querySelector('#progress-bar');
  const progressText = progressOverlay.querySelector('#progress-text');
  const progressTitle = progressOverlay.querySelector('#progress-title');

  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
  }
  
  if (progressText) {
    progressText.textContent = `${translationProgress.completed} / ${translationProgress.total} (${percentage}%)`;
  }
  
  if (progressTitle && translationProgress.failed > 0) {
    progressTitle.textContent = `正在翻译... (${translationProgress.failed} 个失败)`;
  }
}

// 隐藏进度条
function hideProgress() {
  if (progressOverlay) {
    progressOverlay.remove();
    progressOverlay = null;
  }
}

// 翻译单个批次
async function translateBatch(batch, source, target, config) {
  let retries = 0;
  let lastError = null;

  while (retries <= config.retryTimes) {
    try {
      const texts = batch.map(node => node.textContent.trim());
      
      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        data: {
          q: texts,
          source,
          target,
          format: 'text'
        }
      });

      if (!response.success) {
        throw new Error(response.error || 'Translation failed');
      }

      let translations = response.data.translatedText || [];
      
      // 处理 API 返回 JSON 字符串的情况
      if (typeof translations === 'string') {
        try {
          translations = JSON.parse(translations);
        } catch (e) {
          // 如果不是 JSON 字符串，转为数组
          translations = [translations];
        }
      }
      
      // 应用翻译结果
      batch.forEach((node, index) => {
        if (translations[index] && document.body.contains(node)) {
          // 保留原始空格
          const originalText = node.textContent;
          const leadingSpace = originalText.match(/^\s*/)[0];
          const trailingSpace = originalText.match(/\s*$/)[0];
          node.textContent = leadingSpace + translations[index] + trailingSpace;
        }
      });

      return { success: true };
    } catch (error) {
      lastError = error;
      retries++;
      
      if (retries <= config.retryTimes) {
        await new Promise(resolve => 
          setTimeout(resolve, config.retryDelay * retries)
        );
      }
    }
  }

  return { 
    success: false, 
    error: lastError?.message || 'Unknown error' 
  };
}

// 页面翻译函数 - 使用纯文本节点翻译
async function translateEntirePage(source = 'auto', target = 'zh-Hans') {
  if (isTranslating) {
    showNotification('正在翻译中，请稍候...');
    return;
  }

  isTranslating = true;
  currentTranslationTarget = target;

  console.log('=== 开始纯文本节点翻译 ===');
  console.log('源语言:', source, '目标语言:', target);

  try {
    // 步骤1：收集所有文本节点
    console.log('=== 步骤1: 收集文本节点 ===');
    const textNodes = collectTextNodes();
    console.log(`找到 ${textNodes.length} 个可翻译文本节点`);

    if (textNodes.length === 0) {
      showNotification('页面中没有可翻译的内容', 'info');
      return;
    }

    // 步骤2：分组
    console.log('=== 步骤2: 分组形成翻译批次 ===');
    const batches = groupTextNodesIntoBatches(textNodes, TRANSLATION_CONFIG);
    console.log(`形成 ${batches.length} 个翻译批次`);

    // 显示进度
    showProgress(batches.length);

    // 步骤3：并发翻译
    console.log('=== 步骤3: 并发翻译批次 ===');
    const controller = new ConcurrencyController(TRANSLATION_CONFIG.concurrency);
    const results = await Promise.all(batches.map((batch, index) =>
      controller.run(async () => {
        const result = await translateBatch(batch, source, target, TRANSLATION_CONFIG);
        
        if (result.success) {
          translationProgress.completed++;
        } else {
          translationProgress.failed++;
        }
        
        updateProgress();
        return result;
      })
    ));

    // 隐藏进度条
    hideProgress();

    // 步骤4：显示完成状态
    console.log('=== 步骤4: 显示完成状态 ===');
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;
    
    if (failedCount > 0) {
      showNotification(
        `翻译完成：成功 ${successCount} 个，失败 ${failedCount} 个批次`,
        failedCount > successCount ? 'warning' : 'info'
      );
    } else {
      showNotification('页面翻译完成！');
    }

    console.log('=== 纯文本节点翻译完成 ===');
  } catch (error) {
    console.error('翻译过程出错:', error);
    showNotification(`翻译失败: ${error.message}`, 'error');
    hideProgress();
  } finally {
    isTranslating = false;
  }
}

// 还原页面到原始状态
function restoreOriginalPage() {
  if (isTranslating) {
    showNotification('正在翻译中，无法还原');
    return;
  }

  if (originalTexts.size === 0) {
    showNotification('没有可还原的内容');
    return;
  }

  try {
    // 保存当前滚动位置
    const scrollY = window.scrollY;
    
    originalTexts.forEach((originalText, node) => {
      if (node && node.parentNode && document.body.contains(node)) {
        // 直接恢复文本节点内容
        node.textContent = originalText;
      }
    });
    
    // 停止动态内容监听
    if (translationObserver) {
      translationObserver.disconnect();
      translationObserver = null;
    }
    
    // 恢复滚动位置
    window.scrollTo(0, scrollY);
    
    showNotification('页面已还原到原始状态');
  } catch (error) {
    console.error('还原失败:', error);
    showNotification(`还原失败: ${error.message}`, 'error');
  }
}

// 监听动态内容变化，翻译新加载的内容
function startDynamicContentObserver() {
  // 如果已有observer，先断开
  if (translationObserver) {
    translationObserver.disconnect();
  }
  
  translationObserver = new MutationObserver((mutations) => {
    // 忽略翻译过程中的变化
    if (isTranslating || originalTexts.size === 0) return;
    
    let hasNewTextContent = false;
    
    mutations.forEach(mutation => {
      if (mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          // 检查是否是文本节点或有文本内容的元素
          if (node.nodeType === Node.TEXT_NODE) {
            if (node.textContent.trim().length >= 2) {
              hasNewTextContent = true;
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const text = node.textContent?.trim();
            if (text && text.length >= 2) {
              hasNewTextContent = true;
            }
          }
        });
      }
    });
    
    if (hasNewTextContent) {
      // 延迟一点翻译，确保内容已完全加载
      setTimeout(() => {
        // 仅提示用户有动态内容，不自动翻译（避免干扰用户）
        console.log('检测到页面有新内容加载');
      }, 500);
    }
  });
  
  // 开始监听body的变化
  try {
    translationObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  } catch (e) {
    console.error('启动动态内容监听失败:', e);
  }
}

// 翻译选中的文本
async function translateSelection(source = 'auto', target = 'zh-Hans') {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  if (!text) {
    showNotification('请先选择要翻译的文本');
    return;
  }

  try {
    showNotification('翻译中...');
    
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
      showTranslationPopup(selection, response.data.translatedText, source, target);
    } else {
      showNotification(`翻译失败: ${response.error}`, 'error');
    }
  } catch (error) {
    showNotification(`翻译失败: ${error.message}`, 'error');
  }
}

// 显示翻译弹窗 - 修复定位和显示问题
function showTranslationPopup(selection, translatedText, source = 'auto', currentTarget = 'zh-Hans') {
  // 移除之前的弹窗
  const oldPopup = document.getElementById('libretranslate-popup');
  if (oldPopup) {
    oldPopup.remove();
  }

  // 获取选区信息
  let rect;
  try {
    const range = selection.getRangeAt(0);
    rect = range.getBoundingClientRect();
  } catch (e) {
    console.error('获取选区失败:', e);
    return;
  }

  // 如果选区无效，使用鼠标位置（如果有）
  if (!rect || rect.width === 0 || rect.height === 0) {
    console.warn('选区无效，跳过显示弹窗');
    return;
  }

  const popup = document.createElement('div');
  popup.id = 'libretranslate-popup';
  
  // 计算弹窗位置，确保在视口内 - 使用正确的fixed定位计算
  const popupMaxWidth = 400;
  const popupMaxHeight = 300;
  const margin = 10;
  
  // position: fixed 不需要使用 scrollX/scrollY
  let top = rect.bottom + margin;
  let left = rect.left;
  
  // 调整水平位置，避免超出右边界
  if (left + popupMaxWidth > window.innerWidth) {
    left = Math.max(margin, window.innerWidth - popupMaxWidth - margin);
  }
  
  // 调整垂直位置，如果下方空间不足则显示在选中文本上方
  if (top + popupMaxHeight > window.innerHeight) {
    // 尝试显示在文本上方
    const aboveTop = rect.top - popupMaxHeight - margin;
    if (aboveTop > 0) {
      top = aboveTop;
    } else {
      // 如果上方也不够，显示在视口顶部
      top = margin;
    }
  }
  
  // 确保不超出左边界
  left = Math.max(margin, left);

  // 检查是否为暗色主题
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const bgColor = isDarkMode ? '#1e1e1e' : 'white';
  const textColor = isDarkMode ? '#ffffff' : '#333333';
  const borderColor = isDarkMode ? '#3e3e3e' : '#ddd';
  const btnBgColor = isDarkMode ? '#3e3e3e' : '#f0f0f0';
  const btnTextColor = isDarkMode ? '#ffffff' : '#333333';

  popup.style.cssText = `
    position: fixed;
    top: ${top}px;
    left: ${left}px;
    background: ${bgColor};
    border: 1px solid ${borderColor};
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 2147483647;
    max-width: ${popupMaxWidth}px;
    max-height: ${popupMaxHeight}px;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: ${textColor};
    user-select: text;
  `;

  popup.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <strong style="color: #4285f4;">翻译结果</strong>
      <button id="libretranslate-close" style="background: ${btnBgColor}; border: none; font-size: 16px; cursor: pointer; padding: 0 4px; color: ${btnTextColor}; border-radius: 4px;">×</button>
    </div>
    <div style="white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(translatedText)}</div>
    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid ${borderColor}; display: flex; gap: 8px; flex-wrap: wrap;">
      <button id="libretranslate-copy" style="background: ${btnBgColor}; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer; color: ${btnTextColor};">复制</button>
      <select id="libretranslate-switch-lang" style="background: ${btnBgColor}; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer; color: ${btnTextColor};">
        <option value="">切换语言</option>
        <option value="en">英语</option>
        <option value="zh-Hans">中文（简体）</option>
        <option value="ja">日语</option>
        <option value="ko">韩语</option>
        <option value="fr">法语</option>
        <option value="de">德语</option>
        <option value="es">西班牙语</option>
        <option value="ru">俄语</option>
      </select>
    </div>
  `;

  document.body.appendChild(popup);

  // 关闭按钮
  popup.querySelector('#libretranslate-close').addEventListener('click', () => {
    popup.remove();
  });

  // 复制按钮
  popup.querySelector('#libretranslate-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(translatedText);
      const copyBtn = popup.querySelector('#libretranslate-copy');
      copyBtn.textContent = '已复制';
      setTimeout(() => {
        copyBtn.textContent = '复制';
      }, 2000);
    } catch (error) {
      showNotification('复制失败', 'error');
    }
  });

  // 切换语言功能
  const langSelect = popup.querySelector('#libretranslate-switch-lang');
  const originalText = selection.toString().trim();
  
  langSelect.addEventListener('change', async () => {
    const newTarget = langSelect.value;
    if (!newTarget) return;
    
    try {
      showNotification('翻译中...');
      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        data: {
          q: originalText,
          source,
          target: newTarget,
          format: 'text'
        }
      });

      if (response.success) {
        // 更新翻译结果
        const resultDiv = popup.querySelector('div[style*="white-space: pre-wrap"]');
        if (resultDiv) {
          resultDiv.textContent = response.data.translatedText;
        }
        showNotification('翻译完成');
      } else {
        showNotification(`翻译失败: ${response.error}`, 'error');
      }
    } catch (error) {
      showNotification(`翻译失败: ${error.message}`, 'error');
    }
    
    // 重置选择
    langSelect.value = '';
  });

  // 延迟绑定点击外部关闭事件，避免弹窗刚创建就被关闭
  // 使用 setTimeout 确保点击事件不会立即触发
  setTimeout(() => {
    const clickHandler = (e) => {
      if (!popup.contains(e.target)) {
        popup.remove();
        document.removeEventListener('click', clickHandler);
      }
    };
    document.addEventListener('click', clickHandler, { once: true });
  }, 100);
  
  // 添加ESC键关闭功能
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      popup.remove();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler, { once: true });
}

// HTML转义函数，防止XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 显示通知 - 修复z-index和暗色主题
function showNotification(message, type = 'info') {
  // 移除之前的通知
  const oldNotification = document.getElementById('libretranslate-notification');
  if (oldNotification) {
    oldNotification.remove();
  }

  // 检查是否为暗色主题
  const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  const notification = document.createElement('div');
  notification.id = 'libretranslate-notification';
  
  let bgColor, textColor;
  if (isDarkMode) {
    bgColor = type === 'error' ? '#4a1f1f' : type === 'warning' ? '#4a3f1f' : '#1f4a2f';
    textColor = type === 'error' ? '#ff8a8a' : type === 'warning' ? '#ffd54f' : '#8affa8';
  } else {
    bgColor = type === 'error' ? '#fce8e6' : type === 'warning' ? '#fff8e1' : '#e6f4ea';
    textColor = type === 'error' ? '#c5221f' : type === 'warning' ? '#f57c00' : '#137333';
  }
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    color: ${textColor};
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    z-index: 2147483646;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 300px;
    user-select: none;
  `;
  
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 3000);
}

// 合并消息监听器，避免重复注册
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'translatePage':
      translateEntirePage(request.data.source, request.data.target);
      sendResponse({ success: true });
      break;
    case 'translateSelection':
      translateSelection(request.data.source, request.data.target);
      sendResponse({ success: true });
      break;
    case 'restoreOriginalPage':
      restoreOriginalPage();
      sendResponse({ success: true });
      break;
    case 'autoTranslateCheck':
      checkAutoTranslate(request.data);
      sendResponse({ success: true });
      break;
    case 'getSelectedText':
      const selection = window.getSelection();
      const text = selection.toString().trim();
      sendResponse({ success: true, text });
      break;
    default:
      sendResponse({ success: false, error: '未知操作' });
  }
  return true;
});

// 自动翻译检查
async function checkAutoTranslate(settings) {
  if (!settings.autoTranslate || isTranslating) return;

  try {
    // 检测页面语言
    const pageText = document.body.innerText.slice(0, 1000);
    if (!pageText.trim()) return;

    const detectResponse = await chrome.runtime.sendMessage({
      action: 'translate',
      data: {
        q: pageText,
        source: 'auto',
        target: settings.defaultTarget,
        format: 'text'
      }
    });

    if (detectResponse.success && detectResponse.data.detectedLanguage) {
      const detectedLang = detectResponse.data.detectedLanguage.language;
      
      // 检查是否需要自动翻译
      let shouldTranslate = false;
      if (settings.autoTranslateLanguages && settings.autoTranslateLanguages.length > 0) {
        shouldTranslate = settings.autoTranslateLanguages.includes(detectedLang);
      } else {
        shouldTranslate = detectedLang !== settings.defaultTarget;
      }

      if (shouldTranslate) {
        showNotification(`检测到${detectedLang}语言，正在自动翻译...`);
        // 使用检测到的源语言进行翻译，提高翻译准确率
        translateEntirePage(detectedLang, settings.defaultTarget);
      }
    }
  } catch (error) {
    console.error('自动翻译检测失败:', error);
  }
}
