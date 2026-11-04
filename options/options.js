/**
 * options.js (Обновлено для отдельного представления «Менеджер сервисов»)
 *
 * + Настройка задержки и максимального числа попыток при rate-limit
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
        version: document.getElementById('version'),
        retryDelayMs: document.getElementById('retryDelayMs'),
        retryMaxAttempts: document.getElementById('retryMaxAttempts'),
        saveRetryDelayButton: document.getElementById('saveRetryDelayButton')
    };

    // --- Состояние ---
    let currentConfig = {};
    let isSaving = false;
    let bridgePort = 3849;

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

            await loadPortConfig();
            await loadRetryDelayConfig();
            await renderSiteList();
            console.log('MCP Bridge: Site list rendered');
            const configLoaded = await loadAndCacheConfig();
            bindEvents();
        } catch (error) {
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

    /**
     * Загрузить настройки повтора при rate-limit
     */
    async function loadRetryDelayConfig() {
        const {
            retry_delay_ms = 300000,
            retry_max_attempts = 3
        } = await chrome.storage.local.get(['retry_delay_ms', 'retry_max_attempts']);

        if (elements.retryDelayMs) {
            elements.retryDelayMs.value = retry_delay_ms;
        }
        if (elements.retryMaxAttempts) {
            elements.retryMaxAttempts.value = retry_max_attempts;
        }
    }

    /**
     * Сохранить настройки повтора при rate-limit
     */
    async function saveRetryDelayConfig() {
        if (!elements.retryDelayMs || !elements.retryMaxAttempts || !elements.saveRetryDelayButton) return;

        const rawDelay = parseInt(elements.retryDelayMs.value, 10);
        const delay = Math.max(60000, isNaN(rawDelay) ? 300000 : rawDelay);

        const rawAttempts = parseInt(elements.retryMaxAttempts.value, 10);
        const attempts = Math.min(20, Math.max(1, isNaN(rawAttempts) ? 3 : rawAttempts));

        if (rawDelay < 60000) {
            toast('Минимальная задержка — 60000 мс (1 минута)', 'error');
        }
        if (rawAttempts < 1 || rawAttempts > 20) {
            toast('Число попыток должно быть от 1 до 20', 'error');
        }

        elements.retryDelayMs.value = delay;
        elements.retryMaxAttempts.value = attempts;

        try {
            elements.saveRetryDelayButton.disabled = true;
            elements.saveRetryDelayButton.textContent = 'Сохранение...';
            await chrome.storage.local.set({
                retry_delay_ms: delay,
                retry_max_attempts: attempts
            });
            toast(`Сохранено: задержка ${Math.round(delay / 1000)} сек, попыток ${attempts}`, 'success');
        } catch (error) {
            toast('Не удалось сохранить настройки', 'error');
        } finally {
            elements.saveRetryDelayButton.disabled = false;
            elements.saveRetryDelayButton.textContent = 'Сохранить';
        }
    }

    async function renderSiteList() {
        try {
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

            checkServiceStatus(name);
        }

        bindRestartButtons();
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

        if (!confirm(`Вы уверены, что хотите удалить сервис "${serviceName}"? Это действие необратимо.`)) {
            return;
        }

        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '⏳ Удаление...';

        try {
            if (currentConfig.mcpServers && currentConfig.mcpServers[serviceName]) {
                delete currentConfig.mcpServers[serviceName];

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

                renderServiceToggles();
            }
        } catch (error) {
            console.error('Не удалось удалить сервис:', error);
            toast(`Ошибка удаления: ${error.message}`, 'error');
            button.disabled = false;
            button.innerHTML = originalText;

            await loadAndCacheConfig(true);
        }
    }

    async function checkServiceStatus(serviceName) {
        const statusEl = elements.serviceToggleList.querySelector(`.service-status[data-service-name="${serviceName}"]`);
        if (!statusEl) return;

        const indicator = statusEl.querySelector('.status-dot');
        const text = statusEl.querySelector('.status-text');

        try {
            const baseUrl = await getBaseUrl();
            const response = await fetch(`${baseUrl}/tools?serverName=${encodeURIComponent(serviceName)}`);

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.tools) {
                    indicator.className = 'status-dot running';
                    text.textContent = 'Работает';
                } else {
                    indicator.className = 'status-dot error';
                    text.textContent = 'Сбой';
                }
            } else if (response.status === 404) {
                indicator.className = 'status-dot stopped';
                text.textContent = 'Остановлен';
            } else {
                indicator.className = 'status-dot error';
                text.textContent = 'Ошибка';
            }
        } catch (error) {
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
        if (!forceReload && Object.keys(currentConfig).length > 0) {
            return true;
        }

        try {
            const message = { type: 'GET_CONFIG', payload: {} };
            const config = await chrome.runtime.sendMessage(message);
            if (config && config.error) {
                console.error('MCP Bridge: Config response contains error', config.error);
                throw new Error(config.error);
            }
            currentConfig = config || {};
            return true;
        } catch (error) {
            console.error('MCP Bridge: Failed to load config', error);
            currentConfig = {};
            toast(`Не удалось загрузить конфигурацию: ${error.message}`, 'error');
            return false;
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

        const success = await loadAndCacheConfig(true);
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

        const savePortButton = document.getElementById('savePortButton');
        if (savePortButton) {
            savePortButton.addEventListener('click', savePortConfig);
        }

        if (elements.saveRetryDelayButton) {
            elements.saveRetryDelayButton.addEventListener('click', saveRetryDelayConfig);
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

    async function handleNavClick(event) {
        const navItem = event.target.closest('.nav-item');

        if (!navItem) {
            return;
        }

        if (navItem.classList.contains('active')) {
            return;
        }

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

        if (currentConfig.mcpServers && currentConfig.mcpServers[serviceName]) {
            const originalValue = currentConfig.mcpServers[serviceName].enabled;
            currentConfig.mcpServers[serviceName].enabled = isEnabled;

            if (isEnabled) {
                await handleEnableService(serviceName);
            } else {
                await handleDisableService(serviceName);
            }
        }
    }

    function mergeServices(target, source, shouldReplace) {
        const added = [];
        const skipped = [];
        const replaced = [];

        for (const [name, config] of Object.entries(source)) {
            if (target[name]) {
                if (shouldReplace) {
                    target[name] = config;
                    replaced.push(name);
                } else {
                    skipped.push(name);
                }
            } else {
                target[name] = config;
                added.push(name);
            }
        }

        return { added, skipped, replaced };
    }

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

    async function handleEnableService(serviceName) {
        try {
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

            await new Promise(resolve => setTimeout(resolve, 1500));

            toast(`Сервис "${serviceName}" включён`, 'success');
            checkServiceStatus(serviceName);
        } catch (error) {
            console.error('Не удалось включить сервис:', error);
            toast(`Ошибка включения: ${error.message}`, 'error');
            const toggle = elements.serviceToggleList.querySelector(
                `.service-toggle[data-service-name="${serviceName}"]`
            );
            if (toggle) toggle.checked = false;
            currentConfig.mcpServers[serviceName].enabled = false;
        }
    }

    async function handleDisableService(serviceName) {
        try {
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

            const getResponse = await fetch(`${baseUrl}/config`);
            const getResult = await getResponse.json();

            if (getResult.success && getResult.config) {
                if (getResult.config.mcpServers && getResult.config.mcpServers[serviceName]) {
                    getResult.config.mcpServers[serviceName].enabled = false;

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
            setTimeout(() => checkServiceStatus(serviceName), 500);
        } catch (error) {
            console.error('Не удалось отключить сервис:', error);
            toast(`Ошибка отключения: ${error.message}`, 'error');
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

                if (inputJson.mcpServers) {
                    configJson = currentConfig;
                    if (!configJson.mcpServers) {
                        configJson.mcpServers = {};
                    }

                    const { added, skipped, replaced } = mergeServices(
                        configJson.mcpServers,
                        inputJson.mcpServers,
                        shouldReplace
                    );

                    showMergeResult(added, skipped, replaced);

                } else {
                    if (inputJson.command || inputJson.type) {
                        const serviceName = prompt('Введите имя этого сервиса:');
                        if (!serviceName) {
                            toast('Добавление сервиса отменено', 'error');
                            isSaving = false;
                            return;
                        }

                        configJson = currentConfig;
                        if (!configJson.mcpServers) {
                            configJson.mcpServers = {};
                        }

                        if (configJson.mcpServers[serviceName] && !shouldReplace) {
                            toast(`Сервис "${serviceName}" уже существует, пропущено`, 'warning');
                            isSaving = false;
                            return;
                        }

                        configJson.mcpServers[serviceName] = inputJson;
                        toast(`Сервис "${serviceName}" ${configJson.mcpServers[serviceName] ? 'заменён' : 'добавлен'}`, 'success');

                    } else {
                        configJson = currentConfig;
                        if (!configJson.mcpServers) {
                            configJson.mcpServers = {};
                        }

                        const { added, skipped, replaced } = mergeServices(
                            configJson.mcpServers,
                            inputJson,
                            shouldReplace
                        );

                        showMergeResult(added, skipped, replaced);
                    }
                }

                currentConfig = configJson;
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
            const response = await Promise.race([
                chrome.runtime.sendMessage({ type: 'UPDATE_CONFIG', payload: configJson }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('UPDATE_CONFIG timeout after 5 seconds')), 5000)
                )
            ]);

            if (response && response.error) throw new Error(response.error);

            toast(isManual ? 'Конфигурация сохранена и перезагружена!' : `Конфигурация сервисов обновлена и перезагружена!`, 'success');

            if (document.getElementById('service-manager-view').classList.contains('active')) {
                renderServiceToggles();
            }
        } catch (error) {
            toast(`Ошибка сохранения: ${error.message}`, 'error');
        } finally {
            if (isManual) {
                elements.saveConfigButton.textContent = '💾 Сохранить и перезагрузить сервисы';
                elements.saveConfigButton.disabled = true;
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