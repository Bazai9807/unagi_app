(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnagiDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RULES = Object.freeze({ minimum: 700, freeDelivery: 1500, deliveryFee: 199, maxQuantity: 30 });
  function normalizeCart(cart, products) {
    const valid = {};
    for (const product of products) {
      const amount = Number(cart && cart[product.id]);
      if (product.available && Number.isInteger(amount) && amount > 0) valid[product.id] = Math.min(amount, RULES.maxQuantity);
    }
    return valid;
  }
  function totals(cart, products, fulfillment) {
    const normalized = normalizeCart(cart, products);
    const lines = products.filter(p => normalized[p.id]).map(p => ({ ...p, quantity: normalized[p.id], sum: normalized[p.id] * p.price }));
    const subtotal = lines.reduce((sum, item) => sum + item.sum, 0);
    const count = lines.reduce((sum, item) => sum + item.quantity, 0);
    const delivery = fulfillment === 'delivery' && subtotal > 0 && subtotal < RULES.freeDelivery ? RULES.deliveryFee : 0;
    return { lines, subtotal, count, delivery, total: subtotal + delivery, canOrder: count > 0 && (fulfillment === 'pickup' || subtotal >= RULES.minimum) };
  }
  function normalizePhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 11 && digits[0] === '8') digits = '7' + digits.slice(1);
    return /^7\d{10}$/.test(digits) ? '+' + digits : null;
  }
  function validateCheckout(form, summary) {
    const errors = {};
    if (!String(form.name || '').trim()) errors.name = 'Укажите, как к вам обращаться';
    if (String(form.name || '').length > 60) errors.name = 'Не более 60 символов';
    if (!normalizePhone(form.phone)) errors.phone = 'Введите номер: +7 и ещё 10 цифр';
    if (form.fulfillment !== 'pickup' && form.fulfillment !== 'delivery') errors.form = 'Выберите способ получения';
    if (form.fulfillment === 'delivery') {
      if (!String(form.street || '').trim()) errors.street = 'Укажите улицу';
      if (!String(form.house || '').trim()) errors.house = 'Укажите дом';
    }
    if (!form.consent) errors.consent = 'Подтвердите, что это тестовый заказ';
    if (!summary.canOrder) errors.form = summary.count ? 'Минимальная сумма доставки — 700 ₽' : 'Корзина пуста';
    return errors;
  }
  return { RULES, normalizeCart, totals, normalizePhone, validateCheckout };
});
