const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'chat.db.json');

// Проверяем/создаем файл базы данных при старте
if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({ users: [], messages: [] }, null, 2));
}

console.log("База данных JSON успешно проверена/создана.");
console.log("Подключено к текстовой базе данных (chat.db.json).");

// Чтение данных из файла
function readData() {
    try {
        const raw = fs.readFileSync(FILE_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        return { users: [], messages: [] };
    }
}

// Запись данных в файл
function writeData(data) {
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));
}

// Эмулируем методы SQLite, чтобы не переписывать server.js!
const db = {
    // Метод INSERT (Регистрация)
    run: function(query, params, callback) {
        const data = readData();
        
        // Если это регистрация пользователя
        if (query.includes('INSERT INTO users')) {
            const [username, passwordHash, targetLang] = params;
            
            // Проверка на UNIQUE (уникальный ник)
            const exists = data.users.some(u => u.username === username);
            if (exists) {
                return callback({ message: 'UNIQUE constraint failed' });
            }
            
            const newUser = {
                id: data.users.length + 1,
                username,
                password_hash: passwordHash,
                target_lang: targetLang
            };
            
            data.users.push(newUser);
            writeData(data);
            return callback(null);
        }
        callback(null);
    },

    // Метод SELECT для одного пользователя (Логин)
    get: function(query, params, callback) {
        const data = readData();
        if (query.includes('FROM users WHERE username = ?')) {
            const username = params[0];
            const user = data.users.find(u => u.username === username);
            return callback(null, user || null);
        }
        callback(null, null);
    }
};

module.exports = db;