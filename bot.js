const TelegramBot = require('node-telegram-bot-api');
const { loadUsers, saveUser, updateUser, deleteUser, getUser } = require('./database');
const { startMonitoring, stopMonitoring, getStatus } = require('./monitor');
const { getTakePrice } = require('./price');
const { getTotalStaking, clearStatsCache, getCacheStatus } = require('./staking-stats');

// 환경변수에서 BOT_TOKEN 가져오기
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN 환경변수를 설정해주세요!');
    console.log('\n사용법:');
    console.log('export BOT_TOKEN="본인_텔레그램_봇_토큰"');
    console.log('npm start');
    process.exit(1);
}

// 봇 초기화
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('🤖 OVERTAKE 스테이킹 모니터 봇 시작됨!');
console.log('📋 저장된 사용자 로드 중...');

// 저장된 사용자 자동 로드 및 모니터링 재개
const users = loadUsers();
let resumedCount = 0;

for (const [chatId, config] of Object.entries(users)) {
    if (config.isActive) {
        startMonitoring(chatId, bot, config);
        resumedCount++;
    }
}

console.log(`✅ ${resumedCount}명의 사용자 모니터링 재개됨`);
console.log('🤖 봇이 준비되었습니다!\n');

// ============== 명령어 핸들러 ==============

// /start - 환영 메시지
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const welcomeMsg = `
🎮 <b>OVERTAKE 스테이킹 모니터</b>

Sui 블록체인의 OVERTAKE (TAKE) 토큰 스테이킹을 실시간으로 모니터링합니다!

<b>📊 감지 가능한 활동:</b>
🟢 Deposit - 스테이킹
🟡 Request Unstake - 언스테이킹 요청
🔴 Claim Unstake - 클레임

<b>🚀 빠른 시작:</b>
/monitor - 모니터링 시작 (기본값: $10,000)
/threshold 5000 - 임계값 변경
/status - 현재 상태 확인
/stop - 모니터링 중지
/totalstaking - 📊 전체 스테이킹 현황
/help - 전체 명령어 보기

<i>Railway에서 24시간 실행 가능합니다!</i>
    `.trim();
    
    bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'HTML' });
});

// /help - 도움말
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    
    const helpMsg = `
<b>📖 명령어 목록</b>

<b>기본 명령어:</b>
/start - 시작 메시지
/help - 이 도움말
/monitor - 모니터링 시작
/stop - 모니터링 중지
/status - 현재 상태 확인

<b>설정 명령어:</b>
/threshold [금액] - 알림 임계값 설정 (USD)
  예: /threshold 5000

<b>정보 명령어:</b>
/price - 현재 TAKE 가격
/totalstaking - 📊 전체 스테이킹 현황

<b>💡 사용 예시:</b>
1️⃣ /monitor - 기본값($10,000)으로 시작
2️⃣ /threshold 5000 - $5,000로 변경
3️⃣ /status - 현재 설정 확인
4️⃣ /totalstaking - 전체 스테이킹 확인
5️⃣ /stop - 모니터링 중지

<b>🎯 감지되는 활동:</b>
• <b>🟢 Deposit</b> - 스테이킹
• <b>🟡 Request Unstake</b> - 언스테이킹 요청 (7일 대기)
• <b>🔴 Claim Unstake</b> - 실제 인출
    `.trim();
    
    bot.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
});

// /monitor - 모니터링 시작
bot.onText(/\/monitor/, (msg) => {
    const chatId = msg.chat.id;
    
    // 기존 설정 로드 또는 기본값 사용
    let user = getUser(chatId);
    
    if (!user) {
        user = {
            threshold: 10000, // 기본 $10,000
            isActive: true
        };
    } else {
        user.isActive = true;
    }
    
    // 저장
    saveUser(chatId, user);
    
    // 모니터링 시작
    startMonitoring(chatId, bot, user);
    
    const startMsg = `
✅ <b>모니터링이 시작되었습니다!</b>

💵 <b>임계값:</b> $${user.threshold.toLocaleString()}
⏱️ <b>체크 간격:</b> 10초

<b>감지 활동:</b>
🟢 Deposit (스테이킹)
🟡 Request Unstake (언스테이킹 요청)
🔴 Claim Unstake (클레임)

임계값을 변경하려면 /threshold 명령어를 사용하세요.
    `.trim();
    
    bot.sendMessage(chatId, startMsg, { parse_mode: 'HTML' });
});

// /stop - 모니터링 중지
bot.onText(/\/stop/, (msg) => {
    const chatId = msg.chat.id;
    
    const user = getUser(chatId);
    
    if (!user || !user.isActive) {
        bot.sendMessage(chatId, '⚠️ 모니터링이 실행 중이 아닙니다.');
        return;
    }
    
    // 모니터링 중지
    stopMonitoring(chatId);
    
    // 상태 업데이트
    updateUser(chatId, { isActive: false });
    
    bot.sendMessage(chatId, '⏹️ <b>모니터링이 중지되었습니다.</b>', { parse_mode: 'HTML' });
});

// /threshold - 임계값 변경
bot.onText(/\/threshold (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const thresholdStr = match[1].trim();
    
    const threshold = parseFloat(thresholdStr);
    
    if (isNaN(threshold) || threshold <= 0) {
        bot.sendMessage(chatId, '⚠️ 올바른 금액을 입력하세요.\n\n예: /threshold 5000');
        return;
    }
    
    // 사용자 설정 업데이트
    updateUser(chatId, { threshold });
    
    const user = getUser(chatId);
    
    // 모니터링 중이면 재시작
    if (user && user.isActive) {
        stopMonitoring(chatId);
        startMonitoring(chatId, bot, user);
    }
    
    bot.sendMessage(
        chatId,
        `✅ <b>임계값이 변경되었습니다!</b>\n\n💵 새 임계값: $${threshold.toLocaleString()}`,
        { parse_mode: 'HTML' }
    );
});

// /status - 현재 상태
bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    
    const user = getUser(chatId);
    
    if (!user) {
        bot.sendMessage(chatId, '⚠️ 설정된 정보가 없습니다.\n\n/monitor 명령어로 시작하세요.');
        return;
    }
    
    const status = getStatus(chatId);
    const price = await getTakePrice();
    
    const statusMsg = `
📊 <b>현재 상태</b>

🔔 <b>모니터링:</b> ${status.isActive ? '🟢 활성' : '🔴 비활성'}
💵 <b>임계값:</b> $${user.threshold.toLocaleString()}
💰 <b>TAKE 가격:</b> $${price.toFixed(4)}

<b>감지 활동:</b>
🟢 Deposit (스테이킹)
🟡 Request Unstake (언스테이킹 요청)
🔴 Claim Unstake (클레임)

⏱️ <b>체크 간격:</b> 10초
🌐 <b>네트워크:</b> Sui Mainnet
    `.trim();
    
    bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
});

// /price - 현재 TAKE 가격
bot.onText(/\/price/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const price = await getTakePrice();
        
        const priceMsg = `
💰 <b>OVERTAKE (TAKE) 가격</b>

💵 <b>현재가:</b> $${price.toFixed(4)}

<i>CoinGecko 기준</i>
        `.trim();
        
        bot.sendMessage(chatId, priceMsg, { parse_mode: 'HTML' });
    } catch (error) {
        bot.sendMessage(chatId, '⚠️ 가격 조회에 실패했습니다.');
    }
});

// /totalstaking - 전체 스테이킹 현황 조회
bot.onText(/\/totalstaking/, async (msg) => {
    const chatId = msg.chat.id;
    
    // 캐시 상태 확인
    const cacheStatus = getCacheStatus();
    let loadingText = '📊 전체 스테이킹 정보를 조회 중입니다...\n\n⏳ 잠시만 기다려주세요';
    
    if (cacheStatus.isCached) {
        loadingText = '📊 캐시된 데이터를 불러오는 중...';
    } else {
        loadingText += ' (최대 1분 소요)';
    }
    
    // 로딩 메시지
    const loadingMsg = await bot.sendMessage(chatId, loadingText);
    
    try {
        const stats = await getTotalStaking();
        
        // 로딩 메시지 삭제
        try {
            await bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (e) {
            // 삭제 실패해도 계속 진행
        }
        
        // 캐시 정보
        const newCacheStatus = getCacheStatus();
        let cacheInfo = '';
        if (newCacheStatus.isCached && newCacheStatus.remainingSeconds > 0) {
            const mins = Math.floor(newCacheStatus.remainingSeconds / 60);
            const secs = newCacheStatus.remainingSeconds % 60;
            cacheInfo = `\n\n<i>📦 캐시 유효: ${mins}분 ${secs}초</i>`;
        }
        
        // 타입별 통계 문자열 생성
        const byType = stats.byType;
        let typeStats = '';
        const types = ['Flexible', '30일', '90일', '180일'];
        
        for (const type of types) {
            const t = byType[type];
            if (t && t.netStaked > 0) {
                const pct = ((t.netStaked / stats.netStaked) * 100).toFixed(1);
                typeStats += `   • ${type}: ${t.netStaked.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE (${pct}%)\n`;
            }
        }
        
        const statsMsg = `
📊 <b>OVERTAKE 전체 스테이킹 현황</b>

━━━━━━━━━━━━━━━━━━━━━
💎 <b>현재 스테이킹:</b>
   ${stats.netStaked.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE

💵 <b>USD 가치:</b>
   $${stats.netStakedUsd.toLocaleString('en-US', {maximumFractionDigits: 0})}
━━━━━━━━━━━━━━━━━━━━━

<b>🔒 타입별 현황:</b>
${typeStats}
<b>📈 상세 내역:</b>
🟢 총 Deposit: ${stats.totalDeposited.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE
🔴 총 Claim: ${stats.totalClaimed.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE

<b>📊 활동 통계:</b>
• Deposit 횟수: ${stats.depositCount.toLocaleString()}회
• Claim 횟수: ${stats.claimCount.toLocaleString()}회

💰 <b>TAKE 가격:</b> $${stats.price.toFixed(4)}
⏱️ <b>조회 시간:</b> ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}${cacheInfo}
        `.trim();
        
        bot.sendMessage(chatId, statsMsg, { parse_mode: 'HTML' });
        
    } catch (error) {
        // 로딩 메시지 삭제
        try {
            await bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (e) {}
        
        console.error('총 스테이킹 조회 실패:', error);
        bot.sendMessage(
            chatId, 
            '⚠️ 총 스테이킹 조회에 실패했습니다.\n\n잠시 후 다시 시도해주세요.',
            { parse_mode: 'HTML' }
        );
    }
});

// /refreshstaking - 캐시 무시하고 새로 조회 (선택적 기능)
bot.onText(/\/refreshstaking/, async (msg) => {
    const chatId = msg.chat.id;
    
    // 캐시 초기화
    clearStatsCache();
    
    const loadingMsg = await bot.sendMessage(
        chatId, 
        '🔄 캐시를 초기화하고 새로 조회합니다...\n\n⏳ 최대 1분 소요'
    );
    
    try {
        const stats = await getTotalStaking(true);
        
        try {
            await bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (e) {}
        
        // 타입별 통계 문자열 생성
        const byType = stats.byType;
        let typeStats = '';
        const types = ['Flexible', '30일', '90일', '180일'];
        
        for (const type of types) {
            const t = byType[type];
            if (t && t.netStaked > 0) {
                const pct = ((t.netStaked / stats.netStaked) * 100).toFixed(1);
                typeStats += `   • ${type}: ${t.netStaked.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE (${pct}%)\n`;
            }
        }
        
        const statsMsg = `
🔄 <b>OVERTAKE 스테이킹 현황 (새로고침)</b>

━━━━━━━━━━━━━━━━━━━━━
💎 <b>현재 스테이킹:</b>
   ${stats.netStaked.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE

💵 <b>USD 가치:</b>
   $${stats.netStakedUsd.toLocaleString('en-US', {maximumFractionDigits: 0})}
━━━━━━━━━━━━━━━━━━━━━

<b>🔒 타입별 현황:</b>
${typeStats}
🟢 총 Deposit: ${stats.totalDeposited.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE (${stats.depositCount}회)
🔴 총 Claim: ${stats.totalClaimed.toLocaleString('en-US', {maximumFractionDigits: 0})} TAKE (${stats.claimCount}회)

💰 TAKE 가격: $${stats.price.toFixed(4)}
⏱️ ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}

<i>📦 캐시 갱신 완료 (5분간 유효)</i>
        `.trim();
        
        bot.sendMessage(chatId, statsMsg, { parse_mode: 'HTML' });
        
    } catch (error) {
        try {
            await bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (e) {}
        
        bot.sendMessage(chatId, '⚠️ 조회 실패. 잠시 후 다시 시도해주세요.');
    }
});

// 에러 핸들링
bot.on('polling_error', (error) => {
    console.error('Polling 오류:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('처리되지 않은 Promise 거부:', error);
});

// 종료 시그널 처리
process.on('SIGINT', () => {
    console.log('\n봇 종료 중...');
    
    // 모든 모니터링 중지
    const users = loadUsers();
    for (const chatId of Object.keys(users)) {
        stopMonitoring(chatId);
    }
    
    process.exit(0);
});