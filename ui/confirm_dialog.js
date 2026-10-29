/**
 * confirm_dialog.js
 *
 * Назначение: инкапсулирует универсальный компонент диалога подтверждения.
 * Предоставляет диалог вторичного подтверждения с явной пометкой от MCP Bridge.
 * Поддерживает настраиваемые заголовок, сообщение, текст кнопок и функции-обработчики.
 */

export class ConfirmDialog {
    constructor() {
        this.hostElement = null;
        this.shadowRoot = null;
        this.isVisible = false;
        this.resolveCallback = null;
    }

    /**
     * Создать диалог
     */
    create() {
        if (this.hostElement) return;

        // Проверить, существует ли уже диалог на странице
        const existingHost = document.getElementById('mcp-bridge-confirm-dialog-host');
        if (existingHost) {
            existingHost.remove();
        }

        // 1. Создать корневой элемент
        this.hostElement = document.createElement('div');
        this.hostElement.id = 'mcp-bridge-confirm-dialog-host';
        
        // Убедиться, что body существует
        if (!document.body) {
            console.error('[MCP Bridge] document.body is null');
            return;
        }
        
        document.body.appendChild(this.hostElement);

        // 2. Присоединить Shadow DOM
        this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

        // 3. Внедрить CSS
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('ui/confirm_dialog.css');
        this.shadowRoot.appendChild(styleLink);

        // 4. Создать базовую HTML-структуру диалога
        const dialog = document.createElement('div');
        dialog.className = 'mcp-confirm-overlay';
        dialog.innerHTML = `
            <div class="mcp-confirm-dialog">
                <div class="mcp-confirm-header">
                    <div class="mcp-confirm-branding">
                        <svg class="mcp-confirm-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M14.4 2.126A5.4 5.4 0 0 0 9.6 0H5.4A5.4 5.4 0 0 0 0 5.4v4.2a5.4 5.4 0 0 0 2.126 4.2L11.4 23.1a1.8 1.8 0 0 0 2.546 0l7.925-7.924a1.8 1.8 0 0 0 0-2.546L14.4 2.126ZM5.4 9a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" fill="#0969da"></path>
                        </svg>
                        <span class="mcp-confirm-brand-text">MCP Bridge</span>
                    </div>
                    <div class="mcp-confirm-title"></div>
                </div>
                <div class="mcp-confirm-body">
                    <div class="mcp-confirm-message"></div>
                </div>
                <div class="mcp-confirm-footer">
                    <div class="mcp-confirm-btn-container">
                        <button class="mcp-confirm-btn mcp-confirm-btn-cancel">Отмена</button>
                        <button class="mcp-confirm-btn mcp-confirm-btn-confirm">Подтвердить</button>
                    </div>
                </div>
            </div>
        `;
        this.shadowRoot.appendChild(dialog);

        // 5. Привязать события
        this.bindEvents();
    }

    /**
     * Привязать события
     */
    bindEvents() {
        const overlay = this.shadowRoot.querySelector('.mcp-confirm-overlay');
        const cancelBtn = this.shadowRoot.querySelector('.mcp-confirm-btn-cancel');
        const confirmBtn = this.shadowRoot.querySelector('.mcp-confirm-btn-confirm');

        // Закрытие по клику на оверлей (опционально)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.cancel();
            }
        });

        // Кнопка отмены
        cancelBtn.addEventListener('click', () => {
            this.cancel();
        });

        // Кнопка подтверждения
        confirmBtn.addEventListener('click', () => {
            this.confirm();
        });

        // Закрытие по клавише ESC
        const handleKeydown = (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.cancel();
            }
        };
        document.addEventListener('keydown', handleKeydown);
        
        // Сохранить ссылку для последующего удаления
        this._keydownHandler = handleKeydown;
    }

    /**
     * Показать диалог подтверждения
     * @param {Object} options - Опции конфигурации
     * @param {string} options.title - Заголовок диалога (по умолчанию: Подтверждение действия)
     * @param {string} options.message - Сообщение диалога (обязательно)
     * @param {string} options.confirmText - Текст кнопки подтверждения (по умолчанию: Подтвердить)
     * @param {string} options.cancelText - Текст кнопки отмены (по умолчанию: Отмена)
     * @param {string} options.type - Тип диалога: 'default', 'warning', 'danger' (по умолчанию: default)
     * @returns {Promise<boolean>} - true при подтверждении пользователем, false при отмене
     */
    show({
        title = 'Подтверждение действия',
        message = '',
        confirmText = 'Подтвердить',
        cancelText = 'Отмена',
        type = 'default',
        showDontShowAgain = false,
        dontShowAgainText = 'Больше не показывать'
    } = {}) {
        if (!this.hostElement) {
            this.create();
        }

        return new Promise((resolve) => {
            this.resolveCallback = resolve;

            // Обновить содержимое
            const titleElement = this.shadowRoot.querySelector('.mcp-confirm-title');
            const messageElement = this.shadowRoot.querySelector('.mcp-confirm-message');
            const confirmBtn = this.shadowRoot.querySelector('.mcp-confirm-btn-confirm');
            const cancelBtn = this.shadowRoot.querySelector('.mcp-confirm-btn-cancel');
            const dialog = this.shadowRoot.querySelector('.mcp-confirm-dialog');
            const footer = this.shadowRoot.querySelector('.mcp-confirm-footer');

            titleElement.textContent = title;
            messageElement.textContent = message;
            confirmBtn.textContent = confirmText;
            cancelBtn.textContent = cancelText;

            // Установить стиль типа
            dialog.className = 'mcp-confirm-dialog';
            if (type === 'warning') {
                dialog.classList.add('mcp-confirm-warning');
            } else if (type === 'danger') {
                dialog.classList.add('mcp-confirm-danger');
            }

            // Обработать флажок «Больше не показывать»
            let checkboxContainer = footer.querySelector('.mcp-confirm-dont-show-again');
            if (showDontShowAgain) {
                if (!checkboxContainer) {
                    checkboxContainer = document.createElement('label');
                    checkboxContainer.className = 'mcp-confirm-dont-show-again';
                    checkboxContainer.innerHTML = `
                        <input type="checkbox" class="mcp-confirm-checkbox">
                        <span class="mcp-confirm-checkbox-text">${dontShowAgainText}</span>
                    `;
                    // Вставить перед контейнером кнопок
                    const btnContainer = footer.querySelector('.mcp-confirm-btn-container');
                    footer.insertBefore(checkboxContainer, btnContainer);
                } else {
                    checkboxContainer.style.display = 'flex';
                    checkboxContainer.querySelector('.mcp-confirm-checkbox-text').textContent = dontShowAgainText;
                    checkboxContainer.querySelector('.mcp-confirm-checkbox').checked = false;
                }
            } else {
                if (checkboxContainer) {
                    checkboxContainer.style.display = 'none';
                }
            }

            // Показать диалог
            const overlay = this.shadowRoot.querySelector('.mcp-confirm-overlay');
            overlay.classList.add('visible');
            this.isVisible = true;

            // Установить фокус на кнопку подтверждения
            setTimeout(() => {
                confirmBtn.focus();
            }, 100);
        });
    }

    /**
     * Подтверждение пользователем
     */
    confirm() {
        const result = this.getResult(true);
        this.hide();
        if (this.resolveCallback) {
            this.resolveCallback(result);
            this.resolveCallback = null;
        }
    }

    /**
     * Отмена пользователем
     */
    cancel() {
        const result = this.getResult(false);
        this.hide();
        if (this.resolveCallback) {
            this.resolveCallback(result);
            this.resolveCallback = null;
        }
    }

    /**
     * Получить результат диалога
     * @param {boolean} confirmed - Подтверждено ли
     * @returns {Object|boolean} - Если есть флажок, вернуть объект, иначе — логическое значение
     */
    getResult(confirmed) {
        const checkboxContainer = this.shadowRoot?.querySelector('.mcp-confirm-dont-show-again');
        if (checkboxContainer && checkboxContainer.style.display !== 'none') {
            const checkbox = checkboxContainer.querySelector('.mcp-confirm-checkbox');
            return {
                confirmed: confirmed,
                dontShowAgain: checkbox ? checkbox.checked : false
            };
        }
        return confirmed;
    }

    /**
     * Скрыть диалог
     */
    hide() {
        if (!this.shadowRoot) return;

        const overlay = this.shadowRoot.querySelector('.mcp-confirm-overlay');
        if (overlay) {
            overlay.classList.remove('visible');
        }
        this.isVisible = false;
    }

    /**
     * Уничтожить диалог
     */
    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }

        if (this.hostElement) {
            this.hostElement.remove();
            this.hostElement = null;
            this.shadowRoot = null;
        }

        this.isVisible = false;
        this.resolveCallback = null;
    }
}

// Экспортировать глобальный синглтон для удобного использования
export const confirmDialog = new ConfirmDialog();

// Удобный метод: показать диалог подтверждения
export async function confirm(message, options = {}) {
    return await confirmDialog.show({
        message,
        ...options
    });
}

// Удобный метод: показать диалог подтверждения типа «предупреждение»
export async function confirmWarning(message, options = {}) {
    return await confirmDialog.show({
        message,
        type: 'warning',
        ...options
    });
}

// Удобный метод: показать диалог подтверждения для опасных операций
export async function confirmDanger(message, options = {}) {
    return await confirmDialog.show({
        message,
        type: 'danger',
        confirmText: 'Подтвердить удаление',
        ...options
    });
}