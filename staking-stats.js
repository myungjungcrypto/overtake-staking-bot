const { SuiClient } = require('@mysten/sui.js/client');
const { getTakePrice } = require('./price');

const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';
const suiClient = new SuiClient({ url: SUI_RPC });

// 두 패키지 모두 지원 (업그레이드 전/후)
const PACKAGES = [
    '0x528a6350937fe3904c02adc806fe35d7500fab2cccd5e6493dc7984feab2e570', // 현재
    '0x2b5b2081ce2428bdd67057ed6d62d1112173ded3588eab63ab93c2042a0b296a'  // 이전
];

// 캐시 (5분)
let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

// 이벤트 수집 함수 (디버깅 강화)
async function collectEvents(packageId, eventType) {
    let total = BigInt(0);
    let count = 0;
    let cursor = null;
    let pageCount = 0;
    const maxPages = 100; // 최대 100페이지 (5000개 이벤트)
    const pkgShort = packageId.substring(0, 10) + '...';
    
    console.log(`    [${pkgShort}] ${eventType} 수집 시작...`);
    const startTime = Date.now();
    
    try {
        while (pageCount < maxPages) {
            pageCount++;
            
            // 10페이지마다 진행상황 로그
            if (pageCount % 10 === 0) {
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                console.log(`    [${pkgShort}] ${eventType}: ${pageCount}페이지, ${count}개 수집됨 (${elapsed}초)`);
            }
            
            try {
                const events = await suiClient.queryEvents({
                    query: { MoveEventType: `${packageId}::staking::${eventType}` },
                    cursor,
                    limit: 50,
                    order: 'descending'
                });
                
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
                    console.log(`    [${pkgShort}] ${eventType}: 완료! 총 ${count}개 (${pageCount}페이지)`);
                    break;
                }
                
                cursor = events.nextCursor;
                
            } catch (queryError) {
                console.error(`    [${pkgShort}] ${eventType} 쿼리 에러 (페이지 ${pageCount}):`, queryError.message);
                // 에러나면 1초 대기 후 재시도
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        
        if (pageCount >= maxPages) {
            console.log(`    [${pkgShort}] ${eventType}: 최대 페이지 도달 (${maxPages}), ${count}개 수집`);
        }
        
    } catch (error) {
        console.error(`    [${pkgShort}] ${eventType} 전체 에러:`, error.message);
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`    [${pkgShort}] ${eventType}: ${count}개, ${elapsed}초 소요`);
    
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
    
    // 모든 패키지에서 이벤트 수집
    for (let i = 0; i < PACKAGES.length; i++) {
        const pkg = PACKAGES[i];
        const pkgShort = pkg.substring(0, 10) + '...';
        console.log(`\n[${i + 1}/${PACKAGES.length}] 패키지: ${pkgShort}`);
        
        // Deposit 이벤트
        console.log('  📥 Deposit 이벤트 조회...');
        const deposits = await collectEvents(pkg, 'DepositedEvent');
        totalDeposit += deposits.total;
        depositCount += deposits.count;
        
        // Claim 이벤트
        console.log('  📤 Claim 이벤트 조회...');
        const claims = await collectEvents(pkg, 'ClaimedEvent');
        totalClaim += claims.total;
        claimCount += claims.count;
    }
    
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
