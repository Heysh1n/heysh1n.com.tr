# Инструкция по развертыванию heysh1n.com.tr на хост / VPS

Этот документ содержит пошаговый план по переносу проекта на сервер, сборке в production и подключению домена `heysh1n.com.tr`.

---

## 1. Настройка DNS записей домена
В панели регистратора домена (`.com.tr`) добавьте A-записи, указывающие на IP-адрес вашего сервера:

| Тип | Имя хоста | Значение | TTL |
|---|---|---|---|
| A | `@` (или heysh1n.com.tr) | `IP_ВАШЕГО_СЕРВЕРА` | 3600 |
| A | `www` | `IP_ВАШЕГО_СЕРВЕРА` | 3600 |

---

## 2. Подготовка сервера (Debian / Ubuntu)

Подключитесь к серверу по SSH и установите Node.js 22, Nginx, Certbot и PM2:

```bash
# Обновление пакетов
sudo apt update && sudo apt upgrade -y

# Установка curl, git, nginx, certbot
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Установка Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Проверка версий
node -v
npm -v

# Установка PM2 глобально
sudo npm install -g pm2
```

---

## 3. Клонирование и установка зависимостей

```bash
# Создание рабочей директории
mkdir -p /var/www
cd /var/www

# Клонирование репозитория
git clone <URL_РЕПОЗИТОРИЯ> heysh1n.com.tr
cd heysh1n.com.tr

# Установка зависимостей в корне (для всех воркспейсов)
npm install
```

---

## 4. Настройка переменных окружения (.env)

### 4.1. Backend (`backend/.env`)
Создайте файл `backend/.env`:
```bash
nano backend/.env
```
Содержимое:
```env
# Подключение к базе данных PostgreSQL (Neon)
DATABASE_URI="postgresql://neondb_owner:npg_gY5y2hNfKvoC@ep-aged-grass-a4a1p1f5-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require"

# Секретный ключ Payload (любая длинная случайная строка)
PAYLOAD_SECRET="heysh1n-super-secret-key-prod-2026-x99"

# Домен сайта
NEXT_PUBLIC_SERVER_URL=https://heysh1n.com.tr
ALLOWED_ORIGINS=https://heysh1n.com.tr,https://www.heysh1n.com.tr

# SFCP модуль
SFCP_LATEST_VERSION=1.0.0
SFCP_DOWNLOAD_URL=https://heysh1n.com.tr/downloads/sfcp.zip
SFCP_SHA256=
```

### 4.2. Frontend (`frontend/.env`)
Создайте файл `frontend/.env`:
```bash
nano frontend/.env
```
Содержимое:
```env
# URL бэкенда (на сервере используется публичный домен или относительные запросы)
PUBLIC_BACKEND_URL=https://heysh1n.com.tr

# Last.fm (если используется)
PUBLIC_LASTFM_USER=Heysh1n
PUBLIC_LASTFM_API_KEY=42bf547ad2d7ae6d078dd9fee67571a3
```

---

## 5. Сборка проекта (Production Build)

В корневой директории выполните:

```bash
npm run build
```
Эта команда выполнит:
1. `build:frontend` — компилирует Astro в оптимизированный `frontend/dist/`.
2. `build:backend` — компилирует Next.js / Payload CMS и проверяет типы.

---

## 6. Запуск процессов через PM2

В корне проекта уже подготовлен файл `ecosystem.config.cjs`:

```bash
# Запуск бэкенда (порт 3000) и фронтенда (порт 4321)
pm2 start ecosystem.config.cjs

# Сохранение конфигурации для автозапуска при перезагрузке сервера
pm2 save
pm2 startup
```

Проверка состояния:
```bash
pm2 status
pm2 logs
```

---

## 7. Настройка Nginx и выпуск SSL (HTTPS)

1. Скопируйте конфигурационный файл Nginx:
```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/heysh1n.com.tr
sudo ln -s /etc/nginx/sites-available/heysh1n.com.tr /etc/nginx/sites-enabled/
```

2. Выпустите бесплатный SSL-сертификат Let's Encrypt через Certbot:
```bash
sudo certbot --nginx -d heysh1n.com.tr -d www.heysh1n.com.tr
```
Certbot автоматически сконфигурирует HTTPS и настроит автопродление сертификата.

3. Проверьте и перезапустите Nginx:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## 8. Доступ к сайту и админке

- **Основной сайт:** `https://heysh1n.com.tr`
- **Панель управления (Payload CMS):** `https://heysh1n.com.tr/panel`
- **API эндпоинты:** `https://heysh1n.com.tr/api/...`

---

## 9. Обновление сайта в будущем (CI / CD workflow)

Когда вы делаете изменения в коде:
```bash
cd /var/www/heysh1n.com.tr
git pull
npm install
npm run build
pm2 restart all
```
