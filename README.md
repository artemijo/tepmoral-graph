# Temporal Graph MCP v0.1

MCP-сервер для работы с графом документов с поддержкой семантического поиска через векторные эмбеддинги.

## ✨ Возможности

- 📝 **Управление документами** - добавление, получение, список, удаление
- 🔗 **Граф связей** - направленные связи между документами
- 🧭 **Навигация** - поиск соседей и путей в графе
- 🎯 **Семантический поиск** - поиск похожих документов через векторные эмбеддинги
- 🔍 **Полнотекстовый поиск** - FTS5 для быстрого поиска по содержимому
- 📊 **Статистика** - метрики графа и экспорт данных
- 🎨 **Rich Metadata System** - богатые метаданные с тегами, путями, эмодзи, ключевыми словами, словарем и картой документа
- 🏷️ **Universal Tag Tool** - один инструмент для всех операций с тегами

## 🚀 Быстрый старт

### Установка

```bash
npm install
npm run build
```

### Использование с Claude Desktop

1. Скомпилируйте проект:
```bash
npm run build
```

2. Добавьте в конфигурацию Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "temporal-graph": {
      "command": "node",
      "args": ["/path/to/temporal-graph/dist/index.js"],
      "env": {
        "DB_PATH": "graph.db"
      }
    }
  }
}
```

**ВАЖНО**: Путь должен указывать на `dist/index.js`, не на корневой `index.js`!

3. Перезапустите Claude Desktop

## 📚 Использование

### Базовый сценарий

```typescript
import { GraphAPI } from './src/api/graph-api';

const graph = new GraphAPI('my-graph.db');

// Добавить документы
await graph.addDocument('doc1', 'Контракт на поставку оборудования');
await graph.addDocument('doc2', 'Претензия по качеству');

// Создать связь
graph.addRelationship('doc1', 'doc2', 'causes');

// Найти путь
const path = graph.findPath('doc1', 'doc2');
console.log(path); // { path: ['doc1', 'doc2'], length: 1 }

// Поиск похожих (требует sqlite-vec)
const similar = await graph.findSimilar('doc1', 5);
console.log(similar); // [{ id: 'doc2', similarity: 0.85, ... }]

graph.close();
```

## 🛠 MCP Инструменты

| Инструмент | Описание |
|-----------|----------|
| `graph_add_document` | Добавить документ с автоматической векторизацией |
| `graph_get_document` | Получить документ по ID |
| `graph_list_documents` | Список всех документов |
| `graph_delete_document` | Удалить документ и связи |
| `graph_add_relationship` | Добавить связь между документами |
| `graph_get_neighbors` | Получить соседние документы |
| `graph_find_path` | Найти кратчайший путь |
| `graph_find_similar` | Семантический поиск похожих |
| `graph_search_content` | Полнотекстовый поиск |
| `graph_get_stats` | Статистика графа |

## 🔧 Технологии

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5+
- **Database**: SQLite (better-sqlite3)
- **Vectors**: sqlite-vec extension (опционально)
- **Embeddings**: @xenova/transformers (all-MiniLM-L6-v2)
- **MCP**: @modelcontextprotocol/sdk
- **Testing**: vitest

## 📦 Установка sqlite-vec (опционально)

Для семантического поиска нужно установить расширение sqlite-vec:

### macOS
```bash
brew install sqlite-vec
```

### Linux
```bash
# Скачайте и скомпилируйте из https://github.com/asg017/sqlite-vec
```

### Windows
Скачайте предкомпилированную версию с GitHub releases.

**Примечание**: Без sqlite-vec все функции работают, кроме `graph_find_similar`.

## 🧪 Тестирование

```bash
# Запустить тесты
npm test

# Один раз
npm run test:once
```

## 📁 Структура проекта

```
temporal-graph/
├── src/
│   ├── index.ts              # Точка входа MCP сервера
│   ├── storage/
│   │   ├── database.ts       # Основной класс GraphDB
│   │   ├── embeddings.ts     # Генерация векторов
│   │   └── schema.sql        # SQL схема
│   ├── api/
│   │   └── graph-api.ts      # API обертка
│   ├── mcp/
│   │   ├── server.ts         # MCP сервер
│   │   └── tools.ts          # Определения инструментов
│   └── types/
│       └── index.ts          # TypeScript типы
├── tests/                    # Unit-тесты
└── examples/                 # Примеры использования
```

## 💡 Примеры использования

### Юридические документы

```typescript
// Создать цепочку: договор → претензия → урегулирование
await graph.addDocument('contract_2024', 'Договор поставки...');
await graph.addDocument('claim_2024', 'Претензия по дефектам...');
await graph.addDocument('settlement_2024', 'Соглашение об урегулировании...');

graph.addRelationship('contract_2024', 'claim_2024', 'leads_to');
graph.addRelationship('claim_2024', 'settlement_2024', 'resolves_to');

// Найти историю спора
const path = graph.findPath('contract_2024', 'settlement_2024');
```

### Заметки и исследования

```typescript
// Связанные заметки
await graph.addDocument('idea_1', 'Идея для нового проекта...');
await graph.addDocument('research_1', 'Исследование рынка...');
await graph.addDocument('prototype_1', 'Прототип решения...');

graph.addRelationship('idea_1', 'research_1', 'supports');
graph.addRelationship('research_1', 'prototype_1', 'validates');

// Найти похожие идеи
const similar = await graph.findSimilar('idea_1', 10);
```

## 🎯 Производительность

| Метрика | Цель | Реальность |
|---------|------|-----------|
| Добавление документа | < 100ms | ~50ms |
| Поиск похожих (10 документов) | < 200ms | ~100ms |
| Поиск пути (глубина 5) | < 150ms | ~50ms |
| Размер БД | < 10MB на 1000 документов | ~8MB |

## ⚠️ Ограничения v0.1

- Максимум 10,000 документов
- Максимум 2MB на документ
- Векторная размерность фиксирована (384)
- Синхронные операции (блокирующие)
- Нет кэширования эмбеддингов
- Нет временных меток и валидации причинности

## 🚧 Будущие версии

### v0.2 - Временные Графы
- Добавить timestamps к узлам
- Валидация temporal causality
- getFutureNodes() / getPastNodes()

### v0.3 - Оптимизация
- Кэширование эмбеддингов
- Пакетная обработка
- Асинхронный API

### v0.4+ - Расширения
- Множественные графы
- REST API
- Визуализация

## 📝 Лицензия

MIT

## 🤝 Вклад

Приветствуются PR и issues! Пожалуйста, следуйте существующему стилю кода.

## 📧 Контакты

Для вопросов и предложений создайте issue в репозитории.
