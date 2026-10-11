import CloudKit
import Foundation

/// Conversations and memories in the private iCloud database, one record per storage key.
/// The value is the stored JSON as it is, deletions included, so the background compares `updatedAt` and keeps the newer side.
nonisolated enum CloudStore {

    private static let database = CKContainer(identifier: "iCloud.kuramot6f.chatext").privateCloudDatabase
    private static let recordType = "Item"

    /// Every key with its `updatedAt`, without the values.
    static func list() async throws -> [String: Double] {
        var items: [String: Double] = [:]
        var page: (matchResults: [(CKRecord.ID, Result<CKRecord, Error>)], queryCursor: CKQueryOperation.Cursor?)
        do {
            page = try await database.records(matching: CKQuery(recordType: recordType, predicate: NSPredicate(value: true)), desiredKeys: ["updatedAt"])
        } catch CKError.unknownItem {
            // The record type appears with the first save.
            return [:]
        }
        while true {
            for (id, result) in page.matchResults {
                if let record = try? result.get() { items[id.recordName] = record["updatedAt"] as? Double ?? 0 }
            }
            guard let cursor = page.queryCursor else { return items }
            page = try await database.records(continuingMatchFrom: cursor, desiredKeys: ["updatedAt"])
        }
    }

    static func get(_ keys: [String]) async throws -> [String: String] {
        let results = try await database.records(for: keys.map { CKRecord.ID(recordName: $0) }, desiredKeys: ["value"])
        return results.reduce(into: [:]) { values, entry in
            guard let url = (try? entry.value.get())?["value"] as? CKAsset,
                  let data = url.fileURL.flatMap({ try? Data(contentsOf: $0) }) else { return }
            values[entry.key.recordName] = String(decoding: data, as: UTF8.self)
        }
    }

    /// Overwrites whatever iCloud holds; the value is an asset because a conversation can outgrow a record's 1 MB.
    static func put(_ key: String, value: String, updatedAt: Double) async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data(value.utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let record = CKRecord(recordType: recordType, recordID: CKRecord.ID(recordName: key))
        record["value"] = CKAsset(fileURL: url)
        record["updatedAt"] = updatedAt
        let (saveResults, _) = try await database.modifyRecords(saving: [record], deleting: [], savePolicy: .allKeys)
        _ = try saveResults[record.recordID]?.get()
    }

}
