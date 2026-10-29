/**
 * conflict_notice.js
 * Компонент уведомления о конфликтующем расширении — выезжающее уведомление в правом нижнем углу
 */
export class ConflictNotice {
    constructor() {
        this.container = null;
    }

    create(conflictExtName, logoUrl) {
        if (this.container) return;

        this.container = document.createElement('div');
        this.container.id = 'mcp-conflict-notice';
        this.container.innerHTML = `
            <div class="mcp-conflict-notice-inner">
                <div class="mcp-conflict-notice-header">
                    <span class="mcp-conflict-notice-brand">
                        <img class="mcp-conflict-notice-logo" src="${logoUrl}" alt="">
                        <span>MCP Bridge</span>
                    </span>
                    <button class="mcp-conflict-notice-close" title="Закрыть">✕</button>
                </div>
                <div class="mcp-conflict-notice-body">
                    <span class="mcp-conflict-notice-icon">⚠️</span>
                    <span class="mcp-conflict-notice-text">Обнаружен конфликт с расширением «${conflictExtName}», первое внедрение на этом сайте автоматически отключено.</span>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);

        // Запустить анимацию выезда
        requestAnimationFrame(() => {
            this.container.classList.add('mcp-conflict-notice-visible');
        });

        // Привязать кнопку закрытия
        const closeBtn = this.container.querySelector('.mcp-conflict-notice-close');
        closeBtn.addEventListener('click', () => this.destroy());
    }

    destroy() {
        if (!this.container) return;

        this.container.classList.remove('mcp-conflict-notice-visible');

        const el = this.container;
        el.addEventListener('transitionend', () => {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }, { once: true });

        this.container = null;

        // Записать состояние закрытия
        localStorage.setItem(`mcp_bridge_conflict_notice_closed_${window.location.hostname}`, 'true');
    }
}