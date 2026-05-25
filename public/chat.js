const socket = io();

let currentUser = null;
let isSoundEnabled = true;
let selectedReplyMessage = null; // Храним данные сообщения для цитирования

// Создаем аудио-объект для звука (чистый короткий блямк уведомления)
const notificationSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2357/2357-84.wav');

// Элементы страницы
const messagesContainer = document.getElementById('messages-container');
const chatForm = document.getElementById('chat-form');
const msgInput = document.getElementById('msg-input');
const userList = document.getElementById('user-list');
const chatHeaderText = document.getElementById('chat-header-text');

// Элементы звука
const soundToggle = document.getElementById('sound-toggle');
const soundIcon = document.getElementById('sound-icon');
const soundStatus = document.getElementById('sound-status');

// Элементы цитирования
const replyPreview = document.getElementById('reply-preview');
const replyAuthor = document.getElementById('reply-author');
const replyText = document.getElementById('reply-text');
const cancelReplyBtn = document.getElementById('cancel-reply-btn');

// 1. Проверяем авторизацию
fetch('/api/me')
    .then(res => {
        if (res.status === 401) {
            window.location.href = '/index.html';
        }
        return res.json();
    })
    .then(user => {
        if (user) {
            currentUser = user;
            chatHeaderText.innerText = `Вы: ${user.username} (${user.targetLang.toUpperCase()})`;
            
            socket.emit('init_user', {
                username: user.username,
                targetLang: user.targetLang
            });
        }
    })
    .catch(err => console.error('Ошибка профиля:', err));

// Управление включением/выключением звука
soundToggle.addEventListener('click', () => {
    isSoundEnabled = !isSoundEnabled;
    if (isSoundEnabled) {
        soundIcon.innerText = '🔊';
        soundStatus.innerText = 'ВКЛ';
    } else {
        soundIcon.innerText = '🔇';
        soundStatus.innerText = 'ВЫКЛ';
    }
});

// Отмена цитирования
cancelReplyBtn.addEventListener('click', () => {
    resetReply();
});

function resetReply() {
    selectedReplyMessage = null;
    replyPreview.style.display = 'none';
}

// 2. Отправка сообщения (с учетом цитаты, если она выбрана)
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let text = msgInput.value.trim();
    if (!text) return;

    // Если выбрана цитата, мы красиво оформляем её прямо в текст сообщения
    if (selectedReplyMessage) {
        // Формируем структуру цитаты, которую распарсит клиент при получении
        text = `[QUOTE_REPLY]${selectedReplyMessage.author}:::${selectedReplyMessage.text}[/QUOTE_REPLY]${text}`;
    }

    socket.emit('chat_message', text);
    msgInput.value = '';
    resetReply();
    msgInput.focus();
});

// 3. Получение сообщения от сервера
socket.on('broadcast_message', (msg) => {
    const isMyMessage = msg.author === currentUser.username;
    
    // Играем звук, если он включен и это сообщение прислал КТО-ТО ДРУГОЙ
    if (isSoundEnabled && !isMyMessage) {
        notificationSound.play().catch(e => console.log("Кликните по экрану для активации звуков"));
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(isMyMessage ? 'my' : 'other');

    let rawText = msg.text;
    let quoteHTML = '';

    // Проверяем, есть ли в сообщении цитата
    if (rawText.startsWith('[QUOTE_REPLY]')) {
        const endTagIndex = rawText.indexOf('[/QUOTE_REPLY]');
        if (endTagIndex !== -1) {
            const quoteContent = rawText.substring(13, endTagIndex);
            rawText = rawText.substring(endTagIndex + 14); // Отрезаем саму цитату, оставляя только текст ответа
            
            const [qAuthor, qText] = quoteContent.split(':::');
            quoteHTML = `
                <div class="quote-block">
                    <div class="quote-author">${qAuthor}</div>
                    <div>${qText}</div>
                </div>
            `;
        }
    }

    // Наполняем сообщение данными
    messageDiv.innerHTML = `
        <div class="message-author">${msg.author}</div>
        ${quoteHTML}
        <div class="message-text">${rawText}</div>
    `;

    // При клике на само сообщение — берем его в цитирование
    messageDiv.addEventListener('click', () => {
        selectedReplyMessage = {
            author: msg.author,
            text: rawText
        };
        replyAuthor.innerText = msg.author;
        replyText.innerText = rawText;
        replyPreview.style.display = 'flex';
        msgInput.focus();
    });

    messagesContainer.appendChild(messageDiv);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

// 4. Список юзеров онлайн
socket.on('update_users', (users) => {
    userList.innerHTML = '';
    users.forEach(username => {
        const userDiv = document.createElement('div');
        userDiv.classList.add('user-item');
        userDiv.innerText = username;
        userList.appendChild(userDiv);
    });
});