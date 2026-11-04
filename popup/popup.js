/**
 * popup.js
 *
 * Назначение: управляет логикой взаимодействия во всплывающем окне расширения.
 *   - Инициализирует состояние UI (чтение из storage).
 *   - Проверяет и отображает состояние подключения к локальному Bridge Server.
 *   - Обрабатывает действия пользователя (например, переключение глобального выключателя).
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM-элементы ---
    const globalEnableToggle = document.getElementById('globalEnableToggle');
    const autoSubmitToggle = document.getElementById('autoSubmitToggle');
    const refreshPromptButton = document.getElementById('refreshPromptButton');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const openOptionsButton = document.getElementById('openOptionsButton');
    const newVersionText = document.getElementById('newVersionText');

    async function initialize() {
        try {
            const { mcp_enabled, auto_submit_prompt } = await chrome.storage.local.get({ 
                mcp_enabled: true,
                auto_submit_prompt: false
            });
            globalEnableToggle.checked = mcp_enabled;
            autoSubmitToggle.checked = auto_submit_prompt;
        } catch (error) {
            console.error("MCP Bridge: Error loading global state.", error);
            globalEnableToggle.checked = true;
            autoSubmitToggle.checked = false;
        }

        await checkBridgeStatus();
        bindEventListeners();
    }

    async function checkBridgeStatus() {
        updateStatusUI('checking', 'Проверка...');

        try {
            // Запустить проверку здоровья через фоновый скрипт
            const response = await chrome.runtime.sendMessage({ type: 'CHECK_HEALTH' });

            // Проверка надёжности: убедиться, что response существует
            if (!response) {
                throw new Error("Пустой ответ, полученный от фонового скрипта.");
            }

            if (response.status === 'ok') {
                updateStatusUI('connected', 'Сервис подключён');
            } else {
                // Если в response есть поле error, использовать его
                throw new Error(response.error || 'Неизвестный формат ответа');
            }
        } catch (error) {
            console.warn("MCP Bridge: Health check failed.", error.message);
            updateStatusUI('disconnected', 'Сервис не подключён');
        }
    }

    function updateStatusUI(state, text) {
        statusDot.className = 'status-dot'; // Сбросить классы
        statusText.className = 'status-text';

        statusDot.classList.add(state);
        statusText.classList.add(state);
        statusText.textContent = text;
    }

    function bindEventListeners() {
        globalEnableToggle.addEventListener('change', handleGlobalToggle);
        autoSubmitToggle.addEventListener('change', handleAutoSubmitToggle);
        refreshPromptButton.addEventListener('click', handleRefreshPrompt);
        openOptionsButton.addEventListener('click', (e) => {
            e.preventDefault();
            chrome.runtime.openOptionsPage();
        });
    }

    async function handleGlobalToggle(event) {
        const isEnabled = event.target.checked;
        try {
            await chrome.storage.local.set({ mcp_enabled: isEnabled });
        } catch (error) {
            console.error("MCP Bridge: Error saving global state.", error);
        }
    }

    async function handleAutoSubmitToggle(event) {
        const autoSubmit = event.target.checked;
        try {
            await chrome.storage.local.set({ auto_submit_prompt: autoSubmit });
        } catch (error) {
            console.error("MCP Bridge: Error saving auto submit state.", error);
        }
    }

    async function handleRefreshPrompt() {
        try {
            // Добавить состояние загрузки
            const originalText = refreshPromptButton.innerHTML;
            refreshPromptButton.disabled = true;
            refreshPromptButton.innerHTML = `
                <svg class="button-icon spinning" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 12a8 8 0 018-8V2.5a.5.5 0 01.854-.354l3.5 3.5a.5.5 0 010 .708l-3.5 3.5A.5.5 0 0112 9.5V8a6 6 0 00-6 6 6 6 0 006 6 6 6 0 006-6h2a8 8 0 01-8 8 8 8 0 01-8-8z" fill="currentColor"/>
                </svg>
                <span>Обновление...</span>
            `;

            // Получить текущую активную вкладку
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Отправить сообщение об обновлении Prompt в background
            const response = await chrome.runtime.sendMessage({ 
                type: 'REFRESH_SYSTEM_PROMPT',
                payload: { tabId: tab.id }
            });

            if (response?.success) {
                // Успешный отклик
                refreshPromptButton.innerHTML = `
                    <svg class="button-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/>
                    </svg>
                    <span>Обновлено</span>
                `;
                setTimeout(() => {
                    refreshPromptButton.innerHTML = originalText;
                    refreshPromptButton.disabled = false;
                }, 1500);
            } else {
                throw new Error(response?.error || 'Неизвестная ошибка');
            }
        } catch (error) {
            console.error("MCP Bridge: Error refreshing prompt.", error);
            refreshPromptButton.innerHTML = `
                <svg class="button-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor"/>
                </svg>
                <span>Ошибка обновления</span>
            `;
            setTimeout(() => {
                refreshPromptButton.innerHTML = originalText;
                refreshPromptButton.disabled = false;
            }, 2000);
        }
    }

    async function compareVersions() {
        try {
            let remoteManifest = await chrome.storage.local.get(['manifest']);
            
            // Проверить, не устарел ли кэш (24 часа)
            if (!remoteManifest?.manifest || new Date().getTime() - remoteManifest.manifest.timestamp > 86400000) {
                const response = await fetch('https://raw.githubusercontent.com/WongJingGitt/mcp-bridge/refs/heads/master/manifest.json');
                remoteManifest = await response.json();
                await chrome.storage.local.set({ manifest: { ...remoteManifest, timestamp: new Date().getTime() } });
            } else {
                remoteManifest = remoteManifest.manifest;
            }

            const localManifest = chrome.runtime.getManifest();
            const remoteVersion = remoteManifest?.version;
            const localVersion = localManifest?.version;
            
            // Использовать функцию сравнения версий из compareVersion.js
            const compareResult = window.compareVersions.compareVersions(remoteVersion, localVersion);
            
            if (compareResult > 0) {
                // Есть новая версия
                newVersionText.textContent = `🎉 Обнаружена новая версия v${remoteVersion}`;
                newVersionText.classList.add('clickable');
                newVersionText.style.cursor = 'pointer';
                
                // Клик для скачивания новой версии
                newVersionText.addEventListener('click', () => {
                    window.open('https://github.com/WongJingGitt/mcp-bridge/archive/refs/heads/master.zip');
                    toast("Ссылка для скачивания открыта в браузере. Проверьте ход загрузки.", 'info');
                });
            } else {
                // Уже последняя версия
                newVersionText.textContent = `✓ Установлена последняя версия v${localVersion}`;
            }
        } catch (error) {
            console.error("MCP Bridge: Error checking version.", error);
            newVersionText.textContent = 'Ошибка проверки версии';
        }
    }

    function toast(message, type = 'success') {
        const toastContainer = document.getElementById('toastContainer');
        const toastEl = document.createElement('div');
        toastEl.className = `toast toast-${type}`;
        
        // Добавить иконку
        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        if (type === 'success') {
            icon.textContent = '✓';
        } else if (type === 'error') {
            icon.textContent = '✕';
        } else if (type === 'info') {
            icon.textContent = 'ℹ';
        }
        
        const text = document.createElement('span');
        text.textContent = message;
        
        toastEl.appendChild(icon);
        toastEl.appendChild(text);
        toastContainer.appendChild(toastEl);
        
        // Анимация появления
        setTimeout(() => toastEl.classList.add('show'), 10);
        
        // Автоматическое удаление
        setTimeout(() => {
            toastEl.classList.remove('show');
            setTimeout(() => toastEl.remove(), 300);
        }, 3000);
    }

    initialize();
    compareVersions();
});