const socket = io();

let currentUser = null;

// Элементы страницы
const messagesContainer = document.getElementById('messages-container');
const chatForm = document.getElementById('chat-form');
const msgInput = document.getElementById('msg-input');
const userList = document.getElementById('user-list');
const chatHeader = document.getElementById('chat-header');

// 1. Проверяем авторизацию при входе на страницу
fetch('/api/me')
    .then(res => {
        if (res.status === 401) {
            // Если не авторизован — кидаем на страницу логина
            window.location.href = '/index.html';
        }
        return res.json();
    })
    .then(user => {
        if (user) {
            currentUser = user;
            chatHeader.innerText = `Чат | Вы вошли как: ${user.username} (${user.targetLang.toUpperCase()})`;
            
            // Сообщаем серверу, что мы зашли, и передаем наш язык
            socket.emit('init_user', {
                username: user.username,
                targetLang: user.targetLang
            });
        }
    })
    .catch(err => console.error('Ошибка проверки профиля:', err));

// 2. Отправка сообщения на сервер
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = msgInput.value.trim();
    if (!text) return;

    socket.emit('chat_message', text);
    msgInput.value = '';
    msgInput.focus();
});

// 3. Получение сообщения от сервера (уже переведенного под наш язык)
socket.on('broadcast_message', (msg) => {
    const isMyMessage = msg.author === currentUser.username;
    
    // Создаем обертку для сообщения
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    // Если мое — красим в зеленый и прижимаем вправо, если чужое — в серый и влево
    messageDiv.classList.add(isMyMessage ? 'my' : 'other');

    // Содержимое сообщения
    messageDiv.innerHTML = `
        <div class="message-author">${msg.author}</div>
        <div class="message-text">${msg.text}</div>
    `;

    messagesContainer.appendChild(messageDiv);

    // Автоматический скролл вниз к новому сообщению
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

// 4. Обновление списка пользователей онлайн в боковой панели
socket.on('update_users', (users) => {
    userList.innerHTML = '';
    users.forEach(username => {
        const userDiv = document.createElement('div');
        userDiv.classList.add('user-item');
        userDiv.innerText = username;
        userList.appendChild(userDiv);
    });
});