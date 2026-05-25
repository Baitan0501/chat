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

const db = {
    // Универсальный метод для добавления (INSERT) пользователей и сообщений
    run: function(query, params, callback) {
        const data = readData();
        
        // 1. Регистрация пользователя
        if (query.includes('INSERT INTO users')) {
            const [username, passwordHash, targetLang] = params;
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

        // 2. Сохранение сообщения
        if (query.includes('INSERT INTO messages')) {
            const [author, text, timestamp] = params;
            const newMessage = { author, text, timestamp };
            
            data.messages.push(newMessage);
            
            // Жестко держим лимит в 1000 сообщений, чтобы файл не раздувался
            if (data.messages.length > 1000) {
                data.messages = data.messages.slice(-1000); 
            }
            
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
    },

    // Новый метод для выгрузки всей истории сообщений
    all: function(query, params, callback) {
        const data = readData();
        if (query.includes('FROM messages')) {
            // Возвращаем копию массива сообщений
            return callback(null, data.messages || []);
        }
        callback(null, []);
    }
};

module.exports = db;