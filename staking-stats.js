const { SuiClient } = require('@mysten/sui.js/client');
const { getTakePrice } = require('./price');

const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';
const suiClient = new SuiClient({ url: SUI_RPC });

// 원본 패키지만 사용 (업그레이드되어도 이벤트 타입은 원본 패키지 ID 유지)
// OVERTAKE 3 (0x528a6350...)에서 실행해도 이벤트 타입은 0x2b5b2081...::staking::DepositedEvent
const ORIGINAL_PACKAGE = '0x2b5b2081ce2428bdd67057ed6d62d1112173ded3588eab63ab93c2042a0b296a';

// 캐시 (5분)
let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

// 이벤트 수집 함수 (에러 핸들링 강화)
async function collectEvents(eventType) {
    let total = BigInt(0);
    let count = 0;
    let cursor = null;
    let pageCount = 0;
    let consecutiveErrors = 0;
    const maxPages = 200; // 최대 200페이지
    const maxConsecutiveErrors = 5; // 연속 에러 5번이면 중단
    
    console.log(`    ${eventType} 수집 시작...`);
    const startTime = Date.now();
    
    try {
        while (pageCount < maxPages) {
            pageCount++;
            
            // 10페이지마다 진행상황 로그
            if (pageCount % 10 === 0) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`    ${eventType}: ${pageCount}페이지, ${count}개 수집됨 (${elapsed}초)`);
            }
            
            try {
                const events = await suiClient.queryEvents({
                    query: { MoveEventType: `${ORIGINAL_PACKAGE}::staking::${eventType}` },
                    cursor,
                    limit: 50,
                    order: 'descending'
                });
                
                // 성공하면 연속 에러 카운트 리셋
                consecutiveErrors = 0;
                
                // 이벤트 처리
                for (const event of events.data) {
                    const amount = event.parsedJson?.amount || 
                                  event.parsedJson?.principal_amount ||
                                  event.parsedJson?.principal_returned;
                    if (amount) {
                        total += BigInt(amount);
                        count++;
                    }
                }
                
                // 다음 페이지 없으면 종료
                if (!events.hasNextPage) {
                    console.log(`    ${eventType}: ✅ 완료! 총 ${count}개 (${pageCount}페이지)`);
                    break;
                }
                
                cursor = events.nextCursor;
                
            } catch (queryError) {
                consecutiveErrors++;
                console.error(`    ${eventType} 에러 (${consecutiveErrors}/${maxConsecutiveErrors}): ${queryError.message.substring(0, 50)}...`);
                
                // 연속 에러가 너무 많으면 중단
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.log(`    ${eventType}: ⚠️ 연속 에러 ${maxConsecutiveErrors}회, 현재까지 ${count}개로 종료`);
                    break;
                }
                
                // 잠시 대기 후 재시도
                await new Promise(r => setTimeout(r, 500));
            }
        }
        
        if (pageCount >= maxPages) {
            console.log(`    ${eventType}: ⚠️ 최대 페이지 도달, ${count}개 수집`);
        }
        
    } catch (error) {
        console.error(`    ${eventType} 전체 에러:`, error.message);
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`    ${eventType}: 총 ${count}개, ${elapsed}초 소요`);
    
    return { total, count };
}

// 총 스테이킹 조회
async function getTotalStaking(forceRefresh = false) {
    // 캐시 확인
    const now = Date.now();
    if (!forceRefresh && cachedStats && (now - lastFetchTime) < CACHE_DURATION) {
        console.log('📦 캐시된 스테이킹 통계 사용');
        return cachedStats;
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log('📊 스테이킹 통계 조회 시작...');
    console.log('═══════════════════════════════════════════════════');
    const totalStartTime = Date.now();
    
    let totalDeposit = BigInt(0);
    let totalClaim = BigInt(0);
    let depositCount = 0;
    let claimCount = 0;
    
    // 원본 패키지에서 모든 이벤트 수집 (업그레이드된 버전 포함)
    console.log('\n📍 이벤트 타입 패키지: 0x2b5b2081... (원본)');
    console.log('   (OVERTAKE 1, 2, 3 모든 버전의 이벤트 포함)');
    
    // Deposit 이벤트
    console.log('\n  📥 Deposit 이벤트 조회...');
    const deposits = await collectEvents('DepositedEvent');
    totalDeposit = deposits.total;
    depositCount = deposits.count;
    
    // Claim 이벤트
    console.log('\n  📤 Claim 이벤트 조회...');
    const claims = await collectEvents('ClaimedEvent');
    totalClaim = claims.total;
    claimCount = claims.count;
    
    // 계산
    const netStaked = totalDeposit - totalClaim;
    const netStakedTake = Number(netStaked) / 1e9;
    const depositTake = Number(totalDeposit) / 1e9;
    const claimTake = Number(totalClaim) / 1e9;
    
    // 가격 조회
    console.log('\n💰 가격 조회 중...');
    const price = await getTakePrice();
    const netStakedUsd = netStakedTake * price;
    
    // 결과 객체
    const stats = {
        netStaked: netStakedTake,
        netStakedUsd,
        totalDeposited: depositTake,
        totalClaimed: claimTake,
        depositCount,
        claimCount,
        price,
        timestamp: now
    };
    
    // 캐시 저장
    cachedStats = stats;
    lastFetchTime = now;
    
    const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(1);
    
    console.log('');
    console.log('═══════════════════════════════════════════════════');
    console.log(`✅ 조회 완료! (총 ${totalElapsed}초)`);
    console.log('───────────────────────────────────────────────────');
    console.log(`💎 총 스테이킹: ${netStakedTake.toLocaleString()} TAKE`);
    console.log(`💵 USD 가치: $${netStakedUsd.toLocaleString()}`);
    console.log(`📥 Deposit: ${depositCount}회 (${depositTake.toLocaleString()} TAKE)`);
    console.log(`📤 Claim: ${claimCount}회 (${claimTake.toLocaleString()} TAKE)`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    
    return stats;
}

// 캐시 초기화
function clearStatsCache() {
    cachedStats = null;
    lastFetchTime = 0;
    console.log('🗑️ 스테이킹 통계 캐시 초기화됨');
}

// 캐시 상태 확인
function getCacheStatus() {
    if (!cachedStats) return { isCached: false };
    
    const now = Date.now();
    const age = now - lastFetchTime;
    const remaining = Math.max(0, CACHE_DURATION - age);
    
    return {
        isCached: true,
        ageSeconds: Math.floor(age / 1000),
        remainingSeconds: Math.floor(remaining / 1000)
    };
}

module.exports = {
    getTotalStaking,
    clearStatsCache,
    getCacheStatus
};