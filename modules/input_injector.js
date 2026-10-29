/**
 * input_injector.js
 * 
 * Назначение: интеллектуально внедряет текст в поля ввода на веб-страницах,
 * поддерживает современные фреймворки (React/Vue),
 * вызывая нативные события для обхода ограничений двустороннего связывания фреймворков.
 */

/**
 * Внедрить текст в поле ввода на странице и автоматически отправить
 * @param {string} text - Текст для внедрения
 * @param {object} inputConfig - Конфигурация ввода
 * @param {string} inputConfig.selector - Селектор поля ввода
 * @param {string} inputConfig.submitKey - Клавиша отправки (Enter/Tab и т.д.), null означает не отправлять автоматически
 * @param {array} inputConfig.submitModifiers - Модификаторы (Shift/Ctrl/Alt/Meta)
 * @param {number} inputConfig.submitDelay - Общая задержка (мс), по умолчанию 1600 мс
 * @returns {Promise<boolean>} - Успешно ли выполнено
 */
export async function injectTextAndSubmit(text, inputConfig) {
    try {

        // Получить общую задержку (по умолчанию 1600 мс)
        const totalDelay = inputConfig.submitDelay || 1600;
        
        // Распределить задержку пропорционально
        // Пропорции: фокус 12.5%, после ввода 31.25%, ожидание UI 50%, после отправки 6.25%
        const delays = {
            afterFocus: Math.round(totalDelay * 0.125),    // 12.5% → по умолчанию 200 мс
            afterInput: Math.round(totalDelay * 0.3125),   // 31.25% → по умолчанию 500 мс
            beforeSubmit: Math.round(totalDelay * 0.5),    // 50% → по умолчанию 800 мс
            afterSubmit: Math.round(totalDelay * 0.0625)   // 6.25% → по умолчанию 100 мс
        };

        // Найти поле ввода
        const inputElement = findInputElement(inputConfig.selector);
        if (!inputElement) {
            throw new Error(`Элемент ввода не найден: ${inputConfig.selector}`);
        }
        
        // Сфокусировать поле ввода
        inputElement.focus();
        await sleep(delays.afterFocus);
        
        const finalText = `
<tool_result>
${text}
</tool_result>`

        // Внедрить текст (с поддержкой React/Vue)
        setInputValue(inputElement, finalText);
        await sleep(delays.afterInput);

        // Если настроена клавиша отправки, подождать и отправить автоматически
        if (inputConfig.submitKey) {
            // Подождать, чтобы UI обновился
            await sleep(delays.beforeSubmit);

            simulateKeyPress(inputElement, inputConfig.submitKey, inputConfig.submitModifiers || []);
            await sleep(delays.afterSubmit);

        } else {
            console.log('[MCP Bridge] Text injected (auto-submit disabled, waiting for user input)');
        }

        return true;
    } catch (error) {
        console.error('[MCP Bridge] Failed to inject text:', error);
        return false;
    }
}

/**
 * Найти элемент поля ввода
 */
function findInputElement(selector) {
    // Попытаться найти напрямую
    let element = document.querySelector(selector);
    if (element) return element;

    // Попытаться найти в Shadow DOM
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
        if (el.shadowRoot) {
            element = el.shadowRoot.querySelector(selector);
            if (element) return element;
        }
    }

    // Использовать общие селекторы как запасной вариант
    const fallbackSelectors = [
        'textarea[placeholder*="输入"]', // оставлен китайский плейсхолдер для совместимости
        'textarea[placeholder*="问"]',   // оставлен китайский плейсхолдер для совместимости
        'textarea',
        '[contenteditable="true"]',
        'input[type="text"]'
    ];

    for (const fallbackSelector of fallbackSelectors) {
        element = document.querySelector(fallbackSelector);
        if (element && isVisible(element)) {
            return element;
        }
    }

    return null;
}

/**
 * Проверить, виден ли элемент
 */
function isVisible(element) {
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

/**
 * Установить значение поля ввода (совместимо с React/Vue и другими фреймворками)
 */
function setInputValue(element, value) {
    const isContentEditable = element.contentEditable === 'true';

    if (isContentEditable) {
        // Элемент contenteditable — использовать более надёжный метод
        
        // Метод 1: сначала очистить, затем вставить (имитация поведения пользователя)
        element.focus();
        
        // Выделить всё содержимое
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        
        // Вызвать событие beforeinput (современные фреймворки зависят от него)
        element.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: value
        }));
        
        // Попробовать использовать execCommand (устарел, но обладает лучшей совместимостью)
        try {
            document.execCommand('insertText', false, value);
        } catch (e) {
            // Если execCommand не сработал, использовать операцию с DOM
            element.textContent = value;
        }
        
        // Переместить курсор в конец
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
        
    } else {
        // textarea или input
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value'
        )?.set || Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        )?.set;

        if (nativeInputValueSetter) {
            nativeInputValueSetter.call(element, value);
        } else {
            element.value = value;
        }
    }

    // Вызвать все возможные события, чтобы фреймворк обнаружил изменение
    // Примечание: для contenteditable некоторые события уже были вызваны выше
    const events = [
        new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }),
        new Event('change', { bubbles: true, cancelable: true }),
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Unidentified' }),
        new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Unidentified' })
    ];

    events.forEach(event => {
        element.dispatchEvent(event);
    });
}

/**
 * Имитировать нажатие клавиши
 */
function simulateKeyPress(element, key, modifiers = []) {
    const keyboardEventInit = {
        key: key,
        code: key === 'Enter' ? 'Enter' : key,
        keyCode: getKeyCode(key),
        which: getKeyCode(key),
        bubbles: true,
        cancelable: true,
        shiftKey: modifiers.includes('Shift'),
        ctrlKey: modifiers.includes('Ctrl') || modifiers.includes('Control'),
        altKey: modifiers.includes('Alt'),
        metaKey: modifiers.includes('Meta') || modifiers.includes('Cmd')
    };

    element.dispatchEvent(new KeyboardEvent('keydown', keyboardEventInit));
    element.dispatchEvent(new KeyboardEvent('keypress', keyboardEventInit));
    element.dispatchEvent(new KeyboardEvent('keyup', keyboardEventInit));
}

/**
 * Получить keyCode клавиши
 */
function getKeyCode(key) {
    const keyCodes = {
        'Enter': 13,
        'Tab': 9,
        'Escape': 27,
        'Space': 32
    };
    return keyCodes[key] || 0;
}

/**
 * Функция задержки
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}