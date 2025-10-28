# ⚙️ Конфигурация для LM Studio

## Правильная конфигурация MCP

После того как вы выполнили `npm install` и `npm run build`, настройте LM Studio:

### 1. Найдите файл конфигурации

В LM Studio конфигурация MCP обычно находится в настройках приложения.

### 2. Добавьте сервер

Используйте **правильный путь** к скомпилированному файлу:

```json
{
  "mcpServers": {
    "temporal-graph": {
      "command": "node",
      "args": ["C:\\Users\\andrew\\Documents\\MCP\\temporal-graph\\dist\\index.js"],
      "env": {
        "DB_PATH": "graph.db"
      }
    }
  }
}
```

### ⚠️ ВАЖНО: Обратите внимание на путь!

**ПРАВИЛЬНО** ✅:
```
"args": ["C:\\Users\\andrew\\Documents\\MCP\\temporal-graph\\dist\\index.js"]
```

**НЕПРАВИЛЬНО** ❌:
```
"args": ["C:\\Users\\andrew\\Documents\\MCP\\temporal-graph\\index.js"]
```

Путь должен указывать на `dist/index.js`, а не просто `index.js`!

### 3. Проверка перед запуском

Убедитесь что:

1. ✅ Зависимости установлены: `npm install` выполнен
2. ✅ Проект собран: `npm run build` выполнен
3. ✅ Папка `dist/` существует и содержит скомпилированные файлы
4. ✅ Путь в конфигурации указывает на `dist/index.js`

### 4. Проверка наличия dist/

Выполните в PowerShell:

```powershell
cd C:\Users\andrew\Documents\MCP\temporal-graph
dir dist
```

Вы должны увидеть:
```
dist/
├── index.js
├── api/
│   └── graph-api.js
├── mcp/
│   ├── server.js
│   └── tools.js
├── storage/
│   ├── database.js
│   └── embeddings.js
└── types/
    └── index.js
```

### 5. Перезапустите LM Studio

После добавления конфигурации полностью перезапустите LM Studio.

## Альтернативная конфигурация (Claude Desktop)

Если используете Claude Desktop, конфигурация находится здесь:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "temporal-graph": {
      "command": "node",
      "args": ["C:\\Users\\andrew\\Documents\\MCP\\temporal-graph\\dist\\index.js"],
      "env": {
        "DB_PATH": "graph.db"
      }
    }
  }
}
```

## Тестирование конфигурации

Проверьте что сервер запускается вручную:

```powershell
cd C:\Users\andrew\Documents\MCP\temporal-graph
node dist/index.js
```

Если появляется сообщение:
```
Starting Temporal Graph MCP Server v0.1.0
Database: graph.db
Temporal Graph MCP Server running on stdio
```

Значит все работает правильно! Нажмите Ctrl+C для выхода.

## Типичные ошибки

### Ошибка: "Cannot find module ...\\index.js"
**Причина**: Путь указывает на корень проекта вместо папки dist
**Решение**: Измените путь на `dist/index.js`

### Ошибка: "ENOENT: no such file or directory"
**Причина**: Проект не собран или собран неправильно
**Решение**: 
```powershell
npm run build
```

### Ошибка: "Connection closed"
**Причина**: Сервер упал при запуске из-за ошибок выше
**Решение**: Исправьте ошибку и перезапустите LM Studio

## Проверка работы инструментов

После успешного подключения в LM Studio должны появиться 9 инструментов:

1. graph_add_document
2. graph_get_document
3. graph_list_documents
4. graph_delete_document
5. graph_add_relationship
6. graph_get_neighbors
7. graph_find_path
8. graph_find_similar (требует sqlite-vec)
9. graph_search_content
10. graph_get_stats

Попробуйте в чате:
```
Используй graph_add_document чтобы добавить тестовый документ с id "test1" и содержимым "Hello World"
```

## Полный путь для вашей системы

Для копирования в конфигурацию:

```
C:\\Users\\andrew\\Documents\\MCP\\temporal-graph\\dist\\index.js
```

(Обратите внимание на двойные обратные слеши `\\` - это важно для JSON!)

---

**Готово!** 🎉
