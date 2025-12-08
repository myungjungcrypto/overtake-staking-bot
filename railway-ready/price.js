const axios = require('axios');

// 가격 캐시
let cachedPrice = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30초

// TAKE 토큰 가격 조회 (CoinGecko)
async function getTakePrice() {
    try {
        // 캐시 확인 (30초 이내면 캐시 사용)
        const now = Date.now();
        if (cachedPrice && (now - lastFetchTime) < CACHE_DURATION) {
            return cachedPrice;
        }
        
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'overtake',
                vs_currencies: 'usd'
            },
            timeout: 5000
        });
        
        if (response.data && response.data.overtake && response.data.overtake.usd) {
            cachedPrice = response.data.overtake.usd;
            lastFetchTime = now;
            console.log(`✅ 가격 업데이트: $${cachedPrice}`);
            return cachedPrice;
        }
        
        // Fallback: 직접 가격 API
        const fallback = await axios.get('https://api.coingecko.com/api/v3/coins/overtake', {
            timeout: 5000
        });
        
        if (fallback.data && fallback.data.market_data && fallback.data.market_data.current_price) {
            cachedPrice = fallback.data.market_data.current_price.usd;
            lastFetchTime = now;
            console.log(`✅ 가격 업데이트 (Fallback): $${cachedPrice}`);
            return cachedPrice;
        }
        
        console.error('가격 정보를 찾을 수 없습니다');
        return cachedPrice || 0.28; // 캐시 또는 기본값
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.log('⚠️ CoinGecko Rate Limit - 캐시된 가격 사용');
            // 캐시가 있으면 오래되어도 사용
            if (cachedPrice) {
                return cachedPrice;
            }
        } else {
            console.error('가격 조회 실패:', error.message);
        }
        return cachedPrice || 0.28; // 캐시 또는 기본값
    }
}

// TAKE 금액을 USD로 변환
async function takeToUsd(takeAmount) {
    const price = await getTakePrice();
    return takeAmount * price;
}

// USD 금액을 TAKE로 변환
async function usdToTake(usdAmount) {
    const price = await getTakePrice();
    return price > 0 ? usdAmount / price : 0;
}

module.exports = {
    getTakePrice,
    takeToUsd,
    usdToTake
};
