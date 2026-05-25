const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const translate = require('google-translate-api-x');

// Подключаем нашу неубиваемую текстовую базу данных
const db = require('./database'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(session({
    secret: 'super_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- АВТОРИЗАЦИЯ ---

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
                if (err.message && err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: 'Пользователь с таким ником уже существует' });
                }
                return res.status(500).json({ error: 'Ошибка базы данных' });
            }
            res.json({ success: true });
        });
    } catch (error) {
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Заполните все поля' });
    }
    const query = `SELECT * FROM users WHERE username = ?`;
    db.get(query, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: 'Ошибка базы данных' });
        if (!user) return res.status(400).json({ error: 'Неверный ник или пароль' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ error: 'Неверный ник или пароль' });

        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.targetLang = user.target_lang;

        res.json({ success: true, redirect: '/chat.html' });
    });
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Не авторизован' });
    res.json({
        id: req.session.userId,
        username: req.session.username,
        targetLang: req.session.targetLang
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/index.html');
    });
});

// --- ОПТИМИЗИРОВАННЫЙ ЧАТ (ОДНО ОКНО) ---

const onlineUsers = {};

io.on('connection', (socket) => {
    
    socket.on('init_user', (data) => {
        onlineUsers[socket.id] = {
            username: data.username,
            targetLang: data.targetLang || 'en'
        };
        socket.join(`lang_${data.targetLang}`);
        console.log(`[Чат] ${data.username} вошел. Язык: ${data.targetLang.toUpperCase()}`);
        updateOnlineUsersList();
    });

    socket.on('chat_message', async (msgText) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        // Собираем только те языки, которые реально нужны сидящим в чате людям
        const activeLanguages = new Set(Object.values(onlineUsers).map(u => u.targetLang));

        for (let lang of activeLanguages) {
            try {
                let translatedText = msgText;
                
                // Переводим, только если язык получателя не совпадает с языком отправителя
                if (lang !== currentUser.targetLang) {
                    const res = await translate(msgText, { to: lang });
                    translatedText = res.text;
                }

                // Шлем готовый текст сразу всей языковой комнате
                io.to(`lang_${lang}`).emit('broadcast_message', {
                    author: currentUser.username,
                    text: translatedText
                });
            } catch (err) {
                console.error(`Ошибка перевода на [${lang}]:`, err);
                // В случае сбоя API отправляем оригинал
                io.to(`lang_${lang}`).emit('broadcast_message', {
                    author: currentUser.username,
                    text: msgText
                });
            }
        }
    });

    socket.on('disconnect', () => {
        if (onlineUsers[socket.id]) {
            console.log(`[Чат] ${onlineUsers[socket.id].username} вышел.`);
            delete onlineUsers[socket.id];
            updateOnlineUsersList();
        }
    });

    function updateOnlineUsersList() {
        const usersArray = Object.values(onlineUsers).map(u => u.username);
        io.emit('update_users', usersArray);
    }
});

const PORT = process.env.PORT || 3000; 
server.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`  СЕРВЕР УСПЕШНО ЗАПУЩЕН!`);
    console.log(`  Порт: ${PORT}`);
    console.log(`==================================================\n`);
});