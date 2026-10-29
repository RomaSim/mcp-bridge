/**
 * options.js (Обновлено для отдельного представления «Менеджер сервисов»)
 *
 * Назначение: управляет всей логикой взаимодействия на странице настроек.
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM-элементы ---
    const elements = {
        mainNav: document.querySelector('.sidebar-nav'),
        views: document.querySelectorAll('.view'),
        siteList: document.getElementById('siteList'),
        serviceToggleList: document.getElementById('serviceToggleList'),
        configEditor: document.getElementById('configEditor'),
        reloadConfigButton: document.getElementById('reloadConfigButton'),
        saveConfigButton: document.getElementById('saveConfigButton'),
        replaceExistingServices: document.getElementById('replaceExistingServices'),
        version: document.getElementById('version')
    };

    // --- Состояние ---
    let currentConfig = {};
    let isSaving = false;
    let bridgePort = 3849; // Порт по умолчанию

    /**
     * Получить порт bridge-сервиса
     */
    async function getBridgePort() {
        const { bridge_port } = await chrome.storage.local.get('bridge_port');
        bridgePort = bridge_port || 3849;
        return bridgePort;
    }

    /**
     * Получить базовый URL
     */
    async function getBaseUrl() {
        await getBridgePort();
        return `http://localhost:${bridgePort}`;
    }

    async function initialize() {
        try {
            elements.version.textContent = `MCP Bridge v${chrome.runtime.getManifest().version}`;
            console.log('MCP Bridge: Version set');
            
            // Загрузить конфигурацию порта
            await loadPortConfig();
            
            await renderSiteList();
            console.log('MCP Bridge: Site list rendered');
            // При первой загрузке также загрузить конфигурацию, чтобы её закэшировать
            const configLoaded = await loadAndCacheConfig();
            bindEvents();
        } catch (error) {
            // Даже если при инициализации произошла ошибка, привязать события, чтобы UI оставался интерактивным
            try {
                bindEvents();
            } catch (bindError) {
                console.error('MCP Bridge: Error binding events', bindError);
            }
        }
        console.log('MCP Bridge: Initialization complete');
    }

    /**
     * Загрузить конфигурацию порта
     */
    async function loadPortConfig() {
        await getBridgePort();
        const portInput = document.getElementById('bridgePort');
        if (portInput) {
            portInput.value = bridgePort;
        }
    }

    /**
     * Сохранить конфигурацию порта
     */
    async function savePortConfig() {
        const portInput = document.getElementById('bridgePort');
        const saveButton = document.getElementById('savePortButton');
        
        const newPort = parseInt(portInput.value);
        
        if (!newPort || newPort < 1 || newPort > 65535) {
            toast('Введите корректный номер порта (1–65535)', 'error');
            return;
        }
        
        try {
            saveButton.disabled = true;
            saveButton.textContent = 'Сохранение...';
            
            await chrome.storage.local.set({ bridge_port: newPort });
            bridgePort = newPort;
            
            toast(`Порт сохранён как ${newPort}. Убедитесь, что сервис запущен на этом порту`, 'success');
        } catch (error) {
            toast('Не удалось сохранить порт', 'error');
        } finally {
            saveButton.disabled = false;
            saveButton.textContent = 'Сохранить';
        }
    }

    async function renderSiteList() {
        try {
            // Добавить механизм таймаута
            const storageData = await Promise.race([
                chrome.storage.local.get(['api_list', 'always_inject', 'disable_first_inject', 'conflict_disabled_sites', 'conflict_extension_cache']),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('chrome.storage.local.get timeout')), 5000)
                )
            ]);
            const { api_list, always_inject = {}, disable_first_inject = {}, conflict_disabled_sites = [], conflict_extension_cache } = storageData;
            if (!api_list) {
                return;
            }

            elements.siteList.innerHTML = '';
            for (const site of api_list) {
                const siteItem = document.createElement('li');
                siteItem.className = 'site-card';

                const firstInjectEnabled = !disable_first_inject[site.hostname];
                const isConflictDisabled = conflict_disabled_sites.includes(site.hostname);

                // Найти имя конфликтующего расширения
                let conflictExtName = '';
                if (conflict_extension_cache?.data) {
                    for (const ext of conflict_extension_cache.data) {
                        if (ext.affected_sites?.includes(site.hostname)) {
                            conflictExtName = ext.name || ext.extension_id || 'Неизвестное расширение';
                            break;
                        }
                    }
                }
                if (isConflictDisabled && !conflictExtName) {
                    try {
                        const localResp = await fetch(chrome.runtime.getURL('config/extension.json'));
                        if (localResp.ok) {
                            const localList = await localResp.json();
                            for (const ext of localList) {
                                if (ext.affected_sites?.includes(site.hostname)) {
                                    conflictExtName = ext.name || ext.extension_id || 'Неизвестное расширение';
                                    break;
                                }
                            }
                        }
                    } catch (e) { /* игнорировать */ }
                    if (!conflictExtName) conflictExtName = 'Неизвестное расширение';
                }

                siteItem.innerHTML = `
    <div class="site-card-header">
        <div class="site-avatar">${site.label.charAt(0)}</div>
        <div class="site-meta">
            <span class="site-name">${site.label}</span>
            <span class="site-domain">${site.hostname}</span>
        </div>
    </div>
    <div class="site-card-controls">
        <div class="toggle-row">
            <div class="toggle-info">
                <span class="toggle-label">Первое авто-внедрение</span>
                <span class="toggle-hint">Внедрять System Prompt при новом диалоге</span>
            </div>
            <label class="switch">
                <input type="checkbox" data-hostname="${site.hostname}" class="disable-first-inject-toggle" ${firstInjectEnabled ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>
        <div class="toggle-row">
            <div class="toggle-info">
                <span class="toggle-label">Внедрять каждый раз</span>
                <span class="toggle-hint">Вставлять список инструментов в каждое сообщение</span>
            </div>
            <label class="switch">
                <input type="checkbox" data-hostname="${site.hostname}" class="always-inject-toggle" ${always_inject[site.hostname] ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>
    </div>
    ${isConflictDisabled ? `
    <div class="conflict-banner">
        <span class="conflict-banner-icon">⚠️</span>
        <span>Из-за конфликта с расширением «${conflictExtName}» первое внедрение автоматически отключено</span>
    </div>
    ` : ''}
`;
                elements.siteList.appendChild(siteItem);
            }
        } catch (error) {
            console.error("MCP Bridge: Failed to render site list.", error);
            elements.siteList.innerHTML = '<li>Не удалось загрузить список сайтов.</li>';
        }
    }

    function renderServiceToggles() {
        elements.serviceToggleList.innerHTML = '';
        const services = currentConfig.mcpServers || {};

        if (Object.keys(services).length === 0) {
            elements.serviceToggleList.innerHTML = '<li class="service-card">В файле конфигурации пока нет сервисов.</li>';
            return;
        }

        for (const [name, config] of Object.entries(services)) {
            const isEnabled = config.enabled !== false;
            const item = document.createElement('li');
            item.className = 'service-card';
            item.innerHTML = `
                <div class="service-card-header">
                    <div class="service-card-info">
                        <span class="service-card-name">${name}</span>
                        <span class="service-card-desc">${config.description || 'Нет описания'}</span>
                    </div>
                </div>
                <div class="service-card-actions">
                    <div class="service-status" data-service-name="${name}">
                        <span class="status-dot checking"></span>
                        <span class="status-text">Проверка...</span>
                    </div>
                    <button class="btn btn-sm btn-secondary restart-button" data-service-name="${name}">Перезапустить</button>
                    <button class="btn btn-sm btn-danger delete-button" data-service-name="${name}">Удалить</button>
                    <label class="switch">
                        <input type="checkbox" data-service-name="${name}" class="service-toggle" ${isEnabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            `;
            elements.serviceToggleList.appendChild(item);
            
            // Проверить статус сервиса
            checkServiceStatus(name);
        }
        
        // Привязать события кнопок перезапуска
        bindRestartButtons();
        // Привязать события кнопок удаления
        bindDeleteButtons();
    }
    
    function bindDeleteButtons() {
        const deleteButtons = elements.serviceToggleList.querySelectorAll('.delete-button');
        deleteButtons.forEach(button => {
            button.addEventListener('click', handleDeleteService);
        });
    }
    
    async function handleDeleteService(event) {
        const button = event.currentTarget;
        const serviceName = button.dataset.serviceName;
        
        // Подтвердить удаление
        if (!confirm(`Вы уверены, что хотите удалить сервис "${serviceName}"? Это действие необратимо.`)) {
            return;
        }
        
        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '⏳ Удаление...';
        
        try {
            // Удалить из конфигурации
            if (currentConfig.mcpServers && currentConfig.mcpServers[serviceName]) {
                delete currentConfig.mcpServers[serviceName];
                
                // Сохранить конфигурацию
                const baseUrl = await getBaseUrl();
                const saveResponse = await fetch(`${baseUrl}/config`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ config: currentConfig })
                });
                
                if (!saveResponse.ok) {
                    const errorData = await saveResponse.json();
                    throw new Error(errorData.detail || 'Не удалось сохранить конфигурацию');
                }
                
                toast(`Сервис "${serviceName}" удалён`, 'success');
                
                // Перерисовать список сервисов
                renderServiceToggles();
            }
        } catch (error) {
            console.error('Не удалось удалить сервис:', error);
            toast(`Ошибка удаления: ${error.message}`, 'error');
            button.disabled = false;
            button.innerHTML = originalText;
            
            // Восстановить конфигурацию (если она была удалена)
            await loadAndCacheConfig(true);
        }
    }
    
    async function checkServiceStatus(serviceName) {
        const statusEl = elements.serviceToggleList.querySelector(`.service-status[data-service-name="${serviceName}"]`);
        if (!statusEl) return;
        
        const indicator = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');
        
        try {
            // Напрямую вызвать локальный API
            const baseUrl = await getBaseUrl();
            const response = await fetch(`${baseUrl}/tools?serverName=${encodeURIComponent(serviceName)}`);
            
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.tools) {
                    // Сервис работает нормально
                    indicator.className = 'status-dot running';
                    text.textContent = 'Работает';
                } else {
                    // Ответ получен, но с ошибкой
                    indicator.className = 'status-dot error';
                    text.textContent = 'Сбой';
                }
            } else if (response.status === 404) {
                // Сервис не запущен
                indicator.className = 'status-dot stopped';
                text.textContent = 'Остановлен';
            } else {
                // Прочая ошибка
                indicator.className = 'status-dot error';
                text.textContent = 'Ошибка';
            }
        } catch (error) {
            // Не удалось подключиться к серверу
            indicator.className = 'status-dot stopped';
            text.textContent = 'Не запущен';
        }
    }
    
    function bindRestartButtons() {
        const restartButtons = elements.serviceToggleList.querySelectorAll('.restart-button');
        restartButtons.forEach(button => {
            button.addEventListener('click', handleRestartService);
        });
    }
    
    async function handleRestartService(event) {
        const button = event.currentTarget;
        const serviceName = button.dataset.serviceName;
        const originalText = button.innerHTML;
        
        button.disabled = true;
        button.innerHTML = '⏳ Перезапуск...';
        
        try {
            // Напрямую вызвать локальный API для перезапуска сервиса
            const baseUrl = await getBaseUrl();
            const response = await fetch(`${baseUrl}/restart-server`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ serverName: serviceName })
            });
            
            const data = await response.json();
            
            if (response.ok && data.success) {
                toast(`Сервис "${serviceName}" успешно перезапущен!`, 'success');
                // Немного подождать перед проверкой статуса, чтобы сервис успел запуститься
                setTimeout(() => checkServiceStatus(serviceName), 1000);
            } else {
                toast(`Ошибка перезапуска: ${data.message || data.detail || 'Неизвестная ошибка'}`, 'error');
            }
        } catch (error) {
            console.error('Не удалось перезапустить сервис:', error);
            toast(`Ошибка перезапуска: ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }

    async function loadAndCacheConfig(forceReload = false) {
        // console.log(forceReload, currentConfig)
        if (!forceReload && Object.keys(currentConfig).length > 0) {
            return true; // возвращаем true — успех
        }

        try {
            // Добавить механизм таймаута, чтобы избежать бесконечного ожидания
            const message = { type: 'GET_CONFIG', payload: {} };
            const config = await chrome.runtime.sendMessage(message);
            if (config && config.error) {
                console.error('MCP Bridge: Config response contains error', config.error);
                throw new Error(config.error);
            }
            currentConfig = config || {};
            return true; // конфигурация успешно загружена
        } catch (error) {
            console.error('MCP Bridge: Failed to load config', error);
            currentConfig = {};
            // Показать сообщение об ошибке, но не прерывать процесс
            toast(`Не удалось загрузить конфигурацию: ${error.message}`, 'error');
            return false; // возвращаем false — загрузка не удалась
        }
    }

    async function populateServiceManagerView() {
        const success = await loadAndCacheConfig();
        if (success) {
            renderServiceToggles();
        }
    }

    async function populateServiceConfigView() {
        elements.configEditor.value = 'Загрузка конфигурации из локального сервиса...';
        elements.configEditor.disabled = true;
        elements.saveConfigButton.disabled = true;

        const success = await loadAndCacheConfig(true); // принудительно перезагрузить
        if (success) {
            elements.configEditor.value = JSON.stringify(currentConfig, null, 2);
            elements.configEditor.disabled = false;
        } else {
            elements.configEditor.value = `Не удалось загрузить конфигурацию.\n\nУбедитесь, что локальный сервис MCP Bridge запущен.`;
        }
    }

    function bindEvents() {
        if (elements.mainNav) {
            elements.mainNav.addEventListener('click', handleNavClick);
        } else {
            console.error('MCP Bridge: MainNav element not found');
        }
        
        // Кнопка сохранения порта
        const savePortButton = document.getElementById('savePortButton');
        if (savePortButton) {
            savePortButton.addEventListener('click', savePortConfig);
        }
        
        if (elements.siteList) {
            elements.siteList.addEventListener('change', handleSiteToggleChange);
        } else {
            console.error('MCP Bridge: SiteList element not found');
        }
        
        if (elements.serviceToggleList) {
            elements.serviceToggleList.addEventListener('change', handleServiceToggleChange);
        } else {
            console.error('MCP Bridge: ServiceToggleList element not found');
        }
        
        if (elements.configEditor) {
            elements.configEditor.addEventListener('input', () => {
                elements.saveConfigButton.disabled = false;
            });
        } else {
            console.error('MCP Bridge: ConfigEditor element not found');
        }
        
        if (elements.reloadConfigButton) {
            elements.reloadConfigButton.addEventListener('click', populateServiceConfigView);
        } else {
            console.error('MCP Bridge: ReloadConfigButton element not found');
        }
        
        if (elements.saveConfigButton) {
            elements.saveConfigButton.addEventListener('click', () => handleSaveConfig(true));
        } else {
            console.error('MCP Bridge: SaveConfigButton element not found');
        }
    }

    // Исправление: пометить функцию handleNavClick как async
    async function handleNavClick(event) {
        const navItem = event.target.closest('.nav-item');

        // Если элемент навигации не найден — сразу выйти
        if (!navItem) {
            return;
        }
        
        // Если кликнули по уже активному элементу — тоже выйти
        if (navItem.classList.contains('active')) {
            return;
        }

        // Безопасно снять класс active с текущего активного элемента навигации
        const activeNavItem = document.querySelector('.sidebar-nav .nav-item.active');
        if (activeNavItem) {
            activeNavItem.classList.remove('active');
        }
        navItem.classList.add('active');

        elements.views.forEach(view => view.classList.remove('active'));
        const targetViewId = navItem.dataset.view;
        const targetView = document.getElementById(targetViewId);
        if (targetView) {
            targetView.classList.add('active');

            // Выполнить специфичную логику в зависимости от активированного представления
            if (targetViewId === 'service-manager-view') {
                await populateServiceManagerView();
            } else if (targetViewId === 'service-config-view') {
                await populateServiceConfigView();
            }
        }
    }

    async function handleSiteToggleChange(event) {
        if (event.target.classList.contains('always-inject-toggle')) {
            const hostname = event.target.dataset.hostname;
            const isEnabled = event.target.checked;
            try {
                const { always_inject = {} } = await chrome.storage.local.get('always_inject');
                always_inject[hostname] = isEnabled;
                await chrome.storage.local.set({ always_inject });
                toast(`Для ${hostname} ${isEnabled ? 'включено' : 'выключено'} внедрение каждый раз`);
            } catch (error) {
                toast('Не удалось сохранить настройку', 'error');
            }
        } else if (event.target.classList.contains('disable-first-inject-toggle')) {
            const hostname = event.target.dataset.hostname;
            const checked = event.target.checked;
            try {
                const storage = await chrome.storage.local.get(['disable_first_inject', 'conflict_disabled_sites']);
                const disable_first_inject = storage.disable_first_inject || {};
                const conflict_disabled_sites = storage.conflict_disabled_sites || [];

                disable_first_inject[hostname] = !checked;

                // Пользователь вручную включил обратно — удалить из списка отключённых из-за конфликта
                if (checked && conflict_disabled_sites.includes(hostname)) {
                    const idx = conflict_disabled_sites.indexOf(hostname);
                    conflict_disabled_sites.splice(idx, 1);
                }

                await chrome.storage.local.set({ disable_first_inject, conflict_disabled_sites });
                toast(`Для ${hostname} ${checked ? 'включено' : 'выключено'} первое авто-внедрение`);
            } catch (error) {
                toast('Не удалось сохранить настройку', 'error');
            }
        }
    }

    async function handleServiceToggleChange(event) {
        const toggle = event.target.closest('.service-toggle');
        if (!toggle) return;

        const serviceName = toggle.dataset.serviceName;
        const isEnabled = toggle.checked;

        currentConfig.mcpServers[serviceName].enabled = isEnabled;

        if (isEnabled) {
            await enableService(serviceName);
        } else {
            await disableService(serviceName);
        }
    }

    /**
     * Объединить конфигурации сервисов
     * @param {Object} target - Целевой объект конфигурации
     * @param {Object} source - Исходный объект конфигурации
     * @param {boolean} shouldReplace - Заменять ли уже существующие сервисы
     * @returns {Object} - {added: [], skipped: [], replaced: []}
     */
    function mergeServices(target, source, shouldReplace) {
        const added = [];
        const skipped = [];
        const replaced = [];

        for (const [name, config] of Object.entries(source)) {
            if (target[name]) {
                // Сервис уже существует
                if (shouldReplace) {
                    target[name] = config;
                    replaced.push(name);
                } else {
                    skipped.push(name);
                }
            } else {
                // Новый сервис
                target[name] = config;
                added.push(name);
            }
        }

        return { added, skipped, replaced };
    }

    /**
     * Показать результат объединения
     */
    function showMergeResult(added, skipped, replaced) {
        const messages = [];
        if (added.length > 0) {
            messages.push(`✅ Добавлено сервисов: ${added.length}`);
        }
        if (replaced.length > 0) {
            messages.push(`🔄 Заменено сервисов: ${replaced.length}`);
        }
        if (skipped.length > 0) {
            messages.push(`⏭️ Пропущено уже существующих сервисов: ${skipped.length}`);
        }

        if (messages.length > 0) {
            toast(messages.join(' | '), 'success');
        } else {
            toast('Конфигурация обновлена', 'success');
        }
    }

    async function handleServiceToggleChange(event) {
        const toggle = event.target;
        if (!toggle.classList.contains('service-toggle')) return;

        const serviceName = toggle.dataset.serviceName;
        const isEnabled = toggle.checked;

        if (currentConfig.mcpServers && currentConfig.mcpServers[serviceName]) {
            const originalValue = currentConfig.mcpServers[serviceName].enabled;
            
            // Обновить локальную конфигурацию
            currentConfig.mcpServers[serviceName].enabled = isEnabled;
            
            if (isEnabled) {
                // Включить сервис: сохранить конфигурацию и перезапустить сервис
                await handleEnableService(serviceName);
            } else {
                // Отключить сервис: сразу закрыть сервис
                await handleDisableService(serviceName);
            }
        }
    }
    
    async function handleEnableService(serviceName) {
        try {
            // Напрямую вызвать локальный API для сохранения конфигурации (без перезагрузки)
            const baseUrl = await getBaseUrl();
            const saveResponse = await fetch(`${baseUrl}/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ config: currentConfig })
            });
            
            if (!saveResponse.ok) {
                const errorData = await saveResponse.json();
                throw new Error(errorData.detail || 'Не удалось сохранить конфигурацию');
            }
            
            // Конфигурация успешно сохранена, подождать завершения перезагрузки
            // Примечание: эндпоинт POST /config автоматически перезагружает все сервисы
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            toast(`Сервис "${serviceName}" включён`, 'success');
            // Обновить отображение статуса
            checkServiceStatus(serviceName);
        } catch (error) {
            console.error('Не удалось включить сервис:', error);
            toast(`Ошибка включения: ${error.message}`, 'error');
            // Откатить состояние переключателя
            const toggle = elements.serviceToggleList.querySelector(
                `.service-toggle[data-service-name="${serviceName}"]`
            );
            if (toggle) toggle.checked = false;
            currentConfig.mcpServers[serviceName].enabled = false;
        }
    }
    
    async function handleDisableService(serviceName) {
        try {
            // Сначала закрыть сервис
            const baseUrl = await getBaseUrl();
            const shutdownResponse = await fetch(`${baseUrl}/shutdown-server`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ serverName: serviceName })
            });
            
            const shutdownData = await shutdownResponse.json();
            
            if (!shutdownResponse.ok || !shutdownData.success) {
                throw new Error(shutdownData.message || shutdownData.detail || 'Не удалось закрыть сервис');
            }
            
            // После успешного закрытия сервиса напрямую вызвать локальный API для сохранения конфигурации
            // Использовать эндпоинт GET /config, чтобы прочитать текущую конфигурацию, затем обновить её
            const getResponse = await fetch(`${baseUrl}/config`);
            const getResult = await getResponse.json();
            
            if (getResult.success && getResult.config) {
                // Обновить состояние enabled в конфигурации
                if (getResult.config.mcpServers && getResult.config.mcpServers[serviceName]) {
                    getResult.config.mcpServers[serviceName].enabled = false;
                    
                    // Сохранить конфигурацию (это вызовет перезагрузку, но сервис уже закрыт и не будет перезапущен)
                    const saveResponse = await fetch(`${baseUrl}/config`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ config: getResult.config })
                    });
                    
                    if (!saveResponse.ok) {
                        const errorData = await saveResponse.json();
                        console.warn('Не удалось сохранить конфигурацию, но сервис уже закрыт:', errorData);
                    }
                }
            }
            
            toast(`Сервис "${serviceName}" отключён`, 'success');
            // Обновить отображение статуса
            setTimeout(() => checkServiceStatus(serviceName), 500);
        } catch (error) {
            console.error('Не удалось отключить сервис:', error);
            toast(`Ошибка отключения: ${error.message}`, 'error');
            // Откатить состояние переключателя
            const toggle = elements.serviceToggleList.querySelector(
                `.service-toggle[data-service-name="${serviceName}"]`
            );
            if (toggle) toggle.checked = true;
            currentConfig.mcpServers[serviceName].enabled = true;
        }
    }

    async function handleSaveConfig(isManual = false) {
        if (isSaving) return;
        isSaving = true;

        let configJson;
        try {
            if (isManual) {
                const inputJson = JSON.parse(elements.configEditor.value);
                const shouldReplace = elements.replaceExistingServices.checked;
                
                // Интеллектуальное распознавание формата конфигурации
                if (inputJson.mcpServers) {
                    // Формат 1: полный формат {mcpServers: {...}}
                    configJson = currentConfig;
                    if (!configJson.mcpServers) {
                        configJson.mcpServers = {};
                    }
                    
                    // В зависимости от переключателя выбрать стратегию объединения
                    const { added, skipped, replaced } = mergeServices(
                        configJson.mcpServers, 
                        inputJson.mcpServers, 
                        shouldReplace
                    );
                    
                    // Показать результат объединения
                    showMergeResult(added, skipped, replaced);
                    
                } else {
                    // Формат 2: конфигурация одного сервиса {command: ..., args: ..., description: ...}
                    // Проверить, является ли это корректной конфигурацией сервиса
                    if (inputJson.command || inputJson.type) {
                        // Попросить пользователя ввести имя сервиса
                        const serviceName = prompt('Введите имя этого сервиса:');
                        if (!serviceName) {
                            toast('Добавление сервиса отменено', 'error');
                            isSaving = false;
                            return;
                        }
                        
                        // Добавить в существующую конфигурацию
                        configJson = currentConfig;
                        if (!configJson.mcpServers) {
                            configJson.mcpServers = {};
                        }
                        
                        // Проверить, существует ли уже
                        if (configJson.mcpServers[serviceName] && !shouldReplace) {
                            toast(`Сервис "${serviceName}" уже существует, пропущено`, 'warning');
                            isSaving = false;
                            return;
                        }
                        
                        configJson.mcpServers[serviceName] = inputJson;
                        toast(`Сервис "${serviceName}" ${configJson.mcpServers[serviceName] ? 'заменён' : 'добавлен'}`, 'success');
                        
                    } else {
                        // Формат 3: возможно, объект с несколькими сервисами
                        configJson = currentConfig;
                        if (!configJson.mcpServers) {
                            configJson.mcpServers = {};
                        }
                        
                        // В зависимости от переключателя выбрать стратегию объединения
                        const { added, skipped, replaced } = mergeServices(
                            configJson.mcpServers, 
                            inputJson, 
                            shouldReplace
                        );
                        
                        // Показать результат объединения
                        showMergeResult(added, skipped, replaced);
                    }
                }
                
                currentConfig = configJson;
                // Обновить отображение редактора полной конфигурацией
                elements.configEditor.value = JSON.stringify(currentConfig, null, 2);
            } else {
                configJson = currentConfig;
            }
        } catch (error) {
            toast('Конфигурация не является корректным JSON. Проверьте её.', 'error');
            isSaving = false;
            return;
        }

        if (isManual) {
            elements.saveConfigButton.disabled = true;
            elements.saveConfigButton.textContent = 'Сохранение...';
        }

        try {
            // Добавить механизм таймаута
            const response = await Promise.race([
                chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG', payload: configJson }),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('UPDATE_CONFIG timeout after 5 seconds')), 5000)
                )
            ]);
            
            if (response && response.error) throw new Error(response.error);

            toast(isManual ? 'Конфигурация сохранена и перезагружена!' : `Конфигурация сервисов обновлена и перезагружена!`, 'success');

            // Если операция выполняется на странице менеджера сервисов, нужно перерисовать переключатели
            if (document.getElementById('service-manager-view').classList.contains('active')) {
                renderServiceToggles();
            }
        } catch (error) {
            toast(`Ошибка сохранения: ${error.message}`, 'error');
        } finally {
            if (isManual) {
                elements.saveConfigButton.textContent = '💾 Сохранить и перезагрузить сервисы';
                elements.saveConfigButton.disabled = true; // После ручного сохранения кнопка должна быть отключена до следующего изменения
            }
            isSaving = false;
        }
    }

    function toast(message, type = 'success') {
        const toastEl = document.createElement('div');
        toastEl.className = 'toast';
        toastEl.textContent = message;
        if (type === 'error') {
            toastEl.style.backgroundColor = 'var(--danger-color)';
        }
        document.body.appendChild(toastEl);
        setTimeout(() => toastEl.remove(), 3000);
    }

    initialize();
});