# Установка sqlite-vec

sqlite-vec - это расширение SQLite для работы с векторными эмбеддингами. Оно необходимо для работы семантического поиска (`graph_find_similar`).

## Важно

Без sqlite-vec сервер будет работать, но семантический поиск будет недоступен. Все остальные функции (полнотекстовый поиск, навигация по графу и т.д.) работают без этого расширения.

## macOS

### Через Homebrew (рекомендуется)

```bash
brew install sqlite-vec
```

### Вручную

```bash
# Скачайте из releases
curl -L https://github.com/asg017/sqlite-vec/releases/latest/download/sqlite-vec-macos-universal.tar.gz -o sqlite-vec.tar.gz

# Распакуйте
tar xzf sqlite-vec.tar.gz

# Скопируйте в системную директорию
sudo cp vec0.dylib /usr/local/lib/

# Или укажите путь в переменной окружения
export SQLITE_VEC_PATH=/path/to/vec0.dylib
```

## Linux

### Ubuntu/Debian

```bash
# Установите зависимости
sudo apt-get update
sudo apt-get install -y build-essential git sqlite3 libsqlite3-dev

# Клонируйте репозиторий
git clone https://github.com/asg017/sqlite-vec.git
cd sqlite-vec

# Скомпилируйте
make

# Скопируйте в системную директорию
sudo cp dist/vec0.so /usr/local/lib/

# Или укажите путь в переменной окружения
export SQLITE_VEC_PATH=/path/to/vec0.so
```

### Fedora/RHEL

```bash
sudo dnf install -y gcc make sqlite-devel git

git clone https://github.com/asg017/sqlite-vec.git
cd sqlite-vec
make
sudo cp dist/vec0.so /usr/local/lib/
```

## Windows

### Скачайте предкомпилированную версию

1. Перейдите на https://github.com/asg017/sqlite-vec/releases
2. Скачайте `sqlite-vec-windows-x64.zip`
3. Распакуйте `vec0.dll` в папку с вашим проектом или в системную директорию

```powershell
# Установите переменную окружения (PowerShell)
$env:SQLITE_VEC_PATH = "C:\path\to\vec0.dll"
```

## Проверка установки

```bash
# Проверьте, что расширение загружается
sqlite3 :memory: ".load vec0"
```

Если команда выполнилась без ошибок, расширение установлено правильно.

## Использование в проекте

При инициализации GraphDB расширение будет загружаться автоматически:

```typescript
import { GraphDB } from './src/storage/database';

const db = new GraphDB('graph.db');
// Если vec0 доступен, увидите: "Vector search initialized"
// Если нет: "Warning: sqlite-vec extension not available"
```

## Альтернатива: Docker

Если установка вызывает проблемы, можно использовать Docker:

```dockerfile
FROM node:20

# Установить sqlite-vec
RUN apt-get update && \
    apt-get install -y build-essential git sqlite3 libsqlite3-dev && \
    git clone https://github.com/asg017/sqlite-vec.git && \
    cd sqlite-vec && \
    make && \
    cp dist/vec0.so /usr/local/lib/

WORKDIR /app
COPY . .
RUN npm install && npm run build

CMD ["node", "dist/index.js"]
```

## Troubleshooting

### Ошибка: "cannot open shared object file"

```bash
# Linux: добавьте в LD_LIBRARY_PATH
export LD_LIBRARY_PATH=/usr/local/lib:$LD_LIBRARY_PATH

# macOS: добавьте в DYLD_LIBRARY_PATH
export DYLD_LIBRARY_PATH=/usr/local/lib:$DYLD_LIBRARY_PATH
```

### Ошибка: "extension not found"

Убедитесь, что:
1. Файл расширения существует (vec0.so/dylib/dll)
2. У файла есть права на выполнение: `chmod +x vec0.so`
3. Путь к файлу указан в LD_LIBRARY_PATH или SQLITE_VEC_PATH

### Проверка версии

```bash
sqlite3 :memory: ".load vec0" "SELECT vec_version();"
```

## Ссылки

- GitHub: https://github.com/asg017/sqlite-vec
- Документация: https://alexgarcia.xyz/sqlite-vec/
- Releases: https://github.com/asg017/sqlite-vec/releases
