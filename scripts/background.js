/**
 * background.js (Исправлено с надёжной асинхронной обработкой сообщений)
 */

import * as apiClient from '../modules/api_client.js';
import * as promptBuilder from '../modules/prompt_builder.js';
import {getConfig} from "../modules/api_client.js";
import { detectConflicts } from '../scripts/conflict_detector.js';

// --- События жизненного цикла расширения ---
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install' || details.reason === 'update') {
        try {
            const response = await fetch(chrome.runtime.getURL('config/api_list.json'));
            const apiList = await response.json();
            await chrome.storage.local.set({api_list: apiList});
        } catch (error) {
            console.error('MCP Bridge: Failed to initialize API list:', error);
        }
        await chrome.storage.local.set({mcp_enabled: true, always_inject: {}});
    }
});

// --- Обработка загрузки страницы ---
chrome.webNavigation.onCompleted.addListener(async (details) => {
    if (details.frameId === 0) {
        try {
            const {api_list, conflict_disabled_sites = []} = await chrome.storage.local.get(['api_list', 'conflict_disabled_sites']);
            if (api_list) {
                await chrome.tabs.sendMessage(details.tabId, {type: 'STORE_API_LIST', payload: api_list});
            }
            const hostname = new URL(details.url).hostname;
            // При попадании на AI-сайт запустить проверку конфликтов
            if (api_list?.some(site => site.hostname === hostname)) {
                detectConflicts();
            }
            // Уведомление о конфликтном сайте — получить имя расширения из кэша
            if (conflict_disabled_sites.includes(hostname)) {
                const { conflict_extension_cache } = await chrome.storage.local.get('conflict_extension_cache');
                let conflictExtName = '';
                if (conflict_extension_cache?.data) {
                    for (const ext of conflict_extension_cache.data) {
                        if (ext.affected_sites?.includes(hostname)) {
                            conflictExtName = ext.name;
                            break;
                        }
                    }
                }
                await chrome.tabs.sendMessage(details.tabId, {type: 'SHOW_CONFLICT_NOTICE', payload: {hostname, conflictExtName}});
            }
        } catch (error) { /* игнорировать */
        }
    }
});

// --- Прослушивание и маршрутизация сообщений (+++ ключевое исправление: использовать async и try/catch для гарантии ответа +++) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const {type, payload} = message;

    (async () => {
        try {
            if (sender.tab && sender.tab.id) {
                const tabId = sender.tab.id;
                switch (type) {
                    case 'FETCH_REQUEST_BODY':
                        const fetchResponse = await handleRequestBody(tabId, payload);
                        sendResponse(fetchResponse);
                        return;
                    case 'XHR_REQUEST_BODY':
                        const response = await handleRequestBody(tabId, payload);

                        sendResponse(response);
                        return;
                    case 'FETCH_RESPONSE_CHUNK':
                        await handleResponseChunk(tabId, payload);
                        sendResponse({success: true});
                        return;
                    case 'XHR_RESPONSE_CHUNK':
                        // Обработка промежуточного блока потокового ответа
                        await handleResponseChunk(tabId, payload);
                        sendResponse({success: true});
                        return;
                    case 'FETCH_RESPONSE_COMPLETE':
                        await handleResponseComplete(tabId, payload);
                        sendResponse({success: true});
                        return;
                    case 'XHR_RESPONSE_COMPLETE':
                        await handleResponseComplete(tabId, payload);
                        sendResponse({success: true}); // Даже если нет возвращаемого значения, подтвердить получение
                        return;
                    case 'GET_CONFIG':
                        const config = await apiClient.getConfig();
                        sendResponse(config);
                        return;
                    case 'UPDATE_CONFIG':
                        const updateResult = await apiClient.updateConfig(payload);
                        sendResponse(updateResult);
                        return;
                    case 'REDETECT_FROM_UI':
                        // Повторно определить вызов инструмента из последнего UI-сообщения
                        await handleRedetectFromUI(tabId);
                        sendResponse({ success: true });
                        return;
                    case 'MANUAL_TOOL_PARSE':
                        // Обработать содержимое, вставленное пользователем вручную
                        await handleManualToolParse(tabId, payload.content);
                        sendResponse({ success: true });
                        return;
                }
            } else {
                switch (type) {
                    case 'CHECK_HEALTH':
                        const health = await apiClient.checkHealth();
                        sendResponse(health);
                        return;
                    case 'REFRESH_SYSTEM_PROMPT':
                        const refreshResult = await handleRefreshSystemPrompt(payload.tabId);
                        sendResponse(refreshResult);
                        return;
                    case 'REFRESH_SYSTEM_PROMPT_FROM_PANEL':
                        // Вызвано из панели состояния, нужно получить tabId отправителя
                        if (sender.tab?.id) {
                            const panelRefreshResult = await handleRefreshSystemPrompt(sender.tab.id);
                            sendResponse(panelRefreshResult);
                        } else {
                            sendResponse({ success: false, error: 'No tab ID' });
                        }
                        return;
                }
            }
        } catch (error) {
            console.error(`MCP Bridge: Error handling message type ${type}:`, error);
            // При любой ошибке вернуть информацию об ошибке, чтобы порт не завис
            sendResponse({error: error.message});
        }
    })();

    return true; // Всегда возвращать true, так как мы всегда обрабатываем асинхронно
});

/**
 * Обработать тело запроса, изменив его содержимое перед отправкой на сервер
 * @param {number} tabId - ID вкладки браузера
 * @param {Object} payload - Данные полезной нагрузки запроса
 * @param {string} payload.url - URL запроса
 * @param {string} payload.body - Содержимое тела запроса (JSON-строка)
 * @returns {Promise<Object>} Изменённый объект ответа
 */
async function handleRequestBody(tabId, payload) {
    const {mcp_enabled} = await chrome.storage.local.get('mcp_enabled');
    if (!mcp_enabled) return createResponse(payload.body);

    const state = await getTabState(tabId);
    if (state.status === 'FEEDING_BACK') {
        await setTabState(tabId, {status: 'AWAITING_RESPONSE', toolName: state.toolName});
        return createResponse(JSON.stringify(state.modifiedBody));
    }

    const {api_list, always_inject = {}, disable_first_inject = {}, conflict_disabled_sites = []} = await chrome.storage.local.get(['api_list', 'always_inject', 'disable_first_inject', 'conflict_disabled_sites']);
    const siteConfig = getSiteConfig(payload.url, api_list);
    if (!siteConfig) return createResponse(payload.body);

    // Проверить, нужно ли пропустить модификацию запроса (режим только прослушивания ответа)
    if (siteConfig.skipRequestModification) {
        console.log('[MCP Bridge] Skip request modification, only monitoring response');
        // Даже если пропускаем модификацию запроса, нужно установить состояние ожидания ответа для обнаружения вызова инструмента
        await setTabState(tabId, {status: 'AWAITING_RESPONSE', currentToolCallKey: null, resultInjected: false});
        return createResponse(payload.body);
    }

    const bodyJson = parseJsonSafely(payload.body);
    if (!bodyJson) return createResponse(payload.body);

    const isNewConversation = checkIsNewConversation(bodyJson, siteConfig);
    const shouldAlwaysInject = always_inject[siteConfig.hostname] || false;

    if (!disable_first_inject[siteConfig.hostname] && !conflict_disabled_sites.includes(siteConfig.hostname) && (isNewConversation || shouldAlwaysInject)) {
        await updateUIPanel(tabId, 'EXECUTING', 'Построение и внедрение MCP Prompt...');
        const services = await apiClient.getServices(); // Если тут ошибка — она будет перехвачена внешним try/catch
        const initialPrompt = promptBuilder.buildInitialPrompt(services);
        const reminderPrompt = promptBuilder.buildReminderPrompt();

        // Поддержка одного пути или массива путей
        const promptPaths = Array.isArray(siteConfig.promptPath) ? siteConfig.promptPath : [siteConfig.promptPath];
        
        // Внедрить для каждого пути
        for (const path of promptPaths) {
            // Если настроен promptFilter, обязательно должен быть настроен и promptSetFilter
            if (siteConfig.promptFilter && !siteConfig.promptSetFilter) {
                console.warn('[MCP Bridge] promptFilter is configured but promptSetFilter is missing. Both are required for custom logic.');
            }
            
            const originalPrompt = getByPath(bodyJson, path, siteConfig.isJsonString, siteConfig.promptFilter) || '';
            const finalPrompt = (isNewConversation ? initialPrompt + '\n\n---\n\n' : reminderPrompt + '\n\n---\n\n') + originalPrompt;
            setByPath(bodyJson, path, finalPrompt, siteConfig);
        }

        const modifiedBody = JSON.stringify(bodyJson);
        // Начало нового диалога — очистить предыдущее состояние вызова инструмента
        await setTabState(tabId, {status: 'AWAITING_RESPONSE', currentToolCallKey: null, resultInjected: false});
        return createResponse(modifiedBody);
    }

    // Даже если prompt не внедряется, очистить состояние предыдущего вызова инструмента (новое сообщение пользователя)
    // Исправление: каждое новое сообщение пользователя должно очищать currentToolCallKey, иначе одинаковые вызовы инструментов будут пропускаться при дедупликации
    await setTabState(tabId, {status: 'AWAITING_RESPONSE', currentToolCallKey: null, resultInjected: false});
    return createResponse(payload.body);
}

/**
 * Обработать промежуточный блок потокового ответа (обнаружение вызова инструмента)
 */
async function handleResponseChunk(tabId, payload) {
    if (!payload || typeof payload.fullText !== 'string') return;

    const {mcp_enabled} = await chrome.storage.local.get('mcp_enabled');
    if (!mcp_enabled) return;

    // Проверить наличие полного тега вызова инструмента
    // Высокая отказоустойчивость: начальные и конечные < > необязательны, совместимо со случаями потери символов при разборе SSE
    // Совпадение: <tool_code> или tool_code> или <tool_code или tool_code
    const toolCallMatch = payload.fullText.match(/<?\s*tool_code\s*>?([\s\S]*?)<\s*\/\s*tool_code\s*>/);
    if (!toolCallMatch) return;

    const toolCallJson = parseJsonSafely(toolCallMatch[1]);
    if (!toolCallJson || !toolCallJson.tool_name) return;

    console.log('[MCP Bridge] Tool call detected in stream chunk:', toolCallJson);

    // Проверить, не обработан ли уже этот вызов инструмента (во избежание повторного срабатывания)
    // Использовать содержимое JSON, а не исходную строку, чтобы избежать ложных срабатываний из-за различий в формате
    const state = await getTabState(tabId);
    const toolCallKey = JSON.stringify({ tool_name: toolCallJson.tool_name, arguments: toolCallJson.arguments });
    
    if (state.currentToolCallKey === toolCallKey) {
        console.log('[MCP Bridge] Tool call already processed, skipping');
        return;
    }
    
    // Проверить, был ли уже отправлен результат (защита от повторного внедрения)
    if (state.resultInjected) {
        console.log('[MCP Bridge] Result already injected, skipping');
        return;
    }

    // Записать текущий вызов инструмента, чтобы избежать повторной обработки
    await setTabState(tabId, { ...state, currentToolCallKey: toolCallKey });

    const {tool_name, arguments: args} = toolCallJson;
    if (tool_name === 'list_tools_in_service') {
        await handleListTools(tabId, args.service_name);
    } else {
        await handleExecuteTool(tabId, tool_name, args);
    }
}

async function handleResponseComplete(tabId, payload) {
    if (!payload || typeof payload.fullText !== 'string') {
        const state = await getTabState(tabId);
        if (state.status === 'AWAITING_RESPONSE') {
            await destroyUIPanel(tabId);
            await clearTabState(tabId);
        }
        return;
    }

    const {mcp_enabled, api_list} = await chrome.storage.local.get(['mcp_enabled', 'api_list']);
    if (!mcp_enabled) return;

    let fullText = payload.fullText;
    const siteConfig = getSiteConfig(payload.url, api_list);
    
    // Если настроен UI-разбор, в зависимости от приоритета решить, использовать ли DOM-разбор
    if (siteConfig?.uiParsing?.enabled && siteConfig.uiParsing.messageContainer) {
        const uiPriority = siteConfig.uiParsing.priority || 'api';
        let shouldTryUI = false;
        let shouldReplaceText = false;
        
        if (uiPriority === 'ui') {
            // UI в приоритете: сразу использовать UI-разбор, заменив API-результат
            shouldTryUI = true;
            shouldReplaceText = true;
            console.log('[MCP Bridge] UI parsing priority: using DOM content');
        } else {
            // API в приоритете: использовать UI-разбор только при сбое API
            shouldTryUI = !fullText || fullText.trim() === '';
            shouldReplaceText = shouldTryUI;
            if (shouldTryUI) {
                console.log('[MCP Bridge] API parsing failed, falling back to UI parsing');
            }
        }
        
        if (shouldTryUI) {
            try {
                const response = await chrome.tabs.sendMessage(tabId, {
                    type: 'PARSE_UI_CONTENT',
                    payload: { uiConfig: siteConfig.uiParsing }
                });
                
                if (response?.success && response.content) {
                    if (shouldReplaceText) {
                        fullText = response.content;
                    }
                }
            } catch (error) {
                console.error('[MCP Bridge] Failed to parse UI content:', error);
            }
        }
    }

    // Проверить, не обработан ли уже вызов инструмента (во избежание двойной обработки chunk и complete)
    const state = await getTabState(tabId);
    
    // Высокая отказоустойчивость: начальные и конечные < > необязательны
    const toolCallMatch = fullText.match(/<?\s*tool_code\s*>?([\s\S]*?)<\s*\/\s*tool_code\s*>/);
    if (!toolCallMatch) {
        if (state.status === 'AWAITING_RESPONSE') {
            await updateUIPanel(tabId, 'SUCCESS', 'Ответ завершён, вызовов инструментов не обнаружено.');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            await clearTabState(tabId);
        }
        return;
    }

    const toolCallJson = parseJsonSafely(toolCallMatch[1]);
    if (!toolCallJson || !toolCallJson.tool_name) {
        // Отправить сообщение об ошибке модели
        try {
            JSON.parse(toolCallMatch[1])
        } catch (e) {
            await injectToolResult(tabId, `**Ошибка вызова инструмента!** \n\nСообщение об ошибке:\n\n${e.message}`)
            // Пометить как внедрённое
            await setTabState(tabId, { ...state, resultInjected: true });
        }

        await updateUIPanel(tabId, 'ERROR', 'Модель пыталась вызвать инструмент, но формат неверен.');
        return;
    }

    // Использовать содержимое JSON, а не исходную строку, чтобы избежать различий в формате разбора API и UI
    const toolCallKey = JSON.stringify({ tool_name: toolCallJson.tool_name, arguments: toolCallJson.arguments });
    
    // Если тот же вызов инструмента уже обработан — просто вернуться
    if (state.currentToolCallKey === toolCallKey) {
        console.log('[MCP Bridge] Tool call already processed in chunk handler, skipping complete');
        return;
    }
    
    // Если результат уже внедрён, тоже не обрабатывать
    if (state.resultInjected) {
        console.log('[MCP Bridge] Result already injected, skipping complete');
        return;
    }

    console.log('[MCP Bridge] Parsed tool call:', toolCallJson);

    // Записать текущий вызов инструмента
    await setTabState(tabId, { ...state, currentToolCallKey: toolCallKey });

    const {tool_name, arguments: args} = toolCallJson;
    if (tool_name === 'list_tools_in_service') {
        await handleListTools(tabId, args.service_name);
    } else {
        await handleExecuteTool(tabId, tool_name, args);
    }
}

async function handleListTools(tabId, serviceName) {
    try {
        await updateUIPanel(tabId, 'EXECUTING', `Запрос инструментов сервиса <strong>${serviceName}</strong>...`);
        const response = await apiClient.getToolsByServer(serviceName);
        
        // Сервер теперь возвращает { service_name, service_description, tools: [...] }
        const serviceDescription = response.service_description || '';
        const tools = response.tools || [];
        
        // Построить JSON-массив списка инструментов
        const toolsData = tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters || {}
        }));
        
        // Включить описание сервиса в возвращаемый результат
        const resultText = `Информация о сервисе "${serviceName}":\n\n**Описание сервиса**: ${serviceDescription}\n\n**Список инструментов**:\n\`\`\`json\n${JSON.stringify(toolsData, null, 2)}\n\`\`\``;
        
        await updateUIPanel(tabId, 'SUCCESS', `Список инструментов получен, передача модели...`);
        
        // Использовать умное внедрение вместо перезагрузки страницы
        await injectToolResult(tabId, resultText);
        
        // Пометить результат как внедрённый, чтобы избежать повторной отправки, но сохранить currentToolCall
        const state = await getTabState(tabId);
        await setTabState(tabId, { ...state, resultInjected: true });
    } catch (error) {
        await handleToolError(tabId, 'list_tools_in_service', error);
    }
}

async function handleExecuteTool(tabId, toolName, args) {
    try {
        // Специальная обработка: инструменты, связанные с кэшем
        if (toolName === 'get_cached_result') {
            await handleGetCachedResult(tabId, args);
            return;
        }
        if (toolName === 'search_cached_result') {
            await handleSearchCachedResult(tabId, args);
            return;
        }
        if (toolName === 'get_cache_context') {
            await handleGetCacheContext(tabId, args);
            return;
        }
        
        await updateUIPanel(tabId, 'EXECUTING', `Выполнение инструмента: <strong>${toolName}</strong>...`, {
            title: 'Параметры',
            content: JSON.stringify(args, null, 2)
        });
        const result = await apiClient.executeTool(toolName, args);
        
        // Проверить, является ли это ссылкой на кэш
        if (result.result_type === 'cached_reference') {
            // Использовать новую функцию форматирования для ссылки на кэш
            const resultText = promptBuilder.formatCachedResultForModel(toolName, result);
            
            await updateUIPanel(tabId, 'SUCCESS', 
                `Инструмент выполнен успешно, результат закэширован (${(result.total_size/1024).toFixed(2)} КБ)`, {
                title: 'Информация о кэше',
                content: JSON.stringify({
                    cache_id: result.cache_id,
                    cache_type: result.cache_type,
                    total_size: result.total_size
                }, null, 2)
            });
            
            await injectToolResult(tabId, resultText);
        } else {
            // Прежняя логика: прямой результат
            const resultText = promptBuilder.formatToolResultForModel(toolName, result);
            
            await updateUIPanel(tabId, 'SUCCESS', `Инструмент выполнен успешно, передача модели...`, {
                title: 'Результат',
                content: JSON.stringify(result, null, 2)
            });
            
            await injectToolResult(tabId, resultText);
        }
        
        // Пометить результат как внедрённый, чтобы избежать повторной отправки, но сохранить currentToolCall
        const state = await getTabState(tabId);
        await setTabState(tabId, { ...state, resultInjected: true });
    } catch (error) {
        console.error('[MCP Bridge] Tool execution error:', error);
        await handleToolError(tabId, toolName, error);
    }
}

/**
 * Обработать вызов инструмента получения кэшированного результата
 */
async function handleGetCachedResult(tabId, args) {
    try {
        const { cache_id, start, end } = args;
        
        if (!cache_id) {
            throw new Error('Отсутствует обязательный параметр: cache_id');
        }
        
        await updateUIPanel(tabId, 'EXECUTING', 
            `Получение содержимого кэша... ${start !== undefined ? `(${start}-${end || 'конец'})` : '(полное)'}`);
        
        const result = await apiClient.getCachedResult(cache_id, start, end);
        
        // Форматировать результат для возврата модели
        const hasMore = result.metadata.has_more || false;
        const actualStart = result.metadata.start || start || 0;
        const actualEnd = result.metadata.end || end || result.metadata.total_length;
        const totalLength = result.metadata.total_length || 'неизвестно';
        
        // Вычислить количество полученных символов
        const fetchedCount = actualEnd - actualStart;
        
        // Форматировать содержимое: если это объект, сериализовать в JSON
        let contentStr;
        if (typeof result.content === 'string') {
            contentStr = result.content;
        } else if (typeof result.content === 'object') {
            contentStr = JSON.stringify(result.content, null, 2);
        } else {
            contentStr = String(result.content);
        }
        
        // Вычислить число строк содержимого (если это строка)
        const contentLines = typeof result.content === 'string' 
            ? result.content.split('\n').length 
            : (Array.isArray(result.content) ? result.content.length : 1);
        
        const resultText = `
# Результат получения содержимого кэша

**ID кэша**: \`${cache_id}\`  
**Всего символов**: ${totalLength}  
**Получено в этот раз**: ${actualStart} - ${actualEnd} (всего ${fetchedCount} символов${contentLines > 1 ? `, ${contentLines} строк` : ''})  
**Есть ли ещё**: ${hasMore ? `Да (осталось ${totalLength - actualEnd} символов)` : 'Нет'}

**Содержимое**:
\`\`\`
${contentStr}
\`\`\`

${hasMore ? `
---
Получить следующий фрагмент:
\`\`\`xml
<tool_code>
{
  "tool_name": "get_cached_result",
  "arguments": {
    "cache_id": "${cache_id}",
    "start": ${actualEnd},
    "end": ${actualEnd + 10000}
  }
}
</tool_code>
\`\`\`
` : ''}
`.trim();
        
        await updateUIPanel(tabId, 'SUCCESS', 
            `Содержимое кэша получено (${actualStart}-${actualEnd}/${totalLength})`);
        
        await injectToolResult(tabId, resultText);
        
        const state = await getTabState(tabId);
        await setTabState(tabId, { ...state, resultInjected: true });
        
    } catch (error) {
        console.error('[MCP Bridge] Get cached result error:', error);
        
        // Специальная обработка ошибки истечения кэша
        let errorMessage = error.message;
        if (errorMessage.includes('不存在') || errorMessage.includes('过期') || errorMessage.includes('404')) {
            errorMessage = `Кэш истёк или не существует. Срок жизни кэша составляет 5 минут, возможно, он уже истёк. Рекомендуется повторно выполнить исходный инструмент для получения актуальных данных.`;
        }
        
        await handleToolError(tabId, 'get_cached_result', new Error(errorMessage));
    }
}

/**
 * Обработать вызов инструмента поиска в кэше
 */
async function handleSearchCachedResult(tabId, args) {
    try {
        const { cache_id, keyword, case_sensitive = false, max_results = 50 } = args;
        
        if (!cache_id || !keyword) {
            throw new Error('Отсутствуют обязательные параметры: cache_id или keyword');
        }
        
        await updateUIPanel(tabId, 'EXECUTING', `Поиск ключевого слова "${keyword}"...`);
        
        const result = await apiClient.searchCachedResult(cache_id, keyword, case_sensitive, max_results);
        
        // Форматировать результаты поиска
        const matchCount = result.total_matches;
        const truncated = result.truncated;
        
        // Ограничить отображение первыми 20 результатами
        const displayMatches = result.matches.slice(0, 20);
        const matchList = displayMatches.map(m => 
            `- Строка ${m.line}, столбец ${m.column}: ${m.content}`
        ).join('\n');
        
        const resultText = `
# Результаты поиска в кэше

**Ключевое слово**: "${keyword}"  
**Найдено**: ${matchCount} совпадений${truncated ? ' (обрезано до первых 50)' : ''}  
**С учётом регистра**: ${case_sensitive ? 'Да' : 'Нет'}

**Позиции совпадений**${displayMatches.length < matchCount ? ` (показаны первые ${displayMatches.length})` : ''}:
${matchList}

${matchCount > 0 ? `
Ты можешь использовать \`get_cache_context\` для получения контекста указанной строки:
\`\`\`xml
<tool_code>
{
  "tool_name": "get_cache_context",
  "arguments": {
    "cache_id": "${cache_id}",
    "line_num": ${displayMatches[0].line},
    "context_lines": 5
  }
}
</tool_code>
\`\`\`

Или использовать \`get_cached_result\` для точного получения содержимого возле этих строк.
` : 'Совпадений не найдено.'}
`.trim();
        
        await updateUIPanel(tabId, 'SUCCESS', `Поиск завершён, найдено ${matchCount} совпадений`);
        
        await injectToolResult(tabId, resultText);
        
        const state = await getTabState(tabId);
        await setTabState(tabId, { ...state, resultInjected: true });
        
    } catch (error) {
        console.error('[MCP Bridge] Search cached result error:', error);
        await handleToolError(tabId, 'search_cached_result', error);
    }
}

/**
 * Обработать вызов инструмента получения контекста из кэша
 */
async function handleGetCacheContext(tabId, args) {
    try {
        const { cache_id, line_num, context_lines = 3 } = args;
        
        if (!cache_id || !line_num) {
            throw new Error('Отсутствуют обязательные параметры: cache_id или line_num');
        }
        
        await updateUIPanel(tabId, 'EXECUTING', `Получение контекста строки ${line_num}...`);
        
        const result = await apiClient.getCacheContext(cache_id, line_num, context_lines);
        
        const resultText = `
# Контекст из кэша

**Целевая строка**: строка ${result.target_line}  
**Диапазон контекста**: строки ${result.context_start} - ${result.context_end} (всего ${result.total_lines} строк)

**Содержимое**:
\`\`\`
${result.content}
\`\`\`
`.trim();
        
        await updateUIPanel(tabId, 'SUCCESS', `Контекст получен успешно`);
        
        await injectToolResult(tabId, resultText);
        
        const state = await getTabState(tabId);
        await setTabState(tabId, { ...state, resultInjected: true });
        
    } catch (error) {
        console.error('[MCP Bridge] Get cache context error:', error);
        await handleToolError(tabId, 'get_cache_context', error);
    }
}

async function handleToolError(tabId, toolName, error) {
    // Построить подробное сообщение об ошибке
    let errorMessage = error.message || 'Неизвестная ошибка';
    let errorDetails = errorMessage;
    let fullErrorText = errorMessage; // Полная ошибка для внедрения в поле ввода
    
    // Если есть подробный объект ошибки, извлечь больше информации
    if (error.details && typeof error.details === 'object') {
        const details = error.details;
        errorMessage = details.error || errorMessage;
        
        // Построить подробную информацию об ошибке (для отображения во всплывающем окне)
        const errorParts = [`Тип ошибки: ${details.type || 'Error'}`];
        errorParts.push(`Сообщение об ошибке: ${details.error || errorMessage}`);
        
        if (details.traceback) {
            errorParts.push(`\nСтек вызовов:\n${details.traceback}`);
        }
        
        errorDetails = errorParts.join('\n');
        
        // Построить полную ошибку для внедрения (включая тип и стек)
        fullErrorText = errorMessage;
        if (details.type) {
            fullErrorText = `[${details.type}] ${fullErrorText}`;
        }
        if (details.traceback) {
            // Взять ключевую часть стека (последние строки обычно самые полезные)
            const tracebackLines = details.traceback.split('\n');
            const importantLines = tracebackLines.slice(-10); // Взять последние 10 строк
            fullErrorText += `\n\nСтек вызовов:\n${importantLines.join('\n')}`;
        }
    }
    
    console.error('[MCP Bridge] Tool error details:', errorDetails);
    
    const errorText = promptBuilder.formatToolErrorForModel(toolName, fullErrorText);
    
    await updateUIPanel(tabId, 'ERROR', `Инструмент <strong>${toolName}</strong> не выполнился`, {
        title: 'Подробности ошибки',
        content: errorDetails
    });
    
    // Использовать умное внедрение вместо перезагрузки страницы
    await injectToolResult(tabId, errorText);
    
    // Пометить результат как внедрённый, чтобы избежать повторной отправки, но сохранить currentToolCall
    const state = await getTabState(tabId);
    await setTabState(tabId, { ...state, resultInjected: true });
}

/**
 * Внедрить результат выполнения инструмента в поле ввода и отправить
 */
async function injectToolResult(tabId, resultText) {
    try {
        // Получить конфигурацию текущего сайта
        const {api_list} = await chrome.storage.local.get('api_list');
        const currentHostname = await getCurrentHostname(tabId);
        const siteConfig = api_list?.find(site => site.hostname === currentHostname);
        
        if (!siteConfig || !siteConfig.input) {
            console.error('[MCP Bridge] No input config found for:', currentHostname);
            return;
        }

        // Отправить сообщение в content script для выполнения внедрения
        await chrome.tabs.sendMessage(tabId, {
            type: 'INJECT_TEXT_AND_SUBMIT',
            payload: {
                text: resultText,
                inputConfig: siteConfig.input
            }
        });
    } catch (error) {
        console.error('[MCP Bridge] Failed to inject tool result:', error);
    }
}

/**
 * Получить hostname вкладки
 */
async function getCurrentHostname(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        const url = new URL(tab.url);
        return url.hostname;
    } catch (error) {
        console.error('[MCP Bridge] Failed to get hostname:', error);
        return '';
    }
}

function createResponse(modifiedBody) {
    return {payload: {modifiedBody}};
}

async function getTabState(tabId) {
    const key = `tab_${tabId}_state`;
    const data = await chrome.storage.session.get(key);
    return data[key] || {status: 'IDLE'};
}

async function setTabState(tabId, state) {
    const key = `tab_${tabId}_state`;
    await chrome.storage.session.set({[key]: state});
}

async function clearTabState(tabId) {
    const key = `tab_${tabId}_state`;
    await chrome.storage.session.remove(key);
}

async function updateUIPanel(tabId, status, message, details = null) {
    try {
        await chrome.tabs.sendMessage(tabId, {type: 'UPDATE_UI_PANEL', payload: {status, message, details}});
    } catch (e) {
    }
}

async function destroyUIPanel(tabId) {
    try {
        await chrome.tabs.sendMessage(tabId, {type: 'DESTROY_UI_PANEL'});
    } catch (e) {
    }
}

function getSiteConfig(url, apiList) {
    if (!url || !Array.isArray(apiList)) return null;
    try {
        for (const apiItem of apiList) {
            const apis = apiItem?.api ?? [];
            for (const apiEndpoint of apis) {
                if (apiEndpoint.includes(url) || url.includes(apiEndpoint)) return apiItem;
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

function parseJsonSafely(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return null;
    }
}

// Исправление: более точное определение нового диалога для разных сайтов
/**
 * Проверить, является ли это новым диалогом
 * @param {object} body - Объект тела запроса
 * @param {object} siteConfig - Конфигурация сайта
 * @returns {boolean} - Является ли это новым диалогом
 */
function checkIsNewConversation(body, siteConfig) {
    // Если настроен newConversationFlag, использовать сконфигурированную логику
    if (siteConfig.newConversationFlag) {
        const flag = siteConfig.newConversationFlag;
        
        // Получить значение проверяемого поля
        let value;
        if (flag.from === 'requestBody') {
            // Получить значение из тела запроса (здесь promptFilter не применяется, так как проверяется только флаг)
            value = getByPath(body, flag.path, siteConfig.isJsonString, null);
        }
        // В будущем можно расширить другими источниками: headers, url и т. д.
        
        // Выполнить проверку в зависимости от типа
        if (flag.checkExists !== undefined && flag.checkExists !== null) {
            // Проверить существование поля
            if (flag.checkExists === true) {
                // Ожидается наличие поля
                const exists = value !== undefined && value !== null;
                
                // Если также нужно проверить конкретное значение
                if (exists && flag.checkValue !== undefined && flag.checkValue !== null) {
                    return checkValueMatch(value, flag.checkValue, flag.valueType);
                }
                
                return exists;
            } else {
                // Ожидается отсутствие поля
                return value === undefined || value === null;
            }
        }
        
        // Если настроено только checkValue, сразу сравнить значения
        if (flag.checkValue !== undefined && flag.checkValue !== null) {
            return checkValueMatch(value, flag.checkValue, flag.valueType);
        }
        
        // Если конфигурация неполная, вернуть false (не новый диалог)
        console.warn('[MCP Bridge] Invalid newConversationFlag config:', flag);
        return false;
    }
    
    // Нет newConversationFlag — использовать старую жёстко закодированную логику
    // Обратная совместимость
    if (siteConfig.name === 'chatgpt' && body.parent_message_id) {
        return body.parent_message_id.includes('00000000-0000-0000-0000-000000000000');
    }
    if (siteConfig.name === 'doubao' && body?.conversation_id == '0') return true;
    if (siteConfig.name === 'yuanbao' && body?.chatModelExtInfo) return true;
    return !body.conversation_id && !body.parent_message_id && !body.sessionId;
}

/**
 * Проверить, совпадает ли значение
 * @param {any} actualValue - Фактическое значение
 * @param {any} expectedValue - Ожидаемое значение
 * @param {string} valueType - Тип значения (string, number, boolean, null)
 * @returns {boolean} - Совпадает ли
 */
function checkValueMatch(actualValue, expectedValue, valueType) {
    // Если тип не указан, сравнить напрямую
    if (!valueType) {
        // eslint-disable-next-line eqeqeq
        return actualValue == expectedValue; // Использовать == для допуска преобразования типов
    }
    
    // Сравнить в соответствии с типом
    switch (valueType) {
        case 'string':
            return String(actualValue) === String(expectedValue);
        case 'number':
            return Number(actualValue) === Number(expectedValue);
        case 'boolean':
            return Boolean(actualValue) === Boolean(expectedValue);
        case 'null':
            return actualValue === null;
        default:
            // eslint-disable-next-line eqeqeq
            return actualValue == expectedValue;
    }
}

/**
 * Набор предопределённых функций-фильтров
 */
const FILTER_PRESETS = {
    // Найти элемент массива по значению поля и вернуть указанное поле
    // Параметры: { arrayPath, matchField, matchValue, returnField }
    // Поддержка массивов: arrayPath, returnField могут быть массивами
    findByField: (obj, params) => {
        const arrayPaths = Array.isArray(params.arrayPath) ? params.arrayPath : [params.arrayPath];
        const returnFields = Array.isArray(params.returnField) ? params.returnField : [params.returnField];
        
        // Попробовать каждый arrayPath
        for (const arrayPath of arrayPaths) {
            const array = getValueByPath(obj, arrayPath);
            if (!Array.isArray(array)) continue;
            
            const item = array.find(el => el[params.matchField] === params.matchValue);
            if (!item) continue;
            
            // Попробовать каждое returnField
            for (const returnField of returnFields) {
                const value = getValueByPath(item, returnField);
                if (value) return value;
            }
        }
        return '';
    },
    
    // Отфильтровать массив по значению поля и объединить указанные поля
    // Параметры: { arrayPath, matchField, matchValue, returnField, separator }
    // Поддержка массивов: arrayPath, matchValue, returnField могут быть массивами
    filterAndJoin: (obj, params) => {
        const arrayPaths = Array.isArray(params.arrayPath) ? params.arrayPath : [params.arrayPath];
        const matchValues = Array.isArray(params.matchValue) ? params.matchValue : [params.matchValue];
        const returnFields = Array.isArray(params.returnField) ? params.returnField : [params.returnField];
        const separator = params.separator || '\n\n';
        
        const results = [];
        
        for (const arrayPath of arrayPaths) {
            const array = getValueByPath(obj, arrayPath);
            if (!Array.isArray(array)) continue;
            
            const filtered = array.filter(el => matchValues.includes(el[params.matchField]));
            
            for (const item of filtered) {
                for (const returnField of returnFields) {
                    const value = getValueByPath(item, returnField);
                    if (value) {
                        results.push(value);
                        break; // Прервать после первого найденного допустимого поля
                    }
                }
            }
        }
        
        return results.join(separator);
    },
    
    // Получить значение поля первого элемента массива, соответствующего условию
    // Параметры: { arrayPath, matchField, matchValues, returnField }
    // Поддержка массивов: arrayPath, matchValues, returnField могут быть массивами
    findFirstMatch: (obj, params) => {
        const arrayPaths = Array.isArray(params.arrayPath) ? params.arrayPath : [params.arrayPath];
        const matchValues = Array.isArray(params.matchValues) ? params.matchValues : [params.matchValues];
        const returnFields = Array.isArray(params.returnField) ? params.returnField : [params.returnField];
        
        for (const arrayPath of arrayPaths) {
            const array = getValueByPath(obj, arrayPath);
            if (!Array.isArray(array)) continue;
            
            for (const value of matchValues) {
                const item = array.find(el => el[params.matchField] === value);
                if (!item) continue;
                
                for (const returnField of returnFields) {
                    const fieldValue = getValueByPath(item, returnField);
                    if (fieldValue) return fieldValue;
                }
            }
        }
        return '';
    },
    
    // Получить значение поля элемента массива по указанному индексу
    // Параметры: { arrayPath, index, returnField }
    // Поддержка массивов: arrayPath, returnField могут быть массивами
    getByIndex: (obj, params) => {
        const arrayPaths = Array.isArray(params.arrayPath) ? params.arrayPath : [params.arrayPath];
        const returnFields = Array.isArray(params.returnField) ? params.returnField : [params.returnField];
        
        for (const arrayPath of arrayPaths) {
            const array = getValueByPath(obj, arrayPath);
            if (!Array.isArray(array)) continue;
            
            const item = array[params.index];
            if (!item) continue;
            
            for (const returnField of returnFields) {
                const value = getValueByPath(item, returnField);
                if (value) return value;
            }
        }
        return '';
    },
    
    // Получить значение по указанному пути напрямую
    // Параметры: { path }
    // Поддержка массивов: path может быть массивом, вернуть первое непустое значение
    getPath: (obj, params) => {
        const paths = Array.isArray(params.path) ? params.path : [params.path];
        
        for (const path of paths) {
            const value = getValueByPath(obj, path);
            if (value) return value;
        }
        return '';
    }
};

/**
 * Набор предопределённых функций-установщиков
 */
const SETTER_PRESETS = {
    // Найти элемент массива по значению поля и установить указанное поле
    // Параметры: { arrayPath, matchField, matchValue, setField }
    // Поддержка массивов: arrayPath, setField могут быть массивами
    setByField: (obj, value, params) => {
        const arrayPaths = Array.isArray(params.arrayPath) ? params.arrayPath : [params.arrayPath];
        const setFields = Array.isArray(params.setField) ? params.setField : [params.setField];
        
        for (const arrayPath of arrayPaths) {
            const array = getValueByPath(obj, arrayPath);
            if (!Array.isArray(array)) continue;
            
            const item = array.find(el => el[params.matchField] === params.matchValue);
            if (!item) continue;
            
            // Установить все указанные поля
            for (const setField of setFields) {
                setValueByPath(item, setField, value);
            }
            
            // Прервать после первого совпадения
            return;
        }
    },
    
    // Установить значение поля элемента массива по указанному индексу
    // Параметры: { arrayPath, index, setField }
    // Поддержка массивов: arrayPath, setField могут быть массивами
    setByIndex: (obj, value, params) => {
        const arrayPaths = Array.isArray(params.arrayPath) ? params.arrayPath : [params.arrayPath];
        const setFields = Array.isArray(params.setField) ? params.setField : [params.setField];
        
        for (const arrayPath of arrayPaths) {
            const array = getValueByPath(obj, arrayPath);
            if (!Array.isArray(array)) continue;
            
            const item = array[params.index];
            if (!item) continue;
            
            // Установить все указанные поля
            for (const setField of setFields) {
                setValueByPath(item, setField, value);
            }
            
            return;
        }
    },
    
    // Установить значение по указанному пути напрямую
    // Параметры: { path }
    // Поддержка массивов: path может быть массивом, будут установлены все пути
    setPath: (obj, value, params) => {
        const paths = Array.isArray(params.path) ? params.path : [params.path];
        
        for (const path of paths) {
            setValueByPath(obj, path, value);
        }
    }
};

/**
 * Вспомогательная функция: получить значение по пути
 */
function getValueByPath(obj, path) {
    if (!path) return obj;
    const parts = path.split('.');
    return parts.reduce((acc, part) => acc && acc[part], obj);
}

/**
 * Вспомогательная функция: установить значение по пути
 */
function setValueByPath(obj, path, value) {
    if (!path) return;
    const parts = path.split('.');
    const lastPart = parts.pop();
    let target = obj;
    for (const part of parts) {
        if (target === undefined || target === null) return;
        target = target[part];
    }
    if (target && typeof target === 'object' && lastPart) {
        target[lastPart] = value;
    }
}

/**
 * Применить пользовательскую логику фильтрации prompt
 * @param {any} value - Текущее значение (если есть promptFilter, здесь полный obj)
 * @param {object|string} filterConfig - Объект конфигурации фильтра или имя пресета
 * @param {object} rootObj - Корневой объект (полное тело запроса)
 * @param {any} currentTarget - Текущий целевой объект
 * @returns {any} - Отфильтрованное значение
 */
function applyPromptFilter(value, filterConfig, rootObj, currentTarget) {
    if (!filterConfig) {
        return value;
    }
    
    try {
        // Если это строка, попробовать разобрать её как JSON
        if (typeof filterConfig === 'string') {
            try {
                filterConfig = JSON.parse(filterConfig);
            } catch (e) {
                console.error('[MCP Bridge] Failed to parse promptFilter as JSON:', e);
                return value;
            }
        }
        
        // Если это объект конфигурации
        if (typeof filterConfig === 'object' && filterConfig.preset) {
            const preset = FILTER_PRESETS[filterConfig.preset];
            if (!preset) {
                console.error('[MCP Bridge] Unknown filter preset:', filterConfig.preset);
                return value;
            }
            
            const result = preset(value, filterConfig.params || {});
            
            console.log('[MCP Bridge] Applied promptFilter preset:', {
                preset: filterConfig.preset,
                params: filterConfig.params,
                outputType: typeof result,
                outputPreview: typeof result === 'string' ? result.substring(0, 100) : result
            });
            
            return result;
        }
        
        console.warn('[MCP Bridge] Invalid promptFilter config:', filterConfig);
        return value;
    } catch (error) {
        console.error('[MCP Bridge] Failed to apply promptFilter:', error);
        console.error('[MCP Bridge] Filter config:', filterConfig);
        return value;
    }
}

function getByPath(obj, path, isJsonString, promptFilter) {
    // Если настроен promptFilter, полностью использовать пользовательскую логику, игнорируя path
    if (promptFilter) {
        console.log('[MCP Bridge] Using promptFilter, ignoring path');
        return applyPromptFilter(obj, promptFilter, obj, obj);
    }
    
    const parts = path.split('.');
    
    if (isJsonString && parts.length >= 2) {
        // Для JSON-строки требуется особая обработка
        const innerKey = parts.pop();
        const jsonFieldKey = parts.pop();
        
        let target = obj;
        for (const part of parts) {
            if (!target) return undefined;
            target = target[part];
        }
        
        if (target && typeof target === 'object' && jsonFieldKey) {
            try {
                const jsonString = target[jsonFieldKey];
                if (typeof jsonString === 'string') {
                    const innerObj = JSON.parse(jsonString);
                    return innerObj ? innerObj[innerKey] : undefined;
                }
            } catch (e) {
                console.error('[MCP Bridge] Failed to parse JSON string in getByPath:', e);
                return undefined;
            }
        }
        return undefined;
    } else {
        // Обычный путь
        return parts.reduce((acc, part) => acc && acc[part], obj);
    }
}

function setByPath(obj, path, value, siteConfig) {
    const {isJsonString, promptFilter, promptSetFilter} = siteConfig;
    const parts = path.split('.');
    
    // Если настроен promptSetFilter, использовать пользовательскую логику установки значения
    if (promptSetFilter) {
        console.log('[MCP Bridge] Using promptSetFilter for setting value');
        try {
            // Если это строка, попробовать разобрать её как JSON
            let setConfig = promptSetFilter;
            if (typeof setConfig === 'string') {
                try {
                    setConfig = JSON.parse(setConfig);
                } catch (e) {
                    console.error('[MCP Bridge] Failed to parse promptSetFilter as JSON:', e);
                    // Продолжить с логикой по умолчанию
                    setConfig = null;
                }
            }
            
            // Если это объект конфигурации
            if (setConfig && typeof setConfig === 'object' && setConfig.preset) {
                const preset = SETTER_PRESETS[setConfig.preset];
                if (preset) {
                    preset(obj, value, setConfig.params || {});
                    console.log('[MCP Bridge] Applied promptSetFilter preset:', setConfig.preset);
                    return;
                } else {
                    console.error('[MCP Bridge] Unknown setter preset:', setConfig.preset);
                }
            }
        } catch (error) {
            console.error('[MCP Bridge] Failed to apply promptSetFilter:', error);
            console.error('[MCP Bridge] Filter config:', promptSetFilter);
            // При неудаче продолжить с логикой по умолчанию
        }
    }
    
    if (isJsonString && parts.length >= 2) {
        // Для JSON-строки требуется особая обработка
        // Пример: "messages.0.content.text" 
        // - parts = ["messages", "0", "content", "text"]
        // - Нужно найти поле "content", разобрать его, изменить внутреннее "text" и сериализовать обратно
        
        const innerKey = parts.pop(); // "text"
        const jsonFieldKey = parts.pop(); // "content"
        
        // Перейти к объекту, содержащему JSON-строку
        let target = obj;
        for (const part of parts) {
            if (target === undefined || target === null) return;
            target = target[part];
        }
        
        if (target && typeof target === 'object' && jsonFieldKey) {
            try {
                const jsonString = target[jsonFieldKey];
                if (typeof jsonString === 'string') {
                    const innerObj = JSON.parse(jsonString);
                    if (innerObj && typeof innerObj === 'object') {
                        innerObj[innerKey] = value;
                        target[jsonFieldKey] = JSON.stringify(innerObj);
                    }
                } else {
                    console.warn('[MCP Bridge] isJsonString is true but field is not a string:', jsonString);
                }
            } catch (e) {
                console.error('[MCP Bridge] Failed to parse and set value in JSON string:', e);
            }
        }
    } else {
        // Обычная обработка пути
        const lastPart = parts.pop();
        let target = obj;
        for (const part of parts) {
            if (target === undefined || target === null) return;
            target = target[part];
        }
        if (target && typeof target === 'object' && lastPart) {
            target[lastPart] = value;
        }
    }
}

/**
 * Обновить System Prompt и внедрить его в текущую страницу
 * @param {number} tabId - ID вкладки
 * @returns {Promise<Object>} Результат операции
 */
async function handleRefreshSystemPrompt(tabId) {
    try {
        await updateUIPanel(tabId, 'EXECUTING', 'Получение актуального списка инструментов...');

        // Получить список сервисов
        const services = await apiClient.getServices();
        
        // Построить полный начальный Prompt
        const systemPrompt = promptBuilder.buildInitialPrompt(services);
        
        await updateUIPanel(tabId, 'SUCCESS', 'System Prompt обновлён, внедрение...');

        // Получить конфигурацию текущего сайта
        const { api_list, auto_submit_prompt } = await chrome.storage.local.get(['api_list', 'auto_submit_prompt']);
        const currentHostname = await getCurrentHostname(tabId);
        const siteConfig = api_list?.find(site => site.hostname === currentHostname);
        
        if (!siteConfig || !siteConfig.input) {
            throw new Error(`Для текущего сайта (${currentHostname}) не настроены параметры ввода`);
        }

        // Создать конфигурацию ввода, в зависимости от пользовательской настройки решить, отправлять ли автоматически
        const inputConfig = {
            ...siteConfig.input,
            // Если пользователь отключил автоотправку, не нажимать клавишу отправки
            submitKey: auto_submit_prompt ? siteConfig.input.submitKey : null
        };

        // Отправить сообщение о внедрении
        await chrome.tabs.sendMessage(tabId, {
            type: 'INJECT_TEXT_AND_SUBMIT',
            payload: {
                text: systemPrompt,
                inputConfig: inputConfig
            }
        });

        await updateUIPanel(tabId, 'SUCCESS', `System Prompt ${auto_submit_prompt ? 'внедрён и отправлен' : 'внедрён в поле ввода'}`);
        
        // Через 2 секунды очистить панель
        setTimeout(() => clearTabState(tabId), 2000);

        return { success: true };
    } catch (error) {
        console.error('[MCP Bridge] Failed to refresh system prompt:', error);
        await updateUIPanel(tabId, 'ERROR', 'Ошибка обновления Prompt', {
            title: 'Подробности ошибки',
            content: error.message
        });
        return { success: false, error: error.message };
    }
}

/**
 * Обработать содержимое, вставленное пользователем вручную (резервный вариант)
 */
async function handleManualToolParse(tabId, content) {
    try {
        await updateUIPanel(tabId, 'EXECUTING', 'Разбор введённого вручную содержимого...');

        // Использовать то же регулярное выражение для поиска вызова инструмента
        const toolCallMatch = content.match(/<?\s*tool_code\s*>?([\s\S]*?)<\s*\/\s*tool_code\s*>/);

        if (!toolCallMatch) {
            await updateUIPanel(tabId, 'ERROR', 'В содержимом не найден тег вызова инструмента');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        const toolCallJson = parseJsonSafely(toolCallMatch[1]);
        if (!toolCallJson || !toolCallJson.tool_name) {
            await updateUIPanel(tabId, 'ERROR', 'Неверный формат вызова инструмента');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        console.log('[MCP Bridge] Manual tool call parsed:', toolCallJson);

        // Выполнить вызов инструмента
        const { tool_name, arguments: args } = toolCallJson;
        if (tool_name === 'list_tools_in_service') {
            await handleListTools(tabId, args.service_name);
        } else {
            await handleExecuteTool(tabId, tool_name, args);
        }
    } catch (error) {
        console.error('[MCP Bridge] Failed to parse manual content:', error);
        await updateUIPanel(tabId, 'ERROR', 'Ошибка разбора: ' + error.message);
        setTimeout(() => destroyUIPanel(tabId), 3000);
    }
}

/**
 * Повторно определить вызов инструмента из последнего UI-сообщения (возобновление с точки останова)
 */
async function handleRedetectFromUI(tabId) {
    console.log('[MCP Bridge] handleRedetectFromUI вызван с tabId:', tabId);
    
    try {
        await updateUIPanel(tabId, 'EXECUTING', 'Повторное определение вызова инструмента из UI...');

        // Получить URL текущей вкладки
        const tab = await chrome.tabs.get(tabId);
        const currentUrl = new URL(tab.url).hostname;
        
        console.log('[MCP Bridge] Current URL hostname:', currentUrl);

        // Получить список конфигураций API
        const { api_list = [] } = await chrome.storage.local.get('api_list');
        
        console.log('[MCP Bridge] api_list:', api_list);
        
        // Использовать поле hostname для сопоставления с конфигурацией сайта
        const siteConfig = api_list.find(item => item.hostname === currentUrl);
        
        console.log('[MCP Bridge] Site config:', siteConfig);

        if (!siteConfig) {
            console.warn('[MCP Bridge] No site config found for hostname:', currentUrl);
            await updateUIPanel(tabId, 'ERROR', 'Не удалось получить конфигурацию сайта');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        // Проверить, настроен ли UI-разбор
        if (!siteConfig.uiParsing || !siteConfig.uiParsing.enabled) {
            await updateUIPanel(tabId, 'ERROR', 'Для текущего сайта не настроена функция UI-разбора');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        // Разобрать последнее сообщение из DOM страницы
        const response = await chrome.tabs.sendMessage(tabId, {
            type: 'PARSE_UI_CONTENT',
            payload: { uiConfig: siteConfig.uiParsing }
        });

        if (!response?.success || !response.content) {
            await updateUIPanel(tabId, 'ERROR', 'UI-разбор не удался, содержимое не получено');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        console.log('[MCP Bridge] Redetected UI content length:', response.content.length);

        // Использовать разобранное содержимое для обнаружения вызова инструмента
        const toolCallMatch = response.content.match(/<?\s*tool_code\s*>?([\s\S]*?)<\s*\/\s*tool_code\s*>/);

        if (!toolCallMatch) {
            await updateUIPanel(tabId, 'SUCCESS', 'Вызовов инструментов не обнаружено');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        const toolCallJson = parseJsonSafely(toolCallMatch[1]);
        if (!toolCallJson || !toolCallJson.tool_name) {
            // Отправить сообщение об ошибке модели
            try {
                JSON.parse(toolCallMatch[1])
            } catch (e) {
                await injectToolResult(tabId, `**Ошибка вызова инструмента!** \n\nСообщение об ошибке:\n\n${e.message}`)
            }
            await updateUIPanel(tabId, 'ERROR', 'Обнаружен вызов инструмента, но формат неверен');
            setTimeout(() => destroyUIPanel(tabId), 3000);
            return;
        }

        console.log('[MCP Bridge] Redetected tool call:', toolCallJson);

        // Выполнить вызов инструмента
        const { tool_name, arguments: args } = toolCallJson;
        if (tool_name === 'list_tools_in_service') {
            await handleListTools(tabId, args.service_name);
        } else {
            await handleExecuteTool(tabId, tool_name, args);
        }
    } catch (error) {
        console.error('[MCP Bridge] Failed to redetect from UI:', error);
        await updateUIPanel(tabId, 'ERROR', 'Повторное обнаружение не удалось: ' + error.message);
        setTimeout(() => destroyUIPanel(tabId), 3000);
    }
}