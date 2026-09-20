import Foundation

struct PublicConfig: Decodable {
    struct Business: Decodable {
        let id: String; let name: String; let acceptingOrders: Bool
        enum CodingKeys: String, CodingKey { case id, name; case acceptingOrders = "accepting_orders" }
    }
    struct Brand: Decodable, Identifiable { let id: String; let name: String; let description: String }
    struct Modes: Decodable { let delivery: Bool; let pickup: Bool; let dinein: Bool }
    struct Branch: Decodable, Identifiable {
        let id: String; let brandId: String; let name: String; let address: String
        let modes: Modes; let acceptingOrders: Bool
        let minimum: Int?; let deliveryFee: Int?; let freeDelivery: Int?
    }
    struct PaymentMethod: Decodable, Identifiable { let id: String; let brandId: String; let name: String; let type: String }
    let business: Business; let mode: String; let liveOrdersAvailable: Bool
    let brands: [Brand]; let branches: [Branch]; let paymentMethods: [PaymentMethod]?
}

struct MenuResponse: Decodable { let mode: String; let source: String; let branchId: String; let products: [Product] }
struct Product: Decodable, Identifiable {
    let id: String; let name: String; let category: String; let price: Int
    let available: Bool; let art: String?
}
struct OrderLine: Encodable { let productId: String; let quantity: Int }
struct OrderRequest: Encodable {
    let brandId: String; let branchId: String; let methodId: String; let mode: String
    let items: [OrderLine]; let requestedBonus = 0; let promoCode = ""
    let address: String; let comment: String; let table: String
}
struct Quote: Decodable {
    let subtotal: Int; let delivery: Int; let total: Int
    let brandName: String; let branchName: String; let methodName: String
    let liveOrdersAvailable: Bool
}
struct APIError: Decodable { let message: String? }
struct DemoOrder: Codable, Identifiable {
    let id: UUID; let date: Date; let branchName: String; let total: Int
    let items: [DemoOrderItem]
}
struct DemoOrderItem: Codable { let name: String; let quantity: Int }

func rubles(_ kopecks: Int) -> String {
    let value = Double(kopecks) / 100
    return value.formatted(.currency(code: "RUB").locale(Locale(identifier: "ru_RU")))
}
