# Temporal Graph MCP v2.0.0

MCP-сервер для работы с графом документов с поддержкой семантического поиска через векторные эмбеддинги.

## ✨ Возможности

### Complete MCP Tool Suite (14 Tools)
- **Document Operations** (4): create, read, update, delete with versioning
- **Search & Discovery** (2): full-text search and graph exploration
- **Relationships** (1): create typed edges with causality validation
- **Navigation** (2): open nodes with neighbors, comprehensive graph mapping
- **History & Analysis** (5): timelines, version comparison, time-based queries

### Temporal Capabilities
- **Time Travel**: Query any document/graph state at any point in history
- **Version Control**: Automatic versioning with change tracking
- **Temporal Relationships**: Edges with validity periods
- **Causality Protection**: Prevents impossible temporal states

### Graph Features
- **BFS Exploration**: Navigate relationships with configurable depth
- **Smart Filtering**: Filter by tags, type, relationships, time ranges
- **Multiple Map Scopes**: all, filtered, subgraph, temporal_slice
- **Dual Formats**: JSON (structured data) and Mermaid (visualization)
- **Rich Statistics**: Type distribution, relationship analysis, tag usage

### Quality of Life
- **Metadata Merging**: Smart metadata updates preserve existing fields
- **Change Detection**: Automatic tracking of content and metadata changes
- **Soft Deletes**: Preserve history when deleting documents
- **Content Previews**: Truncated content for quick scanning

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
| **Document Operations** |
| `graph_add_document` | Добавить документ с автоматической векторизацией |
| `graph_get_document` | Получить документ по ID (с временной поддержкой) |
| `graph_update_document` | Обновить документ (создает новую версию) |
| `graph_delete_document` | Удалить документ и связи |
| **Search & Discovery** |
| `graph_search` | Полнотекстовый поиск с фильтрами метаданных |
| `graph_explore` | Исследовать граф с помощью BFS |
| **Relationships** |
| `create_relations` | Создать связи между документами |
| **Navigation** |
| `open_nodes` | Открыть документ с соседями (с временной поддержкой) |
| `graph_map` | Генерировать комплексную карту графа |
| **History & Analysis** |
| `graph_get_document_timeline` | Получить историю изменений документа |
| `graph_compare_versions` | Сравнить две версии документа |
| `graph_get_created_between` | Получить документы, созданные в диапазоне |
| `graph_get_modified_between` | Получить документы, измененные в диапазоне |
| `graph_get_deleted_between` | Получить документы, удаленные в диапазоне |

**Всего инструментов: 14**

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

## 📚 Documentation

For complete tool documentation with examples, see [MCP_TOOLS_REFERENCE.md](docs/MCP_TOOLS_REFERENCE.md)

## 🎯 Quick Tool Reference

**Document Operations:**
1. `graph_add_document` - Create documents
2. `graph_get_document` - Read by ID (with temporal support)
3. `graph_update_document` - Update with versioning
4. `graph_delete_document` - Soft delete

**Search & Discovery:**
5. `graph_search` - Full-text + filters (with temporal)
6. `graph_explore` - BFS exploration

**Relationships:**
7. `create_relations` - Create edges

**Navigation:**
8. `open_nodes` - Open with neighbors (with temporal)
9. `graph_map` - Comprehensive mapping

**History & Analysis:**
10. `graph_get_document_timeline` - Change history
11. `graph_compare_versions` - Version diff
12. `graph_get_created_between` - Created in range
13. `graph_get_modified_between` - Modified in range
14. `graph_get_deleted_between` - Deleted in range

## 🔧 Технологии

- **Runtime**: Node.js 20+
- **Language**: TypeScript 5+
- **Database**: SQLite (better-sqlite3)
- **Vectors**: sqlite-vec extension (опционально)
- **Embeddings**: @xenova/transformers (all-MiniLM-L6-v2)
- **MCP**: @modelcontextprotocol/sdk
- **Testing**: vitest

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
├── docs/                     # Documentation
└── examples/                 # Примеры использования
```

## 📝 Лицензия

MIT

## 🤝 Вклад

Приветствуются PR и issues! Пожалуйста, следуйте существующему стилю кода.

## 📧 Контакты

Для вопросов и предложений создайте issue в репозитории.
