/**
 * injector.js (Исправлено с использованием postMessage как для Fetch, так и для XHR)
 */
(() => {
    if (typeof hookFetch === 'undefined' || typeof ah === 'undefined') {
        console.error('MCP Bridge: Hooking libraries not found!');
        return;
    }

    const MESSAGE_SOURCE = 'mcp-bridge-injector';

    // --- Универсальная функция отправки сообщения и ожидания ответа ---
    function sendMessageAndWaitForResponse(type, payload) {
        return new Promise(resolve => {
            const requestId = `req_${Date.now()}_${Math.random()}`;

            const messageListener = (event) => {
                if (event.source !== window || !event.data || event.data.source !== 'mcp-bridge-content-script' || event.data.requestId !== requestId) {
                    return;
                }
                window.removeEventListener('message', messageListener);
                resolve(event.data.payload);
            };

            window.addEventListener('message', messageListener);

            window.postMessage({
                source: MESSAGE_SOURCE,
                direction: 'to-content-script',
                type: type,
                requestId,
                payload: payload
            }, '*');
        });
    }

    // --- Перехват Fetch ---
    hookFetch({
        optionsHook: async function(options, url) {
            if (!shouldInterceptRequest(url)) {
                return options;
            }
            
            // Проверить, нужно ли пропустить модификацию запроса (только прослушивание ответа)
            const siteConfig = getSiteConfig(url);
            if (siteConfig && siteConfig.skipRequestModification) {
                console.log('[MCP Bridge] Skip request modification for:', url);
                return options;
            }
            
            const responsePayload = await sendMessageAndWaitForResponse('FETCH_REQUEST_BODY', { url, body: options.body });
            
            // modifiedBody должен быть строкой, присваиваем напрямую
            if (responsePayload && responsePayload.modifiedBody !== undefined) {
                options.body = responsePayload.modifiedBody;
            }
            return options;
        }, // 2001 текст 2070 программирование

        responseHook: async function(response) {
            if (!shouldInterceptRequest(response.url)) return response;

            // Проверить, является ли ответ потоковым
            const contentType = response.headers.get('content-type') || '';
            const isStreamResponse = contentType.includes('stream') || contentType.includes('event-stream');

            if (isStreamResponse) {
                // Для потоковых ответов нужно прочитать поток и пересобрать его
                return handleStreamingResponse(response);
            } else {
                // Непотоковый ответ — читаем сразу весь текст
                const responseClone = response.clone();
                const fullText = await responseClone.text().catch(() => '');

                window.postMessage({
                    source: MESSAGE_SOURCE,
                    direction: 'to-content-script',
                    type: 'FETCH_RESPONSE_COMPLETE',
                    payload: { url: response.url, fullText }
                }, '*');

                return response;
            }
        }
    });

    // --- Перехват Ajax ---
    // Хранение информации о XHR-экземплярах
    const xhrInstances = new WeakMap();
    
    ah.proxy({
        onRequest: async (config, handler) => {
            if (!shouldInterceptRequest(config.url)) {
                handler.next(config);
                return;
            }

            // Проверить, нужно ли пропустить модификацию запроса (только прослушивание ответа)
            const siteConfig = getSiteConfig(config.url);
            if (siteConfig && siteConfig.skipRequestModification) {
                console.log('[MCP Bridge] Skip request modification for:', config.url);
                handler.next(config);
                return;
            }

            const responsePayload = await sendMessageAndWaitForResponse('XHR_REQUEST_BODY', { url: config.url, body: config.body });

            if (responsePayload && responsePayload.modifiedBody !== undefined) {
                config.body = responsePayload.modifiedBody;
            }
            handler.next(config);
        },
        onResponse: (response, handler) => {
            if (shouldInterceptRequest(response.config.url)) {
                const fullText = response.response || '';
                
                window.postMessage({
                    source: MESSAGE_SOURCE,
                    direction: 'to-content-script',
                    type: 'XHR_RESPONSE_COMPLETE',
                    payload: { url: response.config.url, fullText }
                }, '*');
            }

            handler.next(response);
        }
    });

    // --- После ajaxhook дополнительно перехватываем XHR для прослушивания потоковых ответов ---
    (function setupXHRStreamMonitoring() {
        const OriginalXHR = window.XMLHttpRequest;
        const originalOpen = OriginalXHR.prototype.open;
        const originalSend = OriginalXHR.prototype.send;

        OriginalXHR.prototype.open = function(method, url, ...args) {
            xhrInstances.set(this, { 
                url, 
                method,
                accumulatedText: '',
                lastProcessedLength: 0
            });
            return originalOpen.call(this, method, url, ...args);
        };

        OriginalXHR.prototype.send = function(body) {
            const xhrInfo = xhrInstances.get(this);
            
            if (!xhrInfo || !shouldInterceptRequest(xhrInfo.url)) {
                return originalSend.call(this, body);
            }

            // Получить конфигурацию текущего сайта
            const siteConfig = getSiteConfig(xhrInfo.url);
            if (!siteConfig || !siteConfig.response) {
                return originalSend.call(this, body);
            }

            // Слушать событие progress (надёжнее для SSE)
            this.addEventListener('progress', () => {
                try {
                    const responseText = this.responseText || '';
                    
                    if (responseText.length <= xhrInfo.lastProcessedLength) {
                        return; // Нет новых данных
                    }

                    // Использовать конфигурируемый парсер
                    const parsedContent = parseResponse(responseText, siteConfig.response);
                    
                    const hasToolCodeStart = parsedContent.includes('<tool_code>');
                    const hasToolCodeEnd = parsedContent.includes('</tool_code>');

                    xhrInfo.accumulatedText = parsedContent;
                    xhrInfo.lastProcessedLength = responseText.length;

                    // Отправить накопленное распарсенное содержимое
                    window.postMessage({
                        source: MESSAGE_SOURCE,
                        direction: 'to-content-script',
                        type: 'XHR_RESPONSE_CHUNK',
                        payload: { url: xhrInfo.url, fullText: parsedContent, isComplete: false }
                    }, '*');
                } catch (error) {
                    console.error('[MCP Bridge] Error processing SSE chunk:', error);
                }
            });

            // Слушать readystatechange (как запасной вариант)
            this.addEventListener('readystatechange', () => {
                if (this.readyState === 4 && xhrInfo) {
                    const responseText = this.responseText || '';
                    const parsedContent = parseResponse(responseText, siteConfig.response);

                    window.postMessage({
                        source: MESSAGE_SOURCE,
                        direction: 'to-content-script',
                        type: 'XHR_RESPONSE_COMPLETE',
                        payload: { url: xhrInfo.url, fullText: parsedContent, isComplete: true }
                    }, '*');
                }
            });

            return originalSend.call(this, body);
        };
    })();

    // --- Конфигурируемый парсер ответа ---
    /**
     * Разобрать содержимое ответа в соответствии с конфигурацией
     * @param {string} rawText - Исходный текст ответа
     * @param {object} responseConfig - Объект конфигурации ответа
     * @returns {string} - Разобранное текстовое содержимое
     */
    function parseResponse(rawText, responseConfig) {
        if (!responseConfig) {
            // Нет конфигурации — вернуть исходный текст
            return rawText;
        }

        const { type, format, contentPaths, filterRules } = responseConfig;

        if (type === 'sse') {
            return parseSSEResponse(rawText, format, contentPaths, filterRules);
        } else if (type === 'json') {
            return parseJSONResponse(rawText, contentPaths, filterRules);
        } else if (type === 'text') {
            return rawText;
        }

        return rawText;
    }

    /**
     * Разобрать ответ в формате SSE (Server-Sent Events)
     * @param {string} rawText - Исходный SSE-текст
     * @param {string} format - Формат SSE, например "data: {json}" или "event: {event}\ndata: {json}"
     * @param {array} contentPaths - Массив путей к полю содержимого (по убыванию приоритета)
     * @param {object} filterRules - Конфигурация правил фильтрации (необязательно)
     * @returns {string} - Накопленное текстовое содержимое
     */
    function parseSSEResponse(rawText, format, contentPaths, filterRules) {
        const lines = rawText.split('\n');
        let accumulatedContent = '';
        let extractedCount = 0;
        let skippedCount = 0;
        
        // Временная отладка: записать все извлечённые символы
        const debugLog = [];
        const skippedData = [];

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const jsonStr = line.substring(6).trim(); // Удалить префикс "data: "
                    
                    // Пропустить специальные маркеры вроде [DONE]
                    if (jsonStr === '[DONE]' || jsonStr === '') continue;
                    
                    const data = JSON.parse(jsonStr);
                    
                    // Пытаться извлечь содержимое из сконфигурированных путей в порядке приоритета
                    const content = extractContentByPaths(data, contentPaths, filterRules);
                    if (content !== null && content !== undefined && content !== '') {
                        extractedCount++;
                        accumulatedContent += content;
                        
                        // Записывать только символы, связанные с tool
                        if (content === '<' || content.includes('tool') || content.includes('>')) {
                            debugLog.push(content);
                        }
                    } else {
                        skippedCount++;
                        // Записать пропущенные данные (только первые 20)
                        if (skippedData.length < 20 && (line.includes('tool') || line.includes('<'))) {
                            skippedData.push(jsonStr.substring(0, 100));
                        }
                    }
                } catch (e) {
                    // Ошибка разбора JSON — возможно, это простой текст или другой формат
                }
            }
        }
        

        return accumulatedContent;
    }

    /**
     * Разобрать ответ в чистом формате JSON
     * @param {string} rawText - Исходный JSON-текст
     * @param {array} contentPaths - Массив путей к полю содержимого
     * @param {object} filterRules - Конфигурация правил фильтрации (необязательно)
     * @returns {string} - Извлечённое содержимое
     */
    function parseJSONResponse(rawText, contentPaths, filterRules) {
        try {
            const data = JSON.parse(rawText);
            return extractContentByPaths(data, contentPaths, filterRules) || '';
        } catch (e) {
            console.error('[MCP Bridge] Failed to parse JSON response:', e);
            return rawText;
        }
    }

    /**
     * Извлечь содержимое из объекта по путям (поддерживаются вложенные пути)
     * @param {object} obj - Объект данных
     * @param {array} paths - Массив путей, например ["choices.0.delta.content", "content"]
     * @returns {string|null} - Извлечённое содержимое; если ни одно не найдено — null
     */
    function extractContentByPaths(obj, paths, filterRules) {
        if (!paths || !Array.isArray(paths)) {
            return null;
        }

        for (const path of paths) {
            const value = getByPath(obj, path);
            if (value !== undefined && value !== null && value !== '') {
                // Если значение — объект или массив, пропустить (это не текстовое содержимое)
                if (typeof value === 'object') {
                    continue;
                }
                
                // Если настроены правила фильтрации — применить их
                if (filterRules) {
                    const { pathField, excludePatterns, includePatterns } = filterRules;
                    
                    // Проверить наличие поля пути
                    if (pathField && obj[pathField]) {
                        const pathValue = String(obj[pathField]);
                        
                        // Сначала проверить шаблоны исключения
                        if (excludePatterns && Array.isArray(excludePatterns)) {
                            let shouldExclude = false;
                            for (const pattern of excludePatterns) {
                                if (pathValue.includes(pattern)) {
                                    shouldExclude = true;
                                    break;
                                }
                            }
                            if (shouldExclude) {
                                continue; // Пропустить это значение
                            }
                        }
                        
                        // Затем проверить шаблоны включения (если настроены)
                        if (includePatterns && Array.isArray(includePatterns) && includePatterns.length > 0) {
                            let matchesInclude = false;
                            for (const pattern of includePatterns) {
                                if (pathValue.includes(pattern)) {
                                    matchesInclude = true;
                                    break;
                                }
                            }
                            // Если настроены шаблоны включения, но совпадения нет — пропустить значение
                            if (!matchesInclude) {
                                continue;
                            }
                        }
                    }
                }
                
                return String(value);
            }
        }

        return null;
    }

    /**
     * Получить значение свойства объекта по пути (поддерживаются индексы массивов)
     * @param {object} obj - Объект
     * @param {string} path - Путь, например "a.b.0.c"
     * @returns {any} - Значение свойства
     */
    function getByPath(obj, path) {
        return path.split('.').reduce((acc, part) => {
            if (acc === undefined || acc === null) return undefined;
            return acc[part];
        }, obj);
    }

    /**
     * Получить конфигурацию сайта для текущего URL
     * @param {string} url - URL запроса
     * @returns {object|null} - Объект конфигурации сайта
     */
    function getSiteConfig(url) {
        try {
            const apiList = JSON.parse(localStorage.getItem('mcp_api_list') || '[]');
            if (!apiList || !url) return null;
            
            const currentHostname = window.location.hostname;
            
            for (const apiItem of apiList) {
                if (apiItem.hostname !== currentHostname) continue;
                
                const apis = Array.isArray(apiItem.api) ? apiItem.api : [apiItem.api];
                const matched = apis.some(apiEndpoint => url.includes(apiEndpoint));
                
                if (matched) return apiItem;
            }
            
            return null;
        } catch (e) {
            console.error('[MCP Bridge] Error getting site config:', e);
            return null;
        }
    }

    // --- Обработчик потокового ответа ---
    async function handleStreamingResponse(response) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = '';
        let lastSentLength = 0;

        // Создать новый читаемый поток, проксирующий исходный
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        
                        if (done) {
                            console.log('[MCP Bridge] Stream complete, total length:', accumulatedText.length);
                            // По завершении потока отправить итоговый полный текст
                            window.postMessage({
                                source: MESSAGE_SOURCE,
                                direction: 'to-content-script',
                                type: 'FETCH_RESPONSE_COMPLETE',
                                payload: { url: response.url, fullText: accumulatedText }
                            }, '*');
                            controller.close();
                            break;
                        }

                        // Декодировать текущий блок
                        const chunk = decoder.decode(value, { stream: true });
                        accumulatedText += chunk;

                        // Отправлять обновления при накоплении определённой длины или при обнаружении тега tool_code
                        if (accumulatedText.length - lastSentLength > 100 || accumulatedText.includes('</tool_code>')) {
                            window.postMessage({
                                source: MESSAGE_SOURCE,
                                direction: 'to-content-script',
                                type: 'FETCH_RESPONSE_CHUNK',
                                payload: { url: response.url, fullText: accumulatedText, isComplete: false }
                            }, '*');
                            lastSentLength = accumulatedText.length;
                        }

                        // Передать данные исходному потребителю
                        controller.enqueue(value);
                    }
                } catch (error) {
                    console.error('[MCP Bridge] Stream reading error:', error);
                    controller.error(error);
                }
            }
        });

        // Вернуть новый объект Response, использующий наш прокси-поток
        return new Response(stream, {
            headers: response.headers,
            status: response.status,
            statusText: response.statusText
        });
    }

    // --- Утилиты ---
    function shouldInterceptRequest(url) {
        try {
            const apiList = JSON.parse(localStorage.getItem('mcp_api_list') || '[]');
            if (!apiList || !url) {
                return false;
            }
            
            const currentHostname = window.location.hostname;
            
            const shouldIntercept = apiList.some(apiItem => {
                if (apiItem.hostname !== currentHostname) return false;
                const apis = Array.isArray(apiItem.api) ? apiItem.api : [apiItem.api];
                return apis.some(apiEndpoint => {
                    const matches = url.includes(apiEndpoint);
                    return matches;
                });
            });
            
            return shouldIntercept;
        } catch (e) {
            console.error('MCP Bridge: Error in shouldInterceptRequest:', e);
            return false;
        }
    }
})();