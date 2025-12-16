const axios = require('axios');

// 가격 + 순환 공급량 캐시
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 30000; // 30초

// TAKE 토큰 정보 조회 (가격 + 순환 공급량)
async function getTakeData() {
    try {
        // 캐시 확인 (30초 이내면 캐시 사용)
        const now = Date.now();
        if (cachedData && (now - lastFetchTime) < CACHE_DURATION) {
            return cachedData;
        }
        
        // CoinGecko API - 상세 정보 조회
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/overtake', {
            params: {
                localization: false,
                tickers: false,
                community_data: false,
                developer_data: false
            },
            timeout: 5000
        });
        
        if (response.data && response.data.market_data) {
            const marketData = response.data.market_data;
            
            cachedData = {
                price: marketData.current_price?.usd || 0.28,
                circulatingSupply: marketData.circulating_supply || 176838068,
                totalSupply: marketData.total_supply || 1000000000,
                maxSupply: marketData.max_supply || 1000000000
            };
            
            lastFetchTime = now;
            console.log(`✅ TAKE 정보 업데이트: $${cachedData.price}, 순환 공급량: ${cachedData.circulatingSupply.toLocaleString()}`);
            return cachedData;
        }
        
        // Fallback: 간단한 가격 API
        const fallback = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: 'overtake',
                vs_currencies: 'usd'
            },
            timeout: 5000
        });
        
        if (fallback.data && fallback.data.overtake && fallback.data.overtake.usd) {
            cachedData = {
                price: fallback.data.overtake.usd,
                circulatingSupply: cachedData?.circulatingSupply || 176838068, // 이전 캐시 또는 기본값
                totalSupply: 1000000000,
                maxSupply: 1000000000
            };
            lastFetchTime = now;
            console.log(`✅ 가격 업데이트 (Fallback): $${cachedData.price}`);
            return cachedData;
        }
        
        console.error('TAKE 정보를 찾을 수 없습니다');
        return cachedData || {
            price: 0.28,
            circulatingSupply: 176838068,
            totalSupply: 1000000000,
            maxSupply: 1000000000
        };
    } catch (error) {
        if (error.response && error.response.status === 429) {
            console.log('⚠️ CoinGecko Rate Limit - 캐시된 데이터 사용');
            // 캐시가 있으면 오래되어도 사용
            if (cachedData) {
                return cachedData;
            }
        } else {
            console.error('TAKE 정보 조회 실패:', error.message);
        }
        return cachedData || {
            price: 0.28,
            circulatingSupply: 176838068,
            totalSupply: 1000000000,
            maxSupply: 1000000000
        };
    }
}

// TAKE 토큰 가격 조회 (하위 호환성)
async function getTakePrice() {
    const data = await getTakeData();
    return data.price;
}

// 순환 공급량 조회
async function getCirculatingSupply() {
    const data = await getTakeData();
    return data.circulatingSupply;
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
    getTakeData,
    getCirculatingSupply,
    takeToUsd,
    usdToTake
};
