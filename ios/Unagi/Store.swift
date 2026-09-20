import Foundation

@MainActor final class Store: ObservableObject {
    @Published var config: PublicConfig?
    @Published var products: [Product] = []
    @Published var brandId = ""
    @Published var branchId = ""
    @Published var cart: [String: Int] = [:]
    @Published var favorites: Set<String> = []
    @Published var history: [DemoOrder] = []
    @Published var loading = false
    @Published var message: String?

    let api = APIClient()
    private let cartKey = "unagi.ios.cart.v1"
    private let favoritesKey = "unagi.ios.favorites.v1"
    private let historyKey = "unagi.ios.orders.v1"

    init() {
        if let saved = UserDefaults.standard.data(forKey: cartKey),
           let value = try? JSONDecoder().decode([String: Int].self, from: saved) { cart = value }
        if let saved = UserDefaults.standard.stringArray(forKey: favoritesKey) { favorites = Set(saved) }
        if let saved = UserDefaults.standard.data(forKey: historyKey),
           let value = try? JSONDecoder().decode([DemoOrder].self, from: saved) { history = value }
    }

    var branch: PublicConfig.Branch? { config?.branches.first { $0.id == branchId } }
    var methods: [PublicConfig.PaymentMethod] {
        config?.paymentMethods?.filter { $0.brandId == brandId } ?? []
    }
    var lines: [(Product, Int)] { products.compactMap { p in
        guard let count = cart[p.id], count > 0 else { return nil }; return (p, count)
    } }
    var count: Int { lines.reduce(0) { $0 + $1.1 } }
    var subtotal: Int { lines.reduce(0) { $0 + $1.0.price * $1.1 } }

    func load() async {
        loading = true; defer { loading = false }
        do {
            let loaded = try await api.config()
            config = loaded
            if !loaded.brands.contains(where: { $0.id == brandId }) { brandId = loaded.brands.first?.id ?? "" }
            if !loaded.branches.contains(where: { $0.id == branchId && $0.brandId == brandId }) {
                branchId = loaded.branches.first(where: { $0.brandId == brandId })?.id ?? ""
            }
            await loadMenu()
        } catch { message = "Не удалось загрузить меню: \(error.localizedDescription)" }
    }

    func selectBrand(_ id: String) async {
        brandId = id
        branchId = config?.branches.first(where: { $0.brandId == id })?.id ?? ""
        cart = [:]; saveCart()
        await loadMenu()
    }

    func selectBranch(_ id: String) async {
        branchId = id; cart = [:]; saveCart(); await loadMenu()
    }

    private func loadMenu() async {
        guard !branchId.isEmpty else { products = []; return }
        do {
            let menu = try await api.menu(branch: branchId)
            products = menu.products
            cart = cart.filter { id, _ in products.contains { $0.id == id && $0.available } }
            saveCart()
        } catch { message = "Не удалось загрузить блюда: \(error.localizedDescription)" }
    }

    func setQuantity(_ id: String, _ quantity: Int) {
        guard products.contains(where: { $0.id == id && $0.available }) else { return }
        if quantity <= 0 { cart.removeValue(forKey: id) }
        else { cart[id] = min(quantity, 30) }
        saveCart()
    }

    func toggleFavorite(_ id: String) {
        if favorites.contains(id) { favorites.remove(id) } else { favorites.insert(id) }
        UserDefaults.standard.set(Array(favorites), forKey: favoritesKey)
    }

    func orderRequest(methodId: String, mode: String, address: String, comment: String, table: String) -> OrderRequest {
        OrderRequest(brandId: brandId, branchId: branchId, methodId: methodId, mode: mode,
                     items: lines.map { OrderLine(productId: $0.0.id, quantity: $0.1) },
                     address: address, comment: comment, table: table)
    }

    func saveDemoOrder(quote: Quote) {
        let order = DemoOrder(id: UUID(), date: Date(), branchName: quote.branchName, total: quote.total,
                              items: lines.map { DemoOrderItem(name: $0.0.name, quantity: $0.1) })
        history.insert(order, at: 0)
        history = Array(history.prefix(50))
        UserDefaults.standard.set(try? JSONEncoder().encode(history), forKey: historyKey)
        cart = [:]; saveCart()
    }

    private func saveCart() { UserDefaults.standard.set(try? JSONEncoder().encode(cart), forKey: cartKey) }
}
