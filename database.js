const admin = require("firebase-admin");
const path = require("path");

// Путь к твоему секретному ключу Firebase
const serviceAccount = require(path.join(__dirname, "firebase-key.json"));

// Инициализируем Firebase Admin конкретно под твой проект baitan-ver1
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://baitan-ver1-default-rtdb.europe-west1.firebasedatabase.app/" 
});

const dbRef = admin.database().ref("users");

console.log("Firebase успешно инициализирован.");
console.log("Подключено к облачной базе данных Firebase Realtime Database.");

const db = {
    // Регистрация пользователя в Firebase
    run: function(query, params, callback) {
        if (query.includes('INSERT INTO users')) {
            const [username, passwordHash, targetLang] = params;
            
            // Заменяем точки и запрещенные символы в нике, так как Firebase использует их как пути
            const safeUsername = username.toLowerCase().replace(/[\.\$\#\[\]]/g, "_");

            // Проверяем, существует ли уже такой юзер
            dbRef.child(safeUsername).once("value", (snapshot) => {
                if (snapshot.exists()) {
                    return callback({ message: 'UNIQUE constraint failed' });
                }

                // Если юзера нет — сохраняем в Firebase
                const newUser = {
                    username: username, // сохраняем оригинальный регистр для отображения
                    password_hash: passwordHash,
                    target_lang: targetLang
                };

                dbRef.child(safeUsername).set(newUser, (error) => {
                    if (error) {
                        return callback(error);
                    }
                    return callback(null);
                });
            });
        } else {
            callback(null);
        }
    },

    // Авторизация пользователя (Получение данных из Firebase)
    get: function(query, params, callback) {
        if (query.includes('FROM users WHERE username = ?')) {
            const username = params[0];
            const safeUsername = username.toLowerCase().replace(/[\.\$\#\[\]]/g, "_");

            dbRef.child(safeUsername).once("value", (snapshot) => {
                if (snapshot.exists()) {
                    return callback(null, snapshot.val());
                }
                return callback(null, null); // Юзер не найден
            }, (error) => {
                return callback(error, null);
            });
        } else {
            callback(null, null);
        }
    }
};

module.exports = db;