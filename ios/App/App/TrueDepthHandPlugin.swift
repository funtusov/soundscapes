import Foundation
import Capacitor
import AVFoundation
import Vision

/**
 * TrueDepth Hand Tracking Plugin
 *
 * Combines Vision framework hand landmarks with TrueDepth camera depth data
 * for accurate distance measurement (~20-50cm range, 1-2cm accuracy).
 */
@objc(TrueDepthHandPlugin)
public class TrueDepthHandPlugin: CAPPlugin, CAPBridgedPlugin, AVCaptureDataOutputSynchronizerDelegate {

    public let identifier = "TrueDepthHandPlugin"
    public let jsName = "TrueDepthHand"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]

    // Camera session
    private var captureSession: AVCaptureSession?
    private var dataOutputSynchronizer: AVCaptureDataOutputSynchronizer?
    private var videoDataOutput: AVCaptureVideoDataOutput?
    private var depthDataOutput: AVCaptureDepthDataOutput?

    // Vision
    private var handPoseRequest: VNDetectHumanHandPoseRequest?

    // State
    private var isRunning = false
    private let sessionQueue = DispatchQueue(label: "truedepth.session")
    private let processingQueue = DispatchQueue(label: "truedepth.processing", qos: .userInteractive)

    // Frame size (will be set when session starts)
    private var frameWidth: CGFloat = 640
    private var frameHeight: CGFloat = 480

    // Throttle events to ~30fps
    private var lastEventTime: CFTimeInterval = 0
    private let minEventInterval: CFTimeInterval = 1.0 / 30.0

    /**
     * Check if TrueDepth camera is available on this device.
     */
    @objc func isAvailable(_ call: CAPPluginCall) {
        let available = isTrueDepthAvailable()
        call.resolve(["available": available])
    }

    /**
     * Start hand tracking with TrueDepth camera.
     */
    @objc func start(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }

            if self.isRunning {
                call.resolve(["success": true, "message": "Already running"])
                return
            }

            guard self.isTrueDepthAvailable() else {
                call.reject("TrueDepth camera not available on this device")
                return
            }

            do {
                try self.setupCaptureSession()
                self.setupVision()
                self.captureSession?.startRunning()
                self.isRunning = true
                call.resolve(["success": true])
            } catch {
                call.reject("Failed to start: \(error.localizedDescription)")
            }
        }
    }

    /**
     * Stop hand tracking.
     */
    @objc func stop(_ call: CAPPluginCall) {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }

            self.captureSession?.stopRunning()
            self.isRunning = false
            call.resolve(["success": true])
        }
    }

    // MARK: - Private Methods

    private func isTrueDepthAvailable() -> Bool {
        let discoverySession = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInTrueDepthCamera],
            mediaType: .video,
            position: .front
        )
        return !discoverySession.devices.isEmpty
    }

    private func setupCaptureSession() throws {
        let session = AVCaptureSession()
        session.beginConfiguration()
        session.sessionPreset = .vga640x480

        // Find TrueDepth camera
        guard let device = AVCaptureDevice.default(.builtInTrueDepthCamera, for: .video, position: .front) else {
            throw NSError(domain: "TrueDepthHandPlugin", code: 1, userInfo: [NSLocalizedDescriptionKey: "TrueDepth camera not found"])
        }

        // Configure device for synchronized depth output
        let videoInput = try AVCaptureDeviceInput(device: device)
        if session.canAddInput(videoInput) {
            session.addInput(videoInput)
        }

        // Video data output for Vision hand detection
        let videoOutput = AVCaptureVideoDataOutput()
        videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        if session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
        }
        self.videoDataOutput = videoOutput

        // Depth data output
        let depthOutput = AVCaptureDepthDataOutput()
        depthOutput.isFilteringEnabled = true
        depthOutput.alwaysDiscardsLateDepthData = true
        if session.canAddOutput(depthOutput) {
            session.addOutput(depthOutput)
        }
        self.depthDataOutput = depthOutput

        // Synchronize video and depth frames
        let synchronizer = AVCaptureDataOutputSynchronizer(dataOutputs: [videoOutput, depthOutput])
        synchronizer.setDelegate(self, queue: processingQueue)
        self.dataOutputSynchronizer = synchronizer

        // Get frame dimensions
        let formatDescription = device.activeFormat.formatDescription
        let dimensions = CMVideoFormatDescriptionGetDimensions(formatDescription)
        self.frameWidth = CGFloat(dimensions.width)
        self.frameHeight = CGFloat(dimensions.height)

        session.commitConfiguration()
        self.captureSession = session
    }

    private func setupVision() {
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 2
        self.handPoseRequest = request
    }

    // MARK: - AVCaptureDataOutputSynchronizerDelegate

    public func dataOutputSynchronizer(_ synchronizer: AVCaptureDataOutputSynchronizer, didOutput synchronizedDataCollection: AVCaptureSynchronizedDataCollection) {
        // Throttle to ~30fps
        let now = CACurrentMediaTime()
        if now - lastEventTime < minEventInterval {
            return
        }
        lastEventTime = now

        guard let videoData = synchronizedDataCollection.synchronizedData(for: videoDataOutput!) as? AVCaptureSynchronizedSampleBufferData,
              let depthData = synchronizedDataCollection.synchronizedData(for: depthDataOutput!) as? AVCaptureSynchronizedDepthData,
              !videoData.sampleBufferWasDropped,
              !depthData.depthDataWasDropped else {
            return
        }

        let sampleBuffer = videoData.sampleBuffer
        var depth = depthData.depthData

        // Convert disparity to depth if needed (TrueDepth often returns disparity)
        let isDisparity = depth.depthDataType == kCVPixelFormatType_DisparityFloat32 ||
                          depth.depthDataType == kCVPixelFormatType_DisparityFloat16
        if isDisparity {
            depth = depth.converting(toDepthDataType: kCVPixelFormatType_DepthFloat32)
        }

        // Run hand detection
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer),
              let request = handPoseRequest else {
            return
        }

        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .leftMirrored, options: [:])

        do {
            try handler.perform([request])
        } catch {
            return
        }

        guard let observations = request.results, !observations.isEmpty else {
            // No hands detected
            notifyPlugin(data: ["hands": []])
            return
        }

        // Get depth map
        let depthMap = depth.depthDataMap
        let depthWidth = CVPixelBufferGetWidth(depthMap)
        let depthHeight = CVPixelBufferGetHeight(depthMap)

        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

        let depthPointer = CVPixelBufferGetBaseAddress(depthMap)?.assumingMemoryBound(to: Float32.self)

        var handsData: [[String: Any]] = []

        for observation in observations {
            var handData: [String: Any] = [:]

            // Determine handedness (Vision reports from camera's POV, we mirror for selfie)
            let chirality = observation.chirality
            // Mirror: camera's right = user's left
            handData["handedness"] = chirality == .right ? "Left" : "Right"

            // Get key landmarks
            guard let wrist = try? observation.recognizedPoint(.wrist),
                  let indexTip = try? observation.recognizedPoint(.indexTip),
                  let thumbTip = try? observation.recognizedPoint(.thumbTip),
                  let middleMcp = try? observation.recognizedPoint(.middleMCP),
                  let indexMcp = try? observation.recognizedPoint(.indexMCP),
                  let pinkyMcp = try? observation.recognizedPoint(.littleMCP) else {
                continue
            }

            // Check confidence
            if wrist.confidence < 0.3 || middleMcp.confidence < 0.3 {
                continue
            }

            // Vision coordinates are normalized (0-1), origin bottom-left
            // Convert to top-left origin to match MediaPipe
            let wristY = 1.0 - wrist.location.y
            let middleMcpX = middleMcp.location.x
            let middleMcpY = 1.0 - middleMcp.location.y

            // Sample depth at the middle MCP (stable palm point)
            let depthX = Int(middleMcp.location.x * CGFloat(depthWidth))
            let depthY = Int((1.0 - middleMcp.location.y) * CGFloat(depthHeight))

            var distanceMeters: Float = -1
            if let pointer = depthPointer,
               depthX >= 0 && depthX < depthWidth && depthY >= 0 && depthY < depthHeight {
                distanceMeters = pointer[depthY * depthWidth + depthX]
                // Filter invalid depth values
                if distanceMeters.isNaN || distanceMeters.isInfinite || distanceMeters <= 0 {
                    distanceMeters = -1
                }
            }

            // Calculate pinch ratio (for reverb control)
            let thumbIndexDist = hypot(thumbTip.location.x - indexTip.location.x,
                                       thumbTip.location.y - indexTip.location.y)
            let wristMcpDist = hypot(wrist.location.x - middleMcp.location.x,
                                     wrist.location.y - middleMcp.location.y)
            let pinchRatio = wristMcpDist > 0.001 ? thumbIndexDist / wristMcpDist : 1.0

            // Calculate palm facing score (for filter control)
            // Use cross product of index-wrist and pinky-wrist vectors
            let v1x = indexMcp.location.x - wrist.location.x
            let v1y = indexMcp.location.y - wrist.location.y
            let v2x = pinkyMcp.location.x - wrist.location.x
            let v2y = pinkyMcp.location.y - wrist.location.y
            // 2D cross product gives us rotation (palm facing camera when large)
            let crossZ = abs(v1x * v2y - v1y * v2x)
            let palmFacing = min(crossZ * 10, 1.0)  // Scale up and clamp

            handData["wristX"] = wrist.location.x
            handData["wristY"] = wristY
            handData["middleMcpX"] = middleMcpX
            handData["middleMcpY"] = middleMcpY
            handData["indexTipX"] = indexTip.location.x
            handData["indexTipY"] = 1.0 - indexTip.location.y
            handData["thumbTipX"] = thumbTip.location.x
            handData["thumbTipY"] = 1.0 - thumbTip.location.y
            handData["distanceMeters"] = distanceMeters
            handData["pinchRatio"] = pinchRatio
            handData["palmFacing"] = palmFacing
            handData["confidence"] = (wrist.confidence + middleMcp.confidence) / 2

            handsData.append(handData)
        }

        notifyPlugin(data: ["hands": handsData])
    }

    private func notifyPlugin(data: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("handUpdate", data: data)
        }
    }
}
