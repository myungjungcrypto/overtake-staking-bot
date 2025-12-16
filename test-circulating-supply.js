const { getTakeData, getCirculatingSupply } = require('./price');

async function testCirculatingSupply() {
    console.log('🧪 순환 공급량 테스트\n');
    
    try {
        // 방법 1: getTakeData() 사용
        console.log('📊 방법 1: getTakeData()');
        const data = await getTakeData();
        console.log(`   가격: $${data.price.toFixed(4)}`);
        console.log(`   순환 공급량: ${data.circulatingSupply.toLocaleString()} TAKE`);
        console.log(`   Total Supply: ${data.totalSupply.toLocaleString()} TAKE`);
        console.log(`   Max Supply: ${data.maxSupply.toLocaleString()} TAKE`);
        
        // 방법 2: getCirculatingSupply() 사용
        console.log('\n📊 방법 2: getCirculatingSupply()');
        const supply = await getCirculatingSupply();
        console.log(`   순환 공급량: ${supply.toLocaleString()} TAKE`);
        
        // 스테이킹 비율 계산 예시
        const exampleStaked = 17067992; // 17M TAKE
        const stakingRatio = (exampleStaked / supply) * 100;
        console.log('\n📈 스테이킹 비율 계산 예시:');
        console.log(`   스테이킹: ${exampleStaked.toLocaleString()} TAKE`);
        console.log(`   비율: ${stakingRatio.toFixed(2)}%`);
        
        // 캐시 테스트
        console.log('\n⚡ 캐시 테스트 (즉시 재호출):');
        const start = Date.now();
        const data2 = await getTakeData();
        const elapsed = Date.now() - start;
        console.log(`   소요 시간: ${elapsed}ms (캐시됨)`);
        console.log(`   순환 공급량: ${data2.circulatingSupply.toLocaleString()} TAKE`);
        
    } catch (error) {
        console.error('❌ 테스트 실패:', error.message);
    }
}

testCirculatingSupply();
