$(function() {
    // --- 1. Стили интеграции виджета ---
    $('<style>').html(`
        .od-ai-widget-container { box-shadow: 0 12px 28px -4px rgba(0, 0, 0, 0.22), 0 8px 10px -6px rgba(0, 0, 0, 0.12); }
    `).appendTo('head');

    // --- 2. Глобальные переменные ---
    console.log('AI Widget Integration: Starting initialization');
    const CASE_URL = document.location.href;
    console.log('AI Widget Integration: Current URL', CASE_URL);
    
    // Попытка извлечь ID из URL
    let extractedCaseId = '';
    const matchCaseId = CASE_URL.match(/(?:cases|record)s?\/.*?([0-9-]+)(?:[/?#]|$)/i) || CASE_URL.match(/\/([0-9-]+)(?:[/?#][^/]*)?$/);
    if (matchCaseId) {
        extractedCaseId = matchCaseId[1];
        console.log('AI Widget Integration: Extracted Case ID from URL', extractedCaseId);
    } else {
        console.log('AI Widget Integration: Could not extract Case ID from URL');
    }
    
    const CASE_ID = (typeof CurrentCaseId !== 'undefined' && CurrentCaseId) ? CurrentCaseId : extractedCaseId;
    console.log('AI Widget Integration: Final CASE_ID used', CASE_ID);
    const USER_ID = typeof CurrentUserId !== 'undefined' ? CurrentUserId : '';
    const CurrentCaseNumber = CASE_ID;

    // --- 8. AI Виджет (Подключение) ---
    // Создаем контейнер для виджета с возможностью перетаскивания и ресайза
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.bottom = '20px';
    container.style.left = '20px';
    container.style.width = '380px';
    container.style.height = '84px'; // Starts collapsed
    container.style.zIndex = '999999';
    container.style.borderRadius = '16px';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.backgroundColor = 'transparent';
    container.style.boxShadow = '0 12px 28px -4px rgba(0, 0, 0, 0.22), 0 8px 10px -6px rgba(0, 0, 0, 0.12)';
    container.style.overflow = 'hidden';
    container.style.transition = 'height 0.2s cubic-bezier(0.16, 1, 0.3, 1), width 0.2s cubic-bezier(0.16, 1, 0.3, 1)';

    const iframe = document.createElement('iframe');
    
    // URL приложения и секретный ключ виджета
    const currentScriptOrigin = (document.currentScript && document.currentScript.src) ? new URL(document.currentScript.src).origin : "";
    const widgetBaseUrl = (typeof window.OMNI_WIDGET_URL !== "undefined") ? window.OMNI_WIDGET_URL : (currentScriptOrigin || window.location.origin);
    const WIDGET_SECRET = (typeof window.OMNI_WIDGET_SECRET !== "undefined") ? window.OMNI_WIDGET_SECRET : "";
    const STAFF_EMAIL = (typeof CurrentUserEmail !== "undefined" && CurrentUserEmail) ? CurrentUserEmail : "";
    iframe.src = `${widgetBaseUrl}/?mode=widget&case_number=${CASE_ID}&ws=${encodeURIComponent(WIDGET_SECRET)}${STAFF_EMAIL ? `&staff_email=${encodeURIComponent(STAFF_EMAIL)}` : ''}`;
    console.log('AI Widget Integration: Setting iframe src to', iframe.src);

    iframe.onload = function() {
        try {
            iframe.contentWindow.postMessage({
                type: 'OMNIDESK_INIT',
                secret: WIDGET_SECRET,
                staffEmail: STAFF_EMAIL,
                caseId: CASE_ID,
                caseNumber: CASE_ID
            }, '*');
        } catch (e) {
            console.warn('AI Widget Integration: postMessage init error', e);
        }
    };
    
    // Настраиваем стили iframe
    iframe.style.flex = '1';
    iframe.style.width = '100%';
    iframe.style.border = 'none';
    iframe.style.backgroundColor = 'transparent';
    iframe.style.borderRadius = '16px';
    iframe.style.overflow = 'hidden';
    iframe.style.display = 'block';
    
    // Элемент для ресайза
    const resizer = document.createElement('div');
    resizer.style.position = 'absolute';
    resizer.style.width = '20px';
    resizer.style.height = '20px';
    resizer.style.right = '4px';
    resizer.style.bottom = '4px';
    resizer.style.cursor = 'nwse-resize';
    resizer.style.zIndex = '10';
    resizer.style.display = 'none'; // Скрыто в свернутом виде
    // Иконка уголка
    resizer.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 100%; height: 100%; opacity: 0.5; color: #94a3b8;"><path d="M21 15L15 21M21 8L8 21"/></svg>';

    container.appendChild(iframe);
    container.appendChild(resizer);

    // Переменные состояния для виджета
    let isDragging = false;
    let isResizing = false;
    let startX, startY;
    let startLeft, startTop;
    let startWidth, startHeight;
    let lastWidth = 380;
    let lastHeight = 600; // для восстановления после сворачивания
    
    // Оверлей для перехвата мыши поверх всех iframes
    const dragOverlay = document.createElement('div');
    dragOverlay.style.position = 'fixed';
    dragOverlay.style.top = '0';
    dragOverlay.style.left = '0';
    dragOverlay.style.width = '100vw';
    dragOverlay.style.height = '100vh';
    dragOverlay.style.zIndex = '99999999';
    dragOverlay.style.display = 'none';
    dragOverlay.style.background = 'transparent';

    // --- ЛОГИКА ПЕРЕТАСКИВАНИЯ ---
    let hasMoved = false;

    function drag(e) {
      if (isDragging) {
        e.preventDefault();
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          hasMoved = true;
        }
        container.style.left = (startLeft + dx) + 'px';
        container.style.top = (startTop + dy) + 'px';
      }
    }

    function dragEnd() {
      if (isDragging) {
        isDragging = false;
        iframe.style.pointerEvents = 'auto'; 
        dragOverlay.style.display = 'none';
        document.removeEventListener('mousemove', drag);
        document.removeEventListener('mouseup', dragEnd);
        
        console.log('AI Widget Integration: Drag finished', { hasMoved });
        
        // Notify the iframe that drag is finished and whether it was a small click
        iframe.contentWindow.postMessage({
          type: 'OMNIDESK_DRAG_END',
          wasClick: !hasMoved
        }, '*');
      }
    }

    // --- ЛОГИКА МАСШТАБИРОВАНИЯ ---
    resizer.addEventListener('mousedown', function(e) {
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = container.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      
      // Переводим в left/top чтобы ресайз не конфликтовал с bottom/right
      switchToLeftTop(rect);
      
      iframe.style.pointerEvents = 'none';
      dragOverlay.style.display = 'block';
      dragOverlay.style.cursor = 'nwse-resize';
      
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', stopResize);
      e.preventDefault();
      e.stopPropagation();
    });

    function resize(e) {
      if (isResizing) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newWidth = Math.max(300, startWidth + dx); // минимальная ширина
        const newHeight = Math.max(200, startHeight + dy); // минимальная высота
        container.style.width = newWidth + 'px';
        container.style.height = newHeight + 'px';
        lastWidth = newWidth;
        lastHeight = newHeight;
      }
    }

    function stopResize(e) {
      isResizing = false;
      iframe.style.pointerEvents = 'auto';
      dragOverlay.style.display = 'none';
      dragOverlay.style.cursor = 'default';
      document.removeEventListener('mousemove', resize);
      document.removeEventListener('mouseup', stopResize);
    }

    function switchToLeftTop(rect) {
      if (!container.style.left || container.style.left === 'auto' || container.style.left === '') {
        container.style.left = rect.left + 'px';
        container.style.top = rect.top + 'px';
        container.style.bottom = 'auto';
        container.style.right = 'auto';
        container.style.transform = 'none';
      }
    }

    
    // Безопасное добавление виджета (дожидаемся появления body)
    function injectWidget() {
      if (document.body) {
        document.body.appendChild(container);
        document.body.appendChild(dragOverlay);
        console.log('AI Widget Integration: Widget container injected into body');
      } else {
        setTimeout(injectWidget, 100);
      }
    }

    if (document.readyState === 'loading' || !document.body) {
      document.addEventListener('DOMContentLoaded', injectWidget);
    } else {
      injectWidget();
    }

    // 3. Обрабатываем событие вставки текста от виджета (защита от дублирования листенеров)
    if (!window.__omniai_listener_registered) {
      window.__omniai_listener_registered = true;
      window.addEventListener('message', function(event) {
        // SECURITY: only trust messages that actually came from our own
        // widget iframe. Without this check, ANY iframe or script running
        // on the same Omnidesk page (e.g. another embedded widget, an ad,
        // or a malicious injection) could send OMNIDESK_INJECT_RESPONSE and
        // have this script write arbitrary HTML into the live case editor.
        if (event.source !== iframe.contentWindow) {
          return;
        }

        if (event.data && typeof event.data.type === 'string' && event.data.type.startsWith('OMNIDESK_')) {
          console.log('AI Widget Integration: Received message', event.data);
        }

        if (event.data && (event.data.type === 'OMNIDESK_REQUEST_AUTH' || event.data.type === 'OMNIDESK_GET_CONFIG')) {
          try {
            iframe.contentWindow.postMessage({
              type: 'OMNIDESK_PROVIDE_AUTH',
              secret: WIDGET_SECRET,
              staffEmail: STAFF_EMAIL
            }, '*');
          } catch (e) {}
        }

        if (event.data && event.data.type === 'OMNIDESK_DRAG_START') {
          isDragging = true;
          hasMoved = false;
          const rect = container.getBoundingClientRect();
          switchToLeftTop(rect);
          
          startX = event.data.clientX + rect.left;
          startY = event.data.clientY + rect.top;
          startLeft = rect.left;
          startTop = rect.top;
          
          iframe.style.pointerEvents = 'none'; // Prevent iframe from stealing mouse events during drag
          dragOverlay.style.display = 'block';
          dragOverlay.style.cursor = 'move';
          
          document.addEventListener('mousemove', drag);
          document.addEventListener('mouseup', dragEnd);
          
          console.log('AI Widget Integration: Drag initiated', { startX, startY, startLeft, startTop });
        }

        if (event.data && event.data.type === 'OMNIDESK_RESIZE_WIDGET') {
          if (event.data.isCollapsed) {
            container.style.height = '84px';
            resizer.style.display = 'none';
          } else {
            container.style.height = lastHeight + 'px';
            resizer.style.display = 'block';

            try {
              const rect = container.getBoundingClientRect();
              if (rect.right > window.innerWidth) {
                container.style.left = Math.max(10, window.innerWidth - (parseFloat(container.style.width) || lastWidth) - 20) + 'px';
              }
              if (rect.bottom > window.innerHeight) {
                container.style.top = Math.max(10, window.innerHeight - lastHeight - 20) + 'px';
              }
            } catch (e) {}
          }
        if (event.data && event.data.type === 'OMNIDESK_INJECT_RESPONSE') {
          const draftText = event.data.content;
          const target = event.data.target || 'message'; // 'message' or 'note'
          const messageId = event.data.messageId || (draftText.substring(0, 20) + '_' + target);
          
          // --- PREVENT DUPLICATES ---
          if (!window.__omniai_processed_messages) {
            window.__omniai_processed_messages = {};
          }
          const now = Date.now();
          if (window.__omniai_processed_messages[messageId] && (now - window.__omniai_processed_messages[messageId]) < 2000) {
            console.log('AI Widget Integration: Duplicate injection event ignored for messageId:', messageId);
            return;
          }
          window.__omniai_processed_messages[messageId] = now;
          
          console.log('AI Widget Integration: Initiating stateful injection into target:', target, 'ID:', messageId);
          
          // Helper to detect if content is empty or merely an Omnidesk placeholder/stub
          function isPlaceholderOrEmpty(htmlOrText, targetType) {
            if (!htmlOrText) return true;
            if (typeof htmlOrText !== 'string') return true;

            // Strip invisible characters, zero-width spaces, non-breaking spaces
            const clean = htmlOrText
              .replace(/[\uFEFF\u200B\u200C\u200D\u00A0\r\n\t]/g, '')
              .trim();
            if (!clean) return true;

            // Strip HTML tags and entities
            const textOnly = clean
              .replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/gi, '')
              .replace(/&#160;/gi, '')
              .trim();
            if (!textOnly) return true;

            // If the HTML only contained placeholder tags, e.g. <span class="...placeholder...">...</span>
            const withoutPlaceholderEl = clean
              .replace(/<(span|div|p)[^>]*class="[^"]*(?:placeholder|redactor-placeholder|omni_placeholder|note_placeholder)[^"]*"[^>]*>.*?<\/\1>/gi, '')
              .replace(/<[^>]*>/g, '')
              .replace(/&nbsp;/gi, '')
              .trim();
            if (!withoutPlaceholderEl) return true;

            const lower = textOnly.toLowerCase();

            // Known Russian & English Omnidesk placeholder and stub phrases
            if (targetType === 'note') {
              if (
                /(?:добав(?:ьте|ить)|напи(?:шите|сать)|введите|внутренн(?:яя|юю)|текст|созда(?:йте|ть))?\s*заметк/i.test(lower) ||
                /^(?:заметка|примечание|комментарий|подсказка|placeholder|note|internal\s*note)\.?$/i.test(lower) ||
                /(?:упомян(?:ите|уть)|коллег|через\s*@)/i.test(lower) ||
                /(?:add|type|write|enter)\s*(?:a\s*)?(?:internal\s*)?note/i.test(lower) ||
                lower === '@' || lower === 'заметка' || lower === 'добавить заметку'
              ) {
                return true;
              }
            }

            if (targetType === 'message') {
              if (
                /(?:напи(?:шите|сать)|введите|текст)?\s*ответ/i.test(lower) ||
                /^(?:ответ|сообщение|reply|message)\.?$/i.test(lower) ||
                /(?:type|write|enter)\s*(?:a\s*)?(?:reply|message|response)/i.test(lower)
              ) {
                return true;
              }
            }

            if (
              lower === 'type something...' ||
              lower === 'начните писать...' ||
              lower === 'введите текст...' ||
              lower === 'placeholder' ||
              lower.length <= 2
            ) {
              return true;
            }

            return false;
          }

          // Helper to remove any placeholder elements from the editor or its parent block
          function clearPlaceholderElements(container) {
            if (!container) return;
            const sel = [
              '.redactor-placeholder',
              '.redactor_placeholder',
              '.placeholder',
              '[class*="placeholder"]',
              '[data-placeholder]',
              '.note_placeholder',
              '.case-note-placeholder',
              '.chat_msg_placeholder',
              '.omni_placeholder',
              'span[id*="placeholder"]',
              'div[id*="placeholder"]'
            ].join(', ');
            
            try {
              const els = container.querySelectorAll(sel);
              els.forEach(el => {
                if (el.getAttribute('contenteditable') === 'true' || el.tagName === 'TEXTAREA') {
                  el.removeAttribute('data-placeholder');
                  el.removeAttribute('placeholder');
                } else {
                  try {
                    el.remove();
                  } catch (e) {
                    el.style.display = 'none';
                    el.innerText = '';
                  }
                }
              });
            } catch (e) {}
          }

          // Helper to insert text into standard textareas and dispatch event notifications
          function insertTextIntoTextarea(textarea, text, forceOverwrite) {
            textarea.focus();
            const val = textarea.value || '';
            const shouldOverwrite = Boolean(forceOverwrite) || isPlaceholderOrEmpty(val, target);

            if (shouldOverwrite) {
              textarea.value = '';
              try {
                textarea.select();
              } catch (e) {}
            }

            let inserted = false;
            try {
              if (document.queryCommandSupported('insertText')) {
                inserted = document.execCommand('insertText', false, text);
              }
            } catch (e) {}
            
            if (!inserted) {
              if (shouldOverwrite) {
                textarea.value = text;
                textarea.selectionStart = textarea.selectionEnd = text.length;
              } else {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                if (typeof start === 'number' && typeof end === 'number') {
                  textarea.value = val.substring(0, start) + text + val.substring(end);
                  textarea.selectionStart = textarea.selectionEnd = start + text.length;
                } else {
                  textarea.value = (val ? val + '\n\n' : '') + text;
                }
              }
            }
            
            // Dispatch native and jQuery events to ensure Omnidesk binds update correctly
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Space', keyCode: 32 }));
            textarea.dispatchEvent(new Event('blur', { bubbles: true }));
            
            try {
              const $el = window.jQuery ? window.jQuery(textarea) : null;
              if ($el) {
                $el.trigger('input');
                $el.trigger('change');
                $el.trigger('keyup');
              }
            } catch (e) {}
          }
          
          // Determine if we are operating in the Chat (TG, Messenger, LiveChat) or traditional Ticket interface
          const isChatPage = document.querySelector('.chat_chat_msg_win_wrap, .chat_chat_structure, #comment, textarea.chat_msg_win_box, textarea[name="comment"]') !== null;
          
          let hasInjected = false;
          let modeSwitchClicked = false;
          let injectionAttempts = 0;
          const maxAttempts = 15; // 1.5 seconds maximum waiting time
          
          // SECURITY: draftText originates from the AI widget's chat reply
          // (ultimately from the Gemini response, which can itself be
          // influenced by ticket/KB content an attacker controls - classic
          // prompt injection). Everywhere below that inserts HTML (as
          // opposed to setting a plain textarea .value) must escape it
          // first, otherwise a reply containing e.g. "<img src=x onerror=..>"
          // would execute inside the live Omnidesk case editor.
          const escapeHtml = (str) => String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

          function runStatefulInjectionLoop() {
            if (hasInjected) return;
            injectionAttempts++;

            if (isChatPage) {
              console.log('AI Widget: Processing Chat interface injection, attempt', injectionAttempts);
              
              // 1. Handle mode switching (Message vs Note)
              const noteInput = document.getElementById('b_response_note');
              const noteButton = document.querySelector('.chat_btn_connect_c, li.chat_btn_connect_c, li[title*="заметку"], li[title*="Заметку"]');
              
              let modeMatches = true;
              if (noteButton) {
                const isNoteActive = noteButton.classList.contains('active') || (noteInput && noteInput.value === '1');
                if (target === 'note' && !isNoteActive) {
                  if (!modeSwitchClicked) {
                    console.log('AI Widget: Chat currently in reply mode, switching to Note');
                    noteButton.click();
                    modeSwitchClicked = true;
                  }
                  modeMatches = false;
                } else if (target === 'message' && isNoteActive) {
                  if (!modeSwitchClicked) {
                    console.log('AI Widget: Chat currently in note mode, switching to Reply');
                    noteButton.click();
                    modeSwitchClicked = true;
                  }
                  modeMatches = false;
                }
              }
              
              // If mode was just switched, wait for the DOM to update before injection
              if (!modeMatches && injectionAttempts < 6) {
                setTimeout(runStatefulInjectionLoop, 100);
                return;
              }
              
              // NOTE: `document.getElementById('comment')` (the old lookup)
              // always returns the FIRST '#comment' in DOM order. Omnidesk
              // keeps closed/archived chat panels (e.g. `.chat_chat_msg_win_wrap.archived`)
              // in the DOM instead of removing them, each with their own
              // #comment/name="comment" textarea - if one of those precedes
              // the currently active conversation in the DOM, the old code
              // silently wrote the draft into an invisible, archived
              // panel's textarea instead of the visible one, which is
              // exactly why replies to Telegram/chat tickets appeared to
              // "not insert at all". We now scan every match and use the
              // first one that's actually visible and editable.
              const isVisibleEditable = (el) => {
                if (!el || el.disabled || el.readOnly) return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.height > 0;
              };

              // Omnidesk chat uses Redactor: textarea#comment is display:none,
              // the actual editor is div.redactor-layer[contenteditable="true"]
              // inside .chat_msg_win_box_wrap. When in note mode, the wrapper
              // has class "bg-add-note".
              const chatWrapSelector = target === 'note'
                ? '.chat_msg_win_box_wrap.bg-add-note'
                : '.chat_msg_win_box_wrap:not(.bg-add-note)';
              
              // Try to find the Redactor contenteditable div first
              let chatRedactor = null;
              const chatWrap = document.querySelector(chatWrapSelector);
              if (chatWrap) {
                chatRedactor = chatWrap.querySelector('.redactor-layer, .js_omni_redactor_container, div[contenteditable="true"]');
              }
              // Fallback: find any visible Redactor editor in chat context
              if (!chatRedactor) {
                chatRedactor = Array.from(document.querySelectorAll('.chat_msg_win_box_wrap .redactor-layer, .chat_msg_win_box_wrap .js_omni_redactor_container, .chat_msg_win_box_wrap div[contenteditable="true"]')).find(isVisibleEditable) || null;
              }

              if (chatRedactor) {
                const block = chatRedactor.closest('.redactor-box, .chat_msg_win_box_wrap') || document;
                // Use Redactor API if available, otherwise direct innerHTML
                const formattedText = escapeHtml(draftText)
                  .split(/\n{2,}/)
                  .map(function (para) { return '<p>' + para.replace(/\n/g, '<br>') + '</p>'; })
                  .join('');
                
                let redactorSuccess = false;
                try {
                  if (window.jQuery) {
                    const $textarea = window.jQuery(block).find('textarea');
                    let $redactor = null;
                    if ($textarea.length && typeof $textarea.redactor === 'function') {
                      $redactor = $textarea;
                    } else if (typeof window.jQuery(chatRedactor).redactor === 'function') {
                      $redactor = window.jQuery(chatRedactor);
                    }
                    if ($redactor) {
                      try { $redactor.redactor('placeholder.remove'); } catch (e) {}
                      try { $redactor.redactor('placeholder.hide'); } catch (e) {}

                      const current = $redactor.redactor('code.get') || '';
                      const shouldOverwrite = target === 'note' || isPlaceholderOrEmpty(current, target);
                      if (shouldOverwrite) {
                        $redactor.redactor('code.set', formattedText);
                      } else {
                        $redactor.redactor('insert.html', formattedText);
                      }
                      redactorSuccess = true;
                      hasInjected = true;
                      console.log('AI Widget: Injected text into Chat Redactor via API (overwrite=' + shouldOverwrite + ')');
                    }
                  }
                } catch (e) {
                  console.warn('AI Widget: Chat Redactor API error', e);
                }
                
                if (!redactorSuccess) {
                  const currentHTML = chatRedactor.innerHTML.trim();
                  const shouldOverwrite = target === 'note' || isPlaceholderOrEmpty(currentHTML, target);
                  if (shouldOverwrite) {
                    chatRedactor.innerHTML = formattedText;
                  } else {
                    chatRedactor.insertAdjacentHTML('beforeend', formattedText);
                  }
                  hasInjected = true;
                  console.log('AI Widget: Injected text into Chat Redactor via innerHTML (overwrite=' + shouldOverwrite + ')');
                }

                // Clean up any remaining placeholder DOM elements
                clearPlaceholderElements(chatRedactor);
                clearPlaceholderElements(block);

                // Dispatch events to update UI and hide any CSS/JS placeholders
                try {
                  chatRedactor.focus();
                  chatRedactor.dispatchEvent(new Event('focus', { bubbles: true }));
                  chatRedactor.dispatchEvent(new Event('input', { bubbles: true }));
                  chatRedactor.dispatchEvent(new Event('change', { bubbles: true }));
                  chatRedactor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Space', keyCode: 32 }));
                } catch (e) {}

                setTimeout(function() {
                  clearPlaceholderElements(chatRedactor);
                  clearPlaceholderElements(block);
                }, 150);
              } else {
                // Fallback: try hidden textarea directly (some older Omnidesk versions)
                const chatTextarea = Array.from(document.querySelectorAll('#comment, textarea.chat_msg_win_box, textarea[name="comment"]')).find(el => {
                  // Accept even hidden textareas as last resort in chat
                  return el && !el.disabled;
                }) || null;
                if (chatTextarea) {
                  insertTextIntoTextarea(chatTextarea, draftText, target === 'note');
                  hasInjected = true;
                  console.log('AI Widget: Injected text into Chat textarea (fallback)');
                } else if (injectionAttempts < maxAttempts) {
                  setTimeout(runStatefulInjectionLoop, 100);
                } else {
                  console.error('AI Widget: Chat editor was not found after maximum attempts');
                }
              }

            } else {
              // EMAIL/TICKET INTERFACE (with tabs and Redactor editors)
              console.log('AI Widget: Processing Ticket/Email interface injection, attempt', injectionAttempts);
              
              const noteForm = document.querySelector('#case_note_form, .note-block, .note_form_block, .js-note-form, .case-note-editor-holder, .note-form, #note-form, [data-form-type="note"], .case_note_area');
              const replyForm = document.querySelector('#case_reply_form, .reply-block, .reply_form_block, .js-reply-form, .case-reply-editor-holder, #response_answer_area, .request-answer-area');
              
              const targetForm = target === 'note' ? noteForm : replyForm;
              let isTargetFormVisible = false;
              if (targetForm) {
                const rect = targetForm.getBoundingClientRect();
                isTargetFormVisible = rect.width > 0 && rect.height > 0;
              }
              
              // If the correct tab is not currently visible, click to open it and wait
              if (!isTargetFormVisible) {
                if (!modeSwitchClicked) {
                  let tabElement = null;
                  if (target === 'note') {
                    tabElement = document.querySelector('.js-note-tab, #add_note, #note-tab, [data-tab="note"], [data-type="note"], [data-pane="note"]');
                    if (!tabElement) {
                      tabElement = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
                        const text = el.textContent.trim().toLowerCase();
                        return text === 'заметка' || text === 'добавить заметку' || text === 'внутренняя заметка' || text === 'создать заметку' || text === 'примечание';
                      });
                    }
                  } else {
                    tabElement = document.querySelector('.js-reply-tab, #add_message, #reply-tab, [data-tab="reply"], [data-type="message"], [data-pane="reply"]');
                    if (!tabElement) {
                      tabElement = Array.from(document.querySelectorAll('a, button, span, div, li')).find(el => {
                        const text = el.textContent.trim().toLowerCase();
                        return text === 'ответ' || text === 'написать ответ' || text === 'сообщение' || text === 'ответить';
                      });
                    }
                  }
                  
                  if (tabElement) {
                    console.log('AI Widget: Switching ticket tabs to expose target container');
                    tabElement.click();
                    modeSwitchClicked = true;
                  }
                }
                
                // Allow some time for the tab container to materialize/render before looking for the editor
                if (injectionAttempts < 8) {
                  setTimeout(runStatefulInjectionLoop, 100);
                  return;
                }
              }
              
              // Target editor components within our active form container
              let editorDiv = null;
              let textarea = null;
              
              if (targetForm) {
                editorDiv = targetForm.querySelector('.redactor-editor, .redactor_editor, .redactor-layer, .js_omni_redactor_container, div[contenteditable="true"]');
                if (!editorDiv) textarea = targetForm.querySelector('textarea');
              }
              
              // Fallback selectors if targetForm is still undefined
              if (!editorDiv && !textarea) {
                const fallbackSels = target === 'note' 
                  ? ['textarea[name="note"]', 'textarea#note_content', '#add_note_form textarea', 'textarea[name="internal_note"]', '#note_text', '.note-form textarea', '#internal_note_text', '.case_note_area textarea']
                  : ['textarea[name="content"]', 'textarea#reply_content', '#reply_content', '.js_omni_redactor_container', '#response_html', 'textarea[name="response"]'];
                for (const sel of fallbackSels) {
                  const el = document.querySelector(sel);
                  if (el) {
                    if (el.tagName === 'TEXTAREA') {
                      textarea = el;
                    } else {
                      editorDiv = el;
                    }
                    break;
                  }
                }
              }
              
              // Inject into contenteditable (Redactor) div
              if (editorDiv) {
                // Wrap paragraphs (blank-line separated) in <p> and keep single
                // line breaks as <br>. Converting every \n to <br> turned the
                // model's \n\n paragraph gaps into <br><br>, which Redactor then
                // re-wrapped into paragraphs - producing extra empty lines.
                const formattedText = escapeHtml(draftText)
                  .split(/\n{2,}/)
                  .map(function (para) { return '<p>' + para.replace(/\n/g, '<br>') + '</p>'; })
                  .join('');
                let redactorSuccess = false;
                
                try {
                  if (window.jQuery) {
                    const block = editorDiv.closest('form, .reply-block, .note-block, .case-reply-editor-holder, .case-note-editor-holder, #response_answer_area, .request-answer-area, .text-area-box') || document;
                    const $textarea = window.jQuery(block).find('textarea');
                    let $redactor = null;
                    
                    if ($textarea.length && typeof $textarea.redactor === 'function') {
                      $redactor = $textarea;
                    } else if (typeof window.jQuery(editorDiv).redactor === 'function') {
                      $redactor = window.jQuery(editorDiv);
                    }
                    
                    if ($redactor) {
                      try { $redactor.redactor('placeholder.remove'); } catch (e) {}
                      try { $redactor.redactor('placeholder.hide'); } catch (e) {}

                      const current = $redactor.redactor('code.get') || '';
                      const shouldOverwrite = target === 'note' || isPlaceholderOrEmpty(current, target);
                      if (shouldOverwrite) {
                        $redactor.redactor('code.set', formattedText);
                      } else {
                        $redactor.redactor('insert.html', formattedText);
                      }
                      redactorSuccess = true;
                      hasInjected = true;
                      console.log('AI Widget: Injected reply successfully using Redactor API (overwrite=' + shouldOverwrite + ')');
                    }
                  }
                } catch (e) {
                  console.warn('AI Widget: Redactor API insertion error', e);
                }
                
                if (!redactorSuccess) {
                  const currentHTML = editorDiv.innerHTML.trim();
                  const shouldOverwrite = target === 'note' || isPlaceholderOrEmpty(currentHTML, target);
                  
                  if (shouldOverwrite) {
                    editorDiv.innerHTML = formattedText;
                  } else {
                    editorDiv.insertAdjacentHTML('beforeend', formattedText);
                  }

                  hasInjected = true;
                  console.log('AI Widget: Injected reply successfully into contenteditable (redactor) fallback (overwrite=' + shouldOverwrite + ')');
                }
                
                // Clean up any remaining placeholder DOM elements
                const ticketBlock = editorDiv.closest('form, .reply-block, .note-block, .case-reply-editor-holder, .case-note-editor-holder, #response_answer_area, .request-answer-area, .text-area-box') || document;
                clearPlaceholderElements(editorDiv);
                clearPlaceholderElements(ticketBlock);

                // Dispatch events to ensure Redactor/Omnidesk state and UI update
                try {
                  editorDiv.focus();
                  editorDiv.dispatchEvent(new Event('focus', { bubbles: true }));
                  editorDiv.dispatchEvent(new Event('input', { bubbles: true }));
                  editorDiv.dispatchEvent(new Event('change', { bubbles: true }));
                  editorDiv.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Space', keyCode: 32 }));
                  editorDiv.dispatchEvent(new Event('blur', { bubbles: true }));
                } catch (e) {}

                setTimeout(function() {
                  clearPlaceholderElements(editorDiv);
                  clearPlaceholderElements(ticketBlock);
                }, 150);

                // Keep the underlying textarea content synced - but ONLY
                // when we wrote directly into editorDiv.innerHTML above
                // (the !redactorSuccess fallback). When the Redactor API
                // path succeeded, Redactor already keeps its own linked
                // textarea in sync internally; manually overwriting the
                // textarea's value here AND dispatching a synthetic
                // 'change' event on top of that caused Redactor/Omnidesk's
                // own change handling to insert the draft a second time.
                if (!redactorSuccess) {
                  try {
                    const block = editorDiv.closest('form, .reply-block, .note-block') || document;
                    const rawTextarea = block.querySelector('textarea');
                    if (rawTextarea && rawTextarea.value !== editorDiv.innerHTML) {
                      rawTextarea.value = editorDiv.innerHTML;
                      rawTextarea.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                  } catch (e) {}
                }

              } else if (textarea) {
                insertTextIntoTextarea(textarea, draftText, target === 'note');
                hasInjected = true;
                console.log('AI Widget: Injected reply successfully into email raw textarea');
              } else {
                if (injectionAttempts < maxAttempts) {
                  setTimeout(runStatefulInjectionLoop, 100);
                } else {
                  // Final global visible editor fallback
                  console.warn('AI Widget: Target container editor not found. Attempting visible editor fallback.');
                  const visibleEditor = Array.from(document.querySelectorAll('.redactor-editor, .redactor_editor, .redactor-layer, .js_omni_redactor_container, div[contenteditable="true"]')).find(el => {
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                  });
                  if (visibleEditor) {
                    const shouldOverwrite = target === 'note' || isPlaceholderOrEmpty(visibleEditor.innerHTML, target);
                    if (shouldOverwrite) {
                      visibleEditor.innerHTML = '';
                      clearPlaceholderElements(visibleEditor);
                    }
                    const p = document.createElement('p');
                    p.innerText = draftText;
                    visibleEditor.appendChild(p);
                    visibleEditor.dispatchEvent(new Event('input', { bubbles: true }));
                    visibleEditor.dispatchEvent(new Event('change', { bubbles: true }));
                    hasInjected = true;
                    console.log('AI Widget: Fallback visible editor injection complete');
                  } else {
                    // Last resort: find any visible, editable textarea on the page
                    const visibleTextarea = Array.from(document.querySelectorAll('textarea')).find(el => {
                      if (el.disabled || el.readOnly || el.type === 'hidden') return false;
                      const r = el.getBoundingClientRect();
                      return r.width > 0 && r.height > 0;
                    });
                    if (visibleTextarea) {
                      insertTextIntoTextarea(visibleTextarea, draftText, target === 'note');
                      hasInjected = true;
                      console.log('AI Widget: Fallback visible textarea injection complete');
                    } else {
                      console.error('AI Widget: No valid editors or textareas found to inject response');
                    }
                  }
                }
              }
            }
          }
          
          runStatefulInjectionLoop();
        }
      });
    }
});
