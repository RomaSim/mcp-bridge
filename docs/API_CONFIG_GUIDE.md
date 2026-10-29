# Полное руководство по конфигурации API

## Содержание

- [Обзор](#обзор)
- [Структура файла конфигурации](#структура-файла-конфигурации)
- [Подробное описание полей](#подробное-описание-полей)
- [Расширенная конфигурация](#расширенная-конфигурация)
- [Примеры конфигурации](#примеры-конфигурации)
- [Типовые сценарии](#типовые-сценарии)
- [Устранение неполадок](#устранение-неполадок)

---

## Обзор

`config/api_list.json` — это основной файл конфигурации MCP Bridge, который определяет поддерживаемые ИИ-платформы и их поведение.

### Роль конфигурации

1. **Сетевой перехват**: указывает расширению, какие API-запросы перехватывать.
2. **Инъекция промпта**: определяет, в какое поле тела запроса внедрять System Prompt.
3. **Разбор ответа**: определяет, как извлекать ответ ИИ из ответа сервера.
4. **Обнаружение вызова инструментов**: настраивает способ обнаружения команд вызова инструментов.
5. **Инъекция ввода**: указывает селектор поля ввода и способ отправки.

---

## Структура файла конфигурации

`api_list.json` — это массив JSON, каждый элемент которого представляет конфигурацию одной ИИ-платформы.

```json
[
  {
    "name": "platform_id",
    "hostname": "platform.example.com",
    "label": "Отображаемое имя платформы",
    "api": ["/api/endpoint"],
    "promptPath": "path.to.prompt",
    "isJsonString": false,
    "enabled": true,
    "defaultAlwaysInject": true,
    "response": { /* конфигурация ответа */ },
    "uiParsing": { /* конфигурация UI-разбора */ },
    "input": { /* конфигурация ввода */ },
    "newConversationFlag": { /* определение нового диалога */ },
    "onLoadTip": { /* подсказка при загрузке страницы */ }
  }
]
```

---

## Подробное описание полей

### Базовые поля

#### `name`
- **Тип**: `string`
- **Обязательно**: ✅
- **Описание**: Уникальный идентификатор платформы, используется во внутренней логике.
- **Правила именования**: строчные буквы и подчёркивания, например `deepseek`, `chatgpt`, `claude_web`.
- **Пример**:
  ```json
  "name": "deepseek"
  ```

#### `hostname`
- **Тип**: `string`
- **Обязательно**: ✅
- **Описание**: Доменное имя платформы (без протокола).
- **Назначение**:
  - Проверка, является ли текущая страница этой платформой.
  - Сохранение пользовательских настроек для сайта.
- **Пример**:
  ```json
  "hostname": "chat.deepseek.com"
  ```

#### `label`
- **Тип**: `string`
- **Обязательно**: ✅
- **Описание**: Отображаемое имя платформы для UI.
- **Пример**:
  ```json
  "label": "DeepSeek官网"
  ```

#### `api`
- **Тип**: `string[]`
- **Обязательно**: ✅
- **Описание**: Массив фрагментов пути API для сопоставления сетевых запросов, которые нужно перехватывать.
- **Правило сопоставления**: если URL запроса содержит любую из строк массива, запрос перехватывается.
- **Пример**:
  ```json
  "api": ["/api/v0/chat/completion", "/api/v0/chat/edit_message"]
  ```

#### `promptPath`
- **Тип**: `string` или `string[]`
- **Обязательно**: ✅
- **Описание**: Путь для инъекции System Prompt в тело запроса.
- **Синтаксис пути**: разделение точкой `.`, цифры обозначают индекс массива.
- **Поддержка нескольких путей**: может быть массивом строк, инъекция выполняется по всем путям.
- **Пример**:
  ```json
  // Один путь
  "promptPath": "prompt"
  
  // Вложенный путь
  "promptPath": "messages.0.content"
  
  // Несколько путей (одновременная инъекция в два поля)
  "promptPath": ["prompt", "displayPrompt"]
  ```

#### `isJsonString`
- **Тип**: `boolean`
- **Обязательно**: ✅
- **Описание**: Является ли значение поля промпта JSON-строкой.
- **Когда true**: когда значение целевого поля не является обычной строкой, а представляет собой сериализованную JSON-строку, содержащую объект.
- **Пример**:
  ```json
  // isJsonString: false
  {
    "prompt": "Сообщение пользователя"
  }
  
  // isJsonString: true
  {
    "messages": [
      {
        "content": "{\"text\": \"Сообщение пользователя\"}"  // это JSON-строка
      }
    ]
  }
  // Конфигурация: "promptPath": "messages.0.content.text", "isJsonString": true
  ```

#### `enabled`
- **Тип**: `boolean`
- **Обязательно**: ✅
- **Описание**: Включена ли поддержка данной платформы.
- **Назначение**: позволяет временно отключить платформу без удаления конфигурации.
- **Пример**:
  ```json
  "enabled": true
  ```

#### `defaultAlwaysInject`
- **Тип**: `boolean`
- **Обязательно**: ✅
- **Описание**: Внедрять ли System Prompt по умолчанию каждый раз.
- **Влияние**: настройка по умолчанию при первом посещении платформы пользователем.
- **Пользователь может изменить**: на странице настроек расширения можно изменить это поведение.
- **Пример**:
  ```json
  "defaultAlwaysInject": true
  ```

---

### Конфигурация разбора ответа (`response`)

Используется для извлечения содержимого ответа ИИ для обнаружения вызова инструментов.

```json
"response": {
  "type": "sse",
  "format": "data: {json}\n\n",
  "contentPaths": ["content", "choices.0.delta.content"],
  "filterRules": {
    "pathField": "type",
    "excludePatterns": ["metadata"]
  }
}
```

#### `response.type`
- **Тип**: `string`
- **Обязательно**: ✅
- **Возможные значения**:
  - `"sse"`: Server-Sent Events (потоковый ответ)
  - `"json"`: обычный JSON-ответ
  - `"text"`: простой текстовый ответ
- **Описание**: тип формата данных ответа.
- **Пример**:
  ```json
  "type": "sse"
  ```

#### `response.format`
- **Тип**: `string`
- **Обязательно**: только если `type` равен `"sse"`
- **Описание**: шаблон формата SSE-данных, `{json}` обозначает позицию JSON-данных.
- **Типичные форматы**:
  ```json
  // Стандартный SSE-формат
  "format": "data: {json}\n\n"
  
  // Только префикс data
  "format": "data: {json}"
  
  // Без префикса (некоторые платформы)
  "format": "{json}"
  ```

#### `response.contentPaths`
- **Тип**: `string[]`
- **Обязательно**: ✅
- **Описание**: массив путей для извлечения содержимого из JSON ответа.
- **Стратегия нескольких путей**: попытки по порядку, возвращается первое успешно извлечённое значение.
- **Синтаксис пути**: разделение точкой `.`.
- **Пример**:
  ```json
  // Попытка трёх путей
  "contentPaths": [
    "choices.0.delta.content",  // сначала
    "delta.content",            // затем
    "content"                   // в конце
  ]
  ```

#### `response.filterRules` (опционально)
- **Тип**: `object`
- **Описание**: правила фильтрации для пропуска ненужных данных.
- **Поля**:
  - `pathField`: путь к полю для проверки.
  - `excludePatterns`: массив значений для исключения.
- **Пример**:
  ```json
  "filterRules": {
    "pathField": "p",
    "excludePatterns": ["fragments/0/content"]
  }
  // Когда значение поля p в ответе равно "fragments/0/content", данные пропускаются
  ```

---

### Конфигурация UI-разбора (`uiParsing`)

Когда разбор API не удаётся, содержимое извлекается из DOM страницы.

```json
"uiParsing": {
  "enabled": true,
  "priority": "api",
  "messageContainer": ".chat-message",
  "messageIndex": -1,
  "contentSelector": ".markdown-content"
}
```

#### `uiParsing.enabled`
- **Тип**: `boolean`
- **Обязательно**: ✅
- **Описание**: включён ли UI-разбор.
- **Рекомендация**: всегда включать как запасной вариант к API-разбору.
- **Пример**:
  ```json
  "enabled": true
  ```

#### `uiParsing.priority`
- **Тип**: `string`
- **Обязательно**: ✅
- **Возможные значения**:
  - `"api"`: приоритет API, UI используется только при неудаче.
  - `"ui"`: приоритет UI, используется непосредственно содержимое DOM.
- **Описание**: приоритет разбора.
- **Рекомендации**:
  - Для платформ с высокой успешностью API-разбора — `"api"`.
  - Для платформ, где API-разбор затруднён — `"ui"`.
- **Пример**:
  ```json
  "priority": "api"
  ```

#### `uiParsing.messageContainer`
- **Тип**: `string` или `string[]`
- **Обязательно**: ✅
- **Описание**: CSS-селектор контейнера сообщения.
- **Поддержка нескольких селекторов**: можно задать массив для адаптации к разным формам сообщений.
- **Логика нескольких селекторов**:
  - Собираются все совпавшие элементы (из всех селекторов).
  - Удаляются дубликаты.
  - Сортировка по порядку в DOM.
  - По `messageIndex` выбирается сообщение с указанной позицией.
- **Требование**: селектор должен соответствовать всем элементам сообщений.
- **Как получить**:
  1. Откройте DevTools.
  2. Используйте инструмент выбора элемента, чтобы кликнуть по сообщению.
  3. Посмотрите класс или другие атрибуты элемента.
- **Пример**:
  ```json
  // Один селектор
  "messageContainer": ".ds-message"
  
  // Несколько селекторов (адаптация к разным формам сообщений)
  "messageContainer": [
    ".tongyi-markdown",
    ".message-content",
    "[data-message-type='text']"
  ]
  ```

#### `uiParsing.messageIndex`
- **Тип**: `number`
- **Обязательно**: ✅
- **Описание**: индекс извлекаемого сообщения.
- **Значения**:
  - `0`, `1`, `2`, ... : прямой индекс от первого сообщения.
  - `-1`, `-2`, `-3`, ... : обратный индекс от последнего сообщения.
- **Часто используемое значение**: `-1` (последнее сообщение, т.е. последний ответ ИИ).
- **Пример**:
  ```json
  "messageIndex": -1
  ```

#### `uiParsing.contentSelector` (опционально)
- **Тип**: `string` или `string[]`
- **Описание**: селектор содержимого сообщения (ищется внутри messageContainer).
- **Поддержка нескольких селекторов**: можно задать массив, попытки по порядку, используется первый совпавший.
- **Когда использовать**: если контейнер сообщения содержит много других элементов (аватары, временные метки), используйте этот селектор для точного указания области содержимого.
- **Пустая строка**: означает использование самого контейнера без повторного поиска.
- **Пример**:
  ```json
  // Один селектор
  "contentSelector": ".markdown-content"
  
  // Несколько селекторов (по приоритету)
  "contentSelector": [
    ".markdown-body",
    ".message-text",
    ""  // запасной вариант: использовать сам контейнер
  ]
  ```

---

### Конфигурация ввода (`input`)

Определяет, как вставлять результаты инструментов в поле ввода и отправлять их.

```json
"input": {
  "selector": "textarea, [contenteditable='true']",
  "submitKey": "Enter",
  "submitModifiers": [],
  "submitDelay": 1600
}
```

#### `input.selector`
- **Тип**: `string`
- **Обязательно**: ✅
- **Описание**: CSS-селектор поля ввода.
- **Поддержка**: несколько селекторов (через запятую), используется первый совпавший элемент.
- **Типичные селекторы**:
  ```json
  // Textarea
  "selector": "textarea"
  
  // Определённый ID
  "selector": "#prompt-textarea"
  
  // Contenteditable div
  "selector": "[contenteditable='true']"
  
  // Несколько селекторов
  "selector": "textarea, [contenteditable='true']"
  ```

#### `input.submitKey`
- **Тип**: `string`
- **Обязательно**: ✅
- **Описание**: клавиша отправки.
- **Возможные значения**:
  - `"Enter"`: клавиша Enter.
  - `"NumpadEnter"`: Enter на цифровой клавиатуре.
  - другие значения [KeyboardEvent.key](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values).
- **Пример**:
  ```json
  "submitKey": "Enter"
  ```

#### `input.submitModifiers`
- **Тип**: `string[]`
- **Обязательно**: ✅
- **Описание**: клавиши-модификаторы, необходимые для отправки.
- **Возможные значения**:
  - `"Ctrl"`: клавиша Ctrl.
  - `"Shift"`: клавиша Shift.
  - `"Alt"`: клавиша Alt.
  - `"Meta"`: Command на Mac, Win на Windows.
- **Пример**:
  ```json
  // Только Enter
  "submitModifiers": []
  
  // Ctrl + Enter
  "submitModifiers": ["Ctrl"]
  
  // Ctrl + Shift + Enter
  "submitModifiers": ["Ctrl", "Shift"]
  ```

#### `input.submitDelay`
- **Тип**: `number`
- **Обязательно**: ✅
- **Описание**: задержка между вставкой текста и отправкой (в миллисекундах).
- **Назначение**: ожидание обновления UI страницы, чтобы кнопка отправки стала доступной.
- **Рекомендуемое значение**: 1600–2000 мс.
- **Пример**:
  ```json
  "submitDelay": 1600
  ```

---

### Определение нового диалога (`newConversationFlag`)

Определяет, как понять, что это новый диалог, чтобы решить, внедрять ли полный System Prompt.

```json
"newConversationFlag": {
  "from": "requestBody",
  "path": "conversation_id",
  "checkExists": false,
  "checkValue": "0",
  "valueType": "string"
}
```

#### `newConversationFlag.from`
- **Тип**: `string`
- **Обязательно**: ✅
- **Возможные значения**: `"requestBody"` (в будущем возможно `"headers"`, `"url"` и т.д.).
- **Описание**: откуда получать поле для проверки.
- **Пример**:
  ```json
  "from": "requestBody"
  ```

#### `newConversationFlag.path`
- **Тип**: `string`
- **Обязательно**: ✅
- **Описание**: путь к полю проверки в теле запроса.
- **Пример**:
  ```json
  "path": "conversation_id"
  ```

#### `newConversationFlag.checkExists`
- **Тип**: `boolean`
- **Описание**: проверять наличие поля.
- **Логика**:
  - `true`: если поле существует — новый диалог.
  - `false`: если поле отсутствует — новый диалог.
- **Пример**:
  ```json
  // Если есть поле chatModelExtInfo — новый диалог
  "checkExists": true,
  "path": "chatModelExtInfo"
  ```

#### `newConversationFlag.checkValue`
- **Тип**: `any`
- **Описание**: проверять значение поля.
- **Вместе с checkExists**: можно сначала проверить наличие, затем значение.
- **Пример**:
  ```json
  // Если conversation_id равен "0" — новый диалог
  "checkValue": "0",
  "valueType": "string"
  ```

#### `newConversationFlag.valueType`
- **Тип**: `string`
- **Возможные значения**: `"string"`, `"number"`, `"boolean"`, `"null"`
- **Описание**: тип значения для точного сравнения.
- **Пример**:
  ```json
  "valueType": "string"
  ```

**Полные примеры**:

```json
// Пример 1: проверка наличия поля
{
  "from": "requestBody",
  "path": "chatModelExtInfo",
  "checkExists": true  // если поле существует — новый диалог
}

// Пример 2: проверка значения поля
{
  "from": "requestBody",
  "path": "conversation_id",
  "checkValue": "0",
  "valueType": "string"  // если conversation_id === "0" — новый диалог
}

// Пример 3: проверка отсутствия поля
{
  "from": "requestBody",
  "path": "conversation_id",
  "checkExists": false  // если conversation_id отсутствует — новый диалог
}
```

---

### Подсказка при загрузке страницы (`onLoadTip`)

Показывает диалоговое окно при загрузке страницы для важных уведомлений.

```json
"onLoadTip": {
  "title": "Подсказка",
  "message": ["Первая строка", "Вторая строка"],
  "confirmText": "Понятно",
  "cancelText": "Закрыть",
  "type": "default",
  "delay": 500,
  "dontShowAgainText": "Больше не показывать"
}
```

#### `onLoadTip.title` (опционально)
- **Тип**: `string`
- **Значение по умолчанию**: `"MCP Bridge 提示"`
- **Описание**: заголовок диалогового окна.
- **Пример**:
  ```json
  "title": "Важное уведомление"
  ```

#### `onLoadTip.message`
- **Тип**: `string` или `string[]`
- **Обязательно**: ✅
- **Описание**: содержимое сообщения.
- **Формат**:
  - строка: однострочное сообщение.
  - массив строк: многострочное сообщение (каждый элемент — строка).
- **Пример**:
  ```json
  // Однострочное
  "message": "Эта платформа не поддерживает автоматическую инъекцию"
  
  // Многострочное
  "message": [
    "Google AI Studio не поддерживает автоматическую инъекцию System Prompt",
    "",
    "Пожалуйста, нажмите кнопку обновления вручную для инъекции"
  ]
  ```

#### `onLoadTip.confirmText` (опционально)
- **Тип**: `string`
- **Значение по умолчанию**: `"我知道了"`
- **Описание**: текст кнопки подтверждения.
- **Пример**:
  ```json
  "confirmText": "Понятно"
  ```

#### `onLoadTip.cancelText` (опционально)
- **Тип**: `string`
- **Значение по умолчанию**: `"关闭"`
- **Описание**: текст кнопки отмены.
- **Пример**:
  ```json
  "cancelText": "Закрыть"
  ```

#### `onLoadTip.type` (опционально)
- **Тип**: `string`
- **Возможные значения**: `"default"`, `"warning"`, `"info"`
- **Значение по умолчанию**: `"default"`
- **Описание**: тип диалогового окна (влияет на стиль).
- **Пример**:
  ```json
  "type": "warning"
  ```

#### `onLoadTip.delay` (опционально)
- **Тип**: `number`
- **Значение по умолчанию**: `500`
- **Описание**: задержка отображения после загрузки страницы в миллисекундах.
- **Пример**:
  ```json
  "delay": 1000
  ```

#### `onLoadTip.dontShowAgainText` (опционально)
- **Тип**: `string`
- **Значение по умолчанию**: `"不再提示"`
- **Описание**: текст флажка «Больше не показывать».
- **Пример**:
  ```json
  "dontShowAgainText": "Больше не показывать это уведомление"
  ```

---

### Специальные конфигурации

#### `skipRequestModification`
- **Тип**: `boolean`
- **Обязательно**: нет
- **Значение по умолчанию**: `false`
- **Описание**: пропускать ли модификацию запроса, только прослушивать ответ.
- **Сценарий использования**: некоторые платформы не разрешают изменять запрос, и вызов инструментов можно обнаружить только через UI-разбор.
- **Пример**:
  ```json
  "skipRequestModification": true
  ```

#### `promptFilter`
- **Тип**: `object`
- **Обязательно**: нет
- **Описание**: пользовательская логика получения промпта для обработки сложных структур тела запроса.
- **Сценарии использования**:
  - формат сообщений динамически меняется (например, фильтрация по `mime_type`);
  - необходимо найти сообщение определённого типа в массиве;
  - стандартный путь не подходит.
- **Обязательная пара**: при использовании `promptFilter` необходимо также настроить `promptSetFilter`.
- **Формат конфигурации**:
  ```json
  {
    "preset": "название предустановки",
    "params": {
      "имя параметра": "значение параметра"
    }
  }
  ```
- **Доступные предустановки**:
  - `findByField`: поиск элемента массива по значению поля.
  - `findFirstMatch`: поиск первого совпавшего элемента по приоритету.
  - `filterAndJoin`: фильтрация массива и объединение результатов.
  - `getByIndex`: получение элемента по индексу.
  - `getPath`: прямое получение значения по пути.
- **Пример**:
  ```json
  // Поиск сообщения с mime_type text/plain
  "promptFilter": {
    "preset": "findByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "returnField": "content"
    }
  }
  
  // Поиск по приоритету нескольких типов
  "promptFilter": {
    "preset": "findFirstMatch",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValues": ["text/plain", "text/markdown"],
      "returnField": ["content", "text"]
    }
  }
  ```

#### `promptSetFilter`
- **Тип**: `object`
- **Обязательно**: нет
- **Описание**: пользовательская логика установки промпта, используется в паре с `promptFilter`.
- **Сценарии использования**: необходимо записать изменённый промпт обратно в определённое место.
- **Обязательная пара**: при использовании `promptSetFilter` необходимо также настроить `promptFilter`.
- **Формат конфигурации**: такой же, как у `promptFilter`.
- **Доступные предустановки**:
  - `setByField`: поиск по значению поля и установка.
  - `setByIndex`: установка элемента по указанному индексу.
  - `setPath`: прямая установка значения по пути.
- **Поддержка нескольких полей**: параметр `setField` может быть массивом для одновременной установки нескольких полей.
- **Пример**:
  ```json
  // Установка одного поля
  "promptSetFilter": {
    "preset": "setByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "setField": "content"
    }
  }
  
  // Одновременная установка нескольких полей
  "promptSetFilter": {
    "preset": "setByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "setField": ["content", "meta_data.ori_query"]
    }
  }
  ```

---

## Расширенная конфигурация

### Многопутевая инъекция

Некоторые платформы используют несколько полей в теле запроса для хранения сообщения пользователя, и требуется инъекция одновременно.

```json
{
  "name": "yuanbao",
  "promptPath": ["prompt", "displayPrompt"]
}
```

**Принцип реализации**:
```javascript
// background.js
const promptPaths = Array.isArray(siteConfig.promptPath) 
  ? siteConfig.promptPath 
  : [siteConfig.promptPath];

for (const path of promptPaths) {
  setByPath(bodyJson, path, finalPrompt, siteConfig);
}
```

### Сложная фильтрация ответов

Некоторые платформы возвращают SSE-ответы с несколькими типами данных, которые нужно фильтровать.

```json
{
  "response": {
    "type": "sse",
    "contentPaths": ["v"],
    "filterRules": {
      "pathField": "p",
      "excludePatterns": ["fragments/0/content", "metadata"]
    }
  }
}
```

**Принцип работы**:
```javascript
// Разбор SSE-данных
const data = JSON.parse(chunk);

// Проверка необходимости фильтрации
if (data.p && excludePatterns.includes(data.p)) {
  return; // пропустить эти данные
}

// Извлечение содержимого
const content = data.v;
```

### Обработка полей JSON-строк

Некоторые платформы сериализуют содержимое в JSON-строку.

**Структура тела запроса**:
```json
{
  "messages": [
    {
      "content": "{\"text\": \"Сообщение пользователя\"}"
    }
  ]
}
```

**Конфигурация**:
```json
{
  "promptPath": "messages.0.content.text",
  "isJsonString": true
}
```

**Логика обработки**:
```javascript
// background.js: функция setByPath
if (isJsonString) {
  // 1. Разбор JSON-строки
  const innerObj = JSON.parse(target.content);
  
  // 2. Изменение внутреннего поля
  innerObj.text = newValue;
  
  // 3. Сериализация обратно в строку
  target.content = JSON.stringify(innerObj);
}
```

### Настройка умной клавиши отправки

Разные платформы используют разные способы отправки.

```json
// Только Enter
{
  "input": {
    "submitKey": "Enter",
    "submitModifiers": []
  }
}

// Ctrl + Enter
{
  "input": {
    "submitKey": "Enter",
    "submitModifiers": ["Ctrl"]
  }
}

// Shift + Enter
{
  "input": {
    "submitKey": "Enter",
    "submitModifiers": ["Shift"]
  }
}
```

### Пользовательская фильтрация промпта (promptFilter)

Когда структура тела запроса сложна и стандартный `promptPath` не подходит, используйте `promptFilter` и `promptSetFilter`.

#### Сценарий 1: динамическая фильтрация сообщений по mime_type

**Структура тела запроса**:
```json
{
  "messages": [
    {
      "mime_type": "image/url",
      "content": "Системное сообщение..."
    },
    {
      "mime_type": "text/plain",
      "content": "Сообщение пользователя",
      "meta_data": {
        "ori_query": "Сообщение пользователя"
      }
    }
  ]
}
```

**Конфигурация**:
```json
{
  "promptPath": "messages",  // всё ещё нужен, но будет переопределён promptFilter
  "promptFilter": {
    "preset": "findByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "returnField": "content"
    }
  },
  "promptSetFilter": {
    "preset": "setByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "setField": ["content", "meta_data.ori_query"]
    }
  }
}
```

**Рабочий процесс**:
1. `promptFilter` находит в массиве `messages` сообщение с `mime_type === "text/plain"`.
2. Извлекает значение его поля `content`.
3. Добавляет System Prompt.
4. `promptSetFilter` записывает объединённое содержимое обратно в поля `content` и `meta_data.ori_query`.

#### Сценарий 2: поиск нескольких типов сообщений по приоритету

**Конфигурация**:
```json
{
  "promptFilter": {
    "preset": "findFirstMatch",
    "params": {
      "arrayPath": "messages",
      "matchField": "type",
      "matchValues": ["text", "markdown", "plain"],
      "returnField": ["content", "text", "message"]
    }
  }
}
```

**Логика**:
- Сначала ищется сообщение с `type === "text"`.
- Если нет — с `type === "markdown"`.
- Если всё ещё нет — с `type === "plain"`.
- После нахождения по очереди пытаются извлечь поля `content`, `text`, `message`.

#### Сценарий 3: поддержка параметров-массивов

Все ключевые параметры предустановок поддерживают массивы:

```json
{
  "promptFilter": {
    "preset": "findByField",
    "params": {
      "arrayPath": ["messages", "items", "history"],  // попытка нескольких путей массива
      "matchField": "type",
      "matchValue": "text",
      "returnField": ["content", "text"]  // попытка нескольких полей
    }
  }
}
```

#### Справочник предустановок promptFilter

| Название предустановки | Назначение | Параметры с поддержкой массива |
|---------|------|---------------|
| `findByField` | Поиск по значению поля | `arrayPath`, `returnField` |
| `findFirstMatch` | Поиск по приоритету | `arrayPath`, `matchValues`, `returnField` |
| `filterAndJoin` | Фильтрация и объединение | `arrayPath`, `matchValue`, `returnField` |
| `getByIndex` | Получение по индексу | `arrayPath`, `returnField` |
| `getPath` | Прямое получение пути | `path` |

#### Справочник предустановок promptSetFilter

| Название предустановки | Назначение | Параметры с поддержкой массива |
|---------|------|---------------|
| `setByField` | Установка по значению поля | `arrayPath`, `setField` |
| `setByIndex` | Установка по индексу | `arrayPath`, `setField` |
| `setPath` | Прямая установка пути | `path` |

### UI-разбор с несколькими селекторами

Когда сообщения платформы имеют несколько форм, настройте несколько селекторов для адаптации ко всем случаям.

#### Сценарий: несколько форм сообщений в Tongyi Qianwen

**Проблема**: контейнер сообщения в Tongyi Qianwen может быть `.tongyi-markdown`, `.message-content` или другим классом.

**Конфигурация**:
```json
{
  "uiParsing": {
    "enabled": true,
    "priority": "ui",
    "messageContainer": [
      ".tongyi-markdown",
      ".message-content",
      "[data-message-type='text']",
      ".chat-message"
    ],
    "messageIndex": -1,
    "contentSelector": [
      ".markdown-body",
      ".message-text",
      ""
    ]
  }
}
```

**Принцип работы**:
1. Собираются все элементы сообщений на странице с помощью всех селекторов.
2. Удаляются дубликаты (один элемент может совпасть с несколькими селекторами).
3. Сортировка по порядку в DOM (чтобы получить действительно последнее сообщение).
4. По `messageIndex: -1` берётся последнее сообщение.
5. Внутри этого элемента по порядку пробуются селекторы `contentSelector`.

**Преимущества**:
- ✅ Адаптация к нескольким формам сообщений.
- ✅ Автоматическая сортировка по DOM.
- ✅ Гарантированное получение действительно последнего сообщения.

---

## Примеры конфигурации

### Полная конфигурация DeepSeek

```json
{
  "name": "deepseek",
  "hostname": "chat.deepseek.com",
  "label": "DeepSeek官网",
  "api": ["/api/v0/chat/completion", "/api/v0/chat/edit_message"],
  "promptPath": "prompt",
  "isJsonString": false,
  "enabled": true,
  "defaultAlwaysInject": true,
  "response": {
    "type": "sse",
    "format": "data: {json}",
    "contentPaths": ["v"],
    "filterRules": {
      "pathField": "p",
      "excludePatterns": ["fragments/0/content"]
    }
  },
  "uiParsing": {
    "enabled": true,
    "priority": "ui",
    "messageContainer": ".ds-message",
    "messageIndex": -1,
    "contentSelector": ".ds-markdown"
  },
  "input": {
    "selector": "textarea, [contenteditable='true']",
    "submitKey": "Enter",
    "submitModifiers": [],
    "submitDelay": 1600
  }
}
```

### Полная конфигурация Tencent Yuanbao

```json
{
  "name": "yuanbao",
  "hostname": "yuanbao.tencent.com",
  "label": "腾讯元宝",
  "api": ["/api/chat/"],
  "promptPath": ["prompt", "displayPrompt"],
  "isJsonString": false,
  "enabled": true,
  "defaultAlwaysInject": true,
  "response": {
    "type": "sse",
    "format": "data: {json}",
    "contentPaths": ["msg"]
  },
  "uiParsing": {
    "enabled": true,
    "priority": "ui",
    "messageContainer": ".hyc-content-md",
    "messageIndex": -1,
    "contentSelector": ".hyc-common-markdown"
  },
  "input": {
    "selector": "textarea, [contenteditable='true']",
    "submitKey": "Enter",
    "submitModifiers": [],
    "submitDelay": 2000
  },
  "newConversationFlag": {
    "from": "requestBody",
    "path": "chatModelExtInfo",
    "checkExists": true
  }
}
```

### Конфигурация Google AI Studio

```json
{
  "name": "google_aistudio",
  "hostname": "aistudio.google.com",
  "label": "Google AI Studio",
  "api": ["/GenerateContent"],
  "promptPath": "message",
  "isJsonString": false,
  "enabled": true,
  "defaultAlwaysInject": true,
  "skipRequestModification": true,
  "response": {
    "type": "json",
    "format": "{json}",
    "contentPaths": ["content", "text", "message"]
  },
  "uiParsing": {
    "enabled": true,
    "priority": "ui",
    "messageContainer": "ms-chat-turn",
    "messageIndex": -1
  },
  "input": {
    "selector": "textarea, [contenteditable='true']",
    "submitKey": "Enter",
    "submitModifiers": ["Ctrl"],
    "submitDelay": 1600
  },
  "onLoadTip": {
    "message": [
      "Google AI Studio не поддерживает автоматическую инъекцию System Prompt",
      "",
      "Пожалуйста, после каждого нового диалога нажимайте кнопку обновления System Prompt на панели плагина для ручной инъекции содержимого System Prompt",
      "Кроме того, этот сайт не поддерживает автоматическое чтение ответов модели с инструментами; необходимо нажать значок часов во всплывающем окне в правом нижнем углу для ручного распознавания"
    ],
    "dontShowAgainText": "Больше не показывать это уведомление"
  }
}
```

### Quark AI (с использованием promptFilter)

```json
{
  "name": "qianwen",
  "hostname": "www.qianwen.com",
  "label": "通义千问",
  "api": ["/dialog/conversation", "api/v2/chat"],
  "promptPath": "messages",
  "isJsonString": false,
  "enabled": true,
  "defaultAlwaysInject": true,
  "response": {
    "type": "sse",
    "format": "data: {json}",
    "contentPaths": ["content", "text", "delta"]
  },
  "uiParsing": {
    "enabled": true,
    "priority": "ui",
    "messageContainer": [
      ".tongyi-markdown",
      ".message-content",
      "[data-message-type]"
    ],
    "messageIndex": -1,
    "contentSelector": ["", ".markdown-body"]
  },
  "input": {
    "selector": "textarea, [contenteditable='true']",
    "submitKey": "Enter",
    "submitModifiers": [],
    "submitDelay": 1600
  },
  "newConversationFlag": {
    "from": "requestBody",
    "path": "scene_param",
    "checkValue": "first_turn",
    "valueType": "string",
    "checkExists": true
  },
  "promptFilter": {
    "preset": "findByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "returnField": ["content", "meta_data.ori_query"]
    }
  },
  "promptSetFilter": {
    "preset": "setByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "setField": ["content", "meta_data.ori_query"]
    }
  }
}
```

**Пояснение**:
- Используется `promptFilter` для динамической фильтрации текстовых сообщений по `mime_type`.
- Поддерживаются несколько селекторов контейнера UI-сообщений.
- Одновременно устанавливаются поля `content` и `meta_data.ori_query`.

---

## Типовые сценарии

### Сценарий 1: платформа использует SSE-потоковый ответ

**Признак**: ответ начинается с `data: `, каждая строка — объект JSON.

**Конфигурация**:
```json
{
  "response": {
    "type": "sse",
    "format": "data: {json}\n\n",
    "contentPaths": ["content"]
  }
}
```

### Сценарий 2: платформа использует обычный JSON-ответ

**Признак**: сразу возвращается полный объект JSON.

**Конфигурация**:
```json
{
  "response": {
    "type": "json",
    "format": "{json}",
    "contentPaths": ["response.text"]
  }
}
```

### Сценарий 3: API-разбор сложен, UI-разбор прост

**Стратегия**: приоритет UI-разбора.

**Конфигурация**:
```json
{
  "uiParsing": {
    "enabled": true,
    "priority": "ui",
    "messageContainer": ".message",
    "messageIndex": -1
  }
}
```

### Сценарий 4: требуется отправка по Ctrl + Enter

**Конфигурация**:
```json
{
  "input": {
    "selector": "textarea",
    "submitKey": "Enter",
    "submitModifiers": ["Ctrl"],
    "submitDelay": 1600
  }
}
```

### Сценарий 5: поле ввода долго загружается

**Проблема**: после инъекции поле ввода ещё не полностью готово.

**Решение**: увеличить `submitDelay`.

**Конфигурация**:
```json
{
  "input": {
    "submitDelay": 3000  // ожидание 3 секунды
  }
}
```

### Сценарий 6: формат сообщений динамически меняется

**Проблема**: массив сообщений в теле запроса содержит несколько типов (текст, изображения, файлы и т.д.), требуется динамическая фильтрация.

**Решение**: использовать `promptFilter` и `promptSetFilter`.

**Конфигурация**:
```json
{
  "promptFilter": {
    "preset": "findByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "returnField": "content"
    }
  },
  "promptSetFilter": {
    "preset": "setByField",
    "params": {
      "arrayPath": "messages",
      "matchField": "mime_type",
      "matchValue": "text/plain",
      "setField": "content"
    }
  }
}
```

### Сценарий 7: у UI-контейнера сообщений несколько форм

**Проблема**: имя класса контейнера сообщений платформы не фиксировано или есть несколько типов сообщений.

**Решение**: настроить несколько селекторов `messageContainer`.

**Конфигурация**:
```json
{
  "uiParsing": {
    "messageContainer": [
      ".message-type-a",
      ".message-type-b",
      "[data-message]"
    ],
    "messageIndex": -1
  }
}
```

**Эффект**: автоматически собираются все типы сообщений, сортируются по DOM и берётся последнее.

---

## Устранение неполадок

### Проблема 1: System Prompt не внедряется

**Чек-лист**:
- [ ] Правильно ли указан `promptPath`?
- [ ] Содержит ли массив `api` URL запроса?
- [ ] Включена ли «автоматическая инъекция»?
- [ ] Правильно ли `newConversationFlag` определяет новый диалог?

**Метод отладки**:
1. Откройте DevTools → Network.
2. Начните диалог.
3. Проверьте, содержит ли тело запроса MCP Prompt.

### Проблема 2: вызов инструмента не обнаруживается

**Чек-лист**:
- [ ] Правильно ли указаны `response.contentPaths`?
- [ ] Соответствуют ли `response.type` и `response.format` фактическому ответу?
- [ ] Содержит ли ответ ИИ тег `<tool_code>`?

**Метод отладки**:
1. Откройте DevTools → Console.
2. Проверьте, есть ли логи, начинающиеся с `[MCP Bridge]`.
3. Проверьте разобранное содержимое.

### Проблема 3: результат инструмента не отправляется автоматически

**Чек-лист**:
- [ ] Соответствует ли `input.selector` полю ввода?
- [ ] Правильны ли `input.submitKey` и `input.submitModifiers`?
- [ ] Достаточно ли велик `input.submitDelay`?

**Метод отладки**:
1. Откройте DevTools → Console.
2. Выполните:
   ```javascript
   document.querySelector('ваш селектор')
   ```
3. Проверьте, возвращается ли элемент поля ввода.

### Проблема 4: UI-разбор не удаётся

**Чек-лист**:
- [ ] Правильно ли указан `uiParsing.messageContainer`?
- [ ] Не изменилась ли структура DOM страницы?

**Метод отладки**:
1. Откройте DevTools → Elements.
2. Найдите контейнер последнего сообщения.
3. Обновите селектор `messageContainer`.

---

## Лучшие практики

### 1. Постепенная конфигурация

Начните с минимальной конфигурации и постепенно добавляйте расширенные функции.

```json
// Шаг 1: минимальная конфигурация
{
  "name": "new_platform",
  "hostname": "platform.com",
  "label": "Новая платформа",
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

// Шаг 2: добавить UI-разбор (если API-разбор нестабилен)
// Шаг 3: добавить newConversationFlag (если нужно)
// Шаг 4: добавить onLoadTip (если есть особые указания)
```

### 2. Тщательное тестирование

Тестируйте конфигурацию в различных сценариях:
- новый диалог;
- продолжение диалога;
- после обновления страницы;
- после переключения модели.

### 3. Документирование конфигурации

Добавляйте комментарии для сложных конфигураций (в документации проекта, а не в JSON-файле).

### 4. Контроль версий

При изменении конфигурации записывайте версию и причину изменений.

---

## Полезные ресурсы

- [Официальная документация Chrome Extension](https://developer.chrome.com/docs/extensions/)
- [Справочник по CSS-селекторам](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_Selectors)
- [Список значений KeyboardEvent.key](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key/Key_Values)
- [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

---

**Нужна помощь?** Задайте вопрос в [GitHub Issues](https://github.com/WongJingGitt/mcp_bridge/issues).