// Native meeting recorder, compiled into the app by build.rs (macOS only) and
// driven from Rust (src/recording.rs) through two C entry points:
//
//   dali_recorder_start(callback)  — ask for permission, open the mic and the
//                                    system-audio tap, start transcribing
//   dali_recorder_stop()           — stop capture, flush final phrases
//
// Everything that happens is reported back through `callback` as one JSON
// object per call:
//   {"type":"started","systemAudio":Bool,"onDevice":Bool}
//   {"type":"line","source":"you"|"others","at":Double,"text":String}
//   {"type":"error","message":String}   (fatal; "stopped" follows)
//   {"type":"stopped"}                   (always the last event)
//
// Two audio sources, transcribed separately so every line knows who said it:
//   - "you":    the microphone, through AVAudioEngine, boosted by a gentle
//               automatic gain so people across the room still register.
//   - "others": the Mac's system output via a Core Audio process tap (macOS
//               14.2+). No tap, no "others": older Macs record the mic only.
// No echo cancellation: enabling Apple's voice processing on the input, even
// bypassed, turns a built-in mic into a 9-channel stream about 25 dB quieter,
// which loses anyone across the room. Call audio from the speakers can land
// in both sources; headphones avoid that.
// Transcription is SFSpeechRecognizer, on-device whenever the language model is
// installed. Audio is never written to disk or sent anywhere by this file.

import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation
import Speech

public typealias DaliRecorderCallback = @convention(c) (UnsafePointer<CChar>) -> Void

private let recorderQueue = DispatchQueue(label: "edu.dartmouth.dali.os.recorder")
private var current: Recorder?

@_cdecl("dali_recorder_start")
public func daliRecorderStart(_ callback: DaliRecorderCallback) {
    recorderQueue.async {
        guard current == nil else { return }
        let recorder = Recorder(callback: callback)
        current = recorder
        recorder.start()
    }
}

@_cdecl("dali_recorder_stop")
public func daliRecorderStop() {
    recorderQueue.async {
        current?.stop()
    }
}

private func finish() {
    recorderQueue.async { current = nil }
}

// MARK: - Recorder

private final class Recorder {
    private let callback: DaliRecorderCallback
    private let startedAt = Date()
    private var mic: MicCapture?
    // SystemAudioCapture is 14.2+, so it's held only through its stop action.
    private var stopSystem: (() -> Void)?
    private var transcribers: [Transcriber] = []
    private var stopping = false

    init(callback: @escaping DaliRecorderCallback) {
        self.callback = callback
    }

    func emit(_ event: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: event),
              let json = String(data: data, encoding: .utf8)
        else { return }
        json.withCString { callback($0) }
    }

    func start() {
        requestPermissions { [self] error in
            recorderQueue.async { [self] in
                if let error {
                    emit(["type": "error", "message": error])
                    emit(["type": "stopped"])
                    finish()
                    return
                }
                begin()
            }
        }
    }

    private func begin() {
        guard let recognizer = SFSpeechRecognizer(), recognizer.isAvailable else {
            emit(["type": "error", "message": "Speech recognition isn't available on this Mac."])
            emit(["type": "stopped"])
            finish()
            return
        }
        let onDevice = recognizer.supportsOnDeviceRecognition
        let onLine: (String, TimeInterval, String) -> Void = { [weak self] source, at, text in
            self?.emit(["type": "line", "source": source, "at": at, "text": text])
        }
        let onFatal: (String) -> Void = { [weak self] message in
            recorderQueue.async { self?.fail(message) }
        }

        let you = Transcriber(source: "you", startedAt: startedAt, onDevice: onDevice,
                              onLine: onLine, onFatal: onFatal)
        do {
            mic = try MicCapture { buffer in you.append(buffer) }
        } catch {
            emit(["type": "error", "message": "Couldn't open the microphone."])
            emit(["type": "stopped"])
            finish()
            return
        }
        transcribers.append(you)

        if #available(macOS 14.2, *) {
            let others = Transcriber(source: "others", startedAt: startedAt, onDevice: onDevice,
                                     onLine: onLine, onFatal: onFatal)
            if let tap = try? SystemAudioCapture(onBuffer: { buffer in others.append(buffer) }) {
                stopSystem = tap.stop
                transcribers.append(others)
            }
        }

        emit(["type": "started", "systemAudio": stopSystem != nil, "onDevice": onDevice])
    }

    // A recognizer that refuses every request would otherwise record silence.
    private func fail(_ message: String) {
        guard !stopping else { return }
        emit(["type": "error", "message": message])
        stop()
    }

    func stop() {
        guard !stopping else { return }
        stopping = true
        mic?.stop()
        stopSystem?()
        mic = nil
        stopSystem = nil
        let group = DispatchGroup()
        for t in transcribers {
            group.enter()
            t.finish { group.leave() }
        }
        // Final phrases usually land well under a second after endAudio; don't
        // hold the stop hostage to a recognizer that never answers.
        DispatchQueue.global().async { [self] in
            _ = group.wait(timeout: .now() + 5)
            recorderQueue.async { [self] in
                emit(["type": "stopped"])
                finish()
            }
        }
    }

    private func requestPermissions(_ done: @escaping (String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                done("Allow speech recognition for DALI OS in System Settings > Privacy & Security.")
                return
            }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                done(granted ? nil : "Allow microphone access for DALI OS in System Settings > Privacy & Security.")
            }
        }
    }
}

// MARK: - Transcription

// One source's recognizer. A single SFSpeech task only ever grows one long
// transcription, so we end the request at each pause (or every minute, the
// server recognizer's limit) and start a fresh one: each finished request
// becomes one line, stamped with when its speech began.
private final class Transcriber {
    private static let pauseSeconds: TimeInterval = 1.2
    private static let maxRequestSeconds: TimeInterval = 50

    let source: String
    private let startedAt: Date
    private let onDevice: Bool
    private let onLine: (String, TimeInterval, String) -> Void
    private let onFatal: (String) -> Void
    private let recognizer = SFSpeechRecognizer()
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var requestStartedAt = Date()
    private var lastSpeechAt: Date?
    private var pending = 0
    private var onDrained: (() -> Void)?
    private var ended = false

    init(source: String, startedAt: Date, onDevice: Bool,
         onLine: @escaping (String, TimeInterval, String) -> Void,
         onFatal: @escaping (String) -> Void) {
        self.source = source
        self.startedAt = startedAt
        self.onDevice = onDevice
        self.onLine = onLine
        self.onFatal = onFatal
        lock.lock()
        rotateLocked()
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard !ended else { return }
        let now = Date()
        let paused = lastSpeechAt.map { now.timeIntervalSince($0) > Self.pauseSeconds } ?? false
        if paused || now.timeIntervalSince(requestStartedAt) > Self.maxRequestSeconds {
            rotateLocked()
        }
        request?.append(buffer)
    }

    func finish(_ done: @escaping () -> Void) {
        lock.lock()
        ended = true
        request?.endAudio()
        request = nil
        if pending == 0 {
            lock.unlock()
            done()
            return
        }
        onDrained = done
        lock.unlock()
    }

    // Caller holds `lock`.
    private func rotateLocked() {
        request?.endAudio()
        guard let recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = onDevice
        if #available(macOS 13, *) { req.addsPunctuation = true }
        request = req
        requestStartedAt = Date()
        lastSpeechAt = nil
        let offset = requestStartedAt.timeIntervalSince(startedAt)
        pending += 1

        var delivered = false
        recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                if !result.isFinal {
                    // Partial result: the speaker is still talking. Only the
                    // current request's partials move the pause clock.
                    self.lock.lock()
                    if self.request === req { self.lastSpeechAt = Date() }
                    self.lock.unlock()
                    return
                }
                let text = result.bestTranscription.formattedString
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    let at = offset + (result.bestTranscription.segments.first?.timestamp ?? 0)
                    self.onLine(self.source, at, text)
                }
            }
            // Either a final result or an error (a request that heard nothing
            // ends with "no speech detected", which is routine).
            if let error = error as NSError?, error.domain == "kLSRErrorDomain", error.code == 201 {
                // "Siri and Dictation are disabled": every request fails this way.
                self.onFatal("Turn on Dictation in System Settings > Keyboard to record meetings.")
            }
            if (result?.isFinal ?? false) || error != nil {
                if delivered { return }
                delivered = true
                self.lock.lock()
                self.pending -= 1
                let drained = self.pending == 0 ? self.onDrained : nil
                if drained != nil { self.onDrained = nil }
                self.lock.unlock()
                drained?()
            }
        }
    }
}

// MARK: - Levels

private func rms(_ buffer: AVAudioPCMBuffer) -> Float {
    guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
    let n = Int(buffer.frameLength)
    var sum: Float = 0
    for c in 0..<Int(buffer.format.channelCount) {
        let samples = channels[c]
        for i in 0..<n { sum += samples[i] * samples[i] }
    }
    return (sum / Float(n * Int(buffer.format.channelCount))).squareRoot()
}

// Slow automatic gain for the mic. A voice from across the room arrives far
// quieter than one at the keyboard, and the recognizer misses a lot of it.
// Speech is pulled toward a steady level (up to +20 dB), smoothly so words
// don't pump, and the gain holds through silence so room hiss is never
// boosted on its own.
private final class AutoGain {
    private static let target: Float = 0.06   // about -24 dBFS
    private static let maxGain: Float = 10
    private static let noiseFloor: Float = 0.0025
    private var gain: Float = 1

    func apply(_ buffer: AVAudioPCMBuffer) {
        guard let channels = buffer.floatChannelData else { return }
        let level = rms(buffer)
        if level > Self.noiseFloor {
            let wanted = min(Self.maxGain, max(1, Self.target / level))
            // Come down fast (a loud voice shouldn't clip), go up slowly.
            let rate: Float = wanted < gain ? 0.5 : 0.08
            gain += (wanted - gain) * rate
        }
        guard gain > 1.01 else { return }
        let n = Int(buffer.frameLength)
        for c in 0..<Int(buffer.format.channelCount) {
            let samples = channels[c]
            for i in 0..<n {
                // Soft clip so a sudden loud word saturates instead of cracking.
                let x = samples[i] * gain
                samples[i] = x / (1 + abs(x))
            }
        }
    }
}

// MARK: - Microphone

private final class MicCapture {
    private let engine = AVAudioEngine()
    private let gain = AutoGain()

    init(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let gain = self.gain
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { buffer, _ in
            gain.apply(buffer)
            onBuffer(buffer)
        }
        engine.prepare()
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }
}

// MARK: - System audio (Core Audio process tap)

private enum TapError: Error {
    case status(OSStatus)
}

private func check(_ status: OSStatus) throws {
    if status != noErr { throw TapError.status(status) }
}

// A private, unmuted, global stereo tap on everything the Mac plays, read
// through a private aggregate device. The first tap triggers macOS's one-time
// "System Audio Recording" prompt (NSAudioCaptureUsageDescription); if it's
// denied the tap simply delivers silence.
@available(macOS 14.2, *)
private final class SystemAudioCapture {
    private var tapID = AudioObjectID(kAudioObjectUnknown)
    private var aggregateID = AudioObjectID(kAudioObjectUnknown)
    private var procID: AudioDeviceIOProcID?
    private let ioQueue = DispatchQueue(label: "edu.dartmouth.dali.os.recorder.tap")

    init(onBuffer: @escaping (AVAudioPCMBuffer) -> Void) throws {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.muteBehavior = .unmuted
        description.isPrivate = true
        try check(AudioHardwareCreateProcessTap(description, &tapID))

        do {
            let outputUID = try Self.defaultOutputUID()
            let aggregate: [String: Any] = [
                kAudioAggregateDeviceNameKey: "DALI OS Meeting Recorder",
                kAudioAggregateDeviceUIDKey: UUID().uuidString,
                kAudioAggregateDeviceMainSubDeviceKey: outputUID,
                kAudioAggregateDeviceIsPrivateKey: true,
                kAudioAggregateDeviceIsStackedKey: false,
                kAudioAggregateDeviceTapAutoStartKey: true,
                kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
                kAudioAggregateDeviceTapListKey: [[
                    kAudioSubTapDriftCompensationKey: true,
                    kAudioSubTapUIDKey: description.uuid.uuidString,
                ]],
            ]
            try check(AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateID))

            var asbd = try Self.tapFormat(tapID)
            guard let format = AVAudioFormat(streamDescription: &asbd) else {
                throw TapError.status(kAudioHardwareUnspecifiedError)
            }

            try check(AudioDeviceCreateIOProcIDWithBlock(&procID, aggregateID, ioQueue) {
                _, inputData, _, _, _ in
                // The aggregate also delivers its output sub-device's own input
                // streams (6 channels on a MacBook Pro) ahead of the tap's, so
                // take only the tap's buffers, which come last. The list is
                // only valid for this callback; copy it out before the
                // recognizer reads it on its own thread.
                let all = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inputData))
                let tapBuffers = all.suffix(format.isInterleaved ? 1 : Int(format.channelCount))
                guard let first = tapBuffers.first, asbd.mBytesPerFrame > 0 else { return }
                let frames = first.mDataByteSize / asbd.mBytesPerFrame
                guard frames > 0,
                      let copy = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
                else { return }
                copy.frameLength = frames
                let dst = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
                for (s, d) in zip(tapBuffers, dst) {
                    if let from = s.mData, let to = d.mData {
                        memcpy(to, from, Int(min(s.mDataByteSize, d.mDataByteSize)))
                    }
                }
                onBuffer(copy)
            })
            try check(AudioDeviceStart(aggregateID, procID))
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        if let procID, aggregateID != kAudioObjectUnknown {
            AudioDeviceStop(aggregateID, procID)
            AudioDeviceDestroyIOProcID(aggregateID, procID)
        }
        procID = nil
        if aggregateID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = AudioObjectID(kAudioObjectUnknown)
        }
        if tapID != kAudioObjectUnknown {
            AudioHardwareDestroyProcessTap(tapID)
            tapID = AudioObjectID(kAudioObjectUnknown)
        }
    }

    private static func defaultOutputUID() throws -> String {
        var device = AudioObjectID(kAudioObjectUnknown)
        var size = UInt32(MemoryLayout<AudioObjectID>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultSystemOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        try check(AudioObjectGetPropertyData(
            AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device))

        var uid: Unmanaged<CFString>?
        size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
        address.mSelector = kAudioDevicePropertyDeviceUID
        try check(AudioObjectGetPropertyData(device, &address, 0, nil, &size, &uid))
        guard let uid else { throw TapError.status(kAudioHardwareUnspecifiedError) }
        return uid.takeRetainedValue() as String
    }

    private static func tapFormat(_ tap: AudioObjectID) throws -> AudioStreamBasicDescription {
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
        try check(AudioObjectGetPropertyData(tap, &address, 0, nil, &size, &asbd))
        return asbd
    }
}
