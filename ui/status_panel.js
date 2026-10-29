/**
 * status_panel.js
 *
 * Назначение: инкапсулирует всю UI-логику «панели состояния вызова инструментов».
 * Это независимый класс, отвечающий за создание, обновление и уничтожение UI-элементов.
 * Изоляция стилей реализована через Shadow DOM.
 */

export class StatusPanel {
    constructor() {
        this.hostElement = null;
        this.shadowRoot = null;
        this.isVisible = false;
        this.isExpanded = true; // По умолчанию развёрнута
        this.isPermanent = true; // Режим постоянного присутствия
        this.isMinimized = false; // Состояние свёрнутости
        this.isDragging = false; // Состояние перетаскивания
        this.dragStarted = false; // Началось ли перетаскивание
        this.dragOffset = { x: 0, y: 0 }; // Смещение при перетаскивании
        this.position = null; // Пользовательская позиция {left, top} или null
        this.idleTimer = null; // Таймер простоя
        this.lastActiveTime = Date.now(); // Время последней активности
        
        // Загрузить сохранённую позицию и состояние
        this.loadPosition();
        this.loadMinimizedState();
    }
    
    /**
     * Загрузить позицию из localStorage
     */
    loadPosition() {
        try {
            const saved = localStorage.getItem('mcp-bridge-panel-position');
            if (saved) {
                this.position = JSON.parse(saved);
            }
        } catch (e) {
            console.log('[MCP Bridge] Failed to load panel position:', e);
        }
    }
    
    /**
     * Сохранить позицию в localStorage
     */
    savePosition() {
        try {
            if (this.position) {
                localStorage.setItem('mcp-bridge-panel-position', JSON.stringify(this.position));
            }
        } catch (e) {
            console.log('[MCP Bridge] Failed to save panel position:', e);
        }
    }
    
    /**
     * Загрузить состояние свёрнутости из localStorage
     */
    loadMinimizedState() {
        try {
            const saved = localStorage.getItem('mcp-bridge-panel-minimized');
            if (saved !== null) {
                this.isMinimized = saved === 'true';
            }
        } catch (e) {
            console.log('[MCP Bridge] Failed to load minimized state:', e);
        }
    }
    
    /**
     * Сохранить состояние свёрнутости в localStorage
     */
    saveMinimizedState() {
        try {
            localStorage.setItem('mcp-bridge-panel-minimized', this.isMinimized.toString());
        } catch (e) {
            console.log('[MCP Bridge] Failed to save minimized state:', e);
        }
    }

    /**
     * Создать и внедрить панель состояния в страницу.
     */
    create() {
        if (this.hostElement) return;

        // Проверить, существует ли уже панель на странице (защита от повторного создания)
        const existingHost = document.getElementById('mcp-bridge-status-panel-host');
        if (existingHost) {
            existingHost.remove();
        }

        // 1. Создать корневой элемент
        this.hostElement = document.createElement('div');
        this.hostElement.id = 'mcp-bridge-status-panel-host';
        
        // Убедиться, что body существует
        if (!document.body) {
            console.error('[MCP Bridge] document.body is null, waiting for DOMContentLoaded');
            document.addEventListener('DOMContentLoaded', () => {
                document.body.appendChild(this.hostElement);
            });
        } else {
            document.body.appendChild(this.hostElement);
        }

        // 2. Присоединить Shadow DOM
        this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

        // 3. Внедрить CSS
        const styleLink = document.createElement('link');
        styleLink.rel = 'stylesheet';
        styleLink.href = chrome.runtime.getURL('ui/status_panel.css');
        this.shadowRoot.appendChild(styleLink);

        // 4. Создать базовую HTML-структуру панели (постоянная версия)
        const panel = document.createElement('div');
        panel.className = 'mcp-status-panel permanent';
        panel.innerHTML = `
      <div class="panel-header">
        <div class="panel-title">
          <svg class="panel-title-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.4 2.126A5.4 5.4 0 0 0 9.6 0H5.4A5.4 5.4 0 0 0 0 5.4v4.2a5.4 5.4 0 0 0 2.126 4.2L11.4 23.1a1.8 1.8 0 0 0 2.546 0l7.925-7.924a1.8 1.8 0 0 0 0-2.546L14.4 2.126ZM5.4 9a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" fill="#0969da"></path></svg>
          <span>MCP Bridge</span>
        </div>
        <div class="panel-header-actions">
          <button class="panel-action-btn minimize-btn" title="Свернуть">
            <svg class="action-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 19h12v2H6v-2z" fill="currentColor"/>
            </svg>
          </button>
          <button class="panel-action-btn redetect-btn" title="Повторно обнаружить вызов инструмента">
            <svg class="action-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" fill="currentColor"/>
            </svg>
          </button>
          <button class="panel-toggle-btn" title="Развернуть/свернуть">
            <svg class="toggle-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 10l5 5 5-5z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="panel-body">
        <div class="status-line">
          <div class="status-icon">⚪</div>
          <div class="status-text">Готово</div>
        </div>
        <button class="show-input-btn" title="Показать поле ввода">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
          </svg>
          <span>Отправить сообщение вручную</span>
        </button>
        <div class="manual-input-section" style="display: none;">
          <textarea class="manual-input-box" placeholder="Если автоматическое обнаружение не сработало, вставьте сюда полный текст ответа..." rows="3"></textarea>
          <button class="manual-send-btn">Отправить в MCP</button>
        </div>
      </div>
    `;
        this.shadowRoot.appendChild(panel);

        // 5. Применить сохранённое состояние свёрнутости
        if (this.isMinimized) {
            panel.classList.add('minimized');
        }

        // 6. Применить пользовательскую позицию и проверить, не приведёт ли она к выходу за пределы экрана
        if (this.position) {
            // Если это не свёрнутое состояние — проверить, не выйдет ли панель за пределы экрана
            if (!this.isMinimized) {
                this.adjustPositionOnExpand(panel, this.position);
            } else {
                // В свёрнутом состоянии просто применить позицию
                panel.style.left = this.position.left + 'px';
                panel.style.top = this.position.top + 'px';
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
            }
        }

        // 7. Привязать события
        this.bindEvents(panel);
        
        // 8. Запустить определение простоя
        this.startIdleDetection();
        
        // Показать по умолчанию
        this.show();
    }
    
    /**
     * Привязать все события
     */
    bindEvents(panel) {
        // Кнопка сворачивания
        const minimizeBtn = this.shadowRoot.querySelector('.minimize-btn');
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMinimize(true); // Пользователь инициировал вручную
        });
        
        // Событие разворачивания/сворачивания
        const toggleBtn = this.shadowRoot.querySelector('.panel-toggle-btn');
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });
        
        // Событие кнопки повторного обнаружения
        const redetectBtn = this.shadowRoot.querySelector('.redetect-btn');
        redetectBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handleRedetect();
        });
        
        // Кнопка показа поля ввода
        const showInputBtn = this.shadowRoot.querySelector('.show-input-btn');
        showInputBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleManualInput();
        });
        
        // Событие кнопки ручной отправки
        const manualSendBtn = this.shadowRoot.querySelector('.manual-send-btn');
        manualSendBtn.addEventListener('click', () => this.handleManualSend());
        
        // События перетаскивания (только в области заголовка, не на кнопках)
        const header = this.shadowRoot.querySelector('.panel-header');
        let clickStartTime = 0;
        let clickStartPos = { x: 0, y: 0 };
        
        header.addEventListener('mousedown', (e) => {
            // Если кликнули по кнопке — не запускать перетаскивание
            if (e.target.closest('.panel-action-btn') || e.target.closest('.panel-toggle-btn')) {
                return;
            }
            
            clickStartTime = Date.now();
            clickStartPos = { x: e.clientX, y: e.clientY };
            this.dragStarted = false;
            
            // В не-свёрнутом состоянии сразу начать перетаскивание
            if (!this.isMinimized) {
                this.startDrag(e);
                this.dragStarted = true;
            }
        });
        
        // Слушать mousemove: в свёрнутом состоянии, если смещение превысило порог — начать перетаскивание
        const handleMouseMove = (e) => {
            if (this.isMinimized && !this.dragStarted && clickStartTime > 0) {
                const moveDistance = Math.sqrt(
                    Math.pow(e.clientX - clickStartPos.x, 2) + 
                    Math.pow(e.clientY - clickStartPos.y, 2)
                );
                
                // Смещение больше 5px — начать перетаскивание
                if (moveDistance > 5) {
                    // Создать имитацию события, используя начальную позицию клика
                    const simulatedEvent = {
                        clientX: clickStartPos.x,
                        clientY: clickStartPos.y,
                        preventDefault: () => {}
                    };
                    this.startDrag(simulatedEvent);
                    this.dragStarted = true;
                }
            }
            
            // Продолжить обработку перетаскивания
            this.onDrag(e);
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        
        const handleMouseUp = (e) => {
            const clickDuration = Date.now() - clickStartTime;
            const moveDistance = Math.sqrt(
                Math.pow(e.clientX - clickStartPos.x, 2) + 
                Math.pow(e.clientY - clickStartPos.y, 2)
            );
            
            // Если это свёрнутое состояние и быстрый клик (не перетаскивание) — развернуть
            if (this.isMinimized && clickDuration < 300 && moveDistance < 5 && !this.dragStarted) {
                this.toggleMinimize(true); // Пользователь инициировал вручную
            }
            
            clickStartTime = 0;
            this.dragStarted = false;
            this.stopDrag();
        };
        
        document.addEventListener('mouseup', handleMouseUp);
        
        // Определение активности (наведение мыши)
        panel.addEventListener('mouseenter', () => this.markActive());
        panel.addEventListener('mouseleave', () => this.markActive());
    }
    
    /**
     * Начать перетаскивание
     */
    startDrag(e) {
        this.isDragging = true;
        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        panel.classList.add('dragging');
        
        const rect = panel.getBoundingClientRect();
        
        // В свёрнутом состоянии использовать центр панели как точку захвата
        if (this.isMinimized) {
            this.dragOffset = {
                x: rect.width / 2,
                y: rect.height / 2
            };
        } else {
            // В не-свёрнутом состоянии использовать фактическое смещение точки клика
            this.dragOffset = {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }
        
        this.markActive();
        
        // Запретить поведение по умолчанию, чтобы предотвратить выделение текста
        if (e.preventDefault) {
            e.preventDefault();
        }
    }
    
    /**
     * Во время перетаскивания
     */
    onDrag(e) {
        if (!this.isDragging) return;
        
        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        const left = e.clientX - this.dragOffset.x;
        const top = e.clientY - this.dragOffset.y;
        
        // Ограничение по границам
        const maxLeft = window.innerWidth - panel.offsetWidth;
        const maxTop = window.innerHeight - panel.offsetHeight;
        
        this.position = {
            left: Math.max(0, Math.min(left, maxLeft)),
            top: Math.max(0, Math.min(top, maxTop))
        };
        
        panel.style.left = this.position.left + 'px';
        panel.style.top = this.position.top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    }
    
    /**
     * Остановить перетаскивание
     */
    stopDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        panel.classList.remove('dragging');
        
        // Сохранить позицию
        this.savePosition();
    }
    
    /**
     * Переключить свёрнутость
     * @param {boolean} fromUser - Инициировано ли пользователем
     */
    toggleMinimize(fromUser = false) {
        const wasMinimized = this.isMinimized;
        this.isMinimized = !this.isMinimized;
        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        
        if (this.isMinimized) {
            panel.classList.add('minimized');
        } else {
            panel.classList.remove('minimized');
            
            // При разворачивании из свёрнутого состояния проверить и скорректировать позицию во избежание выхода за экран
            if (wasMinimized && this.position) {
                this.adjustPositionOnExpand(panel);
            }
        }
        
        // Сохранить состояние свёрнутости
        this.saveMinimizedState();
        this.markActive();
    }
    
    /**
     * Скорректировать позицию при разворачивании, чтобы избежать выхода за пределы экрана
     * @param {HTMLElement} panel - Элемент панели
     * @param {Object} [customPosition] - Необязательная пользовательская позиция; если не указана — используется this.position
     */
    adjustPositionOnExpand(panel, customPosition = null) {
        const EXPANDED_WIDTH = 440;
        const EXPANDED_MIN_HEIGHT = 200; // Ожидаемая минимальная высота
        const MARGIN = 20;
        
        const position = customPosition || this.position;
        if (!position) return;
        
        let { left, top } = position;
        let adjusted = false;
        
        // Проверить выход справа
        const maxLeft = window.innerWidth - EXPANDED_WIDTH - MARGIN;
        if (left > maxLeft) {
            left = Math.max(MARGIN, maxLeft);
            adjusted = true;
        }
        
        // Проверить выход слева
        if (left < MARGIN) {
            left = MARGIN;
            adjusted = true;
        }
        
        // Проверить выход снизу
        const maxTop = window.innerHeight - EXPANDED_MIN_HEIGHT - MARGIN;
        if (top > maxTop) {
            top = Math.max(MARGIN, maxTop);
            adjusted = true;
        }
        
        // Проверить выход сверху
        if (top < MARGIN) {
            top = MARGIN;
            adjusted = true;
        }
        
        // Обновить позицию (применить в любом случае)
        this.position = { left, top };
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
        
        // Если позиция была скорректирована — сохранить
        if (adjusted) {
            this.savePosition();
        }
    }
    
    /**
     * Переключить показ поля ручного ввода
     */
    toggleManualInput() {
        const inputSection = this.shadowRoot.querySelector('.manual-input-section');
        const showBtn = this.shadowRoot.querySelector('.show-input-btn');
        
        if (inputSection.style.display === 'none') {
            inputSection.style.display = 'block';
            showBtn.style.display = 'none';
            // Установить фокус на поле ввода
            const textarea = inputSection.querySelector('.manual-input-box');
            setTimeout(() => textarea?.focus(), 100);
        } else {
            inputSection.style.display = 'none';
            showBtn.style.display = 'flex';
        }
        
        this.markActive();
    }
    
    /**
     * Отметить активность
     */
    markActive() {
        this.lastActiveTime = Date.now();
        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        if (panel) {
            panel.classList.remove('idle');
        }
    }
    
    /**
     * Запустить определение простоя
     */
    startIdleDetection() {
        // Проверять каждые 2 секунды
        this.idleTimer = setInterval(() => {
            const idleTime = Date.now() - this.lastActiveTime;
            const panel = this.shadowRoot?.querySelector('.mcp-status-panel');
            
            if (panel && idleTime > 5000 && !this.isMinimized) { // 5 секунд без действий
                panel.classList.add('idle');
            }
        }, 2000);
    }
    
    /**
     * Остановить определение простоя
     */
    stopIdleDetection() {
        if (this.idleTimer) {
            clearInterval(this.idleTimer);
            this.idleTimer = null;
        }
    }

    /**
     * Обработать ручную отправку
     */
    handleManualSend() {
        const inputBox = this.shadowRoot.querySelector('.manual-input-box');
        const content = inputBox.value.trim();
        
        if (!content) {
            this.update({
                status: 'ERROR',
                message: 'Сначала вставьте содержимое'
            });
            return;
        }

        // Отправить в content_script через window.postMessage
        window.postMessage({
            type: 'MCP_BRIDGE_MANUAL_TOOL_PARSE',
            source: 'mcp-bridge-panel',
            payload: { content }
        }, '*');
        
        // Очистить поле ввода и показать статус обработки
        inputBox.value = '';
        this.update({
            status: 'EXECUTING',
            message: 'Обработка содержимого, введённого вручную...'
        });
    }

    /**
     * Обработать повторное обнаружение вызова инструмента
     */
    handleRedetect() {
        console.log('[MCP Bridge] Redetect button clicked');
        
        // Показать статус «обнаружение»
        this.update({
            status: 'EXECUTING',
            message: 'Повторное обнаружение из последнего сообщения...'
        });
        
        console.log('[MCP Bridge] Posting REDETECT_FROM_UI message via window.postMessage');
        
        // Отправить в content_script через window.postMessage
        window.postMessage({
            type: 'MCP_BRIDGE_REDETECT_FROM_UI',
            source: 'mcp-bridge-panel'
        }, '*');
    }    /**
     * Обработать обновление System Prompt (сохранено для других целей)
     */
    handleRefresh() {
        // Отправить сообщение в background script
        chrome.runtime.sendMessage({ 
            type: 'REFRESH_SYSTEM_PROMPT_FROM_PANEL'
        }).catch(error => {
            console.error('[MCP Bridge] Failed to send refresh message:', error);
        });
    }

    /**
     * Развернуть/свернуть панель
     */
    toggle() {
        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        const body = this.shadowRoot.querySelector('.panel-body');
        const toggleIcon = this.shadowRoot.querySelector('.toggle-icon');
        
        this.isExpanded = !this.isExpanded;
        
        if (this.isExpanded) {
            panel.classList.remove('collapsed');
            toggleIcon.style.transform = 'rotate(0deg)';
        } else {
            panel.classList.add('collapsed');
            toggleIcon.style.transform = 'rotate(180deg)';
        }
    }

    /**
     * Показать панель.
     */
    show() {
        if (!this.hostElement) this.create();
        // Использовать requestAnimationFrame, чтобы гарантировать, что элемент отрендерен и CSS-transition сработает
        requestAnimationFrame(() => {
            const panel = this.shadowRoot.querySelector('.mcp-status-panel');
            if (panel) {
                panel.classList.add('visible');
            }
        });
        this.isVisible = true;
    }

    /**
     * Обновить содержимое панели.
     * @param {object} state - Объект состояния с информацией для отображения.
     * @param {string} state.status - 'EXECUTING', 'SUCCESS', 'ERROR', 'IDLE'
     * @param {string} state.message - Основная информация, отображаемая в строке статуса.
     * @param {object} [state.details] - Необязательные подробности.
     * @param {string} [state.details.title] - Заголовок раздела подробностей.
     * @param {string} [state.details.content] - Содержимое подробностей (может быть JSON-строкой).
     */
    update({ status, message, details }) {
        if (!this.hostElement) this.create();

        const panel = this.shadowRoot.querySelector('.mcp-status-panel');
        const panelBody = this.shadowRoot.querySelector('.panel-body');

        if (!panel || !panelBody) return;

        // Обновить атрибут data-state панели для применения разных стилей
        panel.dataset.state = status.toUpperCase();
        
        // Умное разворачивание: автоматически разворачивать только при ошибке
        const isError = status.toUpperCase() === 'ERROR';
        
        if (isError && this.isMinimized) {
            this.markActive();
            this.toggleMinimize(false); // Автоматическое разворачивание
        }

        let iconHtml = '';
        switch (status.toUpperCase()) {
            case 'EXECUTING':
                iconHtml = '<div class="spinner"></div>';
                break;
            // Иконки для SUCCESS и ERROR предоставляются через CSS-псевдоэлемент ::before
            case 'SUCCESS':
            case 'ERROR':
                iconHtml = '';
                break;
            default:
                iconHtml = '⚪'; // IDLE
        }

        let detailsHtml = '';
        if (details && details.title && details.content) {
            detailsHtml = `
        <div class="details-section">
          <div class="details-toggle">${details.title}</div>
          <div class="details-content">
            <pre>${this._escapeHtml(details.content)}</pre>
          </div>
        </div>
      `;
        }

        panelBody.innerHTML = `
      <div class="status-line">
        <div class="status-icon">${iconHtml}</div>
        <div class="status-text">${message}</div>
      </div>
      ${detailsHtml}
      <button class="show-input-btn" title="Показать поле ввода">
        <svg class="btn-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" fill="currentColor"/>
        </svg>
        <span>Отправить сообщение вручную</span>
      </button>
      <div class="manual-input-section" style="display: none;">
        <textarea class="manual-input-box" placeholder="Если автоматическое обнаружение не сработало, вставьте сюда полный текст ответа..." rows="3"></textarea>
        <button class="manual-send-btn">Отправить в MCP</button>
      </div>
    `;

        // Привязать событие к новому элементу details-toggle
        const toggle = panelBody.querySelector('.details-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('expanded');
                toggle.nextElementSibling.classList.toggle('expanded');
            });
        }
        
        // Повторно привязать события к элементам ввода
        const showInputBtn = panelBody.querySelector('.show-input-btn');
        showInputBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleManualInput();
        });
        
        const manualSendBtn = panelBody.querySelector('.manual-send-btn');
        manualSendBtn.addEventListener('click', () => this.handleManualSend());

        if (!this.isVisible) {
            this.show();
        }
    }

    /**
     * Уничтожить и удалить панель состояния со страницы.
     * Примечание: в режиме постоянного присутствия этот метод вызывать не следует.
     */
    destroy() {
        if (this.isPermanent) {
            return;
        }
        
        // Остановить определение простоя
        this.stopIdleDetection();
        
        if (this.hostElement) {
            const panel = this.shadowRoot.querySelector('.mcp-status-panel');
            if (panel) {
                panel.classList.remove('visible');
                // Подождать завершения CSS-transition, затем удалить DOM-элемент
                setTimeout(() => {
                    this.hostElement.remove();
                    this.hostElement = null;
                    this.shadowRoot = null;
                }, 300);
            } else {
                this.hostElement.remove();
            }
        }
        this.isVisible = false;
    }

    /**
     * Функция экранирования HTML для защиты от XSS
     * @param {string} str - Строка для экранирования
     * @returns {string} - Экранированная строка
     */
    _escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}