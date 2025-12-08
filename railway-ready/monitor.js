const { SuiClient } = require('@mysten/sui.js/client');
const { takeToUsd } = require('./price');

// Sui 설정
const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';
const STAKING_PACKAGE = '0x528a6350937fe3904c02adc806fe35d7500fab2cccd5e6493dc7984feab2e570'; // OVERTAKE 3 (실제 주소)
const STAKING_MODULE = 'staking';

// 함수별 이모지
const FUNCTION_EMOJIS = {
    'deposit': '🟢',
    'request_unstake': '🟡',
    'claim_unstake': '🔴'
};

const FUNCTION_NAMES = {
    'deposit': '스테이킹',
    'request_unstake': '언스테이킹 요청',
    'claim_unstake': '클레임'
};

// 전역 상태
const intervals = new Map(); // chatId -> setInterval ID
const processedTxs = new Map(); // chatId -> Set of processed transaction digests

// Sui 클라이언트 초기화
const suiClient = new SuiClient({ url: SUI_RPC });

// TAKE 금액 추출 (트랜잭션에서)
function extractTakeAmount(transaction) {
    try {
        // 방법 1: Events에서 추출 (가장 확실)
        if (transaction.events && transaction.events.length > 0) {
            for (const event of transaction.events) {
                // 이벤트 타입이 스테이킹 관련인지 확인
                // 두 가지 Package 주소 모두 지원 (업그레이드 이전/이후)
                if (event.type && 
                    (event.type.includes('0x2b5b2081ce2428bdd67057ed6d62d1112173ded3588eab63ab93c2042a0b296a::staking::') ||
                     event.type.includes('0x528a6350937fe3904c02adc806fe35d7500fab2cccd5e6493dc7984feab2e570::staking::'))) {
                    
                    // parsedJson에서 금액 추출
                    if (event.parsedJson) {
                        // 모든 가능한 금액 필드 찾기
                        const amount = event.parsedJson.amount ||               // DepositedEvent
                                      event.parsedJson.principal_amount ||      // UnstakeRequestedEvent
                                      event.parsedJson.principal_returned ||    // ClaimedEvent (메인 금액)
                                      event.parsedJson.rewards_claimed ||       // ClaimedEvent (리워드)
                                      event.parsedJson.value || 
                                      event.parsedJson.stake_amount ||
                                      event.parsedJson.unstake_amount ||
                                      event.parsedJson.shares_minted;
                        
                        if (amount) {
                            const amountNum = typeof amount === 'string' ? 
                                            parseInt(amount) : amount;
                            const finalAmount = amountNum / 1e9; // 9 decimals
                            return finalAmount;
                        }
                    }
                }
            }
        }
        
        // 방법 2: Input Arguments에서 추출
        if (transaction.transaction && transaction.transaction.data) {
            const txData = transaction.transaction.data;
            
            if (txData.transaction && txData.transaction.kind === 'ProgrammableTransaction') {
                const commands = txData.transaction.transactions || [];
                
                for (const command of commands) {
                    if (command.MoveCall && command.MoveCall.arguments) {
                        const args = command.MoveCall.arguments;
                        
                        // Arguments 파싱 - u64 타입 값 찾기
                        for (let i = 0; i < args.length; i++) {
                            const arg = args[i];
                            
                            // Pure type u64 체크
                            if (arg && arg.type === 'pure' && arg.valueType === 'u64') {
                                const value = arg.value;
                                
                                if (typeof value === 'number' || typeof value === 'string') {
                                    const amountNum = typeof value === 'string' ? 
                                                    parseInt(value) : value;
                                    
                                    // u64 값이 충분히 크면 금액일 가능성 (0.01 TAKE 이상)
                                    if (amountNum >= 10000000) { // 0.01 TAKE 이상
                                        const finalAmount = amountNum / 1e9;
                                        return finalAmount;
                                    }
                                }
                            }
                            
                            // Input 타입 체크 (백업)
                            if (typeof arg === 'object' && arg.Input !== undefined) {
                                const inputIndex = arg.Input;
                                
                                // 실제 값은 txData.transaction.inputs에 있음
                                if (txData.transaction.inputs && 
                                    txData.transaction.inputs[inputIndex]) {
                                    const input = txData.transaction.inputs[inputIndex];
                                    
                                    if (input.type === 'pure' && input.valueType === 'u64') {
                                        const value = input.value;
                                        if (typeof value === 'number' || typeof value === 'string') {
                                            const amountNum = typeof value === 'string' ? 
                                                            parseInt(value) : value;
                                            
                                            // u64 값이 충분히 크면 금액일 가능성
                                            if (amountNum >= 10000000) { // 0.01 TAKE 이상
                                                const finalAmount = amountNum / 1e9;
                                                return finalAmount;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // 방법 3: Balance Changes (네이티브 코인용)
        if (transaction.effects && transaction.effects.balanceChanges) {
            for (const change of transaction.effects.balanceChanges) {
                // TAKE 토큰 타입 확인
                if (change.coinType && change.coinType.includes('::take::TAKE')) {
                    const amount = Math.abs(parseInt(change.amount)) / 1e9; // 9 decimals
                    return amount;
                }
            }
        }
        
        return 0;
    } catch (error) {
        console.error('💥 금액 추출 실패:', error);
        return 0;
    }
}

// 트랜잭션 필터링 (스테이킹 관련)
function isStakingTransaction(transaction) {
    try {
        if (!transaction.transaction || !transaction.transaction.data) {
            return null;
        }
        
        const txData = transaction.transaction.data;
        
        // ProgrammableTransaction 확인
        if (txData.transaction && txData.transaction.kind === 'ProgrammableTransaction') {
            const commands = txData.transaction.transactions || [];
            
            for (const command of commands) {
                if (command.MoveCall) {
                    const moveCall = command.MoveCall;
                    const packageId = moveCall.package;
                    const module = moveCall.module;
                    const func = moveCall.function;
                    
                    // 스테이킹 컨트랙트 매칭
                    if (packageId === STAKING_PACKAGE && module === STAKING_MODULE) {
                        if (['deposit', 'request_unstake', 'claim_unstake'].includes(func)) {
                            return {
                                function: func,
                                sender: txData.sender,
                                digest: transaction.digest
                            };
                        }
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('트랜잭션 파싱 실패:', error);
        return null;
    }
}

// 알림 전송
async function sendAlert(bot, chatId, stakingInfo, amount, usdValue) {
    const emoji = FUNCTION_EMOJIS[stakingInfo.function] || '⚪';
    const functionName = FUNCTION_NAMES[stakingInfo.function] || stakingInfo.function;
    
    let message = `${emoji} <b>OVERTAKE ${functionName}</b>\n\n`;
    message += `💰 <b>금액:</b> ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} TAKE\n`;
    message += `💵 <b>USD:</b> $${usdValue.toLocaleString('en-US', {maximumFractionDigits: 2})}\n\n`;
    message += `👤 <b>주소:</b> <code>${stakingInfo.sender.substring(0, 10)}...${stakingInfo.sender.substring(stakingInfo.sender.length - 8)}</code>\n`;
    message += `🔗 <b>TX:</b> <a href="https://suiscan.xyz/mainnet/tx/${stakingInfo.digest}">View on Suiscan</a>\n`;
    
    if (stakingInfo.function === 'request_unstake') {
        message += `\n⏰ <i>7일 언본딩 기간 후 클레임 가능</i>`;
    }
    
    // Telegram Rate Limit 대응: 최대 3번 재시도
    let retries = 3;
    while (retries > 0) {
        try {
            await bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
            console.log(`[${new Date().toLocaleTimeString()}] ✅ 알림 전송: ${functionName} ${amount.toFixed(2)} TAKE ($${usdValue.toFixed(2)})`);
            return; // 성공하면 종료
        } catch (error) {
            // 429 Rate Limit 에러 체크
            if (error.response && error.response.body && error.response.body.error_code === 429) {
                const retryAfter = error.response.body.parameters?.retry_after || 3;
                console.log(`[${new Date().toLocaleTimeString()}] ⏳ Rate Limit - ${retryAfter}초 대기 중... (재시도: ${4 - retries}/3)`);
                await new Promise(resolve => setTimeout(resolve, (retryAfter + 1) * 1000));
                retries--;
            } else {
                // 다른 에러는 바로 로그 출력 후 종료
                console.error('텔레그램 전송 실패:', error.message);
                return;
            }
        }
    }
    // 3번 재시도 후에도 실패
    console.error(`[${new Date().toLocaleTimeString()}] ❌ 알림 전송 실패 (3번 재시도 후): ${stakingInfo.digest.substring(0, 10)}...`);
}

// 단일 사용자 모니터링
async function monitorUser(chatId, bot, config) {
    try {
        const thresholdUsd = config.threshold || 10000;
        
        console.log(`[${new Date().toLocaleTimeString()}] [${chatId}] 체크 시작 (임계값: $${thresholdUsd})`);
        
        // 중복 체크용 Set 초기화
        if (!processedTxs.has(chatId)) {
            processedTxs.set(chatId, new Set());
        }
        const processedSet = processedTxs.get(chatId);
        
        // 각 함수별로 조회 (deposit, request_unstake, claim_unstake)
        const functions = ['deposit', 'request_unstake', 'claim_unstake'];
        
        for (const func of functions) {
            try {
                console.log(`[${chatId}] ${func} 조회 중...`);
                
                // 최근 트랜잭션 조회 (함수별) - 재시도 로직 포함
                let txResponse = null;
                let retries = 3;
                
                while (retries > 0 && !txResponse) {
                    try {
                        txResponse = await suiClient.queryTransactionBlocks({
                            filter: {
                                MoveFunction: {
                                    package: STAKING_PACKAGE,
                                    module: STAKING_MODULE,
                                    function: func
                                }
                            },
                            options: {
                                showEffects: true,
                                showBalanceChanges: true,
                                showObjectChanges: true,
                                showInput: true,
                                showEvents: true // 이벤트 조회 추가!
                            },
                            order: 'descending',
                            limit: 50 // 10 → 50으로 증가!
                        });
                    } catch (rpcError) {
                        retries--;
                        if (retries > 0) {
                            console.log(`[${chatId}] ${func} RPC 오류 (재시도 ${4 - retries}/3): ${rpcError.message}`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
                        } else {
                            throw rpcError; // 3번 실패하면 throw
                        }
                    }
                }
                
                console.log(`[${chatId}] ${func} 응답: ${txResponse?.data?.length || 0}개 트랜잭션`);
                
                if (!txResponse || !txResponse.data || txResponse.data.length === 0) {
                    continue;
                }
                
                // 역순으로 처리 (오래된 것부터)
                const transactions = txResponse.data.reverse();
                
                let processedCount = 0;
                let newCount = 0;
                
                for (const tx of transactions) {
                    // 중복 체크
                    if (processedSet.has(tx.digest)) {
                        processedCount++;
                        continue;
                    }
                    
                    console.log(`[${chatId}] 🆕 새 TX 처리 중: ${tx.digest.substring(0, 10)}...`);
                    newCount++;
                    
                    
                    const stakingInfo = isStakingTransaction(tx);
                    
                    if (stakingInfo) {
                        // 스테이킹 트랜잭션이면 무조건 기록 (중복 방지)
                        processedSet.add(tx.digest);
                        if (processedSet.size > 1000) {
                            const firstItem = processedSet.values().next().value;
                            processedSet.delete(firstItem);
                        }
                        
                        const amount = extractTakeAmount(tx);
                        
                        if (amount > 0) {
                            const usdValue = await takeToUsd(amount);
                            
                            // 임계값 체크
                            if (usdValue >= thresholdUsd) {
                                console.log(`[${chatId}] 💰 ${amount.toFixed(2)} TAKE ($${usdValue.toFixed(2)}) - ✅ 알림 전송!`);
                                await sendAlert(bot, chatId, stakingInfo, amount, usdValue);
                            } else {
                                console.log(`[${chatId}] 💵 ${amount.toFixed(2)} TAKE ($${usdValue.toFixed(2)}) - 임계값 미달 ($${thresholdUsd})`);
                            }
                        } else {
                            console.log(`[${chatId}] ⚠️ 금액 추출 실패 - TX: ${tx.digest.substring(0, 10)}`);
                        }
                    } else {
                        console.log(`[${chatId}] ⚠️ 스테이킹 TX 아님 - TX: ${tx.digest.substring(0, 10)}`);
                    }
                }
                
                // 함수별 요약
                if (newCount > 0) {
                    console.log(`[${chatId}] ${func}: ${newCount}개 신규 처리, ${processedCount}개 스킵`);
                } else if (processedCount > 0) {
                    // 신규 없을 때만 간단히 표시
                    console.log(`[${chatId}] ${func}: 신규 없음 (${processedCount}개 확인)`);
                }
            } catch (funcError) {
                console.error(`[${chatId}] ${func} 조회 오류:`, funcError.message);
            }
        }
        
    } catch (error) {
        console.error(`[${chatId}] 모니터링 오류:`, error.message);
    }
}

// 모니터링 시작
function startMonitoring(chatId, bot, config) {
    // 기존 모니터링 중지
    stopMonitoring(chatId);
    
    console.log(`[${chatId}] 모니터링 시작 - 임계값: $${config.threshold}`);
    
    // 10초마다 체크
    const intervalId = setInterval(() => {
        monitorUser(chatId, bot, config);
    }, 10000);
    
    intervals.set(chatId, intervalId);
    
    // 즉시 1회 실행
    monitorUser(chatId, bot, config);
}

// 모니터링 중지
function stopMonitoring(chatId) {
    const intervalId = intervals.get(chatId);
    if (intervalId) {
        clearInterval(intervalId);
        intervals.delete(chatId);
        processedTxs.delete(chatId);
        console.log(`[${chatId}] 모니터링 중지`);
    }
}

// 상태 조회
function getStatus(chatId) {
    const isActive = intervals.has(chatId);
    const processedCount = processedTxs.has(chatId) ? processedTxs.get(chatId).size : 0;
    return {
        isActive,
        processedTxCount: processedCount
    };
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    getStatus
};
