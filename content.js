// 内容脚本 - 注入到网页中
let originalTexts = new Map();
let isTranslating = false;
let currentTranslationTarget = 'zh-Hans';
let translationObserver = null;

// 改进的页面翻译函数 - 使用HTML格式一次性翻译整个页面
async function translateEntirePage(source = 'auto', target = 'zh-Hans') {
  if (isTranslating) {
    showNotification('正在翻译中，请稍候...');
    return;
  }

  isTranslating = true;
  currentTranslationTarget = target;
  showNotification('开始翻译页面...');

  console.log('=== 开始页面翻译 (HTML格式) ===');
  console.log('源语言:', source, '目标语言:', target);

  try {
    // 保存页面原始HTML用于还原
    const originalHtml = document.documentElement.outerHTML;
    originalTexts.set(document.documentElement, { text: originalHtml, isFullPage: true });
    
    // 获取整个页面的HTML内容
    const pageHtml = document.documentElement.outerHTML;
    console.log('页面HTML长度:', pageHtml.length);
    
    if (pageHtml.length > 100000) {
      showNotification('页面内容过大，将分批翻译...', 'warning');
    }
    
    // 发送翻译请求 - 使用HTML格式
    const response = await chrome.runtime.sendMessage({
      action: 'translate',
      data: {
        q: pageHtml,
        source,
        target,
        format: 'html'
      }
    });

    if (response.success && response.data && response.data.translatedText) {
      const translatedHtml = response.data.translatedText;
      console.log('翻译结果长度:', translatedHtml.length);
      console.log('翻译结果前200字符:', translatedHtml.substring(0, 200));
      
      // 检查返回的是否是有效的HTML
      if (translatedHtml && translatedHtml.length > 0) {
        try {
          // 使用 DOMParser 解析翻译后的HTML
          const parser = new DOMParser();
          const translatedDoc = parser.parseFromString(translatedHtml, 'text/html');
          
          // 检查解析是否成功
          if (translatedDoc && translatedDoc.body) {
            // 保存原始 body 的引用
            const originalBody = document.body;
            
            // 尝试更新页面标题（如果翻译结果中有标题）
            if (translatedDoc.title && translatedDoc.title !== document.title) {
              document.title = translatedDoc.title;
              console.log('页面标题已更新:', document.title);
            }
            
            // 保存当前滚动位置
            const scrollX = window.scrollX;
            const scrollY = window.scrollY;
            
            // 替换 body 内容
            const newBodyContent = translatedDoc.body.innerHTML;
            originalBody.innerHTML = newBodyContent;
            
            // 恢复滚动位置
            window.scrollTo(scrollX, scrollY);
            
            console.log('=== 页面翻译完成 ===');
            console.log('翻译后 body 内容长度:', newBodyContent.length);
            showNotification('页面翻译完成！');
          } else {
            throw new Error('翻译返回内容解析失败');
          }
        } catch (e) {
          console.error('替换页面内容失败:', e);
          showNotification('翻译结果应用失败: ' + e.message, 'error');
        }
      } else {
        throw new Error('翻译返回内容为空');
      }
    } else {
      const errorMsg = response.error || '翻译失败';
      console.error('翻译API返回错误:', errorMsg);
      showNotification(`翻译失败: ${errorMsg}`, 'error');
    }
  } catch (error) {
    console.error('翻译过程出错:', error);
    showNotification(`翻译失败: ${error.message}`, 'error');
  } finally {
    isTranslating = false;
  }
}

// 还原页面到原始状态 - 改进支持
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
    originalTexts.forEach((data, node) => {
      if (node.parentNode) { // 确保节点仍然存在
        // 支持对象格式 {text, isHTML} 和字符串格式
        const originalText = typeof data === 'object' ? data.text : data;
        node.textContent = originalText;
      }
    });
    originalTexts.clear();
    
    // 停止动态内容监听
    if (translationObserver) {
      translationObserver.disconnect();
      translationObserver = null;
    }
    
    showNotification('页面已还原到原始状态');
  } catch (error) {
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

// 添加右键菜单翻译选项
document.addEventListener('contextmenu', (e) => {
  const selection = window.getSelection();
  if (selection.toString().trim().length > 0) {
    // 这里可以和背景脚本配合添加右键菜单
    // 由于内容脚本不能直接添加右键菜单，这个功能需要在background中实现
  }
});
