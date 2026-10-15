import Foundation
import Vision
import ImageIO

struct Line: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}
struct Result: Codable {
    let width: Int
    let height: Int
    let lines: [Line]
}

do {
    if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--languages" {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        let supported = try request.supportedRecognitionLanguages()
        FileHandle.standardOutput.write(try JSONEncoder().encode(supported))
        exit(0)
    }
    guard CommandLine.arguments.count == 2 else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Expected an image path"])
    }
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "OCR", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid image"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    let supported = try request.supportedRecognitionLanguages()
    guard supported.contains("ko-KR") else {
        throw NSError(domain: "OCR", code: 3, userInfo: [NSLocalizedDescriptionKey: "This macOS Vision version does not support Korean OCR"])
    }
    request.recognitionLanguages = ["ko-KR", "en-US"]
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.008
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let lines = (request.results ?? []).compactMap { observation -> Line? in
        guard let text = observation.topCandidates(1).first, !text.string.isEmpty else { return nil }
        let b = observation.boundingBox
        // Vision coordinates have their origin at the lower left.
        return Line(text: text.string, confidence: text.confidence,
                    x: b.origin.x, y: 1 - b.origin.y - b.height,
                    width: b.width, height: b.height)
    }
    let data = try JSONEncoder().encode(Result(width: image.width, height: image.height, lines: lines))
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
