const { SuiClient } = require('@mysten/sui.js/client');
const { getTakePrice } = require('./price');

const SUI_RPC = 'https://fullnode.mainnet.sui.io:443';
const suiClient = new SuiClient({ url: SUI_RPC });

// 원본 패키지만 사용 (업그레이드되어도 이벤트 타입은 원본 패키지 ID 유지)
const ORIGINAL_PACKAGE = '0x2b5b2081ce2428bdd67057ed6d62d1112173ded3588eab63ab93c2042a0b296a';

// 스테이킹 풀 ID → 타입 매핑
const STAKING_POOLS = {
    '0xd299a39fbe797e4cc7df48ed7df9a33b5dda0f8fb960016bf42004fc62d50134': 'Flexible',
    '0x2b18f46876df3b3c28627f65d9a362fb5894c16ad4d63d1c52890280bea51a2b': '30일',
    '0x5b9e927f19595c7acfbd3819e6cb91eedeb6b85eb319f122e388bc4c459eb2bb': '90일',
    '0x8e41a28ee4f0fb7e26d1f9330a23b9ae5b4827097e1182200dce965c35343c6d': '180일'
};

// 캐시 (5분)
let cachedStats = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5분

// 이벤트 수집 함수 (타입별 분류 추가)
async function collectEvents(eventType) {
    let total = BigInt(0);
    let count = 0;
    let cursor = null;
    let pageCount = 0;
    let consecutiveErrors = 0;
    const maxPages = 200;
    const maxConsecutiveErrors = 5;
    
    // 타입별 통계
    const byType = {
        'Flexible': { total: BigInt(0), count: 0 },
        '30일': { total: BigInt(0), count: 0 },
        '90일': { total: BigInt(0), count: 0 },
        '180일': { total: BigInt(0), count: 0 },
        'Unknown': { total: BigInt(0), count: 0 }
    };
    
    console.log(`    ${eventType} 수집 시작...`);
    const startTime = Date.now();
    
    try {
        while (pageCount < maxPages) {
            pageCount++;
            
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
                
                consecutiveErrors = 0;
                
                for (const event of events.data) {
                    const amount = event.parsedJson?.amount || 
                                  event.parsedJson?.principal_amount ||
                                  event.parsedJson?.principal_returned;
                    const poolId = event.parsedJson?.pool_id;
                    
                    if (amount) {
                        const amountBigInt = BigInt(amount);
                        total += amountBigInt;
                        count++;
                        
                        // 타입별 분류
                        const poolType = STAKING_POOLS[poolId] || 'Unknown';
                        byType[poolType].total += amountBigInt;
                        byType[poolType].count++;
                    }
                }
                
                if (!events.hasNextPage) {
                    console.log(`    ${eventType}: ✅ 완료! 총 ${count}개 (${pageCount}페이지)`);
                    break;
                }
                
                cursor = events.nextCursor;
                
            } catch (queryError) {
                consecutiveErrors++;
                console.error(`    ${eventType} 에러 (${consecutiveErrors}/${maxConsecutiveErrors}): ${queryError.message.substring(0, 50)}...`);
                
                if (consecutiveErrors >= maxConsecutiveErrors) {
                    console.log(`    ${eventType}: ⚠️ 연속 에러 ${maxConsecutiveErrors}회, 현재까지 ${count}개로 종료`);
                    break;
                }
                
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
    
    return { total, count, byType };
}

// 총 스테이킹 조회
async function getTotalStaking(forceRefresh = false) {
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
    
    // 원본 패키지에서 모든 이벤트 수집
    console.log('\n📍 이벤트 타입 패키지: 0x2b5b2081... (원본)');
    console.log('   (OVERTAKE 1, 2, 3 모든 버전의 이벤트 포함)');
    
    // Deposit 이벤트
    console.log('\n  📥 Deposit 이벤트 조회...');
    const deposits = await collectEvents('DepositedEvent');
    
    // Claim 이벤트
    console.log('\n  📤 Claim 이벤트 조회...');
    const claims = await collectEvents('ClaimedEvent');
    
    // 타입별 순 스테이킹 계산
    const types = ['Flexible', '30일', '90일', '180일'];
    const byType = {};
    
    for (const type of types) {
        const deposited = deposits.byType[type].total;
        const claimed = claims.byType[type].total;
        const net = deposited - claimed;
        
        byType[type] = {
            netStaked: Number(net) / 1e9,
            totalDeposited: Number(deposited) / 1e9,
            totalClaimed: Number(claimed) / 1e9,
            depositCount: deposits.byType[type].count,
            claimCount: claims.byType[type].count
        };
    }
    
    // 전체 계산
    const netStaked = deposits.total - claims.total;
    const netStakedTake = Number(netStaked) / 1e9;
    const depositTake = Number(deposits.total) / 1e9;
    const claimTake = Number(claims.total) / 1e9;
    
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
        depositCount: deposits.count,
        claimCount: claims.count,
        byType,
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
    console.log('───────────────────────────────────────────────────');
    console.log('📊 타입별 현황:');
    for (const type of types) {
        const t = byType[type];
        console.log(`   ${type}: ${t.netStaked.toLocaleString()} TAKE (${t.depositCount}회 입금, ${t.claimCount}회 출금)`);
    }
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
    getCacheStatus,
    STAKING_POOLS
};