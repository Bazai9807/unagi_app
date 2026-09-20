const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../shared/www/domain.js');
const menu = [{id:'a', price:590, available:true}, {id:'b',price:150,available:true},{id:'gone',price:10,available:false}];
test('stale/unavailable items and invalid quantities cannot enter a cart',()=>{
  assert.deepEqual(D.normalizeCart({a:999,b:-1,gone:3,unknown:5},menu),{a:30});
  assert.deepEqual(D.normalizeCart({a:1.5,b:'2'},menu),{b:2});
  assert.deepEqual(D.normalizeCart(null,menu),{});
});
test('delivery minimum excludes fee, pickup has no minimum',()=>{
  const delivery = D.totals({a:1},menu,'delivery');
  assert.equal(delivery.total,789);
  assert.equal(delivery.canOrder,false);
  assert.equal(D.totals({a:1},menu,'pickup').canOrder,true);
  assert.equal(D.totals({a:1},menu,'pickup').total,590);
  assert.equal(D.totals({a:1,b:1},menu,'delivery').canOrder,true);
});
test('free delivery threshold and empty cart totals',()=>{
  assert.equal(D.totals({b:10},menu,'delivery').delivery,0);
  assert.equal(D.totals({b:9},menu,'delivery').delivery,199);
  assert.equal(D.totals({},menu,'delivery').total,0);
  assert.equal(D.totals({},menu,'pickup').canOrder,false);
  assert.equal(D.totals({a:2,b:1},menu,'delivery').total,1529);
});
test('Russian phones normalize and malformed ones fail',()=>{
  assert.equal(D.normalizePhone('8 (900) 123-45-67'),'+79001234567');
  assert.equal(D.normalizePhone('+7 900 123 45 67'),'+79001234567');
  for(const input of ['123','+44 900 123 45 67','790012345678','',null]) assert.equal(D.normalizePhone(input),null);
});
test('checkout requires contact, address and explicit demo acknowledgment',()=>{
  const s = D.totals({a:2},menu,'delivery');
  assert.deepEqual(Object.keys(D.validateCheckout({fulfillment:'delivery'},s)).sort(),['consent','house','name','phone','street']);
  const valid={name:'Тест',phone:'+79001234567',fulfillment:'delivery',street:'Тестовая',house:'1',consent:true};
  assert.deepEqual(D.validateCheckout(valid,s),{});
  assert.deepEqual(D.validateCheckout({...valid,fulfillment:'pickup',street:'',house:''},s),{});
  assert.ok(D.validateCheckout({...valid,name:'  '},s).name);
  assert.ok(D.validateCheckout(valid,D.totals({},menu,'delivery')).form);
});
