// 内容脚本 - 注入到网页中
let originalTexts = new Map();
let isTranslating = false;
let currentTranslationTarget = 'zh-Hans';


// 翻译整个页面
async function translateEntirePage(source = 'auto', target = 'zh-Hans') {
  if (isTranslating) {
    showNotification('正在翻译中，请稍候...');
    return;
  }

  isTranslating = true;
  showNotification('开始翻译页面...');

  try {
    // 收集所有文本节点
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // 跳过不需要翻译的元素
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const tagName = parent.tagName.toUpperCase();
          if (
            tagName === 'SCRIPT' ||
            tagName === 'STYLE' ||
            tagName === 'NOSCRIPT' ||
            tagName === 'IFRAME' ||
            tagName === 'INPUT' ||
            tagName === 'TEXTAREA' ||
            tagName === 'BUTTON' ||
            tagName === 'SELECT' ||
            parent.isContentEditable ||
            node.textContent.trim().length < 1 || // 调整为长度小于1才跳过，避免跳过短文本
            /^\d+$/.test(node.textContent.trim()) // 跳过纯数字
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text) {
        textNodes.push({ node, text });
      }
    }

    // 调试信息
    console.log(`找到 ${textNodes.length} 个待翻译文本节点`);
    showNotification(`找到 ${textNodes.length} 个文本节点，开始翻译...`);
    
    if (textNodes.length === 0) {
      showNotification('页面没有可翻译的文本内容', 'warning');
      isTranslating = false;
      return;
    }

    // 批量翻译
    const batchSize = 50;
    for (let i = 0; i < textNodes.length; i += batchSize) {
      const batch = textNodes.slice(i, i + batchSize);
      const texts = batch.map(item => item.text);
      
      try {
        const response = await chrome.runtime.sendMessage({
          action: 'translate',
          data: {
            q: texts,
            source,
            target,
            format: 'html'
          }
        });

        if (response.success) {
          const translations = Array.isArray(response.data.translatedText)
            ? response.data.translatedText
            : [response.data.translatedText];
            
          // 调试信息
          console.log(`翻译批次 ${Math.floor(i/batchSize) + 1}: 收到 ${translations.length} 条翻译结果`);
          
          batch.forEach((item, index) => {
            if (!originalTexts.has(item.node)) {
              originalTexts.set(item.node, item.text);
            }
            if (translations[index]) {
              // 保留原文本的前后空白字符
              const originalNodeText = item.node.textContent;
              const leadingWhitespace = originalNodeText.match(/^\s*/)[0];
              const trailingWhitespace = originalNodeText.match(/\s*$/)[0];
              item.node.textContent = leadingWhitespace + translations[index] + trailingWhitespace;
            }
          });
        }
      } catch (error) {
        console.error('批量翻译失败:', error);
        showNotification(`批量翻译失败: ${error.message}`, 'error');
      }

      // 更新进度
      showNotification(`翻译进度: ${Math.min(((i + batchSize) / textNodes.length) * 100, 100).toFixed(0)}%`);
    }

    showNotification('页面翻译完成！');
  } catch (error) {
    showNotification(`翻译失败: ${error.message}`, 'error');
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
    originalTexts.forEach((originalText, node) => {
      if (node.parentNode) { // 确保节点仍然存在
        node.textContent = originalText;
      }
    });
    originalTexts.clear();
    showNotification('页面已还原到原始状态');
  } catch (error) {
    showNotification(`还原失败: ${error.message}`, 'error');
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

// 显示翻译弹窗
function showTranslationPopup(selection, translatedText, source = 'auto', currentTarget = 'zh-Hans') {
  // 移除之前的弹窗
  const oldPopup = document.getElementById('libretranslate-popup');
  if (oldPopup) {
    oldPopup.remove();
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'libretranslate-popup';
  
  // 计算弹窗位置，确保在视口内
  const popupMaxWidth = 400;
  const popupMaxHeight = 300;
  const margin = 10;
  
  let top = rect.bottom + window.scrollY + margin;
  let left = rect.left + window.scrollX;
  
  // 调整水平位置，避免超出右边界
  if (left + popupMaxWidth > window.innerWidth + window.scrollX) {
    left = Math.max(margin, window.innerWidth + window.scrollX - popupMaxWidth - margin);
  }
  
  // 调整垂直位置，如果下方空间不足则显示在选中文本上方
  if (top + popupMaxHeight > window.innerHeight + window.scrollY) {
    top = Math.max(margin, rect.top + window.scrollY - popupMaxHeight - margin);
  }

  popup.style.cssText = `
    position: fixed;
    top: ${top}px;
    left: ${left}px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    max-width: ${popupMaxWidth}px;
    max-height: ${popupMaxHeight}px;
    overflow-y: auto;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #333;
    user-select: text;
  `;

  // 适配暗色主题
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    popup.style.background = '#1e1e1e';
    popup.style.borderColor = '#3e3e3e';
    popup.style.color = '#fff';
  }

  popup.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <strong style="color: #4285f4;">翻译结果</strong>
      <button id="libretranslate-close" style="background: none; border: none; font-size: 16px; cursor: pointer; padding: 0 4px; color: #999;">×</button>
    </div>
    <div style="white-space: pre-wrap; word-wrap: break-word;">${translatedText}</div>
    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee; display: flex; gap: 8px; flex-wrap: wrap;">
      <button id="libretranslate-copy" style="background: #f0f0f0; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;">复制</button>
      <select id="libretranslate-switch-lang" style="background: #f0f0f0; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;">
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
      alert('复制失败');
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
        resultDiv.textContent = response.data.translatedText;
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

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!popup.contains(e.target)) {
      popup.remove();
    }
  }, { once: true });
}

// 显示通知
function showNotification(message, type = 'info') {
  // 移除之前的通知
  const oldNotification = document.getElementById('libretranslate-notification');
  if (oldNotification) {
    oldNotification.remove();
  }

  const notification = document.createElement('div');
  notification.id = 'libretranslate-notification';
  
  const bgColor = type === 'error' ? '#fce8e6' : type === 'warning' ? '#fff8e1' : '#e6f4ea';
  const textColor = type === 'error' ? '#c5221f' : type === 'warning' ? '#f57c00' : '#137333';
  
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    color: ${textColor};
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    max-width: 300px;
    user-select: none;
  `;

  // 适配暗色主题和警告类型
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    if (type === 'warning') {
      notification.style.background = '#4a3f1f';
      notification.style.color = '#ffd54f';
    }
  }

  // 适配暗色主题
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    notification.style.background = type === 'error' ? '#4a1f1f' : '#1f4a2f';
    notification.style.color = type === 'error' ? '#ff8a8a' : '#8affa8';
  }
  
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

// 添加右键菜单翻译选项
document.addEventListener('contextmenu', (e) => {
  const selection = window.getSelection();
  if (selection.toString().trim().length > 0) {
    // 这里可以和背景脚本配合添加右键菜单
    // 由于内容脚本不能直接添加右键菜单，这个功能需要在background中实现
  }
});
