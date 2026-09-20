import { need } from './security.js';

export function maxBonus({balance,allowedByIiko,subtotal,limitType,limit,unitValue=100}) {
  need([balance,allowedByIiko,subtotal,limit,unitValue].every(Number.isFinite)&&unitValue>0,400,'Некорректные условия бонусов');
  const brandCap=limitType==='percent'?Math.floor(subtotal*limit/100/unitValue):Math.floor(limit);
  return Math.max(0,Math.min(Math.floor(balance),Math.floor(allowedByIiko),brandCap,Math.floor(subtotal/unitValue)));
}
export function calculate(input,brand,branch,method,products) {
  need(brand.active&&branch.active&&branch.acceptingOrders,409,'Точка временно не принимает заказы');
  need(branch.brandId===input.brandId&&method.brandId===input.brandId&&method.enabled,400,'Бренд, точка и оплата не совпадают');
  need(branch.modes[input.mode],409,'Этот способ получения отключён');
  need(input.mode!=='delivery'||input.address.trim(),400,'Укажите адрес доставки');
  need(input.mode!=='dinein'||input.table.trim(),400,'Укажите стол');
  if(input.scheduledAt){need(branch.modes.scheduled,409,'Предзаказ отключён');need(Date.parse(input.scheduledAt)>Date.now(),400,'Время предзаказа должно быть в будущем');}
  // Until iikoCard checks the actual basket, neither local promotions nor a cached balance may reduce its price.
  need(input.requestedBonus===0&&!input.promoCode,409,'Сначала подключите и проверьте расчёт корзины в iikoCard','loyalty_not_connected');
  const amounts=new Map(); for(const line of input.items)amounts.set(line.productId,(amounts.get(line.productId)||0)+line.quantity);
  const lines=[...amounts].map(([productId,quantity])=>{
    need(quantity<=30,400,'Не более 30 единиц одной позиции'); const product=products.find(p=>p.id===productId);
    need(product&&product.available&&product.branchId===input.branchId,409,'Блюдо недоступно в выбранной точке');
    need(!product.requiresModifiers,409,'Для блюда требуются модификаторы; настройте их обработку');
    need(Number.isSafeInteger(product.price)&&product.price>=0,409,'Некорректная цена меню');
    return {productId,name:product.name,category:product.category||'Без категории',quantity,price:product.price,sum:product.price*quantity};
  });
  const subtotal=lines.reduce((sum,line)=>sum+line.sum,0);
  need(input.mode!=='delivery'||subtotal>=branch.minimum,409,'Не достигнута минимальная сумма доставки');
  const delivery=input.mode==='delivery'&&subtotal<branch.freeDelivery?branch.deliveryFee:0;
  return {lines,subtotal,delivery,discount:0,bonus:0,total:subtotal+delivery,currency:'RUB'};
}
export const transitions={new:['accepted','cancelled'],accepted:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['delivering','completed','cancelled'],delivering:['completed','cancelled'],completed:[],cancelled:[]};
export function canTransition(from,to){return transitions[from]?.includes(to) || false;}
export function csvCell(value) {
  let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';
}
export const csv = (head,records)=>'\uFEFF'+[head,...records].map(row=>row.map(csvCell).join(';')).join('\r\n');
