/**
 * content_script.js (Исправлено с использованием postMessage)
 */

// TODO(2025-10-26): Баг Yuanbao:
//      - Глубокое размышление может с некоторой вероятностью бесконечно отправлять сообщения
//      - Определение первого сообщения не работает: всегда вставляется полный Prompt, даже если это отключено

let statusPanel = null;
const MESSAGE_SOURCE_INJECTOR = 'mcp-bridge-injector';
const MESSAGE_SOURCE_CONTENT = 'mcp-bridge-content-script';

async function main() {
    // Проверить, входит ли текущий сайт в api_list
    const currentHostname = window.location.hostname;
    const { api_list = [] } = await chrome.storage.local.get('api_list');
    const currentConfig = api_list.find(item => item.hostname === currentHostname);

    if (!currentConfig) {
        // Всё равно слушать сообщения, чтобы обрабатывать связь со скриптом внедрения
        window.addEventListener('message', (event) => {
            if (event.source !== window || !event.data) {
                return;
            }
            
            if (event.data.source === MESSAGE_SOURCE_INJECTOR && event.data.direction === 'to-content-script') {
                handleInjectorMessage(event.data);
                return;
            }
        });
        
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            handleBackgroundMessage(message, sender, sendResponse, null);
            return true;
        });
        
        return; // Не создавать плавающее окно
    }
    
    console.log('[MCP Bridge] Current site is supported, creating panel');
    
    const statusPanelModuleUrl = chrome.runtime.getURL('ui/status_panel.js');
    const { StatusPanel } = await import(statusPanelModuleUrl);

    // Немедленно создать постоянно присутствующую панель
    statusPanel = new StatusPanel();
    statusPanel.create(); // Инициализировать постоянную панель
    
    // Проверить и показать подсказку при загрузке страницы
    await checkAndShowOnLoadTip(api_list, currentHostname);

    addStyleSheet(currentConfig?.uiParsing || {});
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) {
            return;
        }
        
        // Обработать сообщения от скрипта внедрения
        if (event.data.source === MESSAGE_SOURCE_INJECTOR && event.data.direction === 'to-content-script') {
            handleInjectorMessage(event.data);
            return;
        }
        
        // Обработать сообщения от панели плавающего окна
        if (event.data.source === 'mcp-bridge-panel') {
            handlePanelMessage(event.data);
            return;
        }
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        handleBackgroundMessage(message, sender, sendResponse, StatusPanel);
        return true;
    });
}

function addStyleSheet(uiConfig) {
    if (!uiConfig?.senderSelector) return;
    const style = document.createElement('style');
    style.innerHTML = `
${uiConfig.senderSelector} {
    max-height: 300px;
    overflow-y: auto;
}
    `;
    document.head.appendChild(style);
}

function handleInjectorMessage(data) {
    const { type, payload, requestId } = data;

    // Проверить, действителен ли контекст расширения
    if (!chrome.runtime?.id) {

        // Если это сообщение перехвата запроса, сразу вернуть исходное тело
        if (requestId) {
            window.postMessage({
                source: MESSAGE_SOURCE_CONTENT,
                requestId,
                payload: { modifiedBody: payload.body }
            }, '*');
        }
        
        // Для некритичных сообщений (например, блоков ответа) предложить пользователю обновить страницу
        if (type === 'XHR_RESPONSE_CHUNK' || type === 'FETCH_RESPONSE_CHUNK' || type === 'XHR_RESPONSE_COMPLETE') {
            // Проверить, не показывалось ли уже предупреждение (избежать частых предупреждений)
            const lastWarning = sessionStorage.getItem('mcp_context_warning');
            const now = Date.now();
            if (!lastWarning || now - parseInt(lastWarning) > 60000) { // Показывать не чаще раза в минуту
                sessionStorage.setItem('mcp_context_warning', now.toString());
                console.error(
                    '%c[MCP Bridge] Расширение было перезагружено, обновите страницу для восстановления работы',
                    'color: #ff0000; font-size: 14px; font-weight: bold;'
                );
                
                // Показать сообщение об ошибке в плавающем окне
                if (statusPanel) {
                    statusPanel.update({
                        status: 'ERROR',
                        message: 'Расширение было перезагружено, обновите страницу для восстановления работы'
                    });
                }
            }
        }
        
        return;
    }

    try {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('MCP Bridge: Error with background:', chrome.runtime.lastError.message);
                if (requestId) {
                    window.postMessage({
                        source: MESSAGE_SOURCE_CONTENT,
                        requestId,
                        payload: { modifiedBody: payload.body }
                    }, '*');
                }
                return;
            }

            if (response && requestId) {
                window.postMessage({
                    source: MESSAGE_SOURCE_CONTENT,
                    requestId,
                    payload: response.payload
                }, '*');
            }
        });
    } catch (error) {
        console.error('[MCP Bridge Content] Error sending message:', error);
        if (requestId) {
            window.postMessage({
                source: MESSAGE_SOURCE_CONTENT,
                requestId,
                payload: { modifiedBody: payload.body }
            }, '*');
        }
    }
}

function handleBackgroundMessage(message, sender, sendResponse, StatusPanel) {
    const { type, payload } = message;
    switch (type) {
        case 'UPDATE_UI_PANEL':
            if (!statusPanel) {
                statusPanel = new StatusPanel();
                statusPanel.create();
            }
            statusPanel.update(payload);
            sendResponse({ success: true });
            break;
        case 'DESTROY_UI_PANEL':
            if (statusPanel) {
                statusPanel.destroy();
                statusPanel = null;
            }
            sendResponse({ success: true });
            break;
        case 'STORE_API_LIST':
            localStorage.setItem('mcp_api_list', JSON.stringify(payload));
            sendResponse({ success: true });
            break;
        case 'INJECT_TEXT_AND_SUBMIT':
            // Динамически импортировать input_injector и выполнить внедрение
            handleTextInjection(payload);
            sendResponse({ success: true });
            break;
        case 'PARSE_UI_CONTENT':
            // Разобрать DOM страницы для получения последнего сообщения
            const content = parseUIContent(payload.uiConfig);
            sendResponse({ success: true, content });
            break;
        case 'SHOW_CONFLICT_NOTICE':
            checkAndShowConflictNotice(payload.hostname, payload.conflictExtName);
            sendResponse({ success: true });
            break;
        default:
            sendResponse({ success: true });
            break;
    }
    return true; // Держать канал асинхронного ответа открытым
}

/**
 * Разобрать последнее сообщение из DOM страницы (резервный вариант)
 * @param {object} uiConfig - Конфигурация UI-разбора
 * @returns {string} - Разобранное текстовое содержимое
 */
function parseUIContent(uiConfig) {
    if (!uiConfig || !uiConfig.messageContainer) {
        console.warn('[MCP Bridge] parseUIContent: No messageContainer configured');
        return '';
    }

    try {
        // Поддержка одного селектора или массива селекторов
        const containerSelectors = Array.isArray(uiConfig.messageContainer) 
            ? uiConfig.messageContainer 
            : [uiConfig.messageContainer];
        
        // Собрать все совпавшие контейнеры (из всех селекторов)
        const allContainers = [];
        
        for (const selector of containerSelectors) {
            const found = document.querySelectorAll(selector);
            if (found && found.length > 0) {
                allContainers.push(...Array.from(found));
            }
        }
        
        if (allContainers.length === 0) {
            console.warn('[MCP Bridge] parseUIContent: No containers found for selectors:', containerSelectors);
            return '';
        }
        
        // Удалить дубликаты (один и тот же элемент может быть найден несколькими селекторами)
        const uniqueContainers = Array.from(new Set(allContainers));
        
        // Отсортировать в порядке DOM (чтобы получить真正 последнее сообщение)
        uniqueContainers.sort((a, b) => {
            const position = a.compareDocumentPosition(b);
            if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
                return -1; // a перед b
            } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                return 1;  // a после b
            }
            return 0;
        });
        
        console.log('[MCP Bridge] parseUIContent: Found', uniqueContainers.length, 'message containers');

        // Получить контейнер сообщения по указанному индексу (поддержка отрицательных индексов)
        const index = uiConfig.messageIndex ?? -1;
        const targetIndex = index < 0 ? uniqueContainers.length + index : index;
        const messageContainer = uniqueContainers[targetIndex];

        if (!messageContainer) {
            console.warn('[MCP Bridge] parseUIContent: No container at index:', targetIndex);
            return '';
        }

        // Если настроен селектор содержимого, использовать его (также поддерживается массив)
        let contentElement = messageContainer;
        if (uiConfig.contentSelector) {
            const contentSelectors = Array.isArray(uiConfig.contentSelector)
                ? uiConfig.contentSelector
                : [uiConfig.contentSelector];
            
            for (const selector of contentSelectors) {
                if (!selector) continue; // Пропустить пустую строку
                const selected = messageContainer.querySelector(selector);
                if (selected) {
                    contentElement = selected;
                    break;
                }
            }
        }

        // Извлечь текстовое содержимое
        const content = contentElement.innerText || contentElement.textContent || '';
        return content;
    } catch (error) {
        console.error('[MCP Bridge] Failed to parse UI content:', error);
        return '';
    }
}

async function handleTextInjection(payload) {
    try {
        const inputInjectorUrl = chrome.runtime.getURL('modules/input_injector.js');
        const { injectTextAndSubmit } = await import(inputInjectorUrl);
        await injectTextAndSubmit(payload.text, payload.inputConfig);
    } catch (error) {
        console.error('[MCP Bridge] Failed to inject text:', error);
    }
}

/**
 * Обработать сообщения от панели плавающего окна
 */
function handlePanelMessage(data) {
    const { type, payload } = data;

    switch (type) {
        case 'MCP_BRIDGE_REDETECT_FROM_UI':
            // Переслать запрос на повторное обнаружение в background
            chrome.runtime.sendMessage({
                type: 'REDETECT_FROM_UI'
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[MCP Bridge] Failed to send redetect message:', chrome.runtime.lastError);
                    // Уведомить плавающее окно о сбое
                    if (statusPanel) {
                        statusPanel.update({
                            status: 'ERROR',
                            message: 'Повторное обнаружение не удалось: ' + chrome.runtime.lastError.message
                        });
                    }
                } else {
                    console.log('[MCP Bridge] Redetect message sent, response:', response);
                }
            });
            break;
            
        case 'MCP_BRIDGE_MANUAL_TOOL_PARSE':
            // Переслать запрос ручного ввода в background
            chrome.runtime.sendMessage({
                type: 'MANUAL_TOOL_PARSE',
                payload: payload
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('[MCP Bridge] Failed to send manual parse message:', chrome.runtime.lastError);
                    // Уведомить плавающее окно о сбое
                    if (statusPanel) {
                        statusPanel.update({
                            status: 'ERROR',
                            message: 'Отправка не удалась: ' + chrome.runtime.lastError.message
                        });
                    }
                } else if (!response?.success) {
                    console.error('[MCP Bridge] Manual parse failed:', response?.error);
                    if (statusPanel) {
                        statusPanel.update({
                            status: 'ERROR',
                            message: 'Отправка не удалась: ' + (response?.error || 'Неизвестная ошибка')
                        });
                    }
                }
            });
            break;
            
        default:
            console.warn('[MCP Bridge] Unknown panel message type:', type);
    }
}

/**
 * Проверить и показать подсказку при загрузке страницы
 * @param {Array} apiList - Список конфигураций API
 * @param {string} hostname - Доменное имя текущего сайта
 */
async function checkAndShowOnLoadTip(apiList, hostname) {
    try {
        // Найти конфигурацию текущего сайта
        const siteConfig = apiList.find(item => item.hostname === hostname);
        
        // Если onLoadTip не настроен, сразу вернуться
        if (!siteConfig || !siteConfig.onLoadTip) {
            return;
        }
        
        const { onLoadTip } = siteConfig;
        
        // Проверить локальное хранилище: не выбрал ли пользователь "больше не показывать"
        const storageKey = `mcp_bridge_onload_tip_disabled_${hostname}`;
        const isDisabled = localStorage.getItem(storageKey) === 'true';
        
        if (isDisabled) {
            console.log('[MCP Bridge] OnLoad tip disabled for this site');
            return;
        }
        
        // Подождать полной загрузки страницы
        if (document.readyState !== 'complete') {
            await new Promise(resolve => {
                window.addEventListener('load', resolve, { once: true });
            });
        }
        
        // Дополнительная задержка (если настроена)
        const delay = onLoadTip.delay || 500;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Обработать поле message: поддержка строки или массива
        let message = '';
        if (Array.isArray(onLoadTip.message)) {
            // Формат массива: отфильтровать не-строки/не-числа, затем соединить переносами строк
            message = onLoadTip.message
                .filter(item => typeof item === 'string' || typeof item === 'number')
                .map(item => String(item))
                .join('\n');
        } else {
            // Строковый формат (совместимость со старыми версиями)
            message = String(onLoadTip.message || '');
        }
        
        // Если после обработки сообщение пустое — не показывать
        if (!message.trim()) {
            console.warn('[MCP Bridge] OnLoad tip message is empty after processing');
            return;
        }
        
        // Динамически импортировать confirm_dialog
        const confirmDialogUrl = chrome.runtime.getURL('ui/confirm_dialog.js');
        const { ConfirmDialog } = await import(confirmDialogUrl);
        
        const dialog = new ConfirmDialog();
        
        // Показать диалог подсказки
        const result = await dialog.show({
            title: onLoadTip.title || 'MCP Bridge — подсказка',
            message: message,
            confirmText: onLoadTip.confirmText || 'Понятно',
            cancelText: onLoadTip.cancelText || 'Закрыть',
            type: onLoadTip.type || 'default',
            showDontShowAgain: true,
            dontShowAgainText: onLoadTip.dontShowAgainText || 'Больше не показывать'
        });
        
        console.log('[MCP Bridge] OnLoad tip result:', result);
        
        // Если пользователь отметил "больше не показывать"
        if (result && result.dontShowAgain) {
            localStorage.setItem(storageKey, 'true');
            console.log('[MCP Bridge] OnLoad tip disabled by user');
        }
        
        // Уничтожить диалог
        dialog.destroy();
        
    } catch (error) {
        console.error('[MCP Bridge] Error showing onLoad tip:', error);
    }
}

/**
 * Проверить и показать уведомление о конфликте
 * @param {string} hostname - Доменное имя текущего сайта
 * @param {string} conflictExtName - Имя конфликтующего расширения (передаётся из background)
 */
async function checkAndShowConflictNotice(hostname, conflictExtName) {
    try {
        // Проверить, не закрывалось ли уже уведомление
        const closedKey = `mcp_bridge_conflict_notice_closed_${hostname}`;
        if (localStorage.getItem(closedKey) === 'true') {
            return;
        }

        // Внедрить стили
        const styleUrl = chrome.runtime.getURL('ui/conflict_notice.css');
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = styleUrl;
        document.head.appendChild(link);

        // Динамически импортировать и создать уведомление
        const logoUrl = chrome.runtime.getURL('icons/icon-16.png');
        const noticeUrl = chrome.runtime.getURL('ui/conflict_notice.js');
        const { ConflictNotice } = await import(noticeUrl);
        const notice = new ConflictNotice();
        notice.create(conflictExtName || 'Неизвестное расширение', logoUrl);
    } catch (error) {
        console.error('[MCP Bridge] Failed to show conflict notice:', error);
    }
}

// Убедиться, что DOM полностью загружен, прежде чем выполнять
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        main().catch(console.error);
    });
} else {
    // DOM уже загружен
    main().catch(console.error);
}