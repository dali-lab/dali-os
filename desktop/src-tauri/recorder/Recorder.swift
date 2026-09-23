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
//   {"type":"line","at":Double,"text":String}
//   {"type":"error","message":String}   (fatal; "stopped" follows)
//   {"type":"stopped"}                   (always the last event)
//
// Two audio sources, mixed into one stream and transcribed together:
//   - the microphone, through AVAudioEngine, boosted by a gentle automatic
//     gain so people across the room still register.
//   - the Mac's system output via a Core Audio process tap (macOS 14.2+), so
//     the other side of a call is heard. Older Macs record the mic only.
// One stream because the on-device recognizer runs one task per app at a
// time: opening a second task cancels the first, which then returns "no
// speech detected" instead of its text. That's also why lines carry no
// speaker label.
// No echo cancellation: enabling Apple's voice processing on the input, even
// bypassed, turns a built-in mic into a 9-channel stream about 25 dB quieter,
// which loses anyone across the room. Call audio from the speakers reaches the
// mic too; headphones avoid the doubling.
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
    private var transcriber: Transcriber?
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
        let transcriber = Transcriber(
            startedAt: startedAt, onDevice: onDevice,
            onLine: { [weak self] at, text in
                self?.emit(["type": "line", "at": at, "text": text])
            },
            onFatal: { [weak self] message in
                recorderQueue.async { self?.fail(message) }
            })
        let mixer = Mixer { buffer in transcriber.append(buffer) }
        do {
            mic = try MicCapture { buffer in mixer.addMic(buffer) }
        } catch {
            emit(["type": "error", "message": "Couldn't open the microphone."])
            emit(["type": "stopped"])
            finish()
            return
        }
        self.transcriber = transcriber

        if #available(macOS 14.2, *),
           let tap = try? SystemAudioCapture(onBuffer: { buffer in mixer.addSystem(buffer) }) {
            stopSystem = tap.stop
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
        if let transcriber {
            group.enter()
            transcriber.finish { group.leave() }
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

// MARK: - Mixing

// Resamples both sources to 16 kHz mono and sums them. The mic drives the
// output (it always runs); system audio waits in a short FIFO and is mixed
// into each mic buffer as it arrives. Anything beyond a second of system
// backlog is dropped, so the two clocks can't drift apart.
private final class Mixer {
    static let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    private static let maxBacklog = 16_000

    private let out: (AVAudioPCMBuffer) -> Void
    private let lock = NSLock()
    private var system: [Float] = []
    private var micConverter: AVAudioConverter?
    private var systemConverter: AVAudioConverter?

    init(out: @escaping (AVAudioPCMBuffer) -> Void) {
        self.out = out
    }

    func addSystem(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        system += Self.convert(buffer, with: &systemConverter)
        if system.count > Self.maxBacklog { system.removeFirst(system.count - Self.maxBacklog) }
    }

    func addMic(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        var samples = Self.convert(buffer, with: &micConverter)
        let n = min(samples.count, system.count)
        for i in 0..<n { samples[i] += system[i] }
        system.removeFirst(n)
        lock.unlock()

        guard !samples.isEmpty,
              let mixed = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: AVAudioFrameCount(samples.count)),
              let dst = mixed.floatChannelData?[0]
        else { return }
        mixed.frameLength = AVAudioFrameCount(samples.count)
        for i in 0..<samples.count { dst[i] = max(-1, min(1, samples[i])) }
        out(mixed)
    }

    private static func convert(_ buffer: AVAudioPCMBuffer, with converter: inout AVAudioConverter?) -> [Float] {
        if converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: format)
            converter?.downmix = true
        }
        let ratio = format.sampleRate / buffer.format.sampleRate
        guard let converter,
              let converted = AVAudioPCMBuffer(
                pcmFormat: format, frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32)
        else { return [] }
        var fed = false
        converter.convert(to: converted, error: nil) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard let samples = converted.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: samples, count: Int(converted.frameLength)))
    }
}

// MARK: - Transcription

// A single SFSpeech task only ever grows one long transcription, so we end the
// request at each pause (or every 50 seconds) and start a fresh one: each
// finished request becomes one line, stamped with when its audio began.
// Only one task may be open at a time (see the header), so the next request
// waits until the previous one has answered; audio arriving meanwhile is kept
// in a backlog and fed to the next request when it opens.
private final class Transcriber {
    private static let pauseSeconds: TimeInterval = 1.2
    private static let maxRequestSeconds: TimeInterval = 50
    // An ended request that hasn't answered by then is left to finish on its
    // own; the next one opens anyway.
    private static let closeTimeout: TimeInterval = 3
    private static let maxBacklogBuffers = 200

    private let startedAt: Date
    private let onDevice: Bool
    private let onLine: (TimeInterval, String) -> Void
    private let onFatal: (String) -> Void
    private let recognizer = SFSpeechRecognizer()
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var requestStartedAt = Date()
    private var lastSpeechAt: Date?
    // The ended request still owed an answer, and when it was ended.
    private var closing: SFSpeechAudioBufferRecognitionRequest?
    private var closingSince = Date()
    private var backlog: [AVAudioPCMBuffer] = []
    private var backlogStartedAt = Date()
    // Earliest a new request may open after one failed on its own, so a
    // recognizer that fails every request doesn't open one per buffer.
    private var reopenAt = Date.distantPast
    private var pending = 0
    private var onDrained: (() -> Void)?
    private var ended = false

    init(startedAt: Date, onDevice: Bool,
         onLine: @escaping (TimeInterval, String) -> Void,
         onFatal: @escaping (String) -> Void) {
        self.startedAt = startedAt
        self.onDevice = onDevice
        self.onLine = onLine
        self.onFatal = onFatal
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard !ended else { return }
        let now = Date()
        if let request {
            let paused = lastSpeechAt.map { now.timeIntervalSince($0) > Self.pauseSeconds } ?? false
            guard paused || now.timeIntervalSince(requestStartedAt) > Self.maxRequestSeconds else {
                request.append(buffer)
                return
            }
            request.endAudio()
            closing = request
            closingSince = now
            self.request = nil
        }
        if backlog.isEmpty { backlogStartedAt = now }
        backlog.append(buffer)
        if backlog.count > Self.maxBacklogBuffers { backlog.removeFirst() }
        if closing != nil, now.timeIntervalSince(closingSince) > Self.closeTimeout { closing = nil }
        if closing == nil, now >= reopenAt { openLocked() }
    }

    func finish(_ done: @escaping () -> Void) {
        lock.lock()
        ended = true
        request?.endAudio()
        request = nil
        if closing == nil, !backlog.isEmpty { openLocked() }
        if pending == 0 {
            lock.unlock()
            done()
            return
        }
        onDrained = done
        lock.unlock()
    }

    // Opens a request fed with the backlog. After `finish`, it's ended right
    // away so the backlog's last words still come back. Caller holds `lock`.
    private func openLocked() {
        guard let recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = onDevice
        if #available(macOS 13, *) { req.addsPunctuation = true }
        requestStartedAt = backlog.isEmpty ? Date() : backlogStartedAt
        lastSpeechAt = nil
        let offset = requestStartedAt.timeIntervalSince(startedAt)
        pending += 1

        // A task cut short answers with an error instead of a final result,
        // so the latest partial stands in for the text it would have given.
        var latest: SFTranscription?
        var delivered = false
        recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                latest = result.bestTranscription
                if !result.isFinal {
                    // Partial result: the speaker is still talking. Only the
                    // open request's partials move the pause clock.
                    self.lock.lock()
                    if self.request === req { self.lastSpeechAt = Date() }
                    self.lock.unlock()
                    return
                }
            }
            if let error = error as NSError?, error.domain == "kLSRErrorDomain", error.code == 201 {
                // "Siri and Dictation are disabled": every request fails this way.
                self.onFatal("Turn on Dictation in System Settings > Keyboard to record meetings.")
            }
            if delivered { return }
            delivered = true
            if let latest {
                let text = latest.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                if !text.isEmpty {
                    self.onLine(offset + (latest.segments.first?.timestamp ?? 0), text)
                }
            }
            self.lock.lock()
            self.pending -= 1
            if self.closing === req { self.closing = nil }
            if self.request === req {
                // Ended on its own (a quiet stretch reads as "no speech
                // detected"). The next buffer opens a new one.
                self.request = nil
                if error != nil { self.reopenAt = Date().addingTimeInterval(0.5) }
            }
            if self.ended, self.closing == nil, self.request == nil, !self.backlog.isEmpty {
                self.openLocked()
            }
            let drained = self.pending == 0 ? self.onDrained : nil
            if drained != nil { self.onDrained = nil }
            self.lock.unlock()
            drained?()
        }
        for buffer in backlog { req.append(buffer) }
        backlog.removeAll()
        if ended {
            req.endAudio()
            closing = req
        } else {
            request = req
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
