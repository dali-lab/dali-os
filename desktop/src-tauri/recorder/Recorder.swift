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
// Two audio sources, mixed into one stream for a single recognizer:
//   - "you":    the microphone, through AVAudioEngine, boosted by a gentle
//               automatic gain so people across the room still register.
//   - "others": the Mac's system output via a Core Audio process tap (macOS
//               14.2+). No tap, no "others": older Macs record the mic only.
// Only one on-device recognition task can run per process: starting a second
// one cancels the first, before it delivers its text. So there is exactly one
// recognizer, fed the mix, and each line is credited to whichever source was
// louder while it was spoken.
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
        let onLine: (String, TimeInterval, String) -> Void = { [weak self] source, at, text in
            self?.emit(["type": "line", "source": source, "at": at, "text": text])
        }
        let onFatal: (String) -> Void = { [weak self] message in
            recorderQueue.async { self?.fail(message) }
        }

        let transcriber = Transcriber(startedAt: startedAt, onDevice: onDevice,
                                      onLine: onLine, onFatal: onFatal)
        let mixer = Mixer { buffer, levels in transcriber.append(buffer, levels: levels) }
        do {
            mic = try MicCapture { buffer in mixer.appendMic(buffer) }
        } catch {
            emit(["type": "error", "message": "Couldn't open the microphone."])
            emit(["type": "stopped"])
            finish()
            return
        }
        self.transcriber = transcriber

        if #available(macOS 14.2, *) {
            if let tap = try? SystemAudioCapture(onBuffer: { buffer in mixer.appendSystem(buffer) }) {
                stopSystem = tap.stop
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

// MARK: - Transcription

// How loud each source was over some stretch of audio (sums of squares).
private struct Levels {
    var you: Float = 0
    var others: Float = 0
}

// The single recognizer. A SFSpeech task only ever grows one long
// transcription, so we end the request at each pause (or every 50s, under the
// server recognizer's minute) and start a fresh one: each finished request
// becomes one line, stamped with when its speech began.
//
// A new task cancels the previous one even after its endAudio, so the next
// request only opens once the last has delivered its final text; audio that
// arrives in between is held and replayed into it.
private final class Transcriber {
    private static let pauseSeconds: TimeInterval = 1.2
    private static let maxRequestSeconds: TimeInterval = 50
    // Requests that fail outright, back to back, before this is fatal.
    private static let maxFailures = 5

    private final class Pending {
        let request = SFSpeechAudioBufferRecognitionRequest()
        let offset: TimeInterval
        var levels = Levels()
        var closed = false
        init(offset: TimeInterval) { self.offset = offset }
    }

    private let startedAt: Date
    private let onDevice: Bool
    private let onLine: (String, TimeInterval, String) -> Void
    private let onFatal: (String) -> Void
    private let recognizer = SFSpeechRecognizer()
    private let lock = NSLock()
    // The request audio goes into; nil while waiting on the previous one.
    private var open: Pending?
    // A request that has ended but not yet delivered, if any.
    private var closing: Pending?
    private var held: [(AVAudioPCMBuffer, Levels)] = []
    private var heldSince: Date?
    private var requestStartedAt = Date()
    private var lastSpeechAt: Date?
    private var failures = 0
    private var onDrained: (() -> Void)?
    private var ended = false

    init(startedAt: Date, onDevice: Bool,
         onLine: @escaping (String, TimeInterval, String) -> Void,
         onFatal: @escaping (String) -> Void) {
        self.startedAt = startedAt
        self.onDevice = onDevice
        self.onLine = onLine
        self.onFatal = onFatal
        lock.lock()
        openLocked(at: Date())
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer, levels: Levels) {
        lock.lock()
        defer { lock.unlock() }
        guard !ended else { return }
        let now = Date()
        if let open {
            let paused = lastSpeechAt.map { now.timeIntervalSince($0) > Self.pauseSeconds } ?? false
            if paused || now.timeIntervalSince(requestStartedAt) > Self.maxRequestSeconds {
                closeLocked(open)
            }
        }
        if let open {
            open.request.append(buffer)
            open.levels.you += levels.you
            open.levels.others += levels.others
        } else {
            if heldSince == nil { heldSince = now }
            held.append((buffer, levels))
        }
    }

    func finish(_ done: @escaping () -> Void) {
        lock.lock()
        ended = true
        if let open { closeLocked(open) }
        // Audio held for a request that will never open now; it's a fraction
        // of a second at most.
        held.removeAll()
        if closing == nil {
            lock.unlock()
            done()
            return
        }
        onDrained = done
        lock.unlock()
    }

    // Caller holds `lock`.
    private func closeLocked(_ pending: Pending) {
        pending.closed = true
        pending.request.endAudio()
        open = nil
        closing = pending
    }

    // Caller holds `lock`. `at` is when the request's first audio arrived.
    private func openLocked(at: Date) {
        guard let recognizer else { return }
        let pending = Pending(offset: at.timeIntervalSince(startedAt))
        let req = pending.request
        req.shouldReportPartialResults = true
        req.requiresOnDeviceRecognition = onDevice
        if #available(macOS 13, *) { req.addsPunctuation = true }
        open = pending
        requestStartedAt = at
        lastSpeechAt = nil

        var delivered = false
        recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                self.lock.lock()
                self.failures = 0
                // Only the open request's partials move the pause clock.
                if !result.isFinal, self.open === pending { self.lastSpeechAt = Date() }
                self.lock.unlock()
                if result.isFinal { self.deliver(result, from: pending) }
            }
            guard (result?.isFinal ?? false) || error != nil, !delivered else { return }
            delivered = true
            self.settled(pending, error: error as NSError?)
        }
    }

    private func deliver(_ result: SFSpeechRecognitionResult, from pending: Pending) {
        let text = result.bestTranscription.formattedString
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let at = pending.offset + (result.bestTranscription.segments.first?.timestamp ?? 0)
        let source = pending.levels.others > pending.levels.you ? "others" : "you"
        onLine(source, at, text)
    }

    // A request is done (final text or an error). Open the next one and replay
    // what arrived meanwhile.
    private func settled(_ pending: Pending, error: NSError?) {
        // "Siri and Dictation are disabled": every request fails this way.
        if let error, error.domain == "kLSRErrorDomain", error.code == 201 {
            onFatal("Turn on Dictation in System Settings > Keyboard to record meetings.")
        }
        lock.lock()
        // "No speech detected" is routine; anything else, over and over, means
        // the recognizer won't work and the recording would stay empty.
        if let error, !(error.domain == "kAFAssistantErrorDomain" && error.code == 1110) {
            failures += 1
        }
        if closing === pending { closing = nil }
        // The recognizer can end a request on its own; the rest of the audio
        // still needs somewhere to go.
        if open === pending { open = nil }
        if failures >= Self.maxFailures, !ended {
            lock.unlock()
            onFatal("Speech recognition stopped working (\(error?.domain ?? "") \(error?.code ?? 0)). Try recording again.")
            return
        }
        if ended {
            let drained = closing == nil ? onDrained : nil
            if drained != nil { onDrained = nil }
            lock.unlock()
            drained?()
            return
        }
        if open == nil {
            openLocked(at: heldSince ?? Date())
            let replay = held
            held.removeAll()
            heldSince = nil
            if let open {
                for (buffer, levels) in replay {
                    open.request.append(buffer)
                    open.levels.you += levels.you
                    open.levels.others += levels.others
                }
            }
        }
        lock.unlock()
    }
}

// MARK: - Mixing

// Folds the mic and the system tap into one 16 kHz mono stream for the
// recognizer. The mic is the clock: each mic buffer takes whatever system
// audio has arrived since, so a missing or silent tap never stalls it.
private final class Mixer {
    static let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000,
                                      channels: 1, interleaved: false)!
    // System audio waiting on the mic, capped so the two can't drift apart.
    private static let maxBacklog = 16_000
    private static let duckedMic: Float = 0.2

    private let output: (AVAudioPCMBuffer, Levels) -> Void
    private let lock = NSLock()
    private var system: [Float] = []
    private let micResampler = Resampler()
    private let systemResampler = Resampler()

    init(output: @escaping (AVAudioPCMBuffer, Levels) -> Void) {
        self.output = output
    }

    func appendSystem(_ buffer: AVAudioPCMBuffer) {
        let samples = systemResampler.convert(buffer)
        lock.lock()
        system.append(contentsOf: samples)
        if system.count > Self.maxBacklog { system.removeFirst(system.count - Self.maxBacklog) }
        lock.unlock()
    }

    func appendMic(_ buffer: AVAudioPCMBuffer) {
        let mic = micResampler.convert(buffer)
        guard !mic.isEmpty,
              let out = AVAudioPCMBuffer(pcmFormat: Self.format, frameCapacity: AVAudioFrameCount(mic.count)),
              let dst = out.floatChannelData?[0]
        else { return }
        lock.lock()
        let take = min(mic.count, system.count)
        let other = Array(system.prefix(take))
        system.removeFirst(take)
        lock.unlock()

        var levels = Levels()
        for i in 0..<mic.count {
            let o = i < take ? other[i] : 0
            levels.you += mic[i] * mic[i]
            levels.others += o * o
        }
        // Call audio from the speakers reaches the mic a moment late; mixed at
        // full level, that echo garbles the recognizer. While the Mac's own
        // audio is the louder source, the mic is turned down under it.
        let micGain: Float = levels.others > levels.you ? Self.duckedMic : 1
        for i in 0..<mic.count {
            let o = i < take ? other[i] : 0
            dst[i] = max(-1, min(1, mic[i] * micGain + o))
        }
        out.frameLength = AVAudioFrameCount(mic.count)
        output(out, levels)
    }
}

// One source's converter to the mixer's format, rebuilt if the source's format
// changes (e.g. the default device switches). Used from one thread only.
private final class Resampler {
    private var converter: AVAudioConverter?

    func convert(_ buffer: AVAudioPCMBuffer) -> [Float] {
        if converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: Mixer.format)
            converter?.downmix = true
        }
        guard let converter else { return [] }
        let ratio = Mixer.format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: Mixer.format, frameCapacity: capacity) else { return [] }
        var fed = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if fed {
                status.pointee = .noDataNow
                return nil
            }
            fed = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, let samples = out.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: samples, count: Int(out.frameLength)))
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
