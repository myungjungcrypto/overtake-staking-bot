const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');

// 모든 사용자 로드
function loadUsers() {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, '{}', 'utf8');
            return {};
        }
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('사용자 로드 실패:', error);
        return {};
    }
}

// 사용자 저장 (병합 방식)
function saveUser(chatId, config) {
    try {
        const users = loadUsers();
        
        // 기존 설정과 병합
        if (users[chatId]) {
            users[chatId] = { ...users[chatId], ...config };
        } else {
            users[chatId] = config;
        }
        
        users[chatId].lastUpdated = Date.now();
        
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('사용자 저장 실패:', error);
        return false;
    }
}

// 사용자 업데이트 (부분 업데이트)
function updateUser(chatId, updates) {
    return saveUser(chatId, updates);
}

// 사용자 삭제
function deleteUser(chatId) {
    try {
        const users = loadUsers();
        delete users[chatId];
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('사용자 삭제 실패:', error);
        return false;
    }
}

// 사용자 조회
function getUser(chatId) {
    const users = loadUsers();
    return users[chatId] || null;
}

// 활성 사용자 수
function getActiveUserCount() {
    const users = loadUsers();
    return Object.keys(users).filter(chatId => users[chatId].isActive).length;
}

module.exports = {
    loadUsers,
    saveUser,
    updateUser,
    deleteUser,
    getUser,
    getActiveUserCount
};
