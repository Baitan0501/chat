const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const translate = require('google-translate-api-x');

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

// --- ЧАТ С СОХРАНЕНИЕМ ИСТОРИИ ---

const onlineUsers = {};

io.on('connection', (socket) => {
    
    socket.on('init_user', (data) => {
        onlineUsers[socket.id] = {
            username: data.username,
            targetLang: data.targetLang || 'en'
        };
        socket.join(`lang_${data.targetLang}`);
        console.log(`[Чат] ${data.username} вошел. Язык: ${data.targetLang.toUpperCase()}`);
        
        // Отправляем новому пользователю историю последних сообщений
        db.all("SELECT * FROM messages", [], async (err, rows) => {
            if (err || !rows) return;
            
            for (let historyMsg of rows) {
                let textToSend = historyMsg.text;
                
                // Переводим историю под язык зашедшего юзера, если автор писал на другом языке
                // (Для простоты храним в БД оригинал, а при загрузке истории переводим на лету)
                // Но чтобы не спамить API, переводим только если это чужое сообщение
                if (historyMsg.author !== data.username) {
                    try {
                        // Чистим теги цитат перед переводом, если они есть
                        let cleanText = historyMsg.text;
                        let quotePrefix = "";
                        if (cleanText.startsWith('[QUOTE_REPLY]')) {
                            const endTag = cleanText.indexOf('[/QUOTE_REPLY]');
                            if (endTag !== -1) {
                                quotePrefix = cleanText.substring(0, endTag + 14);
                                cleanText = cleanText.substring(endTag + 14);
                            }
                        }
                        
                        const res = await translate(cleanText, { to: data.targetLang });
                        textToSend = quotePrefix + res.text;
                    } catch (e) {
                        // Если перевод упал — отдаем как есть
                    }
                }
                
                socket.emit('broadcast_message', {
                    author: historyMsg.author,
                    text: textToSend
                });
            }
        });

        updateOnlineUsersList();
    });

    socket.on('chat_message', async (msgText) => {
        const currentUser = onlineUsers[socket.id];
        if (!currentUser) return;

        // Сохраняем оригинальное сообщение в нашу JSON базу данных
        db.run("INSERT INTO messages (author, text, timestamp) VALUES (?, ?, ?)", [
            currentUser.username,
            msgText,
            Date.now()
        ], (err) => {
            if (err) console.error("Ошибка сохранения сообщения:", err);
        });

        const activeLanguages = new Set(Object.values(onlineUsers).map(u => u.targetLang));

        for (let lang of activeLanguages) {
            try {
                let translatedText = msgText;
                
                if (lang !== currentUser.targetLang) {
                    // Если сообщение содержит цитату, переводим только основной текст ответа
                    let cleanText = msgText;
                    let quotePrefix = "";
                    if (msgText.startsWith('[QUOTE_REPLY]')) {
                        const endTag = msgText.indexOf('[/QUOTE_REPLY]');
                        if (endTag !== -1) {
                            quotePrefix = msgText.substring(0, endTag + 14);
                            cleanText = msgText.substring(endTag + 14);
                        }
                    }
                    
                    const res = await translate(cleanText, { to: lang });
                    translatedText = quotePrefix + res.text;
                }

                io.to(`lang_${lang}`).emit('broadcast_message', {
                    author: currentUser.username,
                    text: translatedText
                });
            } catch (err) {
                io.to(`lang_${lang}`).emit('broadcast_message', {
                    author: currentUser.username,
                    text: msgText
                });
            }
        }
    });

    socket.on('disconnect', () => {
        if (onlineUsers[socket.id]) {
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
    console.log(`  СЕРВЕР ОБНОВЛЕН И ЗАПУЩЕН!`);
    console.log(`==================================================\n`);
});