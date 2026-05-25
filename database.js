const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Создаем или открываем файл базы данных в папке проекта
const dbPath = path.resolve(__dirname, 'chat.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных:', err.message);
    } else {
        console.log('Подключено к базе данных SQLite (chat.db).');
    }
});

// Инициализация таблиц
db.serialize(() => {
    // 1. Создаем таблицу пользователей
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            target_lang TEXT DEFAULT 'en'
        )
    `);

    // 2. Создаем таблицу сообщений
    db.run(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            original_text TEXT NOT NULL,
            source_lang TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    `);
    
    console.log('Таблицы users и messages успешно проверены/созданы.');
});

module.exports = db;