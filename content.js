// 内容脚本 - 注入到网页中
let originalTexts = new Map();
let isTranslating = false;

// 监听来自扩展的消息
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
  }
  return true;
});

// 翻译整个页面
async function translateEntirePage(source = 'auto', target = 'zh') {
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
          if (
            parent.tagName === 'SCRIPT' || 
            parent.tagName === 'STYLE' || 
            parent.tagName === 'NOSCRIPT' ||
            parent.tagName === 'IFRAME' ||
            parent.isContentEditable ||
            node.textContent.trim().length < 2 ||
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
          
          batch.forEach((item, index) => {
            if (!originalTexts.has(item.node)) {
              originalTexts.set(item.node, item.text);
            }
            if (translations[index]) {
              item.node.textContent = translations[index];
            }
          });
        }
      } catch (error) {
        console.error('批量翻译失败:', error);
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

// 翻译选中的文本
async function translateSelection(source = 'auto', target = 'zh') {
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
      showTranslationPopup(selection, response.data.translatedText);
    } else {
      showNotification(`翻译失败: ${response.error}`, 'error');
    }
  } catch (error) {
    showNotification(`翻译失败: ${error.message}`, 'error');
  }
}

// 显示翻译弹窗
function showTranslationPopup(selection, translatedText) {
  // 移除之前的弹窗
  const oldPopup = document.getElementById('libretranslate-popup');
  if (oldPopup) {
    oldPopup.remove();
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'libretranslate-popup';
  popup.style.cssText = `
    position: fixed;
    top: ${rect.bottom + window.scrollY + 10}px;
    left: ${rect.left + window.scrollX}px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 999999;
    max-width: 400px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #333;
  `;

  popup.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <strong style="color: #4285f4;">翻译结果</strong>
      <button id="libretranslate-close" style="background: none; border: none; font-size: 16px; cursor: pointer; padding: 0 4px; color: #999;">×</button>
    </div>
    <div style="white-space: pre-wrap; word-wrap: break-word;">${translatedText}</div>
    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee; display: flex; gap: 8px;">
      <button id="libretranslate-copy" style="background: #f0f0f0; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; cursor: pointer;">复制</button>
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
  
  const bgColor = type === 'error' ? '#fce8e6' : '#e6f4ea';
  const textColor = type === 'error' ? '#c5221f' : '#137333';
  
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
  `;
  
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 3000);
}

// 添加右键菜单翻译选项
document.addEventListener('contextmenu', (e) => {
  const selection = window.getSelection();
  if (selection.toString().trim().length > 0) {
    // 这里可以和背景脚本配合添加右键菜单
    // 由于内容脚本不能直接添加右键菜单，这个功能需要在background中实现
  }
});
