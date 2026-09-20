import SwiftUI

private let ink = Color(red: 0.12, green: 0.21, blue: 0.18)
private let cream = Color(red: 0.97, green: 0.96, blue: 0.93)

struct RootView: View {
    @EnvironmentObject private var store: Store
    var body: some View {
        TabView {
            NavigationStack { CatalogView() }.tabItem { Label("Меню", systemImage: "fork.knife") }
            NavigationStack { CartView() }.tabItem { Label("Корзина", systemImage: "bag") }
                .badge(store.count)
            NavigationStack { HistoryView() }.tabItem { Label("История", systemImage: "clock.arrow.circlepath") }
            NavigationStack { AboutView() }.tabItem { Label("О нас", systemImage: "info.circle") }
        }
        .alert("UNAGI", isPresented: Binding(get: { store.message != nil }, set: { if !$0 { store.message = nil } })) {
            Button("Понятно", role: .cancel) { store.message = nil }
        } message: { Text(store.message ?? "") }
    }
}

struct CatalogView: View {
    @EnvironmentObject private var store: Store
    @State private var search = ""
    @State private var category = "all"
    @State private var selectedProduct: Product?
    @State private var onlyFavorites = false

    private let categories = [("all", "Всё"), ("rolls", "Роллы"), ("sets", "Сеты"),
                              ("hot", "Горячее"), ("sushi", "Суши"), ("drinks", "Напитки"), ("extras", "Дополнительно")]
    private var filtered: [Product] {
        store.products.filter { product in
            (category == "all" || product.category == category) &&
            (!onlyFavorites || store.favorites.contains(product.id)) &&
            (search.isEmpty || product.name.localizedCaseInsensitiveContains(search))
        }
    }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("UNAGI").font(.system(size: 35, weight: .black, design: .rounded)).tracking(2)
                    Text("Японская кухня рядом").font(.title3)
                    Label("Демонстрационное меню · реальные заказы недоступны", systemImage: "info.circle")
                        .font(.caption).foregroundStyle(.orange)
                }.foregroundStyle(ink).padding(.top, 12)

                if let config = store.config {
                    VStack(alignment: .leading, spacing: 8) {
                        Picker("Бренд", selection: Binding(get: { store.brandId }, set: { id in Task { await store.selectBrand(id) } })) {
                            ForEach(config.brands) { brand in Text(brand.name).tag(brand.id) }
                        }
                        Picker("Точка", selection: Binding(get: { store.branchId }, set: { id in Task { await store.selectBranch(id) } })) {
                            ForEach(config.branches.filter { $0.brandId == store.brandId }) { branch in Text(branch.name).tag(branch.id) }
                        }
                        if let address = store.branch?.address, !address.isEmpty { Text(address).font(.caption).foregroundStyle(.secondary) }
                    }.padding().background(.white, in: RoundedRectangle(cornerRadius: 20))
                }

                HStack {
                    TextField("Поиск блюда", text: $search).textFieldStyle(.roundedBorder)
                    Button { onlyFavorites.toggle() } label: {
                        Image(systemName: onlyFavorites ? "heart.fill" : "heart")
                            .font(.title2).foregroundStyle(onlyFavorites ? .red : ink)
                    }.accessibilityLabel("Избранное")
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack { ForEach(categories, id: \.0) { item in
                        Button(item.1) { category = item.0 }
                            .buttonStyle(.borderedProminent)
                            .tint(category == item.0 ? ink : Color.gray.opacity(0.5))
                    } }
                }
                if store.loading { ProgressView("Загружаем меню") }
                else if filtered.isEmpty { ContentUnavailableView("Блюда не найдены", systemImage: "magnifyingglass") }
                else {
                    LazyVStack(spacing: 12) {
                        ForEach(filtered) { product in
                            Button { selectedProduct = product } label: { ProductRow(product: product) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }.padding()
        }
        .background(cream)
        .navigationTitle("Меню")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $selectedProduct) { ProductDetail(product: $0).environmentObject(store) }
        .refreshable { await store.load() }
    }
}

struct ProductRow: View {
    @EnvironmentObject private var store: Store
    let product: Product
    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: icon(product.art)).font(.system(size: 34)).frame(width: 70, height: 70)
                .foregroundStyle(ink).background(cream, in: RoundedRectangle(cornerRadius: 16))
            VStack(alignment: .leading, spacing: 6) {
                Text(product.name).font(.headline).foregroundStyle(ink)
                Text(rubles(product.price)).font(.subheadline.weight(.semibold)).foregroundStyle(ink)
                if !product.available { Text("Нет в наличии").font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Button { store.toggleFavorite(product.id) } label: {
                Image(systemName: store.favorites.contains(product.id) ? "heart.fill" : "heart")
                    .foregroundStyle(.red)
            }.buttonStyle(.plain).accessibilityLabel("В избранное")
        }.padding(12).background(.white, in: RoundedRectangle(cornerRadius: 20))
    }
}

struct ProductDetail: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let product: Product
    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Image(systemName: icon(product.art)).font(.system(size: 90)).foregroundStyle(ink)
                    .frame(maxWidth: .infinity).frame(height: 190).background(cream, in: RoundedRectangle(cornerRadius: 24))
                VStack(alignment: .leading, spacing: 8) {
                    Text(product.name).font(.largeTitle.bold())
                    Text(rubles(product.price)).font(.title2.bold()).foregroundStyle(ink)
                    Text("Состав и аллергены уточняйте в заведении. Меню сейчас демонстрационное.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading)
                Spacer()
                Button { store.setQuantity(product.id, (store.cart[product.id] ?? 0) + 1); dismiss() } label: {
                    Text("Добавить в корзину").frame(maxWidth: .infinity)
                }.buttonStyle(.borderedProminent).disabled(!product.available)
            }.padding()
                .navigationTitle("Блюдо").navigationBarTitleDisplayMode(.inline)
                .toolbar { Button("Закрыть") { dismiss() } }
        }
    }
}

struct CartView: View {
    @EnvironmentObject private var store: Store
    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if store.lines.isEmpty { ContentUnavailableView("Корзина пуста", systemImage: "bag") }
                else {
                    ForEach(store.lines.map(\.0)) { product in
                        let amount = store.cart[product.id] ?? 0
                        HStack {
                            VStack(alignment: .leading) { Text(product.name).font(.headline); Text(rubles(product.price * amount)) }
                            Spacer()
                            Button { store.setQuantity(product.id, amount - 1) } label: { Image(systemName: "minus.circle") }
                            Text("\(amount)").monospacedDigit()
                            Button { store.setQuantity(product.id, amount + 1) } label: { Image(systemName: "plus.circle") }
                        }.padding().background(.white, in: RoundedRectangle(cornerRadius: 18))
                    }
                    HStack { Text("Сумма блюд"); Spacer(); Text(rubles(store.subtotal)).bold() }.padding()
                    Text("Итоговую стоимость доставки рассчитает сервер перед оформлением.")
                        .font(.caption).foregroundStyle(.secondary)
                    NavigationLink { CheckoutView() } label: {
                        Text("Перейти к оформлению").frame(maxWidth: .infinity)
                    }.buttonStyle(.borderedProminent)
                }
            }.padding()
        }.background(cream).navigationTitle("Корзина")
    }
}

struct CheckoutView: View {
    @EnvironmentObject private var store: Store
    @State private var mode = "pickup"
    @State private var methodId = ""
    @State private var address = ""
    @State private var table = ""
    @State private var comment = ""
    @State private var quote: Quote?
    @State private var quoting = false
    @State private var saved = false

    private var allowedModes: [(String, String)] {
        guard let modes = store.branch?.modes else { return [] }
        return [("pickup", "Самовывоз", modes.pickup), ("delivery", "Доставка", modes.delivery),
                ("dinein", "В зале", modes.dinein)].filter(\.2).map { ($0.0, $0.1) }
    }
    var body: some View {
        Form {
            Section("Получение") {
                Picker("Способ", selection: $mode) {
                    ForEach(allowedModes, id: \.0) { value in Text(value.1).tag(value.0) }
                }
                if mode == "delivery" { TextField("Адрес доставки", text: $address).textContentType(.fullStreetAddress) }
                if mode == "dinein" { TextField("Номер стола", text: $table) }
            }
            Section("Оплата") {
                if store.methods.isEmpty { Text("Способы оплаты пока не загружены").foregroundStyle(.secondary) }
                else { Picker("Способ оплаты", selection: $methodId) {
                    ForEach(store.methods) { method in Text(method.name).tag(method.id) }
                } }
            }
            Section("Комментарий") { TextField("Пожелания к заказу", text: $comment, axis: .vertical).lineLimit(3...5) }
            Section {
                Button { Task { await refreshQuote() } } label: {
                    if quoting { ProgressView() } else { Text("Рассчитать на сервере") }
                }.disabled(store.lines.isEmpty || methodId.isEmpty || quoting || (mode == "delivery" && address.isEmpty) || (mode == "dinein" && table.isEmpty))
                if let quote {
                    LabeledContent("Блюда", value: rubles(quote.subtotal))
                    LabeledContent("Доставка", value: rubles(quote.delivery))
                    LabeledContent("Итого", value: rubles(quote.total))
                }
            } header: { Text("Расчёт") } footer: {
                Text("Сервер сейчас работает в демонстрационном режиме. Расчёт не создаёт заказ и не списывает деньги.")
            }
            Section {
                Button("Сохранить тестовый заказ") {
                    if let quote { store.saveDemoOrder(quote: quote); saved = true }
                }.disabled(quote == nil)
            } footer: { Text("Запись сохранится только на этом iPhone. Ресторан заказ не получит, оплата не произойдёт.") }
        }
        .navigationTitle("Оформление")
        .alert("Тестовый заказ сохранён", isPresented: $saved) {
            Button("Понятно") { quote = nil }
        } message: { Text("Запись доступна в истории на этом устройстве. Ресторан заказ не получил.") }
        .onAppear {
            if let first = allowedModes.first, !allowedModes.contains(where: { $0.0 == mode }) { mode = first.0 }
            if methodId.isEmpty { methodId = store.methods.first?.id ?? "" }
        }
        .onChange(of: mode) { _, _ in quote = nil }
        .onChange(of: methodId) { _, _ in quote = nil }
        .onChange(of: address) { _, _ in quote = nil }
        .onChange(of: table) { _, _ in quote = nil }
        .onChange(of: comment) { _, _ in quote = nil }
    }

    private func refreshQuote() async {
        quoting = true; defer { quoting = false }
        do {
            let request = store.orderRequest(methodId: methodId, mode: mode, address: address, comment: comment, table: table)
            quote = try await store.api.quote(request)
        } catch { store.message = error.localizedDescription }
    }
}

struct HistoryView: View {
    @EnvironmentObject private var store: Store
    var body: some View {
        List {
            if store.history.isEmpty { ContentUnavailableView("Тестовых заказов пока нет", systemImage: "clock") }
            ForEach(store.history) { order in
                VStack(alignment: .leading, spacing: 6) {
                    Text("Тестовый заказ").font(.headline)
                    Text(order.date.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                    Text(order.branchName)
                    Text(order.items.map { "\($0.name) × \($0.quantity)" }.joined(separator: ", "))
                        .font(.caption).foregroundStyle(.secondary)
                    Text(rubles(order.total)).bold()
                }.padding(.vertical, 4)
            }
        }.navigationTitle("История")
    }
}

struct AboutView: View {
    var body: some View {
        Form {
            Section("UNAGI") { Text("Нативное iOS-приложение для выбора блюд и предварительного расчёта.") }
            Section("Статус") {
                Text("Каталог содержит демонстрационные данные. Настоящие заказы, оплата и бонусы пока не подключены.")
                Text("Корзина и избранное сохраняются только на этом устройстве.")
            }
        }.navigationTitle("О приложении")
    }
}

private func icon(_ art: String?) -> String {
    switch art {
    case "drink", "berry": "cup.and.saucer.fill"
    case "sauce", "ginger": "drop.fill"
    case "set": "square.grid.2x2.fill"
    default: "circle.hexagongrid.fill"
    }
}
