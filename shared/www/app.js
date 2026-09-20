(async function () {
  'use strict';
  const D = UnagiDomain;
  const $ = (selector) => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
  const paths = {
    menu: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    heart: '<path d="M20.8,4.6a5.5,5.5 0 0 0 -7.8,0L12,5.7l-1.1,-1.1a5.5,5.5 0 0 0 -7.8,7.8L12,21l8.8,-8.6a5.5,5.5 0 0 0 0,-7.8Z"/>',
    bag: '<path d="M5,7h14l2,14H3Z"/><path d="M8,8V6a4,4 0 0 1 8,0v2"/>',
    user: '<circle cx="12" cy="7" r="4"/><path d="M4,21v-2a8,8 0 0 1 16,0v2"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M16,16l5,5"/>',
    pin: '<path d="M20,10c0,6 -8,12 -8,12S4,16 4,10a8,8 0 0 1 16,0Z"/><circle cx="12" cy="10" r="2.5"/>',
    right: '<path d="M9,5l7,7 -7,7"/>', down: '<path d="M5,9l7,7 7,-7"/>',
    arrow: '<path d="M4,12h16m-6,-6l6,6 -6,6"/>', back: '<path d="M20,12H4m6,-6l-6,6 6,6"/>',
    plus: '<path d="M12,5v14M5,12h14"/>', minus: '<path d="M5,12h14"/>', close: '<path d="M6,6l12,12M6,18L18,6"/>',
    check: '<path d="M5,12l4,4L20,5"/>',
    leaf: '<path d="M20,3c-17,-2 -21,16 -10,17C20,21 21,8 20,3ZM5,20L17,7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12,7v5l4,2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12,11v6M12,7v.2"/>',
    receipt: '<path d="M5,3l3,2 4,-2 4,2 3,-2v19l-3,-2 -4,2 -4,-2 -3,2Z"/><path d="M9,9h6M9,13h6M9,17h3"/>',
    card: '<rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2,9h20M6,15h4"/>',
    trash: '<path d="M3,6h18M9,6V3h6v3M6,6l1,15h10l1,-15M10,10v7M14,10v7"/>',
    shield: '<path d="M12,2l9,4v6c0,6 -9,10 -9,10S3,18 3,12V6Z"/><path d="M8,12l3,3 5,-6"/>',
    refresh: '<path d="M20,7V2m0,5h-5M4,17v5m0,-5h5M20,7A9,9 0 0 0 4,6M4,17A9,9 0 0 0 20,18"/>'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
  let storageFailed = false;
  function read(key, fallback) {
    try { const value = localStorage.getItem('unagi.' + key); return value ? JSON.parse(value) : fallback; }
    catch (_) { storageFailed = true; return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem('unagi.' + key, JSON.stringify(value)); return true; }
    catch (_) { storageFailed = true; toast('Не удалось сохранить данные на устройстве'); return false; }
  }
  let products;
  try { products = await UnagiMenu.load(); }
  catch (_) { $('#app').innerHTML = '<div class="connection-error"><h1>Не удалось открыть меню</h1><p>Закройте приложение и попробуйте снова.</p></div>'; return; }
  let cart = D.normalizeCart(read('cart', {}), products);
  const savedFavorites = read('favorites', []);
  let favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites.filter(id => products.some(p => p.id === id)) : []);
  const storedOrders = read('orders', []);
  let orders = Array.isArray(storedOrders) ? storedOrders.filter(o => o && typeof o.id === 'string' && Array.isArray(o.lines) && Number.isFinite(o.total)).slice(0, 50) : [];
  let fulfillment = read('fulfillment', 'delivery') === 'pickup' ? 'pickup' : 'delivery';
  let page = 'menu', category = 'all', search = '', modal = null, lastFocus = null;
  let submitting = false, errors = {}, latestOrder = null, cutlery = 1;
  let form = { name:'', phone:'', street:'', house:'', apartment:'', entrance:'', comment:'', consent:false };
  const summary = () => D.totals(cart, products, fulfillment);
  const meta = p => `${p.weight} ${p.category === 'drinks' ? 'мл' : 'г'}${p.pieces ? ' · ' + p.pieces + ' шт' : ''}`;
  let toastTimer;
  function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2500); }
  function header() { return `<header class="topbar"><div><div class="brand">unagi<span>.</span></div><div class="brand-note">СУШИ С ХАРАКТЕРОМ</div></div><button class="demo-pill" data-action="about"><i class="dot"></i> ДЕМО-МЕНЮ</button></header>`; }
  function nav() {
    return `<nav class="bottom-nav" aria-label="Основная навигация">${[['menu','menu','Меню'],['favorites','heart','Избранное'],['cart','bag','Корзина'],['profile','user','Профиль']].map(([id, symbol, label]) => `<button class="nav-item ${(page === id || (id === 'profile' && page === 'orders')) ? 'active' : ''}" data-action="nav" data-page="${id}" ${page === id ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${id === 'cart' && summary().count ? `<b class="nav-count">${summary().count}</b>` : ''}</button>`).join('')}</nav>`;
  }
  function floatingCart() { const s = summary(); return s.count && ['menu','favorites'].includes(page) ? `<button class="cart-float" data-action="nav" data-page="cart"><span>${icon('bag')}Корзина <b>${s.count}</b></span><strong>${money(s.subtotal)}</strong></button>` : ''; }
  function stepper(id) { return `<div class="stepper"><button data-action="remove" data-id="${id}" aria-label="Уменьшить количество ${esc(products.find(p=>p.id===id)?.name)}">${icon('minus')}</button><output aria-live="polite">${cart[id]}</output><button data-action="add" data-id="${id}" aria-label="Увеличить количество ${esc(products.find(p=>p.id===id)?.name)}" ${cart[id] >= D.RULES.maxQuantity ? 'disabled' : ''}>${icon('plus')}</button></div>`; }
  function productCard(p) { return `<article class="product"><button class="product-image" data-action="product" data-id="${p.id}" aria-label="Подробнее: ${esc(p.name)}">${UnagiArt(p.art)}${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}</button><button class="favorite ${favorites.has(p.id) ? 'selected' : ''}" data-action="favorite" data-id="${p.id}" aria-label="${favorites.has(p.id) ? 'Убрать из избранного' : 'В избранное'}: ${esc(p.name)}" aria-pressed="${favorites.has(p.id)}">${icon('heart')}</button><div class="product-info"><button class="product-title" data-action="product" data-id="${p.id}">${esc(p.name)}</button><div class="product-meta">${meta(p)}</div><div class="buy-row ${cart[p.id] ? 'has-count' : ''}"><span class="price">${money(p.price)}</span>${cart[p.id] ? stepper(p.id) : `<button class="add-button" data-action="add" data-id="${p.id}" aria-label="Добавить ${esc(p.name)}">${icon('plus')}</button>`}</div></div></article>`; }
  function visibleProducts() { return products.filter(p => (page !== 'favorites' || favorites.has(p.id)) && (page === 'favorites' || category === 'all' || p.category === category) && (!search || (p.name + ' ' + p.ingredients).toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')))); }
  function productGrid() { const list = visibleProducts(); return list.length ? `<div class="grid">${list.map(productCard).join('')}</div>` : empty('search','Ничего не нашлось','Попробуйте другое название или ингредиент.','Сбросить поиск','reset-search'); }
  function empty(symbol, title, description, button, action = 'to-menu') { return `<div class="empty"><div class="empty-symbol">${icon(symbol)}</div><h2>${title}</h2><p>${description}</p><button class="primary" data-action="${action}">${button} ${icon('arrow')}</button></div>`; }
  function menuPage() { return `${header()}<div class="mode-row"><button class="location" data-action="fulfillment">${icon('pin')}<div><strong>${fulfillment === 'pickup' ? 'Заберу самостоятельно' : 'Доставка к вашему столу'}</strong><span>${fulfillment === 'pickup' ? 'Тестовая точка Unagi' : 'Адрес укажете при оформлении'}</span></div>${icon('down')}</button><button class="round" data-action="focus-search" aria-label="Поиск блюда">${icon('search')}</button></div><section class="hero"><div class="eyebrow">Хороший вечер начинается здесь</div><h1>Твой повод<br>для unagi.</h1><p>Любимые роллы.<br>И ничего лишнего.</p><button class="hero-cta" data-action="sets">Выбрать сет ${icon('arrow')}</button><div class="hero-stamp">ROLL<br>WITH<br>LOVE</div>${UnagiArt('set', true)}</section><div class="perks"><span>${icon('bag')} Доставка и самовывоз</span><span>${icon('leaf')} На любой вкус</span><span>${icon('heart')} Сделано с заботой</span></div><div class="section-heading"><h2>Что попробуем?</h2><span>${products.length} блюд</span></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="Ролл, сет или любимый ингредиент" value="${esc(search)}" aria-label="Поиск по меню"></label><div class="categories" aria-label="Категории меню">${UnagiMenu.categories.map(([id,label]) => `<button class="chip ${category === id ? 'active' : ''}" data-action="category" data-id="${id}" aria-pressed="${category === id}">${label}</button>`).join('')}</div><section id="product-grid" aria-label="Блюда">${productGrid()}</section><p class="menu-footer">Демонстрационные блюда, цены и иллюстрации.<br>Реальное меню Unagi появится после подключения iiko.</p>`; }
  function favoritesPage() { return `${header()}<h1 class="page-title">Самое любимое</h1><p class="subtitle">Всё, к чему хочется возвращаться.</p>${favorites.size ? `<div id="product-grid">${productGrid()}</div>` : empty('heart','Сохраните свой первый ролл','Нажмите на сердечко рядом с блюдом — оно будет ждать вас здесь.','Открыть меню')}`; }
  function modeSwitch() { return `<div class="segmented" aria-label="Способ получения"><button data-action="mode" data-id="delivery" class="${fulfillment === 'delivery' ? 'active' : ''}" aria-pressed="${fulfillment === 'delivery'}">Доставка</button><button data-action="mode" data-id="pickup" class="${fulfillment === 'pickup' ? 'active' : ''}" aria-pressed="${fulfillment === 'pickup'}">Самовывоз</button></div>`; }
  function totalsBox(s) { return `<div class="box"><div class="total-row"><span>Блюда · ${s.count} шт.</span><span>${money(s.subtotal)}</span></div><div class="total-row"><span>${fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'}</span><span>${s.delivery ? money(s.delivery) : 'Бесплатно'}</span></div><div class="total-row total"><span>Итого</span><span>${money(s.total)}</span></div></div>`; }
  function cartPage() {
    const s = summary();
    if (!s.count) return `${header()}<h1 class="page-title">Корзина</h1>${empty('bag','Здесь пока пусто','Начните с любимой классики или попробуйте что-нибудь новое.','Выбрать вкусное')}`;
    return `${header()}<div class="section-heading"><h1 class="page-title">Ваш заказ</h1><button class="text-button" data-action="clear-cart">Очистить</button></div>${modeSwitch()}${s.lines.map(p => `<div class="cart-line"><button class="thumb" data-action="product" data-id="${p.id}" aria-label="${esc(p.name)}">${UnagiArt(p.art)}</button><div class="cart-line-info"><h3>${esc(p.name)}</h3><p class="product-meta">${meta(p)}</p><div class="cart-line-bottom"><strong class="price">${money(p.sum)}</strong>${stepper(p.id)}</div></div></div>`).join('')}${fulfillment === 'delivery' ? `<div class="free-progress">${s.subtotal < D.RULES.freeDelivery ? `Ещё ${money(D.RULES.freeDelivery - s.subtotal)} до бесплатной доставки` : 'Доставка этого заказа — бесплатно'}<progress value="${Math.min(s.subtotal, D.RULES.freeDelivery)}" max="${D.RULES.freeDelivery}" aria-label="До бесплатной доставки"></progress></div>` : ''}<div class="cutlery"><div><strong>Приборы</strong><small>Сколько человек за столом?</small></div><div class="stepper"><button data-action="cutlery-minus" aria-label="Меньше приборов" ${cutlery === 0 ? 'disabled' : ''}>${icon('minus')}</button><output>${cutlery}</output><button data-action="cutlery-plus" aria-label="Больше приборов" ${cutlery === 10 ? 'disabled' : ''}>${icon('plus')}</button></div></div>${totalsBox(s)}${!s.canOrder ? `<p class="error">Для доставки добавьте блюда ещё на ${money(D.RULES.minimum - s.subtotal)}. Или выберите самовывоз.</p>` : ''}<button class="primary" data-action="checkout" ${!s.canOrder ? 'disabled' : ''}>К оформлению ${icon('arrow')}</button><div class="notice">${icon('info')}<div><strong>Сейчас это тестовый заказ</strong>Цены и условия доставки примерные. Ресторан не получит заказ, оплата не списывается.</div></div>`;
  }
  function field(id,label,placeholder,type='text', autocomplete='off') { return `<label class="field"><span>${label}</span><input name="${id}" type="${type}" autocomplete="${autocomplete}" placeholder="${placeholder}" value="${esc(form[id])}" maxlength="${id === 'phone' ? 20 : 60}" ${type === 'tel' ? 'inputmode="tel"' : ''} aria-invalid="${!!errors[id]}" ${errors[id] ? `aria-describedby="error-${id}"` : ''}>${errors[id] ? `<small id="error-${id}">${errors[id]}</small>` : ''}</label>`; }
  function checkoutPage() { const s = summary(); return `<div class="checkout-header"><button class="round" data-action="back" aria-label="Назад">${icon('back')}</button><h1>Оформление заказа</h1></div><div class="notice">${icon('info')}<div><strong>Демо: можно указать вымышленные данные</strong>Заказ останется только на этом устройстве. Телефон и адрес после оформления не сохраняются.</div></div><form id="checkout-form" novalidate><div class="box"><h3>Как с вами связаться</h3>${field('name','Ваше имя','Например, Саша','text','given-name')}${field('phone','Телефон','+7 900 000-00-00','tel','tel')}</div><div class="box"><h3>Как получите заказ</h3>${modeSwitch()}${fulfillment === 'delivery' ? `${field('street','Улица','Название улицы')}<div class="field-row">${field('house','Дом','Дом и корпус')}${field('apartment','Квартира','Необязательно')}</div>${field('entrance','Подъезд, этаж, домофон','Необязательно')}` : '<div class="payment">' + icon('pin') + '<div>Тестовая точка Unagi<span>Реальный адрес ресторана пока не подключён.</span></div></div>'}<label class="field"><span>Пожелания к заказу</span><textarea name="comment" maxlength="300" placeholder="Что нам нужно знать?">${esc(form.comment)}</textarea></label></div><div class="box"><h3>Оплата</h3><div class="payment">${icon('card')}<div>При получении<span>Тестовый способ. Онлайн-оплата не подключена.</span></div>${icon('check')}</div></div>${totalsBox(s)}<label class="checkbox"><input name="consent" type="checkbox" ${form.consent ? 'checked' : ''}><span>Понимаю, что создаю тестовый заказ. Он не будет передан ресторану.</span></label>${errors.consent ? `<p class="error">${errors.consent}</p>` : ''}${errors.form ? `<p class="error">${errors.form}</p>` : ''}<button class="primary" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Сохраняем…' : 'Создать тестовый заказ · ' + money(s.total)}</button></form>`; }
  function profilePage() { return `${header()}<h1 class="page-title">Мой Unagi</h1><div class="profile-card"><div class="avatar">${icon('user')}</div><div><h2>Привет, гость!</h2><p>Хороший вкус объединяет.</p></div></div><button class="list-button" data-action="nav" data-page="orders">${icon('receipt')}История тестовых заказов ${icon('right')}</button><button class="list-button" data-action="nav" data-page="favorites">${icon('heart')}Избранные блюда ${icon('right')}</button><button class="list-button" data-action="conditions">${icon('bag')}Доставка и самовывоз ${icon('right')}</button><button class="list-button" data-action="privacy">${icon('shield')}Данные на устройстве ${icon('right')}</button><button class="list-button" data-action="about">${icon('info')}О приложении ${icon('right')}</button><button class="list-button danger" data-action="clear-data">${icon('trash')}Удалить локальные данные ${icon('right')}</button><div class="version">UNAGI · версия 0.1.0<br>Сделано для ваших вкусных вечеров.</div>`; }
  function ordersPage() { return `${header()}<div class="checkout-header"><button class="round" data-action="nav" data-page="profile" aria-label="Назад в профиль">${icon('back')}</button><h1>История заказов</h1></div>${orders.length ? '<p class="subtitle">Тестовые заказы на этом устройстве.</p>' + orders.map(o=>`<article class="order-card"><div class="order-head"><h3>№ ${esc(o.number)}</h3><span class="order-status">Тестовый</span></div><span class="muted small">${esc(new Date(o.createdAt).toLocaleString('ru-RU', {day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'}))}</span><p>${o.lines.map(l=>`${esc(l.name)} × ${l.quantity}`).join(' · ')}</p><div class="total-row"><span>${o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'} · Не отправлен</span><strong>${money(o.total)}</strong></div><button class="secondary" data-action="repeat" data-id="${esc(o.id)}">Повторить заказ</button></article>`).join('') : empty('receipt','Первый вкусный шаг впереди','Ваши тестовые заказы появятся здесь после оформления.','Перейти в меню')}`; }
  function successPage() { const o = latestOrder; return `<div class="success"><div class="success-mark">${icon('check')}</div><div class="eyebrow">Заказ № ${esc(o.number)}</div><h1>Всё получилось.<br>Тестовый заказ готов.</h1><p>Тестовый заказ сохранён.<br>В ресторан он <strong>не отправлен</strong>.<br>Готовить и доставлять его не будут.</p></div><div class="box receipt"><h3>Ваш тестовый заказ</h3>${o.lines.map(p => `<div class="receipt-line"><span>${esc(p.name)} × ${p.quantity}</span><strong>${money(p.sum)}</strong></div>`).join('')}<div class="total-row"><span>${o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'}</span><span>${o.delivery ? money(o.delivery) : 'Бесплатно'}</span></div><div class="total-row"><span>Приборы</span><span>${o.cutlery} шт.</span></div><div class="total-row total"><span>Итого</span><span>${money(o.total)}</span></div></div><button class="primary" data-action="nav" data-page="orders">К истории заказов ${icon('arrow')}</button><div class="spacer"></div><button class="secondary" data-action="to-menu">Вернуться в меню</button>`; }
  function render() {
    const scroll = window.scrollY;
    const categoriesScroll = $('.categories')?.scrollLeft || 0;
    const content = {menu:menuPage,favorites:favoritesPage,cart:cartPage,checkout:checkoutPage,profile:profilePage,orders:ordersPage,success:successPage}[page];
    $('#app').innerHTML = `<main class="page">${content()}</main>${['checkout','success'].includes(page) ? '' : nav()}${floatingCart()}`;
    if ($('.categories')) $('.categories').scrollLeft = categoriesScroll;
    window.scrollTo(0,scroll);
  }
  function navigate(next) { page=next; search=''; closeModal(); render(); window.scrollTo(0,0); }
  function changeCart(id, delta) {
    const product = products.find(p => p.id === id);
    if (!product || !product.available) return;
    cart[id] = Math.max(0,Math.min(D.RULES.maxQuantity,(cart[id]||0)+delta));
    if (!cart[id]) delete cart[id];
    save('cart',cart); render();
    if (modal?.type === 'product') renderProductModal(modal.id);
  }
  function closeModal() { modal=null; $('#modal-root').innerHTML=''; document.body.classList.remove('no-scroll'); if (lastFocus?.isConnected) lastFocus.focus({preventScroll:true}); }
  function showSheet(content, actions = '') {
    if (!modal) lastFocus = document.activeElement;
    $('#modal-root').innerHTML = `<div class="modal-overlay"><section class="sheet" role="dialog" aria-modal="true" aria-label="${modal?.type === 'product' ? 'Описание блюда' : 'Информация'}" tabindex="-1"><button class="round sheet-close" data-action="close" aria-label="Закрыть">${icon('close')}</button>${content}${actions}</section></div>`;
    document.body.classList.add('no-scroll'); $('.sheet').focus({preventScroll:true});
  }
  function renderProductModal(id) {
    const p=products.find(p=>p.id===id); if(!p) return;
    if (!modal) lastFocus = document.activeElement;
    modal={type:'product',id};
    showSheet(`<div class="sheet-art">${UnagiArt(p.art)}</div><div class="sheet-content"><div class="eyebrow">${p.badge || 'Сделано с заботой'}</div><h2>${esc(p.name)}</h2><div class="muted small">${meta(p)}</div><p class="description">${esc(p.description)}</p><h3>Что внутри</h3><p class="muted small">${esc(p.ingredients)}</p><h3>Аллергены</h3><p class="muted small">${esc(p.allergens)}</p><div class="nutrition"><span>Энергетическая ценность на 100 ${p.category === 'drinks' ? 'мл' : 'г'}</span><strong>≈ ${p.calories} ккал</strong></div><p class="muted small">Примерные состав и пищевая ценность. Иллюстрация условная. Перед реальным заказом данные нужно уточнить у ресторана.</p></div>`, `<div class="sheet-actions"><strong class="price">${money(p.price)}</strong>${cart[id] ? stepper(id) : `<button class="primary" data-action="add" data-id="${id}">${icon('plus')} В корзину</button>`}</div>`);
  }
  function infoSheet(title, body, actions='') { showSheet(`<div class="sheet-content legal"><div class="spacer"></div><h2>${title}</h2>${body}${actions}</div>`); modal={type:'info'}; }
  function captureForm() { if (!$('#checkout-form')) return; const values = new FormData($('#checkout-form')); for (const key of Object.keys(form)) if (key === 'consent') form[key] = values.has(key); else if (values.has(key)) form[key] = String(values.get(key)); }
  async function submitOrder() {
    if (submitting) return;
    captureForm(); const s=summary(); errors=D.validateCheckout({...form,fulfillment},s);
    if (Object.keys(errors).length) { render(); const invalid=$('[aria-invalid="true"]') || $('.error'); invalid?.scrollIntoView({block:'center',behavior:'smooth'}); invalid?.focus?.(); return; }
    submitting=true;
    try {
      const now=new Date();
      const order={id:crypto.randomUUID(),number:'D-' + String(orders.length ? Number(orders[0].number.slice(2))+1 : 1).padStart(4,'0'),createdAt:now.toISOString(),fulfillment,cutlery,lines:s.lines.map(p=>({id:p.id,name:p.name,quantity:p.quantity,price:p.price,sum:p.sum})),subtotal:s.subtotal,delivery:s.delivery,total:s.total,status:'demo-local'};
      const next=[order,...orders].slice(0,50);
      if (!save('orders',next)) return;
      orders=next;latestOrder=order;cart={};save('cart',cart);form={name:'',phone:'',street:'',house:'',apartment:'',entrance:'',comment:'',consent:false};errors={};navigate('success');
    } catch (_) { toast('Заказ не сохранён. Попробуйте ещё раз.'); }
    finally { submitting=false; }
  }
  document.addEventListener('submit', event=>{if(event.target.id==='checkout-form'){event.preventDefault();submitOrder();}});
  document.addEventListener('input',event=>{
    if(event.target.id==='search'){search=event.target.value;$('#product-grid').innerHTML=productGrid();}
    if(event.target.closest('#checkout-form')) captureForm();
  });
  document.addEventListener('click', event=>{
    if(event.target.classList.contains('modal-overlay')){closeModal();return;}
    const button=event.target.closest('button[data-action]'); if(!button || button.disabled) return;
    event.preventDefault(); const {action,id}=button.dataset;
    if(action==='nav') navigate(button.dataset.page);
    else if(action==='to-menu') {category='all';navigate('menu');}
    else if(action==='add' || action==='remove') changeCart(id,action==='add'?1:-1);
    else if(action==='favorite') {favorites.has(id)?favorites.delete(id):favorites.add(id);save('favorites',[...favorites]);render();}
    else if(action==='category') {category=id;render();}
    else if(action==='sets') {category='sets';render();$('.categories').scrollIntoView({behavior:'smooth',block:'start'});}
    else if(action==='focus-search') {$('#search').scrollIntoView({behavior:'smooth',block:'center'});$('#search').focus();}
    else if(action==='reset-search') {search='';category='all';render();}
    else if(action==='product') renderProductModal(id);
    else if(action==='close') closeModal();
    else if(action==='checkout') {errors={};navigate('checkout');}
    else if(action==='back') navigate('cart');
    else if(action==='mode') {captureForm();fulfillment=id==='pickup'?'pickup':'delivery';save('fulfillment',fulfillment);render();if(modal?.type==='fulfillment') fulfillmentSheet();}
    else if(action==='fulfillment') fulfillmentSheet();
    else if(action==='cutlery-minus' || action==='cutlery-plus') {cutlery=Math.max(0,Math.min(10,cutlery+(action==='cutlery-plus'?1:-1)));render();}
    else if(action==='about') infoSheet('Привет, мы Unagi.', '<p>Суши с характером — и приложение для вкусных вечеров.</p><h3>Сейчас доступна демонстрация</h3><p>Меню, цены, составы и условия доставки примерные. Заказы сохраняются только на этом устройстве. Подключения к iiko, ресторану, оплате и SMS пока нет.</p><p>Версия 0.1.0 · Android 8 и новее.</p>');
    else if(action==='conditions') infoSheet('Доставка и самовывоз','<p>Тестовые условия для демонстрации оформления:</p><h3>Доставка</h3><p>Минимум блюд на 700 ₽. Стоимость доставки 199 ₽, от 1 500 ₽ — бесплатно.</p><h3>Самовывоз</h3><p>Без минимальной суммы и платы за доставку. Реальный адрес, зона и часы работы появятся после настройки заведения.</p><p>В этой версии нет реальной доставки или бронирования времени.</p>');
    else if(action==='privacy') infoSheet('Ваши данные','<p>Корзина, избранное, способ получения и последние 50 тестовых заказов хранятся локально на этом устройстве. Приложение не запрашивает сетевой доступ и не отправляет аналитику.</p><p>Имя, телефон, адрес и комментарий используются только для проверки формы и очищаются после тестового оформления. Они не попадают в историю заказов.</p><p>Удалить сохранённые данные можно кнопкой в профиле или удалением приложения. Вход по телефону и облачная синхронизация появятся в следующем этапе.</p>');
    else if(action==='clear-cart') infoSheet('Очистить корзину?','<p>Все блюда будут удалены из текущей корзины.</p>','<button class="primary" data-action="confirm-clear-cart">Да, очистить</button><div class="spacer"></div><button class="secondary" data-action="close">Оставить блюда</button>');
    else if(action==='confirm-clear-cart') {cart={};save('cart',cart);closeModal();render();}
    else if(action==='clear-data') infoSheet('Удалить данные?','<p>Корзина, избранное и история тестовых заказов будут удалены с этого устройства.</p>','<button class="primary" data-action="confirm-clear-data">Удалить данные</button><div class="spacer"></div><button class="secondary" data-action="close">Отмена</button>');
    else if(action==='confirm-clear-data') {try{['cart','favorites','orders','fulfillment'].forEach(key=>localStorage.removeItem('unagi.'+key));cart={};favorites=new Set();orders=[];fulfillment='delivery';form={name:'',phone:'',street:'',house:'',apartment:'',entrance:'',comment:'',consent:false};cutlery=1;latestOrder=null;closeModal();render();toast('Локальные данные удалены');}catch(_){toast('Не удалось удалить данные');}}
    else if(action==='repeat') {
      const order=orders.find(o=>o.id===id);if(!order)return;
      if(summary().count) {infoSheet('Заменить корзину?','<p>Текущие блюда будут заменены позициями из этого заказа. Стоимость рассчитается по текущему меню.</p>',`<button class="primary" data-action="confirm-repeat" data-id="${esc(id)}">Заменить и повторить</button><div class="spacer"></div><button class="secondary" data-action="close">Отмена</button>`);}
      else repeat(order);
    } else if(action==='confirm-repeat') {const order=orders.find(o=>o.id===id);if(order)repeat(order);}
  });
  function repeat(order) {cart=D.normalizeCart(Object.fromEntries(order.lines.map(l=>[l.id,l.quantity])),products);save('cart',cart);fulfillment=order.fulfillment==='pickup'?'pickup':'delivery';save('fulfillment',fulfillment);navigate('cart');toast('Корзина собрана по текущему меню');}
  function fulfillmentSheet() {showSheet(`<div class="sheet-content legal"><div class="spacer"></div><h2>Как вам удобно?</h2>${modeSwitch()}<p>${fulfillment==='delivery'?'Привезём по адресу, который вы укажете при оформлении. В демоверсии условия доставки примерные.':'Забрать заказ самостоятельно. Реальный адрес точки будет доступен после подключения ресторана.'}</p><button class="primary" data-action="close">Готово</button></div>`);modal={type:'fulfillment'};}
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && modal)closeModal();
    if(event.key==='Tab' && modal){const list=[...$('.sheet').querySelectorAll('button:not(:disabled),input,textarea,[tabindex="0"]')];const first=list[0],last=list[list.length-1];if(event.shiftKey && (document.activeElement===first || document.activeElement===$('.sheet'))){event.preventDefault();last?.focus();}else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  window.UnagiApp={back(){if(modal){closeModal();return true;}if(page==='checkout'){navigate('cart');return true;}if(page!=='menu'){navigate('menu');return true;}if(search || category!=='all'){search='';category='all';render();return true;}return false;}};
  render(); if(storageFailed)toast('Хранилище недоступно: данные могут не сохраниться');
})();

