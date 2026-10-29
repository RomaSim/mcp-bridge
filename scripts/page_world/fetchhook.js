/**
 * Fetch Hook Library
 * Исправленная версия — использует clone() для чтения body, чтобы не потреблять исходный поток
 */
(function(window) {
    // Защита от повторной загрузки
    if (window.RealFetch) return;
    if (typeof window.fetch !== 'function') return;

    // Сохранить оригинальный fetch
    window.RealFetch = window.fetch;

    /**
     * Hook для Fetch API
     * @param {Object} hooks - { urlHook, optionsHook, responseHook }
     */
    window.hookFetch = function(hooks) {
        if (window.fetch.__hooked) return;
        if (!hooks) return;

        window.fetch = async function(input, init) {
            let url, options;

            // Обработка объекта Request
            if (input instanceof Request) {
                url = input.url;
                
                // Прочитать body (если нужно модифицировать)
                let body = null;
                if (input.body) {
                    try {
                        // Клонировать Request для чтения body, чтобы не потреблять исходный поток
                        const cloned = input.clone();
                        body = await cloned.text();
                    } catch (err) {
                        console.warn('Body read error:', err);
                        body = input.body; // Запасной вариант: использовать исходный body
                    }
                } else {
                    body = null;
                }
                
                options = {
                    method: input.method,
                    headers: input.headers,
                    body: body, // Прочитанный текст
                    mode: input.mode,
                    credentials: input.credentials,
                    cache: input.cache,
                    redirect: input.redirect,
                    referrer: input.referrer,
                    integrity: input.integrity,
                    keepalive: input.keepalive,
                    signal: input.signal
                };
            } else {
                // Обработка обычного случая URL + init
                url = input;
                options = init || {};
            }

            // Выполнить URL hook
            if (typeof hooks.urlHook === 'function') {
                url = await hooks.urlHook.call(this, url);
            }

            // Выполнить options hook
            if (typeof hooks.optionsHook === 'function') {
                options = await hooks.optionsHook.call(this, options, url);
            }

            // Выполнить фактический fetch
            let response = await window.RealFetch(url, options);

            // Выполнить response hook
            if (typeof hooks.responseHook === 'function') {
                return await hooks.responseHook.call(this, response);
            }

            return response;
        };

        window.fetch.__hooked = true;
    };

    /**
     * Снять Hook
     */
    window.unHookFetch = function() {
        if (window.RealFetch) {
            delete window.fetch.__hooked;
            window.fetch = window.RealFetch;
            window.RealFetch = undefined;
        }
    };

})(window);