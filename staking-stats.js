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

// 이벤트 수집 함수
async function collectEvents(packageId, eventType) {
    let total = BigInt(0);
    let count = 0;
    let cursor = null;
    let retries = 3;
    
    while (retries > 0) {
        try {
            while (true) {
                const events = await suiClient.queryEvents({
                    query: { MoveEventType: `${packageId}::staking::${eventType}` },
                    cursor,
                    limit: 50,
                    order: 'descending'
                });
                
                for (const event of events.data) {
                    const amount = event.parsedJson?.amount || 
                                  event.parsedJson?.principal_amount ||
                                  event.parsedJson?.principal_returned;
                    if (amount) {
                        total += BigInt(amount);
                        count++;
                    }
                }
                
                if (!events.hasNextPage || count >= 50000) break;
                cursor = events.nextCursor;
            }
            break; // 성공하면 루프 탈출
        } catch (error) {
            retries--;
            if (retries === 0) {
                console.log(`${eventType} 이벤트 조회 실패:`, error.message);
            }
            await new Promise(r => setTimeout(r, 2000)); // 재시도 전 대기
        }
    }
    
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
    
    console.log('📊 스테이킹 통계 조회 시작...');
    
    let totalDeposit = BigInt(0);
    let totalClaim = BigInt(0);
    let depositCount = 0;
    let claimCount = 0;
    
    // 모든 패키지에서 이벤트 수집
    for (const pkg of PACKAGES) {
        const pkgShort = pkg.substring(0, 10) + '...';
        console.log(`  [${pkgShort}] 조회 중...`);
        
        // Deposit 이벤트
        const deposits = await collectEvents(pkg, 'DepositedEvent');
        totalDeposit += deposits.total;
        depositCount += deposits.count;
        if (deposits.count > 0) {
            console.log(`    ✅ Deposit: ${deposits.count}개`);
        }
        
        // Claim 이벤트
        const claims = await collectEvents(pkg, 'ClaimedEvent');
        totalClaim += claims.total;
        claimCount += claims.count;
        if (claims.count > 0) {
            console.log(`    ✅ Claim: ${claims.count}개`);
        }
    }
    
    // 계산
    const netStaked = totalDeposit - totalClaim;
    const netStakedTake = Number(netStaked) / 1e9;
    const depositTake = Number(totalDeposit) / 1e9;
    const claimTake = Number(totalClaim) / 1e9;
    
    // 가격 조회
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
    
    console.log(`✅ 총 스테이킹: ${netStakedTake.toLocaleString()} TAKE ($${netStakedUsd.toLocaleString()})`);
    
    return stats;
}

// 캐시 초기화
function clearStatsCache() {
    cachedStats = null;
    lastFetchTime = 0;
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
