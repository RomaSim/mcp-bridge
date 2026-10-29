# Руководство по разработке MCP Bridge

## Содержание

- [Настройка среды разработки](#настройка-среды-разработки)
- [Структура проекта](#структура-проекта)
- [Приёмы отладки](#приёмы-отладки)
- [Добавление поддержки новой платформы](#добавление-поддержки-новой-платформы)
- [Рабочий процесс разработки](#рабочий-процесс-разработки)
- [Стандарты кода](#стандарты-кода)
- [Частые вопросы](#частые-вопросы)

---

## Настройка среды разработки

### Предварительные требования

1. **Браузер**: Chrome/Edge (версия 88+)
2. **Редактор кода**: VS Code (рекомендуется)
3. **Контроль версий**: Git

### Установка среды разработки

#### 1. Клонирование проекта

```bash
git clone https://github.com/WongJingGitt/mcp_bridge.git
cd mcp_bridge
```

#### 2. Установка браузерного расширения (режим разработки)

1. Откройте Chrome, перейдите по адресу `chrome://extensions/`
2. Включите «Режим разработчика» в правом верхнем углу
3. Нажмите «Загрузить распакованное расширение»
4. Выберите корневой каталог проекта

#### 3. Настройка мостового сервиса

Обратитесь к документации проекта [MCPBridgeServer](https://github.com/WongJingGitt/mcp_bridge_server).

#### 4. Рекомендуемые расширения VS Code

Установите следующие расширения для улучшения процесса разработки:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",       // Проверка кода JavaScript
    "esbenp.prettier-vscode",        // Форматирование кода
    "ms-vscode.vscode-js-debug",     // Отладка JavaScript
    "christian-kohler.path-intellisense" // Автодополнение путей
  ]
}
```

---

## Структура проекта

```
mcp_bridge/
├── manifest.json              # Файл манифеста расширения
├── config/
│   └── api_list.json          # Конфигурация ИИ-платформ
├── modules/
│   ├── api_client.js          # API-клиент мостового сервиса
│   ├── prompt_builder.js      # Построитель промптов
│   ├── input_injector.js      # Инъектор в поле ввода
│   └── compareVersion.js      # Утилита сравнения версий
├── scripts/
│   ├── background.js          # Фоновый скрипт (основная логика)
│   ├── content_script.js      # Контент-скрипт (взаимодействие со страницей)
│   └── page_world/            # Скрипты мира страницы
│       ├── injector.js        # Инъектор скриптов
│       ├── fetchhook.js       # Перехватчик Fetch
│       └── ajaxhook.min.js    # Перехватчик XHR
├── ui/
│   ├── status_panel.js        # Компонент панели состояния
│   ├── status_panel.css       # Стили панели состояния
│   ├── confirm_dialog.js      # Компонент диалога подтверждения
│   └── confirm_dialog.css     # Стили диалога подтверждения
├── options/
│   ├── options.html           # Страница настроек
│   ├── options.js             # Логика страницы настроек
│   └── options.css            # Стили страницы настроек
├── popup/
│   ├── popup.html             # Всплывающее окно
│   ├── popup.js               # Логика всплывающего окна
│   └── popup.css              # Стили всплывающего окна
└── icons/                     # Ресурсы иконок
```

### Описание основных файлов

| Файл | Ответственность | Частота изменений |
|------|------|----------|
| `manifest.json` | Конфигурация расширения | Низкая |
| `config/api_list.json` | Конфигурация платформ | Высокая (добавление новых платформ) |
| `scripts/background.js` | Основная бизнес-логика | Средняя |
| `modules/api_client.js` | Связь с API | Низкая |
| `modules/prompt_builder.js` | Шаблоны промптов | Средняя |
| `ui/status_panel.js` | Компоненты UI | Низкая |

---

## Приёмы отладки

### 1. Отладка фонового скрипта

**Шаги**
1. Перейдите по адресу `chrome://extensions/`
2. Найдите MCP Bridge, нажмите на ссылку «Service Worker»
3. Откроется DevTools, переключитесь на вкладку Console

**Просмотр логов**
```javascript
// Логи из background.js будут отображаться здесь
console.log('[MCP Bridge] Debug info:', data);
```

**Отладка с точками останова**
1. В DevTools на вкладке Sources найдите `background.js`
2. Установите точку останова
3. Выполните соответствующее действие

### 2. Отладка контент-скрипта

**Шаги**
1. На целевой странице (например, DeepSeek Chat) откройте DevTools (F12)
2. Переключитесь на вкладку Console
3. Отфильтруйте логи: введите `MCP Bridge`

**Просмотр внедрённых скриптов**
1. Откройте DevTools → Sources
2. Разверните `Content scripts`
3. Найдите `content_script.js`

### 3. Отладка скриптов страницы

**Шаги**
1. На целевой странице откройте DevTools
2. Sources → Page → top
3. Найдите `fetchhook.js` или `injector.js`

**Отладка перехвата сети с точками останова**
```javascript
// Установите точку останова в fetchhook.js
window.fetch = new Proxy(originalFetch, {
  apply: async (target, thisArg, args) => {
    debugger; // установите точку останова здесь
    // ...
  }
});
```

### 4. Отладка сетевых запросов

**Просмотр перехваченных запросов**
1. DevTools → Network
2. Фильтр: введите путь API ИИ-платформы (например, `/api/v0/chat/completion`)
3. Просмотрите заголовки, тело запроса, ответ

**Просмотр запросов к мостовому сервису**
1. Фильтр: введите `localhost:3849`
2. Просмотрите запросы и ответы вызовов инструментов

### 5. Использование Chrome DevTools Protocol

**Расширенная отладка**: прослушивание всех сетевых запросов

```javascript
// background.js
chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
  chrome.debugger.sendCommand({ tabId: tabId }, "Network.enable");
});

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === "Network.responseReceived") {
    console.log('Response:', params);
  }
});
```

### 6. Управление уровнем логирования

**Конфигурация через переменные окружения** (будущая функция)
```javascript
// background.js
const DEBUG_LEVEL = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3
};

let currentLevel = DEBUG_LEVEL.DEBUG; // режим разработки

function log(level, message, data) {
  if (level <= currentLevel) {
    console.log(`[MCP Bridge][${level}]`, message, data);
  }
}
```

---

## Добавление поддержки новой платформы

### Полное пошаговое руководство

#### Шаг 1: Анализ целевой платформы

1. **Откройте целевую ИИ-платформу** (например, Claude Web)
2. **Откройте DevTools → Network**
3. **Начните диалог, наблюдайте за сетевыми запросами**

**Необходимая информация**
- Путь API (например, `/api/chat`)
- Метод запроса (обычно POST)
- Структура тела запроса
- Формат ответа (JSON, SSE, Text)

#### Шаг 2: Определение ключевых путей

**1. Путь для инъекции промпта**

Просмотрите JSON тела запроса, найдите местоположение сообщения пользователя.

**Пример 1**: простой путь
```json
{
  "prompt": "Сообщение пользователя",  // ← путь инъекции: "prompt"
  "model": "gpt-4"
}
```

**Пример 2**: вложенный путь
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Сообщение пользователя"  // ← путь инъекции: "messages.0.content"
    }
  ]
}
```

**Пример 3**: поле JSON-строки
```json
{
  "messages": [
    {
      "content": "{\"text\": \"Сообщение пользователя\"}"  // ← требуется разбор JSON-строки
    }
  ]
}
```
Путь: `"messages.0.content.text"`, установите `isJsonString: true`

**2. Путь к содержимому ответа**

Просмотрите данные ответа, найдите местоположение ответа ИИ.

**Пример 1**: формат SSE
```
data: {"content": "Ответ ИИ"}

data: {"content": "Продолжение ответа"}
```
contentPaths: `["content"]`

**Пример 2**: многоуровневая вложенность
```
data: {"choices": [{"delta": {"content": "Ответ ИИ"}}]}
```
contentPaths: `["choices.0.delta.content"]`

**3. Селектор поля ввода**

Найдите элемент поля ввода на странице.

**Способ 1**:使用 DevTools
1. Нажмите на инструмент выбора в левом верхнем углу вкладки Elements
2. Кликните по полю ввода
3. Просмотрите ID, class или другие атрибуты элемента

**Способ 2**: выполните в Console
```javascript
// Проверьте правильность селектора
document.querySelector('textarea');
document.querySelector('#prompt-textarea');
document.querySelector('[contenteditable="true"]');
```

#### Шаг 3: Написание конфигурации

Добавьте конфигурацию в `config/api_list.json`.

**Минимальный шаблон конфигурации**
```json
{
  "name": "platform_id",
  "hostname": "platform.example.com",
  "label": "Название платформы",
  "api": ["/api/chat"],
  "promptPath": "prompt",
  "isJsonString": false,
  "enabled": true,
  "defaultAlwaysInject": true,
  "response": {
    "type": "sse",
    "format": "data: {json}",
    "contentPaths": ["content"]
  },
  "input": {
    "selector": "textarea",
    "submitKey": "Enter",
    "submitModifiers": [],
    "submitDelay": 1600
  }
}
```

**Полный шаблон конфигурации** (с опциональными полями)
```json
{
  "name": "platform_id",
  "hostname": "platform.example.com",
  "label": "Название платформы",
  "api": ["/api/chat", "/api/v2/chat"],
  "promptPath": "messages.0.content",
  "isJsonString": false,
  "enabled": true,
  "defaultAlwaysInject": true,
  "skipRequestModification": false,
  "response": {
    "type": "sse",
    "format": "data: {json}\\n\\n",
    "contentPaths": ["choices.0.delta.content", "content"],
    "filterRules": {
      "pathField": "type",
      "excludePatterns": ["metadata"]
    }
  },
  "uiParsing": {
    "enabled": true,
    "priority": "api",
    "messageContainer": ".message",
    "messageIndex": -1,
    "contentSelector": ".markdown"
  },
  "input": {
    "selector": "textarea, [contenteditable='true']",
    "submitKey": "Enter",
    "submitModifiers": ["Ctrl"],
    "submitDelay": 1600
  },
  "newConversationFlag": {
    "from": "requestBody",
    "path": "conversation_id",
    "checkExists": false
  },
  "onLoadTip": {
    "message": ["Первая строка подсказки", "Вторая строка подсказки"],
    "dontShowAgainText": "Больше не показывать"
  }
}
```

#### Шаг 4: Обновление manifest.json

Добавьте домен новой платформы в список разрешений.

```json
{
  "host_permissions": [
    "https://platform.example.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://platform.example.com/*"
      ],
      "js": [
        "scripts/page_world/fetchhook.js",
        "scripts/page_world/ajaxhook.min.js",
        "scripts/page_world/injector.js"
      ],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ]
}
```

#### Шаг 5: Тестирование

**Чек-лист тестирования**

- [ ] При новом диалоге System Prompt внедряется корректно?
  - Откройте DevTools → Network
  - Начните новый диалог
  - Проверьте, содержит ли тело запроса MCP Prompt

- [ ] Вызов инструмента обнаруживается корректно?
  - Попросите ИИ вызвать инструмент (например, «выведи список инструментов сервиса filesystem»)
  - Проверьте, отображает ли панель состояния «Выполняется»

- [ ] Результат инструмента возвращается корректно?
  - После завершения выполнения инструмента
  - Автоматически ли заполняется поле ввода результатом и отправляется

- [ ] UI-разбор работает нормально?
  - Если настроен `uiParsing`
  - Проверьте успешность разбора из DOM

- [ ] Ручной ввод доступен?
  - Скопируйте текст, содержащий `<tool_code>`
  - Вставьте в поле ввода панели состояния
  - Нажмите «Отправить в MCP»

#### Шаг 6: Оптимизация конфигурации

**Типичные проблемы и оптимизация**

1. **Повторная инъекция System Prompt**
   - Проблема: инъекция при каждой отправке сообщения
   - Решение: правильно настройте `newConversationFlag`

2. **Сбой обнаружения вызова инструмента**
   - Проблема: низкая успешность API-разбора
   - Решение: включите UI-разбор, установите `priority: "ui"`

3. **Поле ввода не отправляется автоматически**
   - Проблема: неверная клавиша отправки
   - Решение: попробуйте разные `submitKey` и `submitModifiers`

4. **Медленная загрузка страницы**
   - Проблема: слишком раннее время инъекции скрипта
   - Решение: настройте `submitDelay`

---

## Рабочий процесс разработки

### Типичный процесс разработки

```
1. Создание ветки функции
   ↓
2. Изменение кода
   ↓
3. Перезагрузка расширения
   ↓
4. Тестирование функции
   ↓
5. Просмотр логов/отладка
   ↓
6. Исправление проблем
   ↓
7. Фиксация кода
   ↓
8. Создание Pull Request
```

### Приёмы горячей перезагрузки

**Способ 1**: использование горячих клавиш
1. Перейдите по адресу `chrome://extensions/`
2. Найдите MCP Bridge
3. Нажмите значок обновления (или используйте `Ctrl+R`)

**Способ 2**: использование менеджера расширений
- Установите [Extensions Reloader](https://chrome.google.com/webstore/detail/extensions-reloader/fimgfedafeadlieiabdeeaodndnlbhid)
- Перезагружайте все расширения одним кликом

**Способ 3**: программная перезагрузка
```javascript
// Добавьте кнопку перезагрузки в popup.js или options.js
document.getElementById('reloadBtn').addEventListener('click', () => {
  chrome.runtime.reload();
});
```

### Управление версиями

**Спецификация номеров версий**: следуйте семантическому версионированию (Semantic Versioning)

```
主版本号.次版本号.修订号

1.0.0 → 1.0.1  (исправление ошибки)
1.0.1 → 1.1.0  (добавление новой функции, обратная совместимость)
1.1.0 → 2.0.0  (критические изменения)
```

**Обновление manifest.json**
```json
{
  "version": "1.1.0"
}
```

**Создание Git Tag**
```bash
git tag -a v1.1.0 -m "Release version 1.1.0"
git push origin v1.1.0
```

---

## Стандарты кода

### Стандарты кодирования JavaScript

**1. Использование синтаксиса ES6+**
```javascript
// ✅ Рекомендуется
const result = await fetchData();
const { name, age } = user;

// ❌ Избегайте
var result = fetchData().then(...);
var name = user.name;
var age = user.age;
```

**2. Правила именования**
```javascript
// Переменные и функции: camelCase
const userName = 'Alice';
function getUserData() {}

// Константы: UPPER_SNAKE_CASE
const API_TIMEOUT = 5000;

// Классы: PascalCase
class StatusPanel {}
```

**3. Асинхронная обработка**
```javascript
// ✅ Рекомендуется: async/await
async function handleRequest() {
  try {
    const data = await fetchData();
    return data;
  } catch (error) {
    console.error('Error:', error);
  }
}

// ❌ Избегайте: ад обратных вызовов
fetchData(function(data) {
  processData(data, function(result) {
    saveResult(result, function() {
      // ...
    });
  });
});
```

**4. Обработка ошибок**
```javascript
// ✅ Рекомендуется: подробная информация об ошибке
try {
  const result = await executeTool(toolName, args);
} catch (error) {
  console.error(`[MCP Bridge] Failed to execute tool ${toolName}:`, error);
  throw new Error(`工具 ${toolName} 执行失败: ${error.message}`);
}

// ❌ Избегайте: молчаливый сбой
try {
  await executeTool(toolName, args);
} catch (error) {
  // ничего не делаем
}
```

**5. Стандарты комментариев**
```javascript
/**
 * Выполнить инструмент MCP
 * @param {string} toolName - имя инструмента
 * @param {Object} args - параметры инструмента
 * @returns {Promise<any>} - результат выполнения инструмента
 * @throws {Error} - при сбое выполнения инструмента
 */
async function executeTool(toolName, args) {
  // Реализация...
}
```

### Стандарты JSON-конфигурации

**1. Использование отступа в 2 пробела**
```json
{
  "name": "deepseek",
  "api": [
    "/api/v0/chat/completion"
  ]
}
```

**2. Добавление комментариев** (примечание: стандартный JSON не поддерживает комментарии, но можно описать в документации)
```javascript
// config/api_list.json
[
  {
    // Уникальный идентификатор платформы
    "name": "deepseek",
    
    // Доменное имя (без протокола)
    "hostname": "chat.deepseek.com",
    
    // ...
  }
]
```

### Стандарты Git-коммитов

**Формат сообщения коммита**
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Типы (type)**
- `feat`: новая функция
- `fix`: исправление ошибки
- `docs`: обновление документации
- `style`: корректировка форматирования кода
- `refactor`: рефакторинг
- `test`: тестирование
- `chore`: сборка/инструменты

**Пример**
```
feat(config): add support for Claude Web

- Add Claude configuration to api_list.json
- Update manifest.json with claude.ai domain
- Test tool calling on Claude platform

Closes #123
```

---

## Частые вопросы

### В1: Изменения в коде не вступают в силу?

**О**: Необходимо перезагрузить расширение.
1. Перейдите по адресу `chrome://extensions/`
2. Найдите MCP Bridge, нажмите значок обновления
3. Обновите тестовую страницу

### В2: Не удаётся отладить background.js?

**О**: Service Worker мог остановиться.
1. Перейдите по адресу `chrome://extensions/`
2. Нажмите на ссылку «Service Worker» для перезапуска
3. Теперь логи Console будут видны

### В3: content_script.js не может получить доступ к объекту window?

**О**: Content Script работает в изолированной среде и не может напрямую обращаться к window страницы.
- Решение: используйте `world: "MAIN"` для внедрения скрипта в среду страницы
- Или: общайтесь через `window.postMessage`

### В4: Как имитировать SSE-ответ для тестирования?

**О**: Используйте Mock-сервер.
```javascript
// test-server.js
const express = require('express');
const app = express();

app.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.write('data: {"content": "Hello"}\n\n');
  setTimeout(() => {
    res.write('data: {"content": " World"}\n\n');
    res.end();
  }, 1000);
});

app.listen(3000);
```

### В5: Как изменения конфигурации вступают в силу?

**О**: 
- `api_list.json`: требуется перезагрузка расширения
- `mcp-config.json`: горячая перезагрузка происходит автоматически (мостовой сервис)

### В6: Как тестировать несколько версий?

**О**: Используйте разные профили браузера.
```bash
# Chrome
chrome.exe --user-data-dir="C:\temp\chrome-dev"

# Edge
msedge.exe --user-data-dir="C:\temp\edge-dev"
```

### В7: Анализ производительности?

**О**: Используйте вкладку Performance в Chrome DevTools.
1. Откройте DevTools целевой страницы
2. Переключитесь на Performance
3. Нажмите Record
4. Выполните действие
5. Остановите запись, проанализируйте результат

---

## Продвинутые темы

### Пользовательские шаблоны промптов

Отредактируйте `modules/prompt_builder.js`:

```javascript
export function buildInitialPrompt(services) {
  // Настройте структуру вашего промпта
  return `
Ты — улучшенный ИИ-ассистент, имеющий следующие инструменты:
${services.map(s => `- ${s.name}: ${s.description}`).join('\n')}

При использовании инструмента выводи:
<tool_code>{"tool_name": "...", "arguments": {...}}</tool_code>
`.trim();
}
```

### Добавление новых компонентов UI

```javascript
// ui/my_component.js
export class MyComponent {
  constructor() {
    this.element = null;
  }
  
  create() {
    this.element = document.createElement('div');
    this.element.id = 'my-component';
    document.body.appendChild(this.element);
  }
  
  update(data) {
    this.element.textContent = data;
  }
  
  destroy() {
    this.element?.remove();
  }
}
```

### Расширение API мостового сервиса

Обратитесь к [документации разработчика MCPBridgeServer](https://github.com/WongJingGitt/mcp_bridge_server).

---

## Полезные ресурсы

- [Официальная документация Chrome Extension](https://developer.chrome.com/docs/extensions/)
- [Руководство по миграции на Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Спецификация протокола MCP](https://modelcontextprotocol.io)
- [Официальная документация Flask](https://flask.palletsprojects.com/)

---

**Happy Coding! 🚀**

Если у вас есть вопросы, задайте их в [GitHub Issues](https://github.com/WongJingGitt/mcp_bridge/issues).