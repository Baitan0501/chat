const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const translate = require('google-translate-api-x');

// Подключаем базу данных (файл database.js должен лежать в корне рядом с server.js)
const db = require('./database'); 

const app = express();
const server = http.createServer(app);

// Инициализируем Socket.io
const io = new Server(server);

// Настройка сессий
app.use(session({
    secret: 'super_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // Сессия живет 1 день
}));

// Настройки для работы с JSON, формами и статикой из папки public
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// При заходе на главную отдаем страницу авторизации
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- ЛОГИКА АВТОРИЗАЦИИ (РЕГИСТРАЦИЯ И ВХОД) ---

// 1. Регистрация пользователя
app.post('/register', async (req, res) => {
    const { username, password, target_lang } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    try {
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        const query = `INSERT INTO users (username, password_hash, target_lang) VALUES (?, ?, ?)`;
        db.run(query, [username, passwordHash, target_lang || 'en'], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Пользователь с таким ником уже существует' });
                }
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }
            res.json({ success: true, message: 'Регистрация успешна!' });
        });
    } catch (error) {
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// 2. Логин пользователя
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }

    const query = `SELECT * FROM users WHERE username = ?`;
    db.get(query, [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка базы данных' });
        }
        if (!user) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(400).json({ error: 'Неверное имя пользователя или пароль' });
        }

        // Записываем данные в сессию Express
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.targetLang = user.target_lang;

        res.json({ success: true, redirect: '/chat.html' });
    });
});

// Проверка авторизации для фронтенда
app.get('/api/me', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Не авторизован' });
    }
    res.json({
        id: req.session.userId,
        username: req.session.username,
        targetLang: req.session.targetLang
    });
});

// Логаут (выход из аккаунта)
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/index.html');
    });
});


// --- ЛОГИКА REAL-TIME ЧАТА С АВТОПЕРЕВОДОМ И СПИСКОМ ОНЛАЙН ---

// Объект для отслеживания пользователей в сети { socketId: { username, targetLang } }
const onlineUsers = {};

io.on('connection', (socket) => {
    
    // 1. Инициализация пользователя при входе в чат
    socket.on('init_user', (data) => {
        onlineUsers[socket.id] = {
            username: data.username,
            targetLang: data.targetLang
        };

        // Подключаем сокет к комнате его целевого языка
        socket.join(`lang_${data.targetLang}`);
        console.log(`[Чат] ${data.username} подключился. Язык перевода: ${data.targetLang.toUpperCase()}`);

        // Рассылаем всем обновленный список пользователей
        updateOnlineUsersList();
    });

    // 2. Обработка входящего сообщения
    socket.on('chat_message', async (msgText) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        console.log(`[Сообщение] ${currentUser.username}: ${msgText}`);
        
        // Получаем все активные сокеты в чате
        const allSockets = await io.fetchSockets();

        for (let targetSocket of allSockets) {
            try {
                // Выясняем, какой язык нужен этому конкретному сокету-получателю
                let targetLang = 'en'; 
                for (let room of targetSocket.rooms) {
                    if (room.startsWith('lang_')) {
                        targetLang = room.replace('lang_', '');
                        break;
                    }
                }

                // Переводим текст на язык получателя
                const res = await translate(msgText, { to: targetLang });
                
                // Шлем результат конкретному получателю
                targetSocket.emit('broadcast_message', {
                    author: currentUser.username,
                    original: msgText,
                    translated: res.text
                });
            } catch (err) {
                console.error(`Ошибка перевода для сокета ${targetSocket.id}:`, err);
                // Если API легло — шлем оригинал вместо перевода
                targetSocket.emit('broadcast_message', {
                    author: currentUser.username,
                    original: msgText,
                    translated: msgText
                });
            }
        }
    });

    // 3. Отключение пользователя
    socket.on('disconnect', () => {
        if (onlineUsers[socket.id]) {
            console.log(`[Чат] ${onlineUsers[socket.id].username} отключился.`);
            delete onlineUsers[socket.id];
            updateOnlineUsersList();
        }
    });

    // Функция отправки списка онлайн-пользователей
    function updateOnlineUsersList() {
        const usersArray = Object.values(onlineUsers).map(u => u.username);
        io.emit('update_users', usersArray);
    }
});


// Запуск сервера на порту 3000
// Порт будет браться из окружения сервера, либо 3000 для локалки
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`  СЕРВЕР УСПЕШНО ЗАПУЩЕН!`);
    console.log(`  Ссылка для входа: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
});