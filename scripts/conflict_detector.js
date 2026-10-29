const CONFLICT_LIST_URL = 'https://raw.githubusercontent.com/WongJingGitt/mcp-bridge/refs/heads/master/config/extension.json';
const DEDUP_INTERVAL = 5 * 60 * 1000; // 5 минут дедупликации
const REMOTE_TIMEOUT = 2000; // Таймаут удалённого запроса 2 с

export async function detectConflicts() {
    try {
        const { conflict_check_timestamp } = await chrome.storage.local.get('conflict_check_timestamp');

        if (conflict_check_timestamp && (Date.now() - conflict_check_timestamp < DEDUP_INTERVAL)) {
            return;
        }

        let conflictList = null;

        // 1. Удалённо (таймаут 2 с)
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REMOTE_TIMEOUT);
            const response = await fetch(CONFLICT_LIST_URL, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                await chrome.storage.local.set({ conflict_extension_cache: { data, cached_at: Date.now() } });
                conflictList = data;
            }
        } catch (e) { /* ок */ }

        // 2. Кэш
        if (!conflictList) {
            const { conflict_extension_cache } = await chrome.storage.local.get('conflict_extension_cache');
            if (conflict_extension_cache?.data) {
                conflictList = conflict_extension_cache.data;
            }
        }

        // 3. Локально
        if (!conflictList) {
            try {
                const response = await fetch(chrome.runtime.getURL('config/extension.json'));
                if (response.ok) {
                    conflictList = await response.json();
                    await chrome.storage.local.set({ conflict_extension_cache: { data: conflictList, cached_at: Date.now() } });
                }
            } catch (e) { /* ок */ }
        }

        // 4. Пусто
        if (!conflictList || !Array.isArray(conflictList) || conflictList.length === 0) {
            await chrome.storage.local.set({ conflict_disabled_sites: [], conflict_check_timestamp: Date.now() });
            return;
        }

        const installedExtensions = await chrome.management.getAll();

        // ОТЛАДКА
        console.log('[MCP Bridge] ====== Installed Extensions ======');
        installedExtensions.forEach((ext, i) => {
            console.log(`[MCP Bridge] [${i}] id: ${ext.id}, name: ${ext.name}, enabled: ${ext.enabled}`);
        });
        console.log('[MCP Bridge] ====== Conflict List ======');
        console.log('[MCP Bridge]', JSON.stringify(conflictList, null, 2));

        const enabledExtensionIds = new Set(
            installedExtensions.filter(ext => ext.enabled).map(ext => ext.id)
        );

        const affectedHostnames = [];
        const conflictNames = [];
        for (const entry of conflictList) {
            if (enabledExtensionIds.has(entry.extension_id)) {
                if (entry.affected_sites && Array.isArray(entry.affected_sites)) {
                    affectedHostnames.push(...entry.affected_sites);
                }
                if (entry.name) {
                    conflictNames.push(entry.name);
                }
            }
        }

        console.log('[MCP Bridge] Conflicts:', conflictNames, 'Sites:', affectedHostnames);
        console.log('[MCP Bridge] Enabled IDs:', [...enabledExtensionIds]);

        await chrome.storage.local.set({
            conflict_disabled_sites: affectedHostnames,
            conflict_check_timestamp: Date.now()
        });
    } catch (error) {
        console.error('[MCP Bridge] Conflict detection failed:', error);
    }
}