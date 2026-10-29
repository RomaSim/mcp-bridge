/**
 * api_client.js
 *
 * Назначение: инкапсулирует всё API-взаимодействие с локальным MCP Bridge Server (localhost:3849).
 * Предоставляет набор простых асинхронных функций для вызова из background.js.
 * Централизованно обрабатывает сетевые запросы, построение URL и базовую обработку ошибок.
 */

/**
 * Получить порт bridge-сервиса из chrome.storage
 * @returns {Promise<number>} - Номер порта, по умолчанию 3849
 */
async function getBridgePort() {
    try {
        const { bridge_port } = await chrome.storage.local.get('bridge_port');
        return bridge_port || 3849;
    } catch (error) {
        console.warn('MCP Bridge: Failed to get bridge port, using default 3849', error);
        return 3849;
    }
}

/**
 * Получить базовый URL
 * @returns {Promise<string>} - Базовый URL
 */
async function getBaseUrl() {
    const port = await getBridgePort();
    return `http://localhost:${port}`;
}

/**
 * Обёртка fetch с таймаутом и единой обработкой ошибок.
 * @param {string} url - Целевой URL.
 * @param {RequestInit} options - Опции конфигурации fetch.
 * @param {number} timeout - Таймаут (мс).
 * @returns {Promise<any>} - Разобранные JSON-данные.
 */
async function fetchWithTimeout(url, options = {}, timeout = 5000) {
    const controller = new AbortController();
    const id = setTimeout(() => {
        controller.abort();
    }, timeout);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        clearTimeout(id);

        if (!response.ok) {
            // Попытаться разобрать тело ответа с ошибкой
            let errorData;
            try {
                errorData = await response.json();
            } catch (e) {
                errorData = { detail: `HTTP error! status: ${response.status}` };
            }
            
            // Формат ошибки, возвращаемый FastAPI: { detail: ... }
            // detail может быть строкой или объектом
            let errorMessage = '';
            if (typeof errorData.detail === 'object') {
                // Объект подробной ошибки
                errorMessage = errorData.detail.error || JSON.stringify(errorData.detail);
            } else {
                // Строковая ошибка
                errorMessage = errorData.detail || errorData.error || `HTTP error! status: ${response.status}`;
            }
            
            // Сохранить полную информацию об ошибке для дальнейшего использования
            const error = new Error(errorMessage);
            error.details = errorData.detail;
            error.status = response.status;
            throw error;
        }

        const jsonData = await response.json();
        return jsonData;
    } catch (error) {
        clearTimeout(id);
        if (error.name === 'AbortError') {
            console.error('MCP Bridge: Fetch aborted due to timeout', url);
            throw new Error('Превышено время ожидания запроса. Проверьте, запущен ли сервис MCP Bridge.');
        }
        // Пробросить более конкретное сообщение об ошибке
        console.error('MCP Bridge: Fetch error', error);
        throw new Error(error.message || 'Сетевой запрос не удался. Не удалось подключиться к сервису MCP Bridge.');
    }
}

/**
 * Проверить состояние локального MCP Bridge Server.
 * @returns {Promise<{status: string}>}
 */
export async function checkHealth() {
    const baseUrl = await getBaseUrl();
    return await fetchWithTimeout(`${baseUrl}/health`, {}, 2000);
}

/**
 * Получить список всех загруженных сервисов и их описания (первый уровень обнаружения).
 * @returns {Promise<Array<{name: string, description: string}>>}
 */
export async function getServices() {
    const baseUrl = await getBaseUrl();
    const data = await fetchWithTimeout(`${baseUrl}/tools`);
    if (data && data.success && Array.isArray(data.services)) {
        return data.services;
    }
    throw new Error('Не удалось получить список сервисов от Bridge-сервиса или формат неверен.');
}

/**
 * Получить все конкретные инструменты указанного сервиса по имени сервиса (второй уровень обнаружения).
 * @param {string} serverName - Имя сервиса.
 * @returns {Promise<{service_name: string, service_description: string, tools: Array<Object>}>} - Объект, содержащий информацию о сервисе и список инструментов.
 */
export async function getToolsByServer(serverName) {
    const baseUrl = await getBaseUrl();
    const url = new URL(`${baseUrl}/tools`);
    url.searchParams.append('serverName', serverName);
    const data = await fetchWithTimeout(url.toString());
    if (data && data.success) {
        // Сервер теперь возвращает { success: true, tools: { service_name, service_description, tools: [...] } }
        // или, возможно, { success: true, tools: {...} }
        return data.tools;
    }
    throw new Error(`Не удалось получить список инструментов для "${serverName}" от Bridge-сервиса.`);
}

/**
 * Выполнить указанный инструмент.
 * @param {string} toolName - Имя инструмента.
 * @param {Object} args - Параметры инструмента.
 * @returns {Promise<any>} - Результат выполнения инструмента.
 */
export async function executeTool(toolName, args) {
    const baseUrl = await getBaseUrl();
    const data = await fetchWithTimeout(`${baseUrl}/execute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            name: toolName,
            arguments: args
        })
    }, 120000); // Выполнение инструмента может быть долгим, поэтому установлен более длительный таймаут (2 минуты)

    if (data && data.success) {
        // Проверить, является ли это ссылкой на кэш
        if (data.result_type === 'cached_reference') {
            // Вернуть полную информацию о кэше
            return {
                result_type: data.result_type,
                cache_id: data.cache_id,
                cache_type: data.cache_type,
                total_size: data.total_size,
                message: data.message
            };
        }
        // Обычный результат, вернуть поле result
        return data.result;
    }
    throw new Error(data.error || `Не удалось выполнить инструмент "${toolName}".`);
}

/**
 * Получить содержимое удалённого mcp-config.json.
 * @returns {Promise<Object>}
 */
export async function getConfig() {
    console.log('MCP Bridge: Fetching config')
    try {
        const baseUrl = await getBaseUrl();
        const data = await fetchWithTimeout(`${baseUrl}/config`);
        if (data && data.success) {
            return data.config;
        }
        const error = new Error('Не удалось получить удалённую конфигурацию.');
        console.error('MCP Bridge: Config retrieval failed', error);
        throw error;
    } catch (error) {
        console.error('MCP Bridge: Error getting config', error);
        // Добавить больше информации об ошибке
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            throw new Error('Не удалось подключиться к локальному MCP Bridge. Убедитесь, что сервис запущен.');
        }
        throw error;
    }
}

/**
 * Обновить содержимое mcp-config.json и запустить перезагрузку.
 * @param {Object} newConfig - Новый объект конфигурации.
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function updateConfig(newConfig) {
    const baseUrl = await getBaseUrl();
    return await fetchWithTimeout(`${baseUrl}/config`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ config: newConfig })
    });
}

/**
 * Получить кэшированный результат (полный или по частям)
 * @param {string} cacheId - ID кэша
 * @param {number} [start] - Необязательно, начальная позиция (индекс символа)
 * @param {number} [end] - Необязательно, конечная позиция (индекс символа)
 * @returns {Promise<Object>} - Объект, содержащий content и metadata
 */
export async function getCachedResult(cacheId, start = null, end = null) {
    const baseUrl = await getBaseUrl();
    const url = new URL(`${baseUrl}/result/${cacheId}`);
    
    if (start !== null && start !== undefined) {
        url.searchParams.append('start', start);
    }
    if (end !== null && end !== undefined) {
        url.searchParams.append('end', end);
    }
    
    const data = await fetchWithTimeout(url.toString(), {}, 30000); // Таймаут 30 секунд
    
    if (data && data.success) {
        return {
            content: data.result,
            metadata: data.metadata || {}
        };
    }
    
    throw new Error(data.error || 'Не удалось получить кэшированный результат');
}

/**
 * Найти ключевое слово в содержимом кэша
 * @param {string} cacheId - ID кэша
 * @param {string} keyword - Ключевое слово для поиска
 * @param {boolean} [caseSensitive] - Учитывать ли регистр, по умолчанию false
 * @param {number} [maxResults] - Максимальное количество возвращаемых результатов, по умолчанию 50
 * @returns {Promise<Object>} - Результаты поиска, содержащие номера строк, столбцы и фрагменты содержимого
 */
export async function searchCachedResult(cacheId, keyword, caseSensitive = false, maxResults = 50) {
    const baseUrl = await getBaseUrl();
    const data = await fetchWithTimeout(`${baseUrl}/search-cache`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            cache_id: cacheId,
            keyword: keyword,
            case_sensitive: caseSensitive,
            max_results: maxResults
        })
    }, 30000); // Таймаут 30 секунд
    
    if (data && data.success) {
        return data.result;
    }
    
    throw new Error(data.error || 'Не удалось выполнить поиск в кэше');
}

/**
 * Получить контекст указанной строки в кэше
 * @param {string} cacheId - ID кэша
 * @param {number} lineNum - Целевой номер строки (начиная с 1)
 * @param {number} [contextLines] - Количество строк контекста, по умолчанию 3
 * @returns {Promise<Object>} - Содержимое, включающее целевую строку и контекст
 */
export async function getCacheContext(cacheId, lineNum, contextLines = 3) {
    const baseUrl = await getBaseUrl();
    const data = await fetchWithTimeout(`${baseUrl}/get-cache-context`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            cache_id: cacheId,
            line_num: lineNum,
            context_lines: contextLines
        })
    }, 30000); // Таймаут 30 секунд
    
    if (data && data.success) {
        return data.result;
    }
    
    throw new Error(data.error || 'Не удалось получить контекст');
}