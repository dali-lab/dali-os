// Native meeting recorder, compiled into the app by build.rs (macOS only) and
// driven from Rust (src/recording.rs) through three C entry points:
//
//   dali_recorder_set_audio_callback(cb) — register the callback that
//                                          receives raw PCM as it is
//                                          captured. Call once, before
//                                          dali_recorder_start.
//   dali_recorder_start(callback)        — ask for microphone permission,
//                                          open the mic and the
//                                          system-audio tap.
//   dali_recorder_stop()                 — stop capture.
//
// Status is reported back through `callback` as one JSON object per call:
//   {"type":"started","systemAudio":Bool}
//   {"type":"error","message":String}   (fatal; "stopped" follows)
//   {"type":"stopped"}                   (always the last event)
//
// Audio is reported separately, through the audio callback, as raw frames:
// `channel` is 0 for the microphone, 1 for system ("call") audio; `ptr`
// points at `count` mono Int16 samples at 16 kHz (not bytes), valid only for
// the duration of the call — copy before returning. Each source runs its own
// AVAudioConverter from its native format to 16 kHz mono Int16, so the two
// channels are not sample-aligned; Rust batches each into fixed-size chunks
// independently.
//
// Two audio sources, captured and converted independently. No mixing and no
// on-device transcription — that now runs server-side on the uploaded PCM:
//   - the microphone, through AVAudioEngine, boosted by a gentle automatic
//     gain so people across the room still register.
//   - the Mac's system output via a Core Audio process tap (macOS 14.2+), so
//     the other side of a call is heard. Older Macs capture the mic only.
// No echo cancellation: enabling Apple's voice processing on the input, even
// bypassed, turns a built-in mic into a 9-channel stream about 25 dB quieter,
// which loses anyone across the room. Call audio from the speakers reaches the
// mic too; headphones avoid the doubling.
// Audio is never written to disk or sent anywhere by this file; it is handed
// to Rust, which uploads PCM chunks to the server.

import AVFoundation
import AudioToolbox
import CoreAudio
import Foundation

public typealias DaliRecorderCallback = @convention(c) (UnsafePointer<CChar>) -> Void
public typealias DaliRecorderAudioCallback = @convention(c) (UInt8, UnsafePointer<Int16>, Int) -> Void

private let recorderQueue = DispatchQueue(label: "edu.dartmouth.dali.os.recorder")
private var current: Recorder?

private let audioCallbackLock = NSLock()
private var registeredAudioCallback: DaliRecorderAudioCallback?

@_cdecl("dali_recorder_set_audio_callback")
public func daliRecorderSetAudioCallback(_ callback: DaliRecorderAudioCallback) {
    audioCallbackLock.lock()
    registeredAudioCallback = callback
    audioCallbackLock.unlock()
}

private func deliverAudio(_ channel: UInt8, _ data: UnsafePointer<Int16>, _ count: Int) {
    audioCallbackLock.lock()
    let callback = registeredAudioCallback
    audioCallbackLock.unlock()
    callback?(channel, data, count)
}

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
    private var mic: MicCapture?
    // SystemAudioCapture is 14.2+, so it's held only through its stop action.
    private var stopSystem: (() -> Void)?
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
        do {
            let micConverter = PCMConverter(channel: 0)
            mic = try MicCapture { buffer in micConverter.feed(buffer) }
        } catch {
            emit(["type": "error", "message": "Couldn't open the microphone."])
            emit(["type": "stopped"])
            finish()
            return
        }

        if #available(macOS 14.2, *) {
            let callConverter = PCMConverter(channel: 1)
            if let tap = try? SystemAudioCapture(onBuffer: { buffer in callConverter.feed(buffer) }) {
                stopSystem = tap.stop
            }
        }

        emit(["type": "started", "systemAudio": stopSystem != nil])
    }

    func stop() {
        guard !stopping else { return }
        stopping = true
        mic?.stop()
        stopSystem?()
        mic = nil
        stopSystem = nil
        emit(["type": "stopped"])
        finish()
    }

    private func requestPermissions(_ done: @escaping (String?) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            done(granted ? nil : "Allow microphone access for DALI OS in System Settings > Privacy & Security.")
        }
    }
}

// MARK: - PCM conversion

// Converts whatever format a source hands us to 16 kHz mono Int16 and
// forwards the result to the registered audio callback, tagged with this
// instance's channel. One instance per source; each is only ever fed from
// that source's own callback thread, so no locking is needed here.
private final class PCMConverter {
    private static let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: false)!

    private let channel: UInt8
    private var converter: AVAudioConverter?

    init(channel: UInt8) {
        self.channel = channel
    }

    func feed(_ buffer: AVAudioPCMBuffer) {
        if converter?.inputFormat != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: Self.format)
            converter?.downmix = true
        }
        let ratio = Self.format.sampleRate / buffer.format.sampleRate
        guard let converter,
              let converted = AVAudioPCMBuffer(
                pcmFormat: Self.format, frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32)
        else { return }
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
        guard converted.frameLength > 0, let data = converted.int16ChannelData?[0] else { return }
        deliverAudio(channel, data, Int(converted.frameLength))
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
                // converter reads it on its own thread.
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
